/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * When the org rejects the token we are using (HTTP 401 / INVALID_SESSION_ID),
 * the session it belonged to is gone even though the sid cookie may still be
 * present. The UI must flip back to the sign-in overlay instead of re-issuing
 * requests against a dead session - and a fresh Connected App sign-in must
 * clear that state again. Regression test for ssMarkSessionExpired /
 * ssIsSessionExpiredError / SS_SESSION_EXPIRED in ss-core.js.
 */
const removedStorageKeys = [];
const context = {
    window: {
        location: {
            origin: 'https://example.lightning.force.com',
            hostname: 'example.lightning.force.com'
        }
    },
    document: { cookie: '' },
    URL: URL,
    chrome: {
        runtime: {
            sendMessage(msg, cb) {
                if (msg && msg.type === 'SS_OAUTH_LOGIN') {
                    cb({ accessToken: 'tok123', instanceUrl: 'https://example.my.salesforce.com' });
                } else {
                    cb({});
                }
            }
        },
        storage: {
            local: {
                get(keys, cb) { cb({}); },
                set(values, cb) { if (cb) { cb(); } },
                remove(key) { removedStorageKeys.push(key); }
            }
        }
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
};

vm.runInNewContext(
    fs.readFileSync('./js/ss-core.js', 'utf8'),
    context
);

function setCookie(name, value) {
    context.document.cookie = value == null ? '' : name + '=' + value + '; path=/';
}

/*
 * The reload immediately after a successful Connected App sign-in, on an org
 * whose sid cookie is hidden - which is the only reason anyone signs in.
 *
 * Loads ss-core from scratch so it exercises the real restore path rather
 * than the predicate alone. The predicate was right while this was broken:
 * the storage callback read SS_ORG_HOSTS before its `var` initialiser had
 * run, threw, and the throw was swallowed as "no storage permission" - so
 * the token was dropped and the user bounced back to the overlay.
 */
function loadOnReload(pageHost, storedAuth) {
    const ctx = {
        window: { location: { origin: 'https://' + pageHost, hostname: pageHost } },
        document: { cookie: '' },
        URL: URL,
        chrome: {
            runtime: { sendMessage(msg, cb) { cb({}); } },
            storage: {
                local: {
                    get(keys, cb) { cb({ ssAuth: storedAuth }); },
                    set(values, cb) { if (cb) { cb(); } },
                    remove() {}
                }
            }
        },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
    };
    vm.runInNewContext(fs.readFileSync('./js/ss-core.js', 'utf8'), ctx);
    return ctx.ssAuthReady().then(function () { return ctx; });
}

async function restoreOnReload() {
    const cases = [
        ['acme.my.salesforce.com',
         { accessToken: 't', instanceUrl: 'https://acme.my.salesforce.com', signedInAt: 'https://acme.my.salesforce.com' },
         'https://acme.my.salesforce.com', 'an enhanced-domain org'],
        ['acme.my.salesforce.com',
         { accessToken: 't', instanceUrl: 'https://na45.salesforce.com', signedInAt: 'https://acme.my.salesforce.com' },
         'https://na45.salesforce.com', 'an org whose instance_url is a plain instance host'],
        ['acme.lightning.force.com',
         { accessToken: 't', instanceUrl: 'https://na45.salesforce.com', signedInAt: 'https://acme.my.salesforce.com' },
         'https://na45.salesforce.com', 'signed in on Classic, now browsing Lightning'],
        ['acme.my.salesforce.com',
         { accessToken: 't', instanceUrl: 'https://na45.salesforce.com' },
         'https://na45.salesforce.com', 'a token stored before signedInAt was recorded']
    ];

    for (const [host, stored, expectedApiOrigin, what] of cases) {
        const ctx = await loadOnReload(host, stored);
        assert.strictEqual(ctx.ssHasSession(), true,
            'the sign-in overlay must not come back after signing in - ' + what);
        assert.strictEqual(ctx.ssApiOrigin(), expectedApiOrigin,
            'REST must follow the token to its instance - ' + what);
    }

    // The one case the check exists for.
    const other = await loadOnReload('globex.my.salesforce.com',
        { accessToken: 't', instanceUrl: 'https://acme.my.salesforce.com', signedInAt: 'https://acme.my.salesforce.com' });
    assert.strictEqual(other.ssHasSession(), false,
        "another org's token must not be adopted here");
}

/*
 * Opening Setup Audit Trail must not sign the user out of everything else.
 *
 * SetupAuditTrail answers INVALID_SESSION_ID to a live session that is not
 * authorised for Setup, so the error body cannot be trusted on its own - it
 * describes the request, not the session. ssSessionRejected settles it by
 * asking the org for a resource that needs a session and nothing else.
 */
function pageWithProbe(probeOutcome) {
    const calls = [];
    const ctx = {
        window: { location: { origin: 'https://acme.my.salesforce.com', hostname: 'acme.my.salesforce.com' } },
        document: { cookie: 'sid=live-session' },
        URL: URL,
        chrome: {
            runtime: { sendMessage(msg, cb) { cb({}); } },
            storage: { local: { get(k, cb) { cb({}); }, set(v, cb) { if (cb) { cb(); } }, remove() {} } }
        },
        // Minimal jQuery: $.ajax(config) -> thenable, $.Deferred() -> promise.
        $: {
            ajax(config) {
                calls.push(config.url);
                return {
                    then(ok, fail) {
                        return probeOutcome.ok
                            ? { then: (f) => f(ok(probeOutcome.body)) , __v: ok(probeOutcome.body) }
                            : fail({ status: probeOutcome.status });
                    }
                };
            },
            Deferred() {
                let v;
                const p = { promise: () => p, then: (f) => f(v) };
                return { resolve(x) { v = x; return this; }, promise: () => p };
            }
        }
    };
    vm.runInNewContext(fs.readFileSync('./js/ss-core.js', 'utf8'), ctx);
    return { ctx, calls };
}

async function confirmBeforeSigningOut() {
    const setupRejection = {
        status: 401,
        data: [{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid' }]
    };

    // The Audit Trail case: the resource refuses, the session is fine.
    const live = pageWithProbe({ ok: true, body: { sobjects: '/x' } });
    live.ctx.ssSessionRejected(setupRejection);
    assert.strictEqual(live.ctx.ssHasSession(), true,
        'a Setup resource refusing a live session must not sign the user out');
    assert.strictEqual(live.calls.length, 1,
        'the org should have been asked once to settle it');
    assert.ok(/\/services\/data\/v[\d.]+\/$/.test(live.calls[0]),
        'the probe should ask for the versioned resource index: ' + live.calls[0]);

    // The session really is gone: the probe is refused too.
    const dead = pageWithProbe({ ok: false, status: 401 });
    dead.ctx.ssSessionRejected(setupRejection);
    assert.strictEqual(dead.ctx.ssHasSession(), false,
        'a session the org refuses everywhere is genuinely expired');

    // The probe could not be reached. That says nothing about the session,
    // and guessing would reintroduce the bug in a new place.
    const offline = pageWithProbe({ ok: false, status: 0 });
    offline.ctx.ssSessionRejected(setupRejection);
    assert.strictEqual(offline.ctx.ssHasSession(), true,
        'an unreachable probe must not be read as an expired session');

    // A plain query error never reaches the probe at all.
    const quiet = pageWithProbe({ ok: true, body: {} });
    quiet.ctx.ssSessionRejected({ status: 400, data: [{ errorCode: 'MALFORMED_QUERY', message: 'unexpected token' }] });
    assert.strictEqual(quiet.calls.length, 0,
        'a non-session error must not cost a confirmation request');
    assert.strictEqual(quiet.ctx.ssHasSession(), true,
        'and must not affect the session either');
}

(async function run() {
    setCookie('sid', 'cookie-session');
    assert.strictEqual(context.ssSessionId(), 'cookie-session',
        'a sid cookie should be the session id');
    assert.strictEqual(context.ssHasSession(), true,
        'a valid sid cookie means a session');

    // The org rejected the token - the session is gone even though the cookie
    // is still sitting there untouched.
    context.ssMarkSessionExpired();
    assert.strictEqual(context.ssHasSession(), false,
        'an expired session must not be reported as valid');
    assert.strictEqual(context.ssSessionId(), null,
        'an expired session must not yield a session id');
    assert.strictEqual(context.document.cookie, 'sid=cookie-session; path=/',
        'marking the session expired must not clobber the raw cookie');
    assert.deepStrictEqual(removedStorageKeys, [],
        'a dead cookie session says nothing about a stored token - leave it alone');

    // A fresh Connected App sign-in clears the expired flag.
    await context.ssSignIn('3MVG9YFqzc_KnL.z234.XuWZci8mINz0xN95XM2cWYDyM9tKz89Cpkrd0lx2ocyFtExySOfAwoCB48OU0T1pG');
    assert.strictEqual(context.ssHasSession(), true,
        'a fresh Connected App sign-in should restore the session');
    assert.strictEqual(context.ssSessionId(), 'tok123',
        'the fresh session id should be the OAuth access token, not the stale cookie');
    assert.strictEqual(context.document.cookie, 'sid=cookie-session; path=/',
        'the access token must never be written into a cookie the browser sends to the org');
    assert.strictEqual(context.ssUsingOAuth(), true,
        'holding an access token means we are on OAuth, cookie present or not');
    assert.strictEqual(context.ssApiOrigin(), 'https://example.my.salesforce.com',
        'REST must follow the token to its instance, not the Lightning host being browsed');

    /*
     * Expiry detection matrix.
     *
     * The org has to say the session is invalid. A bare 401 is not enough:
     * Salesforce answers 401 for a live session that simply may not call the
     * endpoint - Tooling and setup objects do it for a missing scope or a
     * user without "View Setup and Configuration" - and treating that as
     * expiry signed the user out of the whole extension for opening one page
     * they lacked rights to, Setup Audit Trail being the usual one.
     */
    assert.strictEqual(context.ssIsSessionExpiredError({ status: 401 }), false,
        'a 401 with no explanation is a refused request, not a dead session');
    assert.strictEqual(
        context.ssIsSessionExpiredError({ status: 401, data: [{ errorCode: 'INSUFFICIENT_ACCESS', message: 'You do not have permission to view Setup Audit Trail' }] }),
        false,
        'a 401 the org attributes to permissions must not sign the user out');
    assert.strictEqual(
        context.ssIsSessionExpiredError({ status: 401, data: [{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid' }] }),
        true,
        'a 401 the org attributes to the session is an expired session');
    assert.strictEqual(
        context.ssIsSessionExpiredError({ status: 400, data: [{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid' }] }),
        true,
        'INVALID_SESSION_ID means an expired session');
    assert.strictEqual(
        context.ssIsSessionExpiredError({ data: { errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid' } }),
        true,
        'an unwrapped INVALID_SESSION_ID object still counts');
    assert.strictEqual(
        context.ssIsSessionExpiredError({ status: 400, data: [{ errorCode: 'MALFORMED_QUERY', message: 'unexpected token' }] }),
        false,
        'a plain query error is not an expired session');
    assert.strictEqual(
        context.ssIsSessionExpiredError({ status: 403, data: [{ errorCode: 'INSUFFICIENT_ACCESS', message: 'insufficient access rights' }] }),
        false,
        'a permission problem is not an expired session');
    assert.strictEqual(context.ssIsSessionExpiredError({ noSession: true }), false,
        'the pre-request no-session case is handled upstream, not here');
    assert.strictEqual(context.ssIsSessionExpiredError(null), false,
        'a missing rejection is not an expired session');

    // A token is scoped to the org it was minted for. chrome.storage is shared
    // across every org the user opens, so this is what stops org A's token -
    // and org A's data - turning up on org B's page.
    const token = function (extra) {
        return Object.assign({ accessToken: 'tok123' }, extra);
    };

    assert.strictEqual(
        context.ssTokenBelongsToThisOrg(token({ instanceUrl: 'https://example.my.salesforce.com' })),
        true,
        'Lightning and Classic hosts of one org must resolve to the same org');
    assert.strictEqual(
        context.ssTokenBelongsToThisOrg(token({ instanceUrl: 'https://other.my.salesforce.com' })),
        false,
        'a token minted for another org must not be adopted here');
    assert.strictEqual(context.ssTokenBelongsToThisOrg(null), false,
        'there is no token to adopt');

    /*
     * The check has to fail open. An instance_url is not always a my-domain
     * host - orgs without enhanced domains hand back na45.salesforce.com -
     * and discarding the token whenever the hosts could not be matched threw
     * it away on the reload right after sign-in, putting the user back on the
     * sign-in overlay with no way past it.
     */
    assert.strictEqual(
        context.ssTokenBelongsToThisOrg(token({ instanceUrl: 'https://na45.salesforce.com' })),
        true,
        'an instance host we cannot key must not be treated as another org');
    assert.strictEqual(
        context.ssTokenBelongsToThisOrg(token({ instanceUrl: 'not a url' })),
        true,
        'an unparseable instance url must not lock the user out either');
    assert.strictEqual(
        context.ssTokenBelongsToThisOrg(token({
            instanceUrl: 'https://na45.salesforce.com',
            signedInAt: 'https://example.lightning.force.com'
        })),
        true,
        'signing in on this very page settles it without inferring anything');
    assert.strictEqual(
        context.ssTokenBelongsToThisOrg(token({
            instanceUrl: 'https://other.my.salesforce.com',
            signedInAt: 'https://other.lightning.force.com'
        })),
        false,
        'a token signed in on another org is still another org');

    assert.strictEqual(context.ssOrgKey('na45.salesforce.com'), null,
        'a non-UI host has no org key rather than a key that matches nothing');

    /*
     * SOAP is served from the my-domain host only, so a Lightning or Setup
     * page has to be translated before the Metadata API can be called - the
     * host being browsed is a dead end for it.
     */
    assert.strictEqual(context.ssSoapOrigin(), 'https://example.my.salesforce.com',
        'a Lightning page must resolve SOAP to the org my-domain host');

    // package.xml goes out one release behind: a sandbox is upgraded before
    // production, and an org on the previous release refuses a newer file.
    assert.strictEqual(context.ssPackageApiVersion('62.0'), '61.0',
        'the manifest should be stamped one release behind the org');
    assert.strictEqual(context.ssPackageApiVersion('30.0'), '29.0');
    assert.strictEqual(context.ssPackageApiVersion(undefined), context.ssPackageApiVersion(context.SS_API_VERSION),
        'no version given falls back to the resolved one');

    /*
     * Launcher defaults. index.js mounts the icon and the settings panel
     * reports on it, so both read these - a second copy is how the launcher
     * came to render one way while the panel claimed another.
     */
    assert.deepStrictEqual(
        { color: context.SS_LAUNCHER_DEFAULTS.color, shape: context.SS_LAUNCHER_DEFAULTS.shape,
          finish: context.SS_LAUNCHER_DEFAULTS.finish, opacity: context.SS_LAUNCHER_DEFAULTS.opacity },
        { color: 'Red', shape: 'Circle', finish: 'Shiny', opacity: 75 },
        'the shipped default launcher is red, circular, shiny, at 75%');

    context.document.cookie = '';
    assert.strictEqual(context.ssLauncherColorName(), 'Red', 'colour falls back to the default');
    assert.strictEqual(context.ssLauncherShape(), 'Circle', 'shape falls back to the default');
    assert.strictEqual(context.ssLauncherFinish(), 'Shiny', 'finish falls back to the default');
    assert.strictEqual(context.ssLauncherOpacity(), 75, 'opacity falls back to the default');

    // A choice already made is not overridden by the new default.
    context.document.cookie = 'simplified_launcher_shape=Hexagon; path=/';
    assert.strictEqual(context.ssLauncherShape(), 'Hexagon',
        "an existing user's chosen shape must survive a change of default");

    // An unusable stored value falls back rather than being applied.
    context.document.cookie = 'simplified_launcher_opacity=9999; path=/';
    assert.strictEqual(context.ssLauncherOpacity(), 75,
        'an out-of-range opacity falls back rather than blanking the launcher');
    context.document.cookie = '';

    // Array.from: the classes are built in the vm realm, and deepStrictEqual
    // compares prototypes as well as contents.
    assert.deepStrictEqual(Array.from(context.ssLauncherStyleClasses('Circle', 'Shiny')),
        ['ss-launcher-shape-circle', 'ss-launcher-finish-shiny'],
        'the default pair resolves to both classes');
    assert.deepStrictEqual(Array.from(context.ssLauncherStyleClasses('Square', 'Normal')), [],
        'the untouched icon names no class at all');

    /*
     * The Connected App install offer.
     *
     * Unconfigured by default, and the overlay hides the offer when the URL
     * is empty - a one-click install pointing at nothing would be worse than
     * telling the user to create the app by hand.
     */
    assert.strictEqual(context.SS_CONNECTED_APP_PACKAGE_ID, '',
        'no package is configured until someone publishes one');
    assert.strictEqual(context.ssAppInstallUrl(), '',
        'and with no package there is no install link to offer');

    context.SS_CONNECTED_APP_PACKAGE_ID = '04t5j000000XyZaAAK';
    assert.strictEqual(context.ssAppInstallUrl(),
        'https://example.lightning.force.com/packaging/installPackage.apexp?p0=04t5j000000XyZaAAK',
        'a configured package installs into the org being browsed');

    // 15-character ids are as valid as 18.
    context.SS_CONNECTED_APP_PACKAGE_ID = '04t5j000000XyZa';
    assert.ok(context.ssAppInstallUrl(), 'a 15-character package id is still a package id');

    /*
     * installPackage takes a package version id. The Connected App's own
     * record id is the easy mistake - it is what sits in the address bar
     * while you look at the app - and it would render a link that lands on
     * an error inside Setup, which is worse than offering nothing.
     */
    ['0xId2000000DmA5', '0H4000000000001', '3MVG9YFqzc_KnL.z234', '04t', 'nonsense'].forEach(function (wrong) {
        context.SS_CONNECTED_APP_PACKAGE_ID = wrong;
        assert.strictEqual(context.ssAppInstallUrl(), '',
            'not a package version id, so no install link: ' + wrong);
    });
    context.SS_CONNECTED_APP_PACKAGE_ID = '';

    /* ------------------------------------------------------------------ */
    /* Where the sign-in starts                                            */
    /* ------------------------------------------------------------------ */
    assert.strictEqual(context.ssLoginOrigin('production').origin, 'https://login.salesforce.com');
    assert.strictEqual(context.ssLoginOrigin('sandbox').origin, 'https://test.salesforce.com');

    // The default: this org, resolved to the my-domain host the OAuth
    // endpoints are served from - not the Lightning host being browsed.
    assert.strictEqual(context.ssLoginOrigin('org').origin, 'https://example.my.salesforce.com',
        'this org resolves to its my-domain, where the OAuth endpoints live');
    assert.strictEqual(context.ssLoginOrigin().origin, 'https://example.my.salesforce.com',
        'and is what an unrecognised target falls back to');

    // A typed URL, with the scheme filled in - typing a bare host is the
    // common case and rejecting it would be pedantry.
    assert.strictEqual(context.ssLoginOrigin('custom', 'acme--dev.sandbox.my.salesforce.com').origin,
        'https://acme--dev.sandbox.my.salesforce.com',
        'a bare host gets https:// rather than an error');
    assert.strictEqual(context.ssLoginOrigin('custom', '  https://acme.my.salesforce.com/lightning/o/Account  ').origin,
        'https://acme.my.salesforce.com',
        'a pasted deep link is trimmed back to its origin');

    /*
     * This URL is where a session gets established, so it is not somewhere
     * the extension can be talked into sending someone.
     */
    assert.ok(context.ssLoginOrigin('custom', 'https://evil.example.com').error,
        'a non-Salesforce host must be refused');
    assert.ok(/Salesforce/i.test(context.ssLoginOrigin('custom', 'https://evil.example.com').error),
        'and say why');
    assert.ok(context.ssLoginOrigin('custom', 'http://acme.my.salesforce.com').error,
        'plain http must be refused');
    assert.ok(context.ssLoginOrigin('custom', '   ').error,
        'and an empty box asks for a URL rather than signing in to nothing');
    assert.ok(context.ssLoginOrigin('custom', 'not a url at all').error,
        'as does something that is not a URL');

    /*
     * Every sign-in failure that means "this org will not accept the app"
     * has to open the section that fixes it. The controller matches on the
     * message text, so the two files have to agree - and they did not: the
     * rejected-launchWebAuthFlow message, which is what an org refusing the
     * app usually produces, matched nothing and left the fix hidden.
     */
    const ownAppNeeded = new RegExp(
        /not installed|not available|no.?such.?client|invalid_client|invalid client|client identifier|OAUTH_APP_BLOCKED|blocked|will not accept|authorization page could not be loaded/.source, 'i');

    [
        'External client app is not installed in this org',
        'This org will not accept the Connected App this extension signs in with.',
        'The Salesforce authorization page could not be loaded. Check these in Salesforce Setup',
        'invalid_client_id: client identifier invalid'
    ].forEach(function (message) {
        assert.ok(ownAppNeeded.test(message),
            'this failure must offer the Connected App fix: ' + message.slice(0, 60));
    });

    // Cancelling is not a broken app, and must not throw setup steps at
    // somebody who simply closed the window.
    assert.ok(!ownAppNeeded.test('Sign-in was cancelled.'),
        'a cancelled sign-in is not an app problem');

    // The token we are running on being refused is the one case where the
    // stored copy has to go, or the next page load restores it, reports a
    // session, hides the overlay and 401s on everything again.
    context.ssMarkSessionExpired();
    assert.deepStrictEqual(removedStorageKeys, ['ssAuth'],
        'a refused token must be dropped from storage as well as from memory');

    await restoreOnReload();
    await confirmBeforeSigningOut();

    assert.strictEqual(context.ssOrgKey('acme.my.salesforce.com'), 'acme');
    assert.strictEqual(context.ssOrgKey('acme.lightning.force.com'), 'acme');
    assert.strictEqual(context.ssOrgKey('acme.my.salesforce-setup.com'), 'acme');
    assert.strictEqual(context.ssOrgKey('acme--c.vf.force.com'), 'acme',
        'Visualforce appends a package namespace that is not part of the org domain');
    assert.strictEqual(context.ssOrgKey('acme--dev.sandbox.my.salesforce.com'), 'acme--dev.sandbox');
    assert.strictEqual(context.ssOrgKey('acme--dev--c.sandbox.vf.force.com'), 'acme--dev.sandbox',
        'a sandbox Visualforce host must key the same as the sandbox itself');
    assert.notStrictEqual(
        context.ssOrgKey('acme--dev.sandbox.my.salesforce.com'),
        context.ssOrgKey('acme--qa.sandbox.my.salesforce.com'),
        'two sandboxes of one org are two different orgs');

    console.log('ss-core session expiry regression test passed');
})().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
