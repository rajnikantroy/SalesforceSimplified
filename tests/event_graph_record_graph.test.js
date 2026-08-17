/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');

/*
 * The record relationship graph.
 *
 * This is the mode that works in an ordinary org, and the reason it exists is
 * worth restating: tracing a record through execution telemetry produced two
 * nodes and five "this source was unavailable" notices, because debug logs,
 * Event Monitoring and OmniStudio runtime are all absent from a normal org on
 * a normal day. Lookups and childRelationships are present in every org, need
 * no configuration, and are facts rather than inferences.
 *
 * So the assertions here are mostly about that last word. A lookup edge must
 * be CONFIRMED and must name the field it came from; a polymorphic lookup must
 * resolve to the object the id actually belongs to rather than the first one
 * listed; and the walk must terminate on a cycle, which real orgs have.
 */

const Model = require('../js/event-graph/ss-event-model.js');
const RecordGraph = require('../js/event-graph/ss-record-graph.js');
const Store = require('../js/event-graph/ss-event-store.js');
const Correlation = require('../js/event-graph/ss-correlation.js');
const Trace = require('../js/event-graph/ss-trace.js');
const Replay = require('../js/event-graph/ss-replay.js');

/* An org's global describe, as SchemaService indexes it. */
const CATALOGUE = {
    Case:      { name: 'Case',      keyPrefix: '500', queryable: true },
    Order:     { name: 'Order',     keyPrefix: '801', queryable: true },
    OrderItem: { name: 'OrderItem', keyPrefix: '802', queryable: true },
    Account:   { name: 'Account',   keyPrefix: '001', queryable: true },
    Contact:   { name: 'Contact',   keyPrefix: '003', queryable: true },
    Task:      { name: 'Task',      keyPrefix: '00T', queryable: true },
    Payment__c: { name: 'Payment__c', keyPrefix: 'a0X', queryable: true },
    CaseHistory: { name: 'CaseHistory', keyPrefix: '017', queryable: true }
};

function describeOf(name, fields, children) {
    return { name: name, fields: fields, childRelationships: children || [] };
}

const CASE_DESCRIBE = describeOf('Case', [
    { name: 'Id', type: 'id' },
    { name: 'CaseNumber', type: 'string', nameField: true },
    { name: 'Status', type: 'picklist' },
    { name: 'CreatedDate', type: 'datetime' },
    { name: 'CreatedById', type: 'reference', referenceTo: ['User'] },
    { name: 'LastModifiedDate', type: 'datetime' },
    { name: 'LastModifiedById', type: 'reference', referenceTo: ['User'] },
    { name: 'AccountId', type: 'reference', referenceTo: ['Account'],
      relationshipName: 'Account', label: 'Account' },
    { name: 'ContactId', type: 'reference', referenceTo: ['Contact'],
      relationshipName: 'Contact', label: 'Contact' },
    /* A wide text field, to prove not everything is selected. */
    { name: 'Description', type: 'textarea' }
], [
    { childSObject: 'Order', field: 'CaseId__c', relationshipName: 'Orders', cascadeDelete: false },
    { childSObject: 'CaseHistory', field: 'CaseId', relationshipName: 'Histories' },
    { childSObject: 'CaseFeed', field: 'ParentId', relationshipName: 'Feeds' },
    { childSObject: 'CaseShare', field: 'ParentId', relationshipName: 'Shares' }
]);

const ORDER_DESCRIBE = describeOf('Order', [
    { name: 'Id', type: 'id' },
    { name: 'OrderNumber', type: 'string', nameField: true },
    { name: 'Status', type: 'picklist' },
    { name: 'CreatedDate', type: 'datetime' },
    { name: 'CreatedById', type: 'reference', referenceTo: ['User'] },
    { name: 'LastModifiedDate', type: 'datetime' },
    { name: 'CaseId__c', type: 'reference', referenceTo: ['Case'],
      relationshipName: 'Case__r', label: 'Case' },
    { name: 'AccountId', type: 'reference', referenceTo: ['Account'],
      relationshipName: 'Account', label: 'Account' }
], [
    { childSObject: 'OrderItem', field: 'OrderId', relationshipName: 'OrderItems',
      cascadeDelete: true },
    { childSObject: 'Payment__c', field: 'Order__c', relationshipName: 'Payments' }
]);

/* A polymorphic lookup - the case this most often gets wrong. */
const TASK_DESCRIBE = describeOf('Task', [
    { name: 'Id', type: 'id' },
    { name: 'Subject', type: 'string', nameField: true },
    { name: 'CreatedDate', type: 'datetime' },
    { name: 'WhatId', type: 'reference', referenceTo: ['Account', 'Case', 'Order'],
      relationshipName: 'What', label: 'Related To' }
]);

function main() {

    /* ------------------------------------------------------------------ */
    /* 1. Any id resolves, including custom objects                        */
    /* ------------------------------------------------------------------ */

    const prefixMap = RecordGraph.buildPrefixMap(CATALOGUE);

    assert.strictEqual(RecordGraph.objectForId('500XX0000012345', prefixMap), 'Case');
    assert.strictEqual(RecordGraph.objectForId('801XX0000000001', prefixMap), 'Order');

    /*
     * The whole point of asking the org rather than carrying a table: a custom
     * object resolves. The hardcoded prefix list in ss-collectors knows twelve
     * standard objects, so every org's actual business objects were untraceable.
     */
    assert.strictEqual(RecordGraph.objectForId('a0XXX0000000001', prefixMap), 'Payment__c',
        'a custom object resolves from the org catalogue');

    assert.strictEqual(RecordGraph.objectForId('zzzXX0000000001', prefixMap), null,
        'an unknown prefix resolves to nothing rather than to a guess');
    assert.strictEqual(RecordGraph.objectForId('short', prefixMap), null);

    /* ------------------------------------------------------------------ */
    /* 2. The describe is read for edges, not for everything               */
    /* ------------------------------------------------------------------ */

    const parents = RecordGraph.parentLinks(CASE_DESCRIBE);
    const parentFields = parents.map((p) => p.field);
    assert.ok(parentFields.indexOf('AccountId') !== -1, 'lookups are parents');
    assert.ok(parentFields.indexOf('ContactId') !== -1);
    assert.ok(parentFields.indexOf('CreatedById') === -1,
        'audit references are not relationships - every record would link to its author');

    const children = RecordGraph.childLinks(CASE_DESCRIBE);
    const childObjects = children.map((c) => c.childSObject);
    assert.ok(childObjects.indexOf('Order') !== -1, 'a real child relationship is followed');
    assert.ok(childObjects.indexOf('CaseFeed') === -1, 'the feed is not');
    assert.ok(childObjects.indexOf('CaseShare') === -1, 'nor are shares');
    assert.ok(childObjects.indexOf('CaseHistory') !== -1,
        'but history is kept - it is the only real source of intermediate changes');

    /* History sorts last: it is detail about the record, not a related record. */
    assert.strictEqual(children[children.length - 1].childSObject, 'CaseHistory');
    assert.strictEqual(children.filter((c) => c.childSObject === 'CaseHistory')[0].isHistory, true);

    /* Master-detail children come before lookups - they are the record's parts. */
    const orderChildren = RecordGraph.childLinks(ORDER_DESCRIBE);
    assert.strictEqual(orderChildren[0].childSObject, 'OrderItem',
        'a cascade-delete child is nearest the record');

    /*
     * Columns are chosen, not taken wholesale. A wide object has hundreds of
     * fields and selecting them all is a slow query whose result is mostly
     * discarded and then redacted.
     */
    const selection = RecordGraph.selectFields(CASE_DESCRIBE);
    assert.ok(selection.fields.indexOf('CaseNumber') !== -1, 'the name field is selected');
    assert.ok(selection.fields.indexOf('AccountId') !== -1, 'references are, they are the edges');
    assert.ok(selection.fields.indexOf('Status') !== -1, 'and a status, to read the node');
    assert.ok(selection.fields.indexOf('Description') === -1,
        'a wide text field is not - it is not what a graph node needs');
    assert.strictEqual(selection.nameField, 'CaseNumber');

    const soql = RecordGraph.soqlFor('Case', selection, "Id = '500XX'", 1);
    assert.ok(/^SELECT /.test(soql) && /FROM Case/.test(soql) && /LIMIT 1$/.test(soql));

    /* ------------------------------------------------------------------ */
    /* 3. Records become events with real actors and real times            */
    /* ------------------------------------------------------------------ */

    const caseRow = {
        Id: '500XX0000012345', CaseNumber: '00012', Status: 'Escalated',
        CreatedDate: '2026-08-10T09:00:00.000Z', CreatedById: '005AAA',
        LastModifiedDate: '2026-08-17T10:45:00.000Z', LastModifiedById: '005BBB',
        AccountId: '001XX0000000009', ContactId: '003XX0000000007'
    };

    const caseEvents = RecordGraph.eventsForRecord(caseRow, {
        objectType: 'Case', selection: selection,
        parentLinks: parents, depth: 0, isRoot: true,
        userNames: { '005AAA': 'Priya Raman', '005BBB': 'Sam Okafor' }
    });

    assert.strictEqual(caseEvents.length, 2, 'created and last-changed');
    assert.strictEqual(caseEvents[0].actor.name, 'Priya Raman',
        'the actor is named, not left as an id');
    assert.strictEqual(caseEvents[1].actor.name, 'Sam Okafor',
        'and the last change can be a different person');
    assert.strictEqual(caseEvents[0].source.kind, 'salesforce');
    assert.strictEqual(caseEvents[0].metadata.recordStatus, 'Escalated');

    const refs = caseEvents[0].metadata.references.map((r) => r.id);
    assert.ok(refs.indexOf('001XX0000000009') !== -1 && refs.indexOf('003XX0000000007') !== -1,
        'both lookups become references');

    /*
     * With history being read, the LastModifiedDate summary is suppressed -
     * otherwise the same edit appears twice, once as a tracked change and once
     * as a summary of it, and the graph double-counts.
     */
    const withHistory = RecordGraph.eventsForRecord(caseRow, {
        objectType: 'Case', selection: selection, parentLinks: parents, hasHistory: true
    });
    assert.strictEqual(withHistory.length, 1,
        'the last-changed summary is dropped when real history is available');

    /* ------------------------------------------------------------------ */
    /* 4. Field history is the real change record                          */
    /* ------------------------------------------------------------------ */

    const history = RecordGraph.eventsForHistory([
        { Id: 'h1', Field: 'Status', OldValue: 'New', NewValue: 'Working',
          CreatedDate: '2026-08-11T08:00:00.000Z', CreatedById: '005AAA', CaseId: '500XX0000012345' },
        { Id: 'h2', Field: 'Status', OldValue: 'Working', NewValue: 'Escalated',
          CreatedDate: '2026-08-14T11:30:00.000Z', CreatedById: '005BBB', CaseId: '500XX0000012345' },
        { Id: 'h3', Field: 'created', OldValue: null, NewValue: null,
          CreatedDate: '2026-08-10T09:00:00.000Z', CreatedById: '005AAA', CaseId: '500XX0000012345' }
    ], {
        objectType: 'CaseHistory', parentType: 'Case', parentField: 'CaseId',
        userNames: { '005AAA': 'Priya Raman', '005BBB': 'Sam Okafor' }
    });

    /*
     * Two, not three. Salesforce writes a synthetic 'created' row into history
     * on insert, and the record's own CreatedDate already produces that event.
     * Keeping both gave every record two creation nodes at the same instant,
     * which then anchored some of its lookup edges to one and some to the
     * other - so a record's relations were drawn twice, from two nodes that
     * looked identical.
     */
    assert.strictEqual(history.length, 2, 'the synthetic created row is dropped');
    assert.ok(!history.some((e) => e.metadata.field === 'created'),
        'the record\'s own CreatedDate is the single source of its creation');
    assert.ok(history.every((e) => e.eventType === 'RECORD_UPDATE'),
        'everything history contributes is a change');

    const statusChange = history.filter((e) => e.metadata.field === 'Status')[0];
    assert.ok(/New → Working/.test(statusChange.action),
        'a tracked change says what it changed from and to: ' + statusChange.action);
    assert.strictEqual(statusChange.metadata.tracked, true);
    assert.strictEqual(statusChange.entity.id, '500XX0000012345',
        'and is attributed to the record it changed, not to the history row');


    /* ------------------------------------------------------------------ */
    /* 5. Lookups become confirmed edges that name their field             */
    /* ------------------------------------------------------------------ */

    const orderRow = {
        Id: '801XX0000000001', OrderNumber: '00045', Status: 'Activated',
        CreatedDate: '2026-08-10T09:00:05.000Z', CreatedById: '005AAA',
        LastModifiedDate: '2026-08-10T09:00:05.000Z',
        CaseId__c: '500XX0000012345', AccountId: '001XX0000000009'
    };
    const accountRow = {
        Id: '001XX0000000009', Name: 'Acme Industries',
        CreatedDate: '2025-01-04T09:00:00.000Z', CreatedById: '005CCC',
        LastModifiedDate: '2025-01-04T09:00:00.000Z'
    };

    const orderSelection = RecordGraph.selectFields(ORDER_DESCRIBE);
    const raw = []
        .concat(caseEvents)
        .concat(RecordGraph.eventsForRecord(orderRow, {
            objectType: 'Order', selection: orderSelection,
            parentLinks: RecordGraph.parentLinks(ORDER_DESCRIBE), depth: 1,
            reachedVia: { field: 'CaseId__c', direction: 'child', from: '500XX0000012345' }
        }))
        .concat(RecordGraph.eventsForRecord(accountRow, {
            objectType: 'Account',
            selection: { nameField: 'Name' }, parentLinks: [], depth: 1,
            reachedVia: { field: 'AccountId', direction: 'parent', from: '500XX0000012345' }
        }))
        .concat(history);

    const store = new Store.EventStore();
    store.ingest(raw);
    const structural = RecordGraph.relationshipsFor(store.all());

    assert.ok(structural.length >= 4, `expected structural edges, got ${structural.length}`);

    /*
     * Every one of them is confirmed. This is the property that distinguishes
     * a record graph from everything else the engine draws: the org holds the
     * link in a field, so there is nothing to infer.
     */
    structural.forEach((rel) => {
        assert.strictEqual(rel.confidence, 'CONFIRMED',
            'a lookup edge is a fact, not an inference');
        assert.strictEqual(rel.state, 'observed');
        assert.ok(rel.evidence.length && rel.evidence[0].detail,
            'and says which field it came from');
    });

    const caseToOrder = structural.filter((rel) => {
        const from = store.get(rel.sourceEventId);
        const to = store.get(rel.targetEventId);
        return from && to && from.entity.type === 'Case' && to.entity.type === 'Order' &&
               rel.relationshipType === 'PARENT_OF';
    })[0];
    assert.ok(caseToOrder, 'the Case is the parent of the Order it produced');
    assert.strictEqual(caseToOrder.lookupField, 'CaseId__c');
    assert.ok(/CaseId__c/.test(caseToOrder.evidence[0].detail),
        'and the evidence names the field: ' + caseToOrder.evidence[0].detail);

    /* A tracked change belongs to the record it changed. */
    const ownHistory = structural.filter((rel) => rel.rule === 'recordOwnHistory');
    assert.ok(ownHistory.length >= 2, 'changes hang off the record they changed');

    /* ------------------------------------------------------------------ */
    /* 5b. History is not culled for being old                             */
    /* ------------------------------------------------------------------ */

    /*
     * The store used to cull events older than seven days, by their own
     * timestamp. A record graph is almost entirely such events - the Account
     * was created last year - so they were accepted, counted as added, and
     * dropped inside the same call. The graph then showed only whatever had
     * happened in the last week, with nothing to say the rest had been
     * discarded.
     *
     * Asserted with a deliberately ancient record, because the failure only
     * appears once the data is older than the window and is invisible in any
     * fixture built around "now".
     */
    const ancient = new Store.EventStore();
    ancient.ingest(RecordGraph.eventsForRecord({
        Id: '001XX0000000009', Name: 'Acme Industries',
        CreatedDate: '2019-03-01T09:00:00.000Z', CreatedById: '005CCC',
        LastModifiedDate: '2019-03-01T09:00:00.000Z'
    }, { objectType: 'Account', selection: { nameField: 'Name' }, parentLinks: [] }));

    assert.strictEqual(ancient.all().length, 1,
        'a record created years ago is kept - it is what was asked for');
    assert.strictEqual(ancient.stats().dropped.retention, 0,
        'and nothing is dropped for being old');

    /* Capacity still bounds the store; it just sheds by interest, not by date. */
    const bounded = new Store.EventStore({ capacity: 5 });
    const many = [];
    for (let i = 0; i < 20; i++) {
        many.push({
            eventType: 'RECORD_CREATE', timestamp: '2019-03-0' + ((i % 8) + 1) + 'T09:00:00.000Z',
            source: { kind: 'salesforce' }, entity: { type: 'Account', id: 'old-' + i }
        });
    }
    bounded.ingest(many);
    assert.ok(bounded.all().length <= 5, 'capacity is still enforced');
    assert.ok(bounded.stats().dropped.capacity > 0, 'and reports what it shed');

    /* ------------------------------------------------------------------ */
    /* 6. Polymorphic lookups resolve by id, not by referenceTo[0]         */
    /* ------------------------------------------------------------------ */

    /*
     * Task.WhatId can point at an Account, a Case or an Order. Taking the
     * first entry of referenceTo would query Account for every Task whose
     * WhatId is an Order - a wrong query, returning nothing, silently.
     */
    const plan = RecordGraph.planHop({
        records: [{
            row: { Id: '00TXX0000000001', Subject: 'Call customer',
                   WhatId: '801XX0000000001' },
            describe: TASK_DESCRIBE
        }],
        prefixMap: prefixMap,
        seen: {}
    });

    const whatTarget = plan.parents.filter((p) => p.via.field === 'WhatId')[0];
    assert.ok(whatTarget, 'the polymorphic lookup is planned');
    assert.strictEqual(whatTarget.objectName, 'Order',
        'and resolves to what the id actually is, not to referenceTo[0] (Account)');

    /* ------------------------------------------------------------------ */
    /* 6b. Excluding objects, so a large org stays workable                */
    /* ------------------------------------------------------------------ */

    /*
     * A walk from an Account in a real org reaches thousands of Tasks and
     * EmailMessages, and the graph is unreadable long before it is slow. The
     * exclusion has to bite at planning, not at drawing: hiding an object
     * after the fact still costs the query that fetched it, and the objects
     * worth excluding are precisely the expensive ones.
     */
    const unfiltered = RecordGraph.planHop({
        records: [{ row: caseRow, describe: CASE_DESCRIBE }],
        prefixMap: prefixMap, seen: {}
    });
    assert.ok(unfiltered.children.some((c) => c.objectName === 'Order'),
        'Orders are followed by default');
    assert.ok(unfiltered.parents.some((p) => p.objectName === 'Account'),
        'and so is the Account');

    const filtered = RecordGraph.planHop({
        records: [{ row: caseRow, describe: CASE_DESCRIBE }],
        prefixMap: prefixMap, seen: {},
        excluded: ['Order', 'Account']
    });

    assert.ok(!filtered.children.some((c) => c.objectName === 'Order'),
        'an excluded child object is never queried');
    assert.ok(!filtered.parents.some((p) => p.objectName === 'Account'),
        'and neither is an excluded parent');
    assert.ok(filtered.parents.some((p) => p.objectName === 'Contact'),
        'while everything else is unaffected');

    /* And it says what it left out, so an exclusion is visible rather than
     * looking like a relationship that does not exist. */
    const skippedNames = filtered.skipped.map((s) => s.objectName);
    assert.ok(skippedNames.indexOf('Order') !== -1 && skippedNames.indexOf('Account') !== -1,
        'skipped objects are reported');
    assert.ok(filtered.skipped.every((s) => s.reason === 'excluded' || s.reason === 'budget'),
        'each with a reason');

    /*
     * Exclusions are applied before the relationship budget, not after.
     *
     * Taking the first N relationships and then dropping the excluded ones
     * meant excluding a noisy object did not make room for anything else -
     * the graph simply got smaller, which is the opposite of what the user
     * asked for.
     */
    const wide = describeOf('Wide', [{ name: 'Id', type: 'id' }], [
        { childSObject: 'Noise1', field: 'P', relationshipName: 'N1' },
        { childSObject: 'Noise2', field: 'P', relationshipName: 'N2' },
        { childSObject: 'Wanted', field: 'P', relationshipName: 'W' }
    ]);

    const budgeted = RecordGraph.planHop({
        records: [{ row: { Id: 'x' }, describe: wide }],
        prefixMap: prefixMap, seen: {},
        excluded: ['Noise1', 'Noise2'],
        maxChildRelations: 2
    });
    assert.ok(budgeted.children.some((c) => c.objectName === 'Wanted'),
        'excluding the noisy objects makes room for the wanted one');

    /* ------------------------------------------------------------------ */
    /* 6b2. Getting a dropped relationship back                            */
    /* ------------------------------------------------------------------ */

    /*
     * The budget picks the first few relationships by a sort order the user
     * did not choose. A standard object carries around a hundred, so the one
     * somebody actually came for can sit well past the limit - and reporting
     * "87 relationships not followed" with no way to reach any of them is a
     * dead end rather than a disclosure.
     *
     * Pinning is the way through: a named object is followed however long the
     * list, and the budget then applies to what is left.
     */
    const crowded = describeOf('Crowded', [{ name: 'Id', type: 'id' }], [
        { childSObject: 'AAA', field: 'P', relationshipName: 'A' },
        { childSObject: 'BBB', field: 'P', relationshipName: 'B' },
        { childSObject: 'CCC', field: 'P', relationshipName: 'C' },
        { childSObject: 'Wanted', field: 'P', relationshipName: 'W' },
        { childSObject: 'ZZZ', field: 'P', relationshipName: 'Z' }
    ]);

    const crowdedRow = [{ row: { Id: 'x' }, describe: crowded }];

    const capped = RecordGraph.planHop({
        records: crowdedRow, prefixMap: prefixMap, seen: {}, maxChildRelations: 2
    });
    assert.strictEqual(capped.children.length, 2, 'the budget is respected');
    assert.ok(!capped.children.some((c) => c.objectName === 'Wanted'),
        'and the object further down the list is dropped');
    assert.ok(capped.skipped.some((s) => s.objectName === 'Wanted' && s.reason === 'budget'),
        'reported as dropped for budget, not as excluded');

    const withPin = RecordGraph.planHop({
        records: crowdedRow, prefixMap: prefixMap, seen: {},
        maxChildRelations: 2, included: ['Wanted']
    });
    assert.ok(withPin.children.some((c) => c.objectName === 'Wanted'),
        'pinning follows it despite the budget');
    assert.strictEqual(withPin.children.length, 3,
        'and the budget still covers the rest, so a pin adds rather than replaces');
    assert.ok(withPin.children.filter((c) => c.objectName === 'Wanted')[0].pinned,
        'the pinned relationship is marked as such');
    assert.ok(!withPin.skipped.some((s) => s.objectName === 'Wanted'),
        'and is no longer reported as skipped');

    /*
     * Excluding and pinning the same object is a contradiction, and exclusion
     * wins: naming something to remove it is a stronger statement than naming
     * it to keep it. Without this the object's fate would depend on which list
     * happened to be read first.
     */
    const contradicted = RecordGraph.planHop({
        records: crowdedRow, prefixMap: prefixMap, seen: {},
        maxChildRelations: 5, excluded: ['Wanted'], included: ['Wanted']
    });
    assert.ok(!contradicted.children.some((c) => c.objectName === 'Wanted'),
        'exclusion beats pinning');
    assert.ok(contradicted.skipped.some((s) =>
        s.objectName === 'Wanted' && s.reason === 'excluded'),
        'and the reason given is the exclusion');

    /* The wholesale answer: raise the budget, or lift it entirely. */
    const everything = RecordGraph.planHop({
        records: crowdedRow, prefixMap: prefixMap, seen: {}, maxChildRelations: -1
    });
    assert.strictEqual(everything.children.length, 5, 'a negative budget follows them all');
    assert.strictEqual(everything.skipped.length, 0, 'and nothing is reported as dropped');

    /* ------------------------------------------------------------------ */
    /* 6c. The inventory is derived, never assumed                         */
    /* ------------------------------------------------------------------ */

    /*
     * Which object floods a graph is a fact about this org and this record.
     * A built-in list of "usually noisy" objects would be wrong for the org
     * whose business runs on them, so the list offered for exclusion is
     * counted from what the walk actually reached.
     */
    const inventoryStore = new Store.EventStore();
    inventoryStore.ingest(raw);
    const counted = RecordGraph.inventory(inventoryStore.all());

    const byName = {};
    counted.forEach((entry) => { byName[entry.name] = entry; });

    assert.ok(byName.Case && byName.Order && byName.Account,
        'every object reached is listed: ' + counted.map((c) => c.name).join(', '));
    assert.strictEqual(byName.Case.count, 1, 'one Case record');
    assert.ok(byName.Case.changes >= 2, 'with its tracked changes counted separately');

    /* Busiest first, so the object worth excluding needs no hunting for. */
    for (let i = 1; i < counted.length; i++) {
        if (counted[i - 1].excluded === counted[i].excluded) {
            assert.ok(counted[i - 1].count >= counted[i].count,
                'the inventory is ordered by how much of the graph each object is');
        }
    }

    /*
     * An object excluded before the walk contributes nothing, so it would not
     * appear in a count of what was found - and an exclusion you cannot see is
     * one you cannot undo. Listed at zero instead.
     */
    const withExcluded = RecordGraph.inventory(inventoryStore.all(),
        { excluded: ['EmailMessage', 'Order'] });
    const email = withExcluded.filter((e) => e.name === 'EmailMessage')[0];
    assert.ok(email, 'an object excluded before the walk is still listed');
    assert.strictEqual(email.count, 0, 'at zero');
    assert.strictEqual(email.excluded, true, 'and marked excluded');
    assert.strictEqual(withExcluded.filter((e) => e.name === 'Order')[0].excluded, true,
        'an object present but excluded is marked too');
    assert.ok(withExcluded[withExcluded.length - 1].excluded,
        'excluded objects sort to the end');

    /* ------------------------------------------------------------------ */
    /* 6d. Hiding is instant, without a re-walk                            */
    /* ------------------------------------------------------------------ */

    /*
     * The same exclusions apply when drawing, so unticking an object takes
     * effect immediately. Waiting for a re-walk to see the result of a
     * checkbox would make the control feel broken.
     */
    const drawn = Trace.filter(
        { nodes: inventoryStore.all(), edges: [], view: 'RECORD' },
        { excludeTypes: ['Order'] });

    assert.ok(!drawn.nodes.some((n) => n.entity && n.entity.type === 'Order'),
        'an excluded object is hidden from the drawing at once');
    assert.ok(drawn.nodes.some((n) => n.entity && n.entity.type === 'Case'),
        'and nothing else is');

    /* ------------------------------------------------------------------ */
    /* 7. The walk terminates                                              */
    /* ------------------------------------------------------------------ */

    /*
     * A Case whose parent Case lists it as a child is an ordinary org
     * structure and an infinite loop for a naive walk. Records already seen
     * are never planned again.
     */
    const seen = { '001XX0000000009': true };
    const guarded = RecordGraph.planHop({
        records: [{ row: caseRow, describe: CASE_DESCRIBE }],
        prefixMap: prefixMap,
        seen: seen
    });
    const plannedIds = guarded.parents.map((p) => p.recordId);
    assert.ok(plannedIds.indexOf('001XX0000000009') === -1,
        'a record already fetched is not fetched again');
    assert.ok(plannedIds.indexOf('003XX0000000007') !== -1,
        'but one not yet seen still is');

    /* ------------------------------------------------------------------ */
    /* 8. It all flows through the rest of the engine unchanged            */
    /* ------------------------------------------------------------------ */

    const correlated = Correlation.correlate(store.all(), {});
    const merged = Correlation.mergeRelationships(
        correlated.relationships.concat(structural));
    const graph = Trace.buildGraph(store.all(), merged);

    const built = Trace.buildTrace(graph, {
        kind: 'record', id: '500XX0000012345', view: 'RECORD', grouping: false
    });

    assert.ok(built.stats.shown >= 4,
        `the record graph reaches its relations, got ${built.stats.shown}`);
    assert.ok(built.layout.positions.length === built.graph.nodes.length,
        'every node is laid out');

    /*
     * A confirmed lookup edge must survive merging against anything the
     * correlation rules inferred about the same pair. The org's own answer
     * beats a proximity guess.
     */
    const lookupEdges = merged.filter((rel) =>
        rel.relationshipType === 'PARENT_OF' && rel.confidence === 'CONFIRMED');
    assert.ok(lookupEdges.length >= 2, 'lookup edges survive the merge');

    /*
     * The record walk reads the field off the row and the correlation engine
     * reads it off the event's metadata: two descriptions of one fact. They
     * now share a type and direction, so they collapse into a single edge
     * carrying both explanations rather than drawing two curves between the
     * same pair.
     */
    const bothSignals = lookupEdges.filter((rel) => {
        const signals = rel.evidence.map((item) => item.signal);
        return signals.indexOf('lookupField') !== -1 &&
               signals.indexOf('recordReference') !== -1;
    });
    assert.ok(bothSignals.length >= 1,
        'the two accounts of the same lookup merge into one edge, keeping both');

    /* And nothing is drawn twice between the same pair. */
    const pairs = {};
    merged.forEach((rel) => {
        const key = rel.sourceEventId + '->' + rel.targetEventId;
        pairs[key] = (pairs[key] || 0) + 1;
    });
    Object.keys(pairs).forEach((key) => {
        assert.ok(pairs[key] <= 2,
            'at most one structural and one sequence edge per pair, got ' + pairs[key]);
    });

    /* ------------------------------------------------------------------ */
    /* 8b. The tree lays out as a tree                                     */
    /* ------------------------------------------------------------------ */

    /*
     * Two bugs made a record graph render as a single flat column, and both
     * are the kind that look like a styling problem rather than a logic one.
     *
     * The correlation rule for record references emitted its edge child-to-
     * parent while the lookup rule emitted parent-to-child, so every related
     * pair had an arrow each way. With no node left at indegree zero the
     * layering had nowhere to start, and every node fell through to depth 0.
     */
    assert.ok(built.layout.columns > 1,
        'a parent and its children are not in the same column');

    /*
     * Keyed on each record's creation event, which is the node that represents
     * the record. Its later changes are separate nodes further right, so
     * keying on the record id alone lets a status change overwrite the column
     * of the record it belongs to.
     */
    const columnOf = {};
    built.layout.positions.forEach((item) => {
        if (item.node.eventType !== 'RECORD_CREATE') { return; }
        if (columnOf[item.node.entity.id] === undefined) {
            columnOf[item.node.entity.id] = item.column;
        }
    });
    assert.ok(columnOf['801XX0000000001'] > columnOf['500XX0000012345'],
        'the Order sits to the right of the Case it came from');
    assert.ok(columnOf['500XX0000012345'] > columnOf['001XX0000000009'],
        'and the Case to the right of its Account');

    /*
     * And the reference rule states a relationship between two records once,
     * not once per event either of them carries. The Case here has two tracked
     * changes; fanning the lookup across them produced three edges to the
     * Order where there is one lookup field.
     */
    const orderCreate = store.all().filter((e) =>
        e.entity.type === 'Order' && e.eventType === 'RECORD_CREATE')[0];
    const intoOrder = merged.filter((rel) => rel.targetEventId === orderCreate.eventId);
    const fromCase = intoOrder.filter((rel) => {
        const from = store.get(rel.sourceEventId);
        return from && from.entity.id === '500XX0000012345';
    });
    assert.strictEqual(fromCase.length, 1,
        'one edge from the Case to the Order, not one per event on the Case');

    /*
     * A cycle must degrade, not destroy. Orgs really do have them - a Case
     * whose parent Case references it back - and losing the layout for the
     * entire graph because of one loop is the worst possible response.
     */
    const cyclic = {
        nodes: [
            { eventId: 'a', timestamp: 3, entity: { id: 'A' }, category: 'SALESFORCE' },
            { eventId: 'b', timestamp: 1, entity: { id: 'B' }, category: 'SALESFORCE' },
            { eventId: 'c', timestamp: 2, entity: { id: 'C' }, category: 'SALESFORCE' }
        ],
        edges: [
            { relationshipId: 'ab', sourceEventId: 'a', targetEventId: 'b',
              relationshipType: 'PARENT_OF', confidence: 'CONFIRMED' },
            { relationshipId: 'bc', sourceEventId: 'b', targetEventId: 'c',
              relationshipType: 'PARENT_OF', confidence: 'CONFIRMED' },
            { relationshipId: 'ca', sourceEventId: 'c', targetEventId: 'a',
              relationshipType: 'PARENT_OF', confidence: 'CONFIRMED' }
        ]
    };

    const cyclicLayout = Trace.layout(cyclic);
    assert.strictEqual(cyclicLayout.positions.length, 3,
        'every node in a cycle is still placed');
    assert.ok(cyclicLayout.columns > 1,
        'and a cycle does not collapse the graph into one column');

    /* Following the Case now walks real lookups rather than timing. */
    const followed = Trace.follow(graph, { kind: 'record', id: '500XX0000012345' });
    const chain = followed.chain.map((link) => link.entity.type);
    assert.ok(chain.indexOf('Case') !== -1 && chain.indexOf('Order') !== -1,
        'following reaches the Order through its lookup: ' + chain.join(' → '));

    /*
     * And the timeline is real. A record lifecycle spans months, so replay
     * must compress the quiet stretches or it is a still picture - and must
     * mark where it did so rather than misrepresenting the elapsed time.
     */
    const script = Replay.buildScript(built.graph);
    assert.ok(script.realDuration > 7 * 24 * 60 * 60 * 1000,
        'the real span is over a year of record history');
    assert.ok(script.compressed && script.skips.length,
        'long quiet stretches are compressed');
    assert.ok(script.duration < script.realDuration,
        'so the replay is shorter than the real elapsed time');

    const end = Replay.stateAt(script, script.duration);
    assert.ok(end.finished && end.completed === script.nodes.length,
        'and it plays through to the end');

    console.log('event graph record graph test passed');
}

main();
