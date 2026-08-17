/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * The debug log panel.
 *
 * Its Delete button is the only irreversible thing in this extension, and it
 * was wired to the wrong list: the table renders `dataList | filter:search`,
 * while Delete worked from dataList. Narrowing the search to one log and
 * pressing Delete removed every log the query had returned - and reported
 * nothing when some of the deletes failed, so a partial sweep looked clean.
 */

const factories = {};
const context = {
    window: {},
    angular: { module: () => ({ controller(name, fn) { factories[name] = fn; } }) },
    // Whose logs: the query filters on the uid cookie, which "View as" rewrites.
    readCookie: (name) => (name === 'SFDCSimplified_uname' ? 'Dana Whitfield' : null),
    ssSessionId: () => 'session-token',
    ssToolingSobjectUrl: (type, id) => 'https://acme.my.salesforce.com/tooling/sobjects/' + type + '/' + id,
    ssApiUrl: (p) => p,
    SS_ORIGIN: 'https://acme.my.salesforce.com',
    chrome: { runtime: { getURL: (p) => p } },
    console,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    document: { createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }), body: { appendChild() {}, removeChild() {} } }
};

// jQuery stub: the panel shows and hides itself with it.
context.$ = function () { return { css() { return this; } }; };

// confirm(), which the bulk delete now goes through. Driven by the test.
let confirmAnswer = true;
let confirmPrompts = [];
context.confirm = (message) => { confirmPrompts.push(message); return confirmAnswer; };

vm.runInNewContext(
    fs.readFileSync('./js/angular/controllers/MyViewGridCtrl.js', 'utf8'),
    context
);

// Angular's `filter` filter, near enough: substring match over the values.
const $filter = () => (list, term) => {
    if (!term) { return list; }
    const needle = String(term).toLowerCase();
    return list.filter((item) => JSON.stringify(item).toLowerCase().indexOf(needle) !== -1);
};

function settled(p) { return Promise.resolve(p); }
const $q = {
    when: (v) => Promise.resolve(v),
    all: (list) => Object.assign(Promise.all(list), {}),
    defer() {
        let resolve; const promise = new Promise((r) => { resolve = r; });
        return { promise, resolve };
    }
};
// $q.all(...).finally(...) - native promises already have finally.
const $timeout = (fn) => Promise.resolve().then(fn);

let removed = [];
let removeFails = new Set();
const sfdc = {
    noSessionMessage: 'Unable to fetch session id.',
    errorMessage: (r) => (r && r.message) || null,
    query: () => Promise.resolve({ records: [] }),
    remove(url) {
        const id = url.split('/').pop();
        if (removeFails.has(id)) {
            return Promise.reject({ message: 'insufficient access rights' });
        }
        removed.push(id);
        return Promise.resolve({});
    }
};
const MetaDataContainer = { byValue: () => ({ query: 'SELECT Id FROM ApexLog', url: 'tooling' }) };

function makeScope(logs) {
    // The controller registers a $watch and applies asynchronously; neither
    // matters to the delete path, so they are the two no-ops it needs.
    const $scope = { $watch() {}, $applyAsync: (fn) => fn && fn() };
    factories.MyViewGridCtrl($scope, MetaDataContainer, sfdc, $q, $timeout, $filter, { id: '005x' });
    $scope.dataList = logs;
    $scope.dataLength = logs.length;
    return $scope;
}

const LOGS = [
    { Id: '07L1', Operation: 'VFRemoting', Status: 'Success' },
    { Id: '07L2', Operation: 'ApexTestHandler', Status: 'Success' },
    { Id: '07L3', Operation: 'ApexTestHandler', Status: 'Failed' }
];

async function main() {
    /* ------------------------------------------------------------------ */
    /* Whose logs                                                          */
    /* ------------------------------------------------------------------ */
    let $scope = makeScope(LOGS.slice());
    assert.strictEqual($scope.logOwner(), 'Dana Whitfield',
        'the panel names the user whose logs it is showing, not "My"');

    /* ------------------------------------------------------------------ */
    /* Delete removes what is on screen, not what was queried              */
    /* ------------------------------------------------------------------ */
    removed = []; confirmPrompts = []; confirmAnswer = true;
    $scope = makeScope(LOGS.slice());
    $scope.search = 'VFRemoting';

    assert.strictEqual($scope.visibleLogs().length, 1,
        'the search narrows the table to one row');

    $scope.deleteMyLogs();
    await settled();
    await settled();

    assert.deepStrictEqual(removed, ['07L1'],
        'Delete must remove only the row shown - it used to delete all three');

    /* ------------------------------------------------------------------ */
    /* And says what it is about to do                                     */
    /* ------------------------------------------------------------------ */
    assert.strictEqual(confirmPrompts.length, 1, 'an irreversible delete is confirmed first');
    assert.ok(/1 of 3/.test(confirmPrompts[0]),
        'the prompt says how many of how many: ' + confirmPrompts[0]);
    assert.ok(/Dana Whitfield/.test(confirmPrompts[0]),
        'and whose they are: ' + confirmPrompts[0]);
    assert.ok(/cannot be undone/i.test(confirmPrompts[0]),
        'and that it cannot be undone');

    // Declining deletes nothing.
    removed = []; confirmAnswer = false;
    $scope = makeScope(LOGS.slice());
    $scope.deleteMyLogs();
    await settled();
    assert.deepStrictEqual(removed, [], 'answering no must delete nothing');

    /* ------------------------------------------------------------------ */
    /* One row at a time                                                   */
    /* ------------------------------------------------------------------ */
    removed = []; confirmPrompts = []; confirmAnswer = true;
    $scope = makeScope(LOGS.slice());
    $scope.deleteOneLog(LOGS[2]);
    await settled();
    await settled();
    assert.deepStrictEqual(removed, ['07L3'], 'a single row deletes just itself');

    /* ------------------------------------------------------------------ */
    /* A partial failure is reported, not swallowed                        */
    /* ------------------------------------------------------------------ */
    removed = []; removeFails = new Set(['07L2']); confirmAnswer = true;
    $scope = makeScope(LOGS.slice());
    $scope.deleteMyLogs();
    await settled();
    await settled();
    await settled();

    assert.deepStrictEqual(removed, ['07L1', '07L3'], 'the deletable ones still go');
    assert.ok($scope.gridError, 'and the failure is reported rather than logged to the console');
    assert.ok(/1 of 3/.test($scope.gridError),
        'saying how many failed: ' + $scope.gridError);
    removeFails = new Set();

    /* ------------------------------------------------------------------ */
    /* Nothing to delete                                                   */
    /* ------------------------------------------------------------------ */
    removed = []; confirmPrompts = [];
    $scope = makeScope([]);
    $scope.deleteMyLogs();
    assert.deepStrictEqual(removed, [], 'an empty list deletes nothing');
    assert.strictEqual(confirmPrompts.length, 0, 'and does not ask');
    assert.ok($scope.gridError, 'it says there is nothing there');

    console.log('debug logs regression test passed');
}

main().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
