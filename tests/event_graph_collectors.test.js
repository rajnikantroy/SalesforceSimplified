/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');

/*
 * The collectors, which are where the engine's honesty is actually decided.
 *
 * Everything downstream is arithmetic on events. What matters here is whether
 * an event faithfully represents what its source really said - because a
 * collector that overstates is not caught by any later test, it just produces
 * a confident graph that is wrong.
 *
 * So the assertions concentrate on the overstatements that would be easy to
 * make and hard to notice:
 *
 *   - a page context read from generated markup rather than the URL
 *   - a design-time dependency emitted as if it were an execution
 *   - an external system describing itself as Salesforce
 *   - a record's LastModifiedDate presented as though it were every change
 */

const Model = require('../js/event-graph/ss-event-model.js');
const Collectors = require('../js/event-graph/ss-collectors.js');
const Store = require('../js/event-graph/ss-event-store.js');
const Correlation = require('../js/event-graph/ss-correlation.js');

function main() {

    /* ------------------------------------------------------------------ */
    /* Page context comes from the URL, not the DOM                        */
    /* ------------------------------------------------------------------ */

    const lightning = Collectors.pageContext(
        'https://acme.lightning.force.com/lightning/r/Case/500XX0000012345/view');
    assert.strictEqual(lightning.kind, 'record');
    assert.strictEqual(lightning.recordId, '500XX0000012345');
    assert.strictEqual(lightning.objectType, 'Case', 'the object name is in the URL');

    /* Without the object in the path, the id prefix answers. */
    const classic = Collectors.pageContext('https://acme.my.salesforce.com/006XX0000098765');
    assert.strictEqual(classic.recordId, '006XX0000098765');
    assert.strictEqual(classic.objectType, 'Opportunity', 'the key prefix identifies the object');

    const list = Collectors.pageContext(
        'https://acme.lightning.force.com/lightning/o/Order/list?filterName=Recent');
    assert.strictEqual(list.kind, 'list');
    assert.strictEqual(list.objectType, 'Order');

    const setup = Collectors.pageContext(
        'https://acme.my.salesforce-setup.com/lightning/setup/ObjectManager/home');
    assert.strictEqual(setup.kind, 'setup');
    assert.strictEqual(setup.setupPage, 'ObjectManager');

    /* An unrecognised page is unknown, not guessed at. */
    const unknown = Collectors.pageContext('https://acme.lightning.force.com/lightning/page/home');
    assert.strictEqual(unknown.kind, 'unknown');
    assert.strictEqual(unknown.recordId, null, 'no record id is invented for a page without one');

    /*
     * No DOM reading anywhere in the collectors. The specification asks for
     * this explicitly and it is the kind of shortcut that gets added later
     * under time pressure, so it is asserted rather than trusted.
     */
    const source = require('fs').readFileSync('./js/event-graph/ss-collectors.js', 'utf8');
    [/querySelector/, /getElementsBy/, /\$\(['"]/, /document\.body/].forEach((pattern) => {
        assert.ok(!pattern.test(source),
            `collectors must not read the DOM: found ${pattern}`);
    });

    /* ------------------------------------------------------------------ */
    /* Debug logs                                                          */
    /* ------------------------------------------------------------------ */

    const log = [
        '43.0 APEX_CODE,FINEST;APEX_PROFILING,INFO',
        'Execution log',
        '10:42:01.100 (100000000)|EXECUTION_STARTED',
        '10:42:01.101 (101000000)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000001|OrderService.processOrder',
        '10:42:01.150 (150000000)|SOQL_EXECUTE_BEGIN|[12]|Aggregations:0|SELECT Id FROM Case',
        '10:42:01.200 (200000000)|DML_BEGIN|[15]|Op:Insert|Type:Order|Rows:1',
        '10:42:01.260 (260000000)|CALLOUT_REQUEST|[20]|System.HttpRequest[Endpoint=https://pay.example.com/charge, Method=POST]',
        '10:42:01.443 (443000000)|CALLOUT_RESPONSE|[20]|System.HttpResponse[Status=OK, StatusCode=200]',
        '10:42:01.500 (500000000)|CALLOUT_REQUEST|[24]|System.HttpRequest[Endpoint=https://erp.example.com/reserve, Method=POST]',
        '10:42:01.900 (900000000)|CALLOUT_RESPONSE|[24]|System.HttpResponse[Status=Forbidden, StatusCode=403]',
        '10:42:01.950 (950000000)|FATAL_ERROR|System.CalloutException: inventory refused',
        '10:42:01.960 (960000000)|CODE_UNIT_FINISHED|OrderService.processOrder',
        '10:42:01.970 (970000000)|EXECUTION_FINISHED'
    ].join('\n');

    const parsed = Collectors.parseDebugLog(log, {
        startTime: '2026-08-17T10:42:00.000Z',
        logId: '07L000000000001',
        actor: { kind: 'user', id: '005AAA', name: 'Priya Raman' }
    });

    const types = parsed.events.map((e) => e.eventType);
    assert.ok(types.indexOf('APEX_START') !== -1, 'a code unit becomes an Apex span');
    assert.ok(types.indexOf('RECORD_CREATE') !== -1, 'an Insert becomes a record creation');
    assert.strictEqual(types.filter((t) => t === 'HTTP_REQUEST').length, 2, 'both callouts are read');

    const responses = parsed.events.filter((e) => e.eventType === 'HTTP_RESPONSE');
    assert.strictEqual(responses.length, 2);
    assert.strictEqual(responses[0].status, 'success', '200 is a success');
    assert.strictEqual(responses[1].status, 'failure', '403 is a failure');
    assert.strictEqual(responses[1].error.code, 403, 'and carries the status code');
    assert.strictEqual(responses[0].duration, 183, 'the latency comes from the log, not a guess');

    /* The endpoint's host names the component, so the graph reads as systems. */
    assert.strictEqual(responses[0].component.name, 'pay.example.com');
    assert.strictEqual(responses[1].component.name, 'erp.example.com');

    /* Every event from a log is attributed to Salesforce, never to the browser. */
    parsed.events.forEach((event) => {
        assert.strictEqual(event.source.kind, 'salesforce',
            'a debug log is a Salesforce observation');
        assert.strictEqual(event.traceId, parsed.traceId,
            'and everything in one log shares that log\'s trace');
    });

    /*
     * The exception marks the enclosing unit as failed. A graph where the
     * method is green and the exception floats beside it is worse than none.
     */
    const apexEnd = parsed.events.filter((e) => e.eventType === 'APEX_END');
    assert.ok(apexEnd.some((e) => e.status === 'failure'),
        'a fatal error fails the unit that was running');

    /* Timestamps are real, ordered, and sub-millisecond where the log allows. */
    for (let i = 1; i < parsed.events.length; i++) {
        assert.ok(parsed.events[i].timestamp >= parsed.events[i - 1].timestamp,
            'log events come out in order');
    }

    /* A truncated log says so rather than presenting a journey that stops. */
    const cut = Collectors.parseDebugLog(
        log + '\n*********** MAXIMUM DEBUG LOG SIZE REACHED ***********',
        { startTime: '2026-08-17T10:42:00.000Z' });
    assert.strictEqual(cut.truncated, true, 'truncation is reported');

    /* A log with no usable lines yields nothing rather than throwing. */
    assert.deepStrictEqual(Collectors.parseDebugLog('', {}).events, []);
    assert.deepStrictEqual(Collectors.parseDebugLog('garbage\nlines', {}).events, []);

    /*
     * The parsed log, put through the correlation engine, must reconstruct the
     * causal chain end to end - this is the whole point of collecting it.
     */
    const store = new Store.EventStore();
    store.ingest(parsed.events);
    const correlated = Correlation.correlate(store.all(), {});
    const pairs = correlated.relationships.filter((r) => r.relationshipType === 'RETURNED');
    assert.strictEqual(pairs.length, 2, 'both callouts are paired to their responses');

    const propagation = correlated.relationships.filter((r) =>
        r.relationshipType === 'FAILED_BECAUSE_OF');
    assert.ok(propagation.length >= 1,
        'the 403 is connected to the failure that followed it');

    /* ------------------------------------------------------------------ */
    /* Records                                                             */
    /* ------------------------------------------------------------------ */

    const records = Collectors.fromRecords([
        {
            Id: '801XX0000000001', OrderNumber: '00045',
            CreatedDate: '2026-08-17T10:42:02.000Z',
            LastModifiedDate: '2026-08-17T10:45:00.000Z',
            CreatedById: '005AAA', CreatedBy: { Name: 'Priya Raman' },
            CaseId: '500XX0000012345', AccountId: '001XX0000000009'
        }
    ], { objectType: 'Order' });

    assert.strictEqual(records.length, 2, 'created and last-changed are two events');
    const update = records.filter((e) => e.eventType === 'RECORD_UPDATE')[0];

    /*
     * The claim is limited to what the field supports. LastModifiedDate is the
     * most recent change, and a graph drawing one update where there were nine
     * understates by a factor nobody looking at it can see.
     */
    assert.strictEqual(update.metadata.isLatestOnly, true,
        'an update from a record timestamp says it is only the latest one');
    assert.ok(/Last changed/.test(update.action),
        'and its wording does not claim to be the only change');

    /* Lookup fields become references the correlation engine can join on. */
    const created = records.filter((e) => e.eventType === 'RECORD_CREATE')[0];
    const refs = created.metadata.references.map((r) => r.id);
    assert.ok(refs.indexOf('500XX0000012345') !== -1, 'the Case lookup is picked up');
    assert.ok(refs.indexOf('001XX0000000009') !== -1, 'and so is the Account');
    assert.ok(refs.indexOf('801XX0000000001') === -1, 'but the record\'s own Id is not a reference');

    /* ------------------------------------------------------------------ */
    /* Design-time is never runtime                                        */
    /* ------------------------------------------------------------------ */

    const dependencies = Collectors.omniDependencies([
        {
            Name: 'ProcessOrder',
            PropertySetConfig: JSON.stringify({
                integrationProcedureKey: 'Order_Fulfilment',
                bundle: 'MapOrderPayload'
            })
        }
    ]);

    assert.strictEqual(dependencies.length, 2, 'both references are found');
    dependencies.forEach((dependency) => {
        assert.strictEqual(dependency.designTime, true,
            'an OmniStudio reference is design-time and marked as such');
    });

    /*
     * And it produces dependencies, not events. Emitting these as executions
     * is the single most misleading thing this engine could do, so the shape
     * of the return value makes it impossible.
     */
    dependencies.forEach((dependency) => {
        assert.strictEqual(dependency.eventType, undefined,
            'a configured dependency is not an event that happened');
        assert.strictEqual(dependency.timestamp, undefined,
            'and has no time, because it did not occur at one');
    });

    /* ------------------------------------------------------------------ */
    /* External telemetry is validated, not trusted                        */
    /* ------------------------------------------------------------------ */

    const external = Collectors.ingestExternal({
        events: [
            { eventType: 'PAYMENT_COMPLETED', timestamp: '2026-08-17T10:42:03.000Z',
              traceId: 'txn-9001', source: 'Stripe', status: 'success',
              entity: { type: 'Payment', id: 'pi_123' } },
            { eventType: 'ORDER_CREATED' },
            { timestamp: '2026-08-17T10:42:03.000Z' },
            { eventType: 'DOCUMENT_GENERATED', timestamp: 'not a date' },
            'nonsense'
        ]
    });

    assert.strictEqual(external.events.length, 1, 'only the well-formed event is accepted');
    assert.strictEqual(external.rejected.length, 4, 'and the rest are rejected with reasons');
    external.rejected.forEach((rejection) => {
        assert.ok(rejection.reason, 'every rejection says why');
    });

    /*
     * A sender does not get to describe itself as Salesforce or as the browser.
     * Provenance is a statement about how this engine came to know something,
     * and accepting the sender's word for it would let any integration
     * launder an assertion into a confirmed fact.
     */
    const spoofed = Collectors.ingestExternal([
        { eventType: 'RECORD_UPDATE', timestamp: '2026-08-17T10:42:03.000Z',
          source: { kind: 'salesforce' } }
    ]);
    assert.strictEqual(spoofed.events[0].source.kind, 'external',
        'external telemetry is always marked external, whatever it claims');

    /* ------------------------------------------------------------------ */
    /* Agents share the graph                                              */
    /* ------------------------------------------------------------------ */

    const agentEvents = Collectors.fromAgentTrace({
        traceId: 'agent-77', agentId: 'agent-alpha', agentName: 'Order Assistant',
        onBehalfOf: '005AAA', requestedAt: '2026-08-17T10:41:00.000Z',
        prompt: 'Refund the failed order',
        toolCalls: [
            { tool: 'salesforce.updateRecord', calledAt: '2026-08-17T10:41:01.000Z',
              respondedAt: '2026-08-17T10:41:01.400Z',
              arguments: { recordId: '801XX', status: 'Refunded' },
              recordsAccessed: ['801XX'] },
            { tool: 'payments.refund', calledAt: '2026-08-17T10:41:02.000Z',
              respondedAt: '2026-08-17T10:41:02.900Z', status: 'failure',
              error: { code: 409, message: 'Already refunded' } }
        ]
    });

    assert.strictEqual(agentEvents.filter((e) => e.eventType === 'MCP_TOOL_CALL').length, 2);
    agentEvents.forEach((event) => {
        assert.strictEqual(event.actor.kind, 'agent', 'an agent is an actor like any other');
        assert.strictEqual(event.actor.onBehalfOf, '005AAA',
            'and who it acted for is kept, which is what an approval trail needs');
        assert.strictEqual(event.traceId, 'agent-77');
    });

    const toolFailure = agentEvents.filter((e) => e.status === 'failure')[0];
    assert.ok(toolFailure, 'a failed tool call is a failure in the graph');
    assert.strictEqual(toolFailure.error.code, 409);

    /* The agent's journey correlates with no special-casing. */
    const agentStore = new Store.EventStore();
    agentStore.ingest(agentEvents);
    const agentGraph = Correlation.correlate(agentStore.all(), {});
    assert.ok(agentGraph.relationships.some((r) => r.relationshipType === 'INVOKED'),
        'the agent request is linked to the tools it called');

    /* ------------------------------------------------------------------ */
    /* The gap report names what nothing could see                         */
    /* ------------------------------------------------------------------ */

    const thin = new Store.EventStore();
    thin.ingest(records);
    const gaps = Collectors.gapReport(thin.all());

    assert.ok(gaps.length >= 3, 'a trace built only from record timestamps is mostly gaps');
    assert.ok(gaps.some((gap) => gap.id === 'debugLog'),
        'and says that no execution detail was captured');
    gaps.forEach((gap) => {
        assert.ok(gap.missing && gap.missing.length > 20,
            'each gap explains what is missing and why, not just that something is');
    });

    /* With a log present, that particular gap is no longer claimed. */
    const richer = new Store.EventStore();
    richer.ingest(parsed.events);
    assert.ok(!Collectors.gapReport(richer.all()).some((gap) => gap.id === 'debugLog'),
        'a gap that has been filled is not still reported');

    console.log('event graph collectors test passed');
}

main();
