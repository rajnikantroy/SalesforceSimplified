/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * A list response belongs to the open that asked for it.
 *
 * This is the metadata list appearing and then vanishing - clicking Apex Class
 * and getting rows perhaps a third of the time, with no error and no spinner
 * to explain the rest.
 *
 * The cause is not the query failing. Two requests end up in flight, the one
 * the user is waiting for answers and renders, and a superseded one answers a
 * moment later and overwrites the scope with its own answer - usually empty,
 * because a superseded request is often one the org refused or one for a type
 * that is no longer selected. Nothing throws, so it reads as the list simply
 * not loading.
 *
 * cancelPending cannot close this on its own, and that is the part worth
 * keeping in mind: smartQuery waits on SchemaService.ready() before it issues
 * anything, so a request asked for during that wait is not yet registered and
 * an abort at that moment cannot see it. Cancelling is by time; this is by
 * identity, which holds however the request was scheduled.
 *
 * These run the shipped handlers. The bug is a race, and a race is exactly
 * what reading the code makes look fine.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

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

/*
 * `handler` names which of the three list queries to drive. All three write
 * the same scope state from a response, so all three can strand it.
 */
function load(handler) {
    const pending = [];
    const $scope = {
        AllMetaDataRecords: [], records: [],
        createCloudTagData: () => {},
        selectedMetadata: { value: 'ApexClass', label: 'Apex Classes' }
    };

    const env = {
        $scope: $scope,
        recordRequest: () => {},
        clearQueryError: () => {},
        decorateRecords: (rows) => rows || [],
        updateNamespaces: () => {},
        unsupportedReason: (data) =>
            (data && data.ssUnsupported) ? (data.ssReason || 'refused') : null,
        showUnsupported: (reason) => { $scope.__message = reason; },
        showQueryError: () => { $scope.__error = true; },
        $: () => ({ removeClass: () => {} }),
        $q: Object.assign((fn) => new Promise(fn), { when: (v) => Promise.resolve(v) }),
        sfdc: {
            /*
             * Only the list query is queued. queryOnAllData also fires a
             * SELECT COUNT() for the header total, and letting that into
             * `pending` shifts every index the cases resolve by hand - which
             * does not fail, it just resolves the wrong request and leaves
             * main() awaiting a promise nobody settles. The run then exits 0
             * having asserted nothing.
             */
            query: (soql) => /SELECT\s+COUNT\(\)/i.test(soql || '')
                ? new Promise((resolve, reject) => { counts.push({ resolve, reject, soql }); })
                : new Promise((resolve, reject) => { pending.push({ resolve, reject }); }),
            errorMessage: () => 'error'
        }
    };

    const counts = [];

    const source = [
        'var listGeneration = 0;',
        lift('function listResponseStillWanted(generation){'),
        /*
         * The real count helpers, not stubs. queryOnAllData fires the count
         * alongside the list, and that count is subject to the same staleness
         * rule - a superseded one must not write its total over the current
         * list's. Stubbing it out would leave that untested.
         */
        lift('function countQueryFrom(soql){'),
        lift('function refreshOrgTotal(query, url, generation){'),
        lift('$scope.' + handler + ' = function(query, url){') + ';',
        // Standing in for openMetadata, which does this and a great deal else.
        '$scope.__open = function(){ listGeneration++; };'
    ].join('\n');

    const names = Object.keys(env);
    new Function(...names, source)(...names.map((n) => env[n]));

    return { $scope, pending, counts, ask: () => $scope[handler]('SELECT Id FROM ApexClass', 'u') };
}

const rows = (n) => ({
    records: Array.from({ length: n }, (_, i) => ({ Id: '01p' + i })), totalSize: n
});

async function main() {

    /* ------------------------------------------------------------------ */
    /* The ordinary case still works                                       */
    /*                                                                     */
    /* A guard that drops everything would pass every test below and ship   */
    /* an app whose lists never load at all.                                */
    /* ------------------------------------------------------------------ */

    const plain = load('queryOnAllData');
    plain.$scope.__open();
    const single = plain.ask();
    plain.pending[0].resolve(rows(2));
    await single;
    assert.strictEqual(plain.$scope.AllMetaDataRecords.length, 2,
        'a single request renders - the guard must not block the common path');
    assert.strictEqual(plain.$scope.showAllData, true, 'and the list is shown');

    /* ------------------------------------------------------------------ */
    /* A superseded answer does not replace the wanted one                 */
    /*                                                                     */
    /* The reported failure, in the order it actually happens: the second   */
    /* request answers first and renders, then the first finally answers.   */
    /* ------------------------------------------------------------------ */

    const raced = load('queryOnAllData');
    raced.$scope.__open();
    const first = raced.ask();
    raced.$scope.__open();              // the user clicked again
    const second = raced.ask();

    raced.pending[1].resolve(rows(2));
    await second;
    assert.strictEqual(raced.$scope.AllMetaDataRecords.length, 2, 'the wanted list renders');

    raced.pending[0].resolve({ ssUnsupported: true, ssReason: 'cannot be queried in this org' });
    await first;
    assert.strictEqual(raced.$scope.AllMetaDataRecords.length, 2,
        'and the superseded answer does not empty it - this is the list vanishing');
    assert.strictEqual(raced.$scope.showAllData, true, 'the list stays on screen');
    assert.strictEqual(raced.$scope.__message, undefined,
        'and no message appears about a query nobody is waiting for');

    /* ------------------------------------------------------------------ */
    /* A superseded failure is equally silent                              */
    /*                                                                     */
    /* A rejection arriving late used to clear the rows and raise an error  */
    /* banner over a list that had loaded perfectly well.                   */
    /* ------------------------------------------------------------------ */

    const lateFailure = load('queryOnAllData');
    lateFailure.$scope.__open();
    const doomed = lateFailure.ask();
    lateFailure.$scope.__open();
    const good = lateFailure.ask();

    lateFailure.pending[1].resolve(rows(3));
    await good;
    lateFailure.pending[0].reject({ message: 'INVALID_TYPE' });
    await doomed;

    assert.strictEqual(lateFailure.$scope.AllMetaDataRecords.length, 3,
        'a superseded rejection leaves the rendered list alone');
    assert.strictEqual(lateFailure.$scope.__error, undefined,
        'and raises no error banner over a list that loaded');

    /*
     * A cancelled request is still dropped without complaint. cancelPending
     * remains the fast path - the generation is the floor under it, not a
     * replacement.
     */
    const cancelled = load('queryOnAllData');
    cancelled.$scope.__open();
    const aborted = cancelled.ask();
    cancelled.$scope.__open();
    cancelled.pending[0].reject({ cancelled: true });
    await aborted;
    assert.strictEqual(cancelled.$scope.__error, undefined, 'a cancelled request is not an error');

    /* ------------------------------------------------------------------ */
    /* Every list query, not just the one that was noticed                 */
    /*                                                                     */
    /* querySFDC fills "My <type>", queryOnAllData "All <type>", and        */
    /* queryOnAllDataFilterText the same list under a search. They write     */
    /* the same scope state, so any one of them can strand it.              */
    /* ------------------------------------------------------------------ */

    for (const handler of ['querySFDC', 'queryOnAllData', 'queryOnAllDataFilterText']) {
        const target = handler === 'querySFDC' ? 'records' : 'AllMetaDataRecords';

        const guarded = load(handler);
        guarded.$scope.__open();
        const stale = guarded.ask();
        guarded.$scope.__open();
        const current = guarded.ask();

        guarded.pending[1].resolve(rows(2));
        await current;
        assert.strictEqual(guarded.$scope[target].length, 2, handler + ' renders its list');

        guarded.pending[0].resolve(rows(0));
        await stale;
        assert.strictEqual(guarded.$scope[target].length, 2,
            handler + ' must ignore a superseded response, or its list empties at random');
    }

    /*
     * And the generation is taken when the request is made, not when the
     * answer arrives - reading it late would make every response look current.
     */
    for (const handler of ['querySFDC', 'queryOnAllData', 'queryOnAllDataFilterText']) {
        const body = lift('$scope.' + handler + ' = function(query, url){');
        const captured = body.indexOf('var generation = listGeneration;');
        assert.notStrictEqual(captured, -1, handler + ' must capture the generation');
        assert.ok(captured < body.indexOf('sfdc.query('),
            handler + ' must capture the generation before the request goes out');
    }

    /*
     * And the real openMetadata is what bumps it.
     *
     * Everything above drives a stand-in, because openMetadata also touches
     * jQuery, the DOM and a dozen scope fields. That makes the one thing the
     * stand-in cannot prove the one thing worth asserting directly: without
     * the bump in the shipped funnel, every generation is the same generation
     * and the guard is decoration - every test above still passes.
     */
    const openMetadata = lift('function openMetadata(data, options){');
    assert.ok(/listGeneration\+\+/.test(openMetadata),
        'openMetadata must take a new generation on every open, or nothing is ever ' +
        'superseded and the guard never rejects anything');
    assert.ok(openMetadata.indexOf('listGeneration++') < openMetadata.indexOf('$scope.selectedMetadata ='),
        'and it must do so before the new selection is published, so a response ' +
        'arriving mid-open is already stale rather than briefly current');


/* ------------------------------------------------------------------ */
/* The header total is subject to the same rule                        */
/*                                                                     */
/* queryOnAllData fires a SELECT COUNT() beside the list, and it can    */
/* answer after the user has moved to another object. Writing it then   */
/* puts one object's total on another object's list - a number that is  */
/* not wrong-looking, merely wrong, sitting beside the word "All".      */
/* ------------------------------------------------------------------ */

{
    const c = load('queryOnAllData');
    c.ask();
    c.$scope.__open();                       // the user moves on
    c.counts[0].resolve({ totalSize: 3512 });
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(c.$scope.orgTotalRecords, null,
        'a count that arrives after the user has navigated is dropped, not shown ' +
        'against whatever is on screen now');
}

{
    const c = load('queryOnAllData');
    c.ask();
    c.counts[0].resolve({ totalSize: 3512 });
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(c.$scope.orgTotalRecords, 3512,
        'while the count for the current list is kept - that is the whole point');
}

{
    // An object that refuses COUNT() leaves the header as it was.
    const c = load('queryOnAllData');
    c.ask();
    c.counts[0].reject({ message: 'MALFORMED_QUERY' });
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(c.$scope.orgTotalRecords, null,
        'a refused count is not an error, just no total');
}


/* ------------------------------------------------------------------ */
/* And the count has to actually count the org                         */
/*                                                                     */
/* A COUNT() that keeps the list's LIMIT returns the limit: the header  */
/* then reads "200 of 200" on an org with thousands, which is the exact */
/* falsehood this was added to remove, restated with more confidence.   */
/* ------------------------------------------------------------------ */

{
    const c = load('queryOnAllData');
    c.$scope.queryOnAllData(
        "SELECT Id, Name FROM ApexClass WHERE NamespacePrefix = null " +
        "ORDER BY LastModifiedDate DESC LIMIT 200", 'u');
    const soql = c.counts[0].soql;

    assert.ok(/SELECT\s+COUNT\(\)/i.test(soql), 'it is a count');
    assert.ok(!/\sLIMIT\s/i.test(soql),
        'with no LIMIT, or it counts up to the limit and reports the truncation ' +
        'as the total: ' + soql);
    assert.ok(!/ORDER\s+BY/i.test(soql),
        'and no ORDER BY, which an aggregate without a GROUP BY rejects: ' + soql);
    assert.ok(/WHERE\s+NamespacePrefix = null/i.test(soql),
        'while keeping the WHERE, or it counts rows the list was never showing: ' + soql);
    assert.ok(/FROM\s+ApexClass/i.test(soql), 'against the same object');
}

{
    /*
     * A WHERE with a LIMIT and no ORDER BY, which is a shape the lists really
     * send. With an ORDER BY present the WHERE capture stops there anyway, so
     * only this case proves the LIMIT boundary is doing anything - without it
     * the count reads "WHERE ... LIMIT 200" and counts the truncation.
     */
    const c = load('queryOnAllData');
    c.$scope.queryOnAllData(
        "SELECT Id FROM ApexClass WHERE NamespacePrefix = null LIMIT 200", 'u');
    const soql = c.counts[0].soql;
    assert.ok(!/LIMIT/i.test(soql),
        'the LIMIT is stripped even when no ORDER BY separates it: ' + soql);
    assert.ok(/WHERE\s+NamespacePrefix = null\s*$/i.test(soql),
        'and the WHERE survives intact, ending where the LIMIT began: ' + soql);
}


/* ------------------------------------------------------------------ */
/* Both lists get the schema-backed query, not just one               */
/*                                                                     */
/* openMetadata runs two lists per open: the user's records and the    */
/* whole org's. The second is started by searchMetadata, which takes a */
/* JSON snapshot of the spec the moment it is called - and it was      */
/* called synchronously, before the describe came back. So the "my"    */
/* list queried the object's real fields and the "all" list queried    */
/* the guess, from one object, in the same open.                       */
/*                                                                     */
/* The clone matters too: selectedMetadata is a copy of `data` when the */
/* menu opens with options.clone, and `data` is what searchMetadata is  */
/* handed - so writing the spec to only one of them leaves the other    */
/* holding the guess.                                                   */
/* ------------------------------------------------------------------ */

{
    const lift2 = (sig) => {
        const start = controller.indexOf(sig);
        assert.notStrictEqual(start, -1, 'could not find ' + sig);
        let depth = 0, i = controller.indexOf('{', start);
        for (; i < controller.length; i++) {
            if (controller[i] === '{') { depth++; }
            else if (controller[i] === '}') { depth--; if (depth === 0) { return controller.slice(start, i + 1); } }
        }
        throw new Error('unbalanced');
    };

    const guessed = {
        value: 'AppDefinition', url: 'u', type: 'table',
        query: 'SELECT Id, Name FROM AppDefinition WHERE mine',
        queryForAll: 'SELECT Id, Name FROM AppDefinition'
    };
    const backed = {
        columns: [{ field: 'Label', label: 'Label', type: 'string' }],
        displayField: 'DeveloperName',
        query: 'SELECT DurableId, DeveloperName, Label FROM AppDefinition WHERE mine',
        queryForAll: 'SELECT DurableId, DeveloperName, Label FROM AppDefinition'
    };

    const ran = {};
    const $scope = {
        // A clone, as options.clone produces - the case that hid the bug.
        selectedMetadata: JSON.parse(JSON.stringify(guessed)),
        querySFDC: (q) => { ran.my = q; return Promise.resolve(); },
        // The real searchMetadata snapshots what it is handed.
        searchMetadata: (menu) => { ran.all = JSON.parse(JSON.stringify(menu)).queryForAll; }
    };
    const env = {
        $scope,
        $q: Object.assign((fn) => new Promise(fn), { when: (v) => Promise.resolve(v) }),
        /*
         * A non-empty list holding a *different* object. An empty one cannot
         * tell a correct value-matched lookup from one that matches anything:
         * both answer "not authored" and the assertion passes either way.
         */
        MetaDataContainer: { systemData: [{ value: 'CustomField', queryForAll: 'SELECT Id FROM CustomField' }] },
        DynamicMetadataService: { specWithSchema: () => Promise.resolve(backed) }
    };
    const src = [
        'var listGeneration = 0;',
        lift2('function listResponseStillWanted(generation){'),
        lift2('function runListForSchema(data, queryToRun){'),
        'return runListForSchema;'
    ].join('\n');

    const run = new Function(...Object.keys(env), src)(...Object.values(env));
    await run(guessed, guessed.query);

    assert.ok(/DurableId/.test(ran.my),
        'the user\'s list uses the schema-backed query: ' + ran.my);
    assert.ok(/DurableId/.test(ran.all),
        'and so does the whole-org list - this is the half that was still guessing: ' + ran.all);
    assert.ok(!/,\s*Name\b/.test(ran.all),
        'neither asks for a Name the object has not got: ' + ran.all);
}


/* ------------------------------------------------------------------ */
/* A hand-authored query is never rewritten                            */
/*                                                                     */
/* A few entries carry queries written by hand in MetaDataContainer,   */
/* and they select things the generic builder cannot know to ask for.  */
/* CustomField, Layout, ValidationRule and WebLink all pull            */
/* EntityDefinition.QualifiedApiName - the only reason a field's row   */
/* shows which object it belongs to. Replacing those with a            */
/* schema-built SELECT dropped the relationship, and every one of      */
/* those lists silently lost its object prefix.                        */
/*                                                                     */
/* The describe still contributes columns. It just does not get to     */
/* rewrite a query somebody wrote on purpose.                          */
/* ------------------------------------------------------------------ */

{
    const lift3 = (sig) => {
        const start = controller.indexOf(sig);
        assert.notStrictEqual(start, -1, 'could not find ' + sig);
        let depth = 0, i = controller.indexOf('{', start);
        for (; i < controller.length; i++) {
            if (controller[i] === '{') { depth++; }
            else if (controller[i] === '}') { depth--; if (depth === 0) { return controller.slice(start, i + 1); } }
        }
        throw new Error('unbalanced');
    };
    const src = [
        'var listGeneration = 0;',
        lift3('function listResponseStillWanted(generation){'),
        lift3('function runListForSchema(data, queryToRun){'),
        'return runListForSchema;'
    ].join('\n');

    const AUTHORED = 'SELECT Id, DeveloperName, TableEnumOrId, ' +
                     'EntityDefinition.QualifiedApiName, NamespacePrefix FROM CustomField';
    const data = { value: 'CustomField', url: 'u', type: 'table',
                   query: AUTHORED, queryForAll: AUTHORED };
    const spec = {
        columns: [{ field: 'Length', label: 'Length', type: 'int' }],
        displayField: 'DeveloperName',
        query: 'SELECT Id, DeveloperName, NamespacePrefix FROM CustomField',
        queryForAll: 'SELECT Id, DeveloperName, NamespacePrefix FROM CustomField'
    };
    const ran = {};
    const $scope = {
        selectedMetadata: data,
        querySFDC: (q) => { ran.my = q; return Promise.resolve(); },
        searchMetadata: (m) => { ran.all = JSON.parse(JSON.stringify(m)).queryForAll; }
    };
    const env = {
        $scope,
        $q: Object.assign((fn) => new Promise(fn), { when: (v) => Promise.resolve(v) }),
        MetaDataContainer: { systemData: [{ value: 'CustomField', queryForAll: AUTHORED }] },
        DynamicMetadataService: { specWithSchema: () => Promise.resolve(spec) }
    };
    const run = new Function(...Object.keys(env), src)(...Object.values(env));
    await run(data, data.query);

    assert.ok(/EntityDefinition\.QualifiedApiName/.test(ran.my),
        "the user's list keeps the authored relationship: " + ran.my);
    assert.ok(/EntityDefinition\.QualifiedApiName/.test(ran.all),
        'and so does the whole-org list - without it a field row cannot say ' +
        'which object it is on: ' + ran.all);
    assert.ok(/TableEnumOrId/.test(ran.all),
        'along with the fallback the prefix falls back to: ' + ran.all);
    assert.ok((data.columns || []).length > 0,
        'while the describe still contributes its columns');
}

    console.log('list response generation regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
