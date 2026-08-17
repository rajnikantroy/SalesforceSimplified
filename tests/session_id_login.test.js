/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * Signing in with a session id.
 *
 * A session id is a bearer credential: whoever holds it is that user, with
 * that user's API access, until it expires. That makes the URL field next to
 * it the whole of the security boundary - someone following instructions from
 * a phishing page ("paste your session id and this URL to fix your org")
 * would otherwise hand their org to whoever wrote the page.
 *
 * So the two things checked hardest here are where the credential may be sent
 * and where it is allowed to rest. Neither is a detail: the first decides
 * whether the feature can be turned against the user, and the second decides
 * how long a stolen browser profile stays useful.
 */

const core = fs.readFileSync('./js/ss-core.js', 'utf8');

function load(options) {
    const opts = options || {};
    const stored = { session: opts.session || {}, local: {} };
    const writes = [];

    const chrome = {
        storage: {
            local: {
                get: (keys, cb) => cb({}),
                set: (bag, cb) => { Object.assign(stored.local, bag); if (cb) cb(); },
                remove: () => {}
            },
            session: {
                get: (keys, cb) => {
                    if (opts.noSessionStorage) { throw new Error('not available here'); }
                    cb(stored.session);
                },
                set: (bag, cb) => {
                    if (opts.noSessionStorage) { throw new Error('not available here'); }
                    writes.push(bag);
                    Object.assign(stored.session, bag);
                    if (cb) cb();
                },
                remove: (key) => { delete stored.session[key]; }
            }
        },
        runtime: { sendMessage: (m, cb) => cb && cb({}), lastError: null },
        cookies: { get: (d, cb) => cb(null) }
    };

    const context = {
        chrome,
        window: { location: { origin: 'https://example.lightning.force.com', href: '' } },
        document: { cookie: '' },
        location: { origin: 'https://example.lightning.force.com', hostname: 'example.lightning.force.com' },
        navigator: { userAgent: '' },
        console,
        setTimeout,
        clearTimeout,
        URL,
        Promise
    };
    context.self = context;
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(core, context);

    return { context, stored, writes };
}

async function main() {
    const { context, stored, writes } = load();
    const { ssIsSalesforceUrl, ssSignInWithSessionId, ssSessionId, ssForgetSessionId } = context;

    /* ------------------------------------------------------------------ */
    /* Where a session id may be sent                                      */
    /* ------------------------------------------------------------------ */

    const allowed = [
        'https://acme.my.salesforce.com',
        'https://acme.lightning.force.com',
        'https://acme.my.salesforce-setup.com',
        'https://acme--dev.sandbox.my.salesforce.com'
    ];
    for (const url of allowed) {
        assert.strictEqual(ssIsSalesforceUrl(url), true, url + ' is a Salesforce host');
    }

    /*
     * The refusals matter more than the acceptances. Each of these is a way
     * someone could be talked into sending their org's credential somewhere
     * it does not belong.
     */
    const refused = [
        ['https://evil.com', 'an unrelated host'],
        ['https://my.salesforce.com.evil.com', 'a suffix that only looks like Salesforce'],
        ['https://evil.com/?x=my.salesforce.com', 'a Salesforce name in the query, not the host'],
        ['https://evil.com#my.salesforce.com', 'a Salesforce name in the fragment'],
        /*
         * The one that separates checking the host from checking the string:
         * this URL ends in ".my.salesforce.com" and is served by evil.com. A
         * test against the whole URL passes it; a test against the hostname
         * does not.
         */
        ['https://evil.com/x.my.salesforce.com', 'a Salesforce name in the path'],
        ['https://evil.com/a#b.my.salesforce.com', 'a dotted Salesforce name in the fragment'],
        ['https://acme.my.salesforce.com.evil.com/', 'a host that merely starts with a real one'],
        ['http://acme.my.salesforce.com', 'plain http, which puts the session on the wire in clear'],
        ['javascript:alert(1)', 'a javascript URL'],
        ['data:text/html,x', 'a data URL'],
        ['acme.my.salesforce.com', 'no scheme at all'],
        ['', 'nothing'],
        [null, 'null']
    ];
    for (const [url, why] of refused) {
        assert.strictEqual(ssIsSalesforceUrl(url), false, 'must refuse ' + why + ': ' + url);
    }

    // And the guard is actually reached by the sign-in, not just exported.
    await assert.rejects(
        () => ssSignInWithSessionId('00Dxx0000001234!fake', 'https://evil.com'),
        /org URL/,
        'signing in at a non-Salesforce host is refused');
    assert.strictEqual(ssSessionId(), null,
        'a refused sign-in establishes no session');
    assert.strictEqual(writes.length, 0,
        'and writes nothing anywhere');

    await assert.rejects(() => ssSignInWithSessionId('', 'https://acme.my.salesforce.com'),
        /session id/, 'an empty session id is refused');

    /* ------------------------------------------------------------------ */
    /* Where it is allowed to rest                                         */
    /* ------------------------------------------------------------------ */

    await ssSignInWithSessionId('  00Dxx0000001234!fake  ', 'https://acme.my.salesforce.com/');
    assert.strictEqual(ssSessionId(), '00Dxx0000001234!fake',
        'the session is established, trimmed');
    assert.strictEqual(context.ssApiOrigin(), 'https://acme.my.salesforce.com',
        'requests go to the org the session came from, trailing slash removed');

    /*
     * chrome.storage.session is memory-backed: it never reaches disk and is
     * gone when the browser closes. chrome.storage.local is neither, which is
     * why the OAuth token lives there and this must not.
     */
    assert.ok(stored.session.ssPastedSession, 'the session id is kept in session storage');
    assert.deepStrictEqual(Object.keys(stored.local), [],
        'and never written to local storage, which is on disk and survives restarts');

    /* ------------------------------------------------------------------ */
    /* Ending it                                                           */
    /* ------------------------------------------------------------------ */

    ssForgetSessionId();
    assert.strictEqual(ssSessionId(), null, 'forgetting it ends the session');
    assert.strictEqual(stored.session.ssPastedSession, undefined,
        'and takes the stored copy with it');

    // Signing out must end a typed-in session too, or the user stays signed in
    // by a credential the button they pressed said nothing about.
    await ssSignInWithSessionId('00Dxx0000009999!fake', 'https://acme.my.salesforce.com');
    await context.ssSignOut();
    assert.strictEqual(ssSessionId(), null, 'sign-out ends a typed-in session');

    // An org that rejects the session discredits it, rather than leaving a
    // dead credential that hides the sign-in overlay and 401s on every panel.
    await ssSignInWithSessionId('00Dxx0000008888!fake', 'https://acme.my.salesforce.com');
    context.ssMarkSessionExpired();
    assert.strictEqual(ssSessionId(), null, 'an expired typed-in session is dropped');
    assert.strictEqual(stored.session.ssPastedSession, undefined,
        'and not left in storage to be restored on the next load');

    /* ------------------------------------------------------------------ */
    /* Restoring, and refusing to restore                                  */
    /* ------------------------------------------------------------------ */

    const good = load({ session: {
        ssPastedSession: { sid: '00Dxx0000007777!fake', instanceUrl: 'https://acme.my.salesforce.com' }
    } });
    await good.context.ssAuthReady();
    assert.strictEqual(good.context.ssSessionId(), '00Dxx0000007777!fake',
        'a stored session is restored on the next load');

    /*
     * Storage is re-checked on the way out, not trusted because it was
     * checked on the way in - anything with write access to the profile could
     * have changed it since.
     */
    const tampered = load({ session: {
        ssPastedSession: { sid: '00Dxx0000006666!fake', instanceUrl: 'https://evil.com' }
    } });
    await tampered.context.ssAuthReady();
    assert.strictEqual(tampered.context.ssSessionId(), null,
        'a stored session pointing off-org is refused on restore, not just on entry');

    /*
     * A content script cannot read session storage unless the whole area is
     * opened to untrusted contexts, which would widen exposure. It degrades to
     * memory for that page instead of erroring.
     */
    const noStore = load({ noSessionStorage: true });
    await noStore.context.ssAuthReady();
    await noStore.context.ssSignInWithSessionId('00Dxx0000005555!fake',
                                                'https://acme.my.salesforce.com');
    assert.strictEqual(noStore.context.ssSessionId(), '00Dxx0000005555!fake',
        'sign-in still works where session storage is unreachable');

    console.log('session id login regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
