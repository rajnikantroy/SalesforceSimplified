/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};
const moduleObj = {
  service(name, deps, factory) {
    moduleObj.factory = (typeof deps === 'function') ? deps : deps[deps.length - 1];
  }
};
const context = {
  window: { app: moduleObj },
  angular: { module() { return moduleObj; } },
  chrome: { runtime: { getURL: () => 'chrome://icon' } },
  localStorage,
  readCookie: () => '',
  escapeSoqlLiteral: (value) => String(value).replace(/'/g, "\\'"),
  ssSobjectsUrl: () => 'https://example.test/sobjects',
  ssToolingQueryUrl: () => 'https://example.test/tooling/query',
  ssQueryUrl: () => 'https://example.test/query'
};

vm.runInNewContext(
  fs.readFileSync('./js/angular/services/DynamicMetadataService.js', 'utf8'),
  context
);

const factory = moduleObj.factory;
assert.ok(factory, 'DynamicMetadataService factory was not registered');

// No object has been described yet, so buildSpec must fall back to its own
// tables. That is the case these assertions cover: the specs a fresh session
// produces before the query engine has fetched anything from the org.
const schemaService = {
  digestSync: () => null,
  // The real service picks grid columns from the describe; a stub without

  // it would exercise a path the extension never takes.

  columnsFor: () => [],

  displayFieldOf: (digest, preferred) => preferred || 'Name',
  hasField: () => true,
  hasRelationship: () => true,
  globalDescribe: () => Promise.resolve({}),
  toolingDescribe: () => Promise.resolve({})
};

const service = new factory(
  { get: async () => ({ sobjects: [] }), query: async () => ({ records: [] }) },
  Promise,
  { id: '005xyz' },
  schemaService
);

const unsupported = ['PermissionSetTabSetting', 'PicklistValueInfo', 'PermissionSetEventStore', 'PplnInspListViewCalcClmn', 'SchedulingWorkspaceTerritoryFeed', 'SchedulingWorkspaceShare', 'ServiceCrewMemberFeed', 'OrgEmailAddressSecurity', 'PaymentGateway', 'OrgWideEmailAddress', 'WorkPlanSelectionRule', 'WorkPlanTemplate', 'WorkStepTemplate', 'AttributeDefinition', 'BriefcaseRule', 'ConvIntelligenceSignalRule', 'ConvIntelligenceSignalSubRule', 'DashboardComponent', 'DuplicateRule', 'MailmergeTemplate', 'MaintenanceWorkRule', 'MatchingRule', 'MessagingTemplate', 'MLModelFactorComponent', 'CaseTeamTemplate', 'PrivacyPolicyDefinition', 'ProcessDefinition', 'ProductEntitlementTemplate', 'PromotionLineItemRule', 'RecordsetFilterCriteriaRule', 'SearchPromotionRule', 'LiveChatSensitiveDataRule', 'ServiceReportLayout', 'ShiftTemplate'];
for (const name of unsupported) {
  const spec = service.buildSpec(name, { label: name, queryable: true }, false, true);
  assert.strictEqual(spec.queryForAll, null, `${name} should be treated as non-queryable`);
  assert.strictEqual(spec.query, null, `${name} should not build a SOQL query`);
}

const taskSpec = service.buildSpec('Task', { label: 'Task', queryable: true }, false, true);
assert.ok(taskSpec.query.includes('SELECT Id, Subject'), 'Task query should use Subject instead of Name');

const schedulingRuleParamSpec = service.buildSpec('SchedulingRuleParameter', { label: 'SchedulingRuleParameter', queryable: true }, false, true);
assert.ok(schedulingRuleParamSpec.query.includes('DeveloperName'), 'SchedulingRuleParameter query should use a valid display field instead of Name');

const gatewaySpec = service.buildSpec('GtwyProvPaymentMethodType', { label: 'GtwyProvPaymentMethodType', queryable: true }, false, true);
assert.ok(gatewaySpec.query.includes('DeveloperName'), 'GtwyProvPaymentMethodType query should use a valid display field instead of Name');

const paymentGatewayProviderSpec = service.buildSpec('PaymentGatewayProvider', { label: 'PaymentGatewayProvider', queryable: true }, false, true);
assert.ok(paymentGatewayProviderSpec.query.includes('DeveloperName'), 'PaymentGatewayProvider query should use a valid display field instead of Name');

const uiFormulaRuleSpec = service.buildSpec('UiFormulaRule', { label: 'UiFormulaRule', queryable: true }, false, true);
assert.ok(uiFormulaRuleSpec.query.includes('DeveloperName'), 'UiFormulaRule query should use a valid display field instead of Name');

const auraDefinitionSpec = service.buildSpec('AuraDefinition', { label: 'AuraDefinition', queryable: true }, false, true);
assert.ok(auraDefinitionSpec.query.includes('MasterLabel'), 'AuraDefinition query should use the valid MasterLabel field instead of Name/DeveloperName');

const mdtSpec = service.buildSpec('Auth_Settings__mdt', { label: 'Auth_Settings__mdt', queryable: true }, false, true);
assert.ok(mdtSpec.query.includes('DeveloperName'), 'Metadata custom objects without Name should use DeveloperName');

const briefcaseSpec = service.buildSpec('BriefcaseDefinition', { label: 'BriefcaseDefinition', queryable: true }, false, true);
assert.ok(briefcaseSpec.query.includes('DeveloperName'), 'BriefcaseDefinition should use DeveloperName instead of Name');

const entityDefinitionSpec = service.buildSpec('EntityDefinition', { label: 'EntityDefinition', queryable: true }, false, true);
assert.ok(entityDefinitionSpec.query.includes('QualifiedApiName'), 'EntityDefinition should use QualifiedApiName instead of Name');

const permissionSetGroupComponentSpec = service.buildSpec('PermissionSetGroupComponent', { label: 'PermissionSetGroupComponent', queryable: true }, false, true);
assert.ok(permissionSetGroupComponentSpec.query.includes('MasterLabel'), 'PermissionSetGroupComponent should use a valid MasterLabel field instead of Name/DeveloperName');
assert.ok(!permissionSetGroupComponentSpec.query.includes('LastModifiedBy.Name'), 'PermissionSetGroupComponent should not add LastModifiedBy.Name');

const relatedListSpec = service.buildSpec('RelatedListDefinition', { label: 'RelatedListDefinition', queryable: true }, false, true);
assert.ok(relatedListSpec.query.includes('DeveloperName'), 'RelatedListDefinition should use DeveloperName instead of Name');

const tabDefinitionSpec = service.buildSpec('TabDefinition', { label: 'TabDefinition', queryable: true }, false, true);
assert.ok(!tabDefinitionSpec.query.includes('NamespacePrefix'), 'TabDefinition should not include NamespacePrefix');

const permissionSetSpec = service.buildSpec('PermissionSet', { label: 'PermissionSet', queryable: true }, false, true);
assert.ok(!permissionSetSpec.query.includes('LastModifiedBy.Name'), 'PermissionSet query should not add unsupported LastModifiedBy.Name');

// The row template renders Name / DeveloperName / MasterLabel / CaseNumber
// and friends by name, and falls back to spec.displayField for everything
// else. Without that field a Dashboard row is a checkbox and no text.
const dashboardSpec = service.buildSpec('Dashboard', { label: 'Dashboard', queryable: true }, false, true);
assert.strictEqual(dashboardSpec.displayField, 'Title',
  'Dashboard should expose Title as its display field');
assert.ok(dashboardSpec.query.includes('Title'), 'Dashboard query should select Title');

const taskDisplaySpec = service.buildSpec('Task', { label: 'Task', queryable: true }, false, true);
assert.strictEqual(taskDisplaySpec.displayField, 'Subject',
  'Task should expose Subject as its display field');

// Every spec needs one, or the fallback cell has nothing to read.
['Account', 'ApexClass', 'ValidationRule', 'EntityDefinition'].forEach(name => {
  const spec = service.buildSpec(name, { label: name, queryable: true }, false, true);
  assert.ok(spec.displayField, `${name} should expose a display field`);
});

console.log('dynamic metadata regression test passed');

/*
 * The developer metadata types exist only in the Tooling catalogue, so a menu
 * built from /sobjects alone cannot show LWC, Aura bundles, CustomField,
 * CustomObject, WorkflowRule or ValidationRule at all.
 */
const entry = (name, label) => ({ name, label: label || name, queryable: true });

const mergedService = new factory(
  { get: async () => ({ sobjects: [] }), query: async () => ({ records: [] }) },
  Promise,
  { id: '005xyz' },
  Object.assign({}, schemaService, {
    globalDescribe: () => Promise.resolve({
      ApexClass: entry('ApexClass', 'Apex Class'),
      Account: entry('Account')
    }),
    toolingDescribe: () => Promise.resolve({
      LightningComponentBundle: entry('LightningComponentBundle', 'Lightning Component Bundle'),
      AuraDefinitionBundle: entry('AuraDefinitionBundle', 'Aura Component Bundle'),
      CustomField: entry('CustomField'),
      ValidationRule: entry('ValidationRule'),
      // Tooling plumbing: present, but not something to put in the menu.
      ContainerAsyncRequest: entry('ContainerAsyncRequest')
    })
  })
);

mergedService.getDynamicMetadataList().then(list => {
  const byValue = {};
  list.forEach(spec => { byValue[spec.value] = spec; });

  ['LightningComponentBundle', 'AuraDefinitionBundle', 'CustomField', 'ValidationRule'].forEach(name => {
    assert.ok(byValue[name], `${name} should appear in the metadata list`);
    assert.ok(!byValue[name].isSystemNoise, `${name} should not be hidden as system noise`);
    assert.strictEqual(byValue[name].technologyFeature, 'Salesforce',
      `${name} should be categorised as deployable metadata`);
  });

  // REST entries still come through, and are not displaced by the merge.
  assert.ok(byValue.ApexClass, 'REST objects should still be listed');
  assert.ok(byValue.Account, 'REST data objects should still be listed');

  // Plumbing is listed but stays behind "Show All System Objects".
  assert.ok(byValue.ContainerAsyncRequest && byValue.ContainerAsyncRequest.isSystemNoise,
    'Tooling plumbing should be marked system noise');

  assert.ok(byValue.LightningComponentBundle.query.includes('LightningComponentBundle'),
    'LWC should build a real query');

  console.log('dynamic metadata tooling-merge test passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
