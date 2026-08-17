/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Both buttons appear when signed out, and asking to sign in is what they do.
 *
 * Hiding them would say the feature does not exist, when what is missing is a
 * session - and would leave nothing on screen to act on. Showing them and
 * letting the click fail is worse still: the modal opens, queries, and reports
 * a refusal that says nothing about signing in.
 */

const core = fs.readFileSync('./js/ss-core.js', 'utf8');
const MODULES = {
    'All Fields': fs.readFileSync('./js/record-fields.js', 'utf8'),
    'Export': fs.readFileSync('./js/list-export.js', 'utf8')
};

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

function assertOrder(haystack, first, second, why) {
    const a = haystack.indexOf(first);
    const b = haystack.indexOf(second);
    assert.notStrictEqual(a, -1, 'missing "' + first + '": ' + why);
    assert.notStrictEqual(b, -1, 'missing "' + second + '": ' + why);
    assert.ok(a < b, '"' + first + '" must come before "' + second + '": ' + why);
}

function main() {

    /* ------------------------------------------------------------------ */
    /* Neither button is gated on a session                                */
    /* ------------------------------------------------------------------ */

    for (const [name, source] of Object.entries(MODULES)) {
        const mount = lift(source, source.indexOf('function mountTab()') !== -1
            ? 'function mountTab()' : 'function mountButton()');
        assert.ok(!/ssHasSession/.test(mount),
            name + ': whether to show the button must not depend on a session - ' +
            'a hidden button says the feature does not exist');
    }

    /* ------------------------------------------------------------------ */
    /* A signed-out click raises the panel's own card                      */
    /*                                                                     */
    /* Not a prompt of its own inside a full-screen modal - that put a      */
    /* screen of nothing over the card asking for the session, and was a    */
    /* second sign-in to keep in step with the one that already knows every */
    /* way in.                                                              */
    /* ------------------------------------------------------------------ */

    for (const [name, source] of Object.entries(MODULES)) {
        const handler = /button\.addEventListener\('click', function \(event\) \{[\s\S]*?\n        \}\);/
            .exec(source)[0];

        assert.ok(/ssOpenSignIn\(\)/.test(handler),
            name + ': a signed-out click raises the existing card');
        assert.ok(/if \(!signedIn\(\) &&[\s\S]{0,80}ssOpenSignIn\(\)\) \{\s*return;/.test(handler),
            name + ': and stops there - opening the modal too would cover the card ' +
            'that is asking for the session');

        const openCall = /togglePanel\(\)|openModal\(\)/.exec(handler)[0];
        assert.ok(handler.indexOf('ssOpenSignIn()') < handler.indexOf(openCall),
            name + ': the card is raised before the modal would open');

        /*
         * And if it cannot be raised - no panel on this page - the click
         * carries on and opens the modal, which shows the org's own refusal.
         * A worse message than the card, but better than a dead button.
         */
        const decideOpen = (has, raised) => {
            let opened = false;
            new Function('signedIn', 'ssOpenSignIn', openCall.replace('()', ''),
                handler
                    .replace(/button\.addEventListener\('click', function \(event\) \{/, 'return (function (event) {')
                    .replace(/\}\);$/, '})')
                    .replace(/event\.\w+\(\);/g, '') + '')
                (() => has, () => raised, () => { opened = true; })({});
            return opened;
        };
        assert.strictEqual(decideOpen(true, false), true, name + ': signed in, it opens');
        assert.strictEqual(decideOpen(false, true), false,
            name + ': signed out and the card is up, it does not');
        assert.strictEqual(decideOpen(false, false), true,
            name + ': signed out with no card to raise, it opens anyway rather than ' +
            'doing nothing');
    }

    /* ------------------------------------------------------------------ */
    /* And an opened modal is never empty                                  */
    /*                                                                     */
    /* The click falls through to the modal when the card cannot be raised. */
    /* With nothing rendered for that case it opened with a header and an   */
    /* empty body - which is exactly "it shows nothing".                    */
    /* ------------------------------------------------------------------ */

    for (const [name, source] of Object.entries(MODULES)) {
        const draw = lift(source, source.indexOf('function render()') !== -1
            ? 'function render()' : 'function drawModal()');
        assert.ok(/signedOutNote\(\)/.test(draw),
            name + ': a signed-out modal says so rather than opening blank');
        assert.ok(/if \(!signedIn\(\)\) \{[\s\S]{0,120}?return;/.test(draw),
            name + ': and draws nothing below it - a field list or a query box ' +
            'with nowhere to send anything is furniture');

        const note = lift(source, 'function signedOutNote()');
        assert.ok(/Not signed in to this org/.test(note), name + ': it says what is wrong');
        assert.ok(/launcher/.test(note),
            name + ': and where to go, since the card could not be raised from here');
        assert.ok(/ssOpenSignIn\(\)/.test(note),
            name + ': with a retry, in case the panel has appeared since');
        assert.ok(/closePanel\(\);|closeModal\(\);/.test(note),
            name + ': which gets out of the way when it works');
    }

    /* No second prompt survives anywhere. */
    assert.ok(!/ssSignInPrompt/.test(core + MODULES['All Fields'] + MODULES.Export),
        'the duplicate prompt is gone, not merely unused');
    assert.ok(!fs.existsSync('./css/signin-prompt.css'),
        'and its stylesheet with it');
    assert.ok(!JSON.parse(fs.readFileSync('./manifest.json', 'utf8'))
        .content_scripts[0].css.includes('/css/signin-prompt.css'),
        'and it is not still being loaded');

    /* ------------------------------------------------------------------ */
    /* The card knows why it was raised                                    */
    /*                                                                     */
    /* Two things raise it and they are not the same errand. Raised from    */
    /* the org picker it is "Add another org"; raised from these buttons    */
    /* there is no session at all - and a signed-out user clicking Export   */
    /* was being told they were adding another org.                        */
    /* ------------------------------------------------------------------ */

    const open = lift(core, 'function ssOpenSignIn()');
    assert.ok(/requestSignIn\('session'\)/.test(open),
        'the modules say why they raised it');

    /*
     * And the rail is opened with the panel. SimplifiedMainModal lives inside
     * #mySidenav, which is 0 wide and clipping until the launcher opens it -
     * so showing the modal alone leaves the panel unusable behind a rail that
     * is not there.
     */
    assert.ok(/ssOpenMenu\(\)/.test(open),
        'raising the card opens the rail it lives in');
    assertOrder(open, 'ssOpenMenu()', "panel.style.display = 'block'",
        'before the modal is shown, not after');


    const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
    assert.ok(/requestSignIn\('add'\)/.test(controller),
        'and the org picker says its own reason');
    assert.ok(/\$scope\.signInReason = reason \|\| 'session';/.test(controller),
        'with a sensible default - an unexplained request is a session request, ' +
        'not an org being added');

    const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
    const flat = view.replace(/'\s*\+\s*\n\s*'/g, '');
    const headings = [...flat.matchAll(/<h3 ng-show="([^"]*)">([^<]*)<\/h3>/g)]
        .map((m) => ({ gate: m[1].replace(/\\'/g, "'"), text: m[2] }));
    const shown = (state) => headings
        .filter((h) => new Function('s', 'with (s) { return !!(' + h.gate + '); }')(
            new Proxy(state, { has: () => true, get: (t, k) => t[k] })))
        .map((h) => h.text);

    assert.deepStrictEqual(shown({ signInReason: 'add', hasOrgLoginTarget: () => true }),
        ['Add another org'], 'the picker still gets its own title');
    /*
     * The other reason gets one title, whatever the org situation. The org is
     * named once on this card - under "This org", where it is the answer to a
     * question the buttons ask - not in the title as well.
     */
    for (const state of [{ signInReason: 'session', hasOrgLoginTarget: () => true },
                         { signInReason: 'session', hasOrgLoginTarget: () => false },
                         { signInReason: '', hasOrgLoginTarget: () => false }]) {
        assert.deepStrictEqual(shown(state), ['Sign in to continue'],
            'anything that is not adding an org is simply signing in: ' +
            JSON.stringify(state.signInReason));
    }

    /* Exactly one title shows at a time, and the org is not in it. */
    assert.strictEqual(headings.length, 2, 'two titles, found ' + headings.length);
    headings.forEach((h) => {
        assert.ok(!/orgLoginHost|orgLoginOrigin/.test(h.text),
            'no title names the org - a my-domain host wraps it onto three ' +
            'lines: ' + h.text);
    });

    console.log('signed out buttons test passed');
}

main();
