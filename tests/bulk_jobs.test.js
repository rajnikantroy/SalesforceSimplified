/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Bulk API job status.
 *
 * Setup's Bulk Data Load Jobs page lists v1 jobs only and says almost nothing
 * about a v2 one, so the usual way to find out why an import of forty thousand
 * rows half-worked is a REST call somebody has to know how to write.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const container = fs.readFileSync('./js/angular/services/MetaDataContainer.js', 'utf8');
const directives = fs.readFileSync('./js/angular/directives.js', 'utf8');

function lift(source, signature) {
    const start = source.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') { depth++; }
        else if (source[i] === '}') { depth--; if (depth === 0) { return source.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

function main() {

    /* ------------------------------------------------------------------ */
    /* Two lists, shown as one                                             */
    /* ------------------------------------------------------------------ */

    const rows = new Function(
        lift(controller, 'function withKind(job, kind) {') + '\n' +
        lift(controller, 'function bulkJobRows(ingest, query) {') +
        ';return bulkJobRows;')();

    const INGEST = [
        { id: '750a', object: 'Account', operation: 'insert', state: 'JobComplete',
          createdDate: '2026-08-10T10:00:00.000+0000' },
        { id: '750c', object: 'Contact', operation: 'upsert', state: 'Failed',
          createdDate: '2026-08-14T10:00:00.000+0000' }
    ];
    const QUERY = [
        { id: '750b', object: 'Lead', operation: 'query', state: 'JobComplete',
          createdDate: '2026-08-12T10:00:00.000+0000' }
    ];

    const merged = rows(INGEST, QUERY);
    assert.strictEqual(merged.length, 3, 'both kinds appear');

    /*
     * Newest first, across both. Left in arrival order the ingest jobs would
     * all sit above the query jobs whatever their dates - which reads as
     * "nothing has run since" for whichever kind came second.
     */
    assert.deepStrictEqual(merged.map((j) => j.id), ['750c', '750b', '750a'],
        'sorted by date across both lists, not concatenated: ' +
        merged.map((j) => j.id).join(', '));

    assert.strictEqual(merged.find((j) => j.id === '750b').kind, 'query',
        'each row says which list it came from');
    assert.strictEqual(merged.find((j) => j.id === '750a').kind, 'ingest');

    /* Either list being empty or absent is not a crash. */
    assert.strictEqual(rows(INGEST, []).length, 2, 'one empty list is fine');
    assert.strictEqual(rows(null, null).length, 0, 'and neither list at all');
    assert.strictEqual(rows([{ object: 'Account' }], []).length, 0,
        'a record with no id is not a job - it cannot be asked about');

    /* A missing date sorts last rather than throwing the order out. */
    const undated = rows([{ id: '750z', createdDate: '' }], QUERY);
    assert.strictEqual(undated[undated.length - 1].id, '750z',
        'an undated job goes to the bottom, not the top');

    /* ------------------------------------------------------------------ */
    /* The number nobody is given                                          */
    /* ------------------------------------------------------------------ */

    const succeeded = new Function(
        lift(controller, '$scope.bulkSucceeded = function(detail){')
            .replace('$scope.bulkSucceeded = ', 'var f = ') + ';return f;')();

    /*
     * Salesforce reports processed and failed separately, and processed
     * includes the failures - so how many actually landed is not in the
     * response.
     */
    assert.strictEqual(succeeded({ numberRecordsProcessed: 1000, numberRecordsFailed: 40 }), 960,
        'processed includes the failures, so the ones that landed are the difference');
    assert.strictEqual(succeeded({ numberRecordsProcessed: 500, numberRecordsFailed: 0 }), 500);
    assert.strictEqual(succeeded({}), 0, 'a job that has not started yet is zero');
    assert.strictEqual(succeeded(null), 0, 'and no job at all is zero, not a throw');
    assert.strictEqual(succeeded({ numberRecordsProcessed: 10, numberRecordsFailed: 40 }), 0,
        'and it never goes negative, whatever the org reports');

    /* ------------------------------------------------------------------ */
    /* States worth noticing                                               */
    /* ------------------------------------------------------------------ */

    const stateClass = new Function(
        lift(controller, '$scope.bulkStateClass = function(state){')
            .replace('$scope.bulkStateClass = ', 'var f = ') + ';return f;')();

    assert.strictEqual(stateClass('Failed'), 'is-bad', 'Failed is the one people came about');
    assert.strictEqual(stateClass('Aborted'), 'is-bad', 'and so is Aborted');
    assert.strictEqual(stateClass('JobComplete'), 'is-good', 'complete is the hoped-for answer');
    for (const state of ['Open', 'UploadComplete', 'InProgress', '']) {
        assert.strictEqual(stateClass(state), '',
            state + ' is still happening and needs no colour of its own');
    }

    /* ------------------------------------------------------------------ */
    /* One kind failing does not hide the other                            */
    /* ------------------------------------------------------------------ */

    const load = lift(controller, '$scope.loadBulkJobs = function(){');
    assert.ok(/refused\.length === 2/.test(load),
        'both refused is a permission problem, and says so');
    assert.ok(/refused\.length === 1/.test(load),
        'one refused still shows the other - an empty half looks like an empty org');
    assert.ok(/Manage Data Integrations/.test(load),
        'and names the permission, which is the actionable part');

    /*
     * Both ways it can be refused. There are two - a non-2xx answer and a
     * request that never arrived - and testing that the marker appears
     * somewhere passes with either one silently returning an empty list,
     * which reads as an org with no jobs.
     */
    const list = lift(controller, 'function bulkList(kind) {');
    assert.strictEqual((list.match(/refused: kind/g) || []).length, 2,
        'a refused answer and a failed request are both marked as refusals: ' + list);
    assert.ok(/if\(!answer\.ok\)\{ return \{ refused: kind/.test(list),
        'a non-2xx answer is a refusal');
    assert.ok(/\}, function\(\)\{[\s\S]*?refused: kind/.test(list),
        'and so is a request that never arrived');

    /* ------------------------------------------------------------------ */
    /* Selecting a job                                                     */
    /* ------------------------------------------------------------------ */

    const select = lift(controller, '$scope.selectBulkJob = function(job){');
    assert.ok(/'\/jobs\/' \+ job\.kind \+ '\/' \+ job\.id/.test(select),
        'the detail is fetched from the list the job came from - an ingest id ' +
        'under /jobs/query is a 404');
    assert.ok(/\$scope\.bulk\.detail = null;/.test(select),
        'the previous job\'s detail is cleared first, or it sits under the new ' +
        'id until the answer arrives');
    assert.ok(/if\(!job \|\| !job\.id\)\{ return; \}/.test(select), 'and a row with no id does nothing');

    /* ------------------------------------------------------------------ */
    /* Wiring                                                              */
    /* ------------------------------------------------------------------ */

    assert.ok(/label: "Bulk API Job Status"/.test(container), 'the menu entry exists');
    assert.ok(/value: "BulkJobs"/.test(container), 'with a value');
    assert.ok(/'BulkJobs': \d/.test(controller),
        'pinned to the utility bar, or it sorts into the scrolling metadata list');
    assert.ok(/bulkjobs: 'bulkjobs'/.test(directives), 'the directive is registered');
    assert.ok(/<bulkjobs><\/bulkjobs>/.test(view), 'and the page is mounted');

    const page = view.slice(view.indexOf('this.bulkjobs ='),
                            view.indexOf('\nthis.', view.indexOf('this.bulkjobs =') + 10));
    assert.ok(/ng-click="selectBulkJob\(job\)"/.test(page), 'a row can be picked');
    /*
     * Marked by id. Keyed on the kind - or on anything two rows share - every
     * ingest job lights up at once, which says the wrong thing while still
     * containing the class name.
     */
    assert.ok(/is-picked\\': bulk\.selected\.id === job\.id/.test(page),
        'the picked row is the one whose id was chosen: ' +
        (/is-picked[^}]*/.exec(page) || ['no marker'])[0]);
    assert.ok(/bulkSucceeded\(bulk\.detail\)/.test(page),
        'the succeeded count is shown, since the org does not report it');
    assert.ok(/bulk\.detail\.errorMessage/.test(page),
        'and the job\'s own error, which is why a failed job was opened');


    /* ------------------------------------------------------------------ */
    /* A job id the list does not have                                     */
    /*                                                                     */
    /* The list is the recent ones. An id from a log, a ticket or a         */
    /* colleague is usually older than that, and without this the only way  */
    /* to look at it is a REST call - which is what this page exists to     */
    /* save.                                                                */
    /* ------------------------------------------------------------------ */

    const parseId = new Function(
        lift(controller, 'function normaliseJobId(text){') + ';return normaliseJobId;')();

    assert.strictEqual(parseId('750xx0000000001AAA').id, '750xx0000000001AAA',
        'an 18-character id is taken as it is');
    assert.strictEqual(parseId('750xx0000000001').id, '750xx0000000001',
        'and so is a 15-character one');
    assert.strictEqual(parseId('  750xx0000000001AAA  ').id, '750xx0000000001AAA',
        'trimmed - a pasted id usually arrives with something around it');

    assert.ok(parseId('').error, 'nothing entered is a prompt');
    assert.ok(/such as 750/.test(parseId('').error), 'with a worked example');
    assert.ok(parseId('   ').error, 'and so is whitespace');

    const wrongLength = parseId('750xx');
    assert.ok(wrongLength.error, 'a fragment is refused');
    assert.ok(/is 15 or 18 characters/.test(wrongLength.error) && /That one is 5/.test(wrongLength.error),
        'saying what is wrong with this one rather than restating the rule: ' +
        wrongLength.error);
    assert.ok(parseId('750xx0000000001AA!').error, 'and a non-id character is not an id');

    /*
     * Warned about, not refused. 750 is the Bulk job prefix, but an id that is
     * not one is a mistake worth naming without deciding on the user's behalf
     * that it cannot be tried.
     */
    const notAJob = parseId('001d200001RkMFBAA3');
    assert.ok(!notAJob.error, 'an account id is not refused outright');
    assert.strictEqual(notAJob.unexpected, true, 'but it is flagged');
    assert.strictEqual(parseId('750xx0000000001AAA').unexpected, false,
        'while a real job id is not');

    const lookup = lift(controller, '$scope.lookupBulkJob = function(){');
    assert.ok(/was looked up anyway/.test(lookup),
        'and the warning says the lookup still happened, or it reads as an error ' +
        'that stopped something');

    /*
     * Both kinds, because an id does not say which it is - and ingest first,
     * since loads outnumber extracts and the second call only happens once the
     * first has said no.
     */
    assert.ok(/jobDetail\('ingest', parsed\.id\)/.test(lookup), 'ingest is tried');
    assert.ok(/jobDetail\('query', parsed\.id\)/.test(lookup), 'then query');
    assert.ok(lookup.indexOf("jobDetail('ingest'") < lookup.indexOf("jobDetail('query'"),
        'in that order');
    assert.ok(/if\(found\)\{ return found; \}/.test(lookup),
        'and the second call is skipped when the first found it');

    /*
     * A 404 is an answer - the job is not of this kind - so it must not look
     * like a failure, or "try the other one" and "the request broke" become
     * the same thing.
     */
    const detail = lift(controller, 'function jobDetail(kind, id){');
    assert.ok(/if\(!answer\.ok\)\{ return null; \}/.test(detail),
        'a refusal resolves as not-found rather than rejecting');

    assert.ok(/No Bulk API 2\.0 job in this org has that id/.test(lookup),
        'neither kind having it is said plainly');
    assert.ok(/Bulk Data Load Jobs/.test(lookup),
        'and points at where v1 jobs actually are, since that is the likeliest ' +
        'reason an id is not found');
    /*
     * In the not-found branch specifically. The failure callback clears it
     * too, so looking for the assignment anywhere in the function passes with
     * a found-nothing that leaves the heading standing.
     */
    const notFound = /if\(!found\)\{([\s\S]*?)\n            \}/.exec(lookup);
    assert.ok(notFound, 'the not-found branch must be findable');
    assert.ok(/\$scope\.bulk\.selected = null;/.test(notFound[1]),
        'nothing is left selected - a heading over an empty detail reads as a job ' +
        'that exists and could not be read: ' + notFound[1].trim());

    /* The detail pane is no longer only for a row that was clicked. */
    assert.ok(/ng-show="bulk\.selected \|\| bulk\.detailError"/.test(page),
        'a looked-up id has no row behind it, so the pane cannot depend on one');
    assert.ok(/ng-show="bulk\.jobs\.length"/.test(page),
        'while the list itself still needs jobs to list');
    assert.ok(/lookupBulkJob\(\)/.test(page), 'the lookup is reachable');
    assert.ok(/keyCode === 13 && lookupBulkJob\(\)/.test(page),
        'and Enter works, since pasting an id is the whole interaction');

    console.log('bulk jobs test passed');
}

main();
