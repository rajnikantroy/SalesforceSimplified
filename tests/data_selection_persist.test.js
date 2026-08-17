/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * The record basket, kept across a reload.
 *
 * Ticking a hundred rows and losing them to a refresh is the kind of loss
 * that makes people stop using a basket at all - which is why the package.xml
 * selection already survives, and why this one now does.
 *
 * The two persistence functions are lifted and run against a fake
 * localStorage rather than read as text: what matters is that what goes in
 * comes back, and that a cleared basket does not come back.
 */

const ROOT = path.join(__dirname, '..');
const controller = fs.readFileSync(
    path.join(ROOT, 'js/angular/controllers/MenuAndDetailsCtrl.js'), 'utf8');

/* ------------------------------------------------------------------ */
/* Lift the real functions                                             */
/* ------------------------------------------------------------------ */

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

const store = {};
const sandbox = {
    window: {
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; }
        }
    },
    /* The org key the basket is filed under. */
    ssOrgKey: () => 'acme--sandbox1',
    SS_ORIGIN: 'https://acme--sandbox1.my.salesforce.com',
    URL: URL,
    suspendDataPersist: false,
    $scope: { selectedDataForDownload: new Map() }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(
    lift('dataSelectionKey') + '\n' +
    lift('persistDataSelection') + '\n' +
    lift('restoreDataSelection'), sandbox);

/* ------------------------------------------------------------------ */
/* Filed per org                                                       */
/* ------------------------------------------------------------------ */

const key = vm.runInContext('dataSelectionKey()', sandbox);
assert.ok(key.includes('acme--sandbox1'),
    'the basket is filed under the org, so two orgs do not share one: ' + key);
assert.ok(key !== 'ss_data_selection_undefined', 'and the org key resolved');

/* ------------------------------------------------------------------ */
/* What goes in comes back                                             */
/* ------------------------------------------------------------------ */

const selection = sandbox.$scope.selectedDataForDownload;
selection.set('001A', { Id: '001A', Name: 'Acme', attributes: { type: 'Account' },
    BillingStreet: 'a very long field nobody needs to keep' });
selection.set('a01B', { Id: 'a01B', attributes: { type: 'Invoice__c' } });

vm.runInContext('persistDataSelection()', sandbox);

const stored = JSON.parse(store[key]);
assert.strictEqual(stored.length, 2, 'both records are stored');

/*
 * Two strings per record, not the record.
 *
 * A queried row carries every field the list asked for; two hundred of those
 * is a quota failure rather than a saved selection. Everything that reads the
 * basket wants the Id and the object name - the download re-queries for the
 * fields - so anything else being stored is weight with no reader.
 */
assert.deepStrictEqual(Object.keys(stored[0]).sort(), ['i', 't'],
    'only the id and the object name are kept: ' + JSON.stringify(stored[0]));
assert.ok(!store[key].includes('very long field'),
    'the record body is not stored');

/* Now lose the map, as a reload does, and bring it back. */
selection.clear();
vm.runInContext('restoreDataSelection()', sandbox);

assert.strictEqual(selection.size, 2, 'the basket comes back');
assert.strictEqual(selection.get('001A').Id, '001A', 'with its ids');
assert.strictEqual(selection.get('001A').attributes.type, 'Account',
    'and the object each one belongs to - the summary and the download both read it');
assert.strictEqual(selection.get('a01B').attributes.type, 'Invoice__c');
assert.strictEqual(selection.get('001A')._ssRestored, true,
    'marked as a stub, the way restored components are');

/* ------------------------------------------------------------------ */
/* A cleared basket stays cleared                                      */
/* ------------------------------------------------------------------ */

/*
 * The failure worth having a test for: clearing the selection but leaving
 * the stored copy behind, so the next reload brings back exactly what the
 * user just got rid of.
 */
selection.clear();
vm.runInContext('persistDataSelection()', sandbox);
assert.strictEqual(store[key], undefined,
    'an empty basket removes the stored copy rather than storing an empty one');

vm.runInContext('restoreDataSelection()', sandbox);
assert.strictEqual(selection.size, 0, 'and nothing comes back');

/* ------------------------------------------------------------------ */
/* Nothing breaks on rubbish                                           */
/* ------------------------------------------------------------------ */

store[key] = 'not json at all';
selection.clear();
vm.runInContext('restoreDataSelection()', sandbox);
assert.strictEqual(selection.size, 0, 'unreadable storage is ignored, not thrown');

store[key] = JSON.stringify([{ t: 'Account' }, null, { i: '001C', t: 'Account' }]);
selection.clear();
vm.runInContext('restoreDataSelection()', sandbox);
assert.strictEqual(selection.size, 1,
    'entries with no id are skipped rather than restored as undefined');

/* ------------------------------------------------------------------ */
/* Every mutation is written down                                      */
/* ------------------------------------------------------------------ */

/*
 * A basket that saves on tick but not on clear, or not on select-all, is
 * worse than one that never saves: it comes back wrong. Checked as text
 * because these are call sites rather than behaviour.
 */
['$scope.selectedDataForDownload.clear();'].forEach(() => {
    const clears = [...controller.matchAll(/selectedDataForDownload\.clear\(\);/g)];
    assert.ok(clears.length >= 2, 'expected the basket to be cleared in more than one place');
    clears.forEach((clear) => {
        const after = controller.slice(clear.index, clear.index + 200);
        assert.ok(/persistDataSelection\(\)/.test(after),
            'a clear must be written down too, or the next reload restores what was ' +
            'just cleared: ' + after.slice(0, 90).replace(/\s+/g, ' '));
    });
});

/* Select-all writes once at the end rather than per row. */
const selectAll = controller.slice(controller.indexOf('$scope.selectAllForDataDownload = function'),
    controller.indexOf('$scope.allSelectedForPackageXml'));
assert.ok(/suspendDataPersist = true/.test(selectAll) &&
          /suspendDataPersist = false/.test(selectAll),
    'select-all suspends the per-row save');
assert.ok(/finally/.test(selectAll),
    'and restores it in a finally - an exception mid-loop must not leave saving off ' +
    'for the rest of the session');
assert.ok(selectAll.lastIndexOf('persistDataSelection()') > selectAll.indexOf('suspendDataPersist = false'),
    'then writes once, after the loop');

/* And the basket is restored at startup, both times the package one is. */
const restores = (controller.match(/restoreDataSelection\(\)/g) || []).length;
const packageRestores = (controller.match(/restorePackageSelection\(\)/g) || []).length;
assert.strictEqual(restores, packageRestores,
    'the record basket is restored wherever the component basket is (' +
    restores + ' vs ' + packageRestores + ') - on simplified.html the first ' +
    'attempt runs before the org is known and finds nothing');

console.log('data_selection_persist: ok');
