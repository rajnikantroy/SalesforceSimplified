/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * The off-hours nudge, and everything it must refuse to do.
 *
 * This is the one thing in the extension that interrupts someone who did not
 * ask for anything, so the interesting cases are all the ones where it stays
 * quiet. Getting the gates wrong is not a cosmetic bug - it is a notification
 * at 3am, or the same notification every hour, and the user's remedy for that
 * is to uninstall.
 *
 * The service worker is loaded whole with chrome stubbed, so the rules under
 * test are the ones that will actually ship rather than a copy of them.
 */

const source = fs.readFileSync('./js/background.js', 'utf8');

function makeWorker(options) {
    const opts = options || {};
    const storage = Object.assign({}, opts.storage);
    const notifications = [];
    const listeners = {};

    const chromeStub = {
        runtime: {
            lastError: null,
            getURL: (p) => 'chrome-extension://x' + p,
            onInstalled: { addListener: (fn) => { listeners.installed = fn; } },
            onStartup: { addListener: (fn) => { listeners.startup = fn; } },
            onMessage: { addListener: () => {} }
        },
        commands: { onCommand: { addListener: () => {} } },
        storage: {
            local: {
                get: (keys, cb) => {
                    const out = {};
                    const list = Array.isArray(keys) ? keys : [keys];
                    for (const k of list) { if (k in storage) { out[k] = storage[k]; } }
                    cb(out);
                },
                set: (items, cb) => { Object.assign(storage, items); if (cb) { cb(); } },
                remove: (k, cb) => { delete storage[k]; if (cb) { cb(); } }
            }
        },
        alarms: { create: () => {}, onAlarm: { addListener: (fn) => { listeners.alarm = fn; } } },
        notifications: {
            create: (id, spec, cb) => { notifications.push({ id, spec }); if (cb) { cb(id); } },
            clear: (id, cb) => { if (cb) { cb(true); } },
            onClicked: { addListener: (fn) => { listeners.clicked = fn; } }
        },
        tabs: {
            query: (q, cb) => cb(opts.tabs || []),
            update: (id, p, cb) => cb && cb(),
            create: (p, cb) => cb && cb({ id: 99 }),
            sendMessage: (id, m, cb) => { (opts.sent || []).push(m); if (cb) { cb(); } },
            onUpdated: { addListener: () => {}, removeListener: () => {} }
        },
        windows: { update: (id, p, cb) => cb && cb() },
        identity: {},
        action: { onClicked: { addListener: (fn) => { listeners.action = fn; } } },
        cookies: {
            get: (details, cb) => {
                (opts.cookieAsks || []).push(details);
                cb(opts.cookie === undefined ? { value: 'SID-VALUE' } : opts.cookie);
            },
            /*
             * getAll, because the worker reads sessions that way now: a URL
             * can match several sid cookies and only one of them is the
             * org's, so the choice has to be made rather than left to
             * cookies.get's tie-break. The stub gives each cookie the host
             * it belongs to, which is what that choice is made on.
             */
            getAll: (details, cb) => {
                (opts.cookieAsks || []).push(details);
                const found = opts.cookie === undefined
                    ? { value: 'SID-VALUE' } : opts.cookie;
                if (!found) { return cb([]); }
                const jar = Array.isArray(found) ? found : [found];
                cb(jar.map((cookie) => Object.assign(
                    { domain: new URL(details.url).hostname, path: '/' }, cookie)));
            }
        }
    };

    const context = {
        chrome: chromeStub,
        console,
        fetch: opts.fetch || (() => Promise.reject(new Error('no network'))),
        crypto: { getRandomValues: (a) => a, subtle: { digest: async () => new ArrayBuffer(32) } },
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        TextEncoder,
        URL,
        Date,
        setTimeout, clearTimeout
    };
    vm.createContext(context);
    vm.runInContext(source, context);

    return { context, storage, notifications, listeners };
}

const HEALTHY = { key: 'SWE126', status: 'OK', Incidents: [], Maintenances: [] };
const INCIDENT = { key: 'SWE126', status: 'MINOR_INCIDENT_CORE',
                   Incidents: [{ id: 1 }], Maintenances: [] };

function okFetch(doc) {
    return () => Promise.resolve({ ok: true, json: async () => doc });
}

// A brief as the content script would have left it: idle long enough to nudge.
function brief(overrides) {
    return {
        acme: Object.assign({
            origin: 'https://acme.my.salesforce.com',
            instanceKey: 'SWE126',
            alias: 'acme',
            lastActiveAt: Date.now() - 8 * 60 * 60 * 1000,
            updatedAt: Date.now() - 8 * 60 * 60 * 1000,
            headlines: [{ text: '3 Apex classes changed today', timestamp: Date.now() - 3600000 }]
        }, overrides)
    };
}

// Fire the alarm and let the async work settle.
async function tick(worker) {
    worker.listeners.alarm({ name: 'ss-offhours-nudge' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
}

/*
 * isOffHours is time-of-day logic, so it is exercised directly rather than by
 * moving the system clock.
 */
function offHoursAt(worker, day, hour) {
    const d = new Date(2026, 7, 10 + day, hour, 0, 0); // 2026-08-10 is a Monday
    return worker.context.isOffHours(d);
}

async function main() {
    const w = makeWorker({});

    /* ---------------------------------------------------------------- */
    /* When it is off-hours                                              */
    /* ---------------------------------------------------------------- */

    assert.strictEqual(offHoursAt(w, 0, 13), false, 'Monday lunchtime is working hours');
    assert.strictEqual(offHoursAt(w, 0, 9),  false, 'the working day starts at 9');
    assert.strictEqual(offHoursAt(w, 0, 17), false, '5pm is still the working day');
    assert.strictEqual(offHoursAt(w, 0, 19), true,  '7pm on a weekday is off-hours');
    assert.strictEqual(offHoursAt(w, 0, 8),  true,  '8am is before the working day');
    assert.strictEqual(offHoursAt(w, 5, 13), true,  'Saturday is off-hours all day');
    assert.strictEqual(offHoursAt(w, 6, 13), true,  'Sunday is off-hours all day');

    // The quiet hours override everything, weekend included.
    assert.strictEqual(offHoursAt(w, 0, 23), false, '11pm must be quiet');
    assert.strictEqual(offHoursAt(w, 0, 3),  false, '3am must be quiet');
    assert.strictEqual(offHoursAt(w, 5, 2),  false, '2am on a Saturday must be quiet too');

    /* ---------------------------------------------------------------- */
    /* It says something when there is something to say                  */
    /* ---------------------------------------------------------------- */

    const ok = makeWorker({ storage: { ssBrief: brief(), ssNotifyPrefs: { enabled: true } }, fetch: okFetch(INCIDENT) });
    // Force the clock check to pass so the rest of the gate is what is tested.
    ok.context.isOffHours = () => true;
    await tick(ok);
    assert.strictEqual(ok.notifications.length, 1, 'an idle user out of hours should get one nudge');
    const message = ok.notifications[0].spec.message;
    assert.ok(/SWE126/.test(message), 'the nudge should name the instance: ' + message);
    assert.ok(/incident/i.test(message), 'and report the incident: ' + message);
    assert.ok(/Apex classes changed/.test(message), 'and carry the org headline: ' + message);

    /* ---------------------------------------------------------------- */
    /* And stays quiet when it does not                                  */
    /* ---------------------------------------------------------------- */

    // Recently active: they are using it, so there is nothing to nudge about.
    const busy = makeWorker({
        storage: { ssBrief: brief({ lastActiveAt: Date.now() - 5 * 60 * 1000 }),
                   ssNotifyPrefs: { enabled: true } },
        fetch: okFetch(INCIDENT)
    });
    busy.context.isOffHours = () => true;
    await tick(busy);
    assert.strictEqual(busy.notifications.length, 0,
        'someone who used it five minutes ago must not be nudged');

    // Already nudged today.
    const recent = makeWorker({
        storage: { ssBrief: brief(), ssLastNudgeAt: Date.now() - 60 * 60 * 1000,
                   ssNotifyPrefs: { enabled: true } },
        fetch: okFetch(INCIDENT)
    });
    recent.context.isOffHours = () => true;
    await tick(recent);
    assert.strictEqual(recent.notifications.length, 0,
        'a second nudge within the minimum gap must not be sent');

    // Never used the extension - nothing recorded, so nothing to report on.
    const stranger = makeWorker({ storage: { ssNotifyPrefs: { enabled: true } }, fetch: okFetch(INCIDENT) });
    stranger.context.isOffHours = () => true;
    await tick(stranger);
    assert.strictEqual(stranger.notifications.length, 0,
        'a user with no recorded org must not be nudged');

    // Trust unreachable and no recent headline: nothing worth saying.
    const silent = makeWorker({
        storage: { ssBrief: brief({ headlines: [] }), ssNotifyPrefs: { enabled: true } },
        fetch: () => Promise.reject(new Error('offline'))
    });
    silent.context.isOffHours = () => true;
    await tick(silent);
    assert.strictEqual(silent.notifications.length, 0,
        'with nothing to report the nudge must be skipped, not sent empty');

    // Stale headlines (older than a day) are not "what happened today".
    const stale = makeWorker({
        storage: { ssBrief: brief({
            headlines: [{ text: 'last week news', timestamp: Date.now() - 5 * 86400000 }]
        }), ssNotifyPrefs: { enabled: true } },
        fetch: () => Promise.reject(new Error('offline'))
    });
    stale.context.isOffHours = () => true;
    await tick(stale);
    assert.strictEqual(stale.notifications.length, 0,
        'a headline from last week must not be presented as today\'s news');

    // A healthy org still has something to say, so the nudge is allowed.
    const healthy = makeWorker({
        storage: { ssBrief: brief({ headlines: [] }), ssNotifyPrefs: { enabled: true } },
        fetch: okFetch(HEALTHY)
    });
    healthy.context.isOffHours = () => true;
    await tick(healthy);
    assert.strictEqual(healthy.notifications.length, 1, 'a healthy instance is still worth one line');
    assert.ok(/healthy/i.test(healthy.notifications[0].spec.message),
        'and should say so: ' + healthy.notifications[0].spec.message);

    /* ---------------------------------------------------------------- */
    /* The user's choices are obeyed                                     */
    /*                                                                    */
    /* A category switched off must not merely be hidden from the panel;  */
    /* it must not be a reason to interrupt anyone. These are the         */
    /* settings' whole purpose, so they are checked at the point that     */
    /* actually decides - the service worker, not the checkbox.           */
    /* ---------------------------------------------------------------- */

    const limitsBrief = () => brief({
        headlines: [{ text: '86% of data storage used', timestamp: Date.now() - 3600000,
                      category: 'storage' }]
    });

    // Master switch off: nothing at all, however much there is to say.
    const muted = makeWorker({
        storage: { ssBrief: limitsBrief(), ssNotifyPrefs: { enabled: false } },
        fetch: okFetch(INCIDENT)
    });
    muted.context.isOffHours = () => true;
    await tick(muted);
    assert.strictEqual(muted.notifications.length, 0,
        'with notifications off, nothing may be sent');

    // Storage alerts off, and storage is the only thing to report.
    const noStorage = makeWorker({
        storage: { ssBrief: limitsBrief(),
                   ssNotifyPrefs: { enabled: true, trust: false, storage: false } },
        fetch: okFetch(INCIDENT)
    });
    noStorage.context.isOffHours = () => true;
    await tick(noStorage);
    assert.strictEqual(noStorage.notifications.length, 0,
        'a storage headline must not be sent when storage alerts are switched off');

    // Same headline, storage alerts on.
    const wantStorage = makeWorker({
        storage: { ssBrief: limitsBrief(),
                   ssNotifyPrefs: { enabled: true, trust: false, storage: true } },
        fetch: okFetch(INCIDENT)
    });
    wantStorage.context.isOffHours = () => true;
    await tick(wantStorage);
    assert.strictEqual(wantStorage.notifications.length, 1,
        'a storage headline should be sent when storage alerts are on');
    assert.ok(/data storage/.test(wantStorage.notifications[0].spec.message),
        'and should be the storage line: ' + wantStorage.notifications[0].spec.message);

    // Trust off means the instance line is dropped even during an incident.
    const noTrust = makeWorker({
        storage: { ssBrief: brief(), ssNotifyPrefs: { enabled: true, trust: false } },
        fetch: okFetch(INCIDENT)
    });
    noTrust.context.isOffHours = () => true;
    await tick(noTrust);
    assert.strictEqual(noTrust.notifications.length, 1, 'the org headline still qualifies');
    assert.ok(!/incident/i.test(noTrust.notifications[0].spec.message),
        'but the Trust line must be absent: ' + noTrust.notifications[0].spec.message);

    /* ---------------------------------------------------------------- */
    /* The test button                                                   */
    /*                                                                    */
    /* It must bypass the timing gates - it was asked for, so quiet hours */
    /* and the idle threshold do not apply - while still obeying the      */
    /* preferences, and without consuming the day's real nudge.           */
    /* ---------------------------------------------------------------- */

    const tester = makeWorker({
        storage: { ssBrief: brief({ lastActiveAt: Date.now() }),      // active right now
                   ssNotifyPrefs: { enabled: true } },
        fetch: okFetch(HEALTHY)
    });
    tester.context.isOffHours = () => false;                          // and mid-afternoon
    let result = await tester.context.sendTestNudge();
    assert.strictEqual(result.ok, true, 'a requested test must fire regardless of the clock');
    assert.strictEqual(tester.notifications.length, 1, 'and show exactly one notification');
    assert.ok(!('ssLastNudgeAt' in tester.storage),
        'a test must not consume the daily nudge allowance');

    // Off means off, even for the test.
    const testerOff = makeWorker({
        storage: { ssBrief: brief(), ssNotifyPrefs: { enabled: false } },
        fetch: okFetch(HEALTHY)
    });
    result = await testerOff.context.sendTestNudge();
    assert.strictEqual(result.ok, false, 'the test must refuse while notifications are off');
    assert.strictEqual(testerOff.notifications.length, 0, 'and show nothing');

    // Nothing recorded yet: say so rather than failing silently.
    const testerEmpty = makeWorker({ storage: { ssNotifyPrefs: { enabled: true } }, fetch: okFetch(HEALTHY) });
    result = await testerEmpty.context.sendTestNudge();
    assert.strictEqual(result.ok, false, 'with no org recorded the test cannot run');
    assert.ok(/open a panel/i.test(result.error || ''), 'and should say what to do: ' + result.error);

    // A quiet org still shows something, so the test always demonstrates.
    const testerQuiet = makeWorker({
        storage: { ssBrief: brief({ headlines: [] }),
                   ssNotifyPrefs: { enabled: true, trust: false } },
        fetch: () => Promise.reject(new Error('offline'))
    });
    result = await testerQuiet.context.sendTestNudge();
    assert.strictEqual(result.ok, true, 'a test with nothing to report should still show a notification');
    assert.strictEqual(testerQuiet.notifications.length, 1, 'so the user can see what one looks like');

    /* ---------------------------------------------------------------- */
    /* Clicking it opens the panel                                       */
    /* ---------------------------------------------------------------- */

    const sent = [];
    const clicker = makeWorker({
        storage: { ssNudgeOrigin: 'https://acme.my.salesforce.com' },
        tabs: [{ id: 7, windowId: 1 }],
        sent: sent
    });
    clicker.listeners.clicked('ss-offhours');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.ok(sent.some((m) => m && m.type === 'SS_OPEN_PANEL'),
        'clicking the notification must tell the content script to open the panel');

    // A click on somebody else's notification is not ours to act on.
    const other = [];
    const foreign = makeWorker({
        storage: { ssNudgeOrigin: 'https://acme.my.salesforce.com' },
        tabs: [{ id: 7, windowId: 1 }],
        sent: other
    });
    foreign.listeners.clicked('some-other-extension-notification');
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(other.length, 0, 'another notification\'s click must be ignored');

    /* ---------------------------------------------------------------- */
    /* The standalone page's session                                     */
    /*                                                                    */
    /* readOrgSession hands back a Salesforce bearer token, so the        */
    /* interesting cases are the ones where it must refuse. A relay that  */
    /* reads whatever cookie it is asked for is a way to lift a session   */
    /* off any site the user happens to be signed in to.                  */
    /* ---------------------------------------------------------------- */

    const asks = [];
    const cookies = makeWorker({ cookieAsks: asks });

    assert.strictEqual(await cookies.context.readOrgSession('https://acme.my.salesforce.com'), 'SID-VALUE',
        'a Salesforce my-domain should yield its sid');
    assert.strictEqual(await cookies.context.readOrgSession('https://acme.lightning.force.com'), 'SID-VALUE',
        'a Lightning host should too');

    for (const hostile of [
        'https://evil.com',
        'https://salesforce.com.evil.com',
        'https://not-salesforce.com',
        'http://acme.my.salesforce.com.attacker.net',
        'javascript:alert(1)',
        'not a url'
    ]) {
        assert.strictEqual(await cookies.context.readOrgSession(hostile), null,
            `readOrgSession must refuse ${hostile}`);
    }
    assert.ok(asks.every((a) => /salesforce\.com|force\.com/.test(a.url)),
        'no cookie lookup should ever have been attempted for a non-Salesforce host');

    // A missing cookie is a missing session, not an error.
    const noCookie = makeWorker({ cookie: null });
    assert.strictEqual(await noCookie.context.readOrgSession('https://acme.my.salesforce.com'), null,
        'no sid present should resolve to null');

    /* ---------------------------------------------------------------- */
    /* Orgs are offered newest-first                                     */
    /* ---------------------------------------------------------------- */

    const older = Date.now() - 90 * 60 * 1000;
    const orgsWorker = makeWorker({ storage: { ssBrief: {
        stale: { origin: 'https://stale.my.salesforce.com', updatedAt: older },
        fresh: { origin: 'https://fresh.my.salesforce.com', updatedAt: Date.now(), instanceKey: 'EU12' },
        broken: { updatedAt: Date.now() }        // never recorded an origin
    } } });
    const orgs = await orgsWorker.context.knownOrgs();
    // Array.from rebuilds it in this realm: the worker runs in a vm context,
    // so its arrays have a different Array.prototype and deepStrictEqual - a
    // prototype-aware comparison - would fail on identical contents.
    assert.deepStrictEqual(Array.from(orgs, (o) => o.origin),
        ['https://fresh.my.salesforce.com', 'https://stale.my.salesforce.com'],
        'orgs should be newest-first, and one with no origin is not an org');
    assert.strictEqual(orgs[0].instanceKey, 'EU12', 'the instance key should come along for the label');

    /* ---------------------------------------------------------------- */
/* Off until switched on                                             */
/*                                                                    */
/* A notification interrupts someone who did not ask for anything, so */
/* nobody gets one because a default said so. Absent preferences mean */
/* never asked, which must read as "no".                              */
/* ---------------------------------------------------------------- */

const untouched = makeWorker({ storage: { ssBrief: brief() }, fetch: okFetch(INCIDENT) });
untouched.context.isOffHours = () => true;
await tick(untouched);
assert.strictEqual(untouched.notifications.length, 0,
    'with no stored preferences at all, nothing may be sent');

// And the test button refuses for the same reason.
const untouchedTest = makeWorker({ storage: { ssBrief: brief() }, fetch: okFetch(HEALTHY) });
const untouchedResult = await untouchedTest.context.sendTestNudge();
assert.strictEqual(untouchedResult.ok, false,
    'the test must refuse until notifications have been switched on');
assert.strictEqual(untouchedTest.notifications.length, 0, 'and show nothing');

console.log('off-hours nudge regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
