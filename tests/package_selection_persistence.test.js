/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The package.xml basket survives the panel closing.
 *
 * Ticking fifty components is minutes of work, and it lived in a Map on the
 * scope: a refresh, a navigation, or closing the panel threw it away with no
 * warning and no way to get it back. The watch list already survived - it is
 * in localStorage - so the two behaved differently for no reason a user could
 * see.
 *
 * Two things have to hold. It must come back, and it must come back *for the
 * right org*: a manifest is a list of components in one org, and offering the
 * last org's selection against a different one produces a package.xml full of
 * members that do not exist there.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const core = fs.readFileSync('./js/ss-core.js', 'utf8');

/*
 * The real ssOrgKey, not a copy.
 *
 * It was stubbed as host.split('.')[0], which agrees with the real one on
 * plain my-domain hosts and disagrees on exactly the cases that matter: a
 * managed-package Visualforce host (acme--npsp.vf.force.com) is the same org
 * as acme and the stub made it a different one, while a sandbox really is a
 * different org and the stub half-collapsed it. A copy of the function that
 * decides which org a basket belongs to only agrees by accident.
 */
const realOrgKey = new Function(
    core.match(/var SS_ORG_HOSTS[^;]+;/)[0] + '\n' +
    (function lift(name) {
        const start = core.indexOf('function ' + name);
        let depth = 0, i = core.indexOf('{', start);
        for (; i < core.length; i++) {
            if (core[i] === '{') { depth++; }
            else if (core[i] === '}') { depth--; if (depth === 0) { return core.slice(start, i + 1); } }
        }
        throw new Error('could not lift ' + name);
    })('ssOrgKey') + '\nreturn ssOrgKey;')();

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

const SOURCE = [
    lift('function packageSelectionKey(){'),
    lift('function persistPackageSelection(){'),
    /*
     * Restoring rebuilds the selection summary, so the function that builds
     * it has to come along. The panel reads that summary to decide whether
     * anything is selected at all - see package_selection_restore.test.js.
     */
    lift('function buildPackageFrequency(){'),
    lift('function restorePackageSelection(){')
].join('\n');

// One panel session against one org, sharing a storage object with the others.
function session(store, origin, options) {
    const opts = options || {};
    const $scope = {
        selectedMetaForPackageXml: new Map(),
        packageMetaTypeAndName: new Map(),
        packageMetaDataFrequency: []
    };
    const packageSourceMenu = new Map();

    const env = {
        $scope, packageSourceMenu,
        /* Counted rather than run: the manifest needs the org's API version,
         * which no harness here has. */
        rebuildPackageXml: function () { $scope.manifestBuilds = ($scope.manifestBuilds || 0) + 1; },
        SS_ORIGIN: origin,
        ssOrgKey: realOrgKey,
        window: {
            localStorage: {
                getItem: (k) => (k in store ? store[k] : null),
                setItem: (k, v) => {
                    if (opts.quotaFull) { throw new Error('QuotaExceededError'); }
                    store[k] = v;
                },
                removeItem: (k) => { delete store[k]; }
            }
        }
    };
    const fns = new Function(...Object.keys(env), SOURCE +
        '\nreturn { persist: persistPackageSelection, restore: restorePackageSelection };'
    )(...Object.values(env));

    return { $scope, packageSourceMenu, ...fns };
}

const select = (session, type, members, from) => {
    const map = session.$scope.packageMetaTypeAndName.get(type) || new Map();
    Object.keys(members).forEach((key) => {
        map.set(key, members[key]);
        if (from) { session.packageSourceMenu.set(key, from); }
    });
    session.$scope.packageMetaTypeAndName.set(type, map);
};

function main() {

    /* ------------------------------------------------------------------ */
    /* It comes back                                                       */
    /* ------------------------------------------------------------------ */

    const store = {};
    const first = session(store, 'https://acme.my.salesforce.com');
    select(first, 'ApexClass', { '01p1': 'BillingService', '01p2': 'TaxHelper' }, 'ApexClass');
    select(first, 'CustomObject', { '01I1': 'Invoice__c' }, 'CustomObject');
    first.persist();

    const reopened = session(store, 'https://acme.my.salesforce.com');
    assert.strictEqual(reopened.$scope.selectedMetaForPackageXml.size, 0, 'starts empty');
    reopened.restore();

    assert.strictEqual(reopened.$scope.selectedMetaForPackageXml.size, 3,
        'every ticked component is ticked again - this is what re-renders the checkboxes');
    assert.deepStrictEqual(
        Array.from(reopened.$scope.packageMetaTypeAndName.keys()).sort(),
        ['ApexClass', 'CustomObject'], 'grouped by type as before');
    assert.deepStrictEqual(
        Array.from(reopened.$scope.packageMetaTypeAndName.get('ApexClass').values()).sort(),
        ['BillingService', 'TaxHelper'],
        'with the member names the manifest is built from - not the record ids');
    assert.strictEqual(reopened.packageSourceMenu.get('01p1'), 'ApexClass',
        'and which menu each came from, which is what the badge counts');

    /* ------------------------------------------------------------------ */
    /* For that org only                                                   */
    /* ------------------------------------------------------------------ */

    const otherOrg = session(store, 'https://beta.my.salesforce.com');
    otherOrg.restore();
    assert.strictEqual(otherOrg.$scope.selectedMetaForPackageXml.size, 0,
        "another org must not inherit this one's selection - those components do not " +
        'exist there, and the manifest would be built from names that resolve to nothing');

    // And its own selection does not disturb the first.
    select(otherOrg, 'ApexClass', { '01p9': 'BetaOnly' });
    otherOrg.persist();
    const backToFirst = session(store, 'https://acme.my.salesforce.com');
    backToFirst.restore();
    assert.strictEqual(backToFirst.$scope.selectedMetaForPackageXml.size, 3,
        'the first org still has its three, kept apart from the second');


    /* ------------------------------------------------------------------ */
    /* Which hosts count as the same org                                   */
    /*                                                                     */
    /* One org is reachable on several hosts, and a basket ticked on one    */
    /* of them is the same basket on the others. A sandbox is a different   */
    /* org and must not share.                                             */
    /* ------------------------------------------------------------------ */

    const shared = {};
    const onLightning = session(shared, 'https://acme.lightning.force.com');
    select(onLightning, 'ApexClass', { '01p1': 'BillingService' });
    onLightning.persist();

    for (const host of ['https://acme.my.salesforce.com',
                        'https://acme.my.salesforce-setup.com',
                        'https://acme--npsp.vf.force.com']) {
        const same = session(shared, host);
        same.restore();
        assert.strictEqual(same.$scope.selectedMetaForPackageXml.size, 1,
            host + ' is the same org and must find the same basket');
    }

    const sandbox = session(shared, 'https://acme--uat.sandbox.my.salesforce.com');
    sandbox.restore();
    assert.strictEqual(sandbox.$scope.selectedMetaForPackageXml.size, 0,
        'a sandbox is a different org - its components are different components');

    /* ------------------------------------------------------------------ */
    /* Emptying it really empties it                                       */
    /*                                                                     */
    /* A stored selection that outlives being cleared is worse than not     */
    /* storing one: it comes back after the user has deliberately removed   */
    /* it, and nothing on screen explains why.                             */
    /* ------------------------------------------------------------------ */

    backToFirst.$scope.packageMetaTypeAndName.clear();
    backToFirst.persist();

    const afterClear = session(store, 'https://acme.my.salesforce.com');
    afterClear.restore();
    assert.strictEqual(afterClear.$scope.selectedMetaForPackageXml.size, 0,
        'a cleared basket stays cleared');
    assert.ok(!Object.keys(store).some((k) => /acme/.test(k)),
        'and the key is removed rather than left holding an empty list');

    /* ------------------------------------------------------------------ */
    /* Storage that will not cooperate                                     */
    /* ------------------------------------------------------------------ */

    const full = session({}, 'https://acme.my.salesforce.com', { quotaFull: true });
    select(full, 'ApexClass', { '01p1': 'BillingService' });
    assert.doesNotThrow(() => full.persist(),
        'a storage failure must not take down the selection that is working this session');

    const corrupt = session({ 'ss_package_selection_acme': '{not json' },
        'https://acme.my.salesforce.com');
    assert.doesNotThrow(() => corrupt.restore(), 'unreadable storage is not an exception on open');
    assert.strictEqual(corrupt.$scope.selectedMetaForPackageXml.size, 0, 'it is an empty basket');

    /* ------------------------------------------------------------------ */
    /* Small enough to store                                               */
    /*                                                                     */
    /* Records carry everything the query returned. A few hundred of those  */
    /* is a quota failure rather than a saved selection, so what is written */
    /* is four strings per component.                                      */
    /* ------------------------------------------------------------------ */

    const bulk = {};
    const many = session(bulk, 'https://acme.my.salesforce.com');
    const members = {};
    for (let i = 0; i < 500; i++) { members['01p' + i] = 'SomeReasonablyLongClassName' + i; }
    select(many, 'ApexClass', members);
    many.persist();

    const bytes = bulk[Object.keys(bulk)[0]].length;
    assert.ok(bytes < 200 * 1024,
        '500 components should be tens of kilobytes, not megabytes - got ' + bytes);

    const restoredBulk = session(bulk, 'https://acme.my.salesforce.com');
    restoredBulk.restore();
    assert.strictEqual(restoredBulk.$scope.selectedMetaForPackageXml.size, 500,
        'and all of them come back');

    /* ------------------------------------------------------------------ */
    /* Every path that changes the selection reaches the save              */
    /*                                                                     */
    /* Removing a whole type does not go through settleMetaSelection, so a  */
    /* save wired only there would let a removed type reappear on reopen.   */
    /* ------------------------------------------------------------------ */

    /*
     * The save lives with the rebuild, which is now a plain function -
     * createpkgXmlString is the user-facing wrapper that also counts the use.
     * Both are checked, because a save wired only to the wrapper would be
     * skipped by every automatic rebuild.
     */
    const rebuild = lift('function rebuildPackageXml(){');
    assert.ok(/persistPackageSelection\(\)/.test(rebuild),
        'the manifest rebuild must save - it is the one point every path reaches');
    assert.ok(/rebuildPackageXml\(\)/.test(lift('$scope.createpkgXmlString = function(){')),
        'and the user-facing build goes through it');

    for (const entry of ['$scope.removeTypeFromPackage = function(type){',
                         '$scope.selectAllForPackageXml = function(context){',
                         'function settleDependencyScan(){']) {
        const body = lift(entry);
        assert.ok(/persistPackageSelection\(\)|createpkgXmlString\(\)|rebuildPackageXml\(\)|settleDependencyScan\(\)|settleMetaSelection\(\)/.test(body),
            entry + ' changes the selection but reaches nothing that saves it');
    }


    /* ------------------------------------------------------------------ */
    /* And the restore actually runs                                       */
    /*                                                                     */
    /* Every assertion above passed while the feature did nothing at all.   */
    /* The save and restore were correct; the call to restore had landed    */
    /* inside the Watching List branch of openMetadata, so it ran only when */
    /* that one page was opened. Nothing about the functions was wrong, so  */
    /* nothing that tests the functions could see it.                       */
    /*                                                                     */
    /* Brace depth is the check: at controller top level it runs on         */
    /* construction, and anywhere deeper it runs only if some branch is     */
    /* taken.                                                              */
    /* ------------------------------------------------------------------ */

    const calls = [...controller.matchAll(/restorePackageSelection\(\);/g)];
    assert.ok(calls.length >= 1, 'the restore is never called - the basket is saved and never read');

    const depths = calls.map((call) => {
        let depth = 0;
        for (const ch of controller.slice(0, call.index)) {
            if (ch === '{') { depth++; }
            else if (ch === '}') { depth--; }
        }
        return depth;
    });

    assert.ok(depths.indexOf(1) !== -1,
        'no call to restorePackageSelection sits at controller top level, so it only ' +
        'runs if some branch is taken - the ticks come up empty on an ordinary open. ' +
        'Depths found: ' + depths.join(', '));

    console.log('  restore call depths: ' + depths.join(', ') + ' (1 = runs on construction)');


    /* ------------------------------------------------------------------ */
    /* Emptying the manifest from the card                                 */
    /*                                                                     */
    /* There was no way to do this. Components came off one tick or one     */
    /* type at a time, so starting again after a wrong selection meant      */
    /* clicking through everything that had been added - including the      */
    /* dependencies the scan put there, which the user never ticked and     */
    /* cannot see individually.                                            */
    /*                                                                     */
    /* Six pieces of state hold a selection. A clear that misses one leaves */
    /* an empty-looking card over a manifest that still lists components.   */
    /* ------------------------------------------------------------------ */

    {
        const scope = {
            selectedMetaForPackageXml: new Map([['01p1', {}], ['dep:ApexClass|Helper', {}]]),
            packageMetaTypeAndName: new Map([
                ['ApexClass', new Map([['01p1', 'BillingService'], ['dep:ApexClass|Helper', 'Helper']])],
                ['CustomObject', new Map([['01I1', 'Invoice__c']])]
            ]),
            packageXmlEdited: true,
            retrieveState: { error: 'something went wrong' },
            packageDepsState: { running: true, scanned: true, added: 9, done: 9, total: 9 }
        };
        const sourceMenu = new Map([['01p1', 'ApexClass'], ['01I1', 'CustomObject']]);
        const depMembers = new Map([['ApexClass|Helper', {}]]);
        let settled = 0;

        const env = {
            $scope: scope,
            packageSourceMenu: sourceMenu,
            packageDependencyMembers: depMembers,
            // The real one, lifted as a declaration so it closes over these
            // bindings rather than taking parameters it is never passed.
            settleDependencyScan: () => { settled++; return Promise.resolve(); }
        };
        new Function(...Object.keys(env),
            lift('function clearDependencyMembers(){') + '\n' +
            lift('$scope.clearAllFromPackage = function(){') + ';\n$scope.clearAllFromPackage();'
        )(...Object.values(env));

        assert.strictEqual(scope.selectedMetaForPackageXml.size, 0, 'the ticks are cleared');
        assert.strictEqual(scope.packageMetaTypeAndName.size, 0, 'and the members behind them');
        assert.strictEqual(sourceMenu.size, 0,
            'and the menu each came from, or the badge keeps counting them');
        assert.strictEqual(depMembers.size, 0,
            'including the scan-added dependencies, which cannot be unticked by hand');

        /*
         * A hand-edited manifest survives a changed selection on purpose. But
         * "remove all" is not a change of selection - it asks for nothing, and
         * keeping the edited text would empty the card while the file still
         * listed components.
         */
        assert.strictEqual(scope.packageXmlEdited, false,
            'a manual edit does not outlive the selection it was made from');
        assert.strictEqual(scope.retrieveState.error, '', 'and a stale error goes with it');
        assert.strictEqual(scope.packageDepsState.scanned, false, 'the scan state resets');

        assert.strictEqual(settled, 1,
            'and it settles once - which is what rebuilds the manifest and saves the ' +
            'now-empty selection, so it does not come back on reopen');
    }

    /*
     * Both pages offer it.
     *
     * These were sidebar cards. Their counts are in the footer now and their
     * actions were already on the pages behind them - except this one, which
     * existed only on the card. Without it here the only way out of a wrong
     * selection is one click per component, including the dependencies the
     * scan added that were never ticked by hand.
     */
    const cards = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
    for (const [page, handler] of [['packagexmleditor', 'clearAllFromPackage'],
                                   ['watchinglist', 'clearAllBookmarks']]) {
        const start = cards.indexOf('this.' + page + ' =');
        assert.notStrictEqual(start, -1, 'no template ' + page);
        const segment = cards.slice(start, cards.indexOf('\nthis.', start + 10));
        assert.ok(new RegExp('ng-click="' + handler + '\\(\\)').test(segment),
            page + ' must offer a remove-all, or the only way out is one click per component');
    }

    console.log('package selection persistence test passed');
}

main();
