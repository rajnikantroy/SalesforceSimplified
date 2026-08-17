/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
// A fixed timezone east of Greenwich, set before anything reads a Date: the
// day-boundary assertions below only mean something where local time and UTC
// disagree about what day it is.
process.env.TZ = 'Asia/Kolkata';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * UsageService regression tests - the numbers behind the Usage Analytics page.
 *
 * Three things here are easy to get wrong and invisible when they are:
 *
 *   - the day key. Counting "days used" against UTC files an Indian morning
 *     under yesterday, so one evening's work shows up as two days;
 *   - which stored counters belong to this org. Classic and Lightning are two
 *     hosts of one org, and matching on the exact origin restarted the tally
 *     every time the user moved between them;
 *   - the arithmetic the page shows: shares must total the whole, and an
 *     unknown feature key must never invent a row.
 */

// Fixed instant: 2026-08-09T20:00:00Z is already 2026-08-10 in Asia/Kolkata.
// A UTC-based day key would call this the 9th.
const FIXED = new Date('2026-08-09T20:00:00Z');

// localStorage outlives a page load; the counters are the whole point.
let store = {};
const localStorageStub = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; }
};

const $q = Object.assign(v => Promise.resolve(v), {
    when: v => Promise.resolve(v),
    reject: v => Promise.reject(v),
    all: obj => {
        const keys = Object.keys(obj);
        return Promise.all(keys.map(k => obj[k])).then(vals => {
            const out = {};
            keys.forEach((k, i) => { out[k] = vals[i]; });
            return out;
        });
    }
});

const sfdc = { get: () => Promise.resolve(null), query: () => Promise.resolve(null) };
const SchemaService = {
    ready: () => Promise.resolve(),
    restCanQuery: () => false,
    toolingCanQuery: () => false
};

/*
 * A page load on `hostname`.
 *
 * ss-core reads window.location once, at evaluation, so the host cannot just
 * be reassigned between scenarios - SS_ORIGIN would keep pointing at whatever
 * host the first load saw, and the org checks would be tested against a value
 * no real page would ever hold. Re-evaluating both files is what a real
 * navigation does; localStorage is what carries across it.
 */
function pageOn(hostname) {
    const factories = {};
    const context = {
        window: { location: { origin: 'https://' + hostname, hostname: hostname } },
        document: { cookie: '' },
        URL: URL,
        localStorage: localStorageStub,
        angular: { module: () => ({ service(name, deps) { factories[name] = deps[deps.length - 1]; } }) },
        Date: class extends Date {
            constructor(...args) {
                if (args.length === 0) { super(FIXED.getTime()); } else { super(...args); }
            }
            static now() { return FIXED.getTime(); }
        }
    };
    vm.runInNewContext(fs.readFileSync('./js/ss-core.js', 'utf8'), context);
    vm.runInNewContext(fs.readFileSync('./js/angular/services/UsageService.js', 'utf8'), context);
    return new factories.UsageService(sfdc, $q, SchemaService);
}

const ORG = 'acme.my.salesforce.com';
const makeService = () => pageOn(ORG);

const STORE_KEY = 'SFDCSimplified_usage_v1';

// Records are stored one key per org; 'acme' is the key ORG reduces to.
function stored(org) {
    return JSON.parse(store[STORE_KEY + '_' + (org || 'acme')]);
}

async function main() {
    /* ---------------------------------------------------------------- */
    /* The day key follows the user's clock, not UTC                     */
    /* ---------------------------------------------------------------- */
    store = {};
    const usage = makeService();
    usage.record('menuOpen');

    const days = Object.keys(stored().days);
    assert.deepStrictEqual(days, ['2026-08-10'],
        "the day key should be the user's local date");
    assert.notStrictEqual(days[0], FIXED.toISOString().slice(0, 10),
        'a UTC day key would file this evening under the previous day');

    /* ---------------------------------------------------------------- */
    /* One org, however the user is looking at it                        */
    /* ---------------------------------------------------------------- */

    // Recorded on Classic above; the user now opens the same org in Lightning.
    assert.strictEqual(pageOn('acme.lightning.force.com').getUsage().totalActions, 1,
        'Classic and Lightning are one org - the tally must carry across');
    assert.strictEqual(pageOn('acme.my.salesforce-setup.com').getUsage().totalActions, 1,
        'Lightning Setup is the same org too');

    // A genuinely different org starts from nothing.
    assert.strictEqual(pageOn('globex.my.salesforce.com').getUsage().totalActions, 0,
        "another org's usage is somebody else's story");

    // Not just visiting it - using it. One shared storage key meant whichever
    // org recorded last overwrote the other, so a developer moving between a
    // sandbox and production watched this page reset every time.
    const other = pageOn('globex.my.salesforce.com');
    other.record('menuOpen');
    other.record('search');
    assert.strictEqual(pageOn(ORG).getUsage().totalActions, 1,
        "using the extension in another org must not wipe this org's counters");
    assert.strictEqual(pageOn('globex.my.salesforce.com').getUsage().totalActions, 2,
        'and the other org keeps its own tally');

    /* ---------------------------------------------------------------- */
    /* Upgrading from the single shared key                              */
    /* ---------------------------------------------------------------- */

    // Someone already using the extension has a record under the old key.
    // It is theirs, and losing it on upgrade would look exactly like the bug
    // the per-org keys were introduced to fix.
    store = {};
    store[STORE_KEY] = JSON.stringify({
        origin: 'https://acme.lightning.force.com',
        firstUsed: FIXED.getTime(),
        counts: { metadataView: 4 },
        days: { '2026-08-01': 4 }
    });
    const upgraded = pageOn(ORG);
    assert.strictEqual(upgraded.getUsage().totalActions, 4,
        'an existing record for this org must survive the move to per-org keys');
    upgraded.record('search');
    assert.strictEqual(stored().counts.metadataView, 4,
        'and carry forward into the org-specific key');

    // A legacy record belonging to a different org is not ours to adopt.
    store = {};
    store[STORE_KEY] = JSON.stringify({
        origin: 'https://globex.my.salesforce.com',
        counts: { metadataView: 99 }, days: { '2026-08-01': 99 }
    });
    assert.strictEqual(pageOn(ORG).getUsage().totalActions, 0,
        "a legacy record from another org must not be claimed as this org's");

    /* ---------------------------------------------------------------- */
    /* The arithmetic the page renders                                   */
    /* ---------------------------------------------------------------- */
    store = {};
    const counted = makeService();
    for (let i = 0; i < 3; i++) { counted.record('metadataView'); }  // 25s each
    counted.record('search');                                        // 15s
    counted.record('nonsenseFeature');                               // ignored

    const report = counted.getUsage();
    assert.strictEqual(report.totalActions, 4, 'only known features are counted');
    assert.strictEqual(report.features.length, 2, 'an unknown key must not invent a row');
    assert.strictEqual(report.mostUsed.key, 'metadataView', 'the most used feature leads');
    assert.strictEqual(report.features[0].count, 3, 'counts accumulate per feature');

    const shareTotal = report.features.reduce((sum, f) => sum + f.share, 0);
    assert.strictEqual(shareTotal, 100, 'shares should account for the whole: ' + shareTotal);

    assert.strictEqual(report.timeSavedSeconds, 3 * 25 + 15, 'time saved is per-feature weight x count');
    assert.strictEqual(report.timeSaved, '2 minutes', 'the figure should be phrased for a human');
    assert.strictEqual(report.activeDays, 1, 'all of this happened on one day');
    assert.strictEqual(report.dailyAverage, 4, 'four actions across one active day');

    /* ---------------------------------------------------------------- */
    /* Nothing recorded yet                                              */
    /* ---------------------------------------------------------------- */
    store = {};
    const fresh = makeService().getUsage();
    assert.strictEqual(fresh.totalActions, 0, 'a fresh org has no actions');
    assert.strictEqual(fresh.mostUsed, null, 'and no most-used feature to name');
    assert.strictEqual(fresh.dailyAverage, 0, 'an average over no days must not divide by zero');
    assert.strictEqual(fresh.timeSaved, '0 seconds', 'and no time saved');

    /* ---------------------------------------------------------------- */
    /* Corrupt storage is not a crash                                    */
    /* ---------------------------------------------------------------- */
    store = {};
    store[STORE_KEY] = '{ not json';
    assert.strictEqual(makeService().getUsage().totalActions, 0,
        'unreadable storage should start over rather than throw');

    /* ---------------------------------------------------------------- */
    /* Streaks                                                           */
    /*                                                                   */
    /* Read out of the day tally, so the arithmetic that matters is the  */
    /* walk backwards through dates: month ends, leap days and the days  */
    /* either side of a clock change all have to join up, or a run       */
    /* breaks on a day the user did nothing wrong.                       */
    /* ---------------------------------------------------------------- */

    // FIXED is 2026-08-09T20:00:00Z, which in Asia/Kolkata is 2026-08-10.
    const onDays = (...keys) => keys.reduce((acc, k) => { acc[k] = 1; return acc; }, {});
    function withDays(dayMap) {
        store = {};
        store[STORE_KEY + '_acme'] = JSON.stringify({
            origin: 'https://acme.my.salesforce.com', counts: { menuOpen: 1 }, days: dayMap
        });
        return pageOn(ORG).getStreak();
    }

    let streak = withDays(onDays('2026-08-08', '2026-08-09', '2026-08-10'));
    assert.strictEqual(streak.current, 3, 'three consecutive days, ending today');
    assert.strictEqual(streak.activeToday, true, 'and today is one of them');

    /*
     * Not used yet today. The run is not broken - the day is not over - so it
     * still counts, and the page says it needs keeping up rather than
     * announcing it is gone.
     */
    streak = withDays(onDays('2026-08-07', '2026-08-08', '2026-08-09'));
    assert.strictEqual(streak.current, 3, 'a run through yesterday is still alive today');
    assert.strictEqual(streak.activeToday, false, 'but today has not been kept up yet');

    // A missed day ends it.
    streak = withDays(onDays('2026-08-05', '2026-08-06', '2026-08-08'));
    assert.strictEqual(streak.current, 0,
        'nothing yesterday or today means no run');
    assert.strictEqual(streak.longest, 2, 'the best run is still remembered');

    // Month end, which naive string arithmetic gets wrong.
    streak = withDays(onDays('2026-07-30', '2026-07-31', '2026-08-01'));
    assert.strictEqual(streak.longest, 3, 'a run must survive the end of a month');

    // Leap day, likewise.
    streak = withDays(onDays('2024-02-28', '2024-02-29', '2024-03-01'));
    assert.strictEqual(streak.longest, 3, 'and a leap day');

    /* ---------------------------------------------------------------- */
    /* Something to aim at                                               */
    /* ---------------------------------------------------------------- */
    streak = withDays(onDays('2026-08-08', '2026-08-09', '2026-08-10'));
    assert.strictEqual(streak.milestone, 3, 'three days is the first milestone');
    assert.strictEqual(streak.next, 7, 'and seven is the next');
    assert.strictEqual(streak.toNext, 4, 'four days away');

    streak = withDays({});
    assert.strictEqual(streak.current, 0, 'a fresh org has no run');
    assert.strictEqual(streak.longest, 0, 'and no best');
    assert.strictEqual(streak.milestone, 0, 'and no milestone');
    assert.strictEqual(streak.next, 3, 'the first one is still ahead');

    /* ---------------------------------------------------------------- */
    /* The fortnight strip                                               */
    /* ---------------------------------------------------------------- */
    streak = withDays(onDays('2026-08-08', '2026-08-10'));
    assert.strictEqual(streak.strip.length, 14, 'the strip covers a fortnight');
    assert.strictEqual(streak.strip[13].day, '2026-08-10', 'ending today');
    assert.strictEqual(streak.strip[0].day, '2026-07-28', 'and starting thirteen days back');
    assert.strictEqual(streak.strip[13].active, true, 'today was used');
    assert.strictEqual(streak.strip[12].active, false, 'yesterday was not');
    assert.strictEqual(streak.strip[11].active, true, 'the day before was');

    /* ---------------------------------------------------------------- */
    /* Adaptive launcher opacity                                         */
    /* ---------------------------------------------------------------- */
    const ADAPT_KEY = 'SFDCSimplified_opacity_adapt_v1';
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const NOW = FIXED.getTime();

    // Within the week nothing moves, however much has been done.
    store = {};
    store[ADAPT_KEY] = JSON.stringify({ reviewedAt: NOW - (2 * 24 * 60 * 60 * 1000), actions: 40 });
    let review = pageOn(ORG).reviewOpacity(100);
    assert.strictEqual(review.changed, false, 'reviews happen weekly, not on every page load');
    assert.strictEqual(review.opacity, 100, 'and leave the value alone in between');

    // A week of use fades it one step.
    store = {};
    store[ADAPT_KEY] = JSON.stringify({ reviewedAt: NOW - WEEK, actions: 12 });
    review = pageOn(ORG).reviewOpacity(100);
    assert.strictEqual(review.opacity, 90, 'a week of use should fade the launcher by one step');
    assert.strictEqual(review.direction, 'down');
    assert.strictEqual(review.active, true);

    // A week of near-silence counts as not using it, and brightens.
    store = {};
    store[ADAPT_KEY] = JSON.stringify({ reviewedAt: NOW - WEEK, actions: 1 });
    review = pageOn(ORG).reviewOpacity(60);
    assert.strictEqual(review.opacity, 70,
        'a single glance is not use - the launcher should brighten');
    assert.strictEqual(review.direction, 'up');

    // Several quiet weeks brighten by several steps, so a forgotten launcher
    // is properly visible on the day the user comes back.
    store = {};
    store[ADAPT_KEY] = JSON.stringify({ reviewedAt: NOW - (3 * WEEK), actions: 0 });
    assert.strictEqual(pageOn(ORG).reviewOpacity(50).opacity, 80,
        'three unused weeks should brighten by three steps');

    // The band holds at both ends.
    store = {};
    store[ADAPT_KEY] = JSON.stringify({ reviewedAt: NOW - WEEK, actions: 50 });
    assert.strictEqual(pageOn(ORG).reviewOpacity(30).opacity, 30,
        'a daily user must not fade the launcher out of existence');
    store = {};
    store[ADAPT_KEY] = JSON.stringify({ reviewedAt: NOW - (9 * WEEK), actions: 0 });
    assert.strictEqual(pageOn(ORG).reviewOpacity(100).opacity, 100,
        'and an unused one must not exceed fully opaque');

    // A review consumes the week: the next page load must not fade it again.
    store = {};
    store[ADAPT_KEY] = JSON.stringify({ reviewedAt: NOW - WEEK, actions: 12 });
    const svc = pageOn(ORG);
    assert.strictEqual(svc.reviewOpacity(100).opacity, 90, 'first review of the week applies');
    assert.strictEqual(pageOn(ORG).reviewOpacity(90).changed, false,
        'a second look in the same week must not apply a second step');

    // Recording an action feeds the next review.
    store = {};
    store[ADAPT_KEY] = JSON.stringify({ reviewedAt: NOW - WEEK, actions: 0 });
    const counting = pageOn(ORG);
    counting.record('metadataView');
    counting.record('search');
    counting.record('menuOpen');
    assert.strictEqual(JSON.parse(store[ADAPT_KEY]).actions, 3,
        'recorded actions should count towards the weekly review');

    // Setting opacity by hand restarts the week from that value.
    store = {};
    store[ADAPT_KEY] = JSON.stringify({ reviewedAt: NOW - (2 * WEEK), actions: 0 });
    const manual = pageOn(ORG);
    manual.noteOpacitySetManually();
    assert.strictEqual(manual.reviewOpacity(45).changed, false,
        'a value the user just chose must not be overwritten by an overdue review');

    /* ---------------------------------------------------------------- */
    /* Org figures settle rather than reject                             */
    /* ---------------------------------------------------------------- */
    const org = await makeService().getOrgUsage();
    assert.ok(org && typeof org === 'object', 'getOrgUsage must always settle to an object');
    assert.strictEqual(org.adoption, undefined,
        'adoption needs both halves known - it must not be invented from nulls');

    console.log('usage service regression test passed');
}

main().catch(function(error) {
    console.error(error);
    process.exitCode = 1;
});
