/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * What a finished dependency scan has to bring up to date.
 *
 * The scan is deliberately out of step with the click that starts it: ticking
 * a row rebuilds the manifest on its way out, then the scan settles a quarter
 * of a second later and adds more components to it. Everything the panel shows
 * has to catch up at that point - and the manifest text is the one that is
 * easy to forget, because the summary beside it updates from a different
 * function and looks right while the textarea is stale.
 *
 * That is the bug this guards: components added, the count saying so, and the
 * textarea still showing the manifest from before the scan.
 *
 * rescanPackageDependencies is a closure inside MenuAndDetailsCtrl, so it is
 * lifted out with its collaborators passed in - which means the assertions run
 * against the shipped source, and a rename breaks this rather than silently
 * skipping it.
 */

const source = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

function extract(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notStrictEqual(start, -1, 'could not find ' + startMarker + ' in the controller');
    const end = source.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, 'could not find the end of ' + startMarker);
    return source.slice(start, end) + endMarker;
}

const body = [
    extract('function settleDependencyScan(){', '\n    }'),
    extract('function dropEmptyTypes(){', '\n    }'),
    extract('$scope.removeManagedComponents = function(){', '\n    };'),
    extract('$scope.includeManagedComponents = function(){', '\n    };'),
    extract('$scope.rescanPackageDependencies = function(){', '\n    };')
].join('\n');

// A $q close enough for this: the controller only uses when() and the promise
// returned by resolveAll.
const $q = { when: (v) => Promise.resolve(v), all: (list) => Promise.all(list) };

// The namespace rule the real service applies: ns__Name__suffix carries a
// namespace in the first part, Name__suffix does not.
function namespaceOf(item) {
    if (item && item.namespace) { return item.namespace; }
    if (item && item.NamespacePrefix) { return item.NamespacePrefix; }
    const halves = String((item && item.name) || '').split(/[.-]/);
    for (const half of halves) {
        const parts = half.split('__');
        if (parts.length >= 3 && parts[0]) { return parts[0]; }
    }
    return null;
}

function harness(options) {
    const opts = options || {};

    const calls = { frequency: 0, manifest: 0, managed: 0 };
    const added = [];
    const askedReferenceIds = [];

    const $scope = {
        packageIncludeDependencies: opts.include !== false,
        packageIncludeReferences: !!opts.references,
        packageExcludeManaged: !!opts.exclude,
        records: opts.records || [],
        AllMetaDataRecords: opts.records || [],
        packageMetaTypeAndName: new Map(),
        managedSummary: { count: 0, namespaces: [] },
        selectedMetaForPackageXml: new Map(opts.selected || []),
        packageDepsState: {},
        $applyAsync: (fn) => fn(),
        createpkgXmlString: () => { calls.manifest++; return Promise.resolve('<xml/>'); }
    };

    const PackageDependencyService = {
        hasDependencies: (type) => type === 'CustomObject',
        namespaceOf,
        orgNamespace: () => Promise.resolve(opts.orgNamespace || null),
        forReferences: (ids) => {
            askedReferenceIds.push(...ids);
            return Promise.resolve(opts.referenced || []);
        },
        resolveAll: (selections, onProgress) => {
            if (typeof onProgress === 'function') { onProgress(0, selections.length); }
            return opts.fail
                ? Promise.reject(new Error('scan blew up'))
                : Promise.resolve(opts.members || []);
        }
    };

    // packageDependencyMembers and isFromAnotherPackage are declared in the
    // controller alongside the lifted functions, so they are supplied here.
    const packageDependencyMembers = new Map(opts.dependencyMembers || []);

    const scope = {
        packageDependencyMembers,
        isFromAnotherPackage: (item, own) => {
            const ns = namespaceOf(item);
            return !!ns && ns !== own;
        },
        removeMetaFromPackage: (id) => {
            $scope.selectedMetaForPackageXml.delete(id);
            $scope.packageMetaTypeAndName.forEach((bucket) => bucket.delete(id));
        },
        $scope,
        $q,
        PackageDependencyService,
        clearDependencyMembers: () => { added.length = 0; },
        addDependencyMember: (type, name) => { added.push(type + ':' + name); return true; },
        buildPackageFrequency: () => { calls.frequency++; },
        refreshManagedSummary: () => { calls.managed++; return Promise.resolve({}); },
        packageMetadataType: (r) => r.type,
        packageMemberName: (r) => r.name
    };

    const names = Object.keys(scope);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names,
        'var knownOrgNamespace = null;\n' + body +
        '\nreturn $scope.rescanPackageDependencies;')(...names.map((n) => scope[n]));

    return { run: fn, calls, added, $scope, packageDependencyMembers, askedReferenceIds };
}

const anObject = [['a', { type: 'CustomObject', name: 'Account' }]];

async function main() {

    /* ------------------------------------------------------------------ */
    /* The manifest text is rebuilt when the scan finishes                 */
    /* ------------------------------------------------------------------ */

    const found = harness({
        selected: anObject,
        members: [{ type: 'CustomField', name: 'Account.Rating__c' }]
    });
    const count = await found.run();

    assert.strictEqual(count, 1, 'the scan reports what it added');
    assert.deepStrictEqual(found.added, ['CustomField:Account.Rating__c'],
        'the dependency reaches the manifest maps');
    assert.ok(found.calls.manifest > 0,
        'a scan that adds components must rebuild the manifest text, or the ' +
        'textarea keeps showing the manifest from before the scan');
    assert.ok(found.calls.managed > 0,
        'and the managed-package warning must describe the manifest as it now is');

    /* ------------------------------------------------------------------ */
    /* Every other way the scan can end                                    */
    /*                                                                     */
    /* Each of these changes what the manifest names - unticking the box    */
    /* takes the dependencies away again - so each has to refresh too.      */
    /* ------------------------------------------------------------------ */

    const off = harness({ include: false, selected: anObject });
    await off.run();
    assert.ok(off.calls.manifest > 0,
        'switching the box off removes the dependencies, so the text must be rebuilt');
    assert.ok(off.calls.managed > 0, 'and the managed warning with it');

    const nothingToScan = harness({ selected: [['a', { type: 'ApexClass', name: 'Foo' }]] });
    await nothingToScan.run();
    assert.ok(nothingToScan.calls.manifest > 0,
        'a selection with nothing to scan still clears any earlier dependencies');
    assert.ok(nothingToScan.calls.managed > 0, 'and refreshes the managed warning');

    const broke = harness({ selected: anObject, fail: true });
    await broke.run();
    assert.ok(broke.calls.manifest > 0,
        'a scan that fails still leaves the text matching what the manifest holds');
    assert.ok(broke.calls.managed > 0,
        'a failed scan must not leave the managed warning describing a manifest that is gone');

    /* ------------------------------------------------------------------ */
    /* The progress state the panel reads                                  */
    /* ------------------------------------------------------------------ */

    assert.strictEqual(found.$scope.packageDepsState.running, false,
        'the scan is not left looking like it is still running');
    assert.strictEqual(found.$scope.packageDepsState.scanned, true,
        'a finished scan says so, so the panel can tell "none needed" from "not yet run"');
    assert.strictEqual(found.$scope.packageDepsState.added, 1,
        'the panel is told how many were added');
    assert.strictEqual(broke.$scope.packageDepsState.running, false,
        'a failed scan does not leave the panel spinning forever');

    /* ------------------------------------------------------------------ */
    /* Removing managed package components                                 */
    /*                                                                     */
    /* Knowing a manifest cannot be retrieved is only half of it - the      */
    /* other half is being able to end up with one that does what it says.  */
    /* ------------------------------------------------------------------ */

    const records = [
        { Id: 'local', selected: true },
        { Id: 'managed', selected: true }
    ];
    const removing = harness({
        records,
        selected: [
            ['local',   { type: 'CustomObject', name: 'Invoice__c' }],
            ['managed', { type: 'CustomObject', name: 'npsp__Household__c' }]
        ],
        dependencyMembers: [
            ['CustomField|Account.Rating__c',      { type: 'CustomField', name: 'Account.Rating__c' }],
            ['CustomField|npsp__Household__c.npsp__Amount__c',
             { type: 'CustomField', name: 'npsp__Household__c.npsp__Amount__c' }]
        ]
    });
    removing.$scope.packageMetaTypeAndName.set('CustomObject', new Map([
        ['local', 'Invoice__c'], ['managed', 'npsp__Household__c']
    ]));
    removing.$scope.packageMetaTypeAndName.set('CustomField', new Map([
        ['dep:CustomField|Account.Rating__c', 'Account.Rating__c'],
        ['dep:CustomField|npsp__Household__c.npsp__Amount__c',
         'npsp__Household__c.npsp__Amount__c']
    ]));

    await removing.$scope.removeManagedComponents();

    assert.deepStrictEqual([...removing.$scope.selectedMetaForPackageXml.keys()], ['local'],
        'the managed tick is dropped and the local one kept');
    assert.deepStrictEqual(
        [...removing.$scope.packageMetaTypeAndName.get('CustomObject').keys()], ['local'],
        'and it goes from the manifest maps too');
    assert.deepStrictEqual(
        [...removing.$scope.packageMetaTypeAndName.get('CustomField').keys()],
        ['dep:CustomField|Account.Rating__c'],
        'a managed field pulled in as a dependency goes as well');
    assert.deepStrictEqual([...removing.packageDependencyMembers.keys()],
        ['CustomField|Account.Rating__c'],
        'and is forgotten, so it is not counted as still present');

    /*
     * The row checkboxes read the selection map rather than a flag on the row,
     * so removing from the map is what unticks them - there is no second place
     * that can disagree about whether a row is selected.
     */
    assert.ok(!removing.$scope.selectedMetaForPackageXml.has('managed'),
        'the managed component is out of the selection, so its row reads unticked');
    assert.ok(removing.$scope.selectedMetaForPackageXml.has('local'),
        'and the local one is still in it');

    assert.strictEqual(removing.$scope.packageExcludeManaged, true, 'the exclusion is switched on');
    assert.ok(removing.calls.manifest > 0, 'the manifest text is rebuilt after a removal');
    assert.ok(removing.calls.managed > 0, 'and the warning recounted');

    /*
     * The exclusion has to stick. A local permission set granting access to a
     * managed package's fields pulls them straight back in on the next scan,
     * and components reappearing after being removed is worse than never
     * having offered to remove them.
     */
    const afterRemoval = harness({
        exclude: true,
        selected: anObject,
        members: [
            { type: 'CustomField', name: 'Account.Rating__c' },
            { type: 'CustomField', name: 'npsp__Household__c.npsp__Amount__c' },
            { type: 'ApexClass',   name: 'npsp__BatchJob', namespace: 'npsp' }
        ]
    });
    const kept = await afterRemoval.run();
    assert.deepStrictEqual(afterRemoval.added, ['CustomField:Account.Rating__c'],
        'a later scan does not bring the managed components back');
    assert.strictEqual(kept, 1, 'and only counts what it actually added');

    // Without the exclusion the same scan keeps everything, so the filter is
    // doing the work rather than the scan simply finding less.
    const notExcluding = harness({
        selected: anObject,
        members: [
            { type: 'CustomField', name: 'Account.Rating__c' },
            { type: 'CustomField', name: 'npsp__Household__c.npsp__Amount__c' }
        ]
    });
    assert.strictEqual(await notExcluding.run(), 2,
        'with the exclusion off, managed components are still added');

    /*
     * A packaging org's own namespace is not somebody else's package. This is
     * the case where excluding by namespace alone would throw away exactly the
     * components the user came for.
     */
    const packagingOrg = harness({
        exclude: true,
        orgNamespace: 'acme',
        selected: anObject,
        members: [
            { type: 'CustomField', name: 'acme__Widget__c.acme__Size__c' },
            { type: 'CustomField', name: 'npsp__Household__c.npsp__Amount__c' }
        ]
    });
    await packagingOrg.run();
    assert.deepStrictEqual(packagingOrg.added, ['CustomField:acme__Widget__c.acme__Size__c'],
        "a packaging org keeps its own components and drops other people's");

    // Putting them back is a rescan, not a restore - the ticks the user
    // removed were theirs to remove.
    const including = harness({
        exclude: true, selected: anObject,
        members: [{ type: 'CustomField', name: 'npsp__Household__c.npsp__Amount__c' }]
    });
    await including.$scope.includeManagedComponents();
    assert.strictEqual(including.$scope.packageExcludeManaged, false, 'the exclusion is lifted');
    assert.deepStrictEqual(including.added, ['CustomField:npsp__Household__c.npsp__Amount__c'],
        'and the scan brings the managed dependencies back');

    /* ------------------------------------------------------------------ */
    /* What the selection references                                       */
    /*                                                                     */
    /* A separate switch from "related components", because it is a         */
    /* separate question: what belongs to a thing versus what a thing       */
    /* points at. Folding them into one tick would make that tick mean two  */
    /* things nobody could separate when it went wrong.                     */
    /* ------------------------------------------------------------------ */

    const refsOnly = harness({
        include: false, references: true,
        selected: [['a', { type: 'ApexClass', name: 'AccountService' }]],
        referenced: [{ type: 'CustomField', name: 'Account.Rating__c' }]
    });
    const refCount = await refsOnly.run();
    assert.strictEqual(refCount, 1, 'references are added even with related components off');
    assert.deepStrictEqual(refsOnly.added, ['CustomField:Account.Rating__c'],
        'what the class points at reaches the manifest');
    assert.deepStrictEqual(refsOnly.askedReferenceIds, ['a'],
        'every selected component is asked what it references');

    /*
     * An Apex class has no parts of its own, so hasDependencies says no - but
     * it certainly references things. Gating the reference pass on the same
     * test would have made it silently do nothing for exactly the components
     * people want it for.
     */
    assert.ok(refsOnly.calls.manifest > 0, 'and the manifest text is rebuilt');

    // Both switches on: the two answers merge into one selection.
    const both = harness({
        references: true,
        selected: [['a', { type: 'CustomObject', name: 'Account' }]],
        members: [{ type: 'CustomField', name: 'Account.Rating__c' }],
        referenced: [{ type: 'ApexClass', name: 'AccountService' }]
    });
    await both.run();
    assert.deepStrictEqual(both.added.sort(),
        ['ApexClass:AccountService', 'CustomField:Account.Rating__c'],
        'owned parts and referenced components both land in the manifest');

    // Neither switch: the org is not asked anything.
    const neither = harness({
        include: false, selected: [['a', { type: 'CustomObject', name: 'Account' }]]
    });
    await neither.run();
    assert.deepStrictEqual(neither.askedReferenceIds, [],
        'with both switches off nothing is asked about references');
    assert.ok(neither.calls.manifest > 0, 'but the manifest still settles');

    console.log('package dependency scan regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
