/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Which metadata list you are on, written into the address bar.
 *
 * It buys three things from one change: back and forward move between the
 * lists you actually visited, a reload lands where you were, and a link to a
 * particular list can be sent to someone else. The page already does this for
 * the org - ?org= travels in the URL so that switching org is a navigation -
 * and ?type= is the same idea one level down.
 *
 * The constraint that matters is where it must NOT happen. On an org page the
 * panel is injected into Salesforce's own single-page app, and that URL
 * belongs to Lightning's router. Pushing history entries there would leave the
 * user with a back button that does something other than what it says, and it
 * would do so in someone else's application - a far worse failure than not
 * having the feature.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

function lift(signature) {
    const start = controller.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0, i = controller.indexOf('{', start);
    for (; i < controller.length; i++) {
        if (controller[i] === '{') { depth++; }
        else if (controller[i] === '}') { depth--; if (depth === 0) { return controller.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

/*
 * A history stack the cases can walk, so back and forward are exercised rather
 * than assumed from the fact that pushState was called.
 */
function browser(standalone, startUrl) {
    const stack = [startUrl];
    let at = 0;

    const read = () => {
        const url = new URL(stack[at], 'https://ext.invalid/');
        return { pathname: url.pathname, search: url.search };
    };

    const win = {
        location: read(),
        history: {
            pushState(state, title, url) {
                // A real browser drops the forward entries when you navigate
                // from a rewound position; without that, "forward" after a
                // back-then-click would go somewhere the user never was.
                stack.splice(at + 1);
                stack.push(url);
                at = stack.length - 1;
                Object.assign(win.location, read());
            }
        },
        addEventListener() {}
    };

    const $scope = { isStandalonePage: standalone };
    const env = { $scope, window: win, URLSearchParams };
    const api = new Function(...Object.keys(env),
        'var urlNavigating = false;\n' +
        lift('function urlSelection(){') + '\n' +
        lift('function syncUrlForMetadata(value){') + '\n' +
        'return { selection: urlSelection, sync: syncUrlForMetadata };'
    )(...Object.values(env));

    return {
        open: (value) => api.sync(value),
        type: () => api.selection(),
        url: () => stack[at],
        entries: () => stack.length,
        back: () => { if (at > 0) { at--; Object.assign(win.location, read()); } },
        forward: () => { if (at < stack.length - 1) { at++; Object.assign(win.location, read()); } }
    };
}

const ORG = '/simplified.html?org=https%3A%2F%2Facme.my.salesforce.com';

function main() {

    /* ------------------------------------------------------------------ */
    /* The standalone page records where you are                           */
    /* ------------------------------------------------------------------ */

    const page = browser(true, ORG);
    page.open('ApexClass');
    assert.ok(/type=ApexClass/.test(page.url()), 'opening a list writes it to the URL');
    assert.ok(/org=https/.test(page.url()),
        'and the chosen org survives - it is read from the same params rather than ' +
        'rebuilt, so changing list never silently moves org: ' + page.url());

    page.open('Flow');
    assert.ok(/type=Flow/.test(page.url()), 'and the next one replaces it');
    assert.strictEqual(page.entries(), 3, 'each is its own history entry');

    /* Re-opening what is already on screen is not a navigation. */
    page.open('Flow');
    assert.strictEqual(page.entries(), 3,
        'opening the list already open adds no entry - otherwise the back button ' +
        'walks through duplicates of the same page');

    /* ------------------------------------------------------------------ */
    /* Back and forward move between the lists actually visited            */
    /* ------------------------------------------------------------------ */

    page.back();
    assert.strictEqual(page.type(), 'ApexClass', 'back returns to the previous list');
    page.back();
    assert.strictEqual(page.type(), null, 'and again to where there was no list yet');
    page.forward();
    assert.strictEqual(page.type(), 'ApexClass', 'forward retraces it');

    /* ------------------------------------------------------------------ */
    /* And never on an org page                                            */
    /*                                                                     */
    /* The panel is injected into Salesforce's own app there. Its URL is    */
    /* Lightning's, and pushing onto it breaks navigation in an application */
    /* that is not ours.                                                    */
    /* ------------------------------------------------------------------ */

    const injected = browser(false, '/lightning/page/home');
    injected.open('ApexClass');
    assert.strictEqual(injected.url(), '/lightning/page/home',
        "the org page's URL must be untouched - this is Lightning's router, not ours");
    assert.strictEqual(injected.entries(), 1, 'and no history entry is pushed');
    assert.strictEqual(injected.type(), null,
        'nor is a type read from a URL that was never ours to write');

    /* ------------------------------------------------------------------ */
    /* The URL outranks the restored session on load                       */
    /*                                                                     */
    /* Of the three things that can decide what opens - the URL, the        */
    /* session, the recommendation - only the URL could have been typed,    */
    /* bookmarked or arrived at with the back button. It is the only one    */
    /* that is a statement rather than an inference.                        */
    /* ------------------------------------------------------------------ */

    const startup = lift('function openInitialMetadata(){');
    const urlAt = startup.indexOf('urlSelection()');
    const sessionAt = startup.indexOf('restoreSessionSelection()');
    const favouriteAt = startup.indexOf('openFavouriteMetadata()');

    assert.notStrictEqual(urlAt, -1, 'the startup path must consult the URL');
    assert.ok(urlAt < sessionAt,
        'the URL must be checked before the restored session, or arriving by ' +
        'back button lands on whatever the tab was last showing instead');
    assert.ok(sessionAt < favouriteAt,
        'and the session still outranks the recommendation, as it did before');

    /* ------------------------------------------------------------------ */
    /* Going back must not push the page it just left                      */
    /* ------------------------------------------------------------------ */

    assert.ok(/urlNavigating/.test(lift('function syncUrlForMetadata(value){')),
        'the push must be suppressed while restoring from a history entry, or ' +
        'going back re-pushes the old page and the button never gets anywhere');

    const listener = controller.slice(controller.indexOf("addEventListener('popstate'"));
    assert.ok(/urlNavigating = true/.test(listener.slice(0, 600)),
        'and the popstate handler is what suppresses it');
    assert.ok(/ssIsStandalonePage\(\)/.test(
        controller.slice(controller.indexOf("addEventListener('popstate'") - 300,
                         controller.indexOf("addEventListener('popstate'"))),
        'the listener is only attached on the standalone page');

    console.log('url navigation test passed');
}

main();
