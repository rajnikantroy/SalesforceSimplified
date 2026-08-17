/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * "Show earlier history" - does it work?
 *
 * The matching half does. This runs the real auditHistoryFor against realistic
 * SetupAuditTrail prose and checks the toggle path around it, because the
 * failure that made the feature look broken was neither: the table rendered
 * the history rows it had just found and then rendered "No changes recorded
 * yet" underneath them, because the empty-state was gated on the observed
 * half of the timeline rather than on the timeline.
 */

const service = fs.readFileSync('./js/angular/services/BookmarkService.js', 'utf8');
const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');

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

/* Prose as the org actually writes it. */
const ROWS = [
    { Id: '0Ym1', CreatedDate: '2026-08-01T10:00:00.000+0000', Section: 'Apex Class',
      Display: 'Changed BillingService Apex Class', CreatedBy: { Name: 'Ada' } },
    { Id: '0Ym2', CreatedDate: '2026-08-02T10:00:00.000+0000', Section: 'Custom Objects',
      Display: 'Created new custom field Amount__c on Invoice__c (Currency)', CreatedBy: { Name: 'Ada' } },
    { Id: '0Ym3', CreatedDate: '2026-08-04T10:00:00.000+0000', Section: 'Flows',
      Display: 'Activated flow Order_Fulfilment version 3', CreatedBy: { Name: 'Bo' } },
    /* The near-miss the whole-word rule exists for. */
    { Id: '0Ym4', CreatedDate: '2026-08-05T10:00:00.000+0000', Section: 'Apex Class',
      Display: 'Changed BillingServiceTest Apex Class', CreatedBy: { Name: 'Ada' } },
    { Id: '0Ym5', CreatedDate: 'not-a-date', Section: 'Apex Class',
      Display: 'Changed BillingService Apex Class', CreatedBy: { Name: 'Ada' } }
];

function history(rows, fail) {
    /*
     * Captured through an object passed into the generated scope. A plain
     * closure variable here is shadowed by the one inside new Function, so the
     * getter reads a different binding from the one sfdc.query writes - and
     * every assertion about the SOQL then tests nothing.
     */
    const capture = { soql: null };
    const env = {
        capture,
        $q: { when: (v) => Promise.resolve(v) },
        sfdc: { query: (q) => { capture.soql = q; return fail ? Promise.reject(new Error('403')) : Promise.resolve({ records: rows }); } }
    };
    const body =
        /var HISTORY_DAYS = \d+;/.exec(service)[0] + '\n' +
        /var HISTORY_ROW_LIMIT = \d+;/.exec(service)[0] + '\n' +
        /var MIN_MATCHABLE_NAME = \d+;/.exec(service)[0] + '\n' +
        lift(service, 'function mentions(display, name)') + '\n' +
        'var api = {};\n' +
        lift(service, 'this.auditHistoryFor = function(items)').replace('this.auditHistoryFor =', 'api.auditHistoryFor =') +
        '\nreturn { api: api, soql: function(){ return capture.soql; } };';
    return new Function(...Object.keys(env), body)(...Object.values(env));
}

async function main() {

    const watched = [
        { type: 'ApexClass', typeLabel: 'Apex Class', id: '01p1', name: 'BillingService' },
        { type: 'CustomField', typeLabel: 'Custom Field', id: '00N1', name: 'Amount__c' },
        { type: 'Flow', typeLabel: 'Flow', id: '3011', name: 'Order_Fulfilment' },
        { type: 'Layout', typeLabel: 'Layout', id: '00h1', name: 'Inv' }   // 3 chars
    ];

    /* ------------------------------------------------------------------ */
    /* The matching half                                                   */
    /* ------------------------------------------------------------------ */

    const h = history(ROWS);
    const result = await h.api.auditHistoryFor(watched);

    assert.strictEqual(result.events.length, 3, 'three of the five rows match a watched name');
    assert.deepStrictEqual(result.events.map((e) => e.name),
        ['Order_Fulfilment', 'Amount__c', 'BillingService'],
        'newest first, and each carries the component it was matched to');

    assert.ok(!result.events.some((e) => /BillingServiceTest/.test(e.display)),
        'BillingService must not match BillingServiceTest, or watching a common ' +
        'prefix drags in every component built on it');
    assert.ok(!result.events.some((e) => isNaN(e.at)),
        'a row whose date will not parse is dropped, not dated to 1970');
    assert.strictEqual(result.tooShort, 1, 'a 3-character name is too short to match safely');
    assert.strictEqual(result.refused, false);

    assert.ok(/LAST_N_DAYS:180/.test(h.soql()), 'bounded to the audit trail\'s own retention');
    assert.ok(/ORDER BY CreatedDate DESC/.test(h.soql()), 'newest first, so a cut list keeps the recent end');

    /* Every event must be attributable, or "matched to X" in the row is a lie. */
    result.events.forEach((e) => {
        assert.ok(e.auditId, 'each event names the audit row it came from');
        assert.strictEqual(e.source, 'audit');
        assert.strictEqual(e.seen, true, 'history is not news and must not inflate the unseen count');
    });

    /* No permission is not an error the user has to decode. */
    const refused = await history(ROWS, true).api.auditHistoryFor(watched);
    assert.deepStrictEqual(refused.events, [], 'a refusal costs the history');
    assert.strictEqual(refused.refused, true, 'and says so, rather than looking like an empty org');

    /* Nothing matchable: no query at all. Asserted on the instance that was
     * actually called - a fresh one reports null whatever the code does. */
    const shortOnly = history(ROWS);
    const short = await shortOnly.api.auditHistoryFor([{ type: 'Layout', id: '1', name: 'Inv' }]);
    assert.strictEqual(short.events.length, 0);
    assert.strictEqual(short.tooShort, 1);
    assert.strictEqual(shortOnly.soql(), null, 'and the org is not asked for nothing');

    /* ------------------------------------------------------------------ */
    /* The empty state describes the table it sits in                      */
    /*                                                                     */
    /* This is what made the feature look broken: the rows appeared and    */
    /* "No changes recorded yet" appeared underneath them.                 */
    /* ------------------------------------------------------------------ */

    const repeat = /<tr ng-repeat="event in (\w+) track by/.exec(view);
    assert.ok(repeat, 'the timeline still renders through ng-repeat');
    const emptyGate = /<tr ng-if="!(\w+)\.length">'\+\n'      <td colspan="4"/.exec(view);
    assert.ok(emptyGate, 'the empty row must still exist');
    assert.strictEqual(emptyGate[1], repeat[1],
        'the empty state is gated on the same list the rows come from (' + repeat[1] +
        '), not on ' + emptyGate[1]);

    /* The control it points at is the one on screen. */
    assert.ok(!/checkbox above/.test(view),
        'the empty state must not send the user to a checkbox that was replaced by a button');
    assert.ok(/Show earlier history/.test(view), 'it names the button');

    /*
     * And when history is on and still found nothing, say why it can be
     * nothing rather than leaving "no changes" to read as a failure. Not every
     * change reaches SetupAuditTrail.
     */
    const onNote = /<span ng-show="showBookmarkHistory && !isLoadingHistory">([^<]*)</.exec(view);
    assert.ok(onNote, 'an on-and-empty history explains itself');
    assert.ok(/does not record everything/.test(onNote[1]), 'honestly: ' + onNote[1].trim());

    /* ------------------------------------------------------------------ */
    /* The toggle asks once, and re-asks only when the watch list grew     */
    /* ------------------------------------------------------------------ */

    const toggle = lift(controller, '$scope.toggleBookmarkHistory = function(){');
    assert.ok(/historyFetchedFor !== watchSignature\(\)/.test(toggle),
        'turning it back on after turning it off must not re-query for the same list');
    assert.ok(/else \{\s*rebuildTimeline\(\);/.test(toggle),
        'and must still rebuild, or switching it off leaves the history rows on screen');
    assert.ok(/setHistoryEnabled/.test(toggle), 'the choice is remembered');

    const refresh = lift(controller, 'function refreshBookmarkState(){');
    assert.ok(/historyCovers\(watchKeys\(\)\)/.test(refresh),
        'removing a watch filters what was already read rather than re-reading it');
    assert.ok(/!\$scope\.isLoadingHistory/.test(refresh),
        'and a burst of stars costs one query, not one each');

    console.log('show earlier history test passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
