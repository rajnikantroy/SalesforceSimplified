/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * Being told where the feature actually works.
 *
 * The injected panel acts as the org whose page it was opened on and has no
 * way to be pointed at another: signing in to a second org from the panel
 * does not move it. So a pipeline whose sender is any other origin - an org
 * signed in through the overlay, or the same org's my.salesforce.com host
 * while the panel sits on its Lightning page - cannot be run from there at
 * all, and the per-row "that org is not part of this pipeline" explains the
 * refusal without offering anywhere to go.
 *
 * simplified.html has the org picker, so it can. This is the rule for when
 * to say so, and the two ways of getting it wrong are both live: never
 * saying it leaves people stuck on a page of dead rows, and always saying it
 * puts an advert for another surface on top of a panel that works.
 */

const ROOT = path.join(__dirname, '..');
const controller = fs.readFileSync(
    path.join(ROOT, 'js/angular/controllers/MenuAndDetailsCtrl.js'), 'utf8');
const view = fs.readFileSync(
    path.join(ROOT, 'js/angular/services/ViewService.js'), 'utf8');

function lift(signature) {
    const at = controller.indexOf(signature);
    assert.ok(at > -1, signature + ' not found - it has been renamed or removed');

    let depth = 0;
    let started = false;
    for (let i = at; i < controller.length; i += 1) {
        if (controller[i] === '{') { depth += 1; started = true; }
        else if (controller[i] === '}') {
            depth -= 1;
            if (started && depth === 0) { return controller.slice(at, i + 1); }
        }
    }
    throw new Error('Could not find the end of ' + signature);
}

/* A panel on some org, holding the pipelines as SS_SYNC_STATE decorated them. */
function panel(options) {
    const settings = options || {};
    const sandbox = {
        $scope: {
            isStandalonePage: settings.standalone === true,
            sync: {
                /* Not `||`: the empty origin is a case this has to be able to
                 * set, and a default behind `||` swallows it. */
                here: 'here' in settings ? settings.here : 'https://acme.lightning.force.com',
                pipelines: settings.pipelines || []
            }
        }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(
        lift('$scope.syncNeedsFullPage = function(){') + ';\n' +
        lift('$scope.syncHereLabel = function(){') + ';', sandbox);
    return sandbox;
}

const ask = (box) => vm.runInContext('$scope.syncNeedsFullPage()', box);

/* Decorated by the worker: can this org send down this pipeline, or not. */
const canSend = () => ({ here: { canSend: true, source: {}, target: {} } });
const cannot = (why) => ({
    here: { canSend: false, reason: why || 'That org is not part of this pipeline.' }
});

/* ------------------------------------------------------------------ */
/* When there is nothing this panel can do                             */
/* ------------------------------------------------------------------ */

assert.strictEqual(ask(panel({ pipelines: [cannot()] })), true,
    'a panel with no runnable pipeline is pointed at the page that has a picker');

assert.strictEqual(ask(panel({ pipelines: [cannot(), cannot()] })), true,
    'and it stays pointed there however many pipelines are dead');

/*
 * The wrong-direction refusal counts too. A one-way pipeline pointed the
 * other way is not run from anywhere in this panel either, and the org that
 * could run it is one the full page can be pointed at.
 */
assert.strictEqual(
    ask(panel({ pipelines: [cannot('This pipeline only runs prod to sandbox.')] })), true,
    'a pipeline that only runs the other way leaves the panel just as stuck');

/* ------------------------------------------------------------------ */
/* When it can, it says nothing                                        */
/* ------------------------------------------------------------------ */

assert.strictEqual(ask(panel({ pipelines: [canSend()] })), false,
    'a panel that can send is not sent somewhere else');

/*
 * One live pipeline is enough. The notice is about being stuck, and somebody
 * with a working pipeline in front of them is not - the dead rows next to it
 * carry their own explanation.
 */
assert.strictEqual(ask(panel({ pipelines: [cannot(), canSend(), cannot()] })), false,
    'one runnable pipeline is enough to keep the notice away');

/*
 * No pipelines at all is a different problem with a different answer, and
 * the page already gives it: make one. Sending somebody to another surface
 * to look at the same emptiness helps nobody.
 */
assert.strictEqual(ask(panel({ pipelines: [] })), false,
    'an empty pipeline list is answered by "add a pipeline", not by another page');

/* ------------------------------------------------------------------ */
/* Never on the page it points at                                      */
/* ------------------------------------------------------------------ */

/*
 * The whole content of the notice is "open the other surface". On that
 * surface it is a loop, and the reason for being stuck there is different:
 * the picker is right there and pointed at the wrong org.
 */
assert.strictEqual(ask(panel({ standalone: true, pipelines: [cannot(), cannot()] })), false,
    'the full page never tells somebody to open the full page');

/* ------------------------------------------------------------------ */
/* Naming the org it is stuck as                                       */
/* ------------------------------------------------------------------ */

/*
 * "This panel acts as the org whose page it is on" is abstract until it says
 * which. The scheme is dropped so it reads as the same kind of thing as the
 * pipeline labels directly below it, which are bare hostnames.
 */
const named = panel({ here: 'https://acme.lightning.force.com' });
assert.strictEqual(vm.runInContext('$scope.syncHereLabel()', named),
    'acme.lightning.force.com',
    'the org is named without its scheme, like the pipeline labels are');

const nowhere = panel({ here: '' });
assert.strictEqual(vm.runInContext('$scope.syncHereLabel()', nowhere), '',
    'and an unknown origin produces nothing rather than a stray dash');

/* ------------------------------------------------------------------ */
/* The template, and that the notice is reachable at all               */
/* ------------------------------------------------------------------ */

/*
 * The block is read out of the file and asserted against on its own. Searched
 * across the whole template these checks all pass on the header's own
 * "open in a new tab" button, which is a different control entirely - the
 * trap that has caught several of these tests already.
 */
const opened = view.indexOf('<div class="ss-sync-fullpage"');
assert.ok(opened > -1, 'the notice is not in the sync template at all');
const closed = view.indexOf("'</div>'+", opened);
assert.ok(closed > opened, 'the notice block is not closed');
const block = view.slice(opened, closed);

assert.ok(/ng-if="syncNeedsFullPage\(\)"/.test(block),
    'the notice is shown unconditionally - it must be gated on syncNeedsFullPage');

/*
 * And it opens on this page, not wherever the standalone tab was last left.
 * A bare openInNewTab() passes the argument-less path and lands on the
 * restored session, which is how somebody ends up being told to open another
 * surface and then having to navigate to Org Sync once they are there.
 */
assert.ok(/ng-click="openInNewTab\('SyncJobs'\)"/.test(block.replace(/\\'/g, "'")),
    'the notice does not open the full page on Org Sync & Jobs');

assert.ok(/syncHereLabel\(\)/.test(block),
    'the notice does not name the org the panel is stuck as');

/*
 * The binding has to exist. A notice whose only button calls a function that
 * is not on the scope is worse than no notice: it tells somebody the fix and
 * then does nothing when they take it.
 */
assert.ok(/\$scope\.openInNewTab\s*=\s*function/.test(controller),
    'openInNewTab is not on the scope, so the notice\'s button does nothing');

/*
 * Above the pipelines, not inside the repeat. Every row would otherwise
 * carry a copy of an answer that is the same for all of them.
 */
/* The pipelines became cards with a plain ng-repeat; this used to look for
 * the repeat-start of the three-row version. */
const repeat = view.indexOf('ng-repeat="p in sync.pipelines"');
assert.ok(repeat > -1, 'the pipeline repeat has moved - this check needs repointing');
assert.ok(opened < repeat,
    'the notice is inside the pipeline list, where it repeats once per row');

/*
 * Styled. Every rule in that stylesheet is scoped to .theme-lightning, and
 * an unstyled block here inherits the panel background - the amber panel
 * that makes it read as a notice simply would not appear.
 */
const css = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
assert.ok(/\.theme-lightning \.ss-sync-fullpage \{/.test(css),
    'ss-sync-fullpage has no themed rule, so the notice renders unstyled');


/* ------------------------------------------------------------------ */
/* Landing on the page that was asked for                              */
/* ------------------------------------------------------------------ */

/*
 * ?type= is the standalone page's own way of saying which page to open on,
 * and openInitialMetadata already lets it outrank the restored session. The
 * worker builds that address; these are the rules it has to get right.
 */
const background = fs.readFileSync(path.join(ROOT, 'js/background.js'), 'utf8');

function liftFrom(source, signature) {
    const at = source.indexOf(signature);
    assert.ok(at > -1, signature + ' not found - it has been renamed or removed');
    let depth = 0;
    let started = false;
    for (let i = at; i < source.length; i += 1) {
        if (source[i] === '{') { depth += 1; started = true; }
        else if (source[i] === '}') {
            depth -= 1;
            if (started && depth === 0) { return source.slice(at, i + 1); }
        }
    }
    throw new Error('Could not find the end of ' + signature);
}

const PAGE = 'chrome-extension://abc/simplified.html';
const worker = {
    chrome: { runtime: { getURL: (p) => 'chrome-extension://abc/' + p } },
    URL: URL,
    console: console
};
worker.globalThis = worker;
vm.createContext(worker);
vm.runInContext("const PAGE_URL = 'simplified.html';\n" +
    liftFrom(background, 'function standalonePageUrl(openOn, currentUrl) {'), worker);

const built = (openOn, current) => vm.runInContext(
    'standalonePageUrl(' + JSON.stringify(openOn === undefined ? null : openOn) + ', ' +
    JSON.stringify(current === undefined ? null : current) + ')', worker);

assert.strictEqual(built('SyncJobs', null), PAGE + '?type=SyncJobs',
    'a fresh tab opens straight on the page that was asked for');

/*
 * The org in an already-open tab is not disturbed. Rebuilding the address
 * from scratch drops ?org=, which moves somebody halfway through a deploy to
 * a different org - a far worse outcome than the navigation this was for.
 */
assert.strictEqual(
    built('SyncJobs', PAGE + '?org=https%3A%2F%2Facme.my.salesforce.com'),
    PAGE + '?org=https%3A%2F%2Facme.my.salesforce.com&type=SyncJobs',
    'the org an open tab is pointed at survives being sent to another page');

/* Already on some other page: that one is replaced, not appended to. */
assert.strictEqual(built('SyncJobs', PAGE + '?type=ApexClass'), PAGE + '?type=SyncJobs',
    'the page it was on is replaced rather than leaving two type= values');

/*
 * No page asked for is the header button, which has always opened the page
 * wherever it was left. Defaulting it to somewhere would change a control
 * that was not the subject of any of this.
 */
assert.strictEqual(built(null, PAGE + '?type=ApexClass'), PAGE + '?type=ApexClass',
    'asking for no particular page leaves an open tab exactly where it was');
assert.strictEqual(built(null, null), PAGE,
    'and opens the bare page when there is no tab to leave alone');

/*
 * A tab whose address cannot be parsed still gets somewhere. Throwing here
 * would reject the message, and the panel would fall back to window.open -
 * survivable, but this is a URL the browser itself handed us.
 */
assert.strictEqual(built('SyncJobs', 'not a url at all'), PAGE + '?type=SyncJobs',
    'an unparseable tab address falls back to the page rather than throwing');

/* ------------------------------------------------------------------ */
/* The tab that is already open is moved, not just focused             */
/* ------------------------------------------------------------------ */

/*
 * The address builder above is only half of it. Somebody who already has the
 * standalone page open in another tab is the common case, and focusing that
 * tab while leaving it on whatever page it was showing is exactly the
 * complaint this was asked to fix - so openStandaloneTab is driven here with
 * a stub browser, and what it did to the tab is read back.
 */
function browser(tabs) {
    const calls = { updated: null, created: null, focused: null };
    const box = {
        chrome: {
            runtime: { getURL: (p) => 'chrome-extension://abc/' + p, lastError: null },
            tabs: {
                query: (q, cb) => cb(tabs),
                update: (id, props, cb) => { calls.updated = { id: id, props: props }; cb && cb(); },
                create: (props, cb) => { calls.created = props; cb && cb(); }
            },
            windows: {
                update: (id, props, cb) => { calls.focused = id; cb && cb(); }
            }
        },
        URL: URL,
        Promise: Promise,
        calls: calls
    };
    box.globalThis = box;
    vm.createContext(box);
    vm.runInContext("const PAGE_URL = 'simplified.html';\n" +
        liftFrom(background, 'function standalonePageUrl(openOn, currentUrl) {') + '\n' +
        liftFrom(background, 'function openStandaloneTab(openOn) {'), box);
    return box;
}

/* An open tab sitting on a different page, asked for Org Sync. */
const sitting = browser([{ id: 7, windowId: 2, url: PAGE + '?type=ApexClass' }]);
vm.runInContext("openStandaloneTab('SyncJobs')", sitting);
assert.strictEqual(sitting.calls.created, null,
    'a second standalone tab was opened when one was already there');
assert.ok(sitting.calls.updated, 'the open tab was not touched at all');
assert.strictEqual(sitting.calls.updated.id, 7);
assert.strictEqual(sitting.calls.updated.props.active, true,
    'the tab is not brought to the front');
assert.strictEqual(sitting.calls.updated.props.url, PAGE + '?type=SyncJobs',
    'the open tab is focused but left on the page it was already showing');
assert.strictEqual(sitting.calls.focused, 2, 'its window is not brought forward');

/*
 * Already on Org Sync: focused, and deliberately not navigated. Assigning the
 * same address still reloads the tab, which would throw away a staged job
 * being read and any scroll position, to arrive back where it already was.
 */
const already = browser([{ id: 7, windowId: 2, url: PAGE + '?type=SyncJobs' }]);
vm.runInContext("openStandaloneTab('SyncJobs')", already);
assert.strictEqual(already.calls.updated.props.url, undefined,
    'a tab already on the right page is reloaded rather than just focused');
assert.strictEqual(already.calls.updated.props.active, true,
    'and it is still brought to the front');

/* Nothing open: a new tab, straight onto the page asked for. */
const fresh = browser([]);
vm.runInContext("openStandaloneTab('SyncJobs')", fresh);
assert.ok(fresh.calls.created, 'no tab was created when none existed');
assert.strictEqual(fresh.calls.created.url, PAGE + '?type=SyncJobs',
    'a new tab does not open on the page that was asked for');

/*
 * The header button, which asks for nothing. It has always opened the page
 * wherever it was left, and nothing here was meant to change that.
 */
const plain = browser([{ id: 7, windowId: 2, url: PAGE + '?type=ApexClass' }]);
vm.runInContext('openStandaloneTab()', plain);
assert.strictEqual(plain.calls.updated.props.url, undefined,
    'the header button now drags an open tab to a different page');

/* ------------------------------------------------------------------ */
/* The page travels under a name the dispatcher will not eat           */
/* ------------------------------------------------------------------ */

/*
 * `type` is already the field that says which message this is. A page sent
 * under that name would be read as a message kind, and the handler for
 * SS_OPEN_STANDALONE_PAGE would never run at all.
 */
assert.ok(/openStandaloneTab\(message\.openOn\)/.test(background),
    'the worker does not pass the requested page through to openStandaloneTab');
assert.ok(!/type:\s*'SS_OPEN_STANDALONE_PAGE',\s*type:/.test(controller),
    'the page must not be sent as `type` - that is the message kind');
assert.ok(/type:\s*'SS_OPEN_STANDALONE_PAGE',\s*openOn:/.test(
        controller.replace(/\s+/g, ' ').replace(/ /g, ' ')) ||
    /'SS_OPEN_STANDALONE_PAGE',[\s\S]{0,40}openOn:/.test(controller),
    'the panel does not send the requested page to the worker');

/*
 * And the value it sends is one the standalone page can resolve. ?type= is
 * looked up with MetaDataContainer.byValue, so a value with no entry there
 * lands on the restored session and the whole trip is silently pointless.
 */
const container = fs.readFileSync(
    path.join(ROOT, 'js/angular/services/MetaDataContainer.js'), 'utf8');
assert.ok(/value:\s*"SyncJobs"/.test(container),
    'SyncJobs is not a MetaDataContainer value, so ?type=SyncJobs resolves to nothing');

/*
 * The standalone page has to actually honour it on a cold load. This is the
 * branch that makes ?type= outrank the restored session; without it the tab
 * opens whereever it was left and the notice's button achieves nothing.
 */
assert.ok(/var fromUrl = urlSelection\(\);[\s\S]{0,220}MetaDataContainer\.byValue\(fromUrl\)/
        .test(controller),
    'the standalone page no longer opens on ?type=, so landing on a page cannot work');


console.log('sync_fullpage: ok');
