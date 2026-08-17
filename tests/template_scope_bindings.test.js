/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Templates against the controller that has to satisfy them.
 *
 * Every panel in this extension is a template string on ViewService, bound to
 * MenuAndDetailsCtrl's scope. Angular resolves those bindings at render time
 * and says nothing when one does not exist: an ng-click naming a function the
 * controller does not have is not an error, it is a button that does nothing,
 * and an ng-if on a property that was never set is a panel that never appears.
 * Both fail silently, in the browser, on somebody else's org.
 *
 * The names are written in two files that nothing else joins up, so this test
 * is the join: every handler a template calls must exist on the scope, and the
 * flags the sign-in flow turns on must be the flags the templates test.
 */

const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');

/*
 * Every controller the extension loads, read from the manifest rather than
 * listed here.
 *
 * The templates are one file but no longer one controller: the panels the
 * menu opens bring their own, nested. A hardcoded list meant that adding a
 * controller made this test fail on handlers that were perfectly well
 * defined - which teaches people to edit the test rather than believe it.
 */
const controller = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'))
    .content_scripts[0].js
    .filter((file) => /controllers\//.test(file))
    .map((file) => fs.readFileSync('.' + file, 'utf8'))
    .join('\n');

function assignedOnScope(name) {
    return new RegExp('\\$scope\\.' + name + '\\s*=').test(controller);
}

/* ------------------------------------------------------------------ */
/* Every ng-click and ng-change handler is a function on the scope      */
/*                                                                      */
/* ng-change fails exactly as quietly as ng-click: a checkbox whose     */
/* handler does not exist still ticks, still looks like it did          */
/* something, and simply never runs the work it was there to trigger.   */
/* ------------------------------------------------------------------ */

const handlers = new Set();
for (const match of view.matchAll(/ng-(?:click|change)=\\?"([A-Za-z_$][\w$]*)\s*\(/g)) {
    handlers.add(match[1]);
}

// A floor, so a refactor that empties the templates cannot pass by finding
// nothing to check.
assert.ok(handlers.size > 20, `expected many ng-click handlers, found ${handlers.size}`);

const orphanHandlers = [...handlers].filter((name) => !assignedOnScope(name));
assert.deepStrictEqual(
    orphanHandlers, [],
    'ng-click handlers with no $scope function in MenuAndDetailsCtrl: ' + orphanHandlers.join(', ')
);

/* ------------------------------------------------------------------ */
/* The sign-in dismissal path is wired end to end                       */
/*                                                                      */
/* The overlay can be closed, and closing it has to reveal the notice   */
/* that explains what still works - one flag, read by both, plus the    */
/* way back. If any half of this goes missing the user is left either   */
/* with an overlay they cannot close or a blank panel with no reason    */
/* given.                                                               */
/* ------------------------------------------------------------------ */

for (const fn of ['dismissSignIn', 'resumeSignIn', 'openTrustStatus']) {
    assert.ok(assignedOnScope(fn), `${fn} must be defined on the controller scope`);
}

assert.ok(
    /\$scope\.signInDismissed\s*=\s*false/.test(controller),
    'signInDismissed must start false, or the overlay never shows'
);

/*
 * The "your own Connected App" box must never arrive holding the extension's
 * own key.
 *
 * SS_AUTH.clientId falls back to SS_CONNECTED_APP_CLIENT_ID, so assigning it
 * straight into clientIdInput put the shipped key in the field asking for the
 * org's - the form looked already filled in, and the key it showed is the one
 * the org had just rejected. A key the user saved earlier must still show.
 */
/* The bootstrap body, which is a named function now - slicing forward from
 * the ssAuthReady() call stopped finding it when that function moved above
 * the call site. */
const bootstrapAt = controller.indexOf('function beginPanel()');
const prefill = controller.slice(
    bootstrapAt,
    controller.indexOf('refreshSessionState();', bootstrapAt)
);
assert.ok(
    /clientIdInput\s*=/.test(prefill),
    'the sign-in bootstrap must still decide what clientIdInput starts as'
);
assert.ok(
    /SS_CONNECTED_APP_CLIENT_ID/.test(prefill),
    'clientIdInput must be compared against the shipped key, not assigned unconditionally'
);
assert.ok(
    !/\$scope\.clientIdInput\s*=\s*\$scope\.clientId\s*;/.test(prefill),
    'clientIdInput must not be assigned the resolved clientId outright - that is the shipped key by default'
);

const overlay = view.slice(view.indexOf('this.signinoverlay ='), view.indexOf('this.signedoutnotice ='));
/*
 * Evaluated rather than pinned to one spelling. This asserted the exact
 * expression, so adding a second way to open the card - the "Add another org"
 * entry, which needs it to open while a session exists - failed here for a
 * reason that has nothing to do with dismissal.
 */
const overlayGate = /ng-if="([^"]*)"/.exec(overlay);
assert.ok(overlayGate, 'the overlay must still be gated');
const showsOverlay = (state) => new Function('s',
    'with (s) { return !!(' + overlayGate[1] + '); }')(new Proxy(state, {
        has: () => true, get: (t, k) => t[k]
    }));
assert.ok(showsOverlay({ hasSession: false, signInDismissed: false }),
    'no session raises the overlay');
assert.ok(!showsOverlay({ hasSession: false, signInDismissed: true }),
    'the overlay must hide once it has been dismissed');
assert.ok(!showsOverlay({ hasSession: true, signInRequested: true, signInDismissed: true }),
    'including one that was asked for');
assert.ok(
    /ng-click="dismissSignIn\(\)"/.test(overlay),
    'the overlay must offer a way to close it'
);

const notice = view.slice(view.indexOf('this.signedoutnotice ='), view.indexOf('this.newstimeline ='));
assert.ok(
    /ng-if="!hasSession && signInDismissed/.test(notice),
    'the signed-out notice must appear exactly when the overlay has been dismissed without a session'
);
assert.ok(
    /openTrustStatus\(\)/.test(notice),
    'the notice must be able to send the user to Trust Status'
);

/*
 * The notice tells a signed-out user that Trust Status still works. That is
 * only true because loadStatus falls back to the Trust API's My Domain lookup
 * when it cannot resolve the instance key through SOQL. Lose that fallback
 * and the notice is sending people to a panel that will show them an error.
 */
const trust = fs.readFileSync('./js/angular/services/TrustService.js', 'utf8');
const loadStatus = trust.slice(trust.indexOf('this.loadStatus ='), trust.indexOf('this.getStatus ='));
assert.ok(
    /fetchStatusByAlias/.test(loadStatus),
    'loadStatus must fall back to the My Domain alias - the signed-out notice promises Trust Status works with no session'
);
assert.ok(
    /instanceAliases\//.test(trust),
    'the alias lookup must target the Trust API instanceAliases endpoint'
);

/* ------------------------------------------------------------------ */
/* Escape closes the popup                                              */
/* ------------------------------------------------------------------ */

assert.ok(
    /addEventListener\('keydown'[\s\S]{0,80}true\)/.test(controller),
    'the Escape handler must be bound on the capture phase, ahead of Salesforce\'s own'
);
assert.ok(
    /removeEventListener\('keydown'/.test(controller),
    'the Escape handler must be removed on $destroy'
);

/* ------------------------------------------------------------------ */
/* Every template is reachable, and every template builds               */
/*                                                                      */
/* A template property that no directive renders is dead weight with no */
/* symptom: it is still a string literal built on every Salesforce page */
/* the extension loads on, and nothing ever puts it on screen. Two had  */
/* accumulated that way - a whole alternate layout and an empty stub.    */
/*                                                                      */
/* Building the service is the other half. The templates concatenate    */
/* module-level icon URLs, so a global removed while a template still   */
/* refers to it does not fail at parse time; it fails when the service  */
/* is constructed, or silently renders the text "undefined" into the    */
/* markup. Constructing it here catches both.                           */
/* ------------------------------------------------------------------ */

const vm = require('vm');

const templateProperties = new Set();
for (const match of view.matchAll(/^this\.(\w+)\s*=/gm)) {
    templateProperties.add(match[1]);
}

const directives = fs.readFileSync('./js/angular/directives.js', 'utf8');
const registered = new Set();
for (const match of directives.matchAll(/:\s*'(\w+)'/g)) {
    registered.add(match[1]);
}

const orphanTemplates = [...templateProperties].filter((name) => !registered.has(name)).sort();
assert.deepStrictEqual(
    orphanTemplates, [],
    'these viewservice templates are not rendered by any directive, so they are built on every ' +
    'page load and never shown: ' + orphanTemplates.join(', ')
);

const moduleStub = {
    service(name, deps) {
        moduleStub.factory = (typeof deps === 'function') ? deps : deps[deps.length - 1];
    }
};
const context = {
    window: { app: moduleStub },
    angular: { module: () => moduleStub },
    chrome: { runtime: { getURL: (path) => 'chrome-extension://test' + path } },
    console
};
vm.createContext(context);
vm.runInContext(view, context);

assert.ok(moduleStub.factory, 'viewservice must still register itself');
const service = new moduleStub.factory({ byValue: () => null });

const built = Object.keys(service).filter((key) => typeof service[key] === 'string');
assert.ok(built.length > 15, `expected many templates, built ${built.length}`);

// A template that concatenates a global which no longer exists renders the
// characters "undefined" into the page rather than failing.
const brokenInterpolation = built.filter((key) => service[key].includes('undefined'));
assert.deepStrictEqual(
    brokenInterpolation, [],
    'these templates contain the literal "undefined", which means they concatenate a variable ' +
    'that is no longer defined: ' + brokenInterpolation.join(', ')
);

/* ------------------------------------------------------------------ */
/* The page and the panel are the same application                      */
/*                                                                      */
/* simplified.html differs from the injected panel only in its frame.   */
/* Everything below the header - the grid, the resizable rails, the     */
/* sticky search header, the stat tabs - has to be the same markup, and */
/* the way to guarantee that is for it to be the same string.           */
/*                                                                      */
/* They had already drifted once: the page carried a fixed 220px right  */
/* column after the panel grew a resizable one, and a footer with two   */
/* of its footer content. Sharing them fixed it; this keeps it fixed.   */
/* ------------------------------------------------------------------ */

const sharedMarkers = [
    'ss-modal-body',              // the body wrapper
    'ss-modal-grid',              // the nav/main grid
    'ss-modal-nav',
    'ss-right-sidebar-resizer',   // the resizable right rail
    'ss-sticky-header-container', // the sticky search header
    'modalfooter'
];
for (const marker of sharedMarkers) {
    assert.ok(service.content.includes(marker),
        `the panel should contain ${marker} - has the markup moved?`);
    assert.ok(service.page.includes(marker),
        `simplified.html must carry the panel's ${marker}; the page and panel share one body ` +
        'and footer precisely so they cannot drift apart');
}

/*
 * What the footer carries, on both.
 *
 * The headline and the coffee are the footer now. The three hour stats that
 * used to flank them - today, this week, this month - were never measured:
 * a hardcoded fifteen-minute seed plus login count times 1.8. They are gone,
 * and this stops them coming back on one surface and not the other, which is
 * exactly how the page and panel drifted apart the first time.
 */
for (const kept of ['ssnews', 'ss-coffee', 'Location']) {
    assert.ok(service.page.includes(kept), `the page footer must carry ${kept}`);
    assert.ok(service.content.includes(kept), `the panel footer must carry ${kept}`);
}

for (const invented of ['h today', 'h week', 'h month', 'hoursToday', 'hoursThisWeek', 'hoursThisMonth']) {
    assert.ok(!service.page.includes(invented),
        `the page footer must not report "${invented}" - it was never measured`);
    assert.ok(!service.content.includes(invented),
        `the panel footer must not report "${invented}" either`);
}

/*
 * The headline takes what is left, and the buttons hold their place.
 *
 * It used to take the whole bar, which was right when it was the only thing
 * in it. The watch-list and manifest counts sit there now, and they have to
 * be in the same place on every page - so the headline is the element that
 * gives way, not the one that pushes.
 */
const footer = service.content.slice(service.content.indexOf('modalfooter'));
assert.ok(/class="ss-foot-news"/.test(footer),
    'the headline is the flexible element in the footer');
assert.ok(/class="ss-foot-actions"/.test(footer),
    'and the counts have a place of their own beside it');

const footerCss = fs.readFileSync('./css/styles.css', 'utf8');
const newsRule = /\.theme-lightning \.ss-foot-news \{([^}]*)\}/.exec(footerCss);
assert.ok(newsRule && /flex:\s*1 1 auto/.test(newsRule[1]) && /min-width:\s*0/.test(newsRule[1]),
    'the headline shrinks rather than pushes: ' + (newsRule ? newsRule[1].trim() : 'no rule'));

const actionsRule = /\.theme-lightning \.ss-foot-actions,[\s\S]*?\{([^}]*)\}/.exec(footerCss);
assert.ok(actionsRule && /flex:\s*0 0 auto/.test(actionsRule[1]),
    'and the buttons do not shrink - without this a long headline squeezes them ' +
    'and they land somewhere new on every page: ' +
    (actionsRule ? actionsRule[1].trim() : 'no rule'));

/*
 * Neither card is mounted any more. Removing the template but leaving the
 * element in the sidebar would be a silent no-op; leaving the element and
 * restoring the template would put the card back without anything noticing.
 */
for (const card of ['packagexml', 'bookmarkwatch']) {
    assert.ok(!new RegExp('<' + card + '>').test(service.content),
        card + ' must not be mounted in the sidebar - its count is in the footer');
    assert.ok(service['ss' + card] === undefined && service[card] === undefined,
        card + ' template must be gone too, not left as dead markup');
}

/*
 * The buttons carry a mark as well as a number. The number says how many; the
 * mark is what makes it findable at a glance, and the word beside it is what
 * makes it navigable for anyone who has not learnt the mark.
 */
for (const [handler, word] of [['openWatchingList', 'Watching'],
                               ['openPackageXml', 'package.xml']]) {
    const button = new RegExp('class="ss-foot-chip"[^>]*ng-click="' + handler +
        '\\(\\)[\\s\\S]{0,400}?</button>').exec(footer.replace(/'\s*\+\s*\n\s*'/g, ''));
    assert.ok(button, 'the ' + handler + ' button must be in the footer');
    assert.ok(/ss-foot-icon/.test(button[0]),
        handler + ' needs a visible mark, not a bare number: ' + button[0].slice(0, 140));
    assert.ok(button[0].includes(word),
        handler + ' says what it opens: ' + button[0].slice(0, 140));
}

/* One headline, capped, so the cut is the same on every screen. */
assert.ok(/visibleNews\[0\]/.test(service.ssnews),
    'a single headline at a time, not a run of them');
assert.ok(/limitTo:100/.test(service.ssnews),
    'capped at 100 characters in the template - the width alone would cut it in ' +
    'a different place on every screen');

// ...and none of the panel's frame.
for (const modalOnly of ['w3-modal-content', 'SimplifiedMainModalCloseBtn', 'ssFullScreenBtn']) {
    assert.ok(!service.page.includes(modalOnly),
        `simplified.html must not carry ${modalOnly} - it is a page, not a popup`);
}

// It should still arrive the way the panel does.
assert.ok(service.page.includes('w3-animate-opacity'),
    'the page should fade in like the panel');

/* ------------------------------------------------------------------ */
/* Functions the templates call in ng-show / ng-if                      */
/*                                                                      */
/* ng-click handlers are checked above; conditions are the more         */
/* dangerous half. A missing handler is a button that does nothing and  */
/* someone reports it. A missing condition evaluates to undefined,      */
/* which is falsy, so the element simply never appears - and nobody     */
/* reports a panel they have never seen.                                */
/*                                                                      */
/* That very nearly shipped: the right-hand rail was switched to        */
/* hasRightSidebar(selectedMetadata) in the templates while the         */
/* function failed to land in the controller, which would have hidden   */
/* the rail on every panel rather than showing it on three more.        */
/* ------------------------------------------------------------------ */

const conditionCalls = new Set();
for (const match of view.matchAll(/ng-(?:show|if)=\\?"([A-Za-z_$][\w$]*)\s*\(/g)) {
    conditionCalls.add(match[1]);
}
assert.ok(conditionCalls.size > 0, 'expected the templates to call functions in conditions');

const orphanConditions = [...conditionCalls].filter((name) => !assignedOnScope(name));
assert.deepStrictEqual(
    orphanConditions, [],
    'ng-show/ng-if call functions with no $scope definition, so they evaluate to undefined and ' +
    'the element is hidden forever: ' + orphanConditions.join(', ')
);

/* ------------------------------------------------------------------ */
/* The package.xml panel keeps its controls                            */
/*                                                                     */
/* Every one of these was lost at least once by an edit that replaced a */
/* neighbouring block and took this with it - the managed-package       */
/* buttons went that way while the checkboxes beside them were being    */
/* swapped for the add actions. They fail silently: the handler stays   */
/* on the scope, the markup is gone, and nothing complains.             */
/* ------------------------------------------------------------------ */

/*
 * Bounded by the next template declaration, whatever it happens to be.
 * Naming a specific one assumed a file order that is not guaranteed - and was
 * in fact wrong, giving an empty slice that failed for every control at once.
 */
const panelStart = view.indexOf('this.packagexmleditor = ');
assert.notStrictEqual(panelStart, -1, 'the package.xml panel template has gone');
const nextTemplate = view.slice(panelStart + 1).search(/^this\.\w+ = /m);
const packagePanel = view.slice(panelStart,
    nextTemplate === -1 ? undefined : panelStart + 1 + nextTemplate);

const packageControls = [
    ['removeManagedComponents()', 'removing managed components'],
    ['includeManagedComponents()', 'putting managed components back'],
    ['addRelatedComponents()', 'adding related components'],
    ['addReferencedComponents()', 'adding referenced components'],
    ['removeAddedComponents()', 'removing what the scans added'],
    ['removeTypeFromPackage(', 'removing a whole type'],
    ['retrievePackage()', 'retrieving the package'],
    ['downloadPackageXml()', 'downloading the manifest']
];

for (const [call, what] of packageControls) {
    assert.ok(packagePanel.includes(call),
        'the package.xml panel has lost its control for ' + what + ' (' + call + ')');
    const name = call.replace(/\(.*$/, '');
    assert.ok(assignedOnScope(name),
        call + ' is in the template but no controller defines ' + name);
}

console.log('template/scope binding regression test passed');
