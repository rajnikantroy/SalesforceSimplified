/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * What a manifest has to carry with it.
 *
 * A package.xml that names a thing without naming what that thing points at
 * does not fail politely: a permission set granting access to a field the
 * target org has not got fails the whole deployment on that one line, and an
 * object retrieved without its fields produces a manifest that looks right
 * and is missing everything anyone wanted.
 *
 * Two things are checked here. That the right members come back, in the exact
 * string form a manifest expects - Object.Field, Object-Layout Name - because
 * a member spelt wrong fails a deployment just as completely as a member left
 * out. And that a query the org refuses contributes nothing rather than
 * taking the whole resolve down with it: most of these need "View Setup and
 * Configuration", which plenty of users do not have.
 */

const source = fs.readFileSync('./js/angular/services/PackageDependencyService.js', 'utf8');

const TOOLING_URL = 'https://example.my.salesforce.com/services/data/v62.0/tooling/query/?q=';

function makeService(responses, options) {
    const opts = options || {};
    const asked = [];

    const moduleObj = {
        service(name, deps) {
            moduleObj.factory = (typeof deps === 'function') ? deps : deps[deps.length - 1];
        }
    };
    const context = {
        window: { app: moduleObj },
        angular: { module: () => moduleObj },
        escapeSoqlLiteral: (v) => String(v || '').replace(/'/g, "\\'"),
        // A realistic endpoint, so assertions about which API a query went to
        // are testing the code rather than the stub's placeholder.
        ssToolingQueryUrl: () => TOOLING_URL,
        ssApiOrigin: () => 'https://example.my.salesforce.com',
        console
    };
    vm.createContext(context);
    vm.runInContext(source, context);

    const $q = Object.assign((fn) => new Promise(fn), {
        when: (v) => Promise.resolve(v),
        all: (list) => Promise.all(list),
        reject: (v) => Promise.reject(v)
    });

    // Pages, keyed by the nextRecordsUrl that leads to them, so a response can
    // be written as a chain the way Salesforce actually answers.
    const pages = opts.pages || {};
    const fetched = [];

    const sfdc = {
        query(soql, url) {
            asked.push({ soql, tooling: url === TOOLING_URL });
            if (opts.refuseAll) { return Promise.reject({ message: 'INSUFFICIENT_ACCESS' }); }
            for (const [pattern, records] of Object.entries(responses)) {
                if (soql.includes(pattern)) {
                    if (records === 'REFUSE') {
                        return Promise.reject({ message: 'INSUFFICIENT_ACCESS' });
                    }
                    return Promise.resolve(Array.isArray(records) ? { records } : records);
                }
            }
            return Promise.resolve({ records: [] });
        },
        get(url) {
            fetched.push(url);
            if (opts.referenceRows && url.indexOf('MetadataComponentDependency') !== -1) {
                return opts.referenceRows === 'REFUSE'
                    ? Promise.reject({ message: 'INSUFFICIENT_ACCESS' })
                    : Promise.resolve({ records: opts.referenceRows });
            }
            const page = pages[url];
            if (!page) { return Promise.reject({ message: 'NOT_FOUND' }); }
            return page === 'REFUSE' ? Promise.reject({ message: 'BOOM' }) : Promise.resolve(page);
        }
    };

    const metadataApi = {
        describeTypes: () => Promise.resolve(
            opts.describedTypes === undefined
                ? { CustomField: true, ApexClass: true, ApexPage: true, CustomObject: true,
                    Layout: true, RecordType: true, ValidationRule: true, WebLink: true,
                    CompactLayout: true, ListView: true, CustomPermission: true,
                    PermissionSet: true, Flow: true }
                : opts.describedTypes)
    };

    return { service: new moduleObj.factory(sfdc, $q, {}, metadataApi), asked, fetched };
}

// Array.from rebuilds these in this realm: the service runs inside a vm
// context, so its arrays carry a different Array.prototype and
// deepStrictEqual - which compares prototypes - fails on identical contents.
const names = (list) => Array.from(list, (m) => m.type + ':' + m.name).sort();

async function main() {

    /* ------------------------------------------------------------------ */
    /* An object brings its own parts                                      */
    /* ------------------------------------------------------------------ */

    const object = makeService({
        'FROM FieldDefinition':  [{ QualifiedApiName: 'Rating__c' }, { QualifiedApiName: 'Tier__c' }],
        'FROM Layout':           [{ Name: 'Account Layout' }],
        'FROM RecordType':       [{ DeveloperName: 'Partner' }],
        'FROM ValidationRule':   [{ ValidationName: 'Rating_Required' }],
        'FROM WebLink':          [{ Name: 'View_Portal' }],
        'FROM CompactLayout':    [{ DeveloperName: 'Account_Compact' }],
        'FROM ListView':         [{ DeveloperName: 'MyAccounts' }]
    });

    const parts = await object.service.forObject('Account');
    assert.deepStrictEqual(names(parts), [
        'CompactLayout:Account.Account_Compact',
        'CustomField:Account.Rating__c',
        'CustomField:Account.Tier__c',
        'Layout:Account-Account Layout',
        'ListView:Account.MyAccounts',
        'RecordType:Account.Partner',
        'ValidationRule:Account.Rating_Required',
        'WebLink:Account.View_Portal'
    ], 'an object should bring every part, in manifest member form');

    /*
     * The member forms are not interchangeable and a wrong one fails a
     * deployment exactly as hard as a missing one. A layout is joined with a
     * hyphen and keeps its spaces; everything else is dotted.
     */
    const layout = parts.find((m) => m.type === 'Layout');
    assert.strictEqual(layout.name, 'Account-Account Layout',
        'a layout member is Object-Layout Name, hyphenated, spaces intact');
    const field = parts.find((m) => m.type === 'CustomField');
    assert.ok(/^Account\./.test(field.name), 'a field member is Object.Field');

    // Fields, layouts and validation rules only exist in the Tooling API.
    const toolingQueries = object.asked.filter((a) => a.tooling).map((a) => a.soql);
    assert.ok(toolingQueries.some((q) => q.includes('FieldDefinition')),
        'fields must be asked of the Tooling API');
    assert.ok(toolingQueries.some((q) => q.includes('ValidationRule')),
        'validation rules must be asked of the Tooling API');

    /* ------------------------------------------------------------------ */
    /* A permission set brings everything it grants                        */
    /* ------------------------------------------------------------------ */

    const permset = makeService({
        'FROM ObjectPermissions': [{ SobjectType: 'Account' }, { SobjectType: 'Invoice__c' }],
        'FROM FieldPermissions':  [{ Field: 'Account.Rating__c' }],
        'FROM SetupEntityAccess': [
            { SetupEntityId: '01p001', SetupEntityType: 'ApexClass' },
            { SetupEntityId: '066001', SetupEntityType: 'ApexPage' },
            { SetupEntityId: '0PS001', SetupEntityType: 'CustomPermission' },
            // A type that does not belong in a manifest must be ignored.
            { SetupEntityId: '0TT001', SetupEntityType: 'TabSet' }
        ],
        'FROM ApexClass':        [{ Name: 'InvoiceService' }],
        'FROM ApexPage':         [{ Name: 'InvoiceView' }],
        'FROM CustomPermission': [{ DeveloperName: 'Approve_Invoice' }]
    });

    const granted = await permset.service.forPermissionSet('0PS000');
    assert.deepStrictEqual(names(granted), [
        'ApexClass:InvoiceService',
        'ApexPage:InvoiceView',
        'CustomField:Account.Rating__c',
        'CustomObject:Account',
        'CustomObject:Invoice__c',
        'CustomPermission:Approve_Invoice'
    ], 'a permission set should bring every object, field and setup entity it grants');

    // FieldPermissions.Field is already Object.Field - re-prefixing it would
    // produce Account.Account.Rating__c, which deploys as nothing.
    const grantedField = granted.find((m) => m.type === 'CustomField');
    assert.strictEqual(grantedField.name, 'Account.Rating__c',
        'a granted field is used as reported, not re-prefixed');

    assert.ok(!names(granted).some((n) => /TabSet/.test(n)),
        'setup entities that do not belong in a manifest must be skipped');

    /* ------------------------------------------------------------------ */
    /* A group brings its sets, and what those sets grant                  */
    /* ------------------------------------------------------------------ */

    const group = makeService({
        'FROM PermissionSetGroupComponent': [
            { PermissionSetId: '0PS100', PermissionSet: { Name: 'Invoice_Access' } }
        ],
        'FROM ObjectPermissions': [{ SobjectType: 'Invoice__c' }],
        'FROM FieldPermissions':  [{ Field: 'Invoice__c.Total__c' }]
    });

    const groupDeps = await group.service.forPermissionSetGroup('0PG000');
    assert.deepStrictEqual(names(groupDeps), [
        'CustomField:Invoice__c.Total__c',
        'CustomObject:Invoice__c',
        'PermissionSet:Invoice_Access'
    ], 'a group brings its member sets and, through them, what those grant');

    /* ------------------------------------------------------------------ */
    /* A profile resolves through the set Salesforce owns for it           */
    /* ------------------------------------------------------------------ */

    const profile = makeService({
        'IsOwnedByProfile':       [{ Id: '0PS900' }],
        'FROM ObjectPermissions': [{ SobjectType: 'Lead' }],
        'FROM FieldPermissions':  []
    });

    const profileDeps = await profile.service.forProfile('00e000');
    assert.deepStrictEqual(names(profileDeps), ['CustomObject:Lead'],
        'a profile resolves through its owned permission set');

    const ownedQuery = profile.asked.find((a) => a.soql.includes('IsOwnedByProfile'));
    assert.ok(ownedQuery && ownedQuery.soql.includes('ProfileId'),
        'the owned set must be found by profile id, not guessed');

    /* ------------------------------------------------------------------ */
    /* A refused query costs its own section, and nothing else             */
    /*                                                                     */
    /* Most of these need "View Setup and Configuration". Without it the    */
    /* resolve has to degrade to what the user can see - a manifest missing */
    /* one section beats a dialog that only ever shows an error.            */
    /* ------------------------------------------------------------------ */

    const partial = makeService({
        'FROM FieldDefinition': 'REFUSE',
        'FROM ValidationRule':  'REFUSE',
        'FROM Layout':          [{ Name: 'Account Layout' }],
        'FROM RecordType':      [{ DeveloperName: 'Partner' }]
    });

    const survived = await partial.service.forObject('Account');
    assert.deepStrictEqual(names(survived),
        ['Layout:Account-Account Layout', 'RecordType:Account.Partner'],
        'the readable parts must survive a refusal of the unreadable ones');

    const refusedAll = makeService({}, { refuseAll: true });
    assert.deepStrictEqual(Array.from(await refusedAll.service.forObject('Account')), [],
        'an org that refuses everything yields an empty list, not a rejection');
    assert.deepStrictEqual(Array.from(await refusedAll.service.forPermissionSet('0PS000')), [],
        'and the same for a permission set');

    /* ------------------------------------------------------------------ */
    /* Nothing is offered twice, and unknown types offer nothing           */
    /* ------------------------------------------------------------------ */

    const duplicated = makeService({
        'FROM ObjectPermissions': [{ SobjectType: 'Account' }, { SobjectType: 'Account' }],
        'FROM FieldPermissions':  [{ Field: 'Account.Rating__c' }, { Field: 'Account.Rating__c' }]
    });
    const once = await duplicated.service.forPermissionSet('0PS000');
    assert.strictEqual(once.length, 2, 'the same member must not be offered twice');

    const nothing = makeService({});
    assert.deepStrictEqual(Array.from(await nothing.service.resolve('ApexClass', { Id: '01p' })), [],
        'a type with no dependencies resolves to an empty list, not an error');
    assert.deepStrictEqual(Array.from(await nothing.service.resolve(null, null)), [],
        'a missing selection resolves to an empty list');

    /* ------------------------------------------------------------------ */
    /* Which selections are worth prompting about                          */
    /* ------------------------------------------------------------------ */

    const svc = nothing.service;
    ['CustomObject', 'PermissionSet', 'PermissionSetGroup', 'Profile'].forEach(function (type) {
        assert.strictEqual(svc.hasDependencies(type), true, type + ' should offer dependencies');
    });
    ['ApexClass', 'ApexTrigger', 'Flow', 'CustomLabel'].forEach(function (type) {
        assert.strictEqual(svc.hasDependencies(type), false, type + ' should not prompt');
    });

    /*
     * The object list and the custom metadata list both report their rows as
     * EntityDefinition, so a manifest built from either would carry the bare
     * object and none of its parts if only the CustomObject spelling counted.
     */
    const entityDef = makeService({
        'FROM FieldDefinition': [{ QualifiedApiName: 'Total__c' }]
    });
    assert.strictEqual(svc.hasDependencies('EntityDefinition'), true,
        'EntityDefinition is an object by another name and must offer its parts');
    const mdt = await entityDef.service.resolve('EntityDefinition', { QualifiedApiName: 'Invoice__mdt' });
    assert.deepStrictEqual(names(mdt), ['CustomField:Invoice__mdt.Total__c'],
        'an EntityDefinition resolves through the object path');
    assert.ok(entityDef.asked.some((a) => a.soql.includes('Invoice__mdt')),
        'the object is asked about by the API name it was given');

    /* ------------------------------------------------------------------ */
    /* A result that spans pages                                           */
    /*                                                                     */
    /* Salesforce answers 2,000 rows at a time. A permission set granting   */
    /* field access across a large org runs well past that, and stopping at */
    /* the boundary yields the worst kind of wrong manifest: one that looks */
    /* complete and deploys cleanly with pieces quietly missing.           */
    /* ------------------------------------------------------------------ */

    const ORIGIN = 'https://example.my.salesforce.com';
    const paged = makeService({
        'FROM FieldPermissions': {
            records: [{ Field: 'Account.One__c' }],
            nextRecordsUrl: '/services/data/v62.0/query/01g-2000'
        }
    }, {
        pages: {
            [ORIGIN + '/services/data/v62.0/query/01g-2000']: {
                records: [{ Field: 'Account.Two__c' }],
                nextRecordsUrl: '/services/data/v62.0/query/01g-4000'
            },
            [ORIGIN + '/services/data/v62.0/query/01g-4000']: {
                records: [{ Field: 'Account.Three__c' }]
            }
        }
    });

    const allPages = await paged.service.forPermissionSet('0PS000');
    assert.deepStrictEqual(names(allPages), [
        'CustomField:Account.One__c',
        'CustomField:Account.Three__c',
        'CustomField:Account.Two__c'
    ], 'every page of a result contributes its members');

    // A relative nextRecordsUrl is a path, and has to be resolved against the
    // org's origin before it can be fetched at all.
    assert.ok(paged.fetched.every((u) => u.startsWith(ORIGIN)),
        'a relative nextRecordsUrl is resolved against the org origin');

    // An absolute one is left alone rather than having the origin doubled up.
    const absolute = makeService({
        'FROM ObjectPermissions': {
            records: [{ SobjectType: 'Account' }],
            nextRecordsUrl: ORIGIN + '/services/data/v62.0/query/01g-2000'
        }
    }, {
        pages: { [ORIGIN + '/services/data/v62.0/query/01g-2000']: { records: [{ SobjectType: 'Lead' }] } }
    });
    const both = await absolute.service.forPermissionSet('0PS000');
    assert.ok(names(both).includes('CustomObject:Lead'),
        'an absolute nextRecordsUrl is followed as given');

    // A page that fails keeps the pages that worked - fewer members than the
    // org has still beats none.
    const brokenPage = makeService({
        'FROM ObjectPermissions': {
            records: [{ SobjectType: 'Account' }],
            nextRecordsUrl: '/services/data/v62.0/query/01g-2000'
        }
    }, { pages: { [ORIGIN + '/services/data/v62.0/query/01g-2000']: 'REFUSE' } });
    assert.deepStrictEqual(names(await brokenPage.service.forPermissionSet('0PS000')),
        ['CustomObject:Account'],
        'a failed page keeps what the earlier pages returned');

    // A single-page answer must not go looking for a second one.
    const singlePage = makeService({ 'FROM ObjectPermissions': [{ SobjectType: 'Account' }] });
    await singlePage.service.forPermissionSet('0PS000');
    assert.strictEqual(singlePage.fetched.length, 0,
        'a result with no nextRecordsUrl is not paged');

    /* ------------------------------------------------------------------ */
    /* A whole selection, resolved a few at a time                         */
    /*                                                                     */
    /* Each object costs seven queries. Fifty ticked objects resolved all   */
    /* at once is 350 requests in flight, which Chrome queues six-per-host  */
    /* and the org counts every one of against the API limit - the manifest */
    /* failing for reasons that have nothing to do with what was in it.     */
    /* ------------------------------------------------------------------ */

    let inFlight = 0;
    let peak = 0;
    const slow = makeService({});
    const realResolve = slow.service.resolve;
    slow.service.resolve = function (type, record) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        return realResolve.call(slow.service, type, record).then((r) => {
            inFlight--;
            return r;
        });
    };

    const many = [];
    for (let i = 0; i < 20; i++) {
        many.push({ type: 'CustomObject', record: { QualifiedApiName: 'Obj' + i + '__c' } });
    }

    const progress = [];
    await slow.service.resolveAll(many, (done, total) => progress.push([done, total]));

    assert.ok(peak > 0 && peak <= 4,
        'no more than four selections resolve at once, got a peak of ' + peak);
    assert.strictEqual(progress[progress.length - 1][0], 20,
        'progress finishes at the number of selections');
    assert.strictEqual(progress[0][0], 0,
        'progress is reported before any work is done, so the panel starts at 0');
    assert.ok(progress.every(([, total]) => total === 20),
        'the total stays the count of selections worth scanning');

    // Every selection is actually visited - a concurrency limiter that drops
    // the tail would be the quietest possible way to lose components.
    const askedObjects = new Set(
        slow.asked.map((a) => (a.soql.match(/Obj\d+__c/) || [])[0]).filter(Boolean)
    );
    assert.strictEqual(askedObjects.size, 20, 'every selection is resolved, none dropped');

    // Selections with nothing to contribute are not counted in the total, or
    // the panel would report progress against work it never intended to do.
    const mixed = makeService({});
    const seenTotals = [];
    await mixed.service.resolveAll([
        { type: 'ApexClass', record: { Id: '01p' } },
        { type: 'CustomObject', record: { QualifiedApiName: 'Account' } }
    ], (done, total) => seenTotals.push(total));
    assert.ok(seenTotals.every((t) => t === 1),
        'only selections that have dependencies count toward the total');

    assert.deepStrictEqual(Array.from(await mixed.service.resolveAll([], null)), [],
        'an empty selection resolves to nothing without asking the org');
    assert.deepStrictEqual(
        Array.from(await mixed.service.resolveAll([{ type: 'ApexClass', record: {} }], null)), [],
        'a selection with no dependencies resolves to nothing');

    // Two selections owing the same component name it once between them.
    const shared = makeService({
        'FROM ObjectPermissions': [{ SobjectType: 'Account' }]
    });
    const overlapping = await shared.service.resolveAll([
        { type: 'PermissionSet', record: { Id: '0PS001' } },
        { type: 'PermissionSet', record: { Id: '0PS002' } }
    ], null);
    assert.strictEqual(
        names(overlapping).filter((n) => n === 'CustomObject:Account').length, 1,
        'a component owed by two selections appears once');

    /* ------------------------------------------------------------------ */
    /* A grant too large for one URL                                       */
    /*                                                                     */
    /* These go out as GET with the SOQL in the query string, and a         */
    /* permission set granting a thousand Apex classes builds a 23KB URL -  */
    /* past what Salesforce accepts. The request fails, ask() turns that    */
    /* into an empty list, and every granted class vanishes silently.       */
    /* ------------------------------------------------------------------ */

    const grants = [];
    for (let i = 0; i < 450; i++) {
        grants.push({ SetupEntityId: '01p' + String(i).padStart(15, '0'), SetupEntityType: 'ApexClass' });
    }
    const classNames = grants.map((_, i) => ({ Name: 'Class' + i }));

    const huge = makeService({
        'FROM SetupEntityAccess': grants,
        'FROM ApexClass': classNames
    });
    await huge.service.forPermissionSet('0PS000');

    const classQueries = huge.asked.filter((a) => a.soql.includes('FROM ApexClass'));
    assert.ok(classQueries.length > 1,
        'a grant larger than one batch is split across several queries');

    for (const q of classQueries) {
        const idCount = (q.soql.match(/'01p/g) || []).length;
        assert.ok(idCount <= 200, 'no query carries more than 200 ids, saw ' + idCount);

        // The property that actually matters is the length of the URL that
        // gets sent, not the count - so assert against that directly.
        const url = 'https://x.my.salesforce.com/services/data/v62.0/query/?q=' +
                    encodeURIComponent(q.soql);
        assert.ok(url.length < 16384,
            'the encoded URL stays inside the limit, saw ' + url.length);
    }

    // Splitting must not lose the tail: 450 ids in batches of 200 is 200, 200
    // and 50, and an off-by-one in the chunker drops the last batch entirely.
    const askedIds = new Set();
    classQueries.forEach((q) => (q.soql.match(/'01p\d+'/g) || []).forEach((id) => askedIds.add(id)));
    assert.strictEqual(askedIds.size, 450, 'every granted id is asked about across the batches');

    /* ------------------------------------------------------------------ */
    /* Answers are remembered                                              */
    /*                                                                     */
    /* The panel rescans on every selection change, so without a cache      */
    /* ticking rows one at a time is quadratic - the fiftieth tick would    */
    /* re-resolve the forty-nine before it.                                */
    /* ------------------------------------------------------------------ */

    const cached = makeService({ 'FROM FieldDefinition': [{ QualifiedApiName: 'Rating__c' }] });
    const sel = [{ type: 'CustomObject', record: { QualifiedApiName: 'Account' } }];

    const first = await cached.service.resolveAll(sel, null);
    const afterFirst = cached.asked.length;
    assert.ok(afterFirst > 0, 'the first scan asks the org');

    const second = await cached.service.resolveAll(sel, null);
    assert.strictEqual(cached.asked.length, afterFirst,
        'rescanning the same selection asks the org nothing further');
    assert.deepStrictEqual(names(second), names(first),
        'the remembered answer is the same answer');

    // A different selection is still resolved - a cache keyed too loosely
    // would hand back Account's fields for every object.
    await cached.service.resolveAll(
        [{ type: 'CustomObject', record: { QualifiedApiName: 'Contact' } }], null);
    assert.ok(cached.asked.length > afterFirst, 'a selection not seen before is resolved');
    assert.ok(cached.asked.some((a) => a.soql.includes('Contact')),
        'and it is asked about by its own name');

    // Same name, different type: a permission set and an object may not share
    // an entry, or ticking both would give one of them the other's answer.
    const twoTypes = makeService({});
    await twoTypes.service.resolve('CustomObject', { Id: 'X1' });
    await twoTypes.service.resolve('PermissionSet', { Id: 'X1' });
    assert.ok(twoTypes.asked.some((a) => a.soql.includes('ObjectPermissions')),
        'the same identity under a different type is resolved separately');

    // Switching the checkbox off and on clears it, which is the only way to
    // pick up metadata added since without reloading the page.
    cached.service.clearCache();
    const beforeClear = cached.asked.length;
    await cached.service.resolveAll(sel, null);
    assert.ok(cached.asked.length > beforeClear, 'clearCache makes the next scan ask again');

    /* ------------------------------------------------------------------ */
    /* Components that belong to somebody else's package                   */
    /*                                                                     */
    /* A managed component is not the user's to retrieve, and the Metadata  */
    /* API does not refuse - it returns a zip with the component missing.   */
    /* That is the failure that looks most like success, so it has to be    */
    /* said before the retrieve rather than discovered after it.            */
    /* ------------------------------------------------------------------ */

    const ns = makeService({ 'FROM Organization': [{ NamespacePrefix: null }] });

    const nsOf = (name) => ns.service.namespaceOf({ name });
    assert.strictEqual(nsOf('npsp__Household__c'), 'npsp', 'a namespaced object is spotted');
    assert.strictEqual(nsOf('Rating__c'), null, 'a local custom field is not a namespace');
    assert.strictEqual(nsOf('Account'), null, 'a standard object has no namespace');
    assert.strictEqual(nsOf('Account.Rating__c'), null, 'a local field on a local object');
    assert.strictEqual(nsOf('npsp__Household__c.npsp__Amount__c'), 'npsp',
        'a field on a managed object');

    // Either half of an object-scoped member can be the managed one: a local
    // permission set may grant access to a managed package's field, and a
    // managed field may hang off a standard object.
    assert.strictEqual(nsOf('Account.npsp__Amount__c'), 'npsp',
        'a managed field on a standard object is spotted');
    assert.strictEqual(nsOf('npsp__Household__c-Household Layout'), 'npsp',
        'a layout on a managed object is spotted, hyphen separator and all');

    // The org's own answer beats anything inferred from the name.
    assert.strictEqual(ns.service.namespaceOf({ name: 'BatchJob', namespace: 'npsp' }), 'npsp',
        'a namespace the org reported is used even when the name hides it');
    assert.strictEqual(ns.service.namespaceOf({ name: 'X', NamespacePrefix: 'FinServ' }), 'FinServ',
        'a record carrying NamespacePrefix is taken at its word');
    assert.strictEqual(ns.service.namespaceOf({ name: 'X', NamespacePrefix: 'null' }), null,
        "the string 'null' is not a namespace");

    /*
     * An org with no namespace of its own - the ordinary case - so every
     * namespace seen belongs to somebody else.
     */
    const plain = makeService({ 'FROM Organization': [{ NamespacePrefix: null }] });
    const summary = await plain.service.summariseManaged([
        { name: 'Account.Rating__c' },
        { name: 'npsp__Household__c' },
        { name: 'npsp__Household__c.npsp__Amount__c' },
        { name: 'FinServ__Client__c' }
    ]);
    assert.strictEqual(summary.count, 3, 'every managed component is counted');
    assert.deepStrictEqual(Array.from(summary.namespaces), ['FinServ', 'npsp'],
        'the namespaces are named, sorted, and listed once each');

    /*
     * A packaging org. Its own components carry its namespace and retrieve
     * perfectly well - warning about those would cry wolf at the one org
     * where every component looks managed.
     */
    const packaging = makeService({ 'FROM Organization': [{ NamespacePrefix: 'acme' }] });
    const ownSummary = await packaging.service.summariseManaged([
        { name: 'acme__Widget__c' },
        { name: 'acme__Widget__c.acme__Size__c' },
        { name: 'npsp__Household__c' }
    ]);
    assert.strictEqual(ownSummary.count, 1, "the org's own namespace is not somebody else's");
    assert.deepStrictEqual(Array.from(ownSummary.namespaces), ['npsp'],
        'only foreign namespaces are named');
    assert.strictEqual(ownSummary.orgNamespace, 'acme', 'the org namespace is reported back');

    // Asked once, however many times it is needed.
    const before = packaging.asked.filter((a) => a.soql.includes('FROM Organization')).length;
    await packaging.service.summariseManaged([{ name: 'npsp__X__c' }]);
    assert.strictEqual(
        packaging.asked.filter((a) => a.soql.includes('FROM Organization')).length, before,
        'the org namespace is asked for once and remembered');

    // An org that will not answer must not produce a warning it cannot stand
    // behind - silence beats crying wolf.
    const noAnswer = makeService({ 'FROM Organization': 'REFUSE' });
    const unknown = await noAnswer.service.summariseManaged([{ name: 'npsp__Household__c' }]);
    assert.strictEqual(unknown.orgNamespace, null,
        'an org that will not say still resolves, treating its namespace as none');
    assert.strictEqual(unknown.count, 1, 'and foreign namespaces are still counted');

    assert.strictEqual((await plain.service.summariseManaged([])).count, 0,
        'an empty manifest has nothing managed in it');

    /*
     * A managed Apex class is the case the name cannot reveal: npsp__BatchJob
     * splits exactly like Rating__c does. The org is asked for
     * NamespacePrefix directly, and the member is named with it - without
     * that prefix the member does not exist in any org.
     */
    const managedClass = makeService({
        'FROM SetupEntityAccess': [{ SetupEntityId: '01p001', SetupEntityType: 'ApexClass' }],
        'FROM ApexClass': [{ Name: 'BatchJob', NamespacePrefix: 'npsp' }]
    });
    const classMembers = await managedClass.service.forPermissionSet('0PS000');
    assert.deepStrictEqual(names(classMembers), ['ApexClass:npsp__BatchJob'],
        'a managed class is named with its namespace, as the manifest needs it');
    assert.strictEqual(managedClass.service.namespaceOf(classMembers[0]), 'npsp',
        'and it is known to be managed without having to guess from the name');
    assert.ok(managedClass.asked.some((a) => /SELECT Name, NamespacePrefix FROM ApexClass/.test(a.soql)),
        'the namespace column is actually asked for');

    /* ------------------------------------------------------------------ */
    /* What a component references                                         */
    /*                                                                     */
    /* A different question from everything above: not what belongs to a    */
    /* thing, but what it points at - the fields an Apex class reads, the   */
    /* objects a Flow touches. These are the dependencies that fail a       */
    /* deployment without appearing anywhere in the component selected.     */
    /* ------------------------------------------------------------------ */

    const refs = makeService({}, { referenceRows: [
        { RefMetadataComponentName: 'Account.Rating__c', RefMetadataComponentType: 'CustomField' },
        { RefMetadataComponentName: 'InvoiceService', RefMetadataComponentType: 'ApexClass' },
        // Namespaced: the member must carry the prefix or it resolves to nothing.
        { RefMetadataComponentName: 'BatchJob', RefMetadataComponentType: 'ApexClass',
          RefMetadataComponentNamespace: 'npsp' },
        // Every reference to a standard object is true and useless in a manifest.
        { RefMetadataComponentName: 'Account', RefMetadataComponentType: 'StandardEntity' },
        // A field with no object cannot be named as a member at all.
        { RefMetadataComponentName: 'Rating__c', RefMetadataComponentType: 'CustomField' },
        { RefMetadataComponentName: '', RefMetadataComponentType: 'ApexPage' }
    ] });

    const referenced = await refs.service.forReferences(['01p001', '0Rb001']);
    assert.deepStrictEqual(names(referenced), [
        'ApexClass:InvoiceService',
        'ApexClass:npsp__BatchJob',
        'CustomField:Account.Rating__c'
    ], 'only references that can be named as manifest members come back');

    assert.ok(!names(referenced).some((n) => /StandardEntity|^CustomField:Rating__c$/.test(n)),
        'standard entities and object-less fields are left out');

    /*
     * The one that reached a real manifest: a Flow references a User, and
     * emitted as-is that produced <name>User</name>. There is no User metadata
     * type, so the block fails the whole retrieve - one bad reference costing
     * the entire package.
     */
    const withUser = makeService({}, { referenceRows: [
        { RefMetadataComponentName: 'User', RefMetadataComponentType: 'User' },
        { RefMetadataComponentName: 'Account.Rating__c', RefMetadataComponentType: 'CustomField' }
    ] });
    assert.deepStrictEqual(names(await withUser.service.forReferences(['01p001'])),
        ['CustomField:Account.Rating__c'],
        'a reference to a type the org does not deploy never reaches the manifest');

    /*
     * The org decides what is deployable, not a list kept in this repository -
     * such a list is wrong the moment Salesforce adds a type. A type the org
     * reports is accepted even though nothing here has heard of it.
     */
    const orgKnows = makeService({}, {
        describedTypes: { GenAiPlugin: true },
        referenceRows: [{ RefMetadataComponentName: 'Draft', RefMetadataComponentType: 'GenAiPlugin' }]
    });
    assert.deepStrictEqual(names(await orgKnows.service.forReferences(['01p001'])),
        ['GenAiPlugin:Draft'],
        'a type this code has never heard of is deployable if the org says so');

    /*
     * When the org will not answer - describeMetadata needs a permission -
     * the fallback is what this service already knows to be deployable.
     * Allowing everything would reinstate the bug; allowing nothing would
     * throw the feature away over a permission.
     */
    const noDescribe = makeService({}, {
        describedTypes: null,
        referenceRows: [
            { RefMetadataComponentName: 'User', RefMetadataComponentType: 'User' },
            { RefMetadataComponentName: 'Account.Rating__c', RefMetadataComponentType: 'CustomField' },
            { RefMetadataComponentName: 'Draft', RefMetadataComponentType: 'GenAiPlugin' }
        ]
    });
    assert.deepStrictEqual(names(await noDescribe.service.forReferences(['01p001'])),
        ['CustomField:Account.Rating__c'],
        'without the org answering, only types this service already emits are kept');
    assert.strictEqual(refs.service.namespaceOf(referenced.find((m) => /npsp/.test(m.name))), 'npsp',
        'a namespaced reference is known to be managed');

    /*
     * Sent through sfdc.get rather than sfdc.query: smartQuery appends a
     * LIMIT, strips relationship ORDER BY and drops fields an org has
     * rejected before, and MetadataComponentDependency refuses several of
     * those rewrites.
     */
    const raw = refs.fetched.filter((u) => u.indexOf('MetadataComponentDependency') !== -1);
    assert.strictEqual(raw.length, 1, 'the reference query goes out once for both ids');
    assert.ok(!refs.asked.some((a) => a.soql.indexOf('MetadataComponentDependency') !== -1),
        'and never through the rewriting query path');
    assert.ok(raw[0].indexOf('/tooling/') !== -1, 'against the Tooling API');
    assert.ok(decodeURIComponent(raw[0]).indexOf("MetadataComponentId IN ('01p001','0Rb001')") !== -1,
        'filtered by the ids of the components selected');

    // Ids are chunked exactly as the setup-entity lookup is, for the same
    // reason: the query travels in a URL.
    const manyIds = [];
    for (let i = 0; i < 450; i++) { manyIds.push('01p' + String(i).padStart(15, '0')); }
    const chunked = makeService({}, { referenceRows: [] });
    await chunked.service.forReferences(manyIds);
    const refQueries = chunked.fetched.filter((u) => u.indexOf('MetadataComponentDependency') !== -1);
    assert.ok(refQueries.length > 1, '450 ids are split across queries');
    refQueries.forEach((u) => assert.ok(u.length < 16384,
        'each reference query stays inside the URL limit, saw ' + u.length));

    // No permission is the ordinary case for this object, and costs nothing else.
    const refused = makeService({}, { referenceRows: 'REFUSE' });
    assert.deepStrictEqual(Array.from(await refused.service.forReferences(['01p001'])), [],
        'an org that refuses the dependency API contributes nothing, not an error');

    assert.deepStrictEqual(Array.from(await refs.service.forReferences([])), [],
        'nothing selected asks the org nothing');

    /* ------------------------------------------------------------------ */
    /* SOQL values are escaped                                             */
    /* ------------------------------------------------------------------ */

    const quoted = makeService({});
    await quoted.service.forObject("O'Brien__c");
    const unescaped = quoted.asked.filter((a) => /=\s*'O'Brien__c'/.test(a.soql));
    assert.strictEqual(unescaped.length, 0,
        "an object name containing a quote must not break out of its literal");

    console.log('package dependency regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
