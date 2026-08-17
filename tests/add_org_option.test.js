/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Adding an org from the picker.
 *
 * The picker listed orgs this browser had already been in, and there was no
 * way to reach one it had not. The sign-in card only appears when there is no
 * session at all, so anyone already signed in to one org could not add a
 * second without going and opening it in a tab first.
 *
 * Two halves, and the second is the one that made the first pointless: the
 * OAuth path reloaded without recording the org, and the picker is built from
 * the stored briefs - so "add another org" signed in successfully and the org
 * still was not in the list afterwards. The session-id path already did this;
 * OAuth never had it.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');

function lift(signature) {
    const start = controller.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0;
    for (let i = controller.indexOf('{', start); i < controller.length; i++) {
        if (controller[i] === '{') { depth++; }
        else if (controller[i] === '}') { depth--; if (depth === 0) { return controller.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

function switcher(startOrigin) {
    const calls = [];
    const $scope = {
        currentOrigin: startOrigin,
        knownOrgs: [{ origin: 'https://acme.my.salesforce.com' }],
        setLoginTarget: (k) => calls.push('target:' + k),
        // The real one is lifted and exercised below; here it only has to
        // record that switchOrg reached for it rather than for resumeSignIn,
        // which alone leaves the card gated behind !hasSession.
        requestSignIn: function(){ calls.push('request'); this.signInError = ''; },
        resumeSignIn: () => calls.push('resume'),
        signInError: 'something stale'
    };
    const location = { href: 'chrome-extension://x/simplified.html', reloads: 0 };
    const env = {
        $scope,
        sessionSelectionKeyFor: (o) => 'sel:' + o,
        window: {
            sessionStorage: { removeItem: (k) => calls.push('forget:' + k) },
            location: {
                get href() { return location.href; },
                set href(v) { location.href = v; calls.push('navigate'); },
                reload: () => { location.reloads++; calls.push('reload'); }
            }
        },
        URL
    };
    const src =
        "var ADD_ORG = '__ss_add_org__';\n" +
        '$scope.addOrgOption = ADD_ORG;\n' +
        'var chosenOrigin = ' + JSON.stringify(startOrigin) + ';\n' +
        lift('$scope.switchOrg = function(){') + ';\n' +
        'return { scope: $scope, chosen: function(){ return chosenOrigin; } };';
    const api = new Function(...Object.keys(env), src)(...Object.values(env));
    return { api, calls, location, $scope };
}

const ACME = 'https://acme.my.salesforce.com';

function main() {

    /* ------------------------------------------------------------------ */
    /* Picking the entry opens sign-in instead of switching                */
    /* ------------------------------------------------------------------ */

    {
        const s = switcher(ACME);
        s.$scope.currentOrigin = '__ss_add_org__';
        s.api.scope.switchOrg();

        assert.ok(!s.calls.includes('navigate'), 'it must not navigate - there is no such org');
        assert.ok(!s.calls.includes('reload'), 'nor reload');
        assert.ok(s.calls.includes('request'), 'the sign-in card is asked for');
        assert.ok(!s.calls.includes('resume'),
            'through requestSignIn, not resumeSignIn - the latter only clears the ' +
            'dismissal and leaves the card gated behind !hasSession');
        assert.strictEqual(s.$scope.signInError, '', 'with a stale error cleared first');

        /*
         * Production, not "This org". "This org" resolves to the one already
         * on screen, which is the one thing "add another" cannot mean.
         */
        assert.ok(s.calls.includes('target:production'),
            'and aimed somewhere other than the org already open: ' + s.calls.join(', '));
        assert.ok(!s.calls.some((c) => c === 'target:org'), 'never at this org');

        /* The select goes back, or the action sits there looking like an org. */
        assert.strictEqual(s.$scope.currentOrigin, ACME,
            'the selection is restored, since this entry is an action not a choice');
    }

    /* An ordinary switch still switches, and remembers where it went. */
    {
        const s = switcher(ACME);
        s.$scope.currentOrigin = 'https://acme--sandbox1.my.salesforce.com';
        s.api.scope.switchOrg();
        assert.ok(s.calls.includes('navigate'), 'a real org still navigates');
        assert.ok(s.calls.some((c) => c.startsWith('forget:')),
            'and still drops that org\'s remembered selection');
        assert.strictEqual(s.api.chosen(), 'https://acme--sandbox1.my.salesforce.com',
            'the new org becomes what "add another org" would return to');
    }

    /* Nothing selected is still nothing to do. */
    {
        const s = switcher(ACME);
        s.$scope.currentOrigin = null;
        s.api.scope.switchOrg();
        assert.deepStrictEqual(s.calls, [], 'an empty selection does nothing at all');
    }

    /* ------------------------------------------------------------------ */
    /* The entry is in the list, and only in the picker's copy of it        */
    /* ------------------------------------------------------------------ */

    assert.ok(/ng-options="org\.origin as org\.label for org in orgOptions"/.test(view),
        'the select is built from orgOptions');
    assert.ok(!/ng-options="[^"]*in knownOrgs"/.test(view),
        'not from knownOrgs, which is the answer to a different question - orgLoginOrigin ' +
        'falls back to its first entry, and an action in there becomes an org');

    /* The control can no longer hide, or the only way to add an org hides with it. */
    const select = /<select id="ssOrgPicker"[^>]*>/.exec(view.replace(/'\+\n'\s*/g, ''));
    assert.ok(select, 'the picker must still exist');
    assert.ok(!/ng-show|ng-if/.test(select[0]),
        'it is shown even when empty, because the last entry is how it stops being empty: ' +
        select[0]);

    /*
     * And chosenOrigin starts at the org the page opened on.
     *
     * Without this the first pick of "Add another org" reverts the select to
     * null - so the card opens over a picker showing nothing, and the org on
     * screen is no longer the one named in it.
     */
    const init = /\$scope\.currentOrigin = context\.origin \|\| null;\s*(?:\/\/[^\n]*\n\s*)*chosenOrigin = \$scope\.currentOrigin;/
        .test(controller);
    assert.ok(init,
        'the standalone init must seed chosenOrigin from the org it resolved');

    /* Built from knownOrgs plus one, with wording that fits both cases. */
    const build = /\$scope\.orgOptions = \$scope\.knownOrgs\.concat\(\[\{([\s\S]*?)\}\]\);/.exec(controller);
    assert.ok(build, 'orgOptions must be knownOrgs plus the entry');
    assert.ok(/origin: \$scope\.addOrgOption/.test(build[1]), 'carrying the sentinel as its value');
    assert.ok(/Add another org/.test(build[1]) && /Add an org/.test(build[1]),
        '"Add another org" reads oddly when there are none: ' + build[1].trim());

    /* ------------------------------------------------------------------ */
    /* The card actually opens                                             */
    /*                                                                     */
    /* It showed itself only when there was no session - which is exactly   */
    /* the state someone adding a *second* org is not in. The entry worked, */
    /* set its login target, and nothing appeared.                          */
    /* ------------------------------------------------------------------ */

    const evaluate = (expr, state) => new Function('s',
        'with (s) { return !!(' + expr.replace(/\\'/g, "'") + '); }')(new Proxy(state, {
            has: () => true, get: (t, k) => t[k]
        }));

    const overlay = /this\.signinoverlay = '<div class="ssSignInOverlay" ng-if="([^"]*)"/.exec(view);
    assert.ok(overlay, 'the sign-in overlay must still exist');

    assert.ok(evaluate(overlay[1], { hasSession: false, signInDismissed: false }),
        'no session still raises it on its own');
    assert.ok(evaluate(overlay[1], { hasSession: true, signInRequested: true, signInDismissed: false }),
        'and so does asking for it while signed in - the reported bug');
    assert.ok(!evaluate(overlay[1], { hasSession: true, signInDismissed: false }),
        'but it does not appear unasked over a working session');
    assert.ok(!evaluate(overlay[1], { hasSession: true, signInRequested: true, signInDismissed: true }),
        'and closing it closes it');

    /*
     * The page is not locked for an errand. No session means nothing works
     * until it is dealt with; adding an org leaves what is on screen usable.
     */
    const locked = [...view.matchAll(/ng-class="\{ssLocked: ([^}]*)\}"/g)].map((m) => m[1]);
    assert.ok(locked.length >= 1, 'the locked state must still exist');
    locked.forEach((expr) => {
        assert.ok(!/signInRequested/.test(expr),
            'asking to add an org must not lock the page behind the card: ' + expr);
        assert.ok(evaluate(expr, { hasSession: false, signInDismissed: false }),
            'while no session still does: ' + expr);
    });

    /* The flags themselves. */
    const request = new Function('$scope',
        lift('$scope.requestSignIn = function(reason){') + ';return $scope.requestSignIn;');
    const dismiss = new Function('$scope',
        lift('$scope.dismissSignIn = function(){') + ';return $scope.dismissSignIn;');

    const flags = { signInRequested: false, signInDismissed: true, signInError: 'old' };
    request(flags)();
    assert.strictEqual(flags.signInRequested, true, 'asking marks it asked for');
    assert.strictEqual(flags.signInDismissed, false, 'and un-dismisses a card closed earlier');
    assert.strictEqual(flags.signInError, '', 'with a stale error cleared');

    dismiss(flags)();
    assert.strictEqual(flags.signInDismissed, true, 'closing closes');
    assert.strictEqual(flags.signInRequested, false,
        'and forgets the request, or the card reopens on the next digest');

    /* switchOrg must go through it, not through the plain resume. */
    const sw = lift('$scope.switchOrg = function(){');
    assert.ok(/requestSignIn\('add'\)/.test(sw),
        'the picker entry must request the card, since resumeSignIn alone leaves ' +
        'it gated behind !hasSession - and say it is adding an org, or the card ' +
        'titles itself as a plain sign-in');

    /* ------------------------------------------------------------------ */
    /* And it says what it is for                                          */
    /* ------------------------------------------------------------------ */

    const flat = view.replace(/'\+\n'\s*/g, '');
    const headings = [...flat.matchAll(/<h3 ng-show="([^"]*)">([^<]*)<\/h3>/g)]
        .map((m) => ({ gate: m[1], text: m[2] }));
    /*
     * Two now, not three. The "sign in to <org>" variant went with the org out
     * of the title - it is named once on this card, under "This org".
     */
    assert.strictEqual(headings.length, 2, 'two headings, found ' + headings.length);

    const shownWhen = (state) => headings.filter((h) => evaluate(h.gate, state)).map((h) => h.text);

    assert.deepStrictEqual(
        shownWhen({ signInReason: 'add', hasOrgLoginTarget: () => true }),
        ['Add another org'],
        'adding an org must not be titled with the org already open - that is the ' +
        'one org it cannot mean');
    assert.deepStrictEqual(
        shownWhen({ signInReason: 'session', hasOrgLoginTarget: () => true }),
        ['Sign in to continue'],
        'and every other reason is simply signing in - the org is named once on ' +
        'this card, under "This org"');

    /* Exactly one explanation at a time, and never the wrong one. */
    const whys = [...flat.matchAll(/<p class="ssSignInWhy" ng-show="([^"]*)">([\s\S]*?)<\/p>/g)]
        .map((m) => ({ gate: m[1], text: m[2] }));
    assert.strictEqual(whys.length, 2, 'two explanations, found ' + whys.length);

    const adding = whys.filter((w) => evaluate(w.gate,
        { signInRequested: true, hasOrgLoginTarget: () => true, isStandalonePage: true }));
    assert.strictEqual(adding.length, 1, 'one explanation while adding');
    assert.ok(!/not signed in to it/.test(adding[0].text),
        'and not the one that says this page is locked out - it is not: ' + adding[0].text);

    /* ------------------------------------------------------------------ */
    /* Signing in actually adds it                                         */
    /* ------------------------------------------------------------------ */

    const signIn = lift('$scope.signIn = function(){');
    assert.ok(/ssUpdateBrief\(/.test(signIn),
        'the OAuth path must record the org, or the picker never hears about it and ' +
        '"add another org" appears to do nothing');
    assert.ok(signIn.indexOf('ssUpdateBrief(') < signIn.indexOf('window.location.reload()'),
        'before the reload, or the reload races the write - the same bug the ' +
        'session-id path already had');

    /* And the session-id path still does its own. */
    assert.ok(/ssUpdateBrief\(\{[\s\S]*?signedInWith: 'sessionId'/.test(controller),
        'the session-id path keeps recording its own');

    console.log('add org option test passed');
}

main();
