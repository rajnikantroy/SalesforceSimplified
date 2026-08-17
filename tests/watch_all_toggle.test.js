/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Watch all, and getting back out of it.
 *
 * The control used to flip to "clear" only when every visible row was
 * watched, and on any list longer than the watch cap that state cannot be
 * reached: Watch all takes the first hundred, the rest stay unwatched, so the
 * button still reads "Watch all", pressing it adds nothing because the list is
 * full, and there is no way left to undo it from that header. The user is
 * simply stuck with a hundred watched components and a button that does
 * nothing.
 *
 * A partial selection has the same shape more quietly: star three rows by
 * hand and the only way to undo them is three more clicks.
 *
 * So the control now turns on "anything watched" rather than "everything
 * watched". The cost is that it no longer tops up a partial selection - one
 * click on a partly-watched list clears it rather than filling it - and that
 * is the trade these cases pin down.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');

function lift(signature) {
    const start = controller.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0, i = controller.indexOf('{', start);
    for (; i < controller.length; i++) {
        if (controller[i] === '{') { depth++; }
        else if (controller[i] === '}') { depth--; if (depth === 0) { return controller.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

/*
 * anyWatched is derived from watchedCount now, so the count comes with it -
 * and with its cache, which the harness must own rather than share between
 * fixtures. bookmarkRevision is bumped by the stubbed refreshBookmarkState
 * below, exactly as the controller does it.
 */
const SOURCE = [
    'var watchedCountCache = {};',
    lift('$scope.allWatched = function(context){') + ';',
    lift('$scope.watchedCount = function(context){') + ';',
    lift('$scope.anyWatched = function(context){') + ';',
    lift('$scope.watchAllVisible = function(context){') + ';'
].join('\n').replace(/\bbookmarkRevision\b/g, 'bookmarkRevisionRef()');

function harness(rowCount, cap) {
    let revision = 0;
    const watched = new Map();
    /*
     * A partial Watch all is reported on the page it was clicked on now, not
     * only through bookmarkNotice - which is rendered on the watching list,
     * somewhere the user is not. So the scope needs a toast.
     */
    const toasts = [];
    const BookmarkService = {
        max: cap,
        add: (record, meta) => watched.size >= cap
            ? { ok: false, reason: 'full' }
            : (watched.set(meta.value + ':' + record.Id, record), { ok: true }),
        remove: (type, id) => { watched.delete(type + ':' + id); }
    };
    const rows = Array.from({ length: rowCount }, (_, i) => ({ Id: '01p' + i, Name: 'C' + i }));

    const $scope = {
        selectedMetadata: { value: 'ApexClass', label: 'Apex Classes' },
        bookmarkNotice: '',
        canBookmark: (r) => !!(r && r.Id),
        isBookmarked: (r) => watched.has('ApexClass:' + r.Id)
    };
    const env = {
        $scope, BookmarkService,
        // A bare name, not $scope.checkBookmarks: it is a hoisted declaration
        // now, because refreshBookmarkState reaches it during construction and
        // an assigned expression is undefined at that point.
        checkBookmarks: () => {},
        // The row's real type, which watchAllVisible now passes to add(). The
        // menu is the right answer for these fixtures - they are a single
        // ordinary list - so this stands in for the resolver, which has its
        // own cases below.
        watchMetaFor: () => $scope.selectedMetadata,
        // watchAllVisible removes by the row's resolved type now. These
        // fixtures are a single ordinary list, where the resolver returns the
        // menu's own value - the mixed-list cases have their own round trip.
        resolveWatchType: () => $scope.selectedMetadata.value,
        packageListFor: () => rows,
        bookmarkRevisionRef: () => revision,
        refreshBookmarkState: () => {
            revision++;
            $scope.bookmarks = [...watched.values()];
        }
    };
    $scope.showToast = (spec) => { toasts.push(spec); };
    // The toast's "View" points at the watching list, which the real controller
    // defines. Without it here the action is undefined and the assertion below
    // fails for a reason the panel does not have.
    $scope.openWatchingList = () => {};
    new Function(...Object.keys(env), SOURCE)(...Object.values(env));
    return { $scope, watched, toasts };
}

async function main() {

    /* ------------------------------------------------------------------ */
    /* A list longer than the cap                                          */
    /*                                                                     */
    /* The case that was stuck: "everything watched" is unreachable here,   */
    /* so a control keyed on it never offers the way out.                   */
    /* ------------------------------------------------------------------ */

    const capped = harness(150, 100);
    capped.$scope.watchAllVisible('my');

    assert.strictEqual(capped.watched.size, 100, 'the cap holds');
    assert.strictEqual(capped.$scope.allWatched('my'), false,
        'and "everything watched" is false, because fifty rows are not watched');
    assert.strictEqual(capped.$scope.anyWatched('my'), true,
        'while "anything watched" is true - which is what the control needs to read');

    capped.$scope.watchAllVisible('my');
    assert.strictEqual(capped.watched.size, 0,
        'so a second press clears it. Keyed on allWatched this did nothing at all, ' +
        'and there was no other way to undo a Watch all from the list header');

    /* ------------------------------------------------------------------ */
    /* A few starred by hand                                               */
    /* ------------------------------------------------------------------ */

    const partial = harness(10, 100);
    partial.watched.set('ApexClass:01p3', { Id: '01p3' });
    assert.strictEqual(partial.$scope.anyWatched('my'), true, 'one star counts');
    assert.strictEqual(partial.$scope.allWatched('my'), false, 'and is not all of them');

    partial.$scope.watchAllVisible('my');
    assert.strictEqual(partial.watched.size, 0,
        'one press clears the hand-picked stars rather than needing one press each');

    /* ------------------------------------------------------------------ */
    /* From empty it still adds                                            */
    /*                                                                     */
    /* The whole point of the control. A change that made it only ever      */
    /* remove would pass every assertion above.                             */
    /* ------------------------------------------------------------------ */

    const empty = harness(10, 100);
    assert.strictEqual(empty.$scope.anyWatched('my'), false, 'nothing watched to begin with');
    empty.$scope.watchAllVisible('my');
    assert.strictEqual(empty.watched.size, 10, 'and the press watches every row');

    /* An empty list is not "watched", or the control would offer to clear
       nothing on every object with no rows. */
    const noRows = harness(0, 100);
    assert.strictEqual(noRows.$scope.anyWatched('my'), false, 'an empty list watches nothing');
    assert.strictEqual(noRows.$scope.allWatched('my'), false, 'and is not vacuously all-watched');

    /* ------------------------------------------------------------------ */
    /* The label says which way it will go                                 */
    /*                                                                     */
    /* A control that clears while captioned "Watch all" is worse than the  */
    /* bug it fixes.                                                        */
    /* ------------------------------------------------------------------ */

    /*
     * The template is a JavaScript string literal, so its quotes are escaped.
     * Flattened once here rather than matched through the escaping - getting
     * that wrong fails the assertion for a reason that has nothing to do with
     * the markup, which is exactly what it did first time.
     */
    const flatView = view.replace(/\\'/g, "'");

    for (const context of ['my', 'all']) {
        const at = flatView.indexOf("watchAllVisible('" + context + "')");
        assert.notStrictEqual(at, -1, 'no watch-all control for ' + context);
        const control = flatView.slice(at, at + 400);

        assert.ok(/anyWatched/.test(control),
            context + ' control must read anyWatched, not allWatched');
        assert.ok(/Unwatch all/.test(control),
            context + ' control must say Unwatch all when it is going to clear');
        assert.ok(!/allWatched/.test(control),
            context + ' control must not still be keyed on allWatched');
    }


    /* ------------------------------------------------------------------ */
    /* Earlier history follows the watch list                              */
    /*                                                                     */
    /* The control that loads audit-trail history fired only when there was */
    /* no history yet - "have we got any" rather than "is it for these      */
    /* components". Star three more and their past never arrived: the list  */
    /* already had rows, so nothing refetched, and the new components sat   */
    /* there as the only ones with no history and no explanation. The same  */
    /* test re-queried the entire audit trail on every toggle whenever the  */
    /* first fetch had legitimately found nothing.                          */
    /* ------------------------------------------------------------------ */

    const historySrc = [
        'var bookmarkKeys = new Set();',
        // refreshBookmarkState bumps this now. Declared here, above the lift
        // that reads it, exactly as the controller declares it above its own.
        'var bookmarkRevision = 0;',
        "$scope.bookmarkHistory = []; $scope.bookmarkTimeline = [];",
        "$scope.showBookmarkHistory = false; $scope.historyNotice = ''; $scope.isLoadingHistory = false;",
        lift('function rebuildTimeline(){'),
        lift('function refreshBookmarkState(){'),
        'var historyFetchedFor = null; var historyRaw = []; var historyFetchedKeys = new Set();',
        lift('function watchKeys(){'),
        lift('function watchSignature(){'),
        lift('function historyCovers(keys){'),
        lift('function applyHistoryFilter(){'),
        lift('function loadBookmarkHistory(){'),
        lift('$scope.toggleBookmarkHistory = function(){') + ';'
    ].join('\n');

    let watched = [{ type: 'ApexClass', typeLabel: 'A', id: '01p1', name: 'BillingService' }];
    let fetches = 0;
    const BookmarkService = {
        max: 100, historyDays: 180,
        list: () => watched.slice(), timeline: () => [], unseenCount: () => 0,
        countsByType: () => [], lastCheckedAt: () => null,
        historyEnabled: () => false, setHistoryEnabled: () => {},
        auditHistoryFor: (items) => {
            fetches++;
            return Promise.resolve({
                /*
                 * type and typeLabel included because the real auditHistoryFor
                 * sets them and the local filter keys on type + id. A mock
                 * without them makes that filter match nothing, which reads as
                 * "removal clears the history" rather than as a broken mock.
                 */
                events: items.map((i) => ({
                    source: 'audit', kind: 'history',
                    type: i.type, typeLabel: i.typeLabel,
                    id: i.id, name: i.name, at: 1, seen: true
                })),
                truncated: false, tooShort: 0, refused: false
            });
        }
    };
    const hScope = {};
    const hEnv = {
        $scope: hScope, BookmarkService,
        $q: Object.assign((fn) => new Promise(fn), { when: (v) => Promise.resolve(v) })
    };
    const history = new Function(...Object.keys(hEnv), historySrc +
        '\n$scope.loadBookmarkHistory = loadBookmarkHistory;' +
        '\nreturn { refresh: refreshBookmarkState, toggle: $scope.toggleBookmarkHistory };'
    )(...Object.values(hEnv));

    const settle = () => new Promise((r) => setTimeout(r, 5));

    history.refresh();
    history.toggle();
    await settle();
    assert.strictEqual(fetches, 1, 'turning it on fetches once');
    assert.strictEqual(hScope.bookmarkHistory.length, 1, 'and the history arrives');

    history.toggle(); history.toggle();
    await settle();
    assert.strictEqual(fetches, 1,
        'off and on again with the same components must not re-query the audit trail');

    /*
     * The same, when the fetch legitimately found nothing.
     *
     * This is the case that distinguishes "is the history for these
     * components" from "have we got any history at all". With the second test
     * an empty result looks like no result, so every toggle re-reads the whole
     * audit trail to find nothing again - and the case above cannot see it,
     * because there the history is non-empty either way.
     */
    const quiet = { fetches: 0 };
    const quietScope = {};
    const quietEnv = {
        $scope: quietScope,
        BookmarkService: Object.assign({}, BookmarkService, {
            list: () => [{ type: 'ApexClass', typeLabel: 'A', id: '01q1', name: 'NeverTouched' }],
            auditHistoryFor: () => {
                quiet.fetches++;
                return Promise.resolve({ events: [], truncated: false, tooShort: 0, refused: false });
            }
        }),
        $q: Object.assign((fn) => new Promise(fn), { when: (v) => Promise.resolve(v) })
    };
    const quietCtl = new Function(...Object.keys(quietEnv), historySrc +
        '\n$scope.loadBookmarkHistory = loadBookmarkHistory;' +
        '\nreturn { refresh: refreshBookmarkState, toggle: $scope.toggleBookmarkHistory };'
    )(...Object.values(quietEnv));

    quietCtl.refresh();
    quietCtl.toggle();
    await settle();
    assert.strictEqual(quiet.fetches, 1, 'one fetch, which finds nothing');
    assert.strictEqual(quietScope.bookmarkHistory.length, 0, 'so there is no history');

    quietCtl.toggle(); quietCtl.toggle();
    await settle();
    assert.strictEqual(quiet.fetches, 1,
        'and toggling again must not re-read the audit trail just because the ' +
        'result was empty - nothing about the watched components has changed');

    watched.push({ type: 'ApexClass', typeLabel: 'A', id: '01p2', name: 'TaxHelper' });
    history.refresh();
    await settle();
    assert.strictEqual(fetches, 2,
        'starring another component while history is showing refetches - this is the case ' +
        'that silently did nothing');
    assert.strictEqual(hScope.bookmarkHistory.length, 2, 'and the new component has history too');

    watched.push({ type: 'ApexClass', typeLabel: 'A', id: '01p3', name: 'Third' });
    watched.push({ type: 'ApexClass', typeLabel: 'A', id: '01p4', name: 'Fourth' });
    history.refresh(); history.refresh();
    await settle();
    assert.strictEqual(fetches, 3,
        'a burst of stars costs one query, not one per star');

    const settled = fetches;
    history.refresh(); history.refresh();
    await settle();
    assert.strictEqual(fetches, settled,
        'and a refresh that changes nothing queries nothing');


    /* ------------------------------------------------------------------ */
    /* Removing follows too, without paying for it                         */
    /*                                                                     */
    /* Unstarring a component has to drop its history - leaving it there    */
    /* shows changes to something no longer watched. But it needs no new    */
    /* read: the answer is a subset of what is already in hand, and the     */
    /* audit query covers six months of setup changes. Re-starring is free  */
    /* for the same reason.                                                 */
    /* ------------------------------------------------------------------ */

    const beforeRemoval = fetches;
    const dropped = watched.pop();
    history.refresh();
    await settle();

    assert.strictEqual(fetches, beforeRemoval,
        'removing a component must not re-read the audit trail - what is left is ' +
        'a subset of what was already fetched');
    assert.ok(!hScope.bookmarkHistory.some((e) => e.id === dropped.id),
        'and its history is gone from the timeline: ' +
        hScope.bookmarkHistory.map((e) => e.name).join(', '));
    assert.ok(hScope.bookmarkHistory.length > 0,
        'while everything still watched keeps its history');

    watched.push(dropped);
    history.refresh();
    await settle();
    assert.strictEqual(fetches, beforeRemoval,
        're-starring something the last read covered costs nothing either');
    assert.ok(hScope.bookmarkHistory.some((e) => e.id === dropped.id),
        'and its history comes back');

    watched.push({ type: 'ApexClass', typeLabel: 'A', id: '01pNEW', name: 'NeverFetched' });
    history.refresh();
    await settle();
    assert.strictEqual(fetches, beforeRemoval + 1,
        'but a component the last read did not cover does need a fresh read');
    assert.ok(hScope.bookmarkHistory.some((e) => e.id === '01pNEW'),
        'and it arrives with history of its own');

    /* ------------------------------------------------------------------ */
    /* The control is a button, not a checkbox                             */
    /*                                                                     */
    /* It costs a query and has a third state - running - that a checkbox   */
    /* has nowhere to show.                                                 */
    /* ------------------------------------------------------------------ */

    assert.ok(/ss-history-btn/.test(view), 'the history control is a button');
    assert.ok(!/ss-history-toggle/.test(view), 'the checkbox is gone');
    const btn = flatView.slice(flatView.indexOf('ss-history-btn'), flatView.indexOf('ss-history-btn') + 600);
    assert.ok(/ng-disabled="isLoadingHistory"/.test(btn),
        'and is disabled while it is reading, so it cannot be pressed twice');
    assert.ok(/Reading audit trail/.test(btn), 'saying so while it does');


    /* ------------------------------------------------------------------ */
    /* Notifications off suppresses the notice and nothing else            */
    /*                                                                     */
    /* This lives in the controller, so no amount of service testing sees   */
    /* it - a mutation that made the preference abandon the whole check     */
    /* passed every service assertion, because the service never reads the  */
    /* preference at all.                                                   */
    /*                                                                     */
    /* The distinction matters: "quieter" must not become "off". The check  */
    /* still runs, the timeline still fills, the unread badge still counts. */
    /* ------------------------------------------------------------------ */

    {
        const runCheck = (notifyOn) => {
            const found = [{ kind: 'changed', name: 'BillingService', id: '01p1',
                             at: Date.now(), byName: 'Grace' }];
            const seen = { toasts: 0, refreshed: 0 };
            const cScope = {
                baseUrl: 'https://acme.my.salesforce.com',
                isCheckingBookmarks: false, bookmarkNotice: '',
                showToast: () => { seen.toasts++; },
                openWatchingList: () => {}
            };
            const cEnv = {
                $scope: cScope,
                BookmarkService: {
                    count: () => 1,
                    checkForChanges: () => Promise.resolve(found),
                    notifyEnabled: () => notifyOn
                },
                $q: Object.assign((fn) => new Promise(fn), { when: (v) => Promise.resolve(v) }),
                refreshBookmarkState: () => { seen.refreshed++; },
                window: { open: () => {} }
            };
            const check = new Function(...Object.keys(cEnv),
                lift('function checkBookmarks(announce){') + '\nreturn checkBookmarks;'
            )(...Object.values(cEnv));
            return check(true).then((events) => ({ seen, events }));
        };

        const loud = await runCheck(true);
        assert.strictEqual(loud.seen.toasts, 1, 'with notifications on, a change raises one notice');
        assert.strictEqual(loud.events.length, 1, 'and returns what it found');

        const quiet = await runCheck(false);
        assert.strictEqual(quiet.seen.toasts, 0, 'with notifications off, no notice');
        assert.strictEqual(quiet.events.length, 1,
            'but the change is still found and returned - the preference governs the ' +
            'interruption, not the watching');
        assert.strictEqual(quiet.seen.refreshed, 1,
            'and the view is still refreshed, so the timeline and the unread badge fill');
    }


    /* ------------------------------------------------------------------ */
    /* A starred row is recorded as what it is                             */
    /*                                                                     */
    /* The menu entry is the wrong answer on the mixed lists. Recently      */
    /* Viewed queries one object and returns rows belonging to many, so     */
    /* starring an Apex class there recorded it as a "Recently viewed" -    */
    /* the watch list showed that as the type of every row, and the change  */
    /* check then asked FROM RecentlyViewed for an id that does not live    */
    /* there.                                                              */
    /*                                                                     */
    /* Type is believed only when the org's catalogue says an object of     */
    /* that name exists, because Type is not always an object: a Group's is */
    /* "Public" and a Document's is "Image". That keeps it working without  */
    /* a list of exceptions to maintain.                                   */
    /* ------------------------------------------------------------------ */

    {
        const objects = new Set(['ApexClass', 'Report', 'Flow', 'Group', 'Document', 'ApexPage']);
        const resolve = (menu, record) => {
            const rScope = { selectedMetadata: menu };
            const rEnv = {
                $scope: rScope,
                SchemaService: {
                    restCanQuery: (n) => objects.has(n),
                    toolingCanQuery: (n) => objects.has(n)
                }
            };
            return new Function(...Object.keys(rEnv),
                lift('function resolveWatchType(record){') + '\n' +
                lift('function watchMetaFor(record){') + '\nreturn watchMetaFor;'
            )(...Object.values(rEnv))(record);
        };

        const recent = { value: 'RecentlyViewed', label: 'Recently viewed' };

        const apex = resolve(recent, { Id: '01p1', Type: 'ApexClass', attributes: { type: 'RecentlyViewed' } });
        assert.strictEqual(apex.value, 'ApexClass',
            'a class starred from Recently Viewed is watched as an ApexClass, not as a ' +
            'RecentlyViewed - the change check queries this name');
        assert.strictEqual(apex.label, 'ApexClass',
            'and is labelled as what it is, not as the list it came from');

        const report = resolve(recent, { Id: '00O1', Type: 'Report', attributes: { type: 'RecentlyViewed' } });
        assert.strictEqual(report.value, 'Report', 'the same list yields different types per row');

        /* An ordinary list keeps the menu's own label, which is friendlier. */
        const plain = resolve({ value: 'ApexClass', label: 'Apex Classes' },
                              { Id: '01p2', attributes: { type: 'ApexClass' } });
        assert.strictEqual(plain.value, 'ApexClass');
        assert.strictEqual(plain.label, 'Apex Classes',
            "where the row agrees with the menu, the menu's wording is kept");

        /* Type that is not an object name must not win. */
        const group = resolve({ value: 'Group', label: 'Groups' },
                              { Id: '00G1', Type: 'Public', attributes: { type: 'Group' } });
        assert.strictEqual(group.value, 'Group',
            "a Group's Type is \"Public\", which is not an object - the catalogue says so " +
            'and the menu wins');

        const document = resolve({ value: 'Document', label: 'Documents' },
                                 { Id: '015x', Type: 'Image', attributes: { type: 'Document' } });
        assert.strictEqual(document.value, 'Document', 'and the same for a Document');

        /* Nothing on the row at all falls back to the menu. */
        const bare = resolve({ value: 'ApexPage', label: 'Visualforce Pages' }, { Id: '066x' });
        assert.strictEqual(bare.value, 'ApexPage', 'a row carrying neither still lands somewhere');
    }


    /* ------------------------------------------------------------------ */
    /* Read and write agree on the key                                     */
    /*                                                                     */
    /* The last change made add() store the row's real type, and left the   */
    /* lookup reading the menu's. On every ordinary list those are the same */
    /* string so nothing looked wrong - and on Recently Viewed, the one     */
    /* list where they differ, the star never filled in and unstarring did  */
    /* nothing. Storing and reading are one decision and have to be tested  */
    /* as a round trip, not as two functions that each look right.          */
    /* ------------------------------------------------------------------ */

    {
        const objects = new Set(['ApexClass', 'Report']);
        const roundTrip = (menu, record) => {
            const watched = new Map();
            const rScope = { selectedMetadata: menu, bookmarkNotice: '' };
            const rEnv = {
                $scope: rScope,
                BookmarkService: {
                    max: 100,
                    list: () => [...watched.values()],
                    isBookmarked: (t, id) => watched.has(t + ':' + id),
                    add: (r, m) => { watched.set(m.value + ':' + r.Id, { type: m.value, id: r.Id }); return { ok: true, saved: true }; },
                    remove: (t, id) => { watched.delete(t + ':' + id); },
                    baseline: () => {}
                },
                SchemaService: {
                    restCanQuery: (n) => objects.has(n),
                    toolingCanQuery: (n) => objects.has(n)
                },
                $q: Object.assign((fn) => new Promise(fn), { when: (v) => Promise.resolve(v) }),
                sfdc: { query: () => Promise.resolve({ records: [] }) },
                escapeSoqlLiteral: (v) => String(v)
            };
            const src = [
                'var bookmarkKeys = new Set();',
                lift('function resolveWatchType(record){'),
                lift('function watchMetaFor(record){'),
                lift('$scope.isBookmarked = function(record){') + ';',
                lift('$scope.canBookmark = function(record){') + ';',
                lift('$scope.toggleBookmark = function(record){') + ';',
                // Stands in for the real one, which rebuilds the key set from
                // what is stored - the step that has to agree with both.
                'function refreshBookmarkState(){ bookmarkKeys = new Set(BookmarkService.list().map(function(i){ return i.type + ":" + i.id; })); }',
                'return { toggle: $scope.toggleBookmark, isOn: $scope.isBookmarked, stored: function(){ return BookmarkService.list().map(function(i){ return i.type + ":" + i.id; }); } };'
            ].join('\n');
            return new Function(...Object.keys(rEnv), src)(...Object.values(rEnv));
        };

        const recent = roundTrip({ value: 'RecentlyViewed', label: 'Recently viewed' },
                                 null);
        const row = { Id: '01p1', Name: 'BillingService', Type: 'ApexClass',
                      attributes: { type: 'RecentlyViewed' } };

        assert.strictEqual(recent.isOn(row), false, 'not watched to begin with');

        recent.toggle(row);
        assert.deepStrictEqual(recent.stored(), ['ApexClass:01p1'],
            "stored under the row's real type");
        assert.strictEqual(recent.isOn(row), true,
            'and the star reads back as filled - this is the half that was missing, ' +
            'and it fails on exactly the list where the menu and the row disagree');

        recent.toggle(row);
        assert.strictEqual(recent.isOn(row), false, 'unstarring clears it');
        assert.deepStrictEqual(recent.stored(), [],
            'and really removes it - a remove keyed on the menu would have left it behind');

        /* The ordinary case, where the two agree, must be unchanged. */
        const plain = roundTrip({ value: 'ApexClass', label: 'Apex Classes' }, null);
        const plainRow = { Id: '01p2', Name: 'TaxHelper', attributes: { type: 'ApexClass' } };
        plain.toggle(plainRow);
        assert.strictEqual(plain.isOn(plainRow), true, 'an ordinary list still works');
        assert.deepStrictEqual(plain.stored(), ['ApexClass:01p2'], 'and keys the same way');
    }


    /* ------------------------------------------------------------------ */
    /* Every timeline row has a key of its own                             */
    /*                                                                     */
    /* ngRepeat tracked by id + timestamp + kind, which collides: enabling  */
    /* one Apex class for four profiles writes four audit rows naming the   */
    /* same class in the same second. Four events, one key, and Angular     */
    /* throws ngRepeat:dupes - which takes the whole panel down rather than */
    /* dropping a row, so it is not a display bug.                          */
    /* ------------------------------------------------------------------ */

    {
        const AT = 1786725844000;
        const ID = '01pd200000HjagfAAB';
        const auditRow = (auditId, profile) => ({
            source: 'audit', kind: 'history', type: 'ApexClass', typeLabel: 'Apex Class',
            id: ID, name: 'Test1', at: AT, seen: true, byName: 'Mark Vance',
            auditId: auditId,
            display: 'Changed profile ' + profile + ': Test1 Apex class access was enabled'
        });

        const build = (scope) => {
            const tScope = Object.assign({ bookmarkEvents: [], bookmarkHistory: [],
                                           showBookmarkHistory: true }, scope);
            new Function('$scope', lift('function rebuildTimeline(){') + '\nrebuildTimeline();')(tScope);
            return tScope.bookmarkTimeline.map((e) => e._key);
        };

        /* The reported crash, exactly. */
        const keys = build({
            bookmarkEvents: [{ kind: 'changed', type: 'ApexClass', id: ID, at: AT, name: 'Test1' }],
            bookmarkHistory: [
                auditRow('0Ymd1', 'Customer Community Plus User'),
                auditRow('0Ymd2', 'Partner Community User'),
                auditRow('0Ymd3', 'Gold Partner User'),
                auditRow('0Ymd4', 'Read Only')
            ]
        });
        assert.strictEqual(keys.length, 5, 'all five rows are kept - none is silently dropped');
        assert.strictEqual(new Set(keys).size, 5,
            'and each has its own key, or ngRepeat:dupes takes the panel down: ' + keys.join(', '));

        /*
         * The belt. A source that cannot tell its own events apart still has
         * to produce distinct keys - crashing the page is never the right
         * answer to duplicate data.
         */
        const blind = build({
            bookmarkHistory: [auditRow(null, 'A'), auditRow(null, 'B'), auditRow(null, 'C')]
        });
        assert.strictEqual(new Set(blind).size, blind.length,
            'even with nothing to distinguish them, the keys are unique: ' + blind.join(', '));

        /*
         * Unique is not enough - the key must also be stable.
         *
         * The trailing #index disambiguator makes keys unique whatever the
         * source does, which is why a uniqueness check alone cannot tell
         * whether auditId is being used at all. Its real job is that an event
         * keeps the same key across rebuilds: ngRepeat reuses DOM by key, so a
         * key that moves with position rebuilds every row on every refresh and
         * throws away scroll position and focus with it.
         */
        const first = build({
            bookmarkHistory: [auditRow('0YmdA', 'Alpha'), auditRow('0YmdB', 'Beta')]
        });
        const reordered = build({
            bookmarkHistory: [auditRow('0YmdB', 'Beta'), auditRow('0YmdA', 'Alpha')]
        });

        assert.deepStrictEqual([...first].sort(), [...reordered].sort(),
            'the same two events produce the same two keys whichever order they ' +
            'arrive in - a key that depends on position is not an identity: ' +
            first.join(', ') + '  vs  ' + reordered.join(', '));

        assert.ok(first.every((key) => /0Ymd[AB]$/.test(key)),
            'and the key is built from the audit row id, not from an index: ' + first.join(', '));

        /* And the template actually uses it. */
        assert.ok(/track by event\._key/.test(view),
            'the repeat must track by the computed key');
        assert.ok(!/track by \(event\.id \+ event\.at/.test(view),
            'and not by the expression that collided');
    }

    /* ------------------------------------------------------------------ */
    /* A Watch all that could not fit says so where it was clicked          */
    /*                                                                     */
    /* bookmarkNotice is rendered on the watching list. The button is on a  */
    /* record list, so a refusal set only there is a click that appears to  */
    /* half-work with no explanation anywhere in sight.                     */
    /* ------------------------------------------------------------------ */

    {
        const overCap = harness(150, 100);
        overCap.$scope.watchAllVisible('all');

        assert.strictEqual(overCap.watched.size, 100, 'it fills the list');
        assert.strictEqual(overCap.toasts.length, 1,
            'and reports the ones that would not fit, once');
        assert.strictEqual(overCap.toasts[0].variant, 'warning',
            'as a warning - part of the click did not happen');
        assert.ok(/would not fit/.test(overCap.toasts[0].lines.join(' ')),
            'saying so plainly: ' + overCap.toasts[0].lines.join(' '));
        assert.ok(typeof overCap.toasts[0].action === 'function',
            'and offering the page where the fix is');
    }

    /* A list that fits says nothing - a toast for success is noise. */
    {
        const fits = harness(10, 100);
        fits.$scope.watchAllVisible('all');
        assert.strictEqual(fits.watched.size, 10, 'all ten are watched');
        assert.strictEqual(fits.toasts.length, 0,
            'and nothing is announced - there was nothing to refuse');
    }

    console.log('watch all toggle regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
