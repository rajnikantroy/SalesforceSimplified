/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const moduleObj = {
  service(name, deps) { this.factory = deps[deps.length - 1]; }
};
let sessionExpiredMarked = false;
const context = {
  window: { app: moduleObj },
  angular: { module: () => moduleObj },
  ssAuthReady: () => Promise.resolve(),
  ssSessionId: () => 'session-id',
  ssQueryUrl: () => 'https://example.test/query/?q=',
  ssToolingQueryUrl: () => 'https://example.test/tooling/query/?q=',
  // ss-core confirms a session rejection against the org before signing the
  // user out; SfdcApi's job is only to hand the rejection over. The stub
  // records that it did, and stands in for the confirmed-dead outcome.
  ssSessionRejected: rej => {
    const entry = rej && (Array.isArray(rej.data) ? rej.data[0] : rej.data);
    if (entry && (entry.errorCode === 'INVALID_SESSION_ID' ||
                  /session expired or invalid/i.test(String(entry.message || '')))) {
      sessionExpiredMarked = true;
    }
  },
  readCookie: () => 'connected'
};
vm.runInNewContext(fs.readFileSync('./js/angular/services/SfdcApi.js', 'utf8'), context);

function q() {
  return {
    when: Promise.resolve.bind(Promise),
    reject: Promise.reject.bind(Promise),
    defer() {
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      return { promise, resolve };
    }
  };
}

function timeout() {
  // Timers do not fire in these request-routing tests.
  return new Promise(() => {});
}
timeout.cancel = () => {};

// A SchemaService that knows nothing, standing in for an org whose global
// describe is unavailable. Every answer is deliberately the permissive one, so
// these tests pin the engine's degraded behaviour: with no schema to consult it
// must still route, still fall back, and never refuse a query pre-emptively.
function blindSchema() {
  return {
    ready: () => Promise.resolve(),
    route: (name, hint) => hint || 'rest',
    describe: () => Promise.resolve(null),
    digestSync: () => null,
    queryUrlFor: endpoint =>
      (endpoint === 'tooling' ? context.ssToolingQueryUrl() : context.ssQueryUrl()),
    catalogueKnown: () => false,
    restCanQuery: () => false,
    toolingCanQuery: () => false,
    // Endpoint memory lives in SchemaService; a blind one records nothing.
    rememberEndpoint: () => {},
    knownEndpoint: () => null,
    hasField: () => true,
    hasRelationship: () => true,
    canSort: () => true,
    forget: () => {}
  };
}

async function run() {
  let calls = [];
  let responses = [];
  const http = config => {
    calls.push(config.url);
    const response = responses.shift();
    return response.ok ? Promise.resolve({ data: response.data }) : Promise.reject(response.error);
  };
  const service = new moduleObj.factory(http, q(), timeout, blindSchema());

  responses = [{ ok: false, error: { status: 400, data: [{ errorCode: 'MALFORMED_QUERY', message: 'unexpected token' }] } }];
  await assert.rejects(service.smartQuery('SELECT Id FROM Account'));
  assert.strictEqual(calls.length, 1, 'invalid SOQL should not be retried against Tooling');
  assert.strictEqual(service.errorMessage({ data: { message: 'object response' } }), 'object response');

  calls = [];
  responses = [
    { ok: false, error: { status: 400, data: [{ errorCode: 'INVALID_TYPE', message: 'sObject type not supported' }] } },
    { ok: true, data: { records: [] } }
  ];
  await service.smartQuery('SELECT Id FROM UnknownObject');
  assert.strictEqual(calls.length, 2, 'an endpoint mismatch should use the alternate API once');
  assert.ok(calls[1].includes('/tooling/query/'), 'fallback should target Tooling');

  assert.strictEqual(service.errorMessage({ status: 401 }), 'Your Salesforce session has expired. Please refresh Salesforce and try again.');
  assert.strictEqual(service.errorMessage({ status: 403 }), 'You do not have permission to query this data.');
  assert.strictEqual(service.errorMessage({ timedout: true }), 'The query took too long. Please try again or use a narrower filter.');

  sessionExpiredMarked = false;
  calls = [];
  responses = [{ ok: false, error: { status: 401, data: [{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid' }] } }];
  await assert.rejects(service.smartQuery('SELECT Id FROM Account'));
  assert.strictEqual(sessionExpiredMarked, true,
    'a 401/INVALID_SESSION_ID rejection should mark the session expired so the sign-in overlay appears');

  sessionExpiredMarked = false;
  calls = [];
  responses = [{ ok: false, error: { status: 400, data: [{ errorCode: 'MALFORMED_QUERY', message: 'unexpected token' }] } }];
  await assert.rejects(service.smartQuery('SELECT Id FROM Account'));
  assert.strictEqual(sessionExpiredMarked, false,
    'a plain query error must not mark the session expired');

  // A setup object refusing a live session - the Setup Audit Trail case. This
  // must not sign the user out of everything else.
  sessionExpiredMarked = false;
  calls = [];
  responses = [
    { ok: false, error: { status: 401, data: [{ errorCode: 'INSUFFICIENT_ACCESS', message: 'You do not have permission to view this' }] } },
    { ok: false, error: { status: 401, data: [{ errorCode: 'INSUFFICIENT_ACCESS', message: 'You do not have permission to view this' }] } }
  ];
  await assert.rejects(service.smartQuery('SELECT Id FROM SetupAuditTrail'));
  assert.strictEqual(sessionExpiredMarked, false,
    'a 401 the org blames on permissions must not mark the session expired');
  console.log('sfdc api regression test passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
