/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Exporting a selection that spans more than one object.
 *
 * The selection is a basket, not a view: nothing clears it when the user moves
 * between objects, so by the time Download is pressed it can hold Contacts,
 * Accounts and Leads together while only one of those is on screen. Every part
 * of the export has to be derived from the records themselves rather than from
 * the panel that happens to be open.
 *
 * That is the specific way this breaks. FIELDS(ALL) names exactly one object,
 * so the query cannot be written once - and the obvious simplification, taking
 * the object from selectedMetadata, silently exports the wrong rows or none:
 * asking Account for Contact ids returns an empty set, not an error.
 *
 * These run the shipped functions rather than reading the file for the right
 * substrings. A grep for the selection cap once passed against a different
 * function that happened to contain the same expression, while the cap itself
 * was not applied at all - so what is asserted here is behaviour.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

// Lifted by matching braces. Bounding a function by its first "\n    }"
// truncates it at the first nested block, which has produced tests that
// passed against half a function.
function lift(signature) {
    const start = controller.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0;
    let index = controller.indexOf('{', start);
    for (; index < controller.length; index++) {
        if (controller[index] === '{') { depth++; }
        else if (controller[index] === '}') {
            depth--;
            if (depth === 0) { return controller.slice(start, index + 1); }
        }
    }
    throw new Error('unbalanced braces in ' + signature);
}

const SOURCE = [
    'var MAX_DATA_SELECTION = 200;',
    lift('$scope.dataSelectionFull = function(){') + ';',
    lift('$scope.dataSelectionSummary = function(){') + ';',
    lift('function fetchAllFields(sobjectType, ids){'),
    lift('function exportBaseName(records){'),
    lift('$scope.downloadSelectedDataAsJson = function(){') + ';',
    lift('function writeExport(records, complete){')
].join('\n');

/*
 * `refuse` names the objects whose FIELDS(ALL) query the org rejects, which is
 * a real answer and not an edge case: the query needs API 51+ and read access
 * to every field on the object, and a user can hold that for one object and
 * not the next.
 */
function load(selection, refuse) {
    const asked = [];
    let downloaded = null;

    const $scope = {
    /* The card that used to carry this message is gone, so a partial export
     * says so as a toast. Counted here rather than rendered. */
    showToast: function (spec) { $scope.toasts = ($scope.toasts || []).concat([spec]); },
        selectedDataForDownload: new Map(),
        // Deliberately not one of the selected objects: anything derived from
        // this rather than from the records is wrong for every row.
        selectedMetadata: { label: 'Account', value: 'Account', eligibleForDataDownload: true },
        downloadState: {},
        downloadDoc: (name, json) => { downloaded = { name: name, rows: JSON.parse(json) }; }
    };

    selection.forEach((type, i) => {
        const id = type.slice(0, 3).toLowerCase() + i;
        // Two columns, as a grid row arrives - the point of the re-query is
        // that the file holds more than this.
        $scope.selectedDataForDownload.set(id,
            { Id: id, Name: type + ' ' + i, attributes: { type: type } });
    });

    const $q = Object.assign((fn) => new Promise(fn), {
        when: (v) => Promise.resolve(v),
        all: (list) => Promise.all(list)
    });

    const sfdc = {
        get(url) {
            const soql = decodeURIComponent(url.split('?q=')[1]);
            asked.push(soql);
            const type = soql.match(/FROM (\w+)/)[1];
            if ((refuse || []).indexOf(type) !== -1) {
                return Promise.reject({ message: 'INVALID_TYPE: FIELDS(ALL) not supported' });
            }
            // Ids echoed back so a query aimed at the wrong object cannot
            // accidentally satisfy an assertion about row counts.
            const ids = (soql.match(/IN \(([^)]*)\)/)[1].match(/'([^']*)'/g) || [])
                .map((raw) => raw.replace(/'/g, ''));
            return Promise.resolve({
                records: ids.map((id) => ({
                    Id: id, Name: 'n', Email: 'e', Phone: 'p', attributes: { type: type }
                }))
            });
        }
    };

    const env = {
        $scope: $scope,
        $q: $q,
        sfdc: sfdc,
        escapeSoqlLiteral: (v) => String(v),
        ssQueryUrl: () => 'https://acme.my.salesforce.com/services/data/v59.0/query/?q=',
        ssBuildJsonDownloadPayload: (records) => JSON.stringify(records)
    };
    const names = Object.keys(env);
    const download = new Function(...names,
        SOURCE + '\nreturn $scope.downloadSelectedDataAsJson;')(...names.map((n) => env[n]));

    return { $scope, asked, download, file: () => downloaded };
}

const objectsAsked = (asked) => asked.map((soql) => soql.match(/FROM (\w+)/)[1]).sort();

async function main() {

    /* ------------------------------------------------------------------ */
    /* One query per object in the selection                               */
    /* ------------------------------------------------------------------ */

    const mixed = load(['Contact', 'Contact', 'Account', 'Lead']);
    const result = await mixed.download();

    assert.deepStrictEqual(objectsAsked(mixed.asked), ['Account', 'Contact', 'Lead'],
        'each object is asked for once - FIELDS(ALL) names a single object, so ' +
        'one query cannot cover a mixed selection');

    for (const soql of mixed.asked) {
        assert.ok(/SELECT FIELDS\(ALL\)/.test(soql), 'every object is asked for all fields');
        const limit = Number(soql.match(/LIMIT (\d+)/)[1]);
        assert.ok(limit > 0 && limit <= 200,
            'FIELDS(ALL) requires an explicit LIMIT of at most 200, found ' + limit);
    }

    // The ids in each query belong to that object. Sending an id to the wrong
    // object returns nothing rather than failing, so this would otherwise
    // surface as an export quietly missing rows.
    const contactQuery = mixed.asked.find((soql) => /FROM Contact/.test(soql));
    assert.ok(/'con0'/.test(contactQuery) && /'con1'/.test(contactQuery),
        'both selected Contacts are asked for together');
    assert.ok(!/'acc2'/.test(contactQuery), 'and no Account id is sent to Contact');

    /* ------------------------------------------------------------------ */
    /* Every selected record reaches the file, with its full field set     */
    /* ------------------------------------------------------------------ */

    const rows = mixed.file().rows;
    assert.strictEqual(rows.length, 4, 'every selected record is exported');
    assert.deepStrictEqual(Array.from(rows, (r) => r.Id).sort(),
        ['acc2', 'con0', 'con1', 'lea3'], 'and they are the ones that were ticked');
    assert.strictEqual(result.complete, true, 'a clean run reports itself complete');

    for (const row of rows) {
        assert.ok(row.Email && row.Phone,
            'each row carries the re-queried fields, not the two the grid showed');
    }

    /* ------------------------------------------------------------------ */
    /* An object the org refuses costs only that object                    */
    /*                                                                     */
    /* Falling back for everything would throw away the full field set for  */
    /* objects that answered perfectly well; failing outright would give    */
    /* the user no file at all.                                            */
    /* ------------------------------------------------------------------ */

    const partial = load(['Contact', 'Account'], ['Contact']);
    const partialResult = await partial.download();
    const byType = {};
    partial.file().rows.forEach((r) => { byType[r.attributes.type] = r; });

    assert.strictEqual(partial.file().rows.length, 2, 'nothing is dropped from the file');
    assert.ok(byType.Account.Email, 'the object that answered keeps every field');
    assert.ok(!byType.Contact.Email, 'the refused one falls back to the columns on screen');
    assert.strictEqual(partialResult.complete, false, 'and the export is not called complete');
    /*
     * Said as a toast now: the card that used to carry this line is gone, and
     * a partial export that says nothing is one somebody opens later
     * believing it holds every field.
     */
    const warned = (partial.$scope.toasts || []).map(function (t) {
        return (t.lines || []).join(' ');
    }).join(' ');
    assert.ok(/could not be read/i.test(warned),
        'the user is told the file is thinner than it looks, rather than left to notice');

    // Every object refused is still a file, not an error.
    const allRefused = load(['Contact', 'Account'], ['Contact', 'Account']);
    await allRefused.download();
    assert.strictEqual(allRefused.file().rows.length, 2,
        'an org that refuses FIELDS(ALL) entirely still exports what was on screen');

    /* ------------------------------------------------------------------ */
    /* The file is named after what is in it                               */
    /*                                                                     */
    /* selectedMetadata is Account throughout, so a name taken from the     */
    /* open panel would call a Contact export Account.json.                 */
    /* ------------------------------------------------------------------ */

    const oneObject = load(['Contact', 'Contact']);
    await oneObject.download();
    assert.strictEqual(oneObject.file().name, 'Contact.json',
        'a single-object export is named for that object, not for the open panel');

    const twoObjects = load(['Contact', 'Lead']);
    await twoObjects.download();
    assert.strictEqual(twoObjects.file().name, 'Contact-Lead.json',
        'a small mixed export names its objects');

    const many = load(['Contact', 'Lead', 'Case', 'Opportunity', 'Asset']);
    await many.download();
    assert.strictEqual(many.file().name, 'salesforce-data-5-objects.json',
        'beyond a few, the joined name is longer than it is useful');

    /* ------------------------------------------------------------------ */
    /* The cap is the whole selection, not each object                     */
    /*                                                                     */
    /* 200 is the ceiling FIELDS(ALL) puts on one query. Reading it as      */
    /* per-object would let a three-object selection reach 600 and exceed   */
    /* that ceiling on no single query - so the sum is what is capped.      */
    /* ------------------------------------------------------------------ */

    const full = load(['Contact']);
    for (let i = 0; i < 199; i++) {
        full.$scope.selectedDataForDownload.set('extra' + i,
            { Id: 'extra' + i, attributes: { type: 'Account' } });
    }
    assert.strictEqual(full.$scope.selectedDataForDownload.size, 200, 'exactly at the cap');
    assert.strictEqual(full.$scope.dataSelectionFull(), true,
        'the cap counts the whole selection across objects, not each object separately');

    /* ------------------------------------------------------------------ */
    /* What the card says is in the basket                                 */
    /* ------------------------------------------------------------------ */

    const summary = load(['Contact', 'Contact', 'Account']);
    assert.strictEqual(summary.$scope.dataSelectionSummary(), '1 Account, 2 Contact',
        'a mixed selection is spelled out, because the other objects\' rows are ' +
        'not on screen to be counted');

    assert.strictEqual(load(['Contact', 'Contact']).$scope.dataSelectionSummary(), '',
        'and a single-object selection says nothing - the count above it is enough');

    console.log('multi-object data export regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
