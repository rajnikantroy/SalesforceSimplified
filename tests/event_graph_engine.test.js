/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');

/*
 * The Event Graph Engine, against the journey the specification describes.
 *
 * The scenario is the one from the brief, built as events from six different
 * sources the way they would really arrive: the click is browser-observed, the
 * OmniStudio spans come from instrumentation, the record writes come from
 * Salesforce, the second API's failure comes from external telemetry. Nothing
 * in the fixture pre-links them. The engine has to work the journey out.
 *
 * What is actually being asserted, in order of how much it matters:
 *
 *   1. the graph reconstructs the journey from independent events
 *   2. a metadata dependency never produces a CONFIRMED relationship
 *   3. an inferred link is never presented as a fact
 *   4. projections are the same graph, not five datasets
 *   5. replay is derived from timestamps and re-executes nothing
 *   6. payloads are redacted before they are ever stored
 */

const Model = require('../js/event-graph/ss-event-model.js');
const Store = require('../js/event-graph/ss-event-store.js');
const Correlation = require('../js/event-graph/ss-correlation.js');
const Trace = require('../js/event-graph/ss-trace.js');
const Replay = require('../js/event-graph/ss-replay.js');

const T0 = Date.parse('2026-08-17T10:42:00.000Z');
const at = (ms) => new Date(T0 + ms).toISOString();

const USER = { kind: 'user', id: '005AAA', name: 'Priya Raman' };
const SESSION = { id: 'sess-1' };
const TRACE = 'txn-9001';

/*
 * The journey. Six sources, no pre-wired parents except where a real system
 * would genuinely have recorded one.
 */
function journey() {
    return [
        /* Browser. The click and the component opening are the only things a
         * content script can actually see. */
        { eventType: 'RECORD_VIEW', timestamp: at(0), actor: USER, session: SESSION,
          source: { kind: 'browser' }, entity: { type: 'Case', id: '500XXX', name: 'Case 00012' },
          action: 'Opened Case 00012', status: 'success' },

        { eventType: 'BUTTON_CLICK', timestamp: at(1200), actor: USER, session: SESSION,
          source: { kind: 'browser' }, entity: { type: 'Case', id: '500XXX' },
          component: { kind: 'ui', name: 'Process Order' },
          action: 'Clicked Process Order', status: 'success' },

        { eventType: 'COMPONENT_OPEN', timestamp: at(1400), actor: USER, session: SESSION,
          source: { kind: 'browser' }, component: { kind: 'lwc', name: 'orderProcessor' },
          entity: { type: 'Case', id: '500XXX' }, action: 'orderProcessor opened', status: 'success' },

        /* Customer instrumentation. OmniStudio spans, carrying the trace id. */
        { eventType: 'OMNISCRIPT_START', timestamp: at(1600), traceId: TRACE, actor: USER,
          session: SESSION, source: { kind: 'instrumentation' },
          component: { kind: 'omniscript', name: 'ProcessOrder' }, status: 'success' },

        { eventType: 'INTEGRATION_PROCEDURE_START', timestamp: at(1800), traceId: TRACE,
          actor: USER, session: SESSION, source: { kind: 'instrumentation' },
          component: { kind: 'integrationProcedure', name: 'OrderFulfilment' }, status: 'success' },

        { eventType: 'DATA_MAPPER_EXECUTION', timestamp: at(1900), traceId: TRACE, actor: USER,
          session: SESSION, source: { kind: 'instrumentation' }, duration: 40,
          component: { kind: 'dataMapper', name: 'MapOrderPayload' }, status: 'success' },

        /* Two callouts, in parallel. The first succeeds, the second is refused. */
        { eventType: 'HTTP_REQUEST', timestamp: at(2000), traceId: TRACE, actor: USER,
          session: SESSION, source: { kind: 'instrumentation' },
          component: { kind: 'restApi', name: 'PaymentAPI' },
          metadata: { requestId: 'req-A', endpoint: 'https://pay.example.com/charge' },
          input: { amount: 240, card: '4111111111111111', email: 'priya@example.com' },
          action: 'POST /charge' },

        { eventType: 'HTTP_REQUEST', timestamp: at(2050), traceId: TRACE, actor: USER,
          session: SESSION, source: { kind: 'instrumentation' },
          component: { kind: 'restApi', name: 'InventoryAPI' },
          metadata: { requestId: 'req-B', endpoint: 'https://erp.example.com/reserve' },
          action: 'POST /reserve' },

        { eventType: 'HTTP_RESPONSE', timestamp: at(2183), traceId: TRACE, actor: USER,
          session: SESSION, source: { kind: 'external' }, duration: 183,
          component: { kind: 'restApi', name: 'PaymentAPI' },
          metadata: { requestId: 'req-A', statusCode: 200 },
          output: { transactionId: '88372' }, status: 'success' },

        { eventType: 'HTTP_RESPONSE', timestamp: at(2450), traceId: TRACE, actor: USER,
          session: SESSION, source: { kind: 'external' }, duration: 400,
          component: { kind: 'restApi', name: 'InventoryAPI' },
          metadata: { requestId: 'req-B', statusCode: 403 },
          status: 'failure', error: { code: 403, message: 'Reservation refused: credit hold' } },

        /* Salesforce. The order write, and the failure that followed. */
        { eventType: 'RECORD_CREATE', timestamp: at(2600), traceId: TRACE, actor: USER,
          session: SESSION, source: { kind: 'salesforce' },
          entity: { type: 'Order', id: '801XXX', name: 'Order 00045' },
          metadata: { references: [{ field: 'CaseId', id: '500XXX' }] },
          status: 'success' },

        { eventType: 'ORDER_CREATED', timestamp: at(2620), traceId: TRACE, actor: USER,
          session: SESSION, source: { kind: 'salesforce' },
          entity: { type: 'Order', id: '801XXX' }, status: 'success' },

        { eventType: 'INTEGRATION_PROCEDURE_END', timestamp: at(2700), traceId: TRACE,
          actor: USER, session: SESSION, source: { kind: 'instrumentation' },
          component: { kind: 'integrationProcedure', name: 'OrderFulfilment' },
          status: 'failure', error: { message: 'Fulfilment aborted - inventory refused' } },

        { eventType: 'OMNISCRIPT_END', timestamp: at(2750), traceId: TRACE, actor: USER,
          session: SESSION, source: { kind: 'instrumentation' },
          component: { kind: 'omniscript', name: 'ProcessOrder' },
          status: 'failure', error: { message: 'Order could not be fulfilled' } }
    ];
}

function build(raw, options) {
    const store = new Store.EventStore();
    const ingested = store.ingest(raw || journey(), options);
    const correlated = Correlation.correlate(store.all(), (options && options.correlation) || {});
    const graph = Trace.buildGraph(store.all(), correlated.relationships);
    return { store, ingested, correlated, graph };
}

function main() {

    /* ------------------------------------------------------------------ */
    /* 1. Normalisation refuses what it cannot place                       */
    /* ------------------------------------------------------------------ */

    assert.ok(Model.normalizeEvent({ timestamp: at(0) }).error,
        'an event with no type is refused');
    assert.ok(Model.normalizeEvent({ eventType: 'PAGE_OPEN' }).error,
        'an event with no timestamp is refused rather than given one');
    assert.ok(/timestamp/.test(Model.normalizeEvent({ eventType: 'PAGE_OPEN', timestamp: 'nonsense' }).error),
        'an unparseable timestamp is refused, not defaulted to now');

    /*
     * A type nothing here has heard of still enters the graph. Dropping it
     * would make a managed package or a future agent runtime silently
     * invisible, which is the failure this whole engine exists to prevent.
     */
    const custom = Model.normalizeEvent({ eventType: 'VLOCITY_CARD_RENDER', timestamp: at(0) });
    assert.ok(!custom.error, 'an unknown event type is accepted');
    assert.strictEqual(custom.event.category, 'CUSTOM', 'and lands in CUSTOM rather than being guessed at');

    /* ------------------------------------------------------------------ */
    /* 2. Payloads are redacted before storage, and say what was taken      */
    /* ------------------------------------------------------------------ */

    const { store } = build();
    const payment = store.all().filter((e) => e.eventType === 'HTTP_REQUEST' &&
        e.component.name === 'PaymentAPI')[0];

    assert.ok(payment, 'the payment request is in the store');
    assert.strictEqual(payment.input.amount, 240, 'a harmless field survives');
    assert.notStrictEqual(payment.input.card, '4111111111111111',
        'a card number is never stored as given');
    assert.ok(/\*/.test(String(payment.input.card)), 'it is masked');
    assert.ok(!/priya@example\.com/.test(JSON.stringify(payment.input)),
        'and an email address does not survive in the payload at all');

    assert.ok(payment.privacy.redactions.length >= 2,
        'the redactions are recorded rather than silently applied');
    assert.strictEqual(payment.privacy.classification, 'pii',
        'and the event is classified by the worst thing it carried');

    /*
     * The AI policy is allowlist by default. The specification's rule - never
     * send complete record payloads to an AI service - is the default mode
     * here, not a warning somebody has to remember.
     */
    const aiPolicy = Model.aiSafePolicy(['amount']);
    const forAi = Model.redactPayload({ amount: 240, card: '4111111111111111', notes: 'x' }, aiPolicy);
    assert.strictEqual(forAi.value.amount, 240, 'an allowlisted field is sent');
    assert.strictEqual(forAi.value.notes, '[redacted]', 'anything not named is not');

    /* ------------------------------------------------------------------ */
    /* 3. The journey is reconstructed                                      */
    /* ------------------------------------------------------------------ */

    const { graph, correlated } = build();

    const rels = correlated.relationships;
    assert.ok(rels.length > 10, `expected a connected graph, got ${rels.length} relationships`);

    function edge(fromMatch, toMatch, type) {
        return rels.filter((rel) => {
            const from = graph.nodes[rel.sourceEventId];
            const to = graph.nodes[rel.targetEventId];
            if (!from || !to) { return false; }
            if (type && rel.relationshipType !== type) { return false; }
            return fromMatch(from) && toMatch(to);
        })[0];
    }

    const isType = (t) => (e) => e.eventType === t;
    const isComponent = (n) => (e) => e.component && e.component.name === n;

    /* Request and response, paired by request id - the strongest signal. */
    const paymentPair = edge(
        (e) => e.eventType === 'HTTP_REQUEST' && e.component.name === 'PaymentAPI',
        (e) => e.eventType === 'HTTP_RESPONSE' && e.component.name === 'PaymentAPI',
        'RETURNED');
    assert.ok(paymentPair, 'the payment request is matched to its response');
    assert.strictEqual(paymentPair.confidence, 'CONFIRMED',
        'a shared request id is a confirmed pairing');
    assert.strictEqual(paymentPair.latencyMs, 183, 'and carries the measured latency');

    /*
     * The two callouts overlap. The pairing must not cross them - matching
     * request A to response B is the classic failure of pairing by order, and
     * it produces a graph that is confidently wrong about which API was slow.
     */
    const crossed = edge(
        (e) => e.eventType === 'HTTP_REQUEST' && e.component.name === 'PaymentAPI',
        (e) => e.eventType === 'HTTP_RESPONSE' && e.component.name === 'InventoryAPI',
        'RETURNED');
    assert.ok(!crossed, 'concurrent calls are not cross-matched');

    /* The data mapper ran inside the Integration Procedure's span. */
    const nested = edge(isComponent('OrderFulfilment'), isComponent('MapOrderPayload'), 'INVOKED');
    assert.ok(nested, 'work inside a span is attributed to the span that contained it');

    /* The record write is tied back to the automation that ran. */
    const created = edge(
        (e) => e.component && e.component.kind === 'integrationProcedure',
        isType('RECORD_CREATE'), 'CREATED');
    assert.ok(created, 'the order creation is linked to the automation that produced it');

    /*
     * The Order references the Case: a link the org itself holds.
     *
     * PARENT_OF rather than RELATED_TO, and pointing from the referenced
     * record to the one referencing it - the same type and direction
     * ss-record-graph derives from the same field, so the two descriptions of
     * one fact merge into a single edge instead of drawing two.
     */
    const reference = rels.filter((rel) => rel.relationshipType === 'PARENT_OF' &&
        rel.confidence === 'CONFIRMED' &&
        rel.evidence.some((item) => item.signal === 'recordReference'))[0];
    assert.ok(reference, 'a declared record reference is a confirmed relationship');

    const referencedFrom = graph.nodes[reference.sourceEventId];
    const referencedTo = graph.nodes[reference.targetEventId];
    assert.strictEqual(referencedFrom.entity.type, 'Case',
        'the referenced record is the parent');
    assert.strictEqual(referencedTo.entity.type, 'Order',
        'and the one holding the lookup is the child');

    /* ------------------------------------------------------------------ */
    /* 4. The failure, and what it stopped                                  */
    /* ------------------------------------------------------------------ */

    const propagation = rels.filter((rel) => rel.relationshipType === 'FAILED_BECAUSE_OF');
    assert.ok(propagation.length >= 1, 'the failure is connected to what failed after it');

    const fromInventory = propagation.filter((rel) => {
        const from = graph.nodes[rel.sourceEventId];
        return from.component && from.component.name === 'InventoryAPI';
    });
    assert.ok(fromInventory.length >= 1,
        'the refused callout is named as the reason the fulfilment failed');

    /*
     * And it is LIKELY, not CONFIRMED. That the Integration Procedure failed
     * after the 403 is observed; that it failed *because* of it is a reading
     * of the evidence, and the interface must not blur the two.
     */
    fromInventory.forEach((rel) => {
        assert.strictEqual(rel.confidence, 'LIKELY',
            'causation from a failure is likely, never confirmed');
    });

    /* ------------------------------------------------------------------ */
    /* 5. Metadata dependency is never proof of execution                   */
    /* ------------------------------------------------------------------ */

    const withDeps = build(journey(), {
        correlation: {
            dependencies: [{ from: 'ProcessOrder', to: 'OrderFulfilment' }]
        }
    });

    const designTime = withDeps.correlated.relationships.filter((rel) => rel.designTime);
    assert.ok(designTime.length >= 1, 'a configured dependency with matching timing is drawn');

    designTime.forEach((rel) => {
        assert.notStrictEqual(rel.confidence, 'CONFIRMED',
            'a design-time dependency must never be presented as confirmed');
        assert.ok(rel.evidence.some((item) => item.signal === 'designTimeIsNotProof'),
            'and the edge says so in its own evidence');
    });

    /* ------------------------------------------------------------------ */
    /* 6. Inferred links are marked as inferred                             */
    /* ------------------------------------------------------------------ */

    rels.forEach((rel) => {
        assert.ok(['CONFIRMED', 'LIKELY', 'INFERRED', 'UNKNOWN'].indexOf(rel.confidence) !== -1,
            'every relationship carries one of the four confidences');
        assert.ok(rel.evidence.length > 0,
            `every relationship explains itself: ${rel.relationshipType} had no evidence`);
        assert.strictEqual(rel.state, rel.confidence === 'CONFIRMED' ? 'observed' : 'inferred',
            'only a confirmed relationship counts as observed');
    });

    /* ------------------------------------------------------------------ */
    /* 7. Trace roots                                                       */
    /* ------------------------------------------------------------------ */

    const fromUser = Trace.buildTrace(graph, { kind: 'user', id: '005AAA', view: 'ALL' });
    assert.ok(fromUser.stats.reached > 8, 'starting from the user reaches the journey');

    const fromRecord = Trace.buildTrace(graph, { kind: 'record', id: '500XXX', view: 'ALL' });
    assert.ok(fromRecord.stats.reached > 5, 'starting from the Case reaches it too');

    const fromTransaction = Trace.buildTrace(graph, { kind: 'transaction', id: TRACE, view: 'ALL' });
    assert.ok(fromTransaction.stats.reached >= 10, 'and so does starting from the transaction');

    /*
     * Upstream and downstream are different questions. From the failed
     * response, upstream is why it happened and downstream is what it cost.
     */
    const failureEvent = store.all().filter((e) => e.status === 'failure' &&
        e.component && e.component.name === 'InventoryAPI')[0];

    const upstream = Trace.traverse(graph, {
        kind: 'event', id: failureEvent.eventId, direction: 'upstream'
    });
    const downstream = Trace.traverse(graph, {
        kind: 'event', id: failureEvent.eventId, direction: 'downstream'
    });

    assert.ok(upstream.nodes.some((e) => e.eventType === 'HTTP_REQUEST'),
        'upstream from the failure reaches the request that caused it');
    assert.ok(downstream.nodes.some((e) => e.status === 'failure' &&
        e.component && e.component.kind === 'integrationProcedure'),
        'downstream from the failure reaches what failed as a result');

    /* ------------------------------------------------------------------ */
    /* 8. Confidence decays along a path                                    */
    /* ------------------------------------------------------------------ */

    const reached = fromUser.traversed.reached;
    Object.keys(reached).forEach((id) => {
        const entry = reached[id];
        if (!entry.via) { return; }
        assert.ok(Model.CONFIDENCE_RANK[entry.confidence] <=
                  Model.CONFIDENCE_RANK[entry.via.confidence],
            'a node is never more certain than the edge that reached it');
    });

    /* ------------------------------------------------------------------ */
    /* 9. Projections are the same graph                                    */
    /* ------------------------------------------------------------------ */

    const all = Trace.traverse(graph, { kind: 'transaction', id: TRACE });
    const views = ['USER', 'RECORD', 'TECHNICAL', 'BUSINESS', 'AGENT'];
    const ids = new Set(all.nodes.map((e) => e.eventId));

    views.forEach((view) => {
        const projected = Trace.project(all, view);
        projected.nodes.forEach((node) => {
            assert.ok(ids.has(node.eventId),
                `${view} must project the same graph, not invent nodes`);
        });
    });

    const technical = Trace.project(all, 'TECHNICAL');
    const business = Trace.project(all, 'BUSINESS');
    assert.ok(technical.nodes.length > business.nodes.length,
        'the technical view carries more of the execution than the business one');
    assert.ok(business.nodes.some((e) => e.eventType === 'ORDER_CREATED'),
        'and the business view keeps the outcome');

    /*
     * The business view is about the transaction, not about the clicking.
     * Keying purely on the entity type let a button click in on the grounds
     * that the record behind it was a Case - a UI event in the one view that
     * is meant to be readable by somebody who does not care about the UI.
     */
    assert.ok(!business.nodes.some((e) => e.category === 'UI'),
        'no UI event belongs in the business view');
    assert.ok(business.nodes.every((e) =>
        e.category === 'BUSINESS' || e.outcome || e.category === 'SALESFORCE'),
        'the business view carries business facts and record changes only');

    /*
     * A view with nothing of its kind says so, rather than showing whatever
     * incidentally qualified. This trace has no agent in it, so an outcome
     * alone must not be presented as an agent journey.
     */
    const agentView = Trace.project(all, 'AGENT');
    assert.strictEqual(agentView.nodes.length, 0,
        'a trace with no agent yields an empty agent view');
    assert.ok(/No agent or tool activity/.test(agentView.emptyReason),
        'and says why it is empty, rather than looking like a filter mistake');

    /* With an agent present, the outcome does belong - it is what the agent's
     * work was for. Same predicate, different trace. */
    const withAgent = build(journey().concat([
        { eventType: 'AGENT_REQUEST', timestamp: at(500), traceId: TRACE,
          actor: { kind: 'agent', id: 'agent-alpha', name: 'Order Assistant',
                   onBehalfOf: '005AAA' },
          source: { kind: 'instrumentation' }, status: 'success' }
    ]));
    const agentPopulated = Trace.project(
        Trace.traverse(withAgent.graph, { kind: 'transaction', id: TRACE }), 'AGENT');
    assert.ok(agentPopulated.nodes.some((e) => e.eventType === 'AGENT_REQUEST'),
        'the agent request is in the agent view');
    assert.ok(agentPopulated.nodes.some((e) => e.outcome),
        'and so is the outcome, once there is an agent for it to belong to');
    assert.strictEqual(agentPopulated.emptyReason, null,
        'a populated view has no empty reason');

    /*
     * Bridging: the business view hides the callouts, and what replaces them
     * is marked as spanning hidden steps rather than pretending to be a
     * relationship that was actually observed.
     */
    const bridged = business.edges.filter((rel) => rel.bridged);
    bridged.forEach((rel) => {
        assert.strictEqual(rel.state, 'inferred', 'a bridged edge is never observed');
        assert.ok(rel.bridgedOver.length > 0, 'and knows what it stepped over');
        assert.ok(rel.evidence.some((item) => item.signal === 'projection'),
            'and says so in its evidence');
    });

    /* ------------------------------------------------------------------ */
    /* 10. Following a record across entities                               */
    /* ------------------------------------------------------------------ */

    const followed = Trace.follow(graph, { kind: 'record', id: '500XXX' });
    const entities = followed.chain.map((link) => link.entity.type);
    assert.ok(entities.indexOf('Case') !== -1, 'following the Case starts at the Case');
    assert.ok(entities.indexOf('Order') !== -1, 'and reaches the Order it became');
    assert.ok(followed.chain[0].firstSeen <= followed.chain[followed.chain.length - 1].firstSeen,
        'the chain is in the order the entities were first touched');

    /* ------------------------------------------------------------------ */
    /* 11. Grouping keeps failures out of the crowd                         */
    /* ------------------------------------------------------------------ */

    const repetitive = [];
    for (let i = 0; i < 9; i++) {
        repetitive.push({
            eventType: 'HTTP_REQUEST', timestamp: at(5000 + i * 10), traceId: 'bulk',
            source: { kind: 'external' }, component: { kind: 'restApi', name: 'BulkAPI' },
            metadata: { requestId: 'bulk-' + i }, status: 'success'
        });
    }
    repetitive.push({
        eventType: 'HTTP_REQUEST', timestamp: at(5200), traceId: 'bulk',
        source: { kind: 'external' }, component: { kind: 'restApi', name: 'BulkAPI' },
        metadata: { requestId: 'bulk-fail' }, status: 'failure',
        error: { code: 500, message: 'Tax API exploded' }
    });

    const bulk = build(repetitive);
    const bulkTrace = Trace.buildTrace(bulk.graph, { kind: 'transaction', id: 'bulk', view: 'ALL' });
    const groups = bulkTrace.graph.groups || [];

    assert.ok(groups.length >= 1, 'nine identical calls collapse into a group');
    groups.forEach((group) => {
        const failing = group.members.filter((m) => m.status === 'failure').length;
        assert.ok(failing === 0 || failing === group.members.length,
            'a group never mixes successes with failures - the failure is the point');
    });
    assert.ok(bulkTrace.graph.nodes.some((n) => !n.isGroup && n.status === 'failure'),
        'so the failed call stays visible on its own');

    /* Expanding a group hands back the real events. */
    const group = groups[0];
    assert.strictEqual(group.members.length, group.count, 'a group can be expanded to its members');
    assert.ok(group.action.indexOf('×') !== -1, 'and reads as a count until it is');

    /* ------------------------------------------------------------------ */
    /* 12. Replay is derived from timestamps                                */
    /* ------------------------------------------------------------------ */

    const traced = Trace.buildTrace(graph, { kind: 'transaction', id: TRACE, view: 'ALL',
        grouping: false });
    const script = Replay.buildScript(traced.graph);

    assert.ok(script.duration > 0, 'the replay has a length');
    assert.strictEqual(script.startedAt, T0, 'and starts at the first real event');

    const start = Replay.stateAt(script, 0);
    const end = Replay.stateAt(script, script.duration);
    assert.ok(start.completed === 0, 'at zero nothing has happened yet');
    assert.ok(end.finished, 'at the end it is finished');
    assert.ok(end.failures > 0, 'and the failures are counted');

    /*
     * State is a function of the instant alone. Scrubbing back and forth must
     * land on exactly the same picture - the bug every animation built on
     * accumulated state eventually has.
     */
    const half = script.duration / 2;
    assert.deepStrictEqual(
        Array.from(Object.values(Replay.stateAt(script, half).nodes)),
        Array.from(Object.values(Replay.stateAt(script, half).nodes)),
        'the same instant always yields the same state');

    const forward = Replay.stateAt(script, half);
    const player = new Replay.Player(script, { now: () => 0 });
    player.seek(script.duration);
    player.seek(half);
    assert.deepStrictEqual(Array.from(Object.values(player.state().nodes)),
        Array.from(Object.values(forward.nodes)),
        'scrubbing to an instant matches playing to it');

    /* Parallel work is seen to be parallel. */
    const overlapping = script.nodes.filter((item) =>
        item.node.eventType === 'HTTP_REQUEST');
    assert.strictEqual(overlapping.length, 2, 'two callouts in this trace');
    const bothInFlight = Replay.stateAt(script,
        Math.max(overlapping[0].from, overlapping[1].from) + 1);
    assert.ok(bothInFlight.activeCount >= 2 && bothInFlight.parallel,
        'and there is an instant where both are in flight');

    /* Stepping lands on a boundary, never between two. */
    const stepper = new Replay.Player(script, { now: () => 0 });
    stepper.seek(0);
    const first = stepper.stepForward().at;
    const second = stepper.stepForward().at;
    assert.ok(second > first, 'each step moves forward');
    assert.ok(stepper.boundaries().indexOf(second) !== -1,
        'and lands on a moment where something changes');

    stepper.stepBack();
    assert.strictEqual(stepper.at, first, 'and stepping back returns to the previous one');

    /*
     * Jump to the first failure - the reason most replays are opened, and it
     * has to land on the moment it went red. Landing inside the interval left
     * the operation showing as still in flight, which is honest and is not
     * what somebody pressing "first failure" is asking to see.
     */
    const jumper = new Replay.Player(script, { now: () => 0 });
    jumper.jumpToFirstFailure();
    const atFailure = jumper.state();
    assert.ok(atFailure.at > 0, 'jumping to the first failure moves the clock');

    const firstFailure = script.nodes.filter((item) => item.failed)[0];
    assert.strictEqual(atFailure.nodes[firstFailure.eventId], Replay.NODE_STATE.FAILED,
        'and the failure reads as failed at that instant, not as still running');
    assert.ok(atFailure.failures >= 1, 'with the failure counted');

    /* ------------------------------------------------------------------ */
    /* 13. Replay executes nothing                                          */
    /* ------------------------------------------------------------------ */

    /*
     * A guard against the worst possible regression in this feature. Replaying
     * a payment must never re-run it, so nothing in the replay engine may
     * reach the network at all.
     */
    const replaySource = require('fs').readFileSync('./js/event-graph/ss-replay.js', 'utf8');
    [/\bfetch\s*\(/, /XMLHttpRequest/, /\$\.ajax/, /sendMessage/, /ssRestCall/].forEach((pattern) => {
        assert.ok(!pattern.test(replaySource),
            `the replay engine must not be able to call out: found ${pattern}`);
    });

    /* ------------------------------------------------------------------ */
    /* 14. The store merges rather than duplicates                          */
    /* ------------------------------------------------------------------ */

    const merging = new Store.EventStore();
    const shared = { eventType: 'RECORD_UPDATE', timestamp: at(9000),
        entity: { type: 'Case', id: '500XXX' }, actor: USER };

    merging.ingest([
        Object.assign({}, shared, { source: { kind: 'salesforce' }, metadata: { via: 'query' } }),
        Object.assign({}, shared, { source: { kind: 'browser' } })
    ]);

    assert.strictEqual(merging.all().length, 1,
        'the same event seen by two collectors is one event');
    const mergedEvent = merging.all()[0];
    assert.ok(mergedEvent.corroboratedBy.length >= 1,
        'both witnesses are recorded, not just the winner');
    assert.strictEqual(mergedEvent.metadata.via, 'query',
        'and what only one of them knew is not thrown away');

    /*
     * The browser and the org are peers, so the tie is broken on substance
     * rather than on which collector happened to run first. Order must not
     * change the answer - the same two observations merging differently
     * between refreshes is a graph that will not sit still.
     */
    const reversed = new Store.EventStore();
    reversed.ingest([
        Object.assign({}, shared, { source: { kind: 'browser' } }),
        Object.assign({}, shared, { source: { kind: 'salesforce' }, metadata: { via: 'query' } })
    ]);
    assert.strictEqual(reversed.all()[0].source.kind, mergedEvent.source.kind,
        'the merge does not depend on which collector arrived first');

    /* A genuinely weaker source never overwrites a first-hand one. */
    const weaker = new Store.EventStore();
    weaker.ingest([
        Object.assign({}, shared, { source: { kind: 'browser' } }),
        Object.assign({}, shared, { source: { kind: 'inferred' },
            metadata: { a: 1, b: 2, c: 3, d: 4, e: 5 } })
    ]);
    assert.strictEqual(weaker.all()[0].source.kind, 'browser',
        'an inference never outranks an observation, however much it carries');

    /* ------------------------------------------------------------------ */
    /* 15. Capacity sheds the repetitive middle, never the failures         */
    /* ------------------------------------------------------------------ */

    const capped = new Store.EventStore({ capacity: 20 });
    const noise = [];
    for (let i = 0; i < 60; i++) {
        noise.push({ eventType: 'RECORD_VIEW', timestamp: at(20000 + i),
            source: { kind: 'browser' }, entity: { type: 'Case', id: 'noise-' + i } });
    }
    noise.push({ eventType: 'HTTP_RESPONSE', timestamp: at(20500), source: { kind: 'external' },
        status: 'failure', error: { code: 500, message: 'the one that matters' },
        metadata: { requestId: 'keep-me' } });

    capped.ingest(noise);
    assert.ok(capped.all().length <= 20, 'the cap is enforced');
    assert.ok(capped.all().some((e) => e.error && e.error.message === 'the one that matters'),
        'and the failure survives the cull');

    console.log('event graph engine test passed');
}

main();
