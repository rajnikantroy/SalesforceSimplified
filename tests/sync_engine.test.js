/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const engine = require('../js/sync-engine.js');

/*
 * The sync engine, against its own functions rather than a description of
 * them. This is the piece that writes into a second org, so the assertions
 * that matter most are the ones about what it refuses to do: deploy without
 * rollback, run a job that already succeeded, or carry components the wrong
 * way down a one-way pipeline.
 */

/* ------------------------------------------------------------------ */
/* The manifest                                                        */
/* ------------------------------------------------------------------ */

const manifest = engine.ssSyncPackageXml([
    { type: 'ApexClass', name: 'Zebra' },
    { type: 'ApexClass', name: 'Apple' },
    { type: 'CustomObject', name: 'Account' },
    { type: 'ApexClass', name: 'Apple' }
], '62.0');

/*
 * One <types> block per type. Salesforce accepts a block per member from some
 * orgs and refuses it from others, and the documented form is the grouped
 * one - so a manifest with two ApexClass blocks is a bug that only shows up
 * against certain orgs, which is the worst kind to ship.
 */
assert.strictEqual((manifest.match(/<name>ApexClass<\/name>/g) || []).length, 1,
    'one <types> block per metadata type');
assert.strictEqual((manifest.match(/<types>/g) || []).length, 2,
    'two types selected, two blocks');

/* Duplicates collapse: ticking the same class twice is one member. */
assert.strictEqual((manifest.match(/<members>Apple<\/members>/g) || []).length, 1,
    'a component named twice appears once');

/* Sorted, so the same selection always produces the same manifest. */
assert.ok(manifest.indexOf('Apple') < manifest.indexOf('Zebra'),
    'members are sorted');
assert.ok(manifest.indexOf('ApexClass') < manifest.indexOf('CustomObject'),
    'types are sorted');

assert.ok(manifest.includes('<version>62.0</version>'), 'the API version is stated');
assert.strictEqual(engine.ssSyncPackageXml([], '62.0'), null,
    'no components is no manifest, not an empty one');
assert.strictEqual(engine.ssSyncPackageXml([{ type: 'ApexClass' }], '62.0'), null,
    'a component with no name is not a component');

/* A name is org data and goes into XML: it gets escaped like any other. */
const escaped = engine.ssSyncPackageXml([{ type: 'ApexClass', name: 'A&B<C' }], '62.0');
assert.ok(escaped.includes('A&amp;B&lt;C'), 'component names are escaped');
assert.ok(!escaped.includes('A&B<C'), 'and not left raw');

/* ------------------------------------------------------------------ */
/* The retrieve request                                                */
/* ------------------------------------------------------------------ */

const unpackaged = engine.ssSyncUnpackaged(manifest);
assert.ok(!unpackaged.includes('<?xml'), 'the declaration does not go inside an envelope');
assert.ok(!/<Package/.test(unpackaged), 'nor does the Package element');
assert.ok(unpackaged.includes('<met:types>') && unpackaged.includes('<met:members>Apple</met:members>'),
    'the body is re-expressed in the envelope\'s namespace prefix');
assert.ok(!/<types>/.test(unpackaged),
    'no unprefixed elements left behind - the org rejects the envelope on those');

/* ------------------------------------------------------------------ */
/* The deploy request                                                  */
/* ------------------------------------------------------------------ */

const deploy = engine.ssSyncDeployBody('UEsDBBQ=', { checkOnly: false });

/*
 * The assertion this whole feature rests on. A partial deploy leaves the
 * target org in a state neither org's history describes, and the point of a
 * pipeline is that the two match.
 */
assert.ok(deploy.includes('<met:rollbackOnError>true</met:rollbackOnError>'),
    'deploys always roll back on error');
assert.ok(!deploy.includes('<met:rollbackOnError>false'),
    'and there is no way to ask for the other behaviour');

assert.ok(deploy.includes('<met:checkOnly>false</met:checkOnly>'), 'a real deploy is not check-only');
assert.ok(engine.ssSyncDeployBody('x', { checkOnly: true })
    .includes('<met:checkOnly>true</met:checkOnly>'), 'a validation is check-only');
assert.ok(deploy.includes('<met:singlePackage>true</met:singlePackage>'),
    'the zip retrieve produced is a single package');

/* ------------------------------------------------------------------ */
/* Reading the org's answers                                           */
/* ------------------------------------------------------------------ */

const retrievePending = engine.ssSyncRetrieveStatus(
    '<soapenv:Body><result><done>false</done><status>InProgress</status></result></soapenv:Body>');
assert.strictEqual(retrievePending.done, false, 'InProgress is not done');
assert.strictEqual(retrievePending.zipFile, null, 'and carries no package');

const retrieveDone = engine.ssSyncRetrieveStatus(
    '<result><done>true</done><status>Succeeded</status><zipFile>UEsDBBQA\nCAgI</zipFile></result>');
assert.strictEqual(retrieveDone.done, true);
assert.strictEqual(retrieveDone.zipFile, 'UEsDBBQACAgI',
    'the base64 is unwrapped - the newlines the org inserts are not part of it');

const deployFailed = engine.ssSyncDeployStatus(
    '<result><done>true</done><status>Failed</status><success>false</success>' +
    '<numberComponentsDeployed>3</numberComponentsDeployed>' +
    '<numberComponentsTotal>5</numberComponentsTotal>' +
    '<numberComponentErrors>2</numberComponentErrors>' +
    '<details><componentFailures><componentType>ApexClass</componentType>' +
    '<fullName>Billing</fullName><lineNumber>12</lineNumber>' +
    '<problem>Variable does not exist: total</problem></componentFailures>' +
    '<componentFailures><componentType>ApexTrigger</componentType>' +
    '<fullName>OnAccount</fullName><problem>Invalid type</problem></componentFailures>' +
    '</details></result>');

assert.strictEqual(deployFailed.done, true);
assert.strictEqual(deployFailed.success, false);
assert.strictEqual(deployFailed.failures.length, 2, 'both component failures are read');
assert.strictEqual(deployFailed.failures[0].name, 'Billing');
assert.strictEqual(deployFailed.failures[0].line, '12');
assert.strictEqual(deployFailed.failures[0].problem, 'Variable does not exist: total');
assert.strictEqual(deployFailed.counts.deployed, 3);
assert.strictEqual(deployFailed.counts.total, 5);

/* ------------------------------------------------------------------ */
/* What the org has finished with, while it is still working           */
/* ------------------------------------------------------------------ */

/*
 * checkDeployStatus reports each component as it completes, and those were
 * being discarded - which left somebody watching a twenty-minute deploy with
 * a spinner and no answer to "what is it doing now".
 */
const midway = engine.ssSyncDeployStatus(
    '<result><done>false</done><status>InProgress</status>' +
    '<numberComponentsDeployed>2</numberComponentsDeployed>' +
    '<numberComponentsTotal>5</numberComponentsTotal>' +
    '<details>' +
    '<componentSuccesses><componentType>ApexClass</componentType>' +
    '<fullName>Alpha</fullName></componentSuccesses>' +
    '<componentSuccesses><fullName>package.xml</fullName></componentSuccesses>' +
    '<componentSuccesses><componentType>ApexTrigger</componentType>' +
    '<fullName>Beta</fullName></componentSuccesses>' +
    '</details></result>');

assert.deepStrictEqual(midway.recent, ['ApexClass Alpha', 'ApexTrigger Beta'],
    'the finished components are named, type first: ' + midway.recent.join(', '));

/*
 * The manifest is not a component anybody deployed. The org reports it as one
 * of the successes, and listing it means the progress view names a file the
 * user never ticked.
 */
assert.ok(!midway.recent.some(function (name) { return /package\.xml/.test(name); }),
    'package.xml is not listed as a deployed component');

assert.strictEqual(midway.counts.deployed, 2,
    'and the count comes from the org\'s tally, not the length of that list');

/* Capped, because a large package reports hundreds and only the recent few
 * are worth keeping on the record. */
let manySuccesses = '<result><done>false</done><details>';
for (let i = 0; i < 40; i += 1) {
    manySuccesses += '<componentSuccesses><componentType>ApexClass</componentType>' +
        '<fullName>Class' + i + '</fullName></componentSuccesses>';
}
const capped = engine.ssSyncDeployStatus(manySuccesses + '</details></result>');
assert.ok(capped.recent.length <= 8,
    'the list is capped: ' + capped.recent.length);
assert.strictEqual(capped.recent[capped.recent.length - 1], 'ApexClass Class39',
    'and keeps the most recent, which is what movement looks like');

/*
 * A deploy that says done and success separately: success without done is a
 * status from partway through, and treating it as finished reports a result
 * the org has not reached.
 */
const halfway = engine.ssSyncDeployStatus(
    '<result><done>false</done><status>InProgress</status><success>true</success></result>');
assert.strictEqual(halfway.success, false, 'success only counts once the org says done');

/* The summary is the org's words, not ours. */
const summary = engine.ssSyncFailureSummary(deployFailed);
assert.ok(summary.includes('Variable does not exist: total'),
    'the failure line quotes the org: ' + summary);
assert.ok(summary.includes('ApexClass Billing'), 'and says which component');
assert.ok(summary.includes('1 more'), 'and that there are others');

assert.ok(engine.ssSyncFailureSummary(
    engine.ssSyncDeployStatus('<result><done>true</done><status>Canceled</status></result>'))
    .includes('Canceled'), 'with no component failures it falls back to the status');

/* ------------------------------------------------------------------ */
/* Job records                                                         */
/* ------------------------------------------------------------------ */

const fresh = engine.ssSyncNewJob({
    pipelineId: 'pipe_1',
    source: { origin: 'https://a.my.salesforce.com', label: 'a' },
    target: { origin: 'https://b.my.salesforce.com', label: 'b' },
    components: [{ type: 'ApexClass', name: 'Foo' }]
});

/*
 * Staged, never running. The user asked for changes to be reviewed before
 * they land in the second org; a job that arrived already running would be
 * that decision quietly reversed.
 */
assert.strictEqual(fresh.state, 'staged', 'a new job waits for a decision');
assert.strictEqual(fresh.attempts, 0);
assert.strictEqual(fresh.history.length, 1, 'and its own creation is history');

const running = engine.ssSyncTransition(fresh, 'running', 'Retrieving.', { stage: 'retrieve' });
assert.strictEqual(running.state, 'running');
assert.strictEqual(running.stage, 'retrieve');
assert.strictEqual(running.history.length, 2, 'every move is recorded');
assert.strictEqual(fresh.state, 'staged', 'and the previous record is not mutated');

assert.throws(function () { engine.ssSyncTransition(fresh, 'nonsense', 'x'); },
    /Unknown sync job state/, 'a state outside the machine is a bug, not a value');

/* History is capped, and it is the oldest that goes. */
let long = fresh;
for (let i = 0; i < 40; i += 1) {
    long = engine.ssSyncTransition(long, 'running', 'note ' + i);
}
assert.ok(long.history.length <= 20, 'history is capped: ' + long.history.length);
assert.strictEqual(long.history[long.history.length - 1].note, 'note 39',
    'and the newest is kept');

/* ------------------------------------------------------------------ */
/* Quick deploy: using a validation the org already did                */
/* ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1000 * DAY;

function validated(extra) {
    return Object.assign({
        kind: 'metadata',
        state: 'succeeded',
        updatedAt: NOW - DAY,
        /* Ran tests, because that is what the org requires before it will
         * deploy a validation - a fixture without it would be refused for a
         * reason none of these cases is about. */
        result: { checkOnly: true, deployId: '0Af0000000001', testLevel: 'RunLocalTests' }
    }, extra || {});
}

assert.strictEqual(engine.ssSyncQuickDeployable(validated(), NOW), true,
    'a validation the org still holds can be deployed without doing it again');

/* ------------------------------------------------------------------ */
/* The rule that made this look broken                                 */
/* ------------------------------------------------------------------ */

/*
 * deployRecentValidation needs the validation to have run tests. NoTestRun is
 * the fast default and is fine for validating - it simply cannot stand in for
 * a deploy afterwards.
 *
 * This was not checked, so a Quick deploy button appeared on every successful
 * validation including the ones the org would never accept, and pressing it
 * produced a refusal that read as the feature being broken.
 */
const untested = validated({ result: { checkOnly: true, deployId: '0Af1', testLevel: 'NoTestRun' } });
assert.strictEqual(engine.ssSyncQuickDeployable(untested, NOW), false,
    'a validation that ran no tests is not offered a quick deploy');
assert.ok(/without running tests/.test(engine.ssSyncQuickDeployBlocker(untested, NOW)),
    'and the reason says so: ' + engine.ssSyncQuickDeployBlocker(untested, NOW));
assert.ok(/local tests/.test(engine.ssSyncQuickDeployBlocker(untested, NOW)),
    'along with the fix, which nobody would guess from a missing button');

/* A validation with no test level recorded is treated the same way: absent
 * is not evidence that tests ran. */
assert.strictEqual(
    engine.ssSyncQuickDeployable(validated({ result: { checkOnly: true, deployId: '0Af1' } }), NOW),
    false, 'an unrecorded test level is not taken as tests having run');

/* Every refusal says something useful, and a good one says nothing. */
assert.strictEqual(engine.ssSyncQuickDeployBlocker(validated(), NOW), null,
    'a validation that ran tests has no blocker');
[['expired', validated({ updatedAt: NOW - 11 * DAY })],
 ['a real deploy', validated({ result: { checkOnly: false, deployId: '0Af1', testLevel: 'RunLocalTests' } })],
 ['no deploy id', validated({ result: { checkOnly: true, testLevel: 'RunLocalTests' } })]
].forEach(function (pair) {
    const why = engine.ssSyncQuickDeployBlocker(pair[1], NOW);
    assert.ok(why && why.length > 10, pair[0] + ' is refused with a reason: ' + why);
});

/*
 * The deploy id is the whole of what this needs, and it used to be thrown
 * away: ssSyncFinish cleared the job's in-flight state on success, taking
 * with it the only handle on a package the org had spent twenty minutes
 * verifying.
 */
assert.strictEqual(
    engine.ssSyncQuickDeployable(validated({ result: { checkOnly: true } }), NOW), false,
    'without the org\'s id there is nothing to quick deploy');

assert.strictEqual(
    engine.ssSyncQuickDeployable(validated({ result: { checkOnly: false, deployId: '0Af1' } }), NOW),
    false, 'a real deploy is not a validation - it already happened');

assert.strictEqual(engine.ssSyncQuickDeployable(validated({ state: 'failed' }), NOW), false,
    'a failed validation verified nothing');
assert.strictEqual(engine.ssSyncQuickDeployable(validated({ kind: 'data' }), NOW), false,
    'records have no validation to deploy');

/*
 * Ten days, which is the org's rule rather than ours. Past it the validation
 * is gone and the only honest offer is validating again.
 */
assert.strictEqual(engine.ssSyncQuickDeployable(validated({ updatedAt: NOW - 9 * DAY }), NOW), true,
    'nine days old is still good');
assert.strictEqual(engine.ssSyncQuickDeployable(validated({ updatedAt: NOW - 11 * DAY }), NOW), false,
    'eleven days old is not');
assert.strictEqual(engine.SS_SYNC_VALIDATION_TTL_MS, 10 * DAY,
    'the window is the ten days the org keeps a validation for');

assert.strictEqual(engine.ssSyncValidationDaysLeft(validated({ updatedAt: NOW - 2 * DAY }), NOW), 8,
    'the screen can say how long is left rather than let it be discovered');
assert.strictEqual(engine.ssSyncValidationDaysLeft(validated({ updatedAt: NOW - 40 * DAY }), NOW), 0,
    'and never counts below zero');

/* The call itself sends the validation id and no package. */
const quick = engine.ssSyncQuickDeployBody('0Af0000000001');
assert.ok(quick.includes('<met:deployRecentValidation>'),
    'quick deploy asks the org to deploy what it already validated');
assert.ok(quick.includes('<met:validationId>0Af0000000001</met:validationId>'));
assert.ok(!/ZipFile/.test(quick),
    'and sends no package - not sending it again is the entire point');

/* ------------------------------------------------------------------ */
/* Test level                                                          */
/* ------------------------------------------------------------------ */

/*
 * The reason this is a setting rather than a default. A validation that ran
 * no tests cannot later stand in for a deploy where tests are required, so
 * the choice has to be made before validating - after is too late.
 */
assert.ok(engine.ssSyncDeployBody('x', { testLevel: 'RunLocalTests' })
    .includes('<met:testLevel>RunLocalTests</met:testLevel>'),
    'the chosen test level is sent');
assert.ok(engine.ssSyncDeployBody('x', {})
    .includes('<met:testLevel>NoTestRun</met:testLevel>'),
    'and the default is stated rather than left to the org to assume');

assert.strictEqual(engine.ssSyncTestLevel('RunLocalTests'), 'RunLocalTests');
assert.strictEqual(engine.ssSyncTestLevel('RunAllTestsInOrg'), 'NoTestRun',
    'a level this has not been built for falls back rather than being sent through');
assert.strictEqual(engine.ssSyncTestLevel(undefined), 'NoTestRun');

/* ------------------------------------------------------------------ */
/* What may run                                                        */
/* ------------------------------------------------------------------ */

assert.strictEqual(engine.ssSyncApplyable({ state: 'staged' }), true);
assert.strictEqual(engine.ssSyncApplyable({ state: 'failed' }), false,
    'a failed job is retried, not applied');

assert.strictEqual(engine.ssSyncRetryable({ state: 'failed' }), true);
assert.strictEqual(engine.ssSyncRetryable({ state: 'blocked' }), true,
    'a job blocked on sign-in is exactly the one to retry afterwards');

/*
 * The important refusal. Retrying a success is a second deploy of the same
 * package into the same org - a new decision, which should be a new job
 * rather than a button that quietly repeats one.
 */
assert.strictEqual(engine.ssSyncRetryable({ state: 'succeeded' }), false,
    'a succeeded job cannot be re-run');
assert.strictEqual(engine.ssSyncRetryable({ state: 'running' }), false,
    'nor can one already in flight');

/* ------------------------------------------------------------------ */
/* History that stays useful                                           */
/* ------------------------------------------------------------------ */

const many = [];
for (let i = 0; i < 60; i += 1) {
    many.push({ id: 's' + i, state: 'succeeded', updatedAt: 2000 + i });
}
for (let i = 0; i < 60; i += 1) {
    many.push({ id: 'f' + i, state: 'failed', updatedAt: 1000 + i });
}

const pruned = engine.ssSyncPrune(many, 100);
assert.strictEqual(pruned.length, 100, 'the cap is honoured');

/*
 * Failures survive successes even though every failure here is older. A
 * failure nobody has looked at is the record that still has something to
 * say; a success is a confirmation that has already been read.
 */
const keptFailures = pruned.filter(function (job) { return job.state === 'failed'; }).length;
assert.strictEqual(keptFailures, 60, 'no failure is dropped while successes remain');

assert.deepStrictEqual(engine.ssSyncCounts([
    { state: 'staged' }, { state: 'failed' }, { state: 'failed' }, { state: 'succeeded' }
]), { staged: 1, running: 0, succeeded: 1, failed: 2, blocked: 0 });

/* ------------------------------------------------------------------ */
/* Emptying a list                                                     */
/* ------------------------------------------------------------------ */

/*
 * A running job is never forgotten. It carries the org's async deploy id,
 * and that id is the only route back to a deploy that outlived the worker -
 * drop the record and the deploy continues in the org with nothing left that
 * can report on it.
 */
assert.strictEqual(engine.ssSyncForgettable({ state: 'running' }), false,
    'a running job cannot be discarded');
['staged', 'failed', 'blocked', 'succeeded'].forEach(function (state) {
    assert.strictEqual(engine.ssSyncForgettable({ state: state }), true,
        'a ' + state + ' job can be discarded');
});

/*
 * The groups match what the screen shows. Blocked jobs are under the Failed
 * heading, so Clear all pressed there has to take them - a clear that left
 * rows behind on the list it was pressed from would be worse than no button.
 */
assert.strictEqual(engine.ssSyncInGroup({ state: 'blocked' }, 'failed'), true,
    'blocked jobs are on the failed list, so clearing it takes them');
assert.strictEqual(engine.ssSyncInGroup({ state: 'blocked' }, 'succeeded'), false);
assert.strictEqual(engine.ssSyncInGroup({ state: 'staged' }, 'failed'), false,
    'a staged job is on neither list');

/*
 * The invariant that keeps a live deploy out of reach of Clear all.
 *
 * ssSyncClear also asks ssSyncForgettable, but that check cannot fire while
 * this holds - so this is the assertion doing the work. A group definition
 * later growing to include a running job is the change that would put deploys
 * in flight on a list with an emptying button, and it fails here.
 */
['failed', 'succeeded'].forEach(function (group) {
    assert.strictEqual(engine.ssSyncInGroup({ state: 'running' }, group), false,
        'a running job is never on the ' + group + ' list');
});

const before = [
    { id: 'a', state: 'succeeded' },
    { id: 'b', state: 'failed' },
    { id: 'c', state: 'blocked' },
    { id: 'd', state: 'staged' },
    { id: 'e', state: 'running', async: { id: '0Af1' } },
    { id: 'f', state: 'succeeded' }
];

const clearedFailed = engine.ssSyncClear(before, 'failed');
assert.strictEqual(clearedFailed.removed, 2, 'failed and blocked both go');
assert.deepStrictEqual(clearedFailed.jobs.map(function (j) { return j.id; }),
    ['a', 'd', 'e', 'f'], 'and nothing else is touched');

const clearedOk = engine.ssSyncClear(before, 'succeeded');
assert.strictEqual(clearedOk.removed, 2);
assert.deepStrictEqual(clearedOk.jobs.map(function (j) { return j.id; }),
    ['b', 'c', 'd', 'e'], 'clearing one list leaves the other alone');

/*
 * The two live states survive both. A staged job is a decision somebody has
 * not made yet, and a running one is a deploy in flight; neither is history,
 * and neither is on the list the button was pressed from.
 */
[clearedFailed, clearedOk].forEach(function (outcome) {
    const ids = outcome.jobs.map(function (j) { return j.id; });
    assert.ok(ids.includes('d'), 'a staged job survives a clear');
    assert.ok(ids.includes('e'), 'and so does a running one');
});

const nonsense = engine.ssSyncClear(before, 'everything');
assert.ok(nonsense.error, 'there is no "clear everything" group');
assert.strictEqual(nonsense.removed, 0, 'and an unknown group removes nothing');
assert.strictEqual(nonsense.jobs.length, before.length, 'leaving the list intact');

assert.strictEqual(engine.ssSyncClear([], 'failed').removed, 0,
    'clearing an empty list is not an error');

/* ------------------------------------------------------------------ */
/* Pipelines                                                           */
/* ------------------------------------------------------------------ */

const a = { origin: 'https://a.my.salesforce.com', label: 'sandbox1' };
const b = { origin: 'https://b.my.salesforce.com', label: 'sandbox2' };

assert.strictEqual(engine.ssSyncValidatePipeline({ a: a, b: b, direction: 'both' }), null,
    'two different orgs and a direction is a pipeline');

/*
 * An org paired with itself deploys a package back into the org it came
 * from: at best nothing, at worst an older copy over a newer one.
 */
assert.ok(engine.ssSyncValidatePipeline({ a: a, b: a, direction: 'both' }),
    'an org cannot be paired with itself');
assert.ok(engine.ssSyncValidatePipeline({ a: a, b: b, direction: 'sideways' }),
    'the direction has to be one of the three');
assert.ok(engine.ssSyncValidatePipeline({ a: a, direction: 'both' }),
    'both ends are required');

/* ------------------------------------------------------------------ */
/* Which way a job goes                                                */
/* ------------------------------------------------------------------ */

const both = { a: a, b: b, direction: 'both' };
assert.deepStrictEqual(engine.ssSyncRoute(both, a.origin), { source: a, target: b },
    'from the first org, to the second');
assert.deepStrictEqual(engine.ssSyncRoute(both, b.origin), { source: b, target: a },
    'and bidirectional means it goes back the other way too');

/*
 * A one-way pipeline asked to carry something the wrong way says so. Quietly
 * reversing it would deploy sandbox2 over sandbox1 for someone who set the
 * pipeline up specifically to stop that.
 */
const oneWay = { a: a, b: b, direction: 'a-to-b' };
assert.deepStrictEqual(engine.ssSyncRoute(oneWay, a.origin), { source: a, target: b });
const refused = engine.ssSyncRoute(oneWay, b.origin);
assert.ok(refused.error, 'a one-way pipeline refuses the other direction');
assert.ok(!refused.source && !refused.target, 'and gives no route at all');
assert.ok(refused.error.includes('sandbox1') && refused.error.includes('sandbox2'),
    'naming both ends, so the message says which way it does run: ' + refused.error);

/*
 * The same refusal from the other end, which is a separate branch and was a
 * separate bug: with only the test above, disabling this guard let a
 * b-to-a pipeline standing in the first org deploy a over b - the exact
 * direction somebody chose a one-way pipeline to prevent.
 */
const backwards = { a: a, b: b, direction: 'b-to-a' };
assert.deepStrictEqual(engine.ssSyncRoute(backwards, b.origin), { source: b, target: a },
    'a b-to-a pipeline runs from the second org');
const refusedToo = engine.ssSyncRoute(backwards, a.origin);
assert.ok(refusedToo.error, 'and refuses to run from the first');
assert.ok(!refusedToo.source && !refusedToo.target, 'with no route at all');

assert.ok(engine.ssSyncRoute(both, 'https://c.my.salesforce.com').error,
    'an org outside the pipeline is not routed');

/* ------------------------------------------------------------------ */
/* Recovering from a killed worker                                     */
/* ------------------------------------------------------------------ */

const now = 10 * 60 * 1000;
const plan = engine.ssSyncSweepPlan([
    /* Running, with the org's async id: the deploy is happening whether or
     * not anything is watching, so this is resumable however long ago the
     * worker died. */
    { id: 'resumable', state: 'running', async: { id: '0Af1', stage: 'deploy' }, updatedAt: 0 },
    /* Running with no id and past the stall window: nothing was ever started
     * in the org, so leaving it 'running' is a lie the list keeps telling. */
    { id: 'stalled', state: 'running', async: null, updatedAt: 0 },
    /* Running with no id but recent: this one is genuinely still going. */
    { id: 'young', state: 'running', async: null, updatedAt: now - 1000 },
    { id: 'done', state: 'succeeded', updatedAt: 0 }
], now);

assert.deepStrictEqual(plan.resume.map(function (j) { return j.id; }), ['resumable'],
    'only jobs with an async id can be resumed');
assert.deepStrictEqual(plan.stalled.map(function (j) { return j.id; }), ['stalled'],
    'only jobs that never reached the org are declared interrupted');

/* ------------------------------------------------------------------ */
/* Async ids                                                           */
/* ------------------------------------------------------------------ */

assert.strictEqual(
    engine.ssSyncAsyncId('<soapenv:Body><deployResponse><result><id>0Af000001</id>' +
                         '<state>Queued</state></result></deployResponse></soapenv:Body>'),
    '0Af000001', 'the async id is read out of the result');
assert.strictEqual(engine.ssSyncAsyncId('<soapenv:Fault><faultstring>no</faultstring></soapenv:Fault>'),
    null, 'a fault carries no id');

/* ------------------------------------------------------------------ */
/* Records: what may match them, and what may travel                   */
/* ------------------------------------------------------------------ */

const accountDescribe = { fields: [
    { name: 'Id', type: 'id', idLookup: true, createable: false, updateable: false },
    { name: 'Name', type: 'string', createable: true, updateable: true },
    { name: 'Migration_Id__c', type: 'string', idLookup: true, externalId: true,
      unique: true, createable: true, updateable: true },
    { name: 'Legacy_Key__c', type: 'string', idLookup: true, externalId: true,
      createable: true, updateable: true },
    { name: 'Almost__c', type: 'string', idLookup: false, externalId: false,
      createable: true, updateable: true },
    { name: 'OwnerId', type: 'reference', createable: true, updateable: true },
    { name: 'ParentId', type: 'reference', createable: true, updateable: true },
    { name: 'BillingStreet', type: 'string', createable: true, updateable: true,
      compoundFieldName: 'BillingAddress' },
    { name: 'BillingAddress', type: 'address', createable: false, updateable: false },
    { name: 'AnnualRevenue', type: 'currency', createable: true, updateable: true },
    { name: 'Score__c', type: 'double', calculated: true, createable: false, updateable: false },
    { name: 'Number__c', type: 'string', autoNumber: true, createable: false, updateable: false },
    { name: 'CreatedDate', type: 'datetime', createable: false, updateable: false }
] };

const keyChoices = engine.ssSyncKeyFields(accountDescribe);
const keyNames = keyChoices.map(function (field) { return field.name; });

/*
 * The exclusion this whole feature exists for. Id is idLookup - Salesforce
 * will happily upsert on it - and it is the one field guaranteed to mean a
 * different record in the other org. Matching on it would either miss
 * everything or hit the wrong row, and the second is silent.
 */
assert.ok(!keyNames.includes('Id'), 'Id is never offered as a cross-org key');

/*
 * And the answer comes from the org, not from a list in our code. A field is
 * offered exactly when the org marked it idLookup, which is what an admin
 * does by ticking External Id - so an org where nobody did gets an honest
 * empty list rather than a guess that fails at write time.
 */
assert.deepStrictEqual(keyNames, ['Legacy_Key__c', 'Migration_Id__c'],
    'only the org\'s own idLookup fields are offered, External Ids first');
assert.ok(!keyNames.includes('Almost__c'),
    'a field that merely looks like a key is not one');
assert.ok(!keyNames.includes('Name'), 'and neither is Name, however tempting');

/*
 * Ordering, against a describe that has both kinds.
 *
 * Some standard fields are idLookup without being External Ids - Username on
 * User is the usual one - so the list is not all one sort. The External Ids
 * come first because they are the fields somebody created for exactly this
 * purpose, and the first entry is what a one-choice object preselects.
 */
const mixed = engine.ssSyncKeyFields({ fields: [
    { name: 'Username', type: 'string', idLookup: true, externalId: false,
      createable: true, updateable: true },
    { name: 'Zeta_Ext__c', type: 'string', idLookup: true, externalId: true,
      createable: true, updateable: true }
] });
assert.deepStrictEqual(mixed.map(function (f) { return f.name; }),
    ['Zeta_Ext__c', 'Username'],
    'External Ids sort ahead of other idLookup fields, whatever their names');
assert.strictEqual(mixed[0].external, true, 'and are marked as such for the screen');
assert.strictEqual(mixed[1].external, false);

assert.deepStrictEqual(engine.ssSyncKeyFields({ fields: [] }), [],
    'an object with no usable key says so rather than inventing one');
assert.deepStrictEqual(engine.ssSyncKeyFields(null), [], 'and a missing describe is not a crash');

/* ------------------------------------------------------------------ */
/* The second way to match, when the org has no External Id            */
/* ------------------------------------------------------------------ */

/*
 * A stock Account. Nobody has marked anything as an External Id, which is the
 * normal state of a standard object - and offering only upsert keys left this
 * object with none at all, so records could not be sent to it.
 */
const stockAccount = { fields: [
    { name: 'Id', type: 'id', idLookup: true, filterable: true },
    { name: 'Name', type: 'string', filterable: true, createable: true, updateable: true },
    { name: 'AccountNumber', type: 'string', filterable: true, unique: false,
      createable: true, updateable: true },
    { name: 'Site', type: 'string', filterable: true, createable: true, updateable: true },
    { name: 'Description', type: 'textarea', filterable: true, createable: true, updateable: true },
    { name: 'OwnerId', type: 'reference', filterable: true },
    { name: 'BillingStreet', type: 'string', filterable: true,
      compoundFieldName: 'BillingAddress' },
    { name: 'Rollup__c', type: 'double', filterable: false, createable: false }
] };

assert.deepStrictEqual(engine.ssSyncKeyFields(stockAccount), [],
    'a stock Account really has no upsert key - the original message was true');

const stockCandidates = engine.ssSyncCandidateKeys(stockAccount);
assert.ok(stockCandidates.length > 0,
    'but it does have fields a record can be looked up by, so the job is possible');

const stockNames = stockCandidates.map(function (f) { return f.name; });
assert.ok(stockNames.includes('Name') && stockNames.includes('AccountNumber'),
    'ordinary filterable fields can be matched on: ' + stockNames.join(', '));
assert.ok(!stockNames.includes('Id'), 'Id is still never offered');
assert.ok(!stockNames.includes('OwnerId'), 'nor a lookup - its value means another org');
assert.ok(!stockNames.includes('BillingStreet'), 'nor part of a compound field');
assert.ok(!stockNames.includes('Description'), 'nor a long text area');
assert.ok(!stockNames.includes('Rollup__c'),
    'and nothing unfilterable - it cannot appear in the WHERE clause that finds it');

stockCandidates.filter(function (field) {
    return field.name !== engine.SS_SYNC_INSERT_ONLY;
}).forEach(function (field) {
    assert.strictEqual(field.mode, 'lookup',
        field.name + ' has no External Id, so it is matched by lookup');
});

/*
 * And the choice that is not a field at all: create everything, match
 * nothing. Offered last, because it is the only one here that cannot update
 * anything - a record the target already has becomes a second copy.
 */
const lastChoice = stockCandidates[stockCandidates.length - 1];
assert.strictEqual(lastChoice.name, engine.SS_SYNC_INSERT_ONLY,
    'creating everything is offered, and offered last');
assert.strictEqual(lastChoice.mode, 'insert');
assert.strictEqual(engine.ssSyncKeyMode(stockCandidates, engine.SS_SYNC_INSERT_ONLY), 'insert');

/*
 * It needs no key in the query, because nothing is matched - the check that
 * a query must select its key would otherwise refuse every insert-only job.
 */
assert.strictEqual(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: engine.SS_SYNC_INSERT_ONLY,
    query: 'SELECT FIELDS(ALL) FROM Account LIMIT 200'
}), null, 'creating everything needs no key in the query');

assert.ok(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: engine.SS_SYNC_INSERT_ONLY
}), 'but still needs a query - it decides which records get created');

/*
 * And with a query naming its fields, not FIELDS(ALL).
 *
 * FIELDS(ALL) satisfies the "does the query select the key" check on its own,
 * which hides whether insert-only is handled at all. A hand-written SELECT
 * does not - and without the exemption this job would be refused for failing
 * to select a key it does not use.
 */
assert.strictEqual(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: engine.SS_SYNC_INSERT_ONLY,
    query: 'SELECT Id, Name FROM Account LIMIT 50'
}), null, 'a named-field query needs no key either, when nothing is matched');

/* A sentinel, not an empty value: empty means "not chosen yet", and the two
 * must not be confused - one writes nothing, the other writes everything. */
assert.ok(engine.SS_SYNC_INSERT_ONLY,
    'the create-everything choice has a value of its own');
assert.ok(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: '', query: 'SELECT FIELDS(ALL) FROM Account'
}), 'and choosing nothing is still refused');

/*
 * With both kinds present, the External Id leads: it is one atomic call the
 * org performs, against a query-then-write that can find two matches.
 */
const bothKinds = engine.ssSyncCandidateKeys({ fields: [
    { name: 'Name', type: 'string', filterable: true, createable: true, updateable: true },
    { name: 'Ext__c', type: 'string', idLookup: true, externalId: true, unique: true,
      filterable: true, createable: true, updateable: true }
] });
assert.deepStrictEqual(bothKinds.map(function (f) { return f.name + ':' + f.mode; }),
    ['Ext__c:upsert', 'Name:lookup', engine.SS_SYNC_INSERT_ONLY + ':insert'],
    'the safe path is offered first, and the one that only creates is offered last');

assert.strictEqual(engine.ssSyncKeyMode(bothKinds, 'Ext__c'), 'upsert');
assert.strictEqual(engine.ssSyncKeyMode(bothKinds, 'Name'), 'lookup');
assert.strictEqual(engine.ssSyncKeyMode(bothKinds, 'Nonsense__c'), null,
    'a field that is not on the object has no mode, and the job refuses');

/* ------------------------------------------------------------------ */
/* Finding them in the target                                          */
/* ------------------------------------------------------------------ */

const matchQuery = engine.ssSyncMatchQuery('Account', 'Name',
    ['Acme', "O'Brien Ltd", 'Acme', null, ''], 400);
assert.ok(matchQuery.includes("Name IN ("), 'the lookup asks for the incoming values');
assert.ok(matchQuery.includes("'Acme'"), 'quoted as literals');
assert.strictEqual((matchQuery.match(/'Acme'/g) || []).length, 1,
    'each value once, however many records carry it');
assert.ok(!/,''/.test(matchQuery) && !/,null/.test(matchQuery),
    'blanks are not looked up - they identify nothing');

/*
 * The apostrophe. These values came from Salesforce and go back to
 * Salesforce, which is exactly the case people assume is safe: an unescaped
 * O'Brien ends the literal and changes the query.
 */
assert.ok(matchQuery.includes("O\\'Brien Ltd"),
    'apostrophes are escaped: ' + matchQuery);

assert.strictEqual(engine.ssSyncMatchQuery('Account', 'Name', [null, '']), null,
    'nothing to look up is not a query');

/* ------------------------------------------------------------------ */
/* Update what exists, insert what does not                            */
/* ------------------------------------------------------------------ */

const matchPlan = engine.ssSyncMatchPlan(
    [{ Name: 'Acme' }, { Name: 'Newco' }, { Name: 'Twins' }],
    ['Acme', 'Newco', 'Twins'],
    [{ Id: '001EXIST', Name: 'Acme' },
     { Id: '001T1', Name: 'Twins' },
     { Id: '001T2', Name: 'Twins' }],
    'Name');

assert.strictEqual(matchPlan.updates.length, 1, 'the one that exists is an update');
assert.strictEqual(matchPlan.updates[0].row.Id, '001EXIST',
    'carrying the TARGET org\'s id, which is the only id that means anything there');
assert.strictEqual(matchPlan.updates[0].row.Name, 'Acme', 'and the fields being written');

assert.strictEqual(matchPlan.inserts.length, 1, 'the one that does not is an insert');
assert.strictEqual(matchPlan.inserts[0].row.Id, undefined, 'with no id at all');

/*
 * The ambiguous one. Two target records share the value, so there is no
 * answer to "which did you mean" - and picking either is the silent
 * wrong-record write this whole feature exists to avoid.
 */
assert.strictEqual(matchPlan.ambiguous.length, 1, 'a value matching two records is ambiguous');
assert.strictEqual(matchPlan.ambiguous[0].key, 'Twins');
assert.strictEqual(matchPlan.ambiguous[0].count, 2, 'and says how many it matched');
assert.ok(!matchPlan.updates.some(function (u) { return u.key === 'Twins'; }),
    'an ambiguous row is never quietly updated');
assert.ok(!matchPlan.inserts.some(function (i) { return i.key === 'Twins'; }),
    'nor quietly duplicated');

/* ------------------------------------------------------------------ */
/* Every batch in one all-or-nothing write                             */
/* ------------------------------------------------------------------ */

const write = engine.ssSyncCompositeWrite('62.0', 'Account', 'Migration_Id__c', [
    { kind: 'update', entries: [{ row: { Id: '001EXIST', Name: 'Acme' }, key: 'Acme' }] },
    { kind: 'insert', entries: [{ row: { Name: 'Newco' }, key: 'Newco' }] }
]);

assert.strictEqual(write.body.allOrNone, true,
    'the batches roll back together - two separate calls would leave the target ' +
    'half written when the second failed');
assert.strictEqual(write.body.compositeRequest.length, 2, 'an update batch and an insert batch');
assert.strictEqual(write.body.compositeRequest[0].method, 'PATCH', 'existing rows are updated');
assert.strictEqual(write.body.compositeRequest[1].method, 'POST', 'new ones are created');
write.body.compositeRequest.forEach(function (request) {
    assert.strictEqual(request.body.allOrNone, true, 'and each batch is all-or-none itself');
    assert.strictEqual(request.body.records[0].attributes.type, 'Account',
        'every record names its object');
});

/* An upsert batch addresses the key field; the others address the object. */
const upsertWrite = engine.ssSyncCompositeWrite('62.0', 'Account', 'Migration_Id__c', [
    { kind: 'upsert', entries: [{ row: { Name: 'Acme' }, key: 'M-1' }] },
    { kind: 'insert', entries: [{ row: { Name: 'Keyless' }, key: null }] }
]);
assert.ok(/composite\/sobjects\/Account\/Migration_Id__c$/.test(upsertWrite.body.compositeRequest[0].url),
    'the upsert batch is addressed to the key field: ' + upsertWrite.body.compositeRequest[0].url);
assert.ok(/composite\/sobjects$/.test(upsertWrite.body.compositeRequest[1].url),
    'and the insert batch is not');
assert.strictEqual(upsertWrite.body.compositeRequest[1].method, 'POST');

assert.strictEqual(engine.ssSyncCompositeWrite('62.0', 'Account', 'K__c', []), null,
    'nothing to write is not a request');
assert.strictEqual(
    engine.ssSyncCompositeWrite('62.0', 'Account', 'K__c',
        [{ kind: 'update', entries: [] }, { kind: 'insert', entries: [] }]),
    null, 'and neither are two empty batches');

const onlyInserts = engine.ssSyncCompositeWrite('62.0', 'Account', 'K__c', [
    { kind: 'update', entries: [] },
    { kind: 'insert', entries: [{ row: { Name: 'Newco' }, key: 'Newco' }] }
]);
assert.strictEqual(onlyInserts.body.compositeRequest.length, 1,
    'an empty half is not sent as an empty batch');
assert.strictEqual(onlyInserts.body.compositeRequest[0].method, 'POST');

/* ------------------------------------------------------------------ */
/* Reading the composite answer                                        */
/* ------------------------------------------------------------------ */

const batchesSent = [
    { kind: 'update', entries: [{ row: {}, key: 'Acme' }] },
    { kind: 'insert', entries: [{ row: {}, key: 'Newco' }] }
];

const composite = engine.ssSyncCompositeResults({
    compositeResponse: [
        { body: [{ id: '001EXIST', success: true, errors: [] }] },
        { body: [{ success: false, errors: [{ statusCode: 'REQUIRED_FIELD_MISSING',
            message: 'Required fields are missing: [Industry]', fields: ['Industry'] }] }] }
    ]
}, batchesSent);

assert.strictEqual(composite.succeeded, 1);
assert.strictEqual(composite.failures.length, 1);
assert.strictEqual(composite.failures[0].key, 'Newco',
    'a failure is named by its key, and the insert batch\'s keys are read as the ' +
    'insert batch - getting the two sets crossed would name the wrong record');
assert.strictEqual(composite.failures[0].message, 'Required fields are missing: [Industry]');

/*
 * What a job created, whichever way it ran. An insert always creates, an
 * upsert says so per row, an update never does.
 */
const createdCounts = engine.ssSyncCompositeResults({
    compositeResponse: [
        { body: [{ id: '1', success: true, created: false, errors: [] }] },
        { body: [{ id: '2', success: true, errors: [] },
                 { id: '3', success: true, errors: [] }] }
    ]
}, [
    { kind: 'update', entries: [{ row: {}, key: 'a' }] },
    { kind: 'insert', entries: [{ row: {}, key: null }, { row: {}, key: null }] }
]);
assert.strictEqual(createdCounts.succeeded, 3);
assert.strictEqual(createdCounts.created, 2,
    'an insert counts as created even though the org does not say so per row');

const upsertCounts = engine.ssSyncCompositeResults({
    compositeResponse: [
        { body: [{ id: '1', success: true, created: true, errors: [] },
                 { id: '2', success: true, created: false, errors: [] }] }
    ]
}, [{ kind: 'upsert', entries: [{ row: {}, key: 'a' }, { row: {}, key: 'b' }] }]);
assert.strictEqual(upsertCounts.created, 1, 'and an upsert is counted from what the org said');

/*
 * A subrequest rolled back because its sibling failed answers with a single
 * error rather than one result per record.
 */
const halted = engine.ssSyncCompositeResults({
    compositeResponse: [
        { body: { errorCode: 'PROCESSING_HALTED', message: 'The transaction was rolled back.' } }
    ]
}, [{ kind: 'update', entries: [{ row: {}, key: 'Acme' }] }]);
assert.strictEqual(halted.failures.length, 1, 'a halted batch is one failure, not none');
assert.strictEqual(halted.failures[0].statusCode, 'PROCESSING_HALTED');
assert.ok(/rolled back/.test(halted.failures[0].message), 'carrying the org\'s reason');

/* ------------------------------------------------------------------ */
/* Which fields may cross                                              */
/* ------------------------------------------------------------------ */

const portable = engine.ssSyncPortableFields(accountDescribe);

/*
 * References are left behind, and this is the assertion that matters most on
 * this screen. A lookup holds an Id belonging to the source org; written into
 * another org it either fails or - far worse - points at an unrelated record
 * that happens to exist, which nothing reports and nobody notices.
 */
assert.ok(!portable.includes('OwnerId'), 'lookup fields are not carried across orgs');
assert.ok(!portable.includes('ParentId'), 'nor are any other references');

assert.ok(!portable.includes('Score__c'), 'formula fields are not writable');
assert.ok(!portable.includes('Number__c'), 'nor are autonumbers');
assert.ok(!portable.includes('CreatedDate'), 'nor audit fields');
assert.ok(!portable.includes('BillingAddress'), 'the compound address is not sent');
/*
 * Its parts are - and this assertion used to say the opposite, which is why
 * no job ever carried an address. BillingAddress cannot be written, so the
 * parts are the only way in; a part is dropped only when the compound it
 * belongs to can be written instead.
 */
assert.ok(portable.includes('BillingStreet'),
    'the parts are what carry an address, since the compound cannot be written');

assert.ok(portable.includes('Name') && portable.includes('AnnualRevenue'),
    'ordinary writable fields do travel: ' + portable.join(', '));

/*
 * Each exclusion on its own.
 *
 * In a real describe these fields are also not writable, so the writable
 * check alone hides whether the specific guards work - which is exactly what
 * a mutation run showed. This fixture is deliberately contradictory: fields
 * that claim to be writable while being the kind that must never be sent. It
 * tests the guard rather than the coincidence.
 */
const awkward = engine.ssSyncPortableFields({ fields: [
    { name: 'Fine__c', type: 'string', createable: true, updateable: true },
    { name: 'Formula__c', type: 'string', calculated: true, createable: true, updateable: true },
    { name: 'Auto__c', type: 'string', autoNumber: true, createable: true, updateable: true },
    { name: 'ShippingAddress', type: 'address', createable: true, updateable: true },
    { name: 'Where__c', type: 'location', createable: true, updateable: true },
    { name: 'Lookup__c', type: 'reference', createable: true, updateable: true }
] });
assert.deepStrictEqual(awkward, ['Fine__c'],
    'a field of a kind that cannot be sent is not sent, whatever the describe ' +
    'claims about writability: ' + awkward.join(', '));

/* ------------------------------------------------------------------ */
/* Compound fields, which is where this went wrong                     */
/* ------------------------------------------------------------------ */

/*
 * Salesforce marks both a compound and its parts with compoundFieldName, and
 * treating every marked field as a part cost two things at once:
 *
 *   Account.Name came back as compoundFieldName "Name" - naming itself - in
 *   an org with Person Accounts, so the one field a new Account cannot be
 *   created without was dropped, and the org refused the insert for a field
 *   this extension had removed.
 *
 *   Every address part was dropped too, because BillingAddress is a compound
 *   marker as well - which meant no address was ever carried by any job.
 */
const compoundAccount = { fields: [
    { name: 'Name', type: 'string', createable: true, updateable: true,
      nillable: false, compoundFieldName: 'Name' },
    { name: 'FirstName', type: 'string', createable: true, updateable: true,
      compoundFieldName: 'Name' },
    { name: 'LastName', type: 'string', createable: true, updateable: true,
      compoundFieldName: 'Name' },
    { name: 'BillingStreet', type: 'string', createable: true, updateable: true,
      compoundFieldName: 'BillingAddress' },
    { name: 'BillingCity', type: 'string', createable: true, updateable: true,
      compoundFieldName: 'BillingAddress' },
    { name: 'BillingAddress', type: 'address', createable: false, updateable: false },
    { name: 'YearStarted', type: 'string', createable: true, updateable: true, filterable: true }
] };

const accountPortable = engine.ssSyncPortableFields(compoundAccount);

/* A field naming itself is the compound, not a part of one. */
assert.ok(accountPortable.includes('Name'),
    'Account.Name is carried even though it names itself as a compound: ' +
    accountPortable.join(', '));

/* Its parts are dropped, because writing both is what the org refuses. */
assert.ok(!accountPortable.includes('FirstName'), 'and its parts are not sent alongside it');
assert.ok(!accountPortable.includes('LastName'));

/*
 * The address goes the other way: the compound cannot be written, so its
 * parts are the only way in and must travel.
 */
assert.ok(accountPortable.includes('BillingStreet') && accountPortable.includes('BillingCity'),
    'address parts are carried, because BillingAddress itself cannot be written');
assert.ok(!accountPortable.includes('BillingAddress'), 'and the compound is not');

/*
 * Contact is the same shape with the opposite answer: its Name is calculated,
 * so the parts are what carry a contact's name.
 */
const contact = engine.ssSyncPortableFields({ fields: [
    { name: 'Name', type: 'string', createable: false, updateable: false,
      calculated: true, compoundFieldName: 'Name' },
    { name: 'FirstName', type: 'string', createable: true, updateable: true,
      compoundFieldName: 'Name' },
    { name: 'LastName', type: 'string', createable: true, updateable: true,
      nillable: false, compoundFieldName: 'Name' }
] });
assert.deepStrictEqual(contact, ['FirstName', 'LastName'],
    'a contact is carried by its name parts, since Name is calculated there');

/*
 * And the reason shown is the reason used. These were two functions in
 * different orders, which could name different causes for the same field -
 * the worst possible defect in the thing whose job is saying why.
 */
const byName = {};
compoundAccount.fields.forEach(function (f) { byName[f.name] = f; });
assert.strictEqual(engine.ssSyncNotPortable(byName.Name, byName), null,
    'the rule and the explanation agree that Name is carried');
assert.ok(/part of Name/.test(engine.ssSyncNotPortable(byName.FirstName, byName)),
    'and agree on why FirstName is not: ' + engine.ssSyncNotPortable(byName.FirstName, byName));
assert.strictEqual(engine.ssSyncNotPortable(byName.BillingStreet, byName), null,
    'and that an address part is');

/* ------------------------------------------------------------------ */
/* The rows that get sent                                              */
/* ------------------------------------------------------------------ */

const built = engine.ssSyncDataPayload([
    { attributes: { type: 'Account' }, Id: '001A', Name: 'Acme',
      Migration_Id__c: 'M-1', OwnerId: '005A', AnnualRevenue: 100 },
    { attributes: { type: 'Account' }, Id: '001B', Name: 'No Key',
      Migration_Id__c: null, OwnerId: '005B' },
    { attributes: { type: 'Account' }, Id: '001C', Name: 'Blank Key',
      Migration_Id__c: '' }
], portable, 'Migration_Id__c');

assert.strictEqual(built.rows.length, 1, 'only rows with a key can be matched');

/*
 * The rows with no key are carried, not dropped.
 *
 * They cannot be matched - there is no value to match on - but that is not a
 * reason to leave them behind: a record that cannot be found in the target is
 * a record the target does not have, which is the case for creating it. The
 * first version refused the whole job over this ("None of those records has a
 * value in YearStarted"), which turned a perfectly good migration into a
 * dead end.
 */
assert.strictEqual(built.keyless.length, 2, 'rows with no key are kept, as inserts');
assert.strictEqual(built.keyless[0].key, null, 'with no key, which is the point');
assert.strictEqual(built.keyless[0].row.Name, 'No Key',
    'and their fields, so what gets created is a real record');
assert.strictEqual(built.keyless[0].row.Id, undefined, 'still without the source Id');
assert.strictEqual(built.keyless[0].row.OwnerId, undefined, 'still without lookups');

/*
 * And not sent even when told to send it.
 *
 * Id is normally excluded on the way in - it is not writable, so it never
 * reaches the portable list - which means the explicit check reads as
 * unnecessary until somebody hands this a field list containing it. Then it
 * is the only thing standing between an upsert and a record addressed by an
 * Id from a different org.
 */
const forced = engine.ssSyncDataPayload(
    [{ Id: '001A', Name: 'Acme', Migration_Id__c: 'M-1' }],
    ['Id', 'Name'],
    'Migration_Id__c');
assert.strictEqual(forced.rows[0].Id, undefined,
    'the source Id is refused even when it is on the field list');
assert.strictEqual(forced.rows[0].Name, 'Acme', 'while the rest still travels');

/* The key values are kept beside the rows, not on them: a marker field in
 * the payload would be sent to the org as a field it does not have. */
assert.deepStrictEqual(built.keys, ['M-1'], 'keys are tracked alongside');
assert.ok(!Object.keys(built.rows[0]).some(function (name) { return name.indexOf('__') === 0; }),
    'and no private marker is added to the payload');

/* ------------------------------------------------------------------ */
/* The upsert, and what came back                                      */
/* ------------------------------------------------------------------ */

const upsertUrl = engine.ssSyncUpsertUrl('https://b.my.salesforce.com', '62.0',
    'Invoice__c', 'Migration_Id__c');
assert.strictEqual(upsertUrl,
    'https://b.my.salesforce.com/services/data/v62.0/composite/sobjects/Invoice__c/Migration_Id__c',
    'the upsert addresses the key field, which is what makes it match rather than insert');

/* ------------------------------------------------------------------ */
/* Refusals made before anything is written                            */
/* ------------------------------------------------------------------ */

assert.strictEqual(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: 'Migration_Id__c',
    query: 'SELECT Id, Migration_Id__c FROM Account'
}), null, 'a job with an object, a key and a query that selects it is valid');

assert.ok(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: 'Id', query: 'SELECT Id FROM Account'
}), 'Id is refused as a key, with a reason');
assert.ok(/different Ids/.test(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: 'Id', query: 'SELECT Id FROM Account'
})), 'and the reason says why');

/*
 * A query that does not select the key produces rows nothing can be matched
 * on - every one would be skipped, after the source org had been queried for
 * them. Refused before that happens.
 */
assert.ok(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: 'Migration_Id__c',
    query: 'SELECT Id, Name FROM Account'
}), 'a query that omits the key is refused');

assert.ok(engine.ssSyncValidateDataJob({ objectApiName: 'Account', query: 'SELECT Id FROM Account' }),
    'a job with no key is refused');
assert.ok(engine.ssSyncValidateDataJob({ keyField: 'X__c', query: 'SELECT Id FROM Account' }),
    'and so is one with no object');

/* ------------------------------------------------------------------ */
/* Carrying a whole record, for the ones that have to be created       */
/* ------------------------------------------------------------------ */

/*
 * A record with no counterpart in the target is created, not skipped - and a
 * query that selected only the key created it empty, a row holding an
 * External Id and nothing else. FIELDS(ALL) is how a record is carried
 * without knowing in advance what is on it, so the validation has to accept
 * it even though it never names the key.
 */
assert.strictEqual(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: 'Migration_Id__c',
    query: 'SELECT FIELDS(ALL) FROM Account LIMIT 200'
}), null, 'FIELDS(ALL) selects the key without naming it');

assert.strictEqual(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: 'Migration_Id__c',
    query: 'select fields(all) from Account'
}), null, 'and case does not matter');

/*
 * The other two groups are not interchangeable with it, and this is the part
 * a looser check would wave through: FIELDS(STANDARD) does not contain a
 * custom field, so a job matching on Migration_Id__c would query rows that
 * do not carry it and skip every one of them.
 */
assert.ok(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: 'Migration_Id__c',
    query: 'SELECT FIELDS(STANDARD) FROM Account'
}), 'FIELDS(STANDARD) does not cover a custom key');

assert.strictEqual(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: 'Migration_Id__c',
    query: 'SELECT FIELDS(CUSTOM) FROM Account'
}), null, 'FIELDS(CUSTOM) does');

assert.ok(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: 'AccountNumber',
    query: 'SELECT FIELDS(CUSTOM) FROM Account'
}), 'and does not cover a standard one');

assert.strictEqual(engine.ssSyncValidateDataJob({
    objectApiName: 'Account', keyField: 'AccountNumber',
    query: 'SELECT FIELDS(STANDARD) FROM Account'
}), null, 'which FIELDS(STANDARD) does');

/*
 * How much of a write was new.
 *
 * Salesforce reports it per row on an upsert, and it is the thing somebody
 * needs after the fact: "200 records written" reads as an update, and if 190
 * of them were new rows in an org they believed they were refreshing, that is
 * what they needed to be told.
 */
/* One batch, and the cap says so. allOrNone applies within a request, so
 * across several batches "all or nothing" would mean it several times. */
assert.strictEqual(engine.SS_SYNC_DATA_LIMIT, 200,
    'the cap is the largest single all-or-nothing write the org accepts');

/* ------------------------------------------------------------------ */
/* Which session gets used against which org                           */
/* ------------------------------------------------------------------ */

/*
 * Driven against a fake chrome rather than read as text, because the
 * dangerous answer here is not a missing session - it is the *wrong* one.
 * ssAuth holds a single token, and a pipeline is precisely the situation
 * where a second org is in play; handing org B a token minted for org A is
 * the cross-org leak the sign-in guard exists to prevent.
 */
let cookieCalls = [];

function withChrome(cookies, auth) {
    cookieCalls = [];
    global.chrome = {
        runtime: { lastError: null },
        cookies: {
            /*
             * getAll, because a real jar holds more than one sid that matches
             * a URL and the engine has to choose between them. The stub gives
             * each cookie the host it belongs to, since that is what the
             * choice is made on - a cookie with no domain cannot be shown to
             * be this org's, and is now correctly refused.
             */
            getAll: function (query, done) {
                cookieCalls.push(query.url);
                const found = cookies[query.url];
                if (!found) { return done([]); }
                const jar = Array.isArray(found) ? found : [found];
                done(jar.map((cookie) => Object.assign(
                    { domain: new URL(query.url).hostname, path: '/' }, cookie)));
            }
        },
        storage: {
            local: {
                get: function (key, done) { done(key === 'ssAuth' ? { ssAuth: auth } : {}); }
            }
        }
    };
}

const ORG_A = 'https://a.my.salesforce.com';
const ORG_B = 'https://b.my.salesforce.com';

async function credentials() {
    /* A cookie for the org: the ordinary case, and the one that makes a
     * pipeline possible at all - no tab needs to be open on the second org. */
    withChrome({ [ORG_B]: { value: 'sid-for-b' } }, null);
    const fromCookie = await engine.ssSyncCredential(ORG_B);
    assert.strictEqual(fromCookie.sessionId, 'sid-for-b', 'the org\'s own cookie is used');
    assert.strictEqual(fromCookie.from, 'cookie');

    /* No cookie, but a stored token minted for this org. */
    withChrome({}, { accessToken: 'token-for-b', instanceUrl: ORG_B });
    const fromToken = await engine.ssSyncCredential(ORG_B);
    assert.strictEqual(fromToken.sessionId, 'token-for-b', 'the stored token stands in');
    assert.strictEqual(fromToken.from, 'oauth');

    /*
     * The one that matters. A token belonging to org A, asked for org B:
     * the answer is nothing, not the token. A job that cannot run is a job
     * that says "needs sign in"; a job that runs with the wrong org's
     * session is a session sent somewhere it was never issued for.
     */
    withChrome({}, { accessToken: 'token-for-a', instanceUrl: ORG_A });
    const foreign = await engine.ssSyncCredential(ORG_B);
    assert.strictEqual(foreign, null,
        'a token minted for another org is never used against this one');

    /* The cookie wins even when a token is present: it is the org's live
     * session, and the token may be older. */
    withChrome({ [ORG_B]: { value: 'sid-for-b' } },
        { accessToken: 'token-for-b', instanceUrl: ORG_B });
    const both = await engine.ssSyncCredential(ORG_B);
    assert.strictEqual(both.from, 'cookie', 'the live cookie is preferred to the stored token');

    /*
     * A cookie that exists but carries nothing is not a session. Chrome does
     * hand back empty-valued cookies, and an empty sessionId goes into the
     * envelope as an empty SessionHeader - which the org answers with an
     * INVALID_SESSION_ID that reads as though the user was signed out.
     */
    withChrome({ [ORG_B]: { value: '' } }, null);
    assert.strictEqual(await engine.ssSyncCredential(ORG_B), null,
        'an empty cookie is not a session');

    /* Nothing at all is nothing, not a throw: the caller turns this into a
     * blocked job with a Sign in button. */
    withChrome({}, null);
    assert.strictEqual(await engine.ssSyncCredential(ORG_B), null);

    /*
     * With no org, the browser is not asked. Falling through to
     * chrome.cookies.get({ url: null }) is a call that cannot succeed, and
     * the try/catch around it would swallow the failure - so the only
     * evidence of the guard working is that the call never happens.
     */
    withChrome({}, null);
    assert.strictEqual(await engine.ssSyncCredential(null), null, 'no org is no credential');
    assert.deepStrictEqual(cookieCalls, [], 'and the cookie store is not asked about nothing');

    /*
     * A stored token with no instanceUrl cannot be matched to any org, so it
     * is not used for one. (The guard and the URL parse below it both refuse
     * this, which is why it holds even if one of them is loosened.)
     */
    withChrome({}, { accessToken: 'orphan' });
    assert.strictEqual(await engine.ssSyncCredential(ORG_B), null,
        'a token that names no org is not used against an org');
}

credentials().then(function () {
    console.log('sync_engine: ok');
}, function (error) {
    console.error(error);
    process.exit(1);
});

/* ------------------------------------------------------------------ */
/* How often a pipeline has been used                                  */
/* ------------------------------------------------------------------ */

/*
 * Counted on the pipeline, not worked out from the job list.
 *
 * The job list is capped at a hundred and either Clear all empties half of
 * it, so a tally taken from it would fall from "47 runs" to "12 runs" the
 * moment somebody tidied up - a number that changes when nothing happened is
 * worse than no number.
 */
const fresh0 = { id: 'pipe_1', a: {}, b: {} };
assert.strictEqual(engine.ssSyncCountUse(fresh0, 'run', 5000).usage.runs, 1,
    'the first run is counted');
assert.strictEqual(engine.ssSyncCountUse(fresh0, 'run', 5000).usage.lastRunAt, 5000,
    'and dated');
assert.strictEqual(fresh0.usage, undefined, 'without changing the pipeline it was given');

let tally = { id: 'pipe_1' };
tally = engine.ssSyncCountUse(tally, 'run', 1);
tally = engine.ssSyncCountUse(tally, 'succeeded', 2);
tally = engine.ssSyncCountUse(tally, 'run', 3);
tally = engine.ssSyncCountUse(tally, 'failed', 4);
tally = engine.ssSyncCountUse(tally, 'run', 5);
tally = engine.ssSyncCountUse(tally, 'succeeded', 6);

assert.strictEqual(tally.usage.runs, 3, 'every run counts, including a retry');
assert.strictEqual(tally.usage.succeeded, 2);
assert.strictEqual(tally.usage.failed, 1);
assert.strictEqual(tally.usage.lastRunAt, 5,
    'last used is when it last ran, not when a run last finished');

/* An event this does not know about changes nothing rather than inventing a
 * counter for it. */
assert.strictEqual(engine.ssSyncCountUse(tally, 'nonsense'), tally,
    'an unknown event is not counted');
assert.strictEqual(engine.ssSyncCountUse(null, 'run'), null);

/* ------------------------------------------------------------------ */
/* Saying why, when the reason is ours                                 */
/* ------------------------------------------------------------------ */

/*
 * The failure that prompted this.
 *
 * An insert went out without Name and the org answered "Required fields are
 * missing: [Name]" - true of the request, and silent about why the request
 * looked like that. The org cannot know; only this side knows which fields it
 * dropped and what decided each one. So its words are kept and the missing
 * half is added.
 */
const personAccount = { fields: [
    { name: 'Name', label: 'Account Name', type: 'string',
      createable: false, updateable: false, nillable: false, calculated: true },
    { name: 'LastName', label: 'Last Name', type: 'string',
      createable: true, updateable: true, nillable: false },
    { name: 'YearStarted', type: 'string', createable: true, updateable: true, filterable: true }
] };

const explained = engine.ssSyncExplainFailure(
    'Required fields are missing: [Name]', personAccount, 'YearStarted');
assert.ok(explained.startsWith('Required fields are missing: [Name]'),
    'the org keeps the first word - it is still the authority on what it refused');
assert.ok(/was not sent/.test(explained),
    'and the half only this side knows is added: ' + explained);
assert.ok(/calculated/.test(explained), 'naming what actually decided it');

/*
 * Silence when we did send it. Then the org means something else - a
 * validation rule, a permission - and an explanation invented here would be
 * worse than none.
 */
const plainAccount = { fields: [
    { name: 'Name', type: 'string', createable: true, updateable: true, nillable: false }
] };
assert.strictEqual(
    engine.ssSyncExplainFailure('Required fields are missing: [Name]', plainAccount, 'K__c'),
    'Required fields are missing: [Name]',
    'a field we did send gets no explanation from us');

/* A field named in the message that the object does not have is not ours to
 * explain either. */
assert.strictEqual(
    engine.ssSyncExplainFailure('Required fields are missing: [Ghost__c]', plainAccount, 'K__c'),
    'Required fields are missing: [Ghost__c]');

/* Messages with no field list pass through untouched. */
assert.strictEqual(
    engine.ssSyncExplainFailure('INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY', plainAccount, 'K__c'),
    'INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY');

/* Each reason is the one that actually applies. */
const kinds = { fields: [
    { name: 'Look__c', type: 'reference', createable: true, nillable: false },
    { name: 'Auto__c', type: 'string', autoNumber: true, createable: false, nillable: false },
    /* A part whose compound can be written - the only case where a part is
     * dropped. A part whose compound cannot be written is carried, which is
     * what makes addresses work. */
    { name: 'FullName', type: 'string', createable: true, updateable: true,
      compoundFieldName: 'FullName' },
    { name: 'Surname', type: 'string', createable: true, nillable: false,
      compoundFieldName: 'FullName' }
] };
assert.ok(/lookup/.test(engine.ssSyncExplainFailure(
    'Required fields are missing: [Look__c]', kinds, 'K__c')), 'a lookup says so');
assert.ok(/generates it/.test(engine.ssSyncExplainFailure(
    'Required fields are missing: [Auto__c]', kinds, 'K__c')), 'an autonumber says so');
assert.ok(/part of FullName/.test(engine.ssSyncExplainFailure(
    'Required fields are missing: [Surname]', kinds, 'K__c')),
    'a part whose compound is writable says which compound');

/* And the compound itself is never explained away - it is carried. */
assert.strictEqual(
    engine.ssSyncExplainFailure('Required fields are missing: [FullName]', kinds, 'K__c'),
    'Required fields are missing: [FullName]',
    'the compound itself was sent, so the org means something else');

/* ------------------------------------------------------------------ */
/* Refused before the org is asked                                     */
/* ------------------------------------------------------------------ */

/*
 * The knowable half: the target says a field is required to create a record,
 * and the rows being created have nothing in it. That is answerable before
 * anything is written, and writing it to find out costs a round trip and
 * produces a worse message.
 */
assert.deepStrictEqual(engine.ssSyncRequiredForCreate({ fields: [
    { name: 'Name', createable: true, nillable: false },
    { name: 'Optional__c', createable: true, nillable: true },
    { name: 'Defaulted__c', createable: true, nillable: false, defaultedOnCreate: true },
    { name: 'Flag__c', createable: true, nillable: false, type: 'boolean' },
    { name: 'ReadOnly__c', createable: false, nillable: false }
] }), ['Name'],
    'required means creatable, not nillable, and not something the org fills in itself');

const shortRows = [{ row: { YearStarted: '2001' }, key: null }];
const shortfall = engine.ssSyncMissingRequired(shortRows, {
    fields: [
        { name: 'Name', label: 'Account Name', createable: true, updateable: true,
          nillable: false, type: 'string' },
        { name: 'YearStarted', createable: true, updateable: true, type: 'string' }
    ]
}, 'YearStarted');
assert.strictEqual(shortfall.length, 1, 'a required field with no value is caught first');
assert.strictEqual(shortfall[0].name, 'Name');
assert.ok(/no value in it/.test(shortfall[0].reason),
    'and says which of the causes it is: ' + shortfall[0].reason);

/* A row that carries it is not a shortfall. */
assert.deepStrictEqual(engine.ssSyncMissingRequired(
    [{ row: { Name: 'Acme' }, key: null }],
    { fields: [{ name: 'Name', createable: true, nillable: false, type: 'string' }] },
    'K__c'), [], 'nothing missing, nothing said');

/* And nothing being created is nothing to check - an update need not carry a
 * required field, because the record it updates already has one. */
assert.deepStrictEqual(engine.ssSyncMissingRequired([], {
    fields: [{ name: 'Name', createable: true, nillable: false, type: 'string' }]
}, 'K__c'), [], 'no inserts, no required-field check');

/* ------------------------------------------------------------------ */
/* A session problem is a sign-in, not an error                        */
/* ------------------------------------------------------------------ */

/*
 * The org has several ways of saying "sign in again" and none of them read
 * as an action. All three mean the same thing and have the same fix, so all
 * three end as 'blocked' - which is the state that offers signing in, rather
 * than 'failed', which is the list people scan for real problems.
 */
assert.strictEqual(engine.ssSyncIsSessionFailure('Session expired or invalid'), true,
    'the prose form, which is what a describe returns');
assert.strictEqual(engine.ssSyncIsSessionFailure('INVALID_SESSION_ID: Session expired'), true,
    'and the status code form');
assert.strictEqual(engine.ssSyncIsSessionFailure('anything', 401), true,
    'and a bare 401, which carries no message at all');
assert.strictEqual(engine.ssSyncIsSessionFailure('anything', 403), true);

/*
 * And nothing else. Treating an ordinary refusal as a sign-in would send
 * somebody to re-authenticate over a validation rule.
 */
assert.strictEqual(engine.ssSyncIsSessionFailure('Required fields are missing: [Name]'), false,
    'a missing field is not a session problem');
assert.strictEqual(engine.ssSyncIsSessionFailure('INSUFFICIENT_ACCESS', 400), false,
    'nor is a permission problem - signing in again would not change it');
assert.strictEqual(engine.ssSyncIsSessionFailure(null), false);
assert.strictEqual(engine.ssSyncIsSessionFailure('', 200), false);

/* ------------------------------------------------------------------ */
/* Old records, read through the rule that came later                  */
/* ------------------------------------------------------------------ */

/*
 * The treatment was applied where a job fails, which did nothing for the jobs
 * already in the list: they were written before it existed and went on
 * showing a bare "Session expired or invalid" with no action attached. The
 * same rule on the way out fixes those, and any path that throws a session
 * error without being tagged.
 */
const staleFailure = { id: 'j1', state: 'failed',
    error: { message: 'Session expired or invalid' } };
const revisited = engine.ssSyncNormaliseJob(staleFailure);

assert.strictEqual(revisited.error.needsAuth, true,
    'a stored failure that reads as a session problem is marked as needing sign-in');
assert.strictEqual(staleFailure.error.needsAuth, undefined,
    'without changing the record it was given');

/*
 * The stored state is left alone. What happened, happened - this changes how
 * it is presented, which is where the omission was, not the history.
 */
assert.strictEqual(revisited.state, 'failed', 'the recorded state is not rewritten');

/* An ordinary failure is returned untouched, not copied. */
const realFailure = { id: 'j2', state: 'failed',
    error: { message: 'Required fields are missing: [Name]' } };
assert.strictEqual(engine.ssSyncNormaliseJob(realFailure), realFailure,
    'a failure that is not a session problem is left exactly as it was');

/* And one already marked is not marked twice. */
const alreadyMarked = { id: 'j3', state: 'blocked',
    error: { message: 'Session expired', needsAuth: true, origin: 'https://a.my.salesforce.com' } };
assert.strictEqual(engine.ssSyncNormaliseJob(alreadyMarked), alreadyMarked);

assert.strictEqual(engine.ssSyncNormaliseJob(null), null);
assert.strictEqual(engine.ssSyncNormaliseJob({ id: 'j4', state: 'succeeded' }).id, 'j4',
    'a job with no error at all passes through');

/* ------------------------------------------------------------------ */
/* History, split by attempt                                           */
/* ------------------------------------------------------------------ */

/*
 * A job retried twice keeps every line of all three runs. Flat, they read as
 * the same three sentences repeated with no seam, and the only way to tell
 * where one attempt ended is to compare timestamps.
 *
 * The attempt is stamped after the patch is applied, so the transition that
 * starts a run is the first line of the new attempt rather than the last of
 * the old one.
 */
let attempted = engine.ssSyncNewJob({ components: [{ type: 'ApexClass', name: 'A' }] });
assert.strictEqual(attempted.history[0].attempt, 0,
    'staging is attempt zero - it is not an attempt at anything');

attempted = engine.ssSyncTransition(attempted, 'running', 'Retrieving.', { attempts: 1 });
assert.strictEqual(attempted.history[1].attempt, 1,
    'the transition that starts a run opens the new attempt');

attempted = engine.ssSyncTransition(attempted, 'failed', 'It broke.');
assert.strictEqual(attempted.history[2].attempt, 1,
    'and the outcome of that run belongs to it, not to the next one');

attempted = engine.ssSyncTransition(attempted, 'running', 'Retrieving.', { attempts: 2 });
attempted = engine.ssSyncTransition(attempted, 'succeeded', 'Done.');
assert.deepStrictEqual(attempted.history.map(function (entry) { return entry.attempt; }),
    [0, 1, 1, 2, 2],
    'every line knows which run it belongs to');

/* ------------------------------------------------------------------ */
/* Which org may send                                                  */
/* ------------------------------------------------------------------ */

/*
 * "You cannot do this here" is half an answer. A one-way pipeline has exactly
 * one org that may send down it, and naming that org is the other half.
 */
const oneWayAB = { a: a, b: b, direction: 'a-to-b' };
assert.strictEqual(engine.ssSyncSender(oneWayAB), a,
    'an a-to-b pipeline is sent from the first org');

const oneWayBA = { a: a, b: b, direction: 'b-to-a' };
assert.strictEqual(engine.ssSyncSender(oneWayBA), b,
    'and a b-to-a pipeline from the second');

/*
 * A bidirectional pipeline has no single sender, and saying it does would
 * point somebody at one org when either would have done.
 */
assert.strictEqual(engine.ssSyncSender({ a: a, b: b, direction: 'both' }), null,
    'a pipeline that runs both ways names no single sender');
assert.strictEqual(engine.ssSyncSender(null), null);
