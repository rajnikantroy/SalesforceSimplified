/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Service worker: Connected App sign-in.
 *
 * Only needed when the org's Session Settings hide the sid cookie from
 * document.cookie ("Lock sessions to the domain in which they were first
 * used", or the HttpOnly attribute). The content script cannot run this
 * itself - chrome.identity is not exposed to content scripts - so it asks
 * here over runtime messaging.
 *
 * Authorization Code flow with PKCE. The extension is a public client: there
 * is no client secret, and there is nowhere safe to keep one.
 */

/*
 * The sync engine, loaded into this worker rather than imported by it.
 *
 * A classic service worker - the manifest declares no "type": "module" - so
 * importScripts is the mechanism, and everything in that file shares this
 * scope. It needs soapRequest, which is defined here, and this file needs its
 * job runner: keeping them in one scope is the arrangement that lets each
 * call the other without either being rewritten around the other.
 */
try {
    importScripts('/js/sync-engine.js');
} catch (e) {
    // The engine is missing or broken. Everything else in the worker still
    // works; the sync messages below answer with this instead of throwing.
    console.error('Salesforce Simplified: the sync engine did not load.', e);
}

const TOKEN_KEY = 'ssAuth';

/*
 * Tokens, one per org.
 *
 * ssAuth was a single record, so signing in to a second org overwrote the
 * first: come back to it and the grant is simply gone, with nothing to say
 * where it went. Two orgs is not an edge case here - a pipeline is two orgs
 * by definition, and the whole extension is built around moving between
 * them.
 *
 * Keyed by the host of the org the token was minted for. The key is only a
 * slot: which record belongs to which org is still decided by the same
 * comparisons that decided it before, so this changes where tokens live and
 * not how they are matched.
 */
const TOKENS_KEY = 'ssAuthOrgs';

function tokenSlot(record) {
    const url = (record && (record.instanceUrl || record.tokenOrigin ||
                            record.signedInAt)) || '';
    try { return new URL(url).hostname.toLowerCase(); } catch (e) { return null; }
}

/*
 * Every stored token, with the old single record folded in.
 *
 * The migration is on read rather than as a one-off write: a migration that
 * has to run exactly once, correctly, before anything else touches storage
 * is a much worse thing to get wrong than a fold that is simply idempotent.
 */
async function readTokens() {
    const bag = await chrome.storage.local.get([TOKENS_KEY, TOKEN_KEY]);
    const map = Object.assign({}, (bag && bag[TOKENS_KEY]) || {});

    const legacy = bag && bag[TOKEN_KEY];
    if (legacy && legacy.accessToken) {
        const slot = tokenSlot(legacy);
        // Never over the map: the map is newer by construction.
        if (slot && !map[slot]) { map[slot] = legacy; }
    }
    return map;
}

async function writeToken(record) {
    const slot = tokenSlot(record);
    if (!slot) { return null; }

    const map = await readTokens();
    map[slot] = record;
    await chrome.storage.local.set({ [TOKENS_KEY]: map });
    /*
     * And empty the old slot once its contents are safely in the map.
     * Leaving it would have every later read fold a stale copy back in,
     * on top of a record that has since been refreshed.
     */
    await chrome.storage.local.remove(TOKEN_KEY);
    return slot;
}

/*
 * The token for one org.
 *
 * Falls back to the only record there is when the caller cannot say which
 * org it means - which is what every caller looked like before there could
 * be more than one, and is still right when there is exactly one.
 */
async function tokenFor(origin) {
    const map = await readTokens();
    const slots = Object.keys(map);
    if (!slots.length) { return { slot: null, record: null }; }

    let host = null;
    try { host = new URL(origin).hostname.toLowerCase(); } catch (e) { host = null; }

    if (host) {
        if (map[host]) { return { slot: host, record: map[host] }; }
        const near = slots.filter((slot) =>
            host === slot || host.endsWith('.' + slot) || slot.endsWith('.' + host));
        if (near.length === 1) { return { slot: near[0], record: map[near[0]] }; }
    }

    if (slots.length === 1) { return { slot: slots[0], record: map[slots[0]] }; }
    return { slot: null, record: null };
}

async function forgetToken(slot) {
    const map = await readTokens();
    if (slot && map[slot]) { delete map[slot]; }
    await chrome.storage.local.set({ [TOKENS_KEY]: map });
    await chrome.storage.local.remove(TOKEN_KEY);
}
const SCOPES = 'api refresh_token';
const REDIRECT_URL = (typeof chrome !== 'undefined' && chrome.identity && typeof chrome.identity.getRedirectURL === 'function')
    ? chrome.identity.getRedirectURL()
    : 'https://hjeigbpcblpkaienmpihneipkempijob.chromiumapp.org/';

/*
 * Keyboard shortcut.
 *
 * Declared as a command rather than a keydown listener in the page: Chrome
 * owns the binding, so it shows up at chrome://extensions/shortcuts where
 * the user can change it or clear it, and it cannot be swallowed by the
 * org's own key handling. The content script is told, because only it can
 * see the menu.
 */
chrome.commands.onCommand.addListener(function (command) {
    if (command !== 'open-apex-classes') {
        return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs && tabs[0];
        if (!tab || !tab.id) { return; }
        chrome.tabs.sendMessage(tab.id, { type: 'SS_OPEN_APEX_CLASSES' }, function () {
            // No content script on this tab - not a Salesforce page. Nothing
            // to do, and nothing worth saying about it.
            void chrome.runtime.lastError;
        });
    });
});

/*
 * When this extension was installed, which is the only place that can be
 * known: content scripts see one org at a time and their storage is per-org,
 * so nothing in the page can tell "new here" from "new to this org".
 *
 * Recorded for a fresh install only. An upgrade must not write it - that
 * would hand a user who has had the extension for a year another week of the
 * launcher waving at them. Absent therefore means established, which is what
 * ssWithinIntroPeriod assumes.
 */
chrome.runtime.onInstalled.addListener(function (details) {
    if (!details || details.reason !== 'install') {
        return;
    }
    /*
     * On install only - details.reason is checked above, so an update or a
     * browser restart does not reopen it. A welcome page that returns
     * uninvited is an annoyance rather than an introduction.
     */
    try {
        chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }, function () {
            void chrome.runtime.lastError;
        });
    } catch (e) { /* not fatal - the install still succeeded */ }

    try {
        chrome.storage.local.set({ ssInstalledAt: Date.now() }, function () {
            void chrome.runtime.lastError;
        });
    } catch (e) {
        // Storage unavailable; the launcher simply will not animate.
    }
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) {
        return;
    }

    if (message.type === 'SS_OAUTH_LOGIN') {
        signIn(message.loginOrigin, message.clientId)
            .then(sendResponse)
            .catch(function (error) {
                sendResponse({ error: (error && error.message) || String(error) });
            });
        return true; // keep the message channel open for the async reply
    }

    if (message.type === 'SS_OAUTH_REFRESH') {
        refreshAccessToken(message.clientId, message.origin)
            .then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
        return true;
    }

    if (message.type === 'SS_OAUTH_LOGOUT') {
        // Always answer: a swallowed rejection would leave ssSignOut() waiting
        // on a reply that never comes.
        /*
         * This org, not every org. Signing out of the sandbox you are looking
         * at should not silently sign you out of production as well - which
         * is what removing the whole store did once there was more than one
         * token in it. With no origin given, everything goes: that is the
         * older behaviour, and the honest reading of "sign out" with nothing
         * to narrow it.
         */
        (message.origin
            ? tokenFor(message.origin).then((found) => forgetToken(found.slot))
            : chrome.storage.local.remove([TOKENS_KEY, TOKEN_KEY])
        ).then(function () {
            sendResponse({ ok: true });
        }, function (error) {
            sendResponse({ error: (error && error.message) || String(error) });
        });
        return true;
    }

    if (message.type === 'SS_OAUTH_REDIRECT_URL') {
        sendResponse({ redirectUrl: REDIRECT_URL });
        return false;
    }

    if (message.type === 'SS_TEST_NOTIFICATION') {
        sendTestNudge()
            .then(sendResponse)
            .catch(function (error) {
                sendResponse({ ok: false, error: (error && error.message) || String(error) });
            });
        return true;
    }

    if (message.type === 'SS_OPEN_WELCOME_PAGE') {
        try {
            chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }, function () {
                void chrome.runtime.lastError;
                sendResponse({ ok: true });
            });
        } catch (e) {
            sendResponse({ ok: false, error: String((e && e.message) || e) });
        }
        return true;
    }

    if (message.type === 'SS_OPEN_STANDALONE_PAGE') {
        /*
         * openOn, not type: `type` is already the name of the field that says
         * which message this is, and a page travelling under that name would
         * be read as a message kind by the dispatcher above.
         */
        openStandaloneTab(message.openOn)
            .then(function () { sendResponse({ ok: true }); })
            .catch(function (error) { sendResponse({ ok: false, error: (error && error.message) || String(error) }); });
        return true;
    }

    /*
     * What the standalone page needs to start: which orgs there are, and a
     * session for the one it picked.
     *
     * Answered only for the extension's own pages. A content script runs in a
     * web page's tab and would arrive here with sender.tab set; this reply
     * carries a bearer token, so it goes nowhere near one.
     */
    /*
     * Every org this browser has been used against, and whether it is still
     * signed in.
     *
     * The list itself has always outlived the session - it comes from ssBrief,
     * which records an org because the extension was opened on it, not because
     * a session exists. What was missing is saying which of them are still
     * usable, so an org whose session had gone simply looked like an org, and
     * the first sign of trouble was a job failing on it.
     *
     * Nothing here is a credential. The stored entry is an origin and a label;
     * the live/expired answer is read from the browser's own cookie jar at the
     * moment it is asked. This extension never holds a password, and signing
     * in again is the browser's job, not its own - which is why an expired
     * entry offers to open the org rather than to log you in.
     */
    if (message.type === 'SS_ORG_SESSIONS') {
        if (sender && sender.tab && sender.url &&
            sender.url.indexOf('chrome-extension://') !== 0) {
            /* A session id never leaves the worker for a web page's tab, and
             * neither does the list of orgs it could be asked about. */
            sendResponse({ error: 'Not available to page scripts.' });
            return false;
        }

        knownOrgs()
            .then(function (orgs) {
                return Promise.all((orgs || []).map(function (org) {
                    return readOrgSession(org.origin).then(function (sid) {
                        return {
                            origin: org.origin,
                            label: org.origin.replace(/^https?:\/\//, '') +
                                   (org.instanceKey ? ' (' + org.instanceKey + ')' : ''),
                            instanceKey: org.instanceKey || null,
                            /* Whether, not what. The sid is the one thing on
                             * this object that must not travel, so it does
                             * not - the panel has no use for it and every
                             * copy of it is somewhere else it can leak. */
                            live: !!sid,
                            lastUsedAt: org.updatedAt || 0
                        };
                    });
                }));
            })
            .then(function (orgs) { sendResponse({ ok: true, orgs: orgs }); })
            .catch(function (error) {
                sendResponse({ ok: false, error: (error && error.message) || String(error) });
            });
        return true;
    }

    if (message.type === 'SS_PAGE_SESSION') {
        if (sender && sender.tab && sender.url && sender.url.indexOf('chrome-extension://') !== 0) {
            sendResponse({ error: 'Not available to page scripts.' });
            return false;
        }
        knownOrgs()
            .then(function (orgs) {
                const chosen = message.origin ||
                    (orgs.length ? orgs[0].origin : null);
                if (!chosen) {
                    return { orgs: orgs, origin: null, sid: null };
                }
                return readOrgSession(chosen).then(function (sid) {
                    return { orgs: orgs, origin: chosen, sid: sid };
                });
            })
            .then(sendResponse)
            .catch(function (error) {
                sendResponse({ error: (error && error.message) || String(error) });
            });
        return true;
    }

    /*
     * SOAP calls, made here rather than in the page.
     *
     * Since Chrome 85 a content script's fetch is the *page's* fetch: it gets
     * the page's origin and none of the extension's host permissions, so a
     * call from a Lightning page to the org's my-domain host is a plain
     * cross-origin request. The Metadata API sends no CORS headers, so the
     * browser blocks it before it leaves - which surfaces as a status of 0
     * and looks exactly like the org being unreachable.
     *
     * The service worker does hold host_permissions, and is not subject to
     * CORS, so the same request simply works from here.
     */
    /*
     * REST, relayed for the same reason SOAP is.
     *
     * Since Chrome 85 a content script's fetch is the page's fetch: the
     * page's origin, none of the extension's host permissions. From a
     * Lightning page a call to the org's my-domain host is therefore a plain
     * cross-origin request, and Salesforce sends CORS headers only for origins
     * an admin has allowlisted in Setup - which almost none have. The browser
     * blocks it before it leaves, and the page sees "Failed to fetch": no
     * status, no body, nothing to report to the user.
     *
     * The service worker holds host_permissions and is not subject to CORS, so
     * the same request simply works from here.
     */
    if (message.type === 'SS_REST_REQUEST') {
        restRequest(message)
            .then(sendResponse)
            .catch(function (error) {
                sendResponse({ ok: false, status: 0, error: (error && error.message) || String(error) });
            });
        return true;
    }

    if (message.type === 'SS_SOAP_REQUEST') {
        soapRequest(message.url, message.body)
            .then(sendResponse)
            .catch(function (error) {
                sendResponse({ ok: false, status: 0, error: (error && error.message) || String(error) });
            });
        return true;
    }

    /*
     * Everything the sync pipeline is asked to do.
     *
     * One entry point rather than six listeners so that the "is the engine
     * even here" check is written once. A web page cannot reach any of this:
     * the manifest declares no externally_connectable, so only this
     * extension's own scripts can send these.
     */
    if (message.type && message.type.indexOf('SS_SYNC_') === 0) {
        syncMessage(message)
            .then(sendResponse)
            .catch(function (error) {
                sendResponse({ ok: false, error: (error && error.message) || String(error) });
            });
        return true;
    }
});

/* ---------------------------------------------------------------- */
/* Sync pipelines                                                     */
/* ---------------------------------------------------------------- */

async function syncMessage(message) {
    if (typeof ssSyncJobs !== 'function') {
        return { ok: false, code: 'SS-102',
                 error: 'The sync engine is not loaded. Reload the extension.' };
    }

    if (message.type === 'SS_SYNC_STATE') {
        /*
         * The org list comes from here rather than from the panel, because
         * the panel only has one on simplified.html - on an org page it knows
         * the org it is sitting on and nothing else. A pipeline is about two
         * orgs by definition, so both surfaces need the same list, and this
         * is where it already lives.
         */
        const [pipelines, jobs, orgs] = await Promise.all([
            ssSyncRead(SS_SYNC_PIPELINES_KEY, []),
            ssSyncJobs(),
            knownOrgs()
        ]);

        /*
         * Each pipeline as seen from the org the user is actually in.
         *
         * "sandbox1 ↔ sandbox2" does not say which of them you are standing
         * in, and that is the thing you need before pressing a button that
         * deploys one over the other. Worked out here rather than in the
         * panel because ssSyncRoute is the one place that knows the direction
         * rules, and a second copy in the template would eventually disagree
         * with the one that actually routes the job.
         *
         * A copy per pipeline, never the stored object: this decoration is
         * about the current tab and must not end up written back to storage.
         */
        const here = message.fromOrigin || null;
        const decorated = (pipelines || []).map(function (pipeline) {
            const route = here ? ssSyncRoute(pipeline, here) : { error: 'No org.' };
            return Object.assign({}, pipeline, {
                here: route.error
                    /*
                     * Which org could send, so the panel can point at it.
                     * "You cannot do this here" is only half an answer when
                     * the other half is "do it in that org".
                     */
                    ? { canSend: false, reason: route.error, sender: ssSyncSender(pipeline) }
                    : { canSend: true, source: route.source, target: route.target }
            });
        });

        return {
            ok: true,
            /*
             * The engine's own cap, sent rather than repeated in the panel.
             * The number appears in a suggested query and in the refusal when
             * a query returns more than it - two places that must agree with
             * the one that enforces it.
             */
            dataLimit: SS_SYNC_DATA_LIMIT,
            /* How long the org keeps a validation, from the engine that
             * decides whether one is still usable. */
            validationTtlMs: SS_SYNC_VALIDATION_TTL_MS,
            pipelines: decorated,
            /*
             * Read through the same session rule the runner applies, so a
             * failure already in the list gets the sign-in treatment too -
             * it was written before that existed, and nothing would
             * otherwise revisit it.
             */
            jobs: ssSyncPrune(jobs, SS_SYNC_MAX_JOBS).map(ssSyncNormaliseJob),
            counts: ssSyncCounts(jobs),
            orgs: (orgs || []).map(function (org) {
                return {
                    origin: org.origin,
                    label: org.origin.replace(/^https?:\/\//, '') +
                           (org.instanceKey ? ' (' + org.instanceKey + ')' : '')
                };
            })
        };
    }

    if (message.type === 'SS_SYNC_SAVE_PIPELINE') {
        const problem = ssSyncValidatePipeline(message.pipeline);
        if (problem) { return { ok: false, error: problem }; }

        const pipelines = (await ssSyncRead(SS_SYNC_PIPELINES_KEY, [])) || [];

        /*
         * Only these fields are stored, whatever the panel sends.
         *
         * SS_SYNC_STATE hands back each pipeline decorated with its route
         * from the current org, and the editor works on a copy of that - so
         * saving the object as it arrives would write a view of one tab's org
         * into storage, where the next tab would read it as fact.
         */
        const sent = message.pipeline;
        const incoming = {
            id: sent.id || ssSyncId('pipe'),
            a: { origin: sent.a.origin, label: sent.a.label || '' },
            b: { origin: sent.b.origin, label: sent.b.label || '' },
            direction: sent.direction,
            enabled: sent.enabled !== false,
            /*
             * The per-object matching keys, kept across an edit. They are set
             * by staging a data job rather than typed in this form, so an
             * edit that dropped them would silently un-configure every object
             * the pipeline has ever carried.
             */
            keys: sent.keys && typeof sent.keys === 'object' ? sent.keys : {},
            /*
             * Which tests the org runs for this pipeline's metadata jobs.
             * A pipeline setting rather than a per-job one because it has to
             * be chosen before validating, not after: a validation that ran
             * no tests cannot later stand in for a production deploy.
             */
            testLevel: ssSyncTestLevel(sent.testLevel),
            /*
             * The tally of how often this pipeline has been used. Carried
             * across an edit for the same reason the keys are: it is a record
             * of what happened, and editing the direction should not reset it
             * to zero.
             */
            usage: sent.usage && typeof sent.usage === 'object' ? sent.usage : {},
            updatedAt: Date.now()
        };

        const next = pipelines.filter(function (entry) { return entry.id !== incoming.id; });
        next.push(incoming);
        await ssSyncWrite(SS_SYNC_PIPELINES_KEY, next);
        return { ok: true, pipelines: next };
    }

    if (message.type === 'SS_SYNC_DELETE_PIPELINE') {
        const pipelines = (await ssSyncRead(SS_SYNC_PIPELINES_KEY, [])) || [];
        const next = pipelines.filter(function (entry) { return entry.id !== message.id; });
        await ssSyncWrite(SS_SYNC_PIPELINES_KEY, next);
        return { ok: true, pipelines: next };
    }

    /*
     * Staging is deliberately the only way a job comes into being, and it
     * never runs what it stages. The user asked for changes to be reviewed
     * before they land in the second org, and a stage that ran itself would
     * be that decision quietly reversed.
     */
    if (message.type === 'SS_SYNC_STAGE') {
        const pipelines = (await ssSyncRead(SS_SYNC_PIPELINES_KEY, [])) || [];
        const pipeline = pipelines.filter(function (entry) {
            return entry.id === message.pipelineId;
        })[0];
        if (!pipeline) { return { ok: false, code: 'SS-301', error: 'That pipeline no longer exists.' }; }
        if (pipeline.enabled === false) { return { ok: false, code: 'SS-301', error: 'That pipeline is switched off.' }; }

        const route = ssSyncRoute(pipeline, message.fromOrigin);
        if (route.error) { return { ok: false, error: route.error }; }

        const components = (message.components || []).filter(function (c) {
            return c && c.type && c.name;
        });
        if (!components.length) {
            return { ok: false, code: 'SS-401', error: 'Nothing was selected to send.' };
        }

        const job = ssSyncNewJob({
            pipelineId: pipeline.id,
            source: route.source,
            target: route.target,
            components: components,
            apiVersion: message.apiVersion || null,
            checkOnly: !!message.checkOnly,
            testLevel: pipeline.testLevel
        });

        const jobs = (await ssSyncJobs()) || [];
        jobs.push(job);
        await ssSyncSaveJobs(jobs);
        return { ok: true, job: job };
    }

    /*
     * Which fields could match a record across these two orgs.
     *
     * Asked of the target org's describe, because that is the org that has to
     * do the matching, and answered with only the fields it will actually
     * accept. Offering a free-text field name instead would let somebody
     * configure "Migration_Id__c" in an org where nobody marked it as an
     * External Id, and find out at write time.
     */
    if (message.type === 'SS_SYNC_KEY_CHOICES') {
        const pipelines = (await ssSyncRead(SS_SYNC_PIPELINES_KEY, [])) || [];
        const pipeline = pipelines.filter(function (e) { return e.id === message.pipelineId; })[0];
        if (!pipeline) { return { ok: false, code: 'SS-301', error: 'That pipeline no longer exists.' }; }

        const route = ssSyncRoute(pipeline, message.fromOrigin);
        if (route.error) { return { ok: false, error: route.error }; }
        if (!message.objectApiName) { return { ok: false, error: 'Choose an object first.' }; }

        const credential = await ssSyncCredential(route.target.origin);
        if (!credential) {
            return {
                ok: false,
                needsAuth: true,
                code: 'SS-201',
                error: 'Not signed in to ' + (route.target.label || 'the target org') + '.'
            };
        }

        try {
            const version = message.apiVersion || '62.0';
            const describe = await ssSyncRest(route.target.origin, credential.sessionId, 'GET',
                '/services/data/v' + version + '/sobjects/' +
                encodeURIComponent(message.objectApiName) + '/describe');
            return {
                ok: true,
                /*
                 * Both ways of matching, in one list: the External Ids the
                 * org can upsert on, then the fields we can look up. A
                 * standard object nobody has prepared has none of the first
                 * and plenty of the second, and offering only the first made
                 * the feature unusable on exactly those objects.
                 */
                keys: ssSyncCandidateKeys(describe),
                remembered: (pipeline.keys || {})[message.objectApiName] || null,
                target: route.target
            };
        } catch (error) {
            /*
             * "Session expired or invalid" is a sign-in, not an error.
             *
             * It arrived here as a red line of text with no action attached,
             * on a panel where the org that refused is not the org the user
             * is looking at - so the answer has to name which one, and offer
             * the way back to it.
             */
            if (error && error.ssNeedsAuth) {
                return {
                    ok: false,
                    needsAuth: true,
                    org: route.target,
                    error: 'The session for ' + (route.target.label || 'the target org') +
                           ' has expired or was refused.'
                };
            }
            return { ok: false, error: (error && error.message) || String(error) };
        }
    }

    /*
     * Staging a data job. Same rule as metadata: it creates the job and does
     * not run it.
     *
     * The chosen key is remembered against the object on the pipeline, so
     * that deciding "in this pipeline, Accounts are matched on
     * Migration_Id__c" is a decision made once rather than every time.
     */
    if (message.type === 'SS_SYNC_STAGE_DATA') {
        const pipelines = (await ssSyncRead(SS_SYNC_PIPELINES_KEY, [])) || [];
        const pipeline = pipelines.filter(function (e) { return e.id === message.pipelineId; })[0];
        if (!pipeline) { return { ok: false, code: 'SS-301', error: 'That pipeline no longer exists.' }; }
        if (pipeline.enabled === false) { return { ok: false, code: 'SS-301', error: 'That pipeline is switched off.' }; }

        const route = ssSyncRoute(pipeline, message.fromOrigin);
        if (route.error) { return { ok: false, error: route.error }; }

        const spec = {
            objectApiName: message.objectApiName,
            keyField: message.keyField,
            query: message.query
        };
        const problem = ssSyncValidateDataJob(spec);
        if (problem) { return { ok: false, error: problem }; }

        const job = ssSyncNewJob({
            kind: 'data',
            pipelineId: pipeline.id,
            source: route.source,
            target: route.target,
            objectApiName: spec.objectApiName,
            keyField: spec.keyField,
            query: spec.query,
            apiVersion: message.apiVersion || null
        });

        const jobs = (await ssSyncJobs()) || [];
        jobs.push(job);
        await ssSyncSaveJobs(jobs);

        const keys = Object.assign({}, pipeline.keys || {});
        keys[spec.objectApiName] = spec.keyField;
        const nextPipelines = pipelines.map(function (entry) {
            return entry.id === pipeline.id ? Object.assign({}, entry, { keys: keys }) : entry;
        });
        await ssSyncWrite(SS_SYNC_PIPELINES_KEY, nextPipelines);

        return { ok: true, job: job };
    }

    /*
     * Turning a successful validation into a real deploy.
     *
     * A new job rather than a change to the old one: the validation is a
     * finished thing that happened, and re-opening it would lose the record
     * of it. The new job carries the org's validation id, which is all the
     * runner needs - it skips the retrieve entirely, because the package is
     * already sitting verified in the target org.
     *
     * Runs on the press, like Apply. What would be reviewed has been: these
     * are the components of a job that was already staged, reviewed and
     * validated against the org that is about to receive them.
     */
    if (message.type === 'SS_SYNC_QUICK_DEPLOY') {
        const jobs = (await ssSyncJobs()) || [];
        const validation = jobs.filter(function (entry) { return entry.id === message.id; })[0];
        if (!validation) { return { ok: false, error: 'That validation is gone.' }; }

        if (!ssSyncQuickDeployable(validation, Date.now())) {
            return {
                ok: false,
                code: 'SS-502',
                error: 'That validation cannot be quick deployed. It has to have succeeded ' +
                       'as a validation, and the org only keeps one for ten days.'
            };
        }

        const job = ssSyncNewJob({
            kind: 'metadata',
            pipelineId: validation.pipelineId,
            source: validation.source,
            target: validation.target,
            components: validation.components,
            apiVersion: validation.apiVersion,
            testLevel: validation.testLevel,
            validationId: validation.result.deployId,
            validationOf: validation.id
        });

        jobs.push(job);
        await ssSyncSaveJobs(jobs);

        const outcome = await ssSyncRun(job.id);
        await ssSyncArmAlarm();
        return outcome;
    }

    if (message.type === 'SS_SYNC_APPLY' || message.type === 'SS_SYNC_RETRY') {
        const jobs = (await ssSyncJobs()) || [];
        const job = jobs.filter(function (entry) { return entry.id === message.id; })[0];
        if (!job) { return { ok: false, error: 'That job is gone.' }; }

        const allowed = message.type === 'SS_SYNC_APPLY'
            ? ssSyncApplyable(job)
            : ssSyncRetryable(job);
        if (!allowed) {
            return {
                ok: false,
                error: 'A job that is ' + job.state + ' cannot be ' +
                       (message.type === 'SS_SYNC_APPLY' ? 'applied' : 'retried') + '.'
            };
        }

        /*
         * ssSyncRun arms the alarm itself, the moment the job becomes
         * running - it has to, because this call does not come back until the
         * deploy finishes and this worker may be killed long before that. The
         * arming after it is the disarming: once nothing is running there is
         * nothing to wake up for.
         */
        const outcome = await ssSyncRun(job.id);
        await ssSyncArmAlarm();
        return outcome;
    }

    if (message.type === 'SS_SYNC_DISCARD') {
        const jobs = (await ssSyncJobs()) || [];
        const job = jobs.filter(function (entry) { return entry.id === message.id; })[0];
        if (!job) { return { ok: true }; }

        /*
         * A running job is not thrown away. It holds the org's async deploy
         * id, which is the only route back to a deploy that outlived the
         * worker - discard the record and the deploy carries on in the org
         * with nothing left that can say how it went.
         */
        if (!ssSyncForgettable(job)) {
            return { ok: false, error: 'That job is still running. Let it finish first.' };
        }

        await ssSyncSaveJobs(jobs.filter(function (entry) { return entry.id !== message.id; }));
        return { ok: true };
    }

    /*
     * Emptying one of the history lists.
     *
     * Local records only - a cleared failure is a forgotten report, not an
     * undone deployment, and nothing in either org changes.
     */
    if (message.type === 'SS_SYNC_CLEAR') {
        const jobs = (await ssSyncJobs()) || [];
        const outcome = ssSyncClear(jobs, message.group);
        if (outcome.error) { return { ok: false, error: outcome.error }; }
        await ssSyncSaveJobs(outcome.jobs);
        return { ok: true, removed: outcome.removed };
    }

    return { ok: false, error: 'Unknown sync request: ' + message.type };
}

/*
 * Only ever to the org, and only with a session the caller already had.
 *
 * A relay that fetches anywhere it is told to is a relay for anyone who can
 * reach it, and the session travels in the Authorization header - so the host
 * is checked here rather than trusted from the message. Same list, and the
 * same reasoning, as soapRequest below.
 */
async function restRequest(message) {
    const url = message && message.url;
    if (!url) { return { ok: false, status: 0, error: 'Malformed request.' }; }

    let host;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch (e) {
        return { ok: false, status: 0, error: 'Malformed request URL.' };
    }
    if (!/(^|\.)(my\.salesforce\.com|my\.salesforce-setup\.com|lightning\.force\.com|salesforce\.com)$/.test(host)) {
        return { ok: false, status: 0, error: 'Refusing to send a Salesforce session off-org.' };
    }

    const headers = { 'Accept': 'application/json' };
    if (message.sid) { headers.Authorization = 'Bearer ' + message.sid; }
    if (message.body) { headers['Content-Type'] = 'application/json'; }

    let response;
    try {
        response = await fetch(url, {
            method: message.method || 'GET',
            headers: headers,
            body: message.body ? JSON.stringify(message.body) : undefined
        });
    } catch (error) {
        /*
         * A network failure here has no status and no body, and its message is
         * the bare "Failed to fetch" - which says nothing about which host was
         * unreachable or what was being attempted. Reported once, properly,
         * rather than passed up as three words.
         */
        return {
            ok: false,
            status: 0,
            error: (message.method || 'GET') + ' ' + host + ' could not be reached: ' +
                   ((error && error.message) || 'network error') +
                   '. The org may be unreachable, or this host may not be the one ' +
                   'serving its API.'
        };
    }

    // 204 is what a successful PATCH answers, and it has no body to read.
    const text = response.status === 204 ? '' : await response.text();
    return { ok: response.ok, status: response.status, text: text };
}

async function soapRequest(url, body) {
    if (!url || !body) {
        return { ok: false, status: 0, error: 'Malformed Metadata API request.' };
    }
    // Only ever to the org. The message arrives from a content script, and a
    // relay that posts anywhere it is told to is a relay for anyone who can
    // reach it - the session lives inside that body.
    let host;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch (e) {
        return { ok: false, status: 0, error: 'Malformed Metadata API URL.' };
    }
    if (!/(^|\.)(my\.salesforce\.com|my\.salesforce-setup\.com|salesforce\.com)$/.test(host)) {
        return { ok: false, status: 0, error: 'Refusing to send a Salesforce session off-org.' };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=UTF-8', 'SOAPAction': '""' },
        body: body
    });
    return { ok: response.ok, status: response.status, text: await response.text() };
}

/*
 * A host is a sandbox when it says so structurally, not when the letters
 * happen to appear in it. `host.includes('cs')` matched acs-corp, docs and
 * every other org with those two letters anywhere in its domain, and sent
 * them all to test.salesforce.com, where their users cannot log in.
 *
 * Sandboxes are <domain>--<name>.sandbox.* under enhanced domains, and the
 * older instances are cs<number>.salesforce.com.
 */
function hostOf(origin) {
    try {
        return new URL(origin).hostname;
    } catch (e) {
        return '';
    }
}

function isSandboxHost(host) {
    const h = String(host || '').toLowerCase();
    return /(^|\.)sandbox\./.test(h) ||
           /(^|\.)cs\d+(\.|$)/.test(h) ||
           /(^|\.)test\.salesforce\.com$/.test(h);
}

function normalizeLoginOrigin(origin) {
    if (!origin) return 'https://login.salesforce.com';
    let url;
    try {
        url = new URL(origin);
    } catch (e) {
        return 'https://login.salesforce.com';
    }
    let host = url.hostname.toLowerCase();
    const isSandbox = isSandboxHost(host);

    // Lightning domains (*.lightning.force.com) do not serve OAuth endpoints directly
    if (host.endsWith('.lightning.force.com')) {
        host = host.replace('.lightning.force.com', '.my.salesforce.com');
        return `https://${host}`;
    }

    /*
     * Setup domains (*.my.salesforce-setup.com) do not serve OAuth endpoints,
     * and - because they end in .salesforce-setup.com rather than
     * .salesforce.com - they missed every branch below and fell through to
     * login.salesforce.com. That is a host this extension has no permission
     * for, so the token exchange failed with "Failed to fetch" after an
     * otherwise successful sign-in.
     *
     * The org's my-domain is the same org, serves OAuth, and is permitted.
     */
    if (host.endsWith('.my.salesforce-setup.com')) {
        host = host.replace('.my.salesforce-setup.com', '.my.salesforce.com');
        return `https://${host}`;
    }

    // Visualforce domains (*.visual.force.com or *.vf.force.com) do not support OAuth endpoints
    if (host.endsWith('.visual.force.com') || host.endsWith('.vf.force.com')) {
        if (host.includes('--')) {
            const orgName = host.split('--')[0];
            return `https://${orgName}.my.salesforce.com`;
        }
        return isSandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
    }

    if (host.endsWith('.salesforce.com')) {
        return url.origin;
    }

    return isSandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
}

function buildAuthUrl(originHost, clientId, redirectUri, challenge) {
    /*
     * No scope parameter, deliberately.
     *
     * Asking for "api refresh_token" explicitly looked like an improvement -
     * Salesforce only issues a refresh token when that scope is granted, so
     * requesting it made the difference between authorising once and
     * authorising all day visible rather than implicit.
     *
     * It also broke sign-in. A Connected App that does not have the
     * refresh_token scope selected rejects the request that asks for it, and
     * rejects it after the user has logged in, as OAUTH_APPROVAL_ERROR_GENERIC
     * - which names nothing. Omitting the parameter lets Salesforce grant
     * whatever the app is configured with, which is what worked before and
     * still yields a refresh token whenever the app allows one.
     *
     * Whether one actually arrived is checked at the exchange instead, where
     * the answer is a fact rather than a request.
     */
    return originHost + '/services/oauth2/authorize'
        + '?response_type=code'
        + '&client_id=' + encodeURIComponent(clientId)
        + '&redirect_uri=' + encodeURIComponent(redirectUri)
        + '&code_challenge=' + challenge
        + '&code_challenge_method=S256';
}

/*
 * What Salesforce's OAuth error actually means for this user.
 *
 * "External client app is not installed in this org" is accurate and tells
 * nobody what to do. It has exactly one cause - the org will not accept the
 * Connected App behind this Consumer Key - and exactly two fixes, neither of
 * which the extension can perform for the user: install the app, or point it
 * at one the org already has. Saying so here means the overlay does not have
 * to guess at the meaning of a string it did not write.
 *
 * The org's own words are kept on the end: they are what matches the
 * Salesforce documentation someone will search for.
 */
function describeAuthError(code, description, clientId) {
    const said = (description || code || '').trim();

    if (/not installed|not available|no.?such.?client|invalid_client|invalid client|client identifier|OAUTH_APP_BLOCKED/i.test(said + ' ' + code)) {
        /*
         * Which ways out are actually on screen depends on configuration -
         * the install link only renders when a package version id is set - so
         * this no longer promises a count. It said "both are below" while
         * showing one, which reads as a broken page rather than a choice.
         */
        return 'This org will not accept the Connected App this extension signs in with. ' +
               'That is a setting in the org, not something the extension can change: it either ' +
               'has not been installed here, or the org only permits apps of its own. ' +
               'The ways round it are below - the session id option needs no Setup access at all. ' +
               'Salesforce said: "' + said + '"';
    }

    if (/redirect_uri|redirect uri/i.test(said)) {
        return 'The callback URL does not match. The Connected App for Consumer Key ' + clientId +
               ' must have exactly this as its Callback URL: ' + REDIRECT_URL +
               '. Salesforce said: "' + said + '"';
    }

    if (/inactive|disabled/i.test(said)) {
        return 'That Connected App exists but is not usable - check it is active, and that its ' +
               'OAuth policy lets your user self-authorize. Salesforce said: "' + said + '"';
    }

    return said || 'Sign-in failed.';
}

/*
 * launchWebAuthFlow rejects for several unrelated reasons and this used to
 * flatten all of them into one Setup checklist, discarding what actually went
 * wrong. Two of those reasons are not Setup problems at all:
 *
 *   - the user closed the window, which is not a failure and certainly not a
 *     reason to send them auditing four settings that were already correct;
 *   - the app was created minutes ago, and Salesforce takes its time
 *     publishing a new Connected App - the checklist is right about every
 *     item and the answer is still to wait.
 */
function authCancelled(said) {
    return /did not approve|user cancel|canceled|cancelled|closed by user/i.test(said || '');
}

function authLoadFailure(clientId, redirectUri, cause) {
    const said = (cause && cause.message ? cause.message : String(cause || '')).trim();

    if (authCancelled(said)) {
        return 'Sign-in was cancelled.';
    }

    /*
     * Why this failure says so little, and what it is almost always hiding.
     *
     * Salesforce reports most OAuth problems by redirecting to the callback
     * with error= on it, which is how describeAuthError gets anything useful
     * to say. Two problems it cannot report that way, because both make the
     * callback itself untrustworthy: a Consumer Key it does not recognise,
     * and a redirect_uri that is not the one registered. For those it renders
     * a 400 page instead - and a 400 page is not something Chrome can finish
     * an auth flow with, so all the extension ever hears is that the page did
     * not load.
     *
     * So the two named first here are not guesses; they are the only two
     * causes that produce exactly this symptom.
     */
    return 'The Salesforce authorization page could not be loaded. Salesforce answers with an ' +
        'error page, rather than something this extension can read, for exactly two problems - ' +
        'so it is almost certainly one of them.\n\n' +
        '1. The Callback URL on the Connected App is not exactly:\n' + redirectUri + '\n' +
        'It must match character for character, including the trailing slash.\n\n' +
        '2. This Consumer Key is not one Salesforce recognises:\n' + clientId + '\n' +
        'If the Connected App was created or edited in the last few minutes, that is expected - ' +
        'Salesforce takes 2-10 minutes to publish one. Wait, then try again.\n\n' +
        'Worth confirming while you are there: "Enable OAuth Settings" is checked with the "api" ' +
        'and "refresh_token" scopes, and "Require Secret for Web Server Flow" is UNCHECKED. ' +
        (said ? '\n\nChrome said: "' + said + '".' : '');
}

async function signIn(loginOrigin, clientId) {
    if (!clientId) {
        throw new Error('No Connected App consumer key configured.');
    }
    const targetOrigin = normalizeLoginOrigin(loginOrigin);

    const verifier = randomVerifier();
    const challenge = await codeChallenge(verifier);
    const redirectUri = REDIRECT_URL;

    const authUrl = buildAuthUrl(targetOrigin, clientId, redirectUri, challenge);

    let usedOrigin = targetOrigin;
    let redirect;
    try {
        redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    } catch (err) {
        // Fallback to login.salesforce.com / test.salesforce.com if targetOrigin failed
        const fallbackOrigin = isSandboxHost(hostOf(loginOrigin))
            ? 'https://test.salesforce.com'
            : 'https://login.salesforce.com';


        if (targetOrigin !== fallbackOrigin) {
            usedOrigin = fallbackOrigin;
            const fallbackAuthUrl = buildAuthUrl(fallbackOrigin, clientId, redirectUri, challenge);
            try {
                redirect = await chrome.identity.launchWebAuthFlow({ url: fallbackAuthUrl, interactive: true });
            } catch (err2) {
                throw new Error(authLoadFailure(clientId, redirectUri, err2));
            }
        } else {
            throw new Error(authLoadFailure(clientId, redirectUri, err));
        }
    }

    if (!redirect) {
        throw new Error('Sign-in was cancelled.');
    }

    const params = new URL(redirect).searchParams;
    const error = params.get('error');
    if (error) {
        throw new Error(describeAuthError(error, params.get('error_description'), clientId));
    }
    const code = params.get('code');
    if (!code) {
        throw new Error('No authorization code returned.');
    }

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier
    });

    const response = await fetch(usedOrigin + '/services/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    });
    const token = await response.json();
    if (!response.ok || !token.access_token) {
        const errDesc = token.error_description || token.error || 'Token exchange failed.';
        if (errDesc.toLowerCase().includes('invalid_client') || errDesc.toLowerCase().includes('invalid client credentials')) {
            throw new Error('Token exchange failed: "invalid client credentials". In Salesforce Setup > Connected Apps > Edit your Connected App, make sure "Require Secret for Web Server Flow" is UNCHECKED (since extensions use PKCE without client secret).');
        }
        throw new Error(errDesc);
    }

    const stored = {
        accessToken: token.access_token,
        instanceUrl: token.instance_url || loginOrigin,
        refreshToken: token.refresh_token || null,
        // Which authorization server actually minted this, and under which
        // client id. A refresh has to go back to the same pair - the origin
        // here may be a fallback rather than the one first asked for, and the
        // client id may be the org's own app rather than the shipped one.
        tokenOrigin: usedOrigin,
        clientId: clientId,
        /*
         * Whether this grant can be refreshed at all. An app without the
         * refresh_token scope returns none, and every later refresh will fail
         * - worth knowing here, where it is a fact, rather than asking for the
         * scope up front and having the sign-in refused for it.
         */
        canRefresh: !!token.refresh_token,
        // The page the user signed in from. instance_url does not always look
        // like the host being browsed, so this is what lets the content script
        // recognise its own token without guessing from host shapes.
        signedInAt: loginOrigin || null,
        obtainedAt: Date.now()
    };
    await writeToken(stored);

    return { ok: true, accessToken: stored.accessToken, instanceUrl: stored.instanceUrl };
}

/* ---------------------------------------------------------------- */
/* Refreshing                                                        */
/*                                                                   */
/* The refresh token was always being asked for and stored, and never */
/* spent. So an access token that aged out sent the user back to the  */
/* sign-in overlay with a perfectly good refresh token sitting in     */
/* storage - which is the difference between authorising once and     */
/* authorising every couple of hours.                                 */
/*                                                                   */
/* Still a public client: no secret, same as the authorization code   */
/* exchange.                                                         */
/* ---------------------------------------------------------------- */

// One in flight at a time. Every panel queries on load, so an expired token
// produces a burst of 401s at once; without this they would each start their
// own refresh and all but one of the resulting tokens would be discarded -
// and Salesforce may invalidate the earlier ones as it goes.
let refreshInFlight = null;

/*
 * One refresh at a time, per org.
 *
 * The single in-flight guard was right when there was one token; with a
 * token per org it would make a refresh for org B wait on - and then return
 * the answer belonging to - a refresh already running for org A.
 */
const refreshesInFlight = new Map();

async function refreshAccessToken(fallbackClientId, origin) {
    const { slot } = await tokenFor(origin);
    const key = slot || '*';

    if (refreshesInFlight.has(key)) { return refreshesInFlight.get(key); }
    const running = doRefresh(fallbackClientId, origin)
        .finally(() => { refreshesInFlight.delete(key); });
    refreshesInFlight.set(key, running);
    return running;
}

async function doRefresh(fallbackClientId, wantedOrigin) {
    /* wantedOrigin, not origin: the token's own origin is worked out below
     * and the two are different things - the org being refreshed, and the
     * host its refresh has to be posted to. */
    const found = await tokenFor(wantedOrigin);
    const saved = found.record;

    if (!saved || !saved.refreshToken) {
        return { ok: false, error: 'No refresh token; sign in again.' };
    }

    const origin = saved.tokenOrigin || saved.instanceUrl;
    /*
     * Tokens minted before the client id was recorded alongside them have no
     * clientId of their own, so the page passes the one it is configured with.
     * The service worker has no copy of the shipped constant - it lives in
     * ss-core.js, which is not imported here - and guessing would fail the
     * exchange with an error about the wrong app.
     */
    const clientId = saved.clientId || fallbackClientId;
    if (!origin || !clientId) {
        return { ok: false, error: 'Cannot tell which org to refresh against; sign in again.' };
    }

    let token;
    try {
        const response = await fetch(origin + '/services/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: clientId,
                refresh_token: saved.refreshToken
            }).toString()
        });
        token = await response.json();
        if (!response.ok || !token.access_token) {
            /*
             * A refresh token is revoked when the user disconnects the app or
             * an admin expires it, and it never comes back. Dropping the whole
             * record is what puts the sign-in overlay in front of the user
             * rather than retrying a dead token on every request forever.
             */
            await forgetToken(found.slot);
            return {
                ok: false,
                error: token.error_description || token.error || 'Could not refresh the session.'
            };
        }
    } catch (e) {
        // A network failure is not a revoked grant - keep the token so the
        // next attempt can still use it.
        return { ok: false, error: 'Could not reach Salesforce to refresh the session.' };
    }

    const stored = Object.assign({}, saved, {
        accessToken: token.access_token,
        /*
         * Whichever refresh token is now the live one.
         *
         * Ordinarily a refresh response carries none, and the one already held
         * stands. But an org with "Enable Refresh Token Rotation" switched on
         * returns a new one and invalidates the old immediately - so keeping
         * the old one there would work exactly once and then fail forever,
         * with the failure landing weeks later and looking like a revoked
         * grant. Taking whichever came back is right under either setting.
         */
        refreshToken: token.refresh_token || saved.refreshToken,
        instanceUrl: token.instance_url || saved.instanceUrl,
        obtainedAt: Date.now()
    });
    await writeToken(stored);

    return { ok: true, accessToken: stored.accessToken, instanceUrl: stored.instanceUrl };
}

/* ---------------------------------------------------------------- */
/* PKCE                                                              */
/* ---------------------------------------------------------------- */

function base64url(bytes) {
    let binary = '';
    for (const b of new Uint8Array(bytes)) {
        binary += String.fromCharCode(b);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier() {
    // 32 bytes -> 43 base64url chars, the minimum RFC 7636 allows.
    return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function codeChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64url(digest);
}

/* ---------------------------------------------------------------- */
/* Off-hours nudge                                                    */
/*                                                                    */
/* Outside working hours, someone who has not opened the extension    */
/* for a while gets one notification about what happened to their org */
/* today - and clicking it opens the panel.                           */
/*                                                                    */
/* Assembled here rather than in a page because the point is to reach */
/* someone who does NOT have Salesforce open; if a tab were required  */
/* the notification could only ever fire when it was least needed.    */
/* The service worker has no session, so it works from two things the */
/* content script leaves behind in ssBrief - the headlines already    */
/* shown in the ticker, and the org's instance key - plus the public  */
/* Trust API, which needs no authentication at all.                   */
/* ---------------------------------------------------------------- */

const NUDGE_ALARM = 'ss-offhours-nudge';
const BRIEF_KEY = 'ssBrief';
const LAST_NUDGE_KEY = 'ssLastNudgeAt';
const NOTIFICATION_ID = 'ss-offhours';

/*
 * Local time, and deliberately generous at both ends: the aim is "they have
 * probably stopped for the day", not an attendance record. Weekends count as
 * off-hours all day.
 */
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

// How long since they last used it before a nudge is welcome rather than
// interrupting, and how long before another one is.
const IDLE_MS = 4 * 60 * 60 * 1000;
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

// Never in the small hours, whatever the other rules say. A notification at
// 3am is not a nudge, it is a nuisance.
const QUIET_START_HOUR = 22;
const QUIET_END_HOUR = 7;

function isOffHours(date) {
    const day = date.getDay();
    const hour = date.getHours();
    if (hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR) { return false; }
    if (day === 0 || day === 6) { return true; }
    return hour < WORK_START_HOUR || hour >= WORK_END_HOUR;
}

function storageGet(keys) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(keys, (stored) => {
                void chrome.runtime.lastError;
                resolve(stored || {});
            });
        } catch (e) {
            resolve({});
        }
    });
}

function storageSet(items) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.set(items, () => {
                void chrome.runtime.lastError;
                resolve();
            });
        } catch (e) {
            resolve();
        }
    });
}

// The org used most recently, since that is the one worth reporting on.
function mostRecentOrg(brief) {
    let best = null;
    for (const key of Object.keys(brief || {})) {
        const entry = brief[key];
        if (!entry) { continue; }
        if (!best || (entry.updatedAt || 0) > (best.updatedAt || 0)) {
            best = entry;
        }
    }
    return best;
}

/*
 * What the Trust API says about this instance right now.
 *
 * Public and CORS-open, so it works with no session - which is the whole
 * reason the platform half of this notification can be built here. Resolves
 * to null on any failure; a nudge that cannot say anything is simply not
 * sent.
 */
async function fetchTrust(entry) {
    const path = entry.instanceKey
        ? `instances/${encodeURIComponent(entry.instanceKey)}/status`
        : (entry.alias ? `instanceAliases/${encodeURIComponent(entry.alias)}/status` : null);
    if (!path) { return null; }
    try {
        const response = await fetch(`https://api.status.salesforce.com/v1/${path}`);
        if (!response.ok) { return null; }
        return await response.json();
    } catch (e) {
        return null;
    }
}

function trustLine(status) {
    if (!status) { return null; }
    const key = status.key || 'This instance';
    const incidents = (status.Incidents || []).length;
    const maintenances = (status.Maintenances || []).filter(
        (m) => !/complete/i.test((m && m.status) || '')).length;

    if (incidents) {
        return `${key}: ${incidents} open incident${incidents > 1 ? 's' : ''} on Salesforce Trust.`;
    }
    if (maintenances) {
        return `${key}: ${maintenances} maintenance window${maintenances > 1 ? 's' : ''} scheduled.`;
    }
    if (status.status && status.status !== 'OK') {
        return `${key}: ${status.status}.`;
    }
    return `${key} is healthy - no incidents reported today.`;
}

/*
 * The headlines from today that the user has actually asked to hear about.
 *
 * Each carries the category NewsService tagged it with - storage, api or
 * activity - and the settings panel turns those on and off individually.
 * A category switched off must not merely be hidden from the panel; it must
 * not be a reason to interrupt anyone.
 */
function orgLine(entry, prefs) {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = (entry.headlines || []).filter(function (h) {
        if (!h || !h.text || (h.timestamp || 0) < dayAgo) { return false; }
        return prefs[h.category || 'activity'] !== false;
    });
    return recent.length ? recent[0].text : null;
}

// Must agree with ssDefaultNotifyPrefs in ss-core: off until switched on.
// The worker cannot see that file, so the one thing it has to match is the
// master switch - a worker defaulting to true would keep sending after the
// page had stopped offering to.
const DEFAULT_PREFS = { enabled: false, trust: true, storage: true, api: true, activity: true };

async function readPrefs() {
    const stored = await storageGet('ssNotifyPrefs');
    return Object.assign({}, DEFAULT_PREFS, stored.ssNotifyPrefs || {});
}

/*
 * Builds the notification, or returns null when there is nothing the user
 * wants to be told. Shared with the test button so that what a test sends is
 * what a real nudge would have sent.
 */
async function composeNudge(entry, prefs) {
    const lines = [];
    if (prefs.trust !== false) {
        const line = trustLine(await fetchTrust(entry));
        if (line) { lines.push(line); }
    }
    const org = orgLine(entry, prefs);
    if (org) { lines.push(org); }
    return lines.length ? lines : null;
}

function showNudge(lines, entry) {
    return new Promise((resolve) => {
        try {
            chrome.notifications.create(NOTIFICATION_ID, {
                type: 'basic',
                iconUrl: chrome.runtime.getURL('/img/simplify.png'),
                title: 'Salesforce Simplified',
                message: lines.join('\n'),
                priority: 0
            }, () => { void chrome.runtime.lastError; resolve(true); });
        } catch (e) {
            resolve(false);
        }
    });
}

async function maybeNudge() {
    const now = new Date();
    if (!isOffHours(now)) { return; }

    const prefs = await readPrefs();
    if (prefs.enabled === false) { return; }

    const stored = await storageGet([BRIEF_KEY, LAST_NUDGE_KEY]);
    const lastNudge = stored[LAST_NUDGE_KEY] || 0;
    if (Date.now() - lastNudge < MIN_GAP_MS) { return; }

    const entry = mostRecentOrg(stored[BRIEF_KEY]);
    // Nothing has ever been recorded, so there is no org to report on and no
    // evidence this user has ever opened the extension.
    if (!entry) { return; }

    const lastActive = entry.lastActiveAt || entry.updatedAt || 0;
    if (Date.now() - lastActive < IDLE_MS) { return; }

    const lines = await composeNudge(entry, prefs);
    // Nothing to say. Saying it anyway is how a useful nudge becomes spam.
    if (!lines) { return; }

    await showNudge(lines, entry);
    await storageSet({ [LAST_NUDGE_KEY]: Date.now(), ssNudgeOrigin: entry.origin || null });
}

/*
 * The test from the settings panel.
 *
 * Goes through composeNudge and showNudge, so it proves the real path -
 * preferences honoured, permission granted, notification drawn. What it
 * deliberately skips is the timing: quiet hours, the idle threshold and the
 * daily cap all exist to stop unrequested interruptions, and this one was
 * requested. It does not touch the rate limit either, so testing does not
 * consume the evening's real nudge.
 */
async function sendTestNudge() {
    const prefs = await readPrefs();
    if (prefs.enabled === false) {
        return { ok: false, error: 'Notifications are turned off in settings.' };
    }
    const stored = await storageGet(BRIEF_KEY);
    const entry = mostRecentOrg(stored[BRIEF_KEY]);
    if (!entry) {
        return { ok: false, error: 'Nothing recorded for this org yet - open a panel first.' };
    }
    const lines = (await composeNudge(entry, prefs)) ||
        ['Nothing to report right now. This is what an alert would look like.'];
    const shown = await showNudge(lines, entry);
    if (!shown) {
        return { ok: false, error: 'Chrome refused to show the notification.' };
    }
    await storageSet({ ssNudgeOrigin: entry.origin || null });
    return { ok: true };
}

/*
 * Clicking the notification opens the panel.
 *
 * An existing tab on that org is reused and focused rather than a second one
 * opened next to it. When there is none - the likely case out of hours - a
 * tab is opened, and the content script is told once it has loaded, because
 * a message sent before then has nothing listening for it.
 */
chrome.notifications.onClicked.addListener(async function (id) {
    if (id !== NOTIFICATION_ID) { return; }
    try { chrome.notifications.clear(id, () => { void chrome.runtime.lastError; }); } catch (e) {}

    const stored = await storageGet(['ssNudgeOrigin']);
    const origin = stored.ssNudgeOrigin;
    if (!origin) { return; }

    chrome.tabs.query({ url: origin + '/*' }, function (tabs) {
        void chrome.runtime.lastError;
        const tab = tabs && tabs[0];
        if (tab && tab.id) {
            chrome.tabs.update(tab.id, { active: true }, function () {
                void chrome.runtime.lastError;
                chrome.tabs.sendMessage(tab.id, { type: 'SS_OPEN_PANEL' }, function () {
                    void chrome.runtime.lastError;
                });
            });
            if (tab.windowId != null) {
                chrome.windows.update(tab.windowId, { focused: true }, function () {
                    void chrome.runtime.lastError;
                });
            }
            return;
        }
        chrome.tabs.create({ url: origin }, function (created) {
            void chrome.runtime.lastError;
            if (!created || !created.id) { return; }
            const onReady = function (tabId, info) {
                if (tabId !== created.id || info.status !== 'complete') { return; }
                chrome.tabs.onUpdated.removeListener(onReady);
                chrome.tabs.sendMessage(created.id, { type: 'SS_OPEN_PANEL' }, function () {
                    void chrome.runtime.lastError;
                });
            };
            chrome.tabs.onUpdated.addListener(onReady);
        });
    });
});

function ensureNudgeAlarm() {
    try {
        chrome.alarms.create(NUDGE_ALARM, { periodInMinutes: 60 });
    } catch (e) {
        // Alarms unavailable; the nudge simply never fires.
    }
}

chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm && alarm.name === NUDGE_ALARM) {
        maybeNudge();
    }
    /*
     * The sync sweep. This is the fire the worker was killed for: a deploy
     * outlives the worker that started it, so the job carries the org's async
     * id and this picks the polling back up.
     */
    if (alarm && typeof SS_SYNC_ALARM !== 'undefined' && alarm.name === SS_SYNC_ALARM) {
        if (typeof ssSyncSweep === 'function') { ssSyncSweep(); }
    }
});

chrome.runtime.onStartup.addListener(ensureNudgeAlarm);
chrome.runtime.onInstalled.addListener(ensureNudgeAlarm);

/*
 * A browser restart in the middle of a deploy.
 *
 * Alarms do survive a restart, but a job left running by a browser that was
 * closed on it should not wait for the next tick to be looked at - and if the
 * alarm did not survive, this is what puts it back.
 */
function resumeSyncOnStartup() {
    if (typeof ssSyncSweep === 'function') { ssSyncSweep(); }
}
chrome.runtime.onStartup.addListener(resumeSyncOnStartup);
chrome.runtime.onInstalled.addListener(resumeSyncOnStartup);

/* ---------------------------------------------------------------- */
/* The standalone page                                                */
/*                                                                    */
/* simplified.html is a real extension page, not a panel injected     */
/* into an org. That buys it the whole viewport and costs it          */
/* everything a content script gets for free: it is not on a          */
/* Salesforce origin, so document.cookie holds no sid and there is    */
/* no org to infer from the address bar.                              */
/*                                                                    */
/* Both are answered from here. chrome.cookies can read the org's sid */
/* even when it is HttpOnly - which is exactly the case document      */
/* .cookie cannot see - and ssBrief already records every org the     */
/* user actually works in.                                            */
/* ---------------------------------------------------------------- */

const PAGE_URL = 'simplified.html';

/*
 * The page's own address, optionally pointed at one of its pages.
 *
 * ?type= is the standalone page's existing way of saying which page to open
 * on - it outranks the restored session there, because it is the only one of
 * those the user could have typed or linked to. Reused rather than invented:
 * a second mechanism would have to be kept in step with that one.
 *
 * Built from the tab's current address when there is one, so ?org= survives.
 * Rebuilding it from scratch would silently move an open page to a different
 * org, which is the last thing to do to somebody halfway through a deploy.
 */
function standalonePageUrl(openOn, currentUrl) {
    const base = chrome.runtime.getURL(PAGE_URL);
    if (!openOn) { return currentUrl || base; }
    let url;
    try {
        url = new URL(currentUrl || base);
    } catch (e) {
        url = new URL(base);
    }
    url.searchParams.set('type', openOn);
    return url.toString();
}

function openStandaloneTab(openOn) {
    return new Promise((resolve) => {
        const url = chrome.runtime.getURL(PAGE_URL);
        chrome.tabs.query({ url: url + '*' }, function (tabs) {
            void chrome.runtime.lastError;
            const existing = tabs && tabs[0];
            if (existing && existing.id) {
                /*
                 * Focus the tab that is already open rather than stacking up
                 * another - and when a page was asked for, move it there.
                 * Focusing a tab sitting on a different page and calling that
                 * "open Org Sync" leaves the user to navigate anyway, which
                 * is the whole thing this was asked to save them.
                 */
                const wanted = standalonePageUrl(openOn, existing.url);
                const update = { active: true };
                if (wanted && wanted !== existing.url) { update.url = wanted; }
                chrome.tabs.update(existing.id, update, function () {
                    void chrome.runtime.lastError;
                });
                if (existing.windowId != null) {
                    chrome.windows.update(existing.windowId, { focused: true }, function () {
                        void chrome.runtime.lastError;
                    });
                }
                return resolve();
            }
            chrome.tabs.create({ url: standalonePageUrl(openOn, null) }, function () {
                void chrome.runtime.lastError;
                resolve();
            });
        });
    });
}

chrome.action.onClicked.addListener(function () {
    openStandaloneTab();
});

/*
 * The orgs this browser has actually been used against, newest first.
 *
 * Taken from ssBrief rather than from history or open tabs: an org is in
 * there because the user opened this extension on it, which is a much better
 * definition of "an org you work in" than anything that could be guessed.
 */
/*
 * One row per org, whatever the store has accumulated.
 *
 * ssBrief is keyed by ssOrgKey, which folds every host of an org onto one
 * key - but only for entries written by a version that had it. Older ones,
 * and any written when the host was not recognised (ssUpdateBrief falls back
 * to the full origin as its key), sit alongside as separate entries that
 * nothing ever removes. The picker showed the result: the same org listed
 * two and three times, sometimes the very same host twice.
 *
 * Deduplicating here rather than pruning the store keeps this a read: a
 * migration that deletes entries has to be right the first time, and there is
 * nothing in them worth the risk of being wrong.
 */
const ORG_HOST_SUFFIX =
    /\.(?:lightning\.force\.com|my\.salesforce-setup\.com|my\.salesforce\.com|vf\.force\.com|visual\.force\.com)$/;

// The same fold ssOrgKey performs in ss-core.js, which the service worker
// does not import. Kept deliberately narrow: it only has to group hosts that
// belong to one org, not to be the authority on what an org key is.
function orgIdentity(origin) {
    let host;
    try {
        host = new URL(origin).hostname.toLowerCase();
    } catch (e) {
        return String(origin || '').toLowerCase();
    }
    if (!ORG_HOST_SUFFIX.test(host)) { return host; }
    const key = host.replace(ORG_HOST_SUFFIX, '');
    // Visualforce appends the package namespace to the first label.
    const labels = key.split('.');
    labels[0] = labels[0].replace(/--[^-]*$/, '');
    return labels.join('.');
}

// The my-domain host is the one the REST and SOAP APIs are served from, so
// when an org has been seen on several it is the one worth keeping.
function preferredOrigin(a, b) {
    const isMyDomain = (o) => /\.my\.salesforce\.com$/.test(String(o || ''));
    if (isMyDomain(a.origin) !== isMyDomain(b.origin)) {
        return isMyDomain(a.origin) ? a : b;
    }
    return (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
}

async function knownOrgs() {
    const stored = await storageGet(BRIEF_KEY);
    const brief = stored[BRIEF_KEY] || {};

    const byOrg = new Map();
    Object.keys(brief).forEach((key) => {
        const origin = brief[key].origin || null;
        if (!origin) { return; }

        /*
         * Only real orgs are offered. Earlier versions recorded the browsing
         * page's origin rather than the org's, so a brief written from
         * simplified.html stored chrome-extension://... - and the picker then
         * listed the extension itself as an org to switch to. Filtering on
         * read clears those out without a migration that has to be right the
         * first time.
         */
        let host;
        try { host = new URL(origin).hostname.toLowerCase(); } catch (e) { return; }
        if (!ORG_HOST_SUFFIX.test(host)) { return; }

        const entry = {
            key: key,
            origin: origin,
            instanceKey: brief[key].instanceKey || null,
            updatedAt: brief[key].updatedAt || 0
        };

        const id = orgIdentity(origin);
        const seen = byOrg.get(id);
        if (!seen) { byOrg.set(id, entry); return; }

        const winner = preferredOrigin(seen, entry);
        // An instance key from either entry is worth keeping - the losing row
        // may be the only one that ever resolved it.
        winner.instanceKey = winner.instanceKey || seen.instanceKey || entry.instanceKey;
        winner.updatedAt = Math.max(seen.updatedAt, entry.updatedAt);
        byOrg.set(id, winner);
    });

    return Array.from(byOrg.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/*
 * The org's session cookie.
 *
 * Only ever for a Salesforce host this extension already holds permission
 * for. The page asks for an origin and gets a bearer token back, so a relay
 * that read any cookie it was asked for would be a way to lift a session off
 * any site the user is signed in to.
 */
function readOrgSession(origin) {
    return new Promise((resolve) => {
        let host;
        try {
            host = new URL(origin).hostname.toLowerCase();
        } catch (e) {
            return resolve(null);
        }
        if (!/(^|\.)(my\.salesforce\.com|lightning\.force\.com|my\.salesforce-setup\.com|vf\.force\.com|visual\.force\.com)$/.test(host)) {
            return resolve(null);
        }
        try {
            /*
             * getAll and the engine's picker, for the reason documented on
             * ssSyncPickCookie: chrome.cookies.get settles a tie by path and
             * then creation time, never by how specific the domain is, so a
             * sid set on login.salesforce.com can be returned for any org
             * beneath it.
             *
             * It matters more here than anywhere. This answer is what says
             * whether an org is signed in, so borrowing another org's cookie
             * reports a dead org as live - and the first thing that happens
             * afterwards is a job failing on a session that was never that
             * org's to begin with.
             */
            chrome.cookies.getAll({ url: origin, name: 'sid' }, function (cookies) {
                void chrome.runtime.lastError;
                const cookie = (typeof ssSyncPickCookie === 'function')
                    ? ssSyncPickCookie(cookies, host)
                    : (cookies || [])[0];
                resolve(cookie && cookie.value ? cookie.value : null);
            });
        } catch (e) {
            resolve(null);
        }
    });
}
