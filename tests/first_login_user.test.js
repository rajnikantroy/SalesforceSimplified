/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The user is identified on a first login.
 *
 * __getUserId looks in five places. Two of them - UserContext and
 * SFDCSessionVars - are page globals, and index.js runs as an ISOLATED
 * content script, so on an org page it sees its own empty window and those
 * branches can never answer. That leaves the uid cookie, the chosen-user
 * cookie, and disco; on the first visit after a login none of the three is
 * set yet.
 *
 * The result was not an error message. It was a panel that came up with an
 * empty "'s Apex Classes (0)" beside a full org-wide list - which reads as an
 * empty org, not as an unidentified user, and every user-scoped query
 * silently ran as WHERE LastModifiedById = ''.
 */

const core = fs.readFileSync('./js/ss-core.js', 'utf8');
const index = fs.readFileSync('./index.js', 'utf8');
const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));

function lift(source, signature) {
    const start = source.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') { depth++; }
        else if (source[i] === '}') { depth--; if (depth === 0) { return source.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

/* A world for the two real functions, with the org's answer stubbed. */
function world(options) {
    const cookies = Object.assign({}, options.cookies);
    const calls = { identity: 0, verifyUser: 0, lookupFailed: 0 };
    const env = {
        SS_ORIGIN: options.origin === undefined ? 'https://acme.my.salesforce.com' : options.origin,
        readCookie: (name) => cookies[name] || null,
        setCookie: (name, value, days) => {
            if (days < 0) { delete cookies[name]; } else { cookies[name] = value; }
        },
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        ssSessionId: () => options.sid === undefined ? '00Dxx!fake' : options.sid,
        ssAuthReady: () => options.authReady === false
            ? Promise.reject(new Error('no auth')) : Promise.resolve(null),
        fetch: (url, init) => {
            calls.identity++;
            calls.identityUrl = url;
            calls.identityAuth = init && init.headers && init.headers.Authorization;
            if (options.identityFails) { return Promise.reject(new Error('network')); }
            if (options.identityStatus === 403) { return Promise.resolve({ ok: false }); }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(options.identity) });
        },
        verifyUser: () => { calls.verifyUser++; },
        // __getUserId also swaps the launcher icon on its way through.
        $: () => ({ attr: () => {}, text: () => '' }),
        // Real, or the SFDCSessionVars branch throws ReferenceError and
        // __getUserId's own try/catch swallows it - skipping the fallback
        // below and making this test fail for a reason the browser has not got.
        window: {},
        selectedLauncherColor: null,
        DEFAULT_LAUNCHER_COLOR: 'icons/launcher.png',
        markUserLookupFailed: () => { calls.lookupFailed++; },
        Promise
    };
    const body =
        lift(core, 'function ssResolveUserFromIdentity()') + '\n' +
        'var _ssUserReady = null;\n' +
        lift(core, 'function ssUserReady()') + '\n' +
        lift(index, 'function __getUserId(){') + '\n' +
        'return { ssUserReady: ssUserReady, __getUserId: __getUserId, ' +
        'ssResolveUserFromIdentity: ssResolveUserFromIdentity, calls: calls, cookies: cookies };';
    return new Function(...Object.keys(env), 'calls', 'cookies', body)(
        ...Object.values(env), calls, cookies);
}

async function main() {

    /* ------------------------------------------------------------------ */
    /* The premise: those two branches really are unreachable              */
    /*                                                                     */
    /* If index.js ran in the MAIN world, UserContext would answer and none */
    /* of this would be needed - so the fix rests on this staying true.     */
    /* ------------------------------------------------------------------ */

    const orgScript = manifest.content_scripts.find((c) => (c.js || []).includes('index.js'));
    assert.ok(orgScript, 'index.js must still be a content script');
    assert.notStrictEqual(orgScript.world, 'MAIN',
        'index.js runs isolated, which is why UserContext cannot answer');
    assert.ok(/UserContext/.test(index),
        'the page-global branches are still there - this test explains why they do not fire');

    /* ------------------------------------------------------------------ */
    /* First login: nothing local knows, so the org is asked               */
    /* ------------------------------------------------------------------ */

    {
        const w = world({ cookies: {}, identity: { user_id: '005xx0000012345', name: 'Ada Lovelace' } });
        assert.strictEqual(await w.ssUserReady(), '005xx0000012345', 'the org answers');
        assert.strictEqual(w.calls.identity, 1, 'exactly once');
        assert.ok(/\/services\/oauth2\/userinfo$/.test(w.calls.identityUrl),
            'via userinfo, which needs no Chatter and no extra permission: ' + w.calls.identityUrl);
        assert.strictEqual(w.calls.identityAuth, 'Bearer 00Dxx!fake',
            'presenting the session we already have');
        assert.strictEqual(w.cookies.uid, '005xx0000012345',
            'and it lands in the cookie the rest of the code reads, so nothing downstream changes');
        assert.strictEqual(w.cookies.SFDCSimplified_uname, 'Ada Lovelace', 'name included');
    }

    /* The whole point: __getUserId now recovers instead of returning false. */
    {
        const w = world({ cookies: {}, identity: { user_id: '005xx0000012345', name: 'Ada' } });
        w.__getUserId();
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        assert.strictEqual(w.calls.verifyUser, 1,
            'the card is filled once the org answers - this is the reported bug');
        assert.strictEqual(w.calls.lookupFailed, 0, 'and nothing is marked as failed');
    }

    /* ------------------------------------------------------------------ */
    /* A known user costs nothing                                          */
    /* ------------------------------------------------------------------ */

    for (const cookies of [{ uid: '005known' }, { ss_selected_uid: '005chosen' }]) {
        const w = world({ cookies, identity: { user_id: '005other' } });
        const id = await w.ssUserReady();
        assert.strictEqual(w.calls.identity, 0,
            'a known user is not re-fetched on every load: ' + JSON.stringify(cookies));
        assert.strictEqual(id, Object.values(cookies)[0], 'and is reported as-is');
    }

    /*
     * "View as different user" outranks the org's own answer. Without this a
     * background resolve would quietly put the real user back and the panel
     * would show one name while querying another.
     */
    {
        const w = world({ cookies: { ss_selected_uid: '005chosen' },
                          identity: { user_id: '005real', name: 'Real Person' } });
        await w.ssUserReady();
        assert.strictEqual(w.cookies.uid, undefined, 'a chosen user is never overwritten');

        /*
         * ssUserReady short-circuits on a known cookie, so that alone does not
         * exercise the guard. The standalone page calls the resolver directly
         * from its page-session handler whatever the cookies say - which is
         * where an unguarded write would silently restore the real user under
         * a panel still captioned with the chosen one.
         */
        await w.ssResolveUserFromIdentity();
        assert.strictEqual(w.cookies.uid, undefined,
            'and not even when the resolver is called directly');
        assert.strictEqual(w.cookies.SFDCSimplified_uname, undefined,
            'nor is the chosen name replaced by the real one');
    }

    /* With no override, that same direct call is what fills both cookies. */
    {
        const w = world({ cookies: {}, identity: { user_id: '005real', name: 'Real Person' } });
        await w.ssResolveUserFromIdentity();
        assert.strictEqual(w.cookies.uid, '005real', 'no override, so the answer is adopted');
        assert.strictEqual(w.cookies.SFDCSimplified_uname, 'Real Person');
    }

    /* Asked once per page, not once per caller. */
    {
        const w = world({ cookies: {}, identity: { user_id: '005xx' } });
        await Promise.all([w.ssUserReady(), w.ssUserReady(), w.ssUserReady()]);
        assert.strictEqual(w.calls.identity, 1, 'the answer is shared, not re-requested');
    }

    /* ------------------------------------------------------------------ */
    /* Failure stays quiet and stays null                                  */
    /*                                                                     */
    /* Org-wide lists work without a uid. A rejection here would take the   */
    /* whole panel down for something it can do without.                    */
    /* ------------------------------------------------------------------ */

    for (const [label, opts] of [
        ['the network fails', { identityFails: true }],
        ['the org refuses', { identityStatus: 403 }],
        ['there is no session', { sid: null }],
        ['auth never settles', { authReady: false }],
        ['the answer has no id', { identity: {} }],
        ['there is no origin', { origin: null }]
    ]) {
        const w = world(Object.assign({ cookies: {}, identity: { user_id: '005xx' } }, opts));
        assert.strictEqual(await w.ssUserReady(), null, label + ' -> null, not a rejection');
    }

    {
        const w = world({ cookies: {}, identityFails: true });
        w.__getUserId();
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        assert.strictEqual(w.calls.lookupFailed, 1,
            'and the card says so rather than sitting blank forever');
        assert.strictEqual(w.calls.verifyUser, 0, 'without querying for a user we cannot name');
    }

    /* ------------------------------------------------------------------ */
    /* Unknown user opens on the org-wide list                             */
    /* ------------------------------------------------------------------ */

    assert.ok(/\$scope\.userKnown = !!\(readCookie\('ss_selected_uid'\) \|\| readCookie\('uid'\)\);/.test(controller),
        'the controller decides from the same two cookies');
    assert.ok(/\$scope\.showmyview = \$scope\.userKnown;/.test(controller),
        'and the my-data view follows it rather than defaulting to on');
    /* And it turns itself on when the answer arrives, once. */
    const hook = lift(controller, 'if(typeof ssUserReady === \'function\'){');

    /*
     * Exactly one place may force it on, and that is the one below - which
     * runs only after the org has named the user. The "go to component"
     * shortcut used to do it unconditionally, which put the empty my-half
     * back for a session that still had no uid.
     */
    const forced = (controller.match(/\$scope\.showmyview = true;/g) || []).length;
    assert.strictEqual(forced, 1, 'only one unconditional showmyview, found ' + forced);
    assert.ok(hook.includes('$scope.showmyview = true;'),
        'and it is the one guarded by a resolved user');
    assert.ok(/\$q\.when\(ssUserReady\(\)\)/.test(hook),
        'wrapped in $q, or the scope change lands outside a digest and nothing repaints');
    assert.ok(/if\(!id \|\| \$scope\.userKnown\)\{ return; \}/.test(hook),
        'and it returns early for an already-known user, so it cannot undo a ' +
        'deliberate flick of the Show/Hide My Data switch');
    assert.ok(/detailsPopupOpenByOption/.test(hook),
        'a list opened before the answer arrived is reloaded, or its my-half stays empty');

    console.log('first login user test passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
