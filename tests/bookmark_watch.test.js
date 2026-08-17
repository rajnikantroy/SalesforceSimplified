/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * Watching a handful of components.
 *
 * The promise this makes is narrow and has to stay true: these components
 * changed, this is who changed them, and nothing else did. Every failure mode
 * here produces a lie rather than an error - a refused query that reads as a
 * deletion, an edit announced twice, a component reported as changed the first
 * time it is ever checked. None of those look broken on screen.
 *
 * So what is asserted is behaviour, run against the shipped service. A
 * substring check in this project once passed against a different function
 * that happened to contain the same expression while the real one was never
 * touched at all.
 */

const source = fs.readFileSync('./js/angular/services/BookmarkService.js', 'utf8');

function load(options) {
    const opts = options || {};
    const store = opts.store || {};
    const asked = [];

    const moduleObj = { service(name, factory) { moduleObj.factory = factory; } };
    const context = {
        window: { app: moduleObj },
        angular: { module: () => moduleObj },
        localStorage: {
            getItem: (key) => {
                // Reading can fail independently of writing - storage disabled
                // by policy refuses both, and a quota only bites on write. A
                // harness that only models the write leaves every catch on the
                // read path untested.
                if (opts.readFails) { throw new Error('SecurityError'); }
                return (key in store ? store[key] : null);
            },
            setItem: (key, value) => {
                if (opts.quotaFull) { throw new Error('QuotaExceededError'); }
                store[key] = value;
            },
            removeItem: (key) => { delete store[key]; }
        },
        escapeSoqlLiteral: (v) => String(v),
        console, Date, JSON, Array, Object, Set, Promise
    };
    vm.createContext(context);
    vm.runInContext(source, context);

    const $q = Object.assign((fn) => new Promise(fn), {
        when: (v) => Promise.resolve(v), all: (list) => Promise.all(list)
    });

    // `rows` is a live handle the cases mutate to represent someone editing or
    // deleting a component between checks.
    const state = { rows: opts.rows || {}, refuse: opts.refuse || [] };
    const sfdc = {
        query(soql) {
            asked.push(soql);
            const type = soql.match(/FROM (\w+)/)[1];
            if (state.refuse.indexOf(type) !== -1) {
                return Promise.reject({ message: 'INSUFFICIENT_ACCESS' });
            }
            // The audit trail is a different shape and a different permission
            // from the component queries, so it refuses independently.
            if (type === 'SetupAuditTrail') {
                return opts.refuseAudit
                    ? Promise.reject({ message: 'INSUFFICIENT_ACCESS' })
                    : Promise.resolve({ records: opts.audit || [] });
            }
            if (type === 'User') {
                return Promise.resolve({ records: [{ Id: '005u', Name: 'Grace Hopper' }] });
            }
            const inClause = (soql.match(/IN \(([^)]*)\)/) || [])[1] || '';
            const wanted = (inClause.match(/'([^']*)'/g) || []).map((raw) => raw.replace(/'/g, ''));
            const single = (soql.match(/Id = '([^']*)'/) || [])[1];
            if (single) { wanted.push(single); }
            return Promise.resolve({
                records: (state.rows[type] || []).filter((row) => wanted.indexOf(row.Id) !== -1)
            });
        }
    };

    const service = new moduleObj.factory($q, sfdc, { id: opts.userId || '005me' });
    return { service, state, asked, store };
}

const apexMeta = { value: 'ApexClass', label: 'Apex Classes' };
const cls = (id, name, modified) => ({
    Id: id, Name: name, LastModifiedDate: modified, LastModifiedById: '005u'
});

async function main() {

    /* ------------------------------------------------------------------ */
    /* Bookmarks are keyed by type and id together                         */
    /*                                                                     */
    /* Two different metadata types can hold rows with the same id across   */
    /* orgs, and a bare-id key would let one silently stand for the other.  */
    /* ------------------------------------------------------------------ */

    const keys = load({});
    keys.service.add(cls('01p1', 'BillingService', 'T1'), apexMeta);
    assert.strictEqual(keys.service.isBookmarked('ApexClass', '01p1'), true, 'watched');
    assert.strictEqual(keys.service.isBookmarked('ApexTrigger', '01p1'), false,
        'the same id under another type is a different component');
    keys.service.remove('ApexTrigger', '01p1');
    assert.strictEqual(keys.service.count(), 1, 'and removing that other one removes nothing');
    keys.service.remove('ApexClass', '01p1');
    assert.strictEqual(keys.service.count(), 0, 'removing the right one works');

    /* ------------------------------------------------------------------ */
    /* An edit is reported once, with who made it                          */
    /* ------------------------------------------------------------------ */

    const edited = load({ rows: { ApexClass: [cls('01p1', 'BillingService', 'T1')] } });
    edited.service.add(cls('01p1', 'BillingService', 'T1'), apexMeta);

    assert.deepStrictEqual(Array.from(await edited.service.checkForChanges()), [],
        'an untouched component is not news');

    edited.state.rows.ApexClass = [cls('01p1', 'BillingService', 'T2')];
    const events = await edited.service.checkForChanges();
    assert.strictEqual(events.length, 1, 'the edit is caught');
    assert.strictEqual(events[0].kind, 'changed');
    assert.strictEqual(events[0].name, 'BillingService', 'named as the user bookmarked it');
    assert.strictEqual(events[0].byName, 'Grace Hopper', 'and attributed to whoever did it');
    assert.strictEqual(events[0].from, 'T1', 'carrying what it moved from');
    assert.strictEqual(events[0].to, 'T2', 'and to');

    assert.deepStrictEqual(Array.from(await edited.service.checkForChanges()), [],
        'the same edit is not reported again on the next check - the stored ' +
        'timestamp moves forward with it');
    assert.strictEqual(edited.service.timeline().length, 1,
        'and the timeline holds one entry, not one per check');

    /* ------------------------------------------------------------------ */
    /* A deletion, which a timestamp cannot report                         */
    /*                                                                     */
    /* A deleted row has no LastModifiedDate to compare, so its absence     */
    /* from the answer is the only evidence there is.                       */
    /* ------------------------------------------------------------------ */

    const deleted = load({ rows: { ApexClass: [cls('01p1', 'TaxHelper', 'T1')] } });
    deleted.service.add(cls('01p1', 'TaxHelper', 'T1'), apexMeta);
    deleted.state.rows.ApexClass = [];

    const gone = await deleted.service.checkForChanges();
    assert.strictEqual(gone.length, 1, 'a component that is no longer there is news');
    assert.strictEqual(gone[0].kind, 'deleted');
    assert.strictEqual(gone[0].name, 'TaxHelper',
        'named from what was stored - there is nothing left to ask');

    assert.deepStrictEqual(Array.from(await deleted.service.checkForChanges()), [],
        'and it is reported once, not on every check for as long as it is watched');

    // If it comes back, the absence was a blip and the watch resumes.
    deleted.state.rows.ApexClass = [cls('01p1', 'TaxHelper', 'T9')];
    const back = await deleted.service.checkForChanges();
    assert.ok(back.length === 0 || back[0].kind === 'changed',
        'a component that reappears is not a second deletion');

    /* ------------------------------------------------------------------ */
    /* A refusal is not a deletion                                         */
    /*                                                                     */
    /* This is the one that would do real damage: an org that refuses the   */
    /* query returns no rows, which looks exactly like every watched        */
    /* component having been deleted at once.                               */
    /* ------------------------------------------------------------------ */

    const refused = load({
        rows: { ApexClass: [cls('01p1', 'BillingService', 'T1')] },
        refuse: ['ApexClass']
    });
    refused.service.add(cls('01p1', 'BillingService', 'T1'), apexMeta);

    assert.deepStrictEqual(Array.from(await refused.service.checkForChanges()), [],
        'a refused query reports nothing at all - not a deletion');
    assert.strictEqual(refused.service.timeline().length, 0, 'and writes no history');
    assert.strictEqual(refused.service.count(), 1, 'while the bookmark is kept');

    /* ------------------------------------------------------------------ */
    /* A bookmark with no baseline must not invent a change                */
    /*                                                                     */
    /* Plenty of lists do not select LastModifiedDate, so the row the user  */
    /* stars carries no timestamp. Comparing against nothing and calling it */
    /* different would make the first check announce an edit that never     */
    /* happened.                                                            */
    /* ------------------------------------------------------------------ */

    const noBaseline = load({ rows: { ApexClass: [cls('01p1', 'Fresh', 'T1')] } });
    noBaseline.service.add({ Id: '01p1', Name: 'Fresh' }, apexMeta);
    assert.deepStrictEqual(Array.from(await noBaseline.service.checkForChanges()), [],
        'the first check adopts the current timestamp rather than reporting a change');

    noBaseline.state.rows.ApexClass = [cls('01p1', 'Fresh', 'T2')];
    assert.strictEqual((await noBaseline.service.checkForChanges()).length, 1,
        'and a real edit after that is still caught');

    /* ------------------------------------------------------------------ */
    /* The timeline                                                        */
    /* ------------------------------------------------------------------ */

    assert.strictEqual(edited.service.unseenCount(), 1, 'new events are unseen');
    edited.service.markAllSeen();
    assert.strictEqual(edited.service.unseenCount(), 0, 'until marked');
    edited.service.clearTimeline();
    assert.strictEqual(edited.service.timeline().length, 0, 'and can be cleared');
    assert.strictEqual(edited.service.count(), 1,
        'clearing the history does not stop watching anything');

    /* ------------------------------------------------------------------ */
    /* Storage that will not cooperate                                     */
    /* ------------------------------------------------------------------ */

    const full = load({ quotaFull: true });
    const result = full.service.add(cls('01p1', 'X', 'T1'), apexMeta);
    assert.strictEqual(result.ok, true, 'the bookmark is accepted');
    assert.strictEqual(result.saved, false,
        'but the caller is told it did not persist, rather than finding out next session');

    const corrupt = load({ store: { 'Simplified_Bookmarks_Items_005me': '{not json' } });
    assert.deepStrictEqual(Array.from(corrupt.service.list()), [],
        'unreadable storage is an empty list, not an exception on panel open');

    /* ------------------------------------------------------------------ */
    /* Bounded                                                             */
    /* ------------------------------------------------------------------ */

    const many = load({});
    let last;
    for (let i = 0; i < many.service.max + 5; i++) {
        last = many.service.add(cls('01p' + i, 'C' + i, 'T1'), apexMeta);
    }
    assert.strictEqual(many.service.count(), many.service.max, 'the watch list is capped');
    assert.strictEqual(last.ok, false, 'and says so rather than silently dropping the star');
    assert.ok(/\d+/.test(last.reason), 'naming the limit');

    /* ------------------------------------------------------------------ */
    /* One org's bookmarks are not another's                               */
    /*                                                                     */
    /* localStorage on simplified.html is one origin for every org, so the  */
    /* key has to carry the user - otherwise switching org shows the wrong  */
    /* watch list and checks it against the wrong org's components.         */
    /* ------------------------------------------------------------------ */

    const shared = {};
    const orgA = load({ store: shared, userId: '005aaa' });
    const orgB = load({ store: shared, userId: '005bbb' });
    orgA.service.add(cls('01p1', 'OnlyInA', 'T1'), apexMeta);
    assert.strictEqual(orgA.service.count(), 1, 'A watches one component');
    assert.strictEqual(orgB.service.count(), 0, 'B sees none of it');

    /* ------------------------------------------------------------------ */
    /* One query per type, not one per component                           */
    /* ------------------------------------------------------------------ */

    const batched = load({
        rows: {
            ApexClass: [cls('01p1', 'A', 'T1'), cls('01p2', 'B', 'T1')],
            ApexTrigger: [cls('01q1', 'C', 'T1')]
        }
    });
    batched.service.add(cls('01p1', 'A', 'T1'), apexMeta);
    batched.service.add(cls('01p2', 'B', 'T1'), apexMeta);
    batched.service.add(cls('01q1', 'C', 'T1'), { value: 'ApexTrigger', label: 'Apex Triggers' });
    batched.asked.length = 0;
    await batched.service.checkForChanges();

    const componentQueries = batched.asked.filter((soql) => !/FROM User/.test(soql));
    assert.strictEqual(componentQueries.length, 2,
        'two types is two queries, however many components are watched');


    /* ------------------------------------------------------------------ */
    /* History from before the watch started                               */
    /*                                                                     */
    /* The timeline only holds what this extension saw, and it starts       */
    /* seeing when you star something. SetupAuditTrail can fill in the      */
    /* past, but it carries no component id - only Section, Action and a    */
    /* Display sentence - so a row is tied to a component by finding the    */
    /* name inside that sentence. That is a guess, and these cases are      */
    /* about keeping the guess narrow and labelled rather than confident.   */
    /* ------------------------------------------------------------------ */

    const auditRow = (over) => Object.assign({
        Id: 'a1', Action: 'changedApexClass', Section: 'Apex Class',
        CreatedDate: '2026-04-11T09:00:00Z', CreatedBy: { Name: 'Grace Hopper' },
        Display: 'Changed Apex Class BillingService'
    }, over);

    const watching = [{ type: 'ApexClass', typeLabel: 'Apex Classes', id: '01p1', name: 'BillingService' }];

    /*
     * Whole name, not substring.
     *
     * "BillingService" must not pull in rows about BillingServiceHelper or
     * BillingService_Bot, or watching one component quietly reports every
     * change to everything built around it. \b is not enough: it sits happily
     * between "e" and "_", so the boundary is checked against the word
     * characters API names actually contain.
     */
    const naming = load({});
    const cases = [
        ['Changed Apex Class BillingService', true, 'the component itself'],
        ['changed apex class billingservice', true, 'whatever the case'],
        ['Changed Apex Class BillingServiceHelper', false, 'not a longer name that starts the same'],
        ['Changed profile for user BillingService_Bot', false, 'not one separated by an underscore'],
        ['Deleted BillingService.', true, 'punctuation is a boundary']
    ];
    for (const [display, expected, why] of cases) {
        assert.strictEqual(naming.service.mentions(display, 'BillingService'), expected, why);
    }

    /*
     * Names too short to match safely are refused.
     *
     * The four-character names are the dangerous ones - Test, Type, Name,
     * Case, Task, User are ordinary English words that appear in audit
     * sentences about unrelated things. A floor of four would admit exactly
     * those, which is what it did until the examples were checked against it.
     */
    for (const short of ['Test', 'Type', 'Name', 'Case', 'User']) {
        assert.strictEqual(naming.service.mentions('Changed Apex Class ' + short, short), false,
            short + ' is an ordinary word and must not be matched against prose');
    }
    assert.strictEqual(naming.service.mentions('Changed Order', 'Order'), true,
        'while real component names of five characters still work');

    /* The org is asked once, over the audit trail's own retention window. */
    const history = load({ audit: [auditRow(), auditRow({
        Id: 'a2', CreatedDate: '2026-01-05T09:00:00Z', Action: 'createdApexClass',
        Display: 'Created Apex Class BillingService'
    }), auditRow({ Id: 'a3', Display: 'Changed Apex Class BillingServiceHelper' })] });

    const found = await history.service.auditHistoryFor(watching);
    assert.strictEqual(found.events.length, 2,
        'both rows about this component, and not the one about a similar name');
    assert.ok(/FROM SetupAuditTrail/.test(history.asked[0]), 'read from the audit trail');
    assert.ok(/LAST_N_DAYS:\d+/.test(history.asked[0]), 'bounded to a window');
    assert.ok(/LIMIT \d+/.test(history.asked[0]), 'and bounded in size');

    assert.ok(found.events[0].at > found.events[1].at, 'newest first');
    assert.strictEqual(found.events[0].source, 'audit', 'tagged as inferred, not observed');
    assert.ok(found.events.every((e) => e.seen === true),
        'history is not unread news - it must not inflate the unseen badge');
    assert.strictEqual(found.events[0].display, 'Changed Apex Class BillingService',
        "the org's own sentence is carried through rather than reworded");

    /*
     * The audit row's own id travels with the event.
     *
     * Enabling one Apex class for four profiles writes four audit rows naming
     * the same class in the same second. Without this they are identical, and
     * the timeline's ngRepeat key collides - which throws ngRepeat:dupes and
     * takes the panel down rather than dropping a row.
     */
    assert.ok(found.events.every((e) => e.auditId),
        'every history event carries the id of the audit row it came from');
    assert.strictEqual(new Set(found.events.map((e) => e.auditId)).size, found.events.length,
        'and those ids are distinct, which is what keeps the timeline keys apart');

    /* A component whose name is too short is reported, not silently dropped. */
    const skipped = await history.service.auditHistoryFor(
        [{ type: 'CustomField', typeLabel: 'Fields', id: 'f1', name: 'Amt' }]);
    assert.strictEqual(skipped.events.length, 0, 'nothing matched');
    assert.strictEqual(skipped.tooShort, 1, 'and the user can be told why');

    /* No permission costs the history and nothing else. */
    const noPerm = load({ refuseAudit: true });
    const refusedHistory = await noPerm.service.auditHistoryFor(watching);
    assert.strictEqual(refusedHistory.refused, true, 'a refusal is reported as a refusal');
    assert.deepStrictEqual(Array.from(refusedHistory.events), [],
        'not as an empty history, which reads as a component that never changed');

    /* Nothing derived is written to storage. */
    assert.strictEqual(history.service.timeline().length, 0,
        'audit history is re-derived on demand and never mixed into observed history');

    /* The preference survives, because it costs a query to turn on. */
    const pref = load({});
    assert.strictEqual(pref.service.historyEnabled(), false, 'off by default - it is a guess');
    pref.service.setHistoryEnabled(true);
    assert.strictEqual(pref.service.historyEnabled(), true, 'and remembered once chosen');


    /* ------------------------------------------------------------------ */
    /* Auto-refresh: the interval, and the value that is not on the list    */
    /*                                                                     */
    /* Every tick is a query per watched type, so the interval is a choice  */
    /* from a short list rather than a number someone can type. A stored    */
    /* value that is not on that list - stale, hand-edited, or from a       */
    /* build where the choices were different - is off rather than honoured.*/
    /* ------------------------------------------------------------------ */

    const timer = load({});
    assert.strictEqual(timer.service.autoRefreshMinutes(), 0,
        'off until asked for - a watch list that polls by default is a surprise');

    assert.strictEqual(timer.service.setAutoRefreshMinutes(15), 15, 'a listed value is kept');
    assert.strictEqual(timer.service.autoRefreshMinutes(), 15, 'and remembered');

    for (const junk of [1, 2, 7, -5, 'abc', null, 9999]) {
        /*
         * The return value matters as much as what is stored. The controller
         * starts the live timer from what this hands back, so a setter that
         * echoes its input unchecked polls at that interval for the rest of
         * the session - and reloading reads 0, which makes it look fixed while
         * the running tab keeps going.
         */
        assert.strictEqual(timer.service.setAutoRefreshMinutes(junk), 0,
            JSON.stringify(junk) + ' must come back as off, because the caller starts ' +
            'a timer with whatever this returns');
        assert.strictEqual(timer.service.autoRefreshMinutes(), 0,
            JSON.stringify(junk) + ' is not an offered interval, so it must read as off ' +
            'rather than as a one-minute poll');
    }

    assert.ok(timer.service.autoRefreshChoices.indexOf(0) === 0,
        'Off is the first choice, so the control opens on it');
    assert.ok(timer.service.autoRefreshChoices.length >= 3, 'and there are real intervals to pick');

    /*
     * A value stored directly, as an older build or another tab could leave
     * it. Read through the same guard rather than trusted.
     */
    const stale = load({ store: { 'Simplified_Bookmarks_AutoRefresh_005me': '3' } });
    assert.strictEqual(stale.service.autoRefreshMinutes(), 0,
        'a value already in storage is validated on read, not only on write');

    /* ------------------------------------------------------------------ */
    /* When the org was last actually asked                                */
    /*                                                                     */
    /* Shown on the page, so it has to mean what it says: a check that      */
    /* happened, not a view that was refreshed. Otherwise a stalled timer   */
    /* is indistinguishable from a component that has not changed.          */
    /* ------------------------------------------------------------------ */

    const stamped = load({ rows: { ApexClass: [cls('01p1', 'BillingService', 'T1')] } });
    assert.strictEqual(stamped.service.lastCheckedAt(), null, 'nothing claimed before the first check');

    stamped.service.add(cls('01p1', 'BillingService', 'T1'), apexMeta);
    assert.strictEqual(stamped.service.lastCheckedAt(), null,
        'and adding a bookmark is not a check');

    const before = Date.now();
    await stamped.service.checkForChanges();
    const at = stamped.service.lastCheckedAt();
    assert.ok(typeof at === 'number' && at >= before,
        'a completed check stamps the time, whether or not it found anything');


    /* ------------------------------------------------------------------ */
    /* Clearing a whole type                                               */
    /*                                                                     */
    /* A watch list built during a release is made a type at a time - the   */
    /* classes for this change, then the profiles - and gets cleared the    */
    /* same way. The risk in a bulk control is that it takes more than it   */
    /* was pointed at, which is invisible afterwards: the rows are simply   */
    /* gone, and nothing says they were ever watched.                       */
    /* ------------------------------------------------------------------ */

    const bulk = load({});
    const addMany = (type, label, n) => {
        for (let i = 0; i < n; i++) {
            bulk.service.add(cls(type.slice(0, 3) + i, label + i, 'T1'), { value: type, label: label });
        }
    };
    addMany('ApexClass', 'Apex Classes', 5);
    addMany('Profile', 'Profiles', 3);
    addMany('CustomField', 'Fields', 7);

    const grouped = bulk.service.countsByType();
    assert.deepStrictEqual(Array.from(grouped, (g) => g.label + ':' + g.count),
        ['Fields:7', 'Apex Classes:5', 'Profiles:3'],
        'grouped by type, biggest first - the one worth clearing is nearest to hand');

    assert.strictEqual(bulk.service.removeType('Profile'), 3, 'it reports what it took');
    assert.strictEqual(bulk.service.count(), 12, 'and takes only that type');
    assert.deepStrictEqual(Array.from(bulk.service.countsByType(), (g) => g.type).sort(),
        ['ApexClass', 'CustomField'], 'the other types survive intact');

    // Every remaining row is genuinely still watched, not just counted.
    assert.strictEqual(bulk.service.isBookmarked('ApexClass', 'Ape0'), true,
        'a surviving component is still watched, not merely still counted');
    assert.strictEqual(bulk.service.isBookmarked('Profile', 'Pro0'), false,
        'and a removed one is really gone');

    assert.strictEqual(bulk.service.removeType('Flow'), 0,
        'a type that is not watched removes nothing rather than erroring');
    assert.strictEqual(bulk.service.count(), 12, 'and costs nothing else');

    assert.strictEqual(bulk.service.removeType(undefined), 0,
        'and neither does no type at all');
    assert.strictEqual(bulk.service.count(), 12, 'still 12');

    bulk.service.clear();
    assert.strictEqual(bulk.service.count(), 0, 'clearing everything works');
    assert.deepStrictEqual(Array.from(bulk.service.countsByType()), [],
        'and leaves no groups behind');


    /* ------------------------------------------------------------------ */
    /* When it happened, not when it was noticed                           */
    /*                                                                     */
    /* An event was stamped with the time of the check that found it. On    */
    /* its own that misdates a row; merged with audit-trail history, which  */
    /* carries real historical dates, it also sorts the row into the wrong  */
    /* place - an edit made in April but discovered today appears above     */
    /* changes that genuinely came after it.                               */
    /* ------------------------------------------------------------------ */

    const dated = load({ rows: { ApexClass: [cls('01p1', 'BillingService', '2026-03-01T09:00:00Z')] } });
    dated.service.add(cls('01p1', 'BillingService', '2026-03-01T09:00:00Z'), apexMeta);
    dated.state.rows.ApexClass = [cls('01p1', 'BillingService', '2026-04-15T10:00:00Z')];

    const datedEvent = (await dated.service.checkForChanges())[0];
    assert.strictEqual(datedEvent.at, Date.parse('2026-04-15T10:00:00Z'),
        "the event carries the org's LastModifiedDate, not the time of the check");
    assert.ok(datedEvent.detectedAt >= dated.service.lastCheckedAt() - 5000,
        'while the detection time is kept beside it rather than thrown away');
    assert.ok(!datedEvent.atIsDetection,
        'and the row is not flagged as a detection time, because it is not one');

    /*
     * A deletion is the exception: there is no timestamp left to read, so the
     * only honest date is when it was found missing - and it says so.
     */
    dated.state.rows.ApexClass = [];
    const deletedEvent = (await dated.service.checkForChanges())[0];
    assert.strictEqual(deletedEvent.kind, 'deleted');
    assert.strictEqual(deletedEvent.atIsDetection, true,
        'a deletion is dated when it was noticed, and must be marked as such rather ' +
        'than implying that is when someone deleted it');

    /* ------------------------------------------------------------------ */
    /* Retention counts from when it was noticed                           */
    /*                                                                     */
    /* Directly caused by the change above: pruning on `at` once `at` was   */
    /* the change time discarded events as they were written. An edit made  */
    /* four months ago and found today is not four months of history - it   */
    /* is today's news about an old change, and a thirty-day window that    */
    /* reads it the other way deletes it before anyone sees it.             */
    /* ------------------------------------------------------------------ */

    const old = load({ rows: { ApexClass: [cls('01p1', 'Ancient', '2020-01-01T00:00:00Z')] } });
    old.service.add(cls('01p1', 'Ancient', '2020-01-01T00:00:00Z'), apexMeta);
    old.state.rows.ApexClass = [cls('01p1', 'Ancient', '2020-06-01T00:00:00Z')];

    const ancient = await old.service.checkForChanges();
    assert.strictEqual(ancient.length, 1, 'the change is found');
    assert.strictEqual(old.service.timeline().length, 1,
        'and survives being written - a very old change discovered today is ' +
        "today's news, not history to be pruned on arrival");
    assert.strictEqual(old.service.timeline()[0].at, Date.parse('2020-06-01T00:00:00Z'),
        'while still carrying its real date');

    /* ------------------------------------------------------------------ */
    /* No fabricated dates in audit history                                */
    /*                                                                     */
    /* Date.parse returns NaN for an unreadable CreatedDate, and the || 0   */
    /* that stood in for it rendered as 1 January 1970 - not merely wrong   */
    /* but confidently wrong, sitting at the foot of the list looking like  */
    /* the oldest thing that ever happened.                                */
    /* ------------------------------------------------------------------ */

    const undated = load({ audit: [
        auditRow({ Id: 'a1', CreatedDate: '2026-01-15T11:22:33Z' }),
        auditRow({ Id: 'a2', CreatedDate: null }),
        auditRow({ Id: 'a3', CreatedDate: 'not a date' })
    ] });
    const readable = await undated.service.auditHistoryFor(watching);
    assert.strictEqual(readable.events.length, 1,
        'rows with no readable date are dropped, not dated 1970');
    assert.ok(readable.events.every((e) => e.at > 0 && !isNaN(e.at)),
        'every history row that survives carries a real time');


    /* ------------------------------------------------------------------ */
    /* Turning the notice off, without turning the watching off            */
    /*                                                                     */
    /* A release with fifty watched components raises a toast on every      */
    /* check, and at that point the notice is noise over the work. But the  */
    /* preference must govern only the interruption: the check still runs   */
    /* and the timeline still fills, or "quieter" quietly becomes "off" and */
    /* the history has a hole in it that nothing explains.                  */
    /* ------------------------------------------------------------------ */

    const notify = load({ rows: { ApexClass: [cls('01p1', 'BillingService', 'T1')] } });
    assert.strictEqual(notify.service.notifyEnabled(), true,
        'on until turned off - a watch list that finds a change and says nothing ' +
        'reads as one that did not work');

    assert.strictEqual(notify.service.setNotifyEnabled(false), false, 'the setter reports the new state');
    assert.strictEqual(notify.service.notifyEnabled(), false, 'and it sticks');

    /* The check is untouched by the preference. */
    notify.service.add(cls('01p1', 'BillingService', 'T1'), apexMeta);
    notify.state.rows.ApexClass = [cls('01p1', 'BillingService', 'T2')];
    const quietEvents = await notify.service.checkForChanges();

    assert.strictEqual(quietEvents.length, 1,
        'the change is still found with notifications off');
    assert.strictEqual(notify.service.timeline().length, 1,
        'and still recorded - only the toast is suppressed');
    assert.strictEqual(notify.service.unseenCount(), 1,
        'and still counted as unread, so the badge shows what was missed');

    notify.service.setNotifyEnabled(true);
    assert.strictEqual(notify.service.notifyEnabled(), true, 'and it can be turned back on');

    /* A preference that cannot be stored must not silence anything. */
    const blocked = load({ quotaFull: true });
    assert.strictEqual(blocked.service.notifyEnabled(), true,
        'storage that refuses to save leaves notifications on rather than off - failing ' +
        'to save a preference must not act like the preference was set');

    const unreadable = load({ readFails: true });
    assert.strictEqual(unreadable.service.notifyEnabled(), true,
        'and storage that cannot even be read falls back to on, not silence');
    assert.doesNotThrow(() => unreadable.service.historyEnabled(),
        'the other preferences survive an unreadable store too');


    /* ------------------------------------------------------------------ */
    /* The count is in the footer, and only when there is one               */
    /*                                                                     */
    /* This was a card in the right rail: a lot of page for one number,     */
    /* when everything else about the watch list has a page of its own.     */
    /* The gate is the same question it always was - events outlive the     */
    /* watch that produced them, so a leftover timeline must not put a      */
    /* count on screen for a watch list that is empty.                      */
    /* ------------------------------------------------------------------ */

    {
        const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
        assert.ok(!/<bookmarkwatch>|this\.bookmarkwatch =/.test(view),
            'the card is gone, not merely hidden');

        // Matched on the class and the handler, not the tag - it became a
        // <button> when the footer gained icons, and the gate is the point.
        const chip = /class="ss-foot-chip" ng-show="([^"]+)" ng-click="openWatchingList\(\)"/
            .exec(view.replace(/'\s*\+\s*\n\s*'/g, ''));
        assert.ok(chip, 'the footer shows the count instead');

        const evaluate = (state) => new Function('s',
            'with (s) { return !!(' + chip[1] + '); }')(new Proxy(state, {
                has: () => true, get: (t, k) => t[k]
            }));

        assert.ok(evaluate({ bookmarks: [{ Id: 1 }] }), 'watching something shows it');
        assert.ok(!evaluate({ bookmarks: [], bookmarkEvents: [{ id: 1 }] }),
            'but a leftover timeline over an empty watch list does not');
        assert.ok(!evaluate({ bookmarks: [] }), 'nor an empty everything');

        /* It is a way in, not a control - the page carries the actions. */
        assert.ok(/openWatchingList\(\)/.test(view),
            'and it opens the page that holds everything else about the list');
    }

    console.log('bookmark watch regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
