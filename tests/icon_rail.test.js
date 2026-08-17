/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * The icon rail is a curated shortcut strip, so its contents are a deliberate
 * choice rather than an accident of what an org happens to expose. This pins
 * that choice: LWC is on it, retired metadata is not, and no symbol repeats.
 *
 * buildIconRail lives inside the MenuAndDetailsCtrl closure, so it is lifted
 * out of the source rather than required - the alternative is exporting
 * controller internals purely for the test.
 */
const assert = require('assert');
const fs = require('fs');

const ctrl = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const dms = fs.readFileSync('./js/angular/services/DynamicMetadataService.js', 'utf8');

const ICON_RAIL_TYPES = eval(/var ICON_RAIL_TYPES = (\[[\s\S]*?\]);/.exec(ctrl)[1]);
const ICON_RAIL_LIMIT = parseInt(/var ICON_RAIL_LIMIT = (\d+);/.exec(ctrl)[1], 10);
const ICON_RAIL_EXCLUDED = eval('(' + /var ICON_RAIL_EXCLUDED = (\{[\s\S]*?\n\t\});/.exec(ctrl)[1] + ')');
eval(/function buildIconRail\(candidates\) \{[\s\S]*?\n\t\}/.exec(ctrl)[0].replace(/\t/g, '  '));

// The shipped icon mapping, so a "distinct icons" assertion means the real thing.
const ICON_MAP = {};
const iconBlock = /var ICON_MAP = \{([\s\S]*?)\n    \};/.exec(dms)[1];
iconBlock.split('\n').forEach(line => {
  const m = /'([A-Za-z0-9_]+)':.*getURL\('([^']+)'\)/.exec(line);
  if (m) { ICON_MAP[m[1]] = m[2]; }
});
const DEFAULT_ICON = '/img/icons/objects.png';

// A modern org: REST catalogue plus the Tooling-only developer types.
const DEPLOYABLE = new Set([
  'ApexClass', 'ApexTrigger', 'ApexPage', 'ApexComponent', 'Flow', 'FlowDefinition',
  'EmailTemplate', 'StaticResource', 'CustomMetadata', 'LightningComponentBundle',
  'AuraDefinitionBundle', 'CustomObject', 'CustomField', 'CustomLabel',
  'WorkflowRule', 'ValidationRule', 'Layout', 'Document', 'Report', 'Dashboard'
]);

function orgWith(names) {
  const candidates = Object.create(null);
  names.forEach(name => {
    candidates[name] = {
      value: name,
      imagesrc: ICON_MAP[name] || DEFAULT_ICON,
      technologyFeature: DEPLOYABLE.has(name) ? 'Salesforce' : 'Admin'
    };
  });
  return candidates;
}

const FULL_ORG = [
  'ApexClass', 'ApexTrigger', 'LightningComponentBundle', 'AuraDefinitionBundle',
  'Flow', 'FlowDefinition', 'CustomObject', 'CustomField', 'CustomLabel',
  'WorkflowRule', 'ApexPage', 'ApexComponent', 'StaticResource', 'CustomMetadata',
  'EmailTemplate', 'ApexLog', 'Document', 'User', 'Report', 'Dashboard', 'Account'
];

const rail = buildIconRail(orgWith(FULL_ORG));
const values = rail.map(item => item.value);

assert.strictEqual(rail.length, ICON_RAIL_LIMIT,
  `the rail should fill to ${ICON_RAIL_LIMIT} in an org with this much metadata, got ${rail.length}`);

assert.ok(values.includes('LightningComponentBundle'), 'LWC should be on the rail');
assert.ok(values.indexOf('LightningComponentBundle') < 3,
  'LWC should rank near the top, got position ' + (values.indexOf('LightningComponentBundle') + 1));

// Retired and non-metadata entries stay off, even though this org has them.
['WorkflowRule', 'FlowDefinition', 'ApexPage', 'ApexComponent', 'Document'].forEach(name => {
  assert.ok(!values.includes(name), `${name} is outdated and should not be on the rail`);
});
['User', 'Report', 'Dashboard', 'Account'].forEach(name => {
  assert.ok(!values.includes(name), `${name} is not metadata and should not be on the rail`);
});

const icons = rail.map(item => item.imagesrc);
assert.strictEqual(new Set(icons).size, icons.length,
  'every icon on the rail should be distinct: ' + icons.join(', '));

// A sparse org must not be padded with the excluded types.
const sparse = buildIconRail(orgWith(['ApexClass', 'WorkflowRule', 'ApexPage', 'ApexComponent', 'Document']));
assert.deepStrictEqual(sparse.map(i => i.value), ['ApexClass'],
  'a sparse org should return a short rail rather than fall back to retired types');

// The exclusion list and the preferred list must not contradict each other.
ICON_RAIL_TYPES.forEach(name => {
  assert.ok(!ICON_RAIL_EXCLUDED[name], `${name} is both preferred and excluded`);
});

console.log('icon rail regression test passed');
