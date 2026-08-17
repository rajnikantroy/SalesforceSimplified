/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * Trust Service regression tests.
 *
 * The Trust Status panel resolves the org's instance key from Organization,
 * then pulls that instance's status from the public Trust API. Two things can
 * go wrong in ways worth pinning down:
 *
 *   - the API must settle, never reject - a blocked endpoint or a missing
 *     InstanceName should resolve to { error } so the panel can render it;
 *   - the raw Trust document must be normalized into exactly what the panel
 *     renders, so the view never has to know the API's shape.
 */

const moduleObj = {};
const factories = {};
const context = {
    window: {},
    angular: { module: () => ({ service(name, deps) { factories[name] = deps[deps.length - 1]; } }) }
};

const $q = Object.assign(v => Promise.resolve(v), {
    when: v => Promise.resolve(v),
    reject: v => Promise.reject(v),
    all: list => Promise.all(list),
    defer() {
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
    }
});

/*
 * jQuery stub: $.ajax(config) -> { done, fail }, driven by the test.
 *
 * The two Trust endpoints are answered separately. loadStatus reaches the
 * alias endpoint only after the instance-key lookup has failed, so a single
 * shared outcome could not express "the key lookup failed and the fallback
 * did too", which is the case that has to keep reporting the original error.
 */
let ajaxResult = null;
let ajaxError = null;
let aliasResult = null;
let aliasError = 'not configured';   // fallback off unless a test asks for it
let ajaxCalls = 0;
let aliasCalls = 0;
let lastAjaxUrl = '';
const isAliasUrl = (url) => url.indexOf('instanceAliases/') !== -1;
const $ = {
    ajax(config) {
        lastAjaxUrl = config.url;
        const alias = isAliasUrl(config.url);
        if (alias) { aliasCalls++; } else { ajaxCalls++; }
        const failed = alias ? aliasError : ajaxError;
        const payload = alias ? aliasResult : ajaxResult;
        return {
            done(fn) { if (failed === null && payload !== undefined) { fn(payload); } return this; },
            fail(fn) { if (failed !== null) { fn({ status: alias ? 404 : 503 }); } return this; }
        };
    }
};
context.$ = $;

// sfdc stub: sfdc.query(soql) resolves/rejects per test setup.
let lastQuery = '';
let queryResult = null;
let queryError = null;
const sfdc = {
    query(soql) {
        lastQuery = soql;
        if (queryError) { return Promise.reject(queryError); }
        return Promise.resolve(queryResult);
    },
    // TrustService defers to SfdcApi to phrase a query rejection that carries
    // no message of its own, rather than inventing one about the Trust API.
    errorMessage(rejection) {
        if (rejection && rejection.noSession) { return 'Unable to fetch session id.'; }
        return null;
    }
};

// TrustService trims incident text with ssTruncate, which ss-core owns - the
// footer ticker trims the same text to a shorter length. Load the real thing
// rather than a stub, so the two callers are checked against one implementation.
vm.runInNewContext(
    fs.readFileSync('./js/ss-core.js', 'utf8'),
    Object.assign(context, {
        window: { location: { origin: 'https://example.my.salesforce.com', hostname: 'example.my.salesforce.com' } },
        document: { cookie: '' },
        URL: URL
    })
);

vm.runInNewContext(
    fs.readFileSync('./js/angular/services/TrustService.js', 'utf8'),
    context
);

const TrustService = new factories.TrustService($q, sfdc);

// The instance key is memoised per service instance, so each loadStatus
// scenario gets a fresh instance to avoid reusing an earlier key.
const makeService = () => new factories.TrustService($q, sfdc);

const STATUS_DOC = {
    key: 'NA238',
    location: 'NA',
    status: 'MINOR_INCIDENT_CORE',
    maintenanceWindow: 'Saturdays 07:00 PM - 11:00 PM PST',
    Incidents: [{
        id: 1,
        isCore: true,
        serviceKeys: ['coreService', 'SignIn'],
        IncidentEvents: [
            { id: 10, type: 'investigating', message: 'We are investigating reports of latency on the core service.', createdAt: '2026-07-08T21:17:00.000Z' },
            { id: 11, type: 'update', message: 'Root cause identified; impact limited to a subset of customers.', createdAt: '2026-07-08T21:30:00.000Z' }
        ],
        createdAt: '2026-07-08T21:17:00.000Z'
    }],
    Maintenances: [{
        id: 7,
        name: 'Scheduled core maintenance',
        releaseType: 'Major',
        status: 'confirmed',
        plannedStartTime: '2026-08-15T02:00:00.000Z',
        plannedEndTime: '2026-08-15T06:00:00.000Z',
        isCore: true
    }],
    GeneralMessages: [{
        id: 3,
        subject: 'Summer \'26',
        body: 'This instance was updated.',
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: null
    }]
};

async function main() {
    // 1. Normalization: getStatus(key) against a known key.
    ajaxError = null;
    ajaxResult = STATUS_DOC;
    ajaxCalls = 0;
    const status = await TrustService.getStatus('NA238');
    assert.ok(!status.error, 'a healthy call should carry no error');
    assert.strictEqual(status.key, 'NA238', 'the instance key should survive normalization');
    assert.strictEqual(status.location, 'NA', 'the location should survive normalization');
    assert.strictEqual(status.status, 'MINOR_INCIDENT_CORE', 'the raw status should survive normalization');
    assert.strictEqual(ajaxCalls, 1, 'one status fetch per call');
    assert.ok(lastAjaxUrl.indexOf('NA238/status') !== -1, 'the fetch should target the instance status endpoint');

    assert.strictEqual(status.incidents.length, 1, 'incidents should map through');
    const incident = status.incidents[0];
    assert.strictEqual(incident.severity, 'update', 'severity should be the latest event type');
    assert.strictEqual(incident.message, 'Root cause identified; impact limited to a subset of customers.',
        'the visible message should be the latest event message');
    assert.strictEqual(incident.createdAt, '2026-07-08T21:30:00.000Z',
        'createdAt should come from the latest event');
    assert.deepStrictEqual(incident.serviceKeys, ['coreService', 'SignIn'],
        'service keys should be preserved for the caption');
    assert.strictEqual(incident.isCore, true, 'isCore should be preserved');

    assert.strictEqual(status.messages.length, 1, 'general messages should map through');
    assert.strictEqual(status.messages[0].subject, 'Summer \'26', 'message subject should survive');
    assert.strictEqual(status.messages[0].body, 'This instance was updated.', 'message body should survive');

    assert.strictEqual(status.maintenances.length, 1, 'maintenances should map through');
    assert.strictEqual(status.maintenances[0].name, 'Scheduled core maintenance', 'maintenance name should survive');
    assert.strictEqual(status.maintenances[0].plannedStartTime, '2026-08-15T02:00:00.000Z', 'planned window should survive');

    // 2. Long incident messages are truncated for the panel but kept whole.
    // Comfortably past the sanity bound, so this exercises the trim rather
    // than sliding under it - at ~300 it did neither once the bound moved.
    const LONG = new Array(200).join('word ') + 'tail'; // ~1000 chars
    ajaxResult = Object.assign({}, STATUS_DOC, {
        Incidents: [{ id: 2, isCore: true, IncidentEvents: [
            { id: 20, type: 'investigating', message: LONG, createdAt: '2026-07-08T21:17:00.000Z' }
        ], createdAt: '2026-07-08T21:17:00.000Z' }]
    });
    const longStatus = await TrustService.getStatus('NA238');
    assert.strictEqual(longStatus.incidents[0].fullMessage, LONG,
        'the full message should be kept for the tooltip');
    assert.ok(longStatus.incidents[0].message.length <= 240, 'the visible copy should be capped');
    assert.ok(longStatus.incidents[0].message.indexOf('…') !== -1, 'a truncated message should end with an ellipsis');

    // 3. Failure settles: a rejected ajax resolves to { error }.
    ajaxResult = undefined;
    ajaxError = {};
    const failed = await TrustService.getStatus('NA238');
    assert.ok(failed.error, 'an unreachable API should resolve to an error, not reject');
    assert.ok(/Trust API unreachable/.test(failed.error), 'the error should say what happened');

    // 4. loadStatus: resolves the instance key, then fetches its status.
    ajaxError = null;
    ajaxResult = STATUS_DOC;
    queryError = null;
    queryResult = { records: [{ Id: '00Dx', InstanceName: 'NA238' }] };
    const loaded = await makeService().loadStatus();
    assert.ok(!loaded.error, 'a full load should carry no error');
    assert.strictEqual(loaded.key, 'NA238', 'loadStatus should follow the instance key to the status feed');
    assert.ok(/InstanceName/.test(lastQuery), 'the key should be resolved from Organization.InstanceName');

    // 5. A missing InstanceName never fetches by key - there is no key to
    //    fetch by. With the alias fallback unavailable it settles with an
    //    error, as it always did.
    ajaxCalls = 0;
    aliasCalls = 0;
    aliasError = 'unavailable';
    queryError = null;
    queryResult = { records: [{ Id: '00Dx' }] };
    const noKey = await makeService().loadStatus();
    assert.ok(noKey.error, 'an org without an instance key, and no alias to fall back to, should resolve to an error');
    assert.strictEqual(ajaxCalls, 0, 'no status fetch should happen without a key');

    // 6. A failed key query, with the fallback also failing, settles with the
    //    error from the query rather than the one from the fallback.
    queryError = { message: 'insufficient permissions' };
    queryResult = null;
    const noPerms = await makeService().loadStatus();
    assert.strictEqual(noPerms.error, 'insufficient permissions',
        'the underlying error should surface, not the fallback\'s own HTTP failure');

    /*
     * 6a. The signed-out path: no session to resolve the instance key, but
     *     the Trust API can answer for the org's My Domain on its own.
     *
     * This is what makes Trust Status the panel the signed-out notice sends
     * people to. Without it that notice is an invitation to an error message.
     */
    ajaxCalls = 0;
    aliasCalls = 0;
    aliasError = null;
    aliasResult = STATUS_DOC;
    queryError = { noSession: true };
    queryResult = null;
    const signedOut = await makeService().loadStatus();
    assert.ok(!signedOut.error,
        'with no session, loadStatus should still resolve through the My Domain alias: ' + signedOut.error);
    assert.strictEqual(signedOut.key, 'NA238', 'and normalize the alias document the same way');
    assert.strictEqual(aliasCalls, 1, 'the alias endpoint should be tried exactly once');
    assert.ok(/instanceAliases\/example\/status$/.test(lastAjaxUrl),
        'the alias should come from the org host (example.my.salesforce.com): ' + lastAjaxUrl);

    // 6a-ii. The instance key stays the first choice when it is available:
    // it is what the org itself reports, and it is right for the orgs whose
    // My Domain the Trust API does not list.
    ajaxCalls = 0;
    aliasCalls = 0;
    ajaxError = null;
    ajaxResult = STATUS_DOC;
    queryError = null;
    queryResult = { records: [{ Id: '00Dx', InstanceName: 'NA238' }] };
    const preferred = await makeService().loadStatus();
    assert.ok(!preferred.error, 'a resolvable key should still load');
    assert.strictEqual(aliasCalls, 0, 'the alias fallback must not fire when the key resolved');
    assert.strictEqual(ajaxCalls, 1, 'and the instance endpoint should be the one used');

    /*
     * 6a-iii. The alias must name the org the extension is TALKING TO, not
     *         the one in the address bar.
     *
     * Signing in through the Connected App can point the extension at a
     * different org - the sign-in card offers Production, Sandbox and a custom
     * URL - and from then on every query, the instance-key lookup included,
     * runs against that org. Deriving the alias from window.location instead
     * would have the panel name one org when the key lookup answers and
     * another when the fallback does, with nothing on screen to say which.
     */
    context.SS_AUTH.accessToken = 'token-for-another-org';
    context.SS_AUTH.instanceUrl = 'https://elsewhere.my.salesforce.com';

    ajaxCalls = 0;
    aliasCalls = 0;
    aliasError = null;
    aliasResult = STATUS_DOC;
    queryError = { noSession: true };
    queryResult = null;
    const crossOrg = await makeService().loadStatus();
    assert.ok(!crossOrg.error, 'the fallback should still resolve: ' + crossOrg.error);
    assert.ok(/instanceAliases\/elsewhere\/status$/.test(lastAjaxUrl),
        'the alias must follow the authenticated org (elsewhere), not the browsed host (example): ' + lastAjaxUrl);

    context.SS_AUTH.accessToken = null;
    context.SS_AUTH.instanceUrl = null;

    // Back to a failing fallback for the error-reporting cases below.
    aliasError = 'unavailable';
    aliasResult = null;

    /*
     * 6b. A failed instance lookup must not be remembered.
     *
     * The instance never changes, so the answer is cached - but caching the
     * rejection made one cancelled query the permanent answer, and Refresh
     * returned the same error without going near the network.
     */
    const retrying = makeService();
    queryError = { cancelled: true };
    queryResult = null;
    const cancelled = await retrying.loadStatus();
    assert.ok(cancelled.error, 'a cancelled lookup should report an error');
    assert.ok(/cancelled/i.test(cancelled.error),
        'and should say it was cancelled rather than blame the Trust API: ' + cancelled.error);

    queryError = null;
    queryResult = { records: [{ Id: '00Dx', InstanceName: 'NA238' }] };
    ajaxError = null;
    ajaxResult = STATUS_DOC;
    const recovered = await retrying.loadStatus();
    assert.ok(!recovered.error, 'the same service must retry rather than replay the failure');
    assert.strictEqual(recovered.key, 'NA238', 'and reach the status feed on the retry');

    // 6c. A query rejection with no message of its own is still explained.
    const noMessage = makeService();
    queryError = { noSession: true };
    queryResult = null;
    const sessionless = await noMessage.loadStatus();
    assert.ok(sessionless.error, 'a rejection without a message should still report something');
    assert.ok(!/Trust API request failed/.test(sessionless.error),
        'and must not blame the Trust API for a query that never reached it: ' + sessionless.error);

    // 7. Status codes are named the same way everywhere they are shown.
    assert.strictEqual(TrustService.statusLabel('MAJOR_INCIDENT_CORE'), 'Major Incident (Core)',
        'a known status should read as prose');
    assert.strictEqual(TrustService.statusLabel('SOMETHING_NEW'), 'SOMETHING_NEW',
        'an unknown status should surface as-is rather than vanish');
    assert.strictEqual(TrustService.statusLabel(undefined), 'Unknown',
        'a missing status still needs a label');

    /*
     * 8. Footer ticker lines. These are what a user sees without opening the
     * panel, so each one has to be short, name the instance, and survive
     * being built from an incident paragraph.
     */
    ajaxError = null;
    ajaxResult = STATUS_DOC;
    const forTicker = await TrustService.getStatus('NA238');
    // summaryLines builds its array inside the vm realm, so normalise before
    // deepStrictEqual - it compares prototypes, not just contents.
    const linesOf = (status) => Array.from(TrustService.summaryLines(status));
    const lines = linesOf(forTicker);
    assert.strictEqual(lines.length, 2, 'one line for the incident, one for the pending maintenance');
    assert.ok(/^NA238 incident: /.test(lines[0]), 'an incident line should name the instance: ' + lines[0]);
    assert.ok(/^NA238 maintenance: /.test(lines[1]), 'a maintenance line should name the instance: ' + lines[1]);
    /*
     * One line is the contract; a fixed character count is not.
     *
     * This used to require 80 characters or fewer, from when the footer was a
     * narrow strip shared with four stat tabs. The footer now gives the ticker
     * the whole bar and the display measures what fits, so trimming here to a
     * width nothing has measured just threw away text that would have shown -
     * a headline cut to "...multiple customers with the..." beside an empty
     * half-bar. What still matters is that a ticker line is one line, and that
     * a multi-paragraph incident is not carried around whole.
     */
    lines.forEach(function(line) {
        assert.ok(line.indexOf('\n') === -1, 'a ticker line must be one line: ' + line);
        assert.ok(line.length <= 340, 'a ticker line must stay bounded: ' + line.length);
    });

    // A paragraph-length incident is cut on a word boundary, not mid-word.
    ajaxResult = Object.assign({}, STATUS_DOC, {
        Maintenances: [],
        Incidents: [{ id: 3, isCore: true, IncidentEvents: [
            { id: 30, type: 'investigating', message: LONG, createdAt: '2026-07-08T21:17:00.000Z' }
        ], createdAt: '2026-07-08T21:17:00.000Z' }]
    });
    const longLines = linesOf(await TrustService.getStatus('NA238'));
    assert.ok(longLines[0].length <= 340,
        'a paragraph incident must still be bounded: ' + longLines[0].length);
    assert.ok(/…$/.test(longLines[0]), 'a trimmed ticker line should show it was cut');
    assert.ok(!/\s…$/.test(longLines[0]), 'and it is cut on a word boundary, not left dangling');

    // A healthy instance still has something to say, or the ticker would go
    // quiet exactly when the answer is "everything is fine".
    ajaxResult = { key: 'NA238', status: 'OK', Incidents: [], Maintenances: [], GeneralMessages: [] };
    const healthy = linesOf(await TrustService.getStatus('NA238'));
    assert.deepStrictEqual(healthy, ['NA238 · all services operational'],
        'a healthy instance should report one reassuring line');

    // A status no incident row explained still names the status.
    ajaxResult = { key: 'NA238', status: 'MAINTENANCE_CORE', Incidents: [], Maintenances: [], GeneralMessages: [] };
    assert.deepStrictEqual(linesOf(await TrustService.getStatus('NA238')),
        ['NA238 · Maintenance (Core)'],
        'a non-OK status with no rows should still be reported');

    // Maintenance already run is not news.
    ajaxResult = { key: 'NA238', status: 'OK', Incidents: [], GeneralMessages: [],
        Maintenances: [{ id: 9, name: 'Completed work', status: 'completed' }] };
    assert.deepStrictEqual(linesOf(await TrustService.getStatus('NA238')),
        ['NA238 · all services operational'],
        'a finished maintenance should not be announced');

    // A failed load contributes nothing at all - the ticker is ambient.
    assert.deepStrictEqual(linesOf({ error: 'Trust API unreachable (HTTP 503).' }), [],
        'a failed status must not put an error in the ticker');
    assert.deepStrictEqual(linesOf(null), [],
        'a missing status must not put anything in the ticker');

    console.log('trust service regression test passed');
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
