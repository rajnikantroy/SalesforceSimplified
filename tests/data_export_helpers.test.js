/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = {
  window: { location: { origin: 'https://example.test' } },
  document: { cookie: '' },
  chrome: { storage: { local: { get() {}, set() {} } } },
  $: { ajax: () => ({ then: fn => fn({}) }) },
  console
};

vm.runInNewContext(fs.readFileSync('./js/ss-core.js', 'utf8'), context);

const payload = context.ssBuildJsonDownloadPayload([
  { Id: '001', Name: 'Acme', selected: true, $$hashKey: 'abc' },
  { Id: '002', Name: 'Beta', selected: false }
]);

assert.ok(payload.includes('"Id": "001"'), 'payload should include record ids');
assert.ok(payload.includes('"Name": "Acme"'), 'payload should include record names');
assert.ok(!payload.includes('$$hashKey'), 'payload should strip Angular hash keys');
assert.ok(!payload.includes('"selected": true'), 'payload should not include checkbox state');

console.log('data export helper regression test passed');
