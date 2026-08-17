/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * The authorize request, and what is said when it does not load.
 *
 * The request has to stay exactly as narrow as it is. Adding a scope to it
 * broke sign-in for any org whose Connected App did not have that scope, and
 * broke it after login with an error naming nothing - so the absence of a
 * scope parameter is asserted here rather than left to be re-added by someone
 * reasoning, as I did, that asking explicitly must be better.
 *
 * The other failure guarded here is an error message that discards its cause,
 * turning every distinct problem into the same checklist - including the two
 * that are not problems with the checklist at all: a user who closed the
 * window, and an app Salesforce has not finished publishing.
 */

const background = fs.readFileSync('./js/background.js', 'utf8');

function load() {
    const context = {
        chrome: {
            storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve(),
                                remove: () => Promise.resolve() } },
            runtime: { onMessage: { addListener: () => {} }, onInstalled: { addListener: () => {} },
                       onStartup: { addListener: () => {} }, lastError: null,
                       getURL: (p) => 'chrome-extension://x/' + p },
            action: { onClicked: { addListener: () => {} } },
            alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
            notifications: { create: () => {}, onClicked: { addListener: () => {} } },
            cookies: { get: () => {} },
            tabs: { query: () => Promise.resolve([]), create: () => {} },
            identity: { getRedirectURL: () => 'https://ext.chromiumapp.org/' },
            commands: { onCommand: { addListener: () => {} } },
            windows: { create: () => {}, onRemoved: { addListener: () => {} } },
            webRequest: { onBeforeRequest: { addListener: () => {} } }
        },
        fetch: () => Promise.reject(new Error('not used')),
        URL, URLSearchParams, console, setTimeout, clearTimeout, Date, Promise
    };
    context.self = context;
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(background, context);
    return context;
}

function main() {
    const ctx = load();

    /* ------------------------------------------------------------------ */
    /* The authorize URL asks for what it needs                            */
    /* ------------------------------------------------------------------ */

    const url = new URL(ctx.buildAuthUrl(
        'https://login.salesforce.com', 'CLIENT_ID', 'https://ext.chromiumapp.org/', 'CHAL'));
    const q = url.searchParams;

    assert.strictEqual(url.origin + url.pathname,
        'https://login.salesforce.com/services/oauth2/authorize',
        'the authorize endpoint on the origin given');
    assert.strictEqual(q.get('response_type'), 'code', 'the authorization code flow');
    assert.strictEqual(q.get('client_id'), 'CLIENT_ID', 'the app being signed in to');
    assert.strictEqual(q.get('redirect_uri'), 'https://ext.chromiumapp.org/',
        'the callback the org has registered');

    /*
     * No scope, deliberately - and this is a regression guard, not a
     * preference.
     *
     * Requesting "api refresh_token" explicitly looked like an improvement and
     * broke sign-in: a Connected App without the refresh_token scope selected
     * rejects the request that asks for it, and rejects it *after* the user
     * has logged in, as OAUTH_APPROVAL_ERROR_GENERIC - which names nothing.
     * Omitting it lets the org grant whatever the app is configured with.
     */
    assert.strictEqual(q.get('scope'), null,
        'no scope is requested - the app config decides, as it did before');

    /* ------------------------------------------------------------------ */
    /* PKCE, and no secret                                                 */
    /* ------------------------------------------------------------------ */

    assert.strictEqual(q.get('code_challenge'), 'CHAL', 'the PKCE challenge travels');
    assert.strictEqual(q.get('code_challenge_method'), 'S256', 'hashed, not plain');
    assert.strictEqual(q.get('client_secret'), null,
        'no secret is ever put in a URL - the extension is a public client');

    // A challenge is useless if it is not the one the exchange will verify.
    assert.ok(!/CHAL.*CHAL/.test(url.search), 'the challenge appears once, not duplicated');

    /* ------------------------------------------------------------------ */
    /* What is said when the page does not load                            */
    /* ------------------------------------------------------------------ */

    /*
     * Closing the window is not a failure. It used to produce a four-point
     * audit of settings that were already correct, which is a worse outcome
     * than saying nothing.
     */
    const cancels = [
        'The user did not approve access.',
        'User cancelled the flow',
        'Authorization page could not be loaded: canceled by user'
    ];
    for (const said of cancels) {
        assert.strictEqual(
            ctx.authLoadFailure('CLIENT_ID', 'https://ext.chromiumapp.org/', new Error(said)),
            'Sign-in was cancelled.',
            'a cancellation is reported as one: ' + said);
    }

    const real = ctx.authLoadFailure('CLIENT_ID', 'https://ext.chromiumapp.org/',
                                     new Error('net::ERR_ABORTED'));

    // The cause is the whole diagnostic value and used to be thrown away.
    assert.ok(real.includes('net::ERR_ABORTED'),
        'the underlying error is kept, not discarded');
    assert.ok(real.includes('CLIENT_ID') && real.includes('https://ext.chromiumapp.org/'),
        'the two values the user has to compare against Setup are quoted back');

    /*
     * Verified against login.salesforce.com: an unregistered redirect_uri
     * answers 400 with error=redirect_uri_mismatch in the body, and an
     * unknown client_id answers 400 with error=invalid_client_id. Both are
     * error pages rather than redirects, because both make the callback
     * untrustworthy - which is exactly why neither can reach
     * describeAuthError, and why this message has to name them itself.
     */
    assert.match(real, /Callback URL/i, 'the callback URL is named as a likely cause');
    assert.match(real, /Consumer Key/i, 'so is an unrecognised consumer key');
    assert.ok(real.indexOf('Callback URL') < real.indexOf('Consumer Key'),
        'the callback comes first - it is the one that never fixes itself');
    assert.match(real, /2-10 minutes/,
        'and the publishing delay is given as the reason a key may not be recognised yet');

    // The two values the user has to compare must be on their own, not buried
    // mid-sentence where a trailing slash is impossible to spot.
    assert.ok(/\n?https:\/\/ext\.chromiumapp\.org\/\n/.test(real),
        'the callback URL sits on its own line to be compared character by character');
    assert.match(real, /trailing slash/,
        'and the trailing slash is called out, since it is invisible and load-bearing');

    // No cause at all must still produce usable text rather than "undefined".
    const bare = ctx.authLoadFailure('CLIENT_ID', 'https://ext.chromiumapp.org/', null);
    assert.ok(!/undefined|null/.test(bare), 'a missing cause leaves no placeholder in the message');
    assert.ok(bare.includes('Callback URL') && bare.includes('CLIENT_ID'),
        'and still names both causes');

    console.log('oauth authorize url regression test passed');
}

main();
