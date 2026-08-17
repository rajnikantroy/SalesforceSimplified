/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Salesforce Simplified - shared core.
 *
 * Everything here is framework-agnostic and used from both the Angular layer
 * and the plain-jQuery bootstrap in index.js. Loaded second (after jQuery,
 * before Angular) so every later script can rely on it.
 *
 * Centralises what used to be copied around the codebase:
 *   - the org origin, previously hardcoded as "https://"+window.location.host
 *     in 85 places across three files
 *   - the REST base URL and its API version
 *   - cookie access
 *   - SOQL literal escaping
 */

/* ---------------------------------------------------------------- */
/* Where we are                                                      */
/*                                                                   */
/* Declared first, ahead of everything that reads them. Function     */
/* declarations hoist but `var` initialisers do not, and the session */
/* restore below runs from a chrome.storage callback - which is only */
/* async by grace of the real API. Anything that fired it earlier    */
/* found these undefined, threw, and had the throw swallowed by the  */
/* "no storage permission" catch.                                    */
/* ---------------------------------------------------------------- */

// window.location.origin rather than a hardcoded "https://" + host: same
// result on a real org, and correct rather than accidental everywhere else.
//
// Reassignable, for the standalone page only. simplified.html is served from
// chrome-extension://, so the address bar says nothing about which org the
// user means - it is chosen there and written here before the first request,
// which is why nothing captures this value at load time. See ssAdoptOrg.
var SS_ORIGIN = window.location.origin;

/*
 * Whether this is simplified.html rather than an injected panel.
 *
 * The difference is not cosmetic: on an org page the session and the org are
 * both implicit in where the code is running, and on the standalone page
 * neither is. Everything that has to behave differently keys off this.
 */
function ssIsStandalonePage() {
    if (typeof window === 'undefined' || !window.location) {
        return false;
    }
    // Identified by which page it is, not only by the scheme it arrived on.
    // chrome-extension: is what ships, but keying solely on that makes the
    // page impossible to open any other way - including from a test harness,
    // which is the one place its startup can actually be exercised.
    return window.location.protocol === 'chrome-extension:' ||
           String(window.location.pathname || '').indexOf('simplified.html') !== -1;
}

/*
 * Point this session at an org, on the standalone page.
 *
 * Sets the origin every later request resolves against, and the session those
 * requests carry. The sid arrives from the service worker, which can read it
 * with chrome.cookies even when the org has marked it HttpOnly - the case
 * document.cookie cannot see, and the reason the panel needs a Connected App
 * on those orgs but this page does not.
 */
function ssAdoptOrg(origin, sid) {
    if (origin) {
        SS_ORIGIN = origin;
    }
    SS_AUTH.cookieSession = sid || null;
}

// Classic and Setup are served from my.salesforce.com, Lightning from
// lightning.force.com, Lightning Setup from my.salesforce-setup.com, and
// Visualforce from vf.force.com (visual.force.com before Enhanced Domains).
// Sandboxes, scratch and developer orgs are subdomains of these, so they
// match without needing their own entries.
var SS_ORG_HOSTS = /(?:^|\.)(?:my\.salesforce\.com|lightning\.force\.com|my\.salesforce-setup\.com|vf\.force\.com|visual\.force\.com)$/i;

/* ---------------------------------------------------------------- */
/* Cookies                                                           */
/* ---------------------------------------------------------------- */

/*
 * An in-memory mirror of everything written through setCookie.
 *
 * document.cookie is not guaranteed to work everywhere this code now runs.
 * On an org page it is the real store and this mirror is redundant. On
 * simplified.html the page has its own origin, and a write that silently
 * does nothing would take the current user id with it - which does not fail
 * loudly, it just makes every user-scoped query read
 * `WHERE LastModifiedById = ''` and come back empty.
 *
 * Writes go to both; reads prefer the real cookie and fall back to here. So
 * the mirror never overrides the browser, and never leaves a value that was
 * set during this page load unreadable.
 */
var _cookieMirror = Object.create(null);

function setCookie(cname, cvalue, exdays) {
    _cookieMirror[cname] = String(cvalue);
    try {
        var d = new Date();
        d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
        document.cookie = cname + "=" + cvalue + ";expires=" + d.toUTCString() + ";path=/";
    } catch (e) {
        // No cookie store on this origin; the mirror is the store.
    }
}

// readCookie runs on every query, every error path and every menu open. On a
// Salesforce page document.cookie is long, so re-splitting it each time added
// up. The parse is cached against the raw string, which self-invalidates the
// moment any cookie changes.
var _cookieRaw = null;
var _cookieMap = null;
function readCookie(name) {
    var raw = document.cookie;
    if (raw !== _cookieRaw) {
        _cookieRaw = raw;
        _cookieMap = Object.create(null);
        var parts = raw.split(';');
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            var eq = part.indexOf('=');
            if (eq < 0) { continue; }
            var key = part.slice(0, eq).trim();
            // First occurrence wins, matching the original implementation.
            if (!(key in _cookieMap)) {
                _cookieMap[key] = part.slice(eq + 1);
            }
        }
    }
    if (name in _cookieMap) {
        return _cookieMap[name];
    }
    return name in _cookieMirror ? _cookieMirror[name] : null;
}

/* ---------------------------------------------------------------- */
/* Session: sid cookie, falling back to a Connected App token        */
/*                                                                   */
/* When an org enables "Lock sessions to the domain in which they    */
/* were first used" or sets the HttpOnly attribute on the session    */
/* cookie (Setup > Session Settings), document.cookie no longer      */
/* exposes sid and every REST call fails. In that case the user can  */
/* sign in through a Connected App; the OAuth access token is a      */
/* bearer token for the same REST API, so it drops straight into     */
/* ssSessionId() and nothing downstream has to know the difference.  */
/* ---------------------------------------------------------------- */

// Default Connected App Consumer Key for fixed OAuth login flow.
var SS_CONNECTED_APP_CLIENT_ID = '3MVG9YFqzc_KnL.z234.XuWZci8mINz0xN95XM2cWYDyM9tKz89Cpkrd0lx2ocyFtExySOfAwoCB48OU0T1pG';

/*
 * Installing the Connected App into an org that does not have it.
 *
 * The extension cannot create one during sign-in: creating a Connected App
 * is a Metadata API call, which needs a session, and at that point there is
 * no session - which is the whole reason it is asking the user to sign in.
 * What it can do is hand the admin a one-click install of an app that has
 * already been built, which is what packaging is for.
 *
 * Set this to the 04t package id of a package containing the Connected App,
 * and the sign-in overlay offers "Install it in this org" ahead of the
 * manual steps. Left empty, that offer is simply not shown - an install link
 * pointing at nothing would be worse than no link at all.
 *
 * It has to be a *managed* package. A managed package carries the Connected
 * App's Consumer Key into every org that installs it, which is the whole
 * point here: SS_CONNECTED_APP_CLIENT_ID above has to keep matching after
 * the install. Copy the app into an org any other way - an unmanaged
 * package, or by hand - and that org's copy is a new app with a new key, so
 * the shipped key still will not work and the user is back to pasting one.
 */
var SS_CONNECTED_APP_PACKAGE_ID = '';

/*
 * Where to start the sign-in.
 *
 * The flow guesses from the page it is running on, which is right almost
 * always and wrong in the cases people actually get stuck on: an org reached
 * through a login host rather than its my-domain, a sandbox whose host does
 * not say so, or signing in to a different org from the one being browsed.
 * Rather than improve the guess, let it be stated.
 *
 * "This org" stays the default and resolves the same way SOAP does, since
 * the OAuth endpoints live on the same my-domain host.
 */
var SS_LOGIN_TARGETS = {
    production: 'https://login.salesforce.com',
    sandbox:    'https://test.salesforce.com'
};

function ssCustomLoginOrigin(value) {
    var raw = String(value || '').trim();
    if (!raw) {
        return { error: 'Enter the login URL of the org you want to sign in to.' };
    }
    // Typing a bare host is the common case, so a missing scheme is filled
    // in rather than rejected.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        raw = 'https://' + raw;
    }
    var url;
    try {
        url = new URL(raw);
    } catch (e) {
        return { error: 'That is not a URL. It should look like https://your-domain.my.salesforce.com' };
    }
    if (url.protocol !== 'https:') {
        return { error: 'The login URL has to be https.' };
    }
    // Only Salesforce: this URL is where a session gets established, so it
    // is not somewhere to be talked into sending someone.
    if (!/(^|\.)(salesforce\.com|force\.com)$/i.test(url.hostname.toLowerCase())) {
        return { error: 'That is not a Salesforce login host. Use your my-domain, or Production or Sandbox above.' };
    }
    return { origin: url.origin };
}

function ssLoginOrigin(target, customUrl) {
    if (SS_LOGIN_TARGETS[target]) {
        return { origin: SS_LOGIN_TARGETS[target] };
    }
    if (target === 'custom') {
        return ssCustomLoginOrigin(customUrl);
    }
    return { origin: ssSoapOrigin() };
}

/*
 * The install link, or nothing.
 *
 * installPackage.apexp takes a package *version* id - the 04t Salesforce
 * hands back after an upload. The Connected App's own record id is a
 * different thing entirely and is the easy mistake to make, since it is the
 * id sitting in the address bar while you look at the app. Given one, the
 * link would render, be clicked, and land on an error inside Setup - so the
 * shape is checked and anything else is treated as not configured.
 */
function ssAppInstallUrl() {
    var id = String(SS_CONNECTED_APP_PACKAGE_ID || '').trim();
    if (!/^04t[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/.test(id)) {
        return '';
    }
    return ssOrgUrl('/packaging/installPackage.apexp?p0=' + encodeURIComponent(id));
}

var SS_AUTH = { accessToken: null, instanceUrl: null, cookieSession: null,
                pastedSession: null, pastedInstanceUrl: null,
                clientId: SS_CONNECTED_APP_CLIENT_ID };

/*
 * The one host test a user-supplied instance URL has to pass.
 *
 * A session id is a bearer credential: whoever holds it is that user, with
 * that user's API access, until it expires. So the URL it gets sent to is not
 * a convenience field - it is the whole of the security boundary. Someone
 * following instructions from a phishing page ("paste your session id and
 * this URL to fix your org") would otherwise hand their org to whoever wrote
 * the page.
 *
 * Same list the service worker already enforces in readOrgSession, kept
 * identical on purpose: two host tests that drift apart are worse than one.
 */
var SS_SALESFORCE_HOST =
    /(^|\.)(my\.salesforce\.com|lightning\.force\.com|my\.salesforce-setup\.com|vf\.force\.com|visual\.force\.com)$/;

function ssIsSalesforceUrl(url) {
    try {
        var parsed = new URL(String(url || '').trim());
        // http would put the session on the wire in clear text.
        if (parsed.protocol !== 'https:') { return false; }
        return SS_SALESFORCE_HOST.test(parsed.hostname.toLowerCase());
    } catch (e) {
        return false;
    }
}

/*
 * A session id, typed in by the user.
 *
 * The reason to offer this at all: a Connected App needs permissions plenty
 * of users do not have, and the sid readable on a Lightning host is not a
 * valid API session - so for some orgs there is no other way in. Workbench
 * and the SFDX access-token flow work the same way.
 *
 * Where it is kept matters more than how it is used. chrome.storage.session
 * is memory-backed: it never reaches disk and is gone when the browser
 * closes, which is the right lifetime for a bearer credential. Where that is
 * not reachable - a content script, which cannot read session storage unless
 * the whole area is opened up to untrusted contexts - it stays in memory for
 * that page only. Neither path ever writes it to chrome.storage.local, where
 * the OAuth token lives, because that is on disk and survives restarts.
 */
function ssSignInWithSessionId(sessionId, instanceUrl) {
    var sid = String(sessionId || '').trim();
    var url = String(instanceUrl || '').trim().replace(/\/+$/, '');

    if (!sid) {
        return Promise.reject(new Error('Enter the session id.'));
    }
    if (!ssIsSalesforceUrl(url)) {
        return Promise.reject(new Error(
            'Enter your org URL, for example https://yourdomain.my.salesforce.com - ' +
            'a session id is only ever sent to your own Salesforce org.'));
    }

    // An alternative way in, not an additional one. Leaving a stale OAuth
    // token alongside it would make which session is in use depend on the
    // order of a chain nobody can see.
    SS_AUTH.accessToken = null;
    SS_AUTH.instanceUrl = null;
    SS_AUTH.pastedSession = sid;
    SS_AUTH.pastedInstanceUrl = url;
    SS_SESSION_EXPIRED = false;

    return new Promise(function (resolve) {
        try {
            chrome.storage.session.set({ ssPastedSession: { sid: sid, instanceUrl: url } },
                function () { resolve(SS_AUTH); });
        } catch (e) {
            // Memory only for this page. The sign-in still works; it just does
            // not outlive the tab.
            resolve(SS_AUTH);
        }
    });
}

function ssForgetSessionId() {
    SS_AUTH.pastedSession = null;
    SS_AUTH.pastedInstanceUrl = null;
    try {
        chrome.storage.session.remove('ssPastedSession');
    } catch (e) { /* nothing stored */ }
}

// chrome.storage is async, but ssSessionId() is called synchronously from
// everywhere. Load once into SS_AUTH and let callers await ssAuthReady()
// before their first request.
/*
 * Resolves the standalone page's org and session before anything queries.
 *
 * ssSessionId() is synchronous and read from everywhere, but a cookie lives
 * in the service worker and arrives asynchronously. Rather than make every
 * caller await something new, the wait is folded into ssAuthReady() - which
 * SfdcApi, SchemaService and the controller already await before their first
 * request. By the time any of them run, SS_ORIGIN and the session are set.
 */
/*
 * How long to wait for the worker before starting without an org.
 *
 * Generous - waking a service worker and reading a cookie is not instant -
 * but finite, because the alternative is a page that never finishes starting
 * and never says so.
 */
var SS_PAGE_SESSION_TIMEOUT_MS = 8000;

function ssResolveStandaloneOrg() {
    if (!ssIsStandalonePage()) {
        return Promise.resolve(null);
    }
    // A chosen org travels in the URL, so switching org is a navigation and
    // the choice survives a reload and a bookmark.
    var wanted = null;
    try {
        wanted = new URLSearchParams(window.location.search).get('org');
    } catch (e) {
        wanted = null;
    }

    /*
     * This promise must settle, whatever happens inside it.
     *
     * ssAuthReady() waits on it, and the panel's whole startup waits on
     * ssAuthReady() - reading the client id, checking the watch list, and
     * refreshSessionState(), which is the only thing that ever turns
     * hasSession off. hasSession starts optimistically true so the sign-in
     * overlay does not flash while storage is read, so a chain that never
     * settles leaves the panel permanently believing in a session it has
     * not got: no overlay, no error, nothing at all.
     *
     * That is not hypothetical. Two paths below reached resolve() only on
     * success - a rejected identity lookup, and a worker that never called
     * the callback back - and both produce a pending promise rather than a
     * failed one, which nothing anywhere is watching for.
     */
    return new Promise(function (resolve) {
        /*
         * Cancel the deadline and answer, in one place.
         *
         * There is no guard against settling twice because a promise already
         * is one: resolve() after the first call is specified to do nothing.
         * A flag here would read as protection and provide none - and having
         * every exit go through this instead means the timer cannot be left
         * armed by an exit that forgot to clear it, which is a mistake worth
         * making impossible rather than watching for.
         */
        function settle(value) {
            clearTimeout(giveUp);
            resolve(value);
        }

        /*
         * A worker that never answers.
         *
         * Chrome stops the background worker when idle and starts it again
         * on the next message; if it goes away mid-flight the callback is
         * never called at all, and there is no error to catch. Waiting
         * forever is the worst of the available outcomes - the page is
         * usable without an org, and signing in is exactly what it should be
         * offering at that point.
         */
        var giveUp = setTimeout(function () { settle(null); }, SS_PAGE_SESSION_TIMEOUT_MS);

        try {
            chrome.runtime.sendMessage({ type: 'SS_PAGE_SESSION', origin: wanted }, function (response) {
                void chrome.runtime.lastError;

                if (response && response.origin) {
                    ssAdoptOrg(response.origin, response.sid);
                    ssNoteOrgUse();
                    // Now that the org is known, anything restored from
                    // storage that belongs to a different one has to go.
                    ssDropForeignCredentials();
                }
                // The org knows who this is; nothing on this page does.
                // Failing to find out is not a reason to stop: the session
                // is already adopted, and a name is the least of what this
                // page needs.
                ssResolveUserFromIdentity().then(function () {
                    settle(response || null);
                }, function () {
                    settle(response || null);
                });
            });
        } catch (e) {
            settle(null);
        }
    });
}

/*
 * Who the user is, asked of the org.
 *
 * Everywhere else this comes from the `uid` cookie, which Salesforce sets on
 * the org's own domain and index.js tops up. simplified.html is served from
 * chrome-extension://, so document.cookie there is the page's own jar and
 * holds no uid at all - which does not fail loudly. It makes every
 * user-scoped query read `WHERE LastModifiedById = ''`, so "your" Apex
 * classes, triggers and everything else come back empty while the org-wide
 * lists next to them are full.
 *
 * /services/oauth2/userinfo answers for whatever session is presented, needs
 * no Chatter and no extra permission, and works with a sid as the bearer.
 * The answer is written to the cookie the rest of the code already reads, so
 * nothing downstream needs to know where it came from.
 *
 * A failure here is not fatal: the org-wide lists still work, and the
 * user-scoped ones stay as empty as they already were.
 */
function ssResolveUserFromIdentity() {
    var sid = ssSessionId();
    if (!sid || !SS_ORIGIN || SS_ORIGIN.indexOf('chrome-extension:') === 0) {
        return Promise.resolve(null);
    }
    return fetch(SS_ORIGIN + '/services/oauth2/userinfo', {
        headers: { 'Authorization': 'Bearer ' + sid }
    }).then(function (response) {
        return response.ok ? response.json() : null;
    }).then(function (info) {
        if (!info || !info.user_id) { return null; }
        var hasSelectedOverride = readCookie('ss_selected_uid') || (function(){ try { return localStorage.getItem('ss_selected_uid'); }catch(e){ return null; } })();
        if (!hasSelectedOverride) {
            setCookie('uid', info.user_id, 365);
            if (info.name) { setCookie('SFDCSimplified_uname', info.name, 365); }
        }
        return info;
    }).catch(function () {
        return null;
    });
}

var _ssUserReady = null;

/*
 * The uid, however it has to be found, asked at most once.
 *
 * __getUserId in index.js looks in four places before giving up: the chosen
 * user, the uid cookie, UserContext, SFDCSessionVars, then the disco cookie.
 * On an org page the middle two can never answer - they are page globals and
 * the content script runs in an isolated world, so it sees its own empty
 * window object, not the app's. That leaves disco, which Salesforce has not
 * written yet on a session that was just created.
 *
 * So the first visit after a login had no uid, and every user-scoped query
 * ran as `WHERE LastModifiedById = ''`: an empty "your Apex classes" beside a
 * full org-wide list, which reads as an empty org rather than as a bug.
 *
 * The org itself always knows. This waits for auth to settle - the session
 * may be arriving from the background rather than from document.cookie - and
 * then asks. Resolves to the id, or null if it could not be established;
 * it never rejects, because a caller that cannot name the user still has a
 * working panel to draw.
 */
function ssUserReady() {
    if (_ssUserReady) { return _ssUserReady; }
    _ssUserReady = Promise.resolve()
        .then(function () {
            var known = readCookie('ss_selected_uid') || readCookie('uid');
            if (known) { return known; }
            return Promise.resolve(ssAuthReady())
                .then(ssResolveUserFromIdentity)
                .then(function (info) {
                    return (info && info.user_id) || readCookie('uid') || null;
                });
        })
        .catch(function () { return null; });
    return _ssUserReady;
}

var SS_PAGE_CONTEXT = null;

var _ssAuthReady = (function () {
    return new Promise(function (resolve) {
        try {
            chrome.storage.local.get(['ssAuthOrgs', 'ssAuth', 'ssClientId'], function (stored) {
                /*
                 * Every token, and the one that belongs here.
                 *
                 * There used to be a single record, so signing in to a second
                 * org overwrote the first and coming back to it meant signing
                 * in again. They are kept per org now; the rule for which one
                 * belongs to this page has not changed, it just has more than
                 * one candidate to apply to.
                 *
                 * The old single record is still read, for a browser that has
                 * not written the map yet.
                 */
                var candidates = [];
                var byOrg = (stored && stored.ssAuthOrgs) || {};
                Object.keys(byOrg).forEach(function (slot) {
                    if (byOrg[slot]) { candidates.push(byOrg[slot]); }
                });
                if (stored && stored.ssAuth) { candidates.push(stored.ssAuth); }

                var saved = null;
                for (var i = 0; i < candidates.length; i += 1) {
                    // chrome.storage is per-extension, not per-org: a token
                    // minted in org A is still sitting there when the user
                    // opens org B. Adopting it there would send org A's bearer
                    // token to org A's instance and quietly show org A's
                    // metadata on org B's page.
                    if (ssTokenBelongsToThisOrg(candidates[i])) {
                        saved = candidates[i];
                        break;
                    }
                }

                if (saved) {
                    SS_AUTH.accessToken = saved.accessToken || null;
                    SS_AUTH.instanceUrl = saved.instanceUrl || null;
                }
                var savedClientId = stored && stored.ssClientId;
                var isLegacyClientId = savedClientId === '3MVG98X4B6M86BZ7.gK_4703X_SalesforceSimplified' ||
                    savedClientId === '3MVG9YFqzc_KnL.z234.XuWZciyqLi14sFEYwcQatDVV3DUE0OvMw_spEMBUOJBRbY9Wr04MD6tzukUsvuR.w' ||
                    savedClientId === '3MVG9YFqzc_KnL.z234.XuWZci8I2sjg.JDiWz9mHvMvXopXNYwgcevGYbUXa_F.6z4lnha2aI7Bp4GpP2OW2' ||
                    savedClientId === '3MVG9YFqzc_KnL.z234.XuWZci5CDezOF3aiuk8pX5nIhmv_0IgSJa4mj6zoQv3XwIqlqRR3YOTUwEKC4rgfk';
                if (savedClientId && !isLegacyClientId) {
                    SS_AUTH.clientId = savedClientId;
                } else {
                    SS_AUTH.clientId = SS_CONNECTED_APP_CLIENT_ID;
                }
                /*
                 * A typed-in session, if there is one. It lives in
                 * chrome.storage.session, so it is gone when the browser
                 * closes and never existed on disk - unreachable from a
                 * content script, which simply means no session to restore
                 * there rather than an error.
                 */
                var restoreTyped = new Promise(function (done) {
                    try {
                        chrome.storage.session.get(['ssPastedSession'], function (bag) {
                            var typed = bag && bag.ssPastedSession;
                            if (typed && typed.sid && ssIsSalesforceUrl(typed.instanceUrl)) {
                                SS_AUTH.pastedSession = typed.sid;
                                SS_AUTH.pastedInstanceUrl = typed.instanceUrl;
                            }
                            done();
                        });
                    } catch (e) {
                        done();
                    }
                });

                // On an org page this resolves immediately to null and
                // changes nothing.
                /*
                 * Both outcomes resolve. Everything downstream of this is
                 * gated on it, so a rejection here would hang the panel
                 * rather than degrade it - and there is nothing in the org
                 * lookup that the page cannot start without.
                 */
                restoreTyped.then(function () {
                    return ssResolveStandaloneOrg();
                }).then(function (context) {
                    SS_PAGE_CONTEXT = context;
                    resolve(SS_AUTH);
                }, function () {
                    SS_PAGE_CONTEXT = null;
                    resolve(SS_AUTH);
                });
            });
        } catch (e) {
            // No storage permission / not an extension context (test harness).
            resolve(SS_AUTH);
        }
    });
})();

function ssAuthReady() {
    return _ssAuthReady;
}

// When the org rejects the token we are using (HTTP 401 / INVALID_SESSION_ID),
// the session it belonged to is gone even if the sid cookie is still present.
// Remember that locally so the UI can flip back to the sign-in overlay instead
// of re-issuing requests against a dead session.
var SS_SESSION_EXPIRED = false;

// The Connected App token wins over the cookie: the only reason a token
// exists is that the user signed in explicitly, and the only reason to do
// that is that the sid cookie was missing or not accepted by the REST API
// (the sid readable on a Lightning host is not a valid API session).
/*
 * cookieSession sits between the two on purpose.
 *
 * It is the org's own sid, fetched through chrome.cookies for the standalone
 * page, so it ranks with readCookie('sid') rather than above it - a token the
 * user explicitly signed in for still wins. On an org page it is always null
 * and this reads exactly as it did before.
 */
function ssSessionId() {
    if (SS_SESSION_EXPIRED) { return null; }
    /*
     * A typed-in session ranks with the OAuth token rather than with the
     * cookies: both are things the user did on purpose, and the only reason
     * to type one in is that the cookies were not working.
     */
    return SS_AUTH.accessToken || SS_AUTH.pastedSession ||
           readCookie('sid') || SS_AUTH.cookieSession || null;
}

function ssHasSession() {
    return !SS_SESSION_EXPIRED && !!ssSessionId();
}

/*
 * Raise the panel's sign-in card, from outside the panel.
 *
 * The record-page and list-page modules are plain content scripts with no
 * Angular of their own, and both have a button that needs a session. Without
 * this they can only fail after the click - the modal opens, queries, and
 * shows a refusal that says nothing about signing in.
 *
 * The card itself already exists and already knows every way in: OAuth, a
 * typed-in session, a chosen org. Building a second one would be a second
 * thing to keep correct, so this reaches the one that is there.
 *
 * Two steps, and both are needed. The overlay lives inside the panel, which is
 * display:none until the panel is opened, so showing it is not enough on its
 * own - and requestSignIn is what makes it appear over a page that already has
 * a session for a different org.
 *
 * The reason travels with it. The card titles itself from that: raised from
 * the org picker it says "Add another org", raised from here it says which org
 * needs signing in to - and a signed-out user clicking Export was being told
 * they were adding another org.
 *
 * Returns false when it could not, so the caller can fall back to whatever it
 * would have done rather than swallow the click.
 */
/*
 * One REST call, answered whole.
 *
 * The modules' own apiFetch parses the body and rejects on anything that is
 * not 2xx, which is right for them: they want the record or the error. The
 * REST Explorer wants neither - it wants what the org actually said, status
 * and body together, because a 404 with a message in it is the answer to the
 * question that was asked.
 *
 * So this rejects only when the request could not be made at all.
 */
/* ---------------------------------------------------------------- */
/* What this extension has been used for                             */
/*                                                                   */
/* Counted here rather than in each feature's own storage: the panel  */
/* is Angular on one page, the record and list modules are plain      */
/* scripts on another, and localStorage is per-origin - so the        */
/* standalone page and the org page would each keep half the tally.   */
/* chrome.storage.local is the one store all three share.             */
/*                                                                   */
/* Nothing here leaves the browser. It is a tally of what the user    */
/* has done with the extension, for the user.                        */
/* ---------------------------------------------------------------- */

var SS_USAGE_KEY = 'ssFeatureUse';

function ssCountUse(key, amount) {
    if (!key) { return Promise.resolve(null); }
    var by = typeof amount === 'number' ? amount : 1;
    /*
     * Nothing did not happen. Without this an export of no rows writes
     * recordsExported: 0 - a counter that has never counted anything, which
     * the page then has to decide whether to show.
     */
    if (!by) { return Promise.resolve(null); }

    return new Promise(function (settle) {
        try {
            chrome.storage.local.get(SS_USAGE_KEY, function (stored) {
                void chrome.runtime.lastError;
                var counts = (stored && stored[SS_USAGE_KEY]) || {};
                counts[key] = (Number(counts[key]) || 0) + by;

                var write = {};
                write[SS_USAGE_KEY] = counts;
                chrome.storage.local.set(write, function () {
                    void chrome.runtime.lastError;
                    settle(counts);
                });
            });
        } catch (e) {
            // No storage here (a test harness, or a page without the
            // permission). A tally is not worth failing a feature over.
            settle(null);
        }
    });
}

/*
 * A short, one-way fingerprint of an org key.
 *
 * Counting distinct orgs means remembering which ones have been seen. Storing
 * the keys themselves would be a list of somebody's clients sitting in browser
 * storage - so what is kept is a digest that answers "have I seen this one"
 * and nothing else. FNV-1a: small, deterministic, and not reversible into a
 * domain name.
 */
function ssOrgFingerprint(key) {
    var hash = 0x811c9dc5;
    var text = String(key || '');
    for (var i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        // The FNV prime, by shifts - a plain multiply overflows into a float
        // and stops being the same hash on the next value.
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        hash = hash >>> 0;
    }
    return hash.toString(16);
}

/*
 * Which orgs, as a count rather than a list.
 *
 * The number is the interesting part - "you have used this in four orgs" -
 * and the fingerprint above is what makes counting them possible without
 * keeping a record of who they are.
 */
function ssNoteOrgUse() {
    var key = ssOrgKey(ssHostOf(SS_ORIGIN));
    if (!key) { return Promise.resolve(null); }
    var mark = ssOrgFingerprint(key);

    return new Promise(function (settle) {
        try {
            chrome.storage.local.get(SS_USAGE_KEY, function (stored) {
                void chrome.runtime.lastError;
                var counts = (stored && stored[SS_USAGE_KEY]) || {};
                var seen = counts.orgsSeen || {};
                if (seen[mark]) { return settle(counts); }

                seen[mark] = 1;
                counts.orgsSeen = seen;
                counts.orgs = Object.keys(seen).length;

                var write = {};
                write[SS_USAGE_KEY] = counts;
                chrome.storage.local.set(write, function () {
                    void chrome.runtime.lastError;
                    settle(counts);
                });
            });
        } catch (e) {
            settle(null);
        }
    });
}

function ssUsageCounts() {
    return new Promise(function (settle) {
        try {
            chrome.storage.local.get(SS_USAGE_KEY, function (stored) {
                void chrome.runtime.lastError;
                settle((stored && stored[SS_USAGE_KEY]) || {});
            });
        } catch (e) {
            settle({});
        }
    });
}

function ssRestCall(spec) {
    var request = spec || {};
    var sid = ssSessionId();

    return new Promise(function (resolve, reject) {
        try {
            chrome.runtime.sendMessage({
                type: 'SS_REST_REQUEST',
                url: request.url,
                method: request.method || 'GET',
                body: request.body || null,
                sid: sid
            }, function (response) {
                var failure = chrome.runtime.lastError;
                if (failure) {
                    return reject(new Error(
                        'The extension could not reach its background worker (' +
                        failure.message + '). Reload the extension on ' +
                        'chrome://extensions, then reload this page.'));
                }
                if (!response) {
                    return reject(new Error('The extension could not reach the org.'));
                }
                // status 0 is the relay saying the request never left - a
                // refused host, or a network that did not answer.
                if (!response.status && response.error) {
                    return reject(new Error(response.error));
                }
                resolve(response);
            });
        } catch (e) {
            reject(new Error((e && e.message) || 'The request could not be sent.'));
        }
    });
}

function ssOpenSignIn() {
    var panel = document.getElementById('SimplifiedMainModal');
    if (!panel) { return false; }

    try {
        var scope = angular.element(panel).scope();
        if (!scope || typeof scope.requestSignIn !== 'function') { return false; }

        /*
         * The rail as well as the modal.
         *
         * SimplifiedMainModal lives inside #mySidenav, which is 0 wide and
         * clipping until the launcher opens it. The modal itself is fixed and
         * escapes that, but the panel is not usable behind a rail that is not
         * there - and every other way of opening this goes through the
         * launcher first.
         */
        if (typeof ssOpenMenu === 'function') { ssOpenMenu(); }
        panel.style.display = 'block';
        scope.requestSignIn('session');
        // applyAsync rather than apply: this is called from a DOM handler that
        // Angular knows nothing about, and $apply inside an in-flight digest
        // throws $rootScope:inprog.
        scope.$applyAsync();
        return true;
    } catch (e) {
        return false;
    }
}

// Called when the org says the session we are using is no longer valid.
function ssMarkSessionExpired() {
    SS_SESSION_EXPIRED = true;
    // Only the token we were actually using is discredited. When the session
    // that died was the sid cookie, the stored token is a different session
    // that nothing has said anything about - deleting it there would sign the
    // user out of a Connected App over an unrelated failure.
    var wasUsingToken = !!SS_AUTH.accessToken;
    var wasUsingTyped = !SS_AUTH.accessToken && !!SS_AUTH.pastedSession;
    SS_AUTH.accessToken = null;
    SS_AUTH.instanceUrl = null;
    if (wasUsingTyped) {
        // The org has said this session is dead. Keeping it would re-offer a
        // credential that cannot work and hide the sign-in overlay behind it.
        ssForgetSessionId();
    }
    if (!wasUsingToken) {
        return;
    }
    // Drop the stored copy too. Clearing only the in-memory token left the
    // dead one in chrome.storage, so the next page load restored it, found a
    // "session", hid the sign-in overlay and 401ed on every request again.
    try {
        // Callback form, not the promise: a rejected promise here would be
        // unhandled, and there is nothing useful to do about it either way.
        chrome.storage.local.remove('ssAuth', function () {
            void chrome.runtime.lastError;
        });
    } catch (e) {
        // No storage permission / not an extension context (test harness).
    }
}

/*
 * True when a failed request is the org telling us the session is gone, as
 * opposed to a plain query/API error (MALFORMED_QUERY, permission problems...).
 *
 * The org has to say so in the body. A bare 401 is not enough: Salesforce
 * also answers 401 when a session is perfectly alive but is not allowed to
 * call *this* endpoint - Tooling and setup objects do it to tokens without
 * the right scope, and to users without "View Setup and Configuration". One
 * such reply used to latch the whole extension into the sign-in overlay, so
 * opening a single page the user lacked rights for locked them out of every
 * other page as well.
 *
 * A session that has genuinely expired always carries INVALID_SESSION_ID and
 * "Session expired or invalid", so nothing real is lost by requiring it. And
 * the failure that remains is the mild one: a request reports its own error
 * instead of signing the user out, and a page reload - which re-reads the
 * cookie and the stored token - still lands on the overlay if the session is
 * genuinely gone.
 */
function ssIsSessionExpiredError(rejection) {
    if (!rejection) { return false; }
    var entry = Array.isArray(rejection.data) ? rejection.data[0] : rejection.data;
    if (!entry) { return false; }
    if (entry.errorCode === 'INVALID_SESSION_ID') { return true; }
    return /session expired or invalid/i.test(String(entry.message || ''));
}

/*
 * A session rejection from one request, confirmed against the org before the
 * user is signed out of everything.
 *
 * This is the difference between "this request may not run" and "you have no
 * session". Salesforce answers INVALID_SESSION_ID to a perfectly live session
 * that is simply not authorised for the resource asked for - Setup and
 * Tooling resources do it constantly, SetupAuditTrail behind the Audit Trail
 * page being the one users actually hit. Believing that reply on its own
 * meant opening one page threw the user out of every other page too, and no
 * amount of reading the error body distinguishes the two cases: the body is
 * telling the truth about the request and lying about the session.
 *
 * So ask the org instead of inferring. The versioned resource index needs a
 * valid session and nothing else - no Setup rights, no particular scope - so
 * if it answers, the session is alive and the rejection belonged to that one
 * resource. Only when it refuses too is the session actually gone.
 *
 * Memoised while in flight so a page firing several requests confirms once.
 */
var _sessionProbe = null;

function ssSessionRejected(rejection) {
    if (!ssIsSessionExpiredError(rejection)) {
        return $.Deferred().resolve(false).promise();
    }
    if (SS_SESSION_EXPIRED) {
        return $.Deferred().resolve(true).promise();
    }
    if (_sessionProbe) {
        return _sessionProbe;
    }
    _sessionProbe = $.ajax({
        url: ssRestBase() + '/',
        type: 'GET',
        dataType: 'json',
        beforeSend: ssAuthorize
    }).then(function () {
        // The session works; that resource just would not serve it.
        _sessionProbe = null;
        return false;
    }, function (xhr) {
        _sessionProbe = null;
        // Only a refusal counts. A network failure or a blocked endpoint says
        // nothing about the session, and signing the user out over one would
        // be the same mistake in a different place.
        var refused = xhr && (xhr.status === 401 || xhr.status === 403);
        if (refused) {
            ssMarkSessionExpired();
        }
        return $.Deferred().resolve(!!refused).promise();
    });
    return _sessionProbe;
}

// True when we are running on a Connected App token rather than the cookie.
function ssUsingOAuth() {
    return !!SS_AUTH.accessToken;
}

// REST calls go to the token's instance when we are on OAuth; page links keep
// using the origin the user is actually browsing.
function ssApiOrigin() {
    // A typed-in session is only valid against the org it came from, so its
    // instance URL travels with it - sending it anywhere else would be both
    // useless and a credential leak.
    return (ssUsingOAuth() && SS_AUTH.instanceUrl) ||
           SS_AUTH.pastedInstanceUrl || SS_ORIGIN;
}

function ssSignIn(clientId, loginOrigin) {
    return new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage({
            type: 'SS_OAUTH_LOGIN',
            // Whatever the user chose - this org, production, sandbox or a
            // URL they typed. Falls back to the browsing origin, which is
            // what it always used.
            loginOrigin: loginOrigin || SS_ORIGIN,
            clientId: clientId || SS_AUTH.clientId
        }, function (response) {
            var failure = chrome.runtime.lastError;
            if (failure) { return reject(new Error(failure.message)); }
            if (!response || response.error) {
                return reject(new Error((response && response.error) || 'Sign-in failed.'));
            }
            SS_AUTH.accessToken = response.accessToken;
            SS_AUTH.instanceUrl = response.instanceUrl;
            SS_SESSION_EXPIRED = false;
            // Deliberately not written to a `sid` cookie. Doing that put a
            // bearer token in a cookie the browser then sent to the org on
            // every page request, collided with Salesforce's own sid on the
            // same host, and - because ssUsingOAuth() keyed off the absence
            // of that cookie - made every REST call go to the browsing origin
            // instead of the token's instance. ssSessionId() already prefers
            // SS_AUTH.accessToken, so nothing needs the cookie.
            resolve(response);
        });
    });
}

/*
 * Spending the refresh token.
 *
 * An access token that has aged out is the ordinary case, not a failure: the
 * whole point of asking for the refresh_token scope at sign-in is that the
 * user authorises once. Everything here is the page half - the service worker
 * holds the token and does the exchange, because only it has the host
 * permissions and only it can keep a single refresh in flight for all the
 * panels that 401 at the same moment.
 *
 * Resolves true when there is a usable token again, false when the user has
 * to sign in - a revoked grant, or no refresh token at all.
 */
function ssRefreshSession() {
    // Nothing to refresh: a cookie session or a typed-in one is not an OAuth
    // grant, and pretending otherwise would loop on a request that cannot be
    // rescued.
    if (SS_AUTH.pastedSession || (!SS_AUTH.accessToken && !ssUsingOAuth())) {
        return Promise.resolve(false);
    }

    return new Promise(function (resolve) {
        try {
            chrome.runtime.sendMessage({
                type: 'SS_OAUTH_REFRESH',
                // For tokens stored before the client id travelled with them.
                clientId: SS_AUTH.clientId || SS_CONNECTED_APP_CLIENT_ID,
                /* Which org's token to refresh. Without it the worker picks
                 * whichever it finds, which with a token per org is a coin
                 * toss that returns another org's session. */
                origin: SS_AUTH.instanceUrl || SS_ORIGIN
            }, function (response) {
                void chrome.runtime.lastError;
                if (response && response.ok && response.accessToken) {
                    SS_AUTH.accessToken = response.accessToken;
                    SS_AUTH.instanceUrl = response.instanceUrl || SS_AUTH.instanceUrl;
                    // It worked, so whatever marked the session dead was about
                    // the old token and no longer applies.
                    SS_SESSION_EXPIRED = false;
                    resolve(true);
                    return;
                }
                resolve(false);
            });
        } catch (e) {
            resolve(false);
        }
    });
}

function ssSignOut() {
    return new Promise(function (resolve) {
        SS_AUTH.accessToken = null;
        SS_AUTH.instanceUrl = null;
        // Whatever the user signed in with, signing out ends it. Leaving a
        // typed-in session behind would keep them signed in by a credential
        // the button they just pressed said nothing about.
        ssForgetSessionId();
        SS_SESSION_EXPIRED = false;
        chrome.runtime.sendMessage({
            type: 'SS_OAUTH_LOGOUT',
            /* This org only. Signing out of the sandbox in front of you
             * should not sign you out of production as well. */
            origin: SS_AUTH.instanceUrl || SS_ORIGIN
        }, function () {
            // lastError is irrelevant here - local state is already cleared.
            void chrome.runtime.lastError;
            resolve();
        });
    });
}

function ssSaveClientId(clientId) {
    SS_AUTH.clientId = clientId;
    return new Promise(function (resolve) {
        try {
            chrome.storage.local.set({ ssClientId: clientId }, resolve);
        } catch (e) {
            resolve();
        }
    });
}

/* ---------------------------------------------------------------- */
/* SOQL                                                              */
/* ---------------------------------------------------------------- */

// Search terms and ids get interpolated into SOQL string literals. A lone
// quote or backslash otherwise produces a MALFORMED_QUERY instead of a result.
function escapeSoqlLiteral(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/* ---------------------------------------------------------------- */
/* Launcher appearance                                               */
/*                                                                   */
/* One source for what the launcher looks like before anyone has     */
/* chosen anything. index.js mounts the icon and the Angular         */
/* controller offers the settings, and while these lived in both the */
/* launcher rendered one way and the settings panel reported another */
/* until the first click.                                            */
/* ---------------------------------------------------------------- */

var SS_LAUNCHER_DEFAULTS = {
    color:   'Red',
    shape:   'Circle',
    finish:  'Shiny',
    opacity: 75
};

function ssLauncherShape() {
    return readCookie('simplified_launcher_shape') || SS_LAUNCHER_DEFAULTS.shape;
}

function ssLauncherFinish() {
    return readCookie('simplified_launcher_finish') || SS_LAUNCHER_DEFAULTS.finish;
}

function ssLauncherColorName() {
    return readCookie('simplifiediconcolor') || SS_LAUNCHER_DEFAULTS.color;
}

function ssLauncherOpacity() {
    var saved = parseInt(readCookie('simplified_launcher_opacity'), 10);
    if (isNaN(saved) || saved < 10 || saved > 100) {
        return SS_LAUNCHER_DEFAULTS.opacity;
    }
    return saved;
}

// 'Square' and 'Normal' are the untouched icon, so they name no class.
function ssLauncherStyleClasses(shape, finish) {
    var classes = [];
    if (shape && shape !== 'Square') {
        classes.push('ss-launcher-shape-' + String(shape).toLowerCase());
    }
    if (finish && finish !== 'Normal') {
        classes.push('ss-launcher-finish-' + String(finish).toLowerCase());
    }
    return classes;
}

/*
 * Puts the current shape and finish on the icon.
 *
 * Rebuilds only our own classes: the element is shared, and blanking
 * className would take anything else on it with it.
 */
function ssApplyLauncherStyle(shape, finish) {
    var icon = document.getElementById('ss_icon');
    if (!icon) {
        return;
    }
    var kept = (icon.className || '').split(/\s+/).filter(function (name) {
        return name &&
               name.indexOf('ss-launcher-shape-') !== 0 &&
               name.indexOf('ss-launcher-finish-') !== 0;
    });
    icon.className = kept.concat(ssLauncherStyleClasses(shape, finish)).join(' ');
}

/* ---------------------------------------------------------------- */
/* Introduction period                                               */
/*                                                                   */
/* The launcher waves when it first appears, so a new user notices   */
/* there is something in the corner at all. That is worth doing once */
/* and not worth doing forever: after the first week the icon has    */
/* been seen, the movement is no longer telling anyone anything, and */
/* something that moves in the corner of a page you are working in   */
/* every day stops being a hint and becomes a distraction.           */
/*                                                                   */
/* An unknown install date means an established user, not a new one. */
/* The date is written by the service worker on a fresh install, so  */
/* the only people without one are those who had the extension       */
/* before this shipped - who have certainly seen the icon.           */
/* ---------------------------------------------------------------- */

var SS_INTRO_DAYS = 7;
var SS_INSTALLED_AT_KEY = 'ssInstalledAt';

function ssWithinIntroPeriod(callback) {
    try {
        chrome.storage.local.get(SS_INSTALLED_AT_KEY, function (stored) {
            void chrome.runtime.lastError;
            var installedAt = stored && stored[SS_INSTALLED_AT_KEY];
            if (!installedAt) {
                return callback(false);
            }
            callback((Date.now() - installedAt) < SS_INTRO_DAYS * 24 * 60 * 60 * 1000);
        });
    } catch (e) {
        // Not an extension context (test harness), or storage unavailable.
        callback(false);
    }
}

/* ---------------------------------------------------------------- */
/* What the service worker is allowed to know                        */
/*                                                                   */
/* The off-hours notification is put together in the service worker, */
/* which has none of what a content script has: no session, no page  */
/* localStorage, no idea which org the user works in. Everything it  */
/* needs has to be left for it here, while a page is open and a      */
/* session exists.                                                   */
/*                                                                   */
/* Deliberately small: the org's host and instance key so the public */
/* Trust API can be asked about it, the latest headlines already     */
/* shown in the ticker, and when the user was last active. No record */
/* data and no session token - the notification says what happened,  */
/* it does not need to be able to ask again.                         */
/* ---------------------------------------------------------------- */

var SS_BRIEF_KEY = 'ssBrief';

/*
 * Returns a promise now.
 *
 * Every existing caller fires and forgets, which is fine for a background
 * note. It is not fine for the one caller that reloads the page immediately
 * afterwards: the write is asynchronous, so the reload raced it and the org
 * was missing from the picker until something else happened to record it.
 */
function ssUpdateBrief(patch) {
    if (!patch) { return Promise.resolve(null); }
    return new Promise(function (settle) {
    try {
        chrome.storage.local.get(SS_BRIEF_KEY, function (stored) {
            void chrome.runtime.lastError;
            var brief = (stored && stored[SS_BRIEF_KEY]) || {};

            /*
             * The org this is about, not the page it was noticed on.
             *
             * These two are the same thing on an org page and are not on
             * simplified.html, where the page is served from
             * chrome-extension:// and the org is chosen. Recording the page's
             * origin there wrote the extension's own URL into the org store,
             * and it then appeared in the org picker as something to switch
             * to - offering the user a choice that is not an org.
             */
            var origin = ssApiOrigin();
            if (!ssIsSalesforceUrl(origin)) {
                // Nothing worth recording: whatever this page is, it is not an
                // org, and a brief keyed on it can only be noise later.
                return settle(null);
            }

            var host = '';
            try { host = new URL(origin).hostname; } catch (e) { return settle(null); }

            var key = ssOrgKey(host) || host;
            var mine = brief[key] || {};
            for (var field in patch) {
                if (Object.prototype.hasOwnProperty.call(patch, field)) {
                    mine[field] = patch[field];
                }
            }
            mine.origin = origin;
            mine.updatedAt = Date.now();
            brief[key] = mine;
            var write = {};
            write[SS_BRIEF_KEY] = brief;
            chrome.storage.local.set(write, function () {
                void chrome.runtime.lastError;
                settle(mine);
            });
        });
    } catch (e) {
        // Not an extension context (test harness), or storage unavailable.
        settle(null);
    }
    });
}

/* ---------------------------------------------------------------- */
/* Notification preferences                                          */
/*                                                                   */
/* Browser-wide rather than per org, and in chrome.storage rather    */
/* than a cookie: the service worker has to read them before it      */
/* sends anything, and it can see neither cookies nor page storage.  */
/*                                                                   */
/* Everything defaults on except the master switch's own absence -   */
/* an unset preference means "not yet asked", and the honest reading  */
/* of that is the behaviour the user has been getting, not silence.  */
/* ---------------------------------------------------------------- */

var SS_NOTIFY_PREFS_KEY = 'ssNotifyPrefs';

// The kinds of thing worth interrupting someone about, each mapped to the
// headline categories NewsService tags. Adding a kind here and a category
// there is all a new alert needs.
var SS_NOTIFY_KINDS = [
    { key: 'trust',    label: 'Salesforce incidents and maintenance',
      hint: 'Outages, degradations and planned windows on your org\'s instance.' },
    { key: 'storage',  label: 'Storage approaching its limit',
      hint: 'Data or file storage past 70% of the org\'s allowance.' },
    { key: 'api',      label: 'API limits approaching',
      hint: 'Daily API requests, async Apex or Bulk batches past 70%.' },
    { key: 'activity', label: 'Org activity',
      hint: 'What changed in the org today - Apex, flows, fields and the rest.' }
];

function ssGetOrgNotifyKey() {
    var orgId = (typeof readCookie === 'function' && readCookie('OrgId')) || '';
    return orgId ? (SS_NOTIFY_PREFS_KEY + '_' + orgId) : SS_NOTIFY_PREFS_KEY;
}

/*
 * Off until switched on.
 *
 * Notifications interrupt someone who did not ask for anything, so nobody
 * gets one because a default said so - they get one because they turned it
 * on. That includes the sign-in toast, which fired on every single page load
 * and announced only that the extension was working, which the user can see.
 *
 * The per-kind switches stay on beneath the master so that activating is one
 * action rather than five. Nothing fires while `enabled` is false, so their
 * value is moot until it is true.
 */
function ssDefaultNotifyPrefs() {
    var prefs = {
        enabled: false,
        scheduleType: 'all_day',
        startTime: '09:00',
        endTime: '18:00'
    };
    for (var i = 0; i < SS_NOTIFY_KINDS.length; i++) {
        prefs[SS_NOTIFY_KINDS[i].key] = true;
    }
    return prefs;
}

/*
 * A stored preference is honoured whichever way it points.
 *
 * This used to ask only `=== false`, which worked while every default was
 * true and silently broke the moment one was not: with the master now
 * defaulting to off, a user who had turned it on would have had that read
 * back as "not set" and been switched off again on the next page load.
 * Checking the type instead means the stored value wins, full stop.
 */
function ssNormalizeNotifyPrefs(stored) {
    var prefs = ssDefaultNotifyPrefs();
    if (!stored) { return prefs; }
    if (typeof stored.enabled === 'boolean') { prefs.enabled = stored.enabled; }
    if (stored.scheduleType === 'custom_hours' || stored.scheduleType === 'all_day') {
        prefs.scheduleType = stored.scheduleType;
    }
    if (stored.startTime) { prefs.startTime = stored.startTime; }
    if (stored.endTime) { prefs.endTime = stored.endTime; }
    for (var i = 0; i < SS_NOTIFY_KINDS.length; i++) {
        var key = SS_NOTIFY_KINDS[i].key;
        if (typeof stored[key] === 'boolean') { prefs[key] = stored[key]; }
    }
    return prefs;
}

function ssGetNotifyPrefs(callback) {
    try {
        var orgKey = ssGetOrgNotifyKey();
        chrome.storage.local.get([orgKey, SS_NOTIFY_PREFS_KEY], function (stored) {
            void chrome.runtime.lastError;
            var orgPrefs = stored && stored[orgKey];
            var globalFallback = stored && stored[SS_NOTIFY_PREFS_KEY];
            callback(ssNormalizeNotifyPrefs(orgPrefs || globalFallback));
        });
    } catch (e) {
        callback(ssDefaultNotifyPrefs());
    }
}

function ssSaveNotifyPrefs(prefs, callback) {
    try {
        var orgKey = ssGetOrgNotifyKey();
        var write = {};
        write[orgKey] = ssNormalizeNotifyPrefs(prefs);
        chrome.storage.local.set(write, function () {
            void chrome.runtime.lastError;
            if (callback) { callback(); }
        });
    } catch (e) {
        if (callback) { callback(); }
    }
}

function ssIsNotificationInActiveWindow(prefs) {
    if (!prefs || prefs.enabled === false) return false;
    if (prefs.scheduleType !== 'custom_hours') return true;
    if (!prefs.startTime || !prefs.endTime) return true;

    var now = new Date();
    var currentMinutes = now.getHours() * 60 + now.getMinutes();

    var startParts = prefs.startTime.split(':');
    var endParts = prefs.endTime.split(':');
    var startMinutes = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1] || '0', 10);
    var endMinutes = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1] || '0', 10);

    if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
        return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
}

/* ---------------------------------------------------------------- */
/* Text                                                              */
/* ---------------------------------------------------------------- */

// Short form of text written for somewhere else - an incident paragraph in a
// ticker line, say. Collapses whitespace, cuts on a word boundary and marks
// the cut, so a trimmed line never ends mid-word or mid-newline.
function ssTruncate(text, max) {
    var flat = String(text || '').replace(/\s+/g, ' ').trim();
    if (flat.length <= max) {
        return flat;
    }
    return flat.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/*
 * "My records" queries used to be built once at startup with the user id baked
 * into the string. That pinned the query to whatever uid cookie existed then -
 * so a first page load with no uid yet, or a "View as different user", left it
 * filtering on an empty or stale id and the current user's records never
 * appeared. The {uid} placeholder is substituted here, at query time, so the
 * query always asks for whoever is logged in now.
 */
function ssResolveQueryUid(soql) {
    if (!soql || soql.indexOf('{uid}') === -1) {
        return soql;
    }
    return soql.replace(/\{uid\}/g, escapeSoqlLiteral(readCookie('uid') || ''));
}

function ssBuildJsonDownloadPayload(records) {
    if (!records || !records.length) {
        return '[]';
    }
    var cleaned = records.map(function(record) {
        if (!record || typeof record !== 'object') {
            return record;
        }
        var copy = {};
        Object.keys(record).forEach(function(key) {
            if (key === '$$hashKey' || key === 'selected') {
                return;
            }
            copy[key] = record[key];
        });
        return copy;
    });
    return JSON.stringify(cleaned, null, 2);
}

/* ---------------------------------------------------------------- */
/* Host gating                                                       */
/*                                                                   */
/* This extension belongs on Salesforce Classic and Lightning - the  */
/* org UI - and nowhere else. "*.salesforce.com" also covers www,    */
/* help, trailhead, developer, appexchange and every other marketing */
/* or documentation host, and "*.force.com" covers public Experience */
/* Cloud sites, so neither is safe to inject into on its own.        */
/*                                                                   */
/* The manifest carries the same allowlist, and that is what stops   */
/* the scripts loading at all. This copy is the backstop: the mount  */
/* points fall back to document.body, so anything that slips through */
/* a match pattern would otherwise get a launcher stapled to it.     */
/* ---------------------------------------------------------------- */

// SS_ORG_HOSTS is declared at the top of the file - see the note there.

function ssIsOrgPage(hostname) {
    return SS_ORG_HOSTS.test(hostname || window.location.hostname);
}

/* ---------------------------------------------------------------- */
/* Authentication pages                                              */
/*                                                                   */
/* The host allowlist cannot tell "inside the org" from "logging in  */
/* to it". The login screen, the logout screen, identity             */
/* verification and the OAuth approval page are all served from      */
/* my.salesforce.com, so they satisfied ssIsOrgPage and got a        */
/* launcher stapled to them - an icon floating over the login box    */
/* with nothing behind it, because every panel it opens needs a      */
/* session that does not exist yet.                                  */
/*                                                                   */
/* Decided from the page, not from the sid cookie, and deliberately  */
/* so. Plenty of signed-in users have no readable sid - orgs that    */
/* set it HttpOnly or lock it to the domain - and they are exactly   */
/* the users the Connected App sign-in exists for. Hiding the        */
/* launcher whenever the cookie was missing would take away the only */
/* way to reach that sign-in and strand them with no extension at    */
/* all.                                                              */
/* ---------------------------------------------------------------- */

// Paths Salesforce serves its own authentication UI from. Anchored at the
// start: these are Salesforce's own paths, not a substring that could turn
// up inside somebody's Visualforce page name.
var SS_AUTH_PATHS = new RegExp(
    '^/(?:' +
    'login(?:\\.jsp)?$' +                                  // Classic login
    '|secur/(?:logout|frontdoor)\\.jsp' +                  // logout, SSO hand-off
    '|_ui/identity/' +                                     // identity verification
    '|setup/secur/RemoteAccessAuthorizationPage\\.apexp' + // OAuth approval
    '|services/auth/' +                                    // auth endpoints
    ')', 'i');

/*
 * Whether this page is Salesforce asking who the user is.
 *
 * Two tests, because neither covers the other: the My Domain login screen is
 * served from the root path, where the path says nothing and only the form
 * gives it away, while identity verification and the OAuth approval page
 * carry no password field and are only recognisable by their path.
 */
function ssIsAuthPage(pathname, doc) {
    var path = pathname || (typeof window !== 'undefined' && window.location
        ? window.location.pathname
        : '/');
    if (SS_AUTH_PATHS.test(path)) {
        return true;
    }

    var page = doc || (typeof document !== 'undefined' ? document : null);
    if (!page || !page.querySelector) {
        return false;
    }
    // Both halves required. A password field on its own is a change-password
    // screen, or somebody's own Visualforce page, and neither is a login -
    // suppressing the launcher there would be a bug of the opposite kind.
    return !!(page.querySelector('input[type="password"]') &&
              page.querySelector('#login_form, input#username, input#Login'));
}

/*
 * One org, seen from any of its UI hosts, reduces to one key.
 *
 * The same org is browsed as acme.my.salesforce.com (Classic),
 * acme.lightning.force.com (Lightning), acme.my.salesforce-setup.com (Setup)
 * and acme--c.vf.force.com (Visualforce), and a sandbox carries its name in
 * the first label: acme--dev.sandbox.my.salesforce.com. Dropping the UI
 * suffix leaves the org's own domain, which is what identifies it - and two
 * sandboxes of the same org stay distinct, because --dev and --qa are part
 * of that domain rather than something to strip.
 *
 * null for anything else. An OAuth instance_url is often not a UI host at
 * all - orgs without enhanced domains return na45.salesforce.com - and the
 * honest answer there is "I cannot tell", not a key that silently fails to
 * match everything.
 */
function ssOrgKey(hostname) {
    var host = String(hostname || '').toLowerCase();
    if (!SS_ORG_HOSTS.test(host)) {
        return null;
    }
    var isVisualforce = /\.(?:vf|visual)\.force\.com$/.test(host);
    var key = host.replace(
        /\.(?:lightning\.force\.com|my\.salesforce-setup\.com|my\.salesforce\.com|vf\.force\.com|visual\.force\.com)$/,
        '');
    if (isVisualforce) {
        // Visualforce appends the package namespace to the first label -
        // acme--c, acme--dev--c - and only Visualforce does.
        var labels = key.split('.');
        labels[0] = labels[0].replace(/--[^-]*$/, '');
        key = labels.join('.');
    }
    return key;
}

/*
 * Where the SOAP APIs live, which is not always where the page does.
 *
 * The Metadata API is served from the org's my-domain host only. On
 * Lightning, Setup or Visualforce, ssApiOrigin() hands back the host being
 * browsed - correct for REST, which those hosts do serve, and a dead end for
 * SOAP. Rebuilding the my-domain host from the org key is the reverse of
 * ssOrgKey, and gets sandboxes right for the same reason that does.
 */
function ssSoapOrigin() {
    if (ssUsingOAuth() && SS_AUTH.instanceUrl) {
        return SS_AUTH.instanceUrl;
    }
    var host = window.location.hostname;
    if (/(^|\.)my\.salesforce\.com$/i.test(host)) {
        return SS_ORIGIN;
    }
    var key = ssOrgKey(host);
    return key ? ('https://' + key + '.my.salesforce.com') : SS_ORIGIN;
}

/*
 * Whether a stored token may be used on the page we are on.
 *
 * Deliberately decided the safe way round: keep the token unless the two
 * hosts can be shown to be *different* orgs. Requiring positive proof of a
 * match instead threw the token away every time instance_url was not a
 * my-domain host, which is the reload straight after sign-in - the overlay
 * came back and the user could never get past it.
 *
 * signedInAt is the page origin the user actually clicked "Sign in" on, so
 * an exact match settles it without inferring anything from host shapes.
 */
/*
 * Credentials belong to the org they were issued for.
 *
 * SS_AUTH is loaded from storage before the standalone page knows which org it
 * is showing - the token and any typed-in session are restored first, and the
 * org is resolved after. On an org page that ordering is harmless, because
 * ssTokenBelongsToThisOrg compares the stored instance against the page's own
 * hostname. On simplified.html that hostname is the extension id, ssOrgKey
 * returns null for it, and the check gives the benefit of the doubt - so any
 * stored token was adopted whatever org it came from. A typed-in session was
 * never checked at all; it only had to be some Salesforce host.
 *
 * With one org that is invisible. With several it is the whole problem: pick
 * sandbox1 from the switcher and the page holds production's bearer token,
 * so every list is either refused or - if the token's instance is followed -
 * quietly production's data under sandbox1's name.
 *
 * Called once the org is known, so it can compare against the org rather than
 * against the page. The org's own cookie session is not touched: the service
 * worker read it for this origin, so it cannot belong to another.
 */
function ssDropForeignCredentials() {
    var here = ssOrgKey(ssHostOf(SS_ORIGIN));
    if (here === null) { return; }          // not an org origin; nothing to compare

    var belongsHere = function (instanceUrl) {
        var there = ssOrgKey(ssHostOf(instanceUrl));
        // An unreadable instance is not evidence of a mismatch. Keeping it
        // leaves the request to fail on its own terms rather than dropping a
        // credential that may well be the right one.
        return there === null || there === here;
    };

    if (SS_AUTH.accessToken && !belongsHere(SS_AUTH.instanceUrl)) {
        SS_AUTH.accessToken = null;
        SS_AUTH.instanceUrl = null;
    }
    if (SS_AUTH.pastedSession && !belongsHere(SS_AUTH.pastedInstanceUrl)) {
        SS_AUTH.pastedSession = null;
        SS_AUTH.pastedInstanceUrl = null;
    }
}

function ssHostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
}

/*
 * The org this page is showing, as something to put in a sentence.
 * "sandbox1.my.salesforce.com", not an origin with a scheme on it.
 */
function ssOrgLabel() {
    return ssHostOf(SS_ORIGIN) || null;
}

function ssTokenBelongsToThisOrg(saved) {
    if (!saved || !saved.accessToken) { return false; }
    if (saved.signedInAt && saved.signedInAt === SS_ORIGIN) { return true; }

    var instanceHost;
    try {
        instanceHost = new URL(saved.instanceUrl).hostname;
    } catch (e) {
        return true;
    }
    var there = ssOrgKey(instanceHost);
    var here = ssOrgKey(window.location.hostname);
    if (there === null || here === null) { return true; }
    return there === here;
}

/* ---------------------------------------------------------------- */
/* Menu open animation                                               */
/* ---------------------------------------------------------------- */

/*
 * How wide the rail opens.
 *
 * It was 150px while the icons occupy about 54px, so two thirds of the strip
 * was invisible but still swallowed every click that landed on it. Snug enough
 * to be honest about what is there, with a little slack so the pointer does
 * not fall out of the menu on the way to an icon.
 */
var SS_RAIL_WIDTH = '42px';

// The rail's rows are built once by ng-repeat and then only revealed by
// widening #mySidenav, so a plain CSS animation would play on first render
// and never again. Re-adding the class on each open replays it - with a
// forced reflow in between, or the browser coalesces the remove and the add
// into no change at all and nothing animates.
function ssPlayMenuOpen() {
    var nav = document.getElementById('mySidenav');
    if (!nav) {
        return;
    }
    nav.classList.remove('ss-menu-open');
    void nav.offsetWidth;
    nav.classList.add('ss-menu-open');
}

// Width and animation together, so every caller opens the rail the same way
// and the width lives in one place rather than in three string literals.
function ssOpenMenu() {
    var nav = document.getElementById('mySidenav');
    if (!nav) {
        return;
    }
    nav.style.width = SS_RAIL_WIDTH;
    nav.style.display = 'block';
    ssPlayMenuOpen();
}

function ssIsLightning(hostname) {
    // Lightning UI is typically served from lightning.force.com (or visually via Theme4d classes).
    var h = hostname || window.location.hostname;
    // Enhanced domains and setup use specific subdomains for lightning.
    return h.indexOf('.lightning.force.com') > -1 || h.indexOf('my.salesforce-setup.com') > -1 || document.querySelector('.slds-template_default') !== null;
}

// Absolute URL for a page/path on the org, e.g. ssOrgUrl('/001/e'). For page
// links, which must stay on the host the user is actually browsing.
function ssOrgUrl(path) {
    return SS_ORIGIN + (path || '');
}

// The same, for REST paths the org hands us - a describe's rowTemplate, say.
// Those have to follow the session, which on a Connected App token means the
// token's instance rather than the browsing origin.
function ssApiUrl(path) {
    return ssApiOrigin() + (path || '');
}

/* ---------------------------------------------------------------- */
/* API version                                                       */
/* ---------------------------------------------------------------- */

// Endpoints and the generated package.xml used to pin an API version by hand
// (v38.0, v43.0 and v60.0 in three different files). Orgs move roughly three
// times a year, so ask the org which versions it supports and take the newest.
// Read synchronously from the cookie so callers that build URLs at load time
// see a value immediately; refreshed in the background.
var SS_API_VERSION_FALLBACK = '60.0';
var SS_API_VERSION = readCookie('SFDCSimplified_apiVersion') || SS_API_VERSION_FALLBACK;
var SS_API_VERSION_COOKIE_DAYS = 7;

// Callers must invoke these at use time, not cache them: SS_API_VERSION is
// replaced once the org responds.
function ssRestBase()          { return ssApiOrigin() + '/services/data/v' + SS_API_VERSION; }
function ssQueryUrl()          { return ssRestBase() + '/query/?q='; }
function ssToolingQueryUrl()   { return ssRestBase() + '/tooling/query/?q='; }
function ssSobjectsUrl()       { return ssRestBase() + '/sobjects'; }
function ssToolingSobjectsUrl(){ return ssRestBase() + '/tooling/sobjects'; }
function ssToolingSobjectUrl(type, id) {
    return ssRestBase() + '/tooling/sobjects/' + type + '/' + id;
}

// Per-object describes. These are what let the query builder ask the org which
// fields an object actually has, instead of guessing that everything has Name
// and LastModifiedBy.
function ssDescribeUrl(type)        { return ssSobjectsUrl() + '/' + type + '/describe'; }
function ssToolingDescribeUrl(type) { return ssToolingSobjectsUrl() + '/' + type + '/describe'; }

/*
 * One release behind the org's newest, for package.xml.
 *
 * A manifest is written to be deployed somewhere, and the target is rarely
 * ahead of the source: a sandbox is upgraded before its production org, and
 * a package stamped with the very newest version is refused outright by any
 * org still on the previous release. Dropping one back costs nothing - the
 * components are the same - and makes the file portable in the direction
 * people actually move it.
 *
 * Only for the manifest. Live API calls stay on the newest the org offers.
 */
function ssPackageApiVersion(version) {
    var value = parseFloat(version || SS_API_VERSION);
    if (isNaN(value) || value <= 1) {
        return String(version || SS_API_VERSION);
    }
    return (value - 1).toFixed(1);
}

function pickLatestApiVersion(versions) {
    if (!versions || !versions.length) {
        return null;
    }
    var latest = null;
    for (var i = 0; i < versions.length; i++) {
        var value = parseFloat(versions[i] && versions[i].version);
        if (!isNaN(value) && (latest === null || value > latest)) {
            latest = value;
        }
    }
    return latest === null ? null : latest.toFixed(1);
}

// Resolves with the newest API version the org supports. Hits /services/data/
// at most once per page and at most once a week per org.
var _apiVersionRequest = null;
function fetchLatestApiVersion() {
    var cached = readCookie('SFDCSimplified_apiVersion');
    if (cached) {
        SS_API_VERSION = cached;
        return $.Deferred().resolve(cached).promise();
    }
    // Memoised so a slow or blocked endpoint is not re-requested by every
    // caller that needs the version.
    if (_apiVersionRequest) {
        return _apiVersionRequest;
    }
    // Absolute, not "/services/data/": on a Connected App token the REST API
    // lives on the token's instance, which is not the host being browsed.
    _apiVersionRequest = $.ajax({
        url: ssApiOrigin() + "/services/data/",
        type: "GET",
        dataType: "json",
        beforeSend: ssAuthorize
    }).then(function (result) {
        var latest = pickLatestApiVersion(result);
        if (latest) {
            SS_API_VERSION = latest;
            setCookie('SFDCSimplified_apiVersion', latest, SS_API_VERSION_COOKIE_DAYS);
        }
        return SS_API_VERSION;
    }, function () {
        // Org unreachable or endpoint blocked - keep whatever we already have.
        return $.Deferred().resolve(SS_API_VERSION).promise();
    });
    return _apiVersionRequest;
}

// $.ajax beforeSend hook: attaches the session bearer token.
function ssAuthorize(xhr) {
    var sid = ssSessionId();
    if (sid) {
        xhr.setRequestHeader('Authorization', 'Bearer ' + sid);
    }
}

/* ---------------------------------------------------------------- */
/* Smart Tooltip Suppressor                                         */
/* Don't show tooltip on hover when text is fully visible.          */
/* ---------------------------------------------------------------- */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('mouseover', function(e) {
        if (!e || !e.target) return;
        var target = e.target.closest ? e.target.closest('.tooltip-me, [data-title], [title]') : null;
        if (!target) return;

        var titleText = target.getAttribute('data-title') || target.getAttribute('title');
        if (!titleText) return;

        var contentEl = target.querySelector('.trim-info-content, .trim-info, .menusidebarText, .username-trim, span, a') || target;
        var innerText = (contentEl.textContent || target.textContent || '').trim();

        if (titleText.trim() === innerText) {
            var isOverflowing = (contentEl.scrollWidth > contentEl.clientWidth + 2) || (target.scrollWidth > target.clientWidth + 2);
            if (!isOverflowing) {
                if (target.hasAttribute('data-title')) {
                    target.setAttribute('data-suppressed-title', titleText);
                    target.removeAttribute('data-title');
                }
                if (target.hasAttribute('title')) {
                    target.setAttribute('data-suppressed-native-title', titleText);
                    target.removeAttribute('title');
                }
            }
        }
    }, true);

    document.addEventListener('mouseout', function(e) {
        if (!e || !e.target) return;
        var target = e.target.closest ? e.target.closest('[data-suppressed-title], [data-suppressed-native-title]') : null;
        if (!target) return;
        if (target.hasAttribute('data-suppressed-title')) {
            target.setAttribute('data-title', target.getAttribute('data-suppressed-title'));
            target.removeAttribute('data-suppressed-title');
        }
        if (target.hasAttribute('data-suppressed-native-title')) {
            target.setAttribute('title', target.getAttribute('data-suppressed-native-title'));
            target.removeAttribute('data-suppressed-native-title');
        }
    }, true);

    document.addEventListener('scroll', function(e) {
        if (!e || !e.target) return;
        var target = e.target;
        if (target.classList && (target.classList.contains('ss-modal-scroll') || target.classList.contains('ss-modal-main') || target.id === 'fullDataSidenav')) {
            var scrollTop = target.scrollTop || 0;
            var isScrolled = scrollTop > 15;
            var containers = document.querySelectorAll('.ss-sticky-header-container');
            for (var i = 0; i < containers.length; i++) {
                if (isScrolled) {
                    containers[i].classList.add('is-scrolled');
                } else {
                    containers[i].classList.remove('is-scrolled');
                }
            }
        }
    }, true);
}
