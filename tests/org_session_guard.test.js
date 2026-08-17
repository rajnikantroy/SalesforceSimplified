/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * A session belongs to one org.
 *
 * SS_AUTH is restored from storage before the standalone page knows which org
 * it is showing: the token and any typed-in session are loaded first, and the
 * org is resolved afterwards. ssTokenBelongsToThisOrg guards the token by
 * comparing the stored instance against window.location.hostname - which on
 * simplified.html is the extension id. ssOrgKey returns null for that, the
 * check gives the benefit of the doubt, and the token is adopted whatever org
 * it came from. The typed-in session was never checked against an org at all;
 * it only had to be some Salesforce host.
 *
 * With one org that is invisible. With several it is the whole complaint:
 * open the page while it resolves to sandbox1, and it is holding production's
 * credential - so the lists are refused, or worse, answered by production.
 */

const core = fs.readFileSync('./js/ss-core.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

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

/* The real functions, over a settable SS_ORIGIN and SS_AUTH. */
function world(origin, auth) {
    const state = { SS_ORIGIN: origin, SS_AUTH: Object.assign({}, auth) };
    const body =
        /var SS_ORG_HOSTS = [^\n]*\n/.exec(core)[0] +
        lift(core, 'function ssOrgKey(hostname)') + '\n' +
        lift(core, 'function ssHostOf(url)') + '\n' +
        lift(core, 'function ssOrgLabel()') + '\n' +
        lift(core, 'function ssDropForeignCredentials()') + '\n' +
        lift(core, 'function ssSessionId()') + '\n' +
        lift(core, 'function ssHasSession()') + '\n' +
        'return { drop: ssDropForeignCredentials, sessionId: ssSessionId, ' +
        'hasSession: ssHasSession, label: ssOrgLabel, auth: SS_AUTH };';
    return new Function('SS_ORIGIN', 'SS_AUTH', 'SS_SESSION_EXPIRED', 'readCookie', body)(
        state.SS_ORIGIN, state.SS_AUTH, false, () => null);
}

const PROD = 'https://acme.my.salesforce.com';
const SANDBOX = 'https://acme--sandbox1.my.salesforce.com';

function main() {

    /* ------------------------------------------------------------------ */
    /* A credential from another org is dropped                            */
    /* ------------------------------------------------------------------ */

    {
        const w = world(SANDBOX, { accessToken: 'prod-token', instanceUrl: PROD });
        assert.strictEqual(w.hasSession(), true, 'before: the page believes it is signed in');
        w.drop();
        assert.strictEqual(w.auth.accessToken, null,
            "production's token must not be used against sandbox1");
        assert.strictEqual(w.auth.instanceUrl, null, 'and its instance goes with it');
        assert.strictEqual(w.hasSession(), false,
            'so the page knows it is not signed in - which is what raises the sign-in card');
    }

    {
        const w = world(SANDBOX, { pastedSession: 'prod-sid', pastedInstanceUrl: PROD });
        w.drop();
        assert.strictEqual(w.auth.pastedSession, null,
            'a typed-in session is a credential too, and was never checked against an org');
    }

    /* ------------------------------------------------------------------ */
    /* A credential for this org is kept                                   */
    /* ------------------------------------------------------------------ */

    {
        const w = world(SANDBOX, { accessToken: 'sbx', instanceUrl: SANDBOX,
                                   pastedSession: 'sbx-sid', pastedInstanceUrl: SANDBOX });
        w.drop();
        assert.strictEqual(w.auth.accessToken, 'sbx', 'the right org keeps its token');
        assert.strictEqual(w.auth.pastedSession, 'sbx-sid', 'and its typed-in session');
    }

    /*
     * Same org, different host. Lightning, Setup and Visualforce are all this
     * org - dropping a token because the page came from lightning.force.com and
     * the token from my.salesforce.com would sign the user out of themselves.
     */
    for (const [pageHost, tokenHost] of [
        ['https://acme--sandbox1.lightning.force.com', SANDBOX],
        ['https://acme--sandbox1.my.salesforce-setup.com', SANDBOX],
        [SANDBOX, 'https://acme--sandbox1.lightning.force.com']
    ]) {
        const w = world(pageHost, { accessToken: 'same-org', instanceUrl: tokenHost });
        w.drop();
        assert.strictEqual(w.auth.accessToken, 'same-org',
            pageHost + ' and ' + tokenHost + ' are one org');
    }

    /* A sandbox is not its production org. This is the case that motivated it. */
    {
        const w = world(PROD, { accessToken: 'sbx', instanceUrl: SANDBOX });
        w.drop();
        assert.strictEqual(w.auth.accessToken, null, 'sandbox1 is not production');
    }

    /* ------------------------------------------------------------------ */
    /* Not knowing is not a mismatch                                       */
    /* ------------------------------------------------------------------ */

    {
        // No org resolved yet: nothing to compare against, so nothing is
        // dropped. Dropping here would sign the user out on every page that
        // is not an org page, including the panel before it is injected.
        const w = world('chrome-extension://abcdef/simplified.html',
            { accessToken: 'keep', instanceUrl: PROD });
        w.drop();
        assert.strictEqual(w.auth.accessToken, 'keep', 'an unresolved page drops nothing');
    }

    {
        // An unreadable instance is not evidence. Leave it and let the request
        // fail on its own terms rather than discard what may be the right one.
        const w = world(SANDBOX, { accessToken: 'keep', instanceUrl: null });
        w.drop();
        assert.strictEqual(w.auth.accessToken, 'keep', 'no instance recorded, so no verdict');
    }

    /* The org's own cookie session is never touched - the service worker read
     * it for this origin, so it cannot belong to another. */
    {
        const w = world(SANDBOX, { cookieSession: 'sbx-cookie', accessToken: 'prod', instanceUrl: PROD });
        w.drop();
        assert.strictEqual(w.auth.cookieSession, 'sbx-cookie', 'the cookie stands');
        assert.strictEqual(w.hasSession(), true, 'and it is still a way in');
    }

    /* ------------------------------------------------------------------ */
    /* It runs where the org becomes known                                 */
    /* ------------------------------------------------------------------ */

    const resolve = lift(core, 'function ssResolveStandaloneOrg()');
    assert.ok(/ssDropForeignCredentials\(\)/.test(resolve),
        'the drop must happen when the org is resolved, or it never happens at all');
    assert.ok(resolve.indexOf('ssAdoptOrg(') < resolve.indexOf('ssDropForeignCredentials()'),
        'and after adopting it - it compares against SS_ORIGIN');

    /*
     * hasSession has to be re-read after that, or the card never appears.
     *
     * The bootstrap is a named function now rather than an inline callback,
     * so this reads its body wherever it sits instead of slicing forward
     * from the ssAuthReady() call - which stopped containing it the moment
     * the function moved above the call.
     */
    const ready = lift(controller, 'function beginPanel()');
    assert.ok(ready.indexOf('refreshSessionState();') > -1,
        'the session state is re-read once auth has settled');

    /*
     * And it runs whichever way ssAuthReady settles.
     *
     * refreshSessionState is the only thing that ever turns hasSession off,
     * and hasSession starts true so the overlay does not flash. Hung off the
     * success path alone, a chain that never settles leaves the panel
     * believing in a session it has not got - no overlay, no error, nothing
     * at all, which is what a first-time user reported.
     */
    assert.ok(/\$q\.when\(ssAuthReady\(\)\)\.then\(beginPanel, beginPanel\)/.test(controller),
        'the panel starts only when auth resolves, so a failure to establish ' +
        'the session leaves it silently assuming there is one');

    /*
     * ssResolveStandaloneOrg must settle whatever happens inside it. Both
     * paths that reached resolve() only on success produced a pending
     * promise rather than a failed one, and nothing anywhere watches for
     * that.
     */
    assert.ok(/ssResolveUserFromIdentity\(\)\.then\(function \(\) \{[\s\S]{0,120}\}, function \(\) \{/
        .test(resolve),
        'a failed identity lookup leaves the startup promise pending forever');
    assert.ok(/setTimeout\(function \(\) \{ settle\(null\); \}/.test(resolve),
        'a worker that never calls back leaves the startup promise pending forever');
    assert.ok(/clearTimeout\(giveUp\)/.test(resolve),
        'the give-up timer is never cancelled, so it fires after a good answer');

    /* ------------------------------------------------------------------ */
    /* And the card says which org                                         */
    /* ------------------------------------------------------------------ */

    /*
     * Evaluated, not pinned. There are three headings now - adding an org has
     * its own - and asserting one exact gate string breaks whenever another is
     * added without saying anything about which one shows when.
     */
    const headings = [...view.replace(/'\+\n'\s*/g, '')
        .matchAll(/<h3 ng-show="([^"]*)">([^<]*)<\/h3>/g)]
        .map((m) => ({ gate: m[1], text: m[2] }));
    /*
     * The gates come out of a JavaScript string literal, so their quotes are
     * still escaped. Evaluating them as-is is a SyntaxError, not a failed
     * assertion - which reads as the card being broken rather than the matcher.
     */
    const shown = (state) => headings
        .filter((h) => new Function('s',
            'with (s) { return !!(' + h.gate.replace(/\\'/g, "'") + '); }')(
            new Proxy(state, { has: () => true, get: (t, k) => t[k] })))
        .map((h) => h.text);

    /*
     * One title, and it does not name the org. The org is on this card once,
     * under "This org", where it is the answer to a question the buttons ask -
     * and a my-domain host in the title wraps it onto three lines.
     */
    for (const target of [true, false]) {
        assert.deepStrictEqual(shown({ hasOrgLoginTarget: () => target }),
            ['Sign in to continue'],
            'signing in is signing in, whether or not an org can be named');
    }

    /*
     * Chosen by which one shows, not by which comes first in the file. Adding
     * an org has its own explanation and it is written above this one, so
     * taking the first match tested the wrong paragraph.
     */
    const whys = [...view.replace(/'\+\n'\s*/g, '')
        .matchAll(/<p class="ssSignInWhy" ng-show="([^"]*)">([\s\S]*?)<\/p>/g)]
        .map((m) => ({ gate: m[1], text: m[2] }));
    const whyShown = (state) => whys
        .filter((w) => new Function('s',
            'with (s) { return !!(' + w.gate.replace(/\\'/g, "'") + '); }')(
            new Proxy(state, { has: () => true, get: (t, k) => t[k] })));

    const lockedOut = whyShown({ hasOrgLoginTarget: () => true, isStandalonePage: true });
    assert.strictEqual(lockedOut.length, 1, 'exactly one explanation when not signed in');
    /*
     * It no longer names the org. The org is in the Org list above this card
     * and again under "This org" below it; a third mention in the paragraph
     * was the same fact three times on one small card.
     */
    assert.ok(!/orgLoginHost|orgLoginOrigin/.test(lockedOut[0].text),
        'without repeating the org a third time: ' + lockedOut[0].text.trim());
    assert.ok(/not signed in/i.test(lockedOut[0].text), 'saying what is wrong');
    assert.ok(/Org list/.test(lockedOut[0].text),
        'and pointing at the switcher, since the answer is often a different org');

    /* Not in the panel, which was injected into its org and has nothing to explain. */
    assert.strictEqual(
        whyShown({ hasOrgLoginTarget: () => true, isStandalonePage: false }).length, 0,
        'the panel gets no such explanation');

    /*
     * orgLoginHost is gone with the title that used it. The org appears once
     * on this card - as the origin under "This org", which is the answer to a
     * question the buttons ask - and nowhere else.
     */
    assert.ok(!/orgLoginHost/.test(controller),
        'the host helper is removed, not left as dead code');
    assert.ok(!/orgLoginHost/.test(view),
        'and nothing still binds to it');

    const hint = /<p class="ssLoginHint" ng-show="([^"]*)">\{\{orgLoginOrigin\(\)\}\}<\/p>/
        .exec(view.replace(/'\s*\+\s*\n\s*'/g, ''));
    assert.ok(hint, 'the org is still shown where "This org" needs explaining');
    // The gate comes out of a string literal, so its quotes are escaped.
    assert.ok(/loginTarget === \\?'org\\?'/.test(hint[1]),
        'and only there - under the target it is the answer to: ' + hint[1]);

    console.log('org session guard test passed');
}

main();
