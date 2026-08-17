/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * The package.xml page after a reload.
 *
 * The selection lives in two maps and is summarised in a third thing -
 * packageMetaDataFrequency - which packageIsReady() reads and the manifest is
 * built from. Only the ticking path ever produced that summary, so a reload
 * restored the maps and left the summary empty: the sidebar badge said
 * "Apex Class 1", the footer chip said "1 package.xml", and the page itself
 * said "Nothing selected yet" over an empty manifest.
 *
 * Three views of one selection, and two of them agreed. This runs the real
 * restore against a fake localStorage and checks all three.
 */

const ROOT = path.join(__dirname, '..');
const controller = fs.readFileSync(
    path.join(ROOT, 'js/angular/controllers/MenuAndDetailsCtrl.js'), 'utf8');

function lift(name) {
    const at = controller.indexOf('function ' + name + '(');
    assert.ok(at > -1, name + ' not found - it has been renamed or removed');

    let depth = 0;
    let started = false;
    for (let i = at; i < controller.length; i += 1) {
        if (controller[i] === '{') { depth += 1; started = true; }
        else if (controller[i] === '}') {
            depth -= 1;
            if (started && depth === 0) { return controller.slice(at, i + 1); }
        }
    }
    throw new Error('Could not find the end of ' + name);
}

/* The same, for a function assigned onto the scope rather than declared. */
function liftAssigned(name) {
    const at = controller.indexOf('$scope.' + name + ' = function');
    assert.ok(at > -1, name + ' not found - it has been renamed or removed');

    let depth = 0;
    let started = false;
    for (let i = at; i < controller.length; i += 1) {
        if (controller[i] === '{') { depth += 1; started = true; }
        else if (controller[i] === '}') {
            depth -= 1;
            if (started && depth === 0) {
                return controller.slice(at, i + 1).replace('$scope.' + name + ' =', 'var ' + name + ' =');
            }
        }
    }
    throw new Error('Could not find the end of ' + name);
}

function fresh(stored) {
    const store = {};
    if (stored !== undefined) { store['ss_package_selection_acme'] = JSON.stringify(stored); }

    const sandbox = {
        window: {
            localStorage: {
                getItem: (k) => (k in store ? store[k] : null),
                setItem: (k, v) => { store[k] = String(v); },
                removeItem: (k) => { delete store[k]; }
            }
        },
        ssOrgKey: () => 'acme',
        SS_ORIGIN: 'https://acme.my.salesforce.com',
        URL: URL,
        manifestBuilds: 0,
        $scope: {
            selectedMetaForPackageXml: new Map(),
            packageMetaTypeAndName: new Map(),
            /* Deliberately stale: a rebuild must replace it, not append. */
            packageMetaDataFrequency: [{ Type: 'Stale', Frequency: 9 }]
        }
    };
    /*
     * The rebuild is counted rather than run: it needs the org's API version,
     * which no harness here has. What matters is that restoring asks for one.
     */
    sandbox.rebuildPackageXml = function () { sandbox.manifestBuilds += 1; };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(lift('packageSelectionKey') + '\n' +
        lift('buildPackageFrequency') + '\n' +
        lift('restorePackageSelection'), sandbox);
    return sandbox;
}

/* ------------------------------------------------------------------ */
/* A reload with something ticked                                      */
/* ------------------------------------------------------------------ */

const box = fresh([
    { k: '01p1', t: 'ApexClass', m: 'Test1' },
    { k: '01p2', t: 'ApexClass', m: 'Test2' },
    { k: '01I1', t: 'CustomObject', m: 'Invoice__c' }
]);
vm.runInContext('restorePackageSelection()', box);

/* The maps, which the badge and the footer chip count. */
assert.strictEqual(box.$scope.selectedMetaForPackageXml.size, 3,
    'every ticked component comes back');
assert.strictEqual(box.$scope.packageMetaTypeAndName.size, 2, 'grouped by type');

/*
 * The summary, which is what the page reads. This is the one that was
 * missing, and the reason the page said nothing was selected while the
 * counts beside it said otherwise.
 */
const summary = Array.from(box.$scope.packageMetaDataFrequency);
assert.strictEqual(summary.length, 2, 'the summary is rebuilt: ' + JSON.stringify(summary));
assert.ok(!summary.some(function (row) { return row.Type === 'Stale'; }),
    'and replaced rather than appended to');

const byType = {};
summary.forEach(function (row) { byType[row.Type] = row.Frequency; });
assert.strictEqual(byType.ApexClass, 2, 'with the right count per type');
assert.strictEqual(byType.CustomObject, 1);

/*
 * And the manifest text, which needs the resolved API version and so cannot
 * be built synchronously - but must be asked for, or the editor stays empty
 * under a page that now says three components are selected.
 */
assert.strictEqual(box.manifestBuilds, 1, 'the manifest is rebuilt too');

/* ------------------------------------------------------------------ */
/* A reload with nothing ticked                                        */
/* ------------------------------------------------------------------ */

/*
 * Nothing stored is nothing to rebuild. Running the build anyway would
 * replace the summary with an empty one and ask for a manifest of nothing -
 * work with no reader, on every single page load.
 */
const empty = fresh(undefined);
vm.runInContext('restorePackageSelection()', empty);
assert.strictEqual(empty.manifestBuilds, 0, 'no stored selection asks for no manifest');
assert.strictEqual(Array.from(empty.$scope.packageMetaDataFrequency).length, 1,
    'and leaves the summary alone');

/* Nor does an empty list, or unreadable storage. */
const none = fresh([]);
vm.runInContext('restorePackageSelection()', none);
assert.strictEqual(none.manifestBuilds, 0);

/*
 * And rows that are all unusable.
 *
 * This is the case the size guard is actually for: storage holds something,
 * so the early return on an empty list does not fire, but every row is
 * skipped and the maps end up empty. Rebuilding then replaces the summary
 * with nothing and asks for a manifest of nothing.
 */
const rubbish = fresh([{ nothing: true }, null, { t: 'ApexClass' }]);
vm.runInContext('restorePackageSelection()', rubbish);
assert.strictEqual(rubbish.$scope.packageMetaTypeAndName.size, 0,
    'nothing usable was restored');
assert.strictEqual(rubbish.manifestBuilds, 0,
    'so no manifest is asked for');
assert.strictEqual(Array.from(rubbish.$scope.packageMetaDataFrequency).length, 1,
    'and the summary is left as it was');

/* ------------------------------------------------------------------ */
/* A type whose members have all been removed                          */
/* ------------------------------------------------------------------ */

/*
 * The maps keep the type key after its last member is unticked, so the
 * summary has to skip empty ones - otherwise the page reports a type with
 * nothing in it and the manifest grows a <types> block with no members,
 * which the org rejects.
 */
const emptied = fresh([{ k: '01p1', t: 'ApexClass', m: 'Test1' }]);
vm.runInContext('restorePackageSelection()', emptied);
/* Untick the last CustomObject: the type key stays behind, empty. */
emptied.$scope.packageMetaTypeAndName.set('CustomObject', new Map());
vm.runInContext('buildPackageFrequency()', emptied);

const kinds = Array.from(emptied.$scope.packageMetaDataFrequency)
    .map(function (row) { return row.Type; });
assert.deepStrictEqual(kinds, ['ApexClass'],
    'a type with no members left is not counted: ' + kinds.join(', '));

/* ------------------------------------------------------------------ */
/* The three views cannot disagree                                     */
/* ------------------------------------------------------------------ */

/*
 * packageIsReady() is what draws "Nothing selected yet", and it reads the
 * summary. Asserting the relationship here because the bug was precisely
 * that these two came from different places and only one was restored.
 */
assert.ok(/packageIsReady = function\(\)\{[\s\S]{0,160}packageMetaDataFrequency/.test(controller),
    'the page decides it has a selection from the summary');
assert.ok(/buildPackageFrequency\(\);/.test(lift('restorePackageSelection')),
    'so the restore must rebuild the summary');




/* ------------------------------------------------------------------ */
/* Ticks the manifest cannot name                                      */
/* ------------------------------------------------------------------ */

/*
 * The selection lives in two maps: one of ticked ids, and one of
 * type -> members, which is what the manifest is written from. A component
 * in the first with no place in the second is ticked, counted in the
 * sidebar, and absent from the package.
 *
 * That shipped: a sidebar counting two types sat above a summary saying one
 * and a manifest holding one member, with nothing on screen admitting the
 * difference.
 */
const skewed = fresh([{ k: '01p1', t: 'ApexClass', m: 'Test1' }]);
vm.runInContext('restorePackageSelection()', skewed);

/* A second tick that never reached the type map - which is the fault. */
skewed.$scope.selectedMetaForPackageXml.set('0Rb1', { Id: '0Rb1' });
vm.runInContext('buildPackageFrequency()', skewed);

assert.strictEqual(skewed.$scope.packageInManifest, 1,
    'the manifest can name one of them');
assert.strictEqual(skewed.$scope.packageOrphans, 1,
    'and the other is counted as unplaceable rather than passed over in silence');

/* With the maps agreeing, there is nothing to report. */
const agreed = fresh([
    { k: '01p1', t: 'ApexClass', m: 'Test1' },
    { k: '0Rb1', t: 'LightningComponentBundle', m: 'myCmp' }
]);
vm.runInContext('restorePackageSelection()', agreed);
assert.strictEqual(agreed.$scope.packageOrphans, 0,
    'a selection the manifest can name in full reports nothing');
assert.strictEqual(agreed.$scope.packageInManifest, 2);

/* Never negative: more in the manifest than ticked is not a shortfall. */
const extra = fresh([{ k: '01p1', t: 'ApexClass', m: 'Test1' }]);
vm.runInContext('restorePackageSelection()', extra);
extra.$scope.selectedMetaForPackageXml.clear();
vm.runInContext('buildPackageFrequency()', extra);
assert.strictEqual(extra.$scope.packageOrphans, 0,
    'a manifest holding more than is ticked is not reported as a shortfall');


/* ------------------------------------------------------------------ */
/* Unticking the ones that cannot be placed                            */
/* ------------------------------------------------------------------ */

/*
 * They cannot be retrieved - the manifest is what the org is asked for and
 * they are not in it - so a selection that keeps counting them is counting
 * something that will not happen.
 */
function withDrop(stored) {
    const box = fresh(stored);
    vm.runInContext(liftAssigned('dropUnplacedComponents') + ';', box);
    return box;
}

const dropping = withDrop([
    { k: '01p1', t: 'ApexClass', m: 'Test1' },
    { k: '01p2', t: 'ApexClass', m: 'Test2' }
]);
vm.runInContext('restorePackageSelection()', dropping);
dropping.$scope.selectedMetaForPackageXml.set('0Rb1', { Id: '0Rb1' });
dropping.$scope.refreshPackageXml = function () { vm.runInContext('buildPackageFrequency()', dropping); };
vm.runInContext('dropUnplacedComponents()', dropping);

assert.strictEqual(dropping.$scope.selectedMetaForPackageXml.size, 2,
    'the unplaceable tick is removed');
assert.ok(!dropping.$scope.selectedMetaForPackageXml.has('0Rb1'),
    'and it is the right one');
assert.ok(dropping.$scope.selectedMetaForPackageXml.has('01p1') &&
          dropping.$scope.selectedMetaForPackageXml.has('01p2'),
    'while everything the manifest names is left alone');
assert.strictEqual(dropping.$scope.packageOrphans, 0,
    'and the counts agree afterwards');

/* Nothing to drop is nothing done - no rebuild, no change. */
const nothingToDrop = withDrop([{ k: '01p1', t: 'ApexClass', m: 'Test1' }]);
vm.runInContext('restorePackageSelection()', nothingToDrop);
let rebuilds = 0;
nothingToDrop.$scope.refreshPackageXml = function () { rebuilds += 1; };
vm.runInContext('dropUnplacedComponents()', nothingToDrop);
assert.strictEqual(nothingToDrop.$scope.selectedMetaForPackageXml.size, 1,
    'a selection the manifest can name in full is untouched');
assert.strictEqual(rebuilds, 0, 'and nothing is rebuilt for no reason');

/* ------------------------------------------------------------------ */
/* The page offers both ways out                                       */
/* ------------------------------------------------------------------ */

const view = fs.readFileSync(path.join(ROOT, 'js/angular/services/ViewService.js'), 'utf8');
const pkg = view.slice(view.indexOf('this.packagexmleditor ='),
    view.indexOf('this.packagexmlfrequency ='))
    .replace(/'\s*\+\s*\n?\s*'/g, '').replace(/\\'/g, "'");

/*
 * The refresh is always there, because the moment it is wanted is the moment
 * nobody can tell whether it is needed.
 */
/*
 * In the actions row, not only in the warning. The warning carries its own
 * Refresh, which satisfied a check for "the page mentions it" while the
 * always-available one had been deleted - leaving the rebuild reachable only
 * when the page had already noticed something was wrong.
 */
const actions = pkg.slice(pkg.indexOf('ss-pkg-actions'), pkg.indexOf('ss-pkg-warn'));
/*
 * The always-visible one specifically. The confirm prompt beside it also
 * calls refreshPackageXml, and satisfied a looser check while the button
 * itself had gone - leaving a rebuild reachable only after asking for one.
 */
assert.ok(/<button class="ss-pkg-btn" ng-if="!packageRefreshAsking" ng-click="refreshPackageXml\(\)">/
    .test(actions),
    'the rebuild sits with Retrieve and package.xml only, available at any time');

/*
 * And the disagreement is stated. This whole thing began with a sidebar
 * counting two types above a manifest holding one member and nothing on
 * screen admitting it.
 */
assert.ok(/ng-if="packageOrphans"/.test(pkg),
    'a selection the manifest cannot name in full says so');
assert.ok(/dropUnplacedComponents\(\)/.test(pkg),
    'and offers to untick the ones that cannot be placed');

/*
 * Rebuilding replaces a hand-edited manifest, which is the user's work - so
 * it asks first rather than doing it and mentioning it afterwards.
 */
assert.ok(/packageXmlEdited && !\$scope\.packageRefreshAsking/.test(controller),
    'refreshing an edited manifest asks before replacing it');
assert.ok(/ng-if="packageRefreshAsking"/.test(pkg),
    'and the question is asked in place');

/* ------------------------------------------------------------------ */
/* Opening the page rebuilds it                                        */
/* ------------------------------------------------------------------ */

/*
 * The manifest was only produced when the selection changed, so anything
 * that put the two out of step stayed wrong until somebody ticked something
 * else. Opening the page is the moment it matters.
 */
assert.ok(/data\.value === \$scope\.packagexml \|\| data\.value === 'PackageXml'/.test(controller),
    'opening package.xml is recognised in the funnel every page goes through');
const onOpen = controller.slice(
    controller.indexOf("data.value === $scope.packagexml || data.value === 'PackageXml'"),
    controller.indexOf('}else if(data.value === $scope.usageanalytics)'));
assert.ok(/createpkgXmlString\(\)/.test(onOpen),
    'and rebuilds the manifest on the way in');

/*
 * A hand-edited manifest survives it. createpkgXmlString refreshes the
 * summary and leaves the text alone when packageXmlEdited is set - so the
 * counts come back in step without taking the user's version away.
 */
assert.ok(/if\(\$scope\.packageXmlEdited\)\{[\s\S]{0,200}buildPackageFrequency\(\);[\s\S]{0,80}return \$scope\.str;/
    .test(controller),
    'an edited manifest keeps its text and refreshes only its summary');

/* ------------------------------------------------------------------ */
/* Automatic rebuilds are not somebody using package.xml               */
/* ------------------------------------------------------------------ */

/*
 * The rebuild is reached two ways: because the user did something, and
 * because the panel is keeping itself honest. Only the first is a use, and
 * counting the second turned every panel load into a manifest build in Usage
 * Analytics - a number that would have quietly stopped meaning anything.
 */
const rebuildBody = lift('rebuildPackageXml');
assert.ok(!/UsageService\.record/.test(rebuildBody),
    'the rebuild itself does not count as a use');
assert.ok(/UsageService\.record\('packageXml'\)/.test(
    liftAssigned('createpkgXmlString')),
    'while the user-facing build does');
assert.ok(/rebuildPackageXml\(\)/.test(lift('restorePackageSelection')),
    'and restoring takes the silent path');

console.log('package_selection_restore: ok');
