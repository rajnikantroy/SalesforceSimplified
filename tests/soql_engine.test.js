/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Query engine regression tests.
 *
 * Part 1 covers the SOQL surgery in isolation - taking a column, a
 * relationship or a sort term out of a statement without disturbing the rest.
 * Part 2 wires SchemaService and sfdc together against a fake org and replays
 * the failures that motivated the engine:
 *
 *   sObject type 'Task' is not supported.
 *   sObject type 'PicklistValueInfo' is not supported.
 *   sObject type 'PplnInspListViewCalcClmn' is not supported.
 *   Didn't understand relationship 'LastModifiedBy' ... FROM PermissionSetTabSetting
 *   sObject type 'PermissionSetEventStore' is not supported.
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/* ------------------------------------------------------------------ */
/* Fake org                                                            */
/* ------------------------------------------------------------------ */

// FlexiPage appears in both catalogues, but only Tooling will actually serve
// it - see restRefuses below.
const REST_OBJECTS = ['Task', 'PermissionSetTabSetting', 'PermissionSetEventStore', 'Account', 'Opportunity', 'FlexiPage'];
const TOOLING_OBJECTS = ['PicklistValueInfo', 'ApexClass', 'FlexiPage'];
// PplnInspListViewCalcClmn is in neither catalogue.

const field = (name, extra) =>
  Object.assign({ name, sortable: true, filterable: true }, extra || {});

const DESCRIBES = {
  // Task's name field is Subject; it has no Name column at all.
  Task: {
    label: 'Task', queryable: true, fields: [
      field('Id'), field('Subject', { nameField: true }), field('Status'),
      field('LastModifiedDate'), field('CreatedDate'),
      field('LastModifiedById', { relationshipName: 'LastModifiedBy' }),
      field('CreatedById', { relationshipName: 'CreatedBy' })
    ]
  },
  // No Name, no LastModifiedBy, no audit dates.
  PermissionSetTabSetting: {
    label: 'Permission Set Tab Setting', queryable: true, fields: [
      field('Id'), field('ParentId', { relationshipName: 'Parent' }), field('Visibility')
    ]
  },
  // Catalogued and describable, but every query against it is rejected.
  PermissionSetEventStore: {
    label: 'Permission Set Event Store', queryable: true, fields: [
      field('Id'), field('Name', { nameField: true }), field('LastModifiedDate')
    ]
  },
  PicklistValueInfo: {
    label: 'Picklist Value Info', queryable: true, fields: [
      field('Id'), field('Label', { nameField: true }), field('Value')
    ]
  },
  Account: {
    label: 'Account', queryable: true, fields: [
      field('Id'), field('Name', { nameField: true }), field('LastModifiedDate')
    ]
  },
  Opportunity: {
    label: 'Opportunity', queryable: true, fields: [
      field('Id'), field('Name', { nameField: true }), field('Amount'),
      field('LastModifiedDate')
    ]
  },
  FlexiPage: {
    label: 'Lightning Page', queryable: true, fields: [
      field('Id'), field('DeveloperName', { nameField: true }), field('LastModifiedDate')
    ]
  }
};

const BASE = 'https://example.test/services/data/v60.0';
const requests = [];
// Objects the REST catalogue lists but the REST query endpoint rejects.
const restRefuses = { FlexiPage: true };
const soqlOf = url => {
  const i = url.indexOf('?q=');
  return i === -1 ? null : decodeURIComponent(url.slice(i + 3));
};
const catalogue = names => ({
  sobjects: names.map(n => ({ name: n, label: n, queryable: true }))
});

function http(config) {
  const url = config.url;
  requests.push(url);

  if (url === BASE + '/tooling/sobjects') { return Promise.resolve({ data: catalogue(TOOLING_OBJECTS) }); }
  if (url === BASE + '/sobjects')         { return Promise.resolve({ data: catalogue(REST_OBJECTS) }); }

  const describe = /\/sobjects\/([A-Za-z0-9_]+)\/describe$/.exec(url);
  if (describe) {
    const found = DESCRIBES[describe[1]];
    return found ? Promise.resolve({ data: found })
                 : Promise.reject({ status: 404, data: [{ message: 'not found' }] });
  }

  const soql = soqlOf(url);
  const object = /FROM\s+([A-Za-z0-9_]+)/i.exec(soql)[1];
  const isTooling = url.indexOf('/tooling/') !== -1;
  const invalidType = () => Promise.reject({
    status: 400,
    data: [{ errorCode: 'INVALID_TYPE', message: `sObject type '${object}' is not supported.` }]
  });

  // Reject any reference to a column or relationship the object lacks, the
  // way the org does. String literals are values, not column references.
  const known = DESCRIBES[object];
  if (known) {
    const columns = known.fields.map(f => f.name);
    const relationships = known.fields.filter(f => f.relationshipName).map(f => f.relationshipName);
    const identifiers = soql.replace(/'(?:\\.|[^'])*'/g, "''").match(/[A-Za-z_][A-Za-z0-9_.]*/g) || [];
    for (const token of identifiers) {
      if (/^(SELECT|FROM|WHERE|ORDER|BY|DESC|ASC|LIMIT|OFFSET|OR|AND|LIKE|NULL|true|false)$/i.test(token)) { continue; }
      // Aggregate functions and date literals are not column references.
      if (/^(COUNT|SUM|AVG|MIN|MAX|COUNT_DISTINCT|GROUP|HAVING)$/i.test(token)) { continue; }
      if (/^(TODAY|YESTERDAY|TOMORROW|THIS_WEEK|THIS_MONTH|LAST_MONTH)$/i.test(token)) { continue; }
      if (token === object) { continue; }
      if (token.indexOf('.') !== -1) {
        const relationship = token.split('.')[0];
        if (relationships.indexOf(relationship) === -1) {
          return Promise.reject({ status: 400, data: [{ errorCode: 'INVALID_FIELD',
            message: `\nSELECT ${token}\n       ^\nERROR at Row:1:Column:8\nDidn't understand relationship '${relationship}' in field path.` }] });
        }
      } else if (columns.indexOf(token) === -1) {
        return Promise.reject({ status: 400, data: [{ errorCode: 'INVALID_FIELD',
          message: `\nSELECT ${token}\n       ^\nERROR at Row:1:Column:8\nNo such column '${token}' on entity '${object}'.` }] });
      }
    }
  }

  if (object === 'PermissionSetEventStore') { return invalidType(); }
  // Listed in the REST catalogue but only ever served by Tooling.
  if (restRefuses[object] && !isTooling) { return invalidType(); }
  if (isTooling ? TOOLING_OBJECTS.indexOf(object) === -1
                : REST_OBJECTS.indexOf(object) === -1) { return invalidType(); }

  return Promise.resolve({ data: { totalSize: 1, done: true, records: [{ Id: '001' }] } });
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

const factories = {};
const moduleObj = { service(name, deps) { factories[name] = deps[deps.length - 1]; } };
const store = {};
const context = {
  window: {},
  angular: { module: () => moduleObj },
  console,
  SS_ORIGIN: 'https://example.test',
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: k => { delete store[k]; }
  },
  readCookie: () => 'connected',
  ssAuthReady: () => Promise.resolve(),
  ssSessionId: () => 'session-id',
  ssSessionRejected: () => {},
  // ss-core.js supplies this; the {uid} placeholder is not exercised here but
  // the engine must still resolve it the way it would in the extension.
  ssResolveQueryUid: soql => {
    if (!soql || soql.indexOf('{uid}') === -1) { return soql; }
    return soql.replace(/\{uid\}/g, 'uid');
  },
  ssSobjectsUrl: () => BASE + '/sobjects',
  ssToolingSobjectsUrl: () => BASE + '/tooling/sobjects',
  ssDescribeUrl: t => BASE + '/sobjects/' + t + '/describe',
  ssToolingDescribeUrl: t => BASE + '/tooling/sobjects/' + t + '/describe',
  ssQueryUrl: () => BASE + '/query/?q=',
  ssToolingQueryUrl: () => BASE + '/tooling/query/?q='
};

for (const file of ['SchemaService', 'SfdcApi']) {
  vm.runInNewContext(fs.readFileSync(`./js/angular/services/${file}.js`, 'utf8'), context);
}

const $q = Object.assign(v => Promise.resolve(v), {
  when: v => Promise.resolve(v),
  reject: v => Promise.reject(v),
  all: list => Promise.all(list),
  defer() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
  }
});
// Cache writes are debounced through $timeout; letting them fire would only
// exercise localStorage, which these tests do not assert on.
const $timeout = Object.assign(() => ({}), { cancel: () => {} });

const SchemaService = new factories.SchemaService(http, $q, $timeout);
const sfdc = new factories.sfdc(http, $q, $timeout, SchemaService);
const surgery = sfdc._internals;

const rewrite = (soql, mutate) => {
  const parsed = surgery.parseSoql(soql);
  assert.ok(parsed, `failed to parse: ${soql}`);
  mutate(parsed);
  return surgery.buildSoql(parsed);
};
const queriesAgainst = object =>
  requests.filter(u => u.indexOf('?q=') !== -1).map(soqlOf)
          .filter(s => new RegExp(`FROM\\s+${object}\\b`).test(s));

/* ------------------------------------------------------------------ */
/* Part 1 - SOQL surgery                                               */
/* ------------------------------------------------------------------ */

const noop = () => {};

assert.strictEqual(
  rewrite("SELECT Id, Name FROM Account WHERE (A = 'x') ORDER BY LastModifiedDate DESC LIMIT 50", noop),
  "SELECT Id, Name FROM Account WHERE (A = 'x') ORDER BY LastModifiedDate DESC LIMIT 50",
  'a parsed statement should rebuild unchanged');

// The previous ORDER BY sanitiser used a lookahead that required trailing
// whitespace, so it silently did nothing on any query without a LIMIT.
assert.strictEqual(
  rewrite('SELECT Id FROM Layout ORDER BY EntityDefinition.QualifiedApiName DESC', surgery.stripRelationshipOrderBy),
  'SELECT Id FROM Layout',
  'relationship ORDER BY should be stripped when there is no LIMIT');
assert.strictEqual(
  rewrite('SELECT Id FROM Layout ORDER BY Foo.Bar, Name DESC', surgery.stripRelationshipOrderBy),
  'SELECT Id FROM Layout ORDER BY Name DESC',
  'stripping a relationship sort should keep the sortable terms');

// Whole-identifier matching: dropping Name must not touch DeveloperName.
assert.strictEqual(
  rewrite('SELECT Id, DeveloperName, Name FROM X', p => surgery.dropField(p, 'Name')),
  'SELECT Id, DeveloperName FROM X',
  'dropping a column should not match a longer column that contains it');
assert.strictEqual(
  rewrite("SELECT Id FROM X WHERE (LastModifiedById='1' OR CreatedById='1')",
          p => surgery.dropRelationship(p, 'LastModifiedBy')),
  "SELECT Id FROM X WHERE (LastModifiedById='1' OR CreatedById='1')",
  'dropping a relationship should not match the id column it hangs off');

// A "my records" filter must lose only the half the object cannot support.
assert.strictEqual(
  rewrite("SELECT Id FROM X WHERE (LastModifiedById='1' OR CreatedById='1')",
          p => surgery.dropField(p, 'LastModifiedById')),
  "SELECT Id FROM X WHERE CreatedById='1'",
  'pruning one side of an OR should keep the other');
assert.strictEqual(
  rewrite("SELECT Id FROM X WHERE (IsOwnedByProfile = false) AND (LastModifiedById='1' OR CreatedById='1')",
          p => surgery.dropField(p, 'LastModifiedById')),
  "SELECT Id FROM X WHERE IsOwnedByProfile = false AND CreatedById='1'",
  'pruning inside an OR should leave the AND sibling intact');

assert.strictEqual(
  rewrite('SELECT Name FROM X', p => surgery.dropField(p, 'Name')),
  'SELECT Id FROM X',
  'a projection must never be emptied');

// Quoting and nesting must not be mistaken for clause boundaries.
assert.strictEqual(
  rewrite("SELECT Id FROM X WHERE Name = 'a\\'b' ORDER BY Name", noop),
  "SELECT Id FROM X WHERE Name = 'a\\'b' ORDER BY Name",
  'an escaped quote should not break parsing');
assert.strictEqual(
  rewrite('SELECT Id, (SELECT Id FROM Contacts ORDER BY Name) FROM Account ORDER BY Name', noop),
  'SELECT Id, (SELECT Id FROM Contacts ORDER BY Name) FROM Account ORDER BY Name',
  'a subquery should survive intact');

// Copied into this realm: an object built inside the vm carries the vm's
// Object prototype, which deepStrictEqual counts as a difference.
const diagnose = (message, errorCode) => {
  const result = surgery.diagnose({ data: [{ message, errorCode }] });
  return result ? Object.assign({}, result) : result;
};
assert.deepStrictEqual(diagnose("No such column 'Name' on entity 'Task'."),
  { kind: 'field', name: 'Name' });
assert.deepStrictEqual(diagnose("Didn't understand relationship 'LastModifiedBy' in field path."),
  { kind: 'relationship', name: 'LastModifiedBy' });
assert.deepStrictEqual(diagnose("sObject type 'PicklistValueInfo' is not supported."), { kind: 'endpoint' });
assert.deepStrictEqual(diagnose('any message', 'INVALID_TYPE'), { kind: 'endpoint' });
assert.strictEqual(diagnose('Some error nobody has seen before'), null,
  'an unrecognised error should not provoke a blind retry');

/* ------------------------------------------------------------------ */
/* Part 2 - against the fake org                                       */
/* ------------------------------------------------------------------ */

async function run() {
  const userFilter = "(LastModifiedById='005xx' OR CreatedById='005xx')";

  // Task: the generated spec asks for Name, which Task does not have.
  let result = await sfdc.query(
    `SELECT Id, Name, LastModifiedBy.Name FROM Task WHERE ${userFilter} ORDER BY LastModifiedDate DESC`,
    context.ssQueryUrl(), 50);
  let sent = queriesAgainst('Task');
  assert.strictEqual(result.totalSize, 1, 'the Task query should succeed');
  assert.strictEqual(sent.length, 1, 'Task should be corrected before sending, not by retrying');
  assert.ok(/Subject/.test(sent[0]), 'Task should select Subject');
  assert.ok(!/(^|[^.])\bName\b/.test(sent[0].replace(/LastModifiedBy\.Name/g, '')),
    'Task should not select Name');
  assert.ok(/LastModifiedBy\.Name/.test(sent[0]), 'Task does have LastModifiedBy, so it should be kept');

  // PermissionSetTabSetting: no Name, no LastModifiedBy, no audit dates.
  result = await sfdc.query(
    'SELECT Id, Name, LastModifiedBy.Name FROM PermissionSetTabSetting ORDER BY LastModifiedDate DESC',
    context.ssQueryUrl(), 50);
  sent = queriesAgainst('PermissionSetTabSetting');
  assert.strictEqual(result.totalSize, 1, 'the PermissionSetTabSetting query should succeed');
  assert.strictEqual(sent.length, 1, 'PermissionSetTabSetting should need only one request');
  assert.ok(!/LastModifiedBy/.test(sent[0]), 'the missing relationship should be gone');
  assert.ok(!/LastModifiedDate/.test(sent[0]), 'the missing sort column should be gone');

  // PicklistValueInfo lives only in the Tooling API, but the spec pins REST.
  result = await sfdc.query('SELECT Id, Name FROM PicklistValueInfo', context.ssQueryUrl(), 50);
  assert.strictEqual(result.totalSize, 1, 'the PicklistValueInfo query should succeed');
  assert.ok(requests.some(u => u.indexOf('/tooling/query/') !== -1 && /PicklistValueInfo/.test(decodeURIComponent(u))),
    'PicklistValueInfo should be routed to Tooling despite the REST hint');
  assert.ok(!requests.some(u => u.indexOf('/tooling/') === -1 && u.indexOf('/query/?q=') !== -1 &&
                                /PicklistValueInfo/.test(decodeURIComponent(u))),
    'PicklistValueInfo should never be sent to the REST query endpoint');

  // Catalogued, describable, and still rejects everything.
  result = await sfdc.query('SELECT Id, Name FROM PermissionSetEventStore', context.ssQueryUrl(), 50);
  assert.strictEqual(result.ssUnsupported, true, 'an unqueryable object should resolve, not reject');
  assert.strictEqual(result.records.length, 0, 'an unqueryable object should resolve empty');
  let before = requests.length;
  await sfdc.query('SELECT Id, Name FROM PermissionSetEventStore', context.ssQueryUrl(), 50);
  assert.strictEqual(requests.length, before,
    'a second attempt should cost no requests once the failure is learned');

  // Absent from both catalogues: never worth a request.
  before = requests.length;
  result = await sfdc.query('SELECT Id, Name, LastModifiedBy.Name FROM PplnInspListViewCalcClmn',
                            context.ssQueryUrl(), 50);
  assert.strictEqual(result.ssUnsupported, true, 'an uncatalogued object should resolve empty');
  assert.strictEqual(requests.length, before,
    'an object in neither catalogue should never reach the network');

  /*
   * Aggregates. The engine normally supplies a missing ORDER BY and makes sure
   * a display column survived - both of which turn "SELECT COUNT() FROM X"
   * into invalid SOQL, since an aggregate cannot carry a bare column or be
   * sorted without a GROUP BY. The footer ticker is built entirely on these.
   */
  await sfdc.query('SELECT COUNT() FROM Account WHERE LastModifiedDate = TODAY', context.ssQueryUrl());
  const counts = queriesAgainst('Account').filter(s => /COUNT\(\)/i.test(s));
  assert.strictEqual(counts.length, 1, 'the count should be sent once, unrepaired');
  assert.ok(!/ORDER\s+BY/i.test(counts[0]), 'a count must not be given an ORDER BY: ' + counts[0]);
  assert.ok(!/COUNT\(\)\s*,/i.test(counts[0]), 'a count must not gain a display column: ' + counts[0]);

  await sfdc.query('SELECT SUM(Amount) total FROM Opportunity WHERE LastModifiedDate = TODAY',
                   context.ssQueryUrl());
  const sums = requests.filter(u => u.indexOf('?q=') !== -1).map(soqlOf)
                       .filter(s => /SUM\(/i.test(s));
  assert.ok(sums.length && !/ORDER\s+BY/i.test(sums[0]),
    'a SUM must not be given an ORDER BY: ' + sums[0]);

  /*
   * FlexiPage is listed in the REST catalogue but refuses REST queries, so the
   * first attempt fails and the retry on Tooling succeeds. The endpoint that
   * actually answered has to be remembered, or every later query for that
   * object pays the failed first request again.
   */
  await sfdc.query('SELECT Id, DeveloperName FROM FlexiPage', context.ssQueryUrl(), 50);
  const firstPass = requests.filter(u => /FlexiPage/.test(decodeURIComponent(u)) && u.indexOf('?q=') !== -1);
  assert.strictEqual(firstPass.length, 2, 'the first attempt should fail on REST then succeed on Tooling');
  assert.ok(firstPass[1].indexOf('/tooling/query/') !== -1, 'the retry should go to Tooling');

  const beforeSecond = requests.length;
  await sfdc.query('SELECT Id, DeveloperName FROM FlexiPage', context.ssQueryUrl(), 50);
  const secondPass = requests.slice(beforeSecond)
                             .filter(u => u.indexOf('?q=') !== -1);
  assert.strictEqual(secondPass.length, 1,
    'the second query should go straight to Tooling, not rediscover it');
  assert.ok(secondPass[0].indexOf('/tooling/query/') !== -1,
    'the remembered endpoint should be Tooling');

  // The reported error should describe the real cause, not the recovery.
  let message = null;
  try {
    await sfdc.query('SELECT Id, Bogus, AlsoBogus FROM Account', context.ssQueryUrl(), 50);
  } catch (rejection) {
    message = sfdc.errorMessage(rejection, 'Account');
  }
  if (message !== null) {
    assert.ok(!/is not supported/i.test(message),
      `a column error should not surface as a type error, got: ${message}`);
  }

  console.log('soql engine regression test passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
