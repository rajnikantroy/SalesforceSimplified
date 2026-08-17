/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * The query an object actually gets, once the org has been asked about it.
 *
 * buildSpec reads the schema with digestSync, which only consults the cache.
 * On a first open there is nothing there, so the SELECT is assembled from
 * defaults - Id, Name, NamespacePrefix, LastModifiedBy.Name - and those
 * defaults are a guess about an object nobody has looked at yet.
 *
 * For whole families of objects the guess is wrong in every part. The
 * "Definition" objects are keyed by DurableId, labelled with DeveloperName,
 * and have no LastModifiedBy at all. The hand-written tables in the service
 * carry EntityDefinition and FieldDefinition only because someone hit those
 * two in person; AppDefinition, which is identical in shape, was never added
 * and produced exactly:
 *
 *   SELECT Id, Name, NamespacePrefix, LastModifiedBy.Name FROM AppDefinition
 *
 * The query engine prunes a bad guess before sending, which is why this was
 * never an error - but pruning can only remove. The columns the describe
 * would have chosen were never in the SELECT, and the id the rows are keyed
 * on was pruned away with the rest.
 *
 * So these assert the shape of the query for an object the tables have never
 * heard of, with and without the describe.
 */

const source = fs.readFileSync('./js/angular/services/DynamicMetadataService.js', 'utf8');
const schemaSource = fs.readFileSync('./js/angular/services/SchemaService.js', 'utf8');

/*
 * The real columnsFor, not a copy of it.
 *
 * A hand-written stub of this drifted immediately: it omitted the rules that
 * refuse reference types and *Id suffixes, so a field the shipped picker
 * rejects came through in the test and a mutation that dropped the curated
 * field list looked harmless. A stub of the thing under discussion is a
 * second implementation, and the two only have to agree by accident.
 */
function realColumnsFor() {
    const mod = { service(name, deps) { mod.factory = Array.isArray(deps) ? deps[deps.length - 1] : deps; } };
    const ctx = {
        window: { app: mod }, angular: { module: () => mod }, console,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        SS_ORIGIN: 'https://acme.my.salesforce.com',
        ssAuthReady: () => Promise.resolve(), ssSessionId: () => 'sid',
        ssDescribeUrl: (n) => '/d/' + n, ssToolingDescribeUrl: (n) => '/t/' + n,
        Date, JSON, Object, Promise
    };
    vm.createContext(ctx);
    vm.runInContext(schemaSource, ctx);
    const $q = Object.assign((fn) => new Promise(fn), { when: (v) => Promise.resolve(v), reject: (v) => Promise.reject(v) });
    const svc = new mod.factory(() => Promise.reject(), $q, Object.assign(() => ({}), { cancel: () => {} }));
    return svc.columnsFor.bind(svc);
}
const columnsFor = realColumnsFor();

/* AppDefinition as Salesforce really shapes it. */
const APP_DEFINITION_FIELDS = [
    { name: 'DurableId',       type: 'string',   label: 'Durable Id' },
    { name: 'DeveloperName',   type: 'string',   label: 'Developer Name' },
    { name: 'Label',           type: 'string',   label: 'Label' },
    { name: 'MasterLabel',     type: 'string',   label: 'Master Label' },
    { name: 'NamespacePrefix', type: 'string',   label: 'Namespace Prefix' },
    { name: 'UiType',          type: 'picklist', label: 'Ui Type' },
    { name: 'NavType',         type: 'picklist', label: 'Nav Type' },
    { name: 'Description',     type: 'textarea', label: 'Description' }
];

/* An ordinary object, to prove nothing changed for the common case. */
const APEX_CLASS_FIELDS = [
    { name: 'Id',              type: 'id',       label: 'Id' },
    { name: 'Name',            type: 'string',   label: 'Name' },
    { name: 'NamespacePrefix', type: 'string',   label: 'Namespace Prefix' },
    { name: 'Status',          type: 'picklist', label: 'Status' },
    { name: 'Body',            type: 'textarea', label: 'Body' }
];

function digestOf(name, fields, displayField, rels) {
    const set = {}, types = {}, labels = {};
    fields.forEach((f) => { set[f.name] = true; types[f.name] = f.type; labels[f.name] = f.label; });
    return {
        name, fields: set, types, labels, rels: rels || {},
        sortable: {}, filterable: {}, displayField, orderField: null
    };
}

function load(objects) {
    const moduleObj = { service(name, deps) { moduleObj.factory = Array.isArray(deps) ? deps[deps.length - 1] : deps; } };
    const context = {
        window: { app: moduleObj }, angular: { module: () => moduleObj }, console,
        localStorage: { getItem: () => null, setItem: () => {} },
        chrome: { runtime: { getURL: (p) => 'x' + p } },
        ssQueryUrl: () => '/q?q=', ssToolingQueryUrl: () => '/t?q=', ssOrgUrl: (p) => 'o' + (p || ''),
        escapeSoqlLiteral: (v) => String(v), readCookie: () => '',
        Date, JSON, Object, Promise
    };
    vm.createContext(context);
    vm.runInContext(source, context);

    // Nothing described yet; describe() is what flips each object on.
    const described = Object.create(null);
    const describeCalls = [];

    const SchemaService = {
        digestSync: (name) => described[name] || null,
        describe: (name) => {
            describeCalls.push(name);
            if (objects[name]) { described[name] = objects[name]; }
            return Promise.resolve(described[name] || null);
        },
        displayFieldOf: (d, preferred) => (d && d.displayField) ? d.displayField : (preferred || 'Name'),
        hasField: (d, f) => (d && d.fields) ? !!d.fields[f] : true,
        hasRelationship: (d, r) => (d && d.rels) ? !!d.rels[r] : true,
        globalDescribe: () => Promise.resolve({}),
        toolingDescribe: () => Promise.resolve({}),
        columnsFor: (d, max) => columnsFor(d, max)
    };

    const $q = Object.assign((fn) => new Promise(fn), {
        when: (v) => Promise.resolve(v), all: (list) => Promise.all(list)
    });

    const service = new moduleObj.factory(
        { get: async () => ({ sobjects: [] }), query: async () => ({ records: [] }) },
        $q, { id: '005x' }, SchemaService);

    return { service, describeCalls };
}

const fieldsOf = (soql) => /SELECT\s+([\s\S]*?)\s+FROM/i.exec(soql)[1].split(',').map((f) => f.trim());

async function main() {

    /* ------------------------------------------------------------------ */
    /* Before the describe: the guess, unchanged                           */
    /* ------------------------------------------------------------------ */

    const cold = load({ AppDefinition: digestOf('AppDefinition', APP_DEFINITION_FIELDS, 'DeveloperName') });
    const guessed = cold.service.buildSpec('AppDefinition', { label: 'App Definition' }, false, true);

    assert.deepStrictEqual(fieldsOf(guessed.queryForAll),
        ['Id', 'Name', 'NamespacePrefix', 'LastModifiedBy.Name'],
        'with nothing described, the defaults stand - this is the query that was reported');
    assert.deepStrictEqual(Array.from(guessed.columns || []), [],
        'and no columns, which is the visible tell that no describe was involved');

    /* ------------------------------------------------------------------ */
    /* After: the object's own fields                                      */
    /* ------------------------------------------------------------------ */

    const warm = load({ AppDefinition: digestOf('AppDefinition', APP_DEFINITION_FIELDS, 'DeveloperName') });
    const real = await warm.service.specWithSchema('AppDefinition', { label: 'App Definition' });
    const selected = fieldsOf(real.queryForAll);

    assert.deepStrictEqual(Array.from(warm.describeCalls), ['AppDefinition'],
        'the org is asked, once');

    assert.ok(selected.indexOf('Name') === -1,
        'Name is not selected on an object that has none: ' + selected.join(', '));
    assert.ok(!/LastModifiedBy/.test(real.queryForAll),
        'nor a LastModifiedBy relationship it does not have: ' + real.queryForAll);
    assert.ok(selected.indexOf('DeveloperName') !== -1,
        'the label column the describe named is selected instead');

    /*
     * The id, which is the part that matters beyond cosmetics. A pruned Id
     * leaves rows with nothing to key on, and selection, package.xml and the
     * watch list are all keyed on one.
     */
    assert.ok(selected.indexOf('DurableId') !== -1,
        'DurableId stands in for Id on an object that has no Id: ' + selected.join(', '));
    assert.ok(selected.indexOf('Id') === -1,
        'and Id itself is not asked for, since it would only be pruned');

    // Columns come from the describe, and the textarea stays out of the grid.
    const columnNames = Array.from(real.columns || [], (c) => c.field);
    assert.ok(columnNames.length > 0, 'the object contributes columns of its own');
    assert.ok(columnNames.indexOf('Description') === -1,
        'a textarea is not a grid column - it would carry the whole body of every row');

    /* ------------------------------------------------------------------ */
    /* An ordinary object is untouched                                     */
    /*                                                                     */
    /* The change has to be invisible where the defaults were already       */
    /* right, or it trades one family of broken objects for all the rest.   */
    /* ------------------------------------------------------------------ */

    const ordinary = load({
        ApexClass: digestOf('ApexClass', APEX_CLASS_FIELDS, 'Name', { LastModifiedBy: true })
    });
    const apex = await ordinary.service.specWithSchema('ApexClass', { label: 'Apex Classes' });
    const apexFields = fieldsOf(apex.queryForAll);

    assert.strictEqual(apexFields[0], 'Id', 'Id is still first where the object has one');
    assert.ok(apexFields.indexOf('Name') !== -1, 'and Name is still selected');
    assert.ok(apexFields.indexOf('Body') === -1,
        'while the source body is never selected, whatever else changes');

    /* ------------------------------------------------------------------ */
    /* Already described: no second request                                */
    /* ------------------------------------------------------------------ */

    const cached = load({ ApexClass: digestOf('ApexClass', APEX_CLASS_FIELDS, 'Name', {}) });
    await cached.service.specWithSchema('ApexClass', { label: 'Apex Classes' });
    const callsAfterFirst = cached.describeCalls.length;
    await cached.service.specWithSchema('ApexClass', { label: 'Apex Classes' });
    assert.strictEqual(cached.describeCalls.length, callsAfterFirst,
        'a second open costs no request - digestSync answers, and waiting again ' +
        'would put a describe in front of every list the user opens');

    /* ------------------------------------------------------------------ */
    /* A refused describe still returns a usable spec                      */
    /* ------------------------------------------------------------------ */

    const refused = load({});   // describe resolves null for everything
    const fallback = await refused.service.specWithSchema('Whatever', { label: 'Whatever' });
    assert.ok(fallback && fallback.queryForAll,
        'an object the org will not describe still gets a query rather than nothing');


    /* ------------------------------------------------------------------ */
    /* The "hasn't got one" tables yield to the org                        */
    /*                                                                     */
    /* NO_NAMESPACE_FIELD and NO_LAST_MODIFIED_FIELD exist to predict what */
    /* hasField and hasRelationship now know for certain. They list twenty */
    /* or so names out of the hundreds an org exposes, and they were only  */
    /* ever right about the objects somebody happened to hit. Where the    */
    /* describe has answered it must win, or an object stays permanently   */
    /* missing two columns it really has because of a line written for a   */
    /* different org.                                                       */
    /* ------------------------------------------------------------------ */

    // TabDefinition is named in both tables.
    const tabFields = [
        { name: 'Id',              type: 'id',     label: 'Id' },
        { name: 'Name',            type: 'string', label: 'Name' },
        { name: 'NamespacePrefix', type: 'string', label: 'Namespace Prefix' }
    ];
    const tabDigest = digestOf('TabDefinition', tabFields, 'Name', { LastModifiedBy: true });

    const untold = load({ TabDefinition: tabDigest });
    const guess = untold.service.buildSpec('TabDefinition', { label: 'Tabs' }, false, true);
    assert.ok(!/NamespacePrefix/.test(guess.queryForAll),
        'with nothing described the table still applies - it is the only thing there');

    const told = load({ TabDefinition: tabDigest });
    const known = await told.service.specWithSchema('TabDefinition', { label: 'Tabs' });
    assert.ok(/NamespacePrefix/.test(known.queryForAll),
        'once the org says the field exists, the table stops overruling it: ' + known.queryForAll);
    assert.ok(/LastModifiedBy\.Name/.test(known.queryForAll),
        'and the same for the relationship: ' + known.queryForAll);

    /* ------------------------------------------------------------------ */
    /* But a curated field list is a dependency list, not a guess          */
    /*                                                                     */
    /* Other parts of the panel read SobjectType, TableEnumOrId, LogLength */
    /* and Operation off these rows. Dropping the curated fields because   */
    /* the describe "knows better" would take those features with it, and  */
    /* silently - the column simply stops arriving.                        */
    /* ------------------------------------------------------------------ */

    /*
     * Document, whose curated list is "Id, Name, FolderId". FolderId is the
     * discriminator: it ends in Id, so the describe-driven picker refuses it
     * as a raw reference, and the generic path would never select it. If it
     * survives, the curated list was honoured; if it vanishes, it was not.
     *
     * A fixture built on Profile cannot show this - its curated list is
     * "Id, Name" and the generic path produces exactly that too, so the
     * assertion passes either way and proves nothing.
     */
    const documentFields = [
        { name: 'Id',       type: 'id',       label: 'Id' },
        { name: 'Name',     type: 'string',   label: 'Name' },
        { name: 'FolderId', type: 'reference', label: 'Folder Id' },
        { name: 'Type',     type: 'picklist', label: 'Type' }
    ];
    const curated = load({ Document: digestOf('Document', documentFields, 'Name', {}) });
    const document = await curated.service.specWithSchema('Document', { label: 'Documents' });
    const documentSelected = fieldsOf(document.queryForAll);

    assert.ok(documentSelected.indexOf('FolderId') !== -1,
        'a curated field the describe-driven picker refuses still reaches the query - ' +
        'other parts of the panel read these off the rows: ' + documentSelected.join(', '));
    assert.ok(documentSelected.indexOf('Type') !== -1,
        'and the object still gains columns of its own on top: ' + documentSelected.join(', '));


    /* ------------------------------------------------------------------ */
    /* Three columns, and not three timestamps                             */
    /*                                                                     */
    /* Five columns of describe-chosen data plus the row's own cells made   */
    /* the grid wider than a laptop window. Three is what a list is read     */
    /* for: when it was created, when it last moved, and what state it is    */
    /* in.                                                                  */
    /*                                                                     */
    /* The date cap is the part that is easy to get wrong. Ranked by type    */
    /* alone, an object carrying a close date and an expiry date sorts them  */
    /* level with the audit dates, and all three slots fill with timestamps  */
    /* - so the status column, the one people actually scan, never appears.  */
    /* ------------------------------------------------------------------ */

    const shape = (fields, display) => {
        const set = {}, types = {}, labels = {};
        fields.forEach(([n, t]) => { set[n] = true; types[n] = t; });
        return { fields: set, types, labels, rels: {}, sortable: {}, displayField: display };
    };

    const apexColumns = columnsFor(shape([
        ['Name', 'string'], ['Body', 'textarea'], ['ApiVersion', 'double'],
        ['Status', 'picklist'], ['IsValid', 'boolean'],
        ['CreatedDate', 'datetime'], ['LastModifiedDate', 'datetime']
    ], 'Name'), 3);

    assert.strictEqual(apexColumns.length, 3, 'three columns, not five');
    assert.deepStrictEqual(Array.from(apexColumns, (c) => c.field),
        ['CreatedDate', 'LastModifiedDate', 'Status'],
        'created, modified, then the column that says what state the row is in');

    /* An object with dates of its own must still reach its status column. */
    const busyDates = columnsFor(shape([
        ['Name', 'string'], ['Close_Date__c', 'date'], ['Expiry__c', 'date'],
        ['Stage__c', 'picklist'], ['Amount__c', 'currency'],
        ['CreatedDate', 'datetime'], ['LastModifiedDate', 'datetime']
    ], 'Name'), 3);

    const dateColumns = busyDates.filter((c) => c.type === 'date' || c.type === 'datetime');
    assert.strictEqual(dateColumns.length, 2,
        'at most two date columns, however many dates the object carries: ' +
        busyDates.map((c) => c.field).join(', '));
    assert.ok(busyDates.some((c) => c.type === 'picklist'),
        'so the status-ish column still gets a slot: ' + busyDates.map((c) => c.field).join(', '));
    assert.deepStrictEqual(Array.from(dateColumns, (c) => c.field),
        ['CreatedDate', 'LastModifiedDate'],
        'and the two are the audit dates, not whichever sorted first alphabetically');

    /* No dates at all is simply fewer columns, not padding with junk. */
    const noDates = columnsFor(shape([
        ['Name', 'string'], ['Type', 'picklist'], ['IsActive', 'boolean'],
        ['Description', 'textarea']
    ], 'Name'), 3);
    assert.ok(noDates.length <= 3 && noDates.length > 0, 'still bounded, still useful');
    assert.ok(!noDates.some((c) => c.field === 'Description'),
        'and a textarea is never a column, whatever room is left');

    console.log('schema-backed spec regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
