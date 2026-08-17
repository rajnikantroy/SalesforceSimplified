/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * Which way the traffic goes.
 *
 * Everything the API Monitor discovered before this was outbound: a Named
 * Credential, Remote Site or CSP Trusted Site is permission for Salesforce to
 * leave, not evidence that anyone arrived. So the panel listed half the org's
 * integrations under a heading that implied all of them.
 *
 * Inbound has a different source. Salesforce writes a LoginHistory row for
 * every API authentication, naming the application and which API it used -
 * so an integration calling in appears as a run of logins from a named app
 * with an ApiType, while a person in a browser has none.
 *
 * These are logins, not calls, and that distinction is the reason this can
 * exist at all: per-call counts live in EventLogFile, which needs Event
 * Monitoring, and most orgs do not have it.
 */

const source = fs.readFileSync('./js/angular/services/IntegrationService.js', 'utf8');

function loadService(rows, truncated) {
    const asked = [];
    const calledVia = [];

    const moduleObj = {
        service(name, deps) {
            moduleObj.factory = (typeof deps === 'function') ? deps : deps[deps.length - 1];
        }
    };

    const context = {
        window: { app: moduleObj },
        angular: { module: () => moduleObj },
        localStorage: { getItem: () => null, setItem: () => {} },
        console
    };
    vm.createContext(context);
    vm.runInContext(source, context);

    const $q = Object.assign((fn) => new Promise(fn), {
        when: (v) => Promise.resolve(v),
        all: (list) => Promise.all(list),
        reject: (v) => Promise.reject(v)
    });

    const sfdc = {
        query(soql) {
            asked.push(soql); calledVia.push('query');
            if (rows === 'REFUSE') { return Promise.reject({ message: 'INSUFFICIENT_ACCESS' }); }
            return Promise.resolve({ records: rows || [] });
        },
        /*
         * The real queryAll follows nextRecordsUrl until the org says done.
         * Here it just returns everything, plus whatever `truncated` the case
         * is testing - what matters is that the service asks for every page
         * and carries the answer through.
         */
        queryAll(soql) {
            asked.push(soql); calledVia.push('queryAll');
            if (rows === 'REFUSE') { return Promise.reject({ message: 'INSUFFICIENT_ACCESS' }); }
            return Promise.resolve({ records: rows || [], truncated: !!truncated });
        }
    };

    // The real injection list is ['$q', '$http', '$timeout', 'sfdc', 'UserId'].
    const $http = () => Promise.reject(new Error('not used here'));
    const $timeout = Object.assign((fn) => Promise.resolve().then(fn), { cancel: () => {} });

    return { service: new moduleObj.factory($q, $http, $timeout, sfdc, { id: '005x' }), asked, calledVia };
}

function login(over) {
    return Object.assign({
        ApplicationName: 'Data Loader',
        ApiType: 'SOAP Partner',
        ApiVersion: '62.0',
        LoginTime: '2026-08-01T10:00:00.000Z',
        Status: 'Success',
        SourceIp: '1.2.3.4'
    }, over);
}

const names = (list) => Array.from(list, (c) => c.name + '/' + c.apiType);

async function main() {

    /* ------------------------------------------------------------------ */
    /* A browser sign-in is not an integration                             */
    /*                                                                     */
    /* This is the whole filter, and it uses the org's own answer rather    */
    /* than guessing from the application name - which varies per connected */
    /* app and would need a list this code has no business keeping.         */
    /* ------------------------------------------------------------------ */

    const mixed = loadService([
        login(),
        login({ ApplicationName: 'Browser', ApiType: 'N/A' }),
        login({ ApplicationName: 'Salesforce for Chrome', ApiType: null }),
        login({ ApplicationName: 'Salesforce for Chrome', ApiType: '' })
    ]);

    const callers = await mixed.service.discoverInboundCallers(30);
    assert.deepStrictEqual(names(callers), ['Data Loader/SOAP Partner'],
        'only logins that used an API count as inbound integration traffic');

    /* ------------------------------------------------------------------ */
    /* Grouped by what distinguishes a caller                              */
    /* ------------------------------------------------------------------ */

    const grouped = loadService([
        login({ LoginTime: '2026-08-01T10:00:00.000Z' }),
        login({ LoginTime: '2026-08-03T09:00:00.000Z', SourceIp: '9.9.9.9' }),
        // Same application, different API: a caller that talks both ways is
        // two integrations in practice, and collapsing them hides which one
        // is failing.
        login({ ApiType: 'REST' }),
        login({ ApplicationName: 'Mulesoft', ApiType: 'REST' })
    ]);
    const list = await grouped.service.discoverInboundCallers(30);

    assert.deepStrictEqual(names(list).sort(),
        ['Data Loader/REST', 'Data Loader/SOAP Partner', 'Mulesoft/REST'],
        'grouped by application and API, not by application alone');

    const loader = list.find((c) => c.apiType === 'SOAP Partner');
    assert.strictEqual(loader.logins, 2, 'logins are counted per group');
    assert.strictEqual(loader.addressCount, 2, 'distinct source addresses are counted');
    assert.strictEqual(loader.lastSeen, '2026-08-03T09:00:00.000Z',
        'the most recent login is kept, whatever order the rows arrive in');

    // Busiest first: that is the one whose failure matters most.
    assert.strictEqual(list[0].logins, 2, 'the busiest caller leads the list');

    /* ------------------------------------------------------------------ */
    /* A caller that cannot authenticate                                   */
    /*                                                                     */
    /* An integration failing to log in is already broken, which is the     */
    /* single most useful thing this screen can surface - and it is         */
    /* invisible in a list of configured endpoints.                         */
    /* ------------------------------------------------------------------ */

    const failing = loadService([
        login({ ApplicationName: 'Legacy ETL', Status: 'Success' }),
        login({ ApplicationName: 'Legacy ETL', Status: 'Invalid Password' }),
        login({ ApplicationName: 'Legacy ETL', Status: 'Failed: Computer activation required' })
    ]);
    const broken = (await failing.service.discoverInboundCallers(30))[0];
    assert.strictEqual(broken.logins, 3, 'every attempt counts as a login');
    assert.strictEqual(broken.failures, 2, 'and the unsuccessful ones are counted separately');

    /* ------------------------------------------------------------------ */
    /* The window is asked for, not assumed                                */
    /* ------------------------------------------------------------------ */

    const windowed = loadService([]);
    await windowed.service.discoverInboundCallers(7);
    assert.ok(/LAST_N_DAYS:7/.test(windowed.asked[0]), 'the requested window reaches the query');
    assert.ok(/FROM LoginHistory/.test(windowed.asked[0]), 'from login history');

    const defaulted = loadService([]);
    await defaulted.service.discoverInboundCallers();
    assert.ok(/LAST_N_DAYS:30/.test(defaulted.asked[0]),
        'and there is a sensible default rather than an unbounded query');

    /* ------------------------------------------------------------------ */
    /* No permission costs this section and nothing else                   */
    /*                                                                     */
    /* LoginHistory needs "View Setup and Configuration". The outbound half */
    /* needs no such thing, so losing this must not take it down.           */
    /* ------------------------------------------------------------------ */

    const refused = loadService('REFUSE');
    assert.deepStrictEqual(Array.from(await refused.service.discoverInboundCallers(30)), [],
        'an org that refuses login history contributes nothing, not an error');

    assert.deepStrictEqual(Array.from(await loadService([]).service.discoverInboundCallers(30)), [],
        'no API logins is an empty list');

    /* ------------------------------------------------------------------ */
    /* Counts must not stop at the first page                              */
    /*                                                                     */
    /* Salesforce answers 2,000 rows at a time. A total taken from one page */
    /* is understated and reads as fact - and an org with a busy            */
    /* integration passes 2,000 API logins in a month easily.               */
    /* ------------------------------------------------------------------ */

    const paged = loadService([login()]);
    await paged.service.discoverInboundCallers(30);
    assert.deepStrictEqual(Array.from(paged.calledVia), ['queryAll'],
        'inbound counts come from the paging query, not from the first page only');

    // When even paging could not read it all, the panel is told so it can say
    // the totals are a floor rather than a count.
    const capped = loadService([login(), login({ ApplicationName: 'Mulesoft' })], true);
    const cappedList = await capped.service.discoverInboundCallers(30);
    assert.strictEqual(cappedList.truncated, true,
        'a capped read is reported, not presented as complete');

    const whole = loadService([login()], false);
    assert.strictEqual((await whole.service.discoverInboundCallers(30)).truncated, false,
        'and a complete read says so');

    console.log('inbound callers regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
