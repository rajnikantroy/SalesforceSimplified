/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * The org catalogue, and what happens when it does not arrive.
 *
 * Every metadata entry in the sidebar is built from the two global describes
 * this service fetches. Both are individually forgiving - each maps its own
 * failure to null - which is right, because an org that blocks the Tooling
 * API should still get a working REST path. The cost is that a TOTAL failure
 * arrives at the caller looking like a perfectly good answer: "this org has
 * no objects in it".
 *
 * That answer used to be made durable twice over. It was written to the
 * localStorage cache, whose acceptance test was `cached.rest` - and `{}` is
 * truthy - so every page load for the next 24 hours served the empty
 * catalogue back without asking the org again. And _readyPromise was
 * memoised, so nothing tried again for the life of the page either.
 *
 * The symptom is an extension that looks half-working: signed in, queries
 * running, users listing - and a metadata menu with only its built-in
 * entries, no error, and no way to tell why.
 */

function makeContext(responses) {
    const store = {};
    const moduleObj = {
        service(name, deps) {
            moduleObj.factory = (typeof deps === 'function') ? deps : deps[deps.length - 1];
        }
    };

    const calls = [];
    const $http = function (config) {
        calls.push(config.url);
        const answer = responses[config.url];
        return (answer instanceof Error)
            ? Promise.reject(answer)
            : Promise.resolve({ data: answer });
    };

    const $q = Object.assign((fn) => new Promise(fn), {
        when: (v) => Promise.resolve(v),
        reject: (v) => Promise.reject(v),
        all: (list) => Promise.all(list),
        defer() {
            let resolve, reject;
            const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
            return { promise, resolve, reject };
        }
    });

    const context = {
        window: {
            app: moduleObj,
            location: {
                origin: 'https://example.my.salesforce.com',
                hostname: 'example.my.salesforce.com',
                pathname: '/'
            }
        },
        // get() refuses to fetch without a session, so the test has one.
        document: { cookie: 'sid=FAKE_SESSION', querySelector: () => null },
        navigator: { userAgent: 'test' },
        chrome: {
            storage: { local: {
                get: (keys, cb) => cb && cb({}),
                set: (obj, cb) => cb && cb(),
                remove: (keys, cb) => cb && cb()
            } },
            runtime: { lastError: null, sendMessage: () => {}, getURL: () => '' }
        },
        angular: { module: () => moduleObj },
        console,
        SS_ORIGIN: 'https://example.my.salesforce.com',
        ssSobjectsUrl: () => 'REST_URL',
        ssToolingSobjectsUrl: () => 'TOOLING_URL',
        ssAuthorize: () => {},
        readCookie: () => '',
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; }
        },
        setTimeout, clearTimeout
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('./js/ss-core.js', 'utf8'), context);
    // ss-core defines its own helpers; the stubs above are what the test drives.
    context.ssSobjectsUrl = () => 'REST_URL';
    context.ssToolingSobjectsUrl = () => 'TOOLING_URL';
    context.SS_ORIGIN = 'https://example.my.salesforce.com';
    vm.runInContext(fs.readFileSync('./js/angular/services/SchemaService.js', 'utf8'), context);

    const $timeout = (fn) => { fn(); return Promise.resolve(); };
    $timeout.cancel = () => {};

    return {
        service: new moduleObj.factory($http, $q, $timeout),
        store,
        calls,
        context
    };
}

const CATALOGUE = { sobjects: [{ name: 'ApexClass', label: 'Apex Class', queryable: true }] };

async function main() {
    /* -------------------------------------------------------------- */
    /* A catalogue that loads is usable and is remembered              */
    /* -------------------------------------------------------------- */

    const good = makeContext({ REST_URL: CATALOGUE, TOOLING_URL: { sobjects: [] } });
    await good.service.ready();
    const restMap = await good.service.globalDescribe();
    assert.ok(restMap.ApexClass, 'a successful describe must populate the REST catalogue');
    assert.ok(good.service.catalogueKnown(), 'and the catalogue must count as known');

    /* -------------------------------------------------------------- */
    /* A catalogue that fails entirely is NOT cached                   */
    /* -------------------------------------------------------------- */

    const failed = makeContext({
        REST_URL: new Error('403 blocked'),
        TOOLING_URL: new Error('403 blocked')
    });
    await failed.service.ready();

    assert.strictEqual(
        failed.service.catalogueKnown(), false,
        'a total describe failure must not look like a known, empty org'
    );

    const written = failed.store['SFDCSimplified_schema_v1'];
    if (written) {
        const parsed = JSON.parse(written);
        assert.ok(
            !parsed.rest || Object.keys(parsed.rest).length > 0,
            'an empty catalogue must never be written to the cache - it would be served back for 24 hours'
        );
    }

    /* -------------------------------------------------------------- */
    /* ...and the failure is retried rather than memoised              */
    /* -------------------------------------------------------------- */

    const before = failed.calls.length;
    await failed.service.ready();
    assert.ok(
        failed.calls.length > before,
        'after a failed catalogue load, ready() must ask the org again rather than replay the empty answer'
    );

    /* -------------------------------------------------------------- */
    /* A stored empty catalogue is ignored, not trusted                */
    /* -------------------------------------------------------------- */

    const poisoned = makeContext({ REST_URL: CATALOGUE, TOOLING_URL: { sobjects: [] } });
    poisoned.store['SFDCSimplified_schema_v1'] = JSON.stringify({
        origin: 'https://example.my.salesforce.com',
        ts: Date.now(),          // fresh, so only its emptiness can disqualify it
        rest: {},
        tooling: {}
    });

    await poisoned.service.ready();
    const recovered = await poisoned.service.globalDescribe();
    assert.ok(
        recovered.ApexClass,
        'a cached empty catalogue must be refetched, not served - `{}` is truthy, which is how it used to pass'
    );

    console.log('schema catalogue regression test passed');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
