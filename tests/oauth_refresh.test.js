/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * Spending the refresh token.
 *
 * The extension has always asked for the refresh_token scope and stored what
 * came back, and never spent it. So an access token that aged out - a couple
 * of hours in a default org - sent the user back to the sign-in overlay with a
 * perfectly good refresh token sitting in storage. That is the difference
 * between authorising once and authorising all day.
 *
 * The distinctions that matter here are between the three ways a refresh can
 * fail, because they need opposite handling: an expired access token should be
 * invisible, a revoked grant must put the sign-in overlay up, and a network
 * blip must do neither - keeping the token so the next attempt can use it.
 */

const background = fs.readFileSync('./js/background.js', 'utf8');

function loadRefresh(options) {
    const opts = options || {};
    const store = { ssAuth: opts.saved === undefined ? {
        accessToken: 'old-token',
        refreshToken: 'refresh-me',
        instanceUrl: 'https://acme.my.salesforce.com',
        tokenOrigin: 'https://login.salesforce.com',
        clientId: 'CLIENT_ID_A'
    } : opts.saved };

    const posted = [];
    const context = {
        chrome: {
            storage: {
                local: {
                    get: (keys) => Promise.resolve(
                        Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]))),
                    set: (bag) => { Object.assign(store, bag); return Promise.resolve(); },
                    remove: (key) => { delete store[key]; return Promise.resolve(); }
                }
            },
            runtime: { onMessage: { addListener: () => {} }, onInstalled: { addListener: () => {} },
                       onStartup: { addListener: () => {} },
                       lastError: null, getURL: (p) => 'chrome-extension://x/' + p },
            action: { onClicked: { addListener: () => {} } },
            alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
            notifications: { create: () => {}, onClicked: { addListener: () => {} } },
            cookies: { get: () => {} },
            tabs: { query: () => Promise.resolve([]), create: () => {} },
            identity: { getRedirectURL: () => 'https://x.chromiumapp.org/' },
            commands: { onCommand: { addListener: () => {} } },
            windows: { create: () => {}, onRemoved: { addListener: () => {} } },
            webRequest: { onBeforeRequest: { addListener: () => {} } }
        },
        fetch: (url, init) => {
            posted.push({ url, body: init.body });
            if (opts.network === 'down') { return Promise.reject(new Error('offline')); }
            return Promise.resolve({
                ok: opts.ok !== false,
                json: () => Promise.resolve(opts.response || { access_token: 'new-token' })
            });
        },
        URL, URLSearchParams, console, setTimeout, clearTimeout, Date, Promise
    };
    /*
     * Tokens live in ssAuthOrgs, keyed by the org's host, with the old single
     * ssAuth record folded in on read. The tests ask "what is stored for this
     * org" rather than reaching into a slot, so they say what they mean and
     * do not have to know the key.
     */
    store.tokenFor = (host) => {
        const map = store.ssAuthOrgs || {};
        return map[host] || (store.ssAuth && store.ssAuth.instanceUrl &&
            new URL(store.ssAuth.instanceUrl).hostname === host ? store.ssAuth : undefined);
    };
    store.orgCount = () => Object.keys(store.ssAuthOrgs || {}).length;

    context.self = context;
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(background, context);

    return { refresh: context.refreshAccessToken, store, posted, context };
}

async function main() {

    /* ------------------------------------------------------------------ */
    /* The ordinary case: an access token that has aged out                */
    /* ------------------------------------------------------------------ */

    const ok = loadRefresh({ response: {
        access_token: 'new-token', instance_url: 'https://acme.my.salesforce.com'
    } });
    const result = await ok.refresh();

    assert.strictEqual(result.ok, true, 'a valid refresh token yields a new session');
    assert.strictEqual(result.accessToken, 'new-token', 'and the new access token is handed back');
    assert.strictEqual(ok.store.tokenFor('acme.my.salesforce.com').accessToken, 'new-token',
        'and stored against the org it belongs to');

    /*
     * Ordinarily a refresh response carries no refresh_token of its own.
     * Overwriting the stored one with the undefined that is not there would
     * make this work exactly once.
     */
    assert.strictEqual(ok.store.tokenFor('acme.my.salesforce.com').refreshToken, 'refresh-me',
        'the refresh token survives being spent');

    /*
     * Unless the org has "Enable Refresh Token Rotation" on, in which case a
     * new one comes back and the old is invalidated immediately. Keeping the
     * old one would work exactly once and then fail forever - weeks later,
     * looking for all the world like a revoked grant.
     */
    const rotating = loadRefresh({ response: {
        access_token: 'new-token', refresh_token: 'rotated-refresh'
    } });
    await rotating.refresh();
    assert.strictEqual(rotating.store.tokenFor('acme.my.salesforce.com').refreshToken,
        'rotated-refresh',
        'a rotated refresh token replaces the one that was spent');

    // And the rotated one is what the next refresh presents, or rotation
    // breaks on the second go instead of the first.
    await rotating.refresh();
    assert.ok(rotating.posted[1].body.includes('refresh_token=rotated-refresh'),
        'the next refresh presents the rotated token, not the original');

    // The exchange has to go back to the authorization server that minted the
    // token, under the client id it was minted for - a token from a sandbox or
    // from the org's own app cannot be refreshed at login.salesforce.com with
    // the shipped id.
    assert.strictEqual(ok.posted[0].url, 'https://login.salesforce.com/services/oauth2/token',
        'the refresh goes back to the origin that minted the token');
    assert.ok(ok.posted[0].body.includes('grant_type=refresh_token'), 'it is a refresh grant');
    assert.ok(ok.posted[0].body.includes('client_id=CLIENT_ID_A'),
        'under the client id the token was minted for');
    assert.ok(ok.posted[0].body.includes('refresh_token=refresh-me'), 'presenting the refresh token');

    // A public client, exactly as the authorization code exchange is. A secret
    // in an extension is readable by anyone who unzips it.
    assert.ok(!/client_secret/.test(ok.posted[0].body),
        'no client secret is ever sent - the extension is a public client');

    /*
     * A sandbox token cannot be refreshed at login.salesforce.com - it is a
     * different authorization server and does not know the grant. Same for an
     * org signed in to through its My Domain. This is why the origin is stored
     * with the token rather than derived when it is needed.
     */
    const sandbox = loadRefresh({ saved: {
        accessToken: 'old', refreshToken: 'refresh-me', clientId: 'CLIENT_ID_A',
        instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com',
        tokenOrigin: 'https://test.salesforce.com'
    } });
    await sandbox.refresh();
    assert.strictEqual(sandbox.posted[0].url, 'https://test.salesforce.com/services/oauth2/token',
        'a sandbox token refreshes against the sandbox authorization server');

    const myDomain = loadRefresh({ saved: {
        accessToken: 'old', refreshToken: 'refresh-me', clientId: 'CLIENT_ID_A',
        instanceUrl: 'https://acme.my.salesforce.com',
        tokenOrigin: 'https://acme.my.salesforce.com'
    } });
    await myDomain.refresh();
    assert.strictEqual(myDomain.posted[0].url,
        'https://acme.my.salesforce.com/services/oauth2/token',
        'a My Domain sign-in refreshes against that domain');

    /* ------------------------------------------------------------------ */
    /* A revoked grant                                                     */
    /*                                                                     */
    /* The user disconnected the app, or an admin expired it. It never      */
    /* comes back, so the record has to go - otherwise every request        */
    /* retries a dead token forever and the sign-in overlay never appears.  */
    /* ------------------------------------------------------------------ */

    const revoked = loadRefresh({ ok: false, response: {
        error: 'invalid_grant', error_description: 'expired access/refresh token'
    } });
    const denied = await revoked.refresh();
    assert.strictEqual(denied.ok, false, 'a revoked grant does not yield a session');
    assert.match(denied.error, /expired access\/refresh token/, "the org's own words are kept");
    assert.strictEqual(revoked.store.tokenFor('acme.my.salesforce.com'), undefined,
        'a revoked grant is discarded, so the user is asked to sign in again');

    /* ------------------------------------------------------------------ */
    /* A network blip                                                      */
    /*                                                                     */
    /* Not a revoked grant, and treating it as one would sign the user out  */
    /* of a working org because their wifi dropped for a moment.           */
    /* ------------------------------------------------------------------ */

    const offline = loadRefresh({ network: 'down' });
    const failed = await offline.refresh();
    assert.strictEqual(failed.ok, false, 'an unreachable org does not yield a session');
    assert.ok(offline.store.tokenFor('acme.my.salesforce.com') &&
              offline.store.tokenFor('acme.my.salesforce.com').refreshToken === 'refresh-me',
        'but the token is kept, so the next attempt can still use it');

    /* ------------------------------------------------------------------ */
    /* Nothing to refresh                                                  */
    /* ------------------------------------------------------------------ */

    assert.strictEqual((await loadRefresh({ saved: null }).refresh()).ok, false,
        'no stored session means nothing to refresh');
    assert.strictEqual(
        (await loadRefresh({ saved: { accessToken: 'a', tokenOrigin: 'https://x' } }).refresh()).ok,
        false, 'a session with no refresh token cannot be refreshed');

    const noOrigin = loadRefresh({ saved: { accessToken: 'a', refreshToken: 'r' } });
    assert.strictEqual((await noOrigin.refresh()).ok, false,
        'a session with nowhere to refresh against is not guessed at');
    assert.strictEqual(noOrigin.posted.length, 0, 'and nothing is sent anywhere');

    /*
     * Tokens minted before the client id was stored alongside them - which is
     * every already-signed-in user the moment this ships. The service worker
     * has no copy of the shipped constant, so the page passes it; without that
     * the refresh throws rather than failing, and the retry path swallows it.
     */
    const legacy = loadRefresh({ saved: {
        accessToken: 'old', refreshToken: 'refresh-me',
        tokenOrigin: 'https://login.salesforce.com'
    } });
    const rescued = await legacy.refresh('SHIPPED_ID');
    assert.strictEqual(rescued.ok, true, 'a token stored without a client id is still refreshable');
    assert.ok(legacy.posted[0].body.includes('client_id=SHIPPED_ID'),
        'using the client id the page passes in');

    const noClientAnywhere = loadRefresh({ saved: {
        accessToken: 'old', refreshToken: 'r', tokenOrigin: 'https://login.salesforce.com'
    } });
    assert.strictEqual((await noClientAnywhere.refresh(undefined)).ok, false,
        'with no client id from either side it fails rather than throwing');
    assert.strictEqual(noClientAnywhere.posted.length, 0, 'and sends nothing');

    /* ------------------------------------------------------------------ */
    /* One refresh, however many requests hit the wall at once             */
    /*                                                                     */
    /* Every panel queries on load, so an aged-out token produces a burst   */
    /* of 401s together. Each starting its own refresh would discard all    */
    /* but one of the resulting tokens - and Salesforce may invalidate the  */
    /* earlier ones as it issues the later ones.                           */
    /* ------------------------------------------------------------------ */

    const burst = loadRefresh({});
    const together = await Promise.all([burst.refresh(), burst.refresh(), burst.refresh()]);
    assert.strictEqual(burst.posted.length, 1, 'three simultaneous refreshes make one exchange');
    assert.ok(together.every((r) => r.ok && r.accessToken === 'new-token'),
        'and all three callers get the new token');

    // But the gate opens again afterwards, or the session could never be
    // refreshed a second time.
    await burst.refresh();
    assert.strictEqual(burst.posted.length, 2, 'a later refresh is not blocked by the earlier one');

    /* ------------------------------------------------------------------ */
/* A second org does not evict the first                               */
/* ------------------------------------------------------------------ */

/*
 * The bug as reported: sign in to one org, sign in to the next, and the
 * first is gone. ssAuth was a single record, so the second grant simply
 * overwrote the first - and coming back to that org meant signing in again,
 * with nothing to say why. Two orgs is not an edge case in this extension:
 * a pipeline is two orgs by definition.
 */
{
    const both = loadRefresh({ saved: {
        accessToken: 'a-token', refreshToken: 'a-refresh',
        instanceUrl: 'https://alpha.my.salesforce.com',
        tokenOrigin: 'https://login.salesforce.com', clientId: 'CLIENT_A'
    } });

    /* Whatever wrote alpha's token, beta's arrives next. */
    await both.context.writeToken({
        accessToken: 'b-token', refreshToken: 'b-refresh',
        instanceUrl: 'https://beta.my.salesforce.com',
        tokenOrigin: 'https://login.salesforce.com', clientId: 'CLIENT_B'
    });

    assert.strictEqual(both.store.orgCount(), 2,
        'the second org replaced the first instead of joining it');
    assert.strictEqual(both.store.tokenFor('alpha.my.salesforce.com').accessToken, 'a-token',
        'signing in to the second org threw away the first org\'s token');
    assert.strictEqual(both.store.tokenFor('beta.my.salesforce.com').accessToken, 'b-token',
        'the second org\'s token was not stored');

    /* And each org is handed its own, never the other's. */
    const alpha = await both.context.tokenFor('https://alpha.my.salesforce.com');
    const beta = await both.context.tokenFor('https://beta.my.salesforce.com');
    assert.strictEqual(alpha.record.accessToken, 'a-token');
    assert.strictEqual(beta.record.accessToken, 'b-token',
        'asking for one org returned the other org\'s token, which is the ' +
        'cross-org leak the host guard exists to prevent');

    /*
     * Refreshing one leaves the other alone. The in-flight guard was a single
     * slot too, so a refresh for beta could return alpha's answer.
     */
    const refreshed = await both.context.refreshAccessToken('CLIENT_B',
        'https://beta.my.salesforce.com');
    assert.strictEqual(refreshed.ok, true);
    assert.strictEqual(both.store.tokenFor('alpha.my.salesforce.com').accessToken, 'a-token',
        'refreshing one org overwrote another org\'s token');
    assert.strictEqual(both.store.orgCount(), 2, 'an org was lost during a refresh');

    /* Signing out of one signs out of one. */
    const found = await both.context.tokenFor('https://beta.my.salesforce.com');
    await both.context.forgetToken(found.slot);
    assert.strictEqual(both.store.tokenFor('beta.my.salesforce.com'), undefined,
        'signing out of an org left its token behind');
    assert.strictEqual(both.store.tokenFor('alpha.my.salesforce.com').accessToken, 'a-token',
        'signing out of one org signed you out of the other as well');
}

/* ------------------------------------------------------------------ */
/* The old single record still works                                   */
/* ------------------------------------------------------------------ */

/*
 * A browser that has not signed in since the change has its token in the old
 * slot. It is folded into the map on read rather than by a migration that
 * has to run exactly once, correctly, before anything else touches storage.
 */
{
    const legacy = loadRefresh({ saved: {
        accessToken: 'old-shape', refreshToken: 'old-refresh',
        instanceUrl: 'https://gamma.my.salesforce.com',
        tokenOrigin: 'https://login.salesforce.com', clientId: 'CLIENT_G'
    } });

    const found = await legacy.context.tokenFor('https://gamma.my.salesforce.com');
    assert.ok(found.record, 'a token in the old slot is no longer found at all');
    assert.strictEqual(found.record.accessToken, 'old-shape');

    /* And once anything is written, the old slot is emptied - left there it
     * would be folded back in over a record that has since been refreshed. */
    await legacy.context.writeToken(Object.assign({}, found.record,
        { accessToken: 'refreshed' }));
    assert.strictEqual(legacy.store.ssAuth, undefined,
        'the old single record survives a write, so a stale copy of it will be ' +
        'folded back over the current one');
    assert.strictEqual(legacy.store.tokenFor('gamma.my.salesforce.com').accessToken,
        'refreshed');
}

console.log('oauth refresh regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
