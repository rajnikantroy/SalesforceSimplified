/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * What simplified.html opens on.
 *
 * A panel opens on nothing because the user summoned it and is about to say
 * what they want. A page opened from the toolbar has no such moment, so it
 * guesses from SetupAuditTrail - the same source the Audit Trail panel reads,
 * asked a different question: not "what changed" but "what kind of thing
 * keeps changing".
 *
 * The matching deliberately has no table mapping Salesforce's Section names
 * onto this extension's menu values. The menu already carries a label and an
 * API-ish value for every type it knows, and the audit trail says things like
 * Section "Apex Class" with Action "changedApexClass" - the two vocabularies
 * already agree once case and punctuation stop getting in the way. A metadata
 * type added to the menu later is therefore matched without anyone
 * remembering to teach this the name, which is the whole point and what these
 * cases are really checking.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

// Lift the two pure functions out. They are plain declarations inside the
// controller, so they can be evaluated without Angular, an org or a DOM.
const start = controller.indexOf("function tokenizeForMatch(text){");
const end = controller.indexOf('$scope.scoreMetadataAgainstAudit =');
assert.ok(start > -1 && end > start, 'the audit-trail matching helpers must still exist');

const context = { console };
vm.createContext(context);
vm.runInContext(controller.slice(start, end), context);
const score = context.scoreMetadataAgainstAudit;

// A menu as the org would produce it: queryable metadata types.
const MENU = [
    { value: 'ApexClass',                label: 'Apex Class',                  type: 'table' },
    { value: 'ApexTrigger',              label: 'Apex Trigger',                type: 'table' },
    { value: 'Flow',                     label: 'Flow Version',                type: 'table' },
    { value: 'WorkflowRule',             label: 'Workflow Rule',               type: 'table' },
    { value: 'CustomField',              label: 'Custom Fields',               type: 'table' },
    { value: 'ValidationRule',           label: 'Validation Rules',            type: 'table' },
    { value: 'LightningComponentBundle', label: 'Lightning Web Component Bundle', type: 'table' }
];

const row = (section, action, display) => ({ Section: section, Action: action, Display: display || '' });

// Dereferencing a null pick crashes with a TypeError and buries which case
// failed; name it instead.
function picked(records, menu, why) {
    const hit = score(records, menu);
    assert.ok(hit, why + ' - but nothing was picked at all');
    return hit.value;
}

/* ------------------------------------------------------------------ */
/* It picks what the org actually works on                              */
/* ------------------------------------------------------------------ */

const apexHeavy = [
    row('Apex Class', 'changedApexClass', 'Changed AccountService'),
    row('Apex Class', 'changedApexClass', 'Changed ContactService'),
    row('Apex Class', 'createdApexClass', 'Created OrderService'),
    row('Workflow Rule', 'changedWorkflowRule', 'Changed Escalation')
];
assert.strictEqual(picked(apexHeavy, MENU, 'the most-changed type should win'), 'ApexClass',
    'the most-changed type should win');

const flowHeavy = [
    row('Flow', 'changedFlow', 'Changed Send Email For Bundling Failures'),
    row('Flow', 'changedFlow', 'Changed Fix Schedule Overlaps'),
    row('Flow', 'activatedFlow', 'Activated Fix Schedule Overlaps'),
    row('Apex Class', 'changedApexClass', 'Changed AccountService')
];
assert.strictEqual(picked(flowHeavy, MENU, 'a flow-heavy org should land on flows'), 'Flow',
    'a flow-heavy org should land on flows');

/* ------------------------------------------------------------------ */
/* Salesforce's wording and ours are matched without a lookup table     */
/* ------------------------------------------------------------------ */

// Section spelt with a space, value without: "Apex Trigger" -> ApexTrigger.
assert.strictEqual(picked([row('Apex Trigger', 'changedApexTrigger')], MENU, 'punctuation and case must not stop the match'), 'ApexTrigger',
    'punctuation and case must not stop the match');

// Only the Action carries the type; Section is something broader.
assert.strictEqual(picked([row('Customize Opportunities', 'createdValidationRule')], MENU, 'the Action alone should be enough to identify the type'), 'ValidationRule',
    'the Action alone should be enough to identify the type');

// Matched on the label when the value is not what Salesforce says.
assert.strictEqual(picked([row('Custom Fields', 'createdCustomField', '')], MENU, 'the menu label is a valid way in as well'), 'CustomField',
    'the menu label is a valid way in as well');

/* ------------------------------------------------------------------ */
/* And it does not match on flimsy evidence                             */
/* ------------------------------------------------------------------ */

// "Flow" is a substring of "Workflow". A workflow change must not be read as
// a flow change - which is exactly what a naive contains-match would do.
const workflowOnly = [
    row('Workflow Rule', 'changedWorkflowRule', 'Changed Escalation'),
    row('Workflow Rule', 'createdWorkflowRule', 'Created Reminder')
];
assert.strictEqual(picked(workflowOnly, MENU, 'a workflow change must not be mistaken for a flow change'), 'WorkflowRule',
    'a workflow change must not be mistaken for a flow change');

// Nothing recognisable at all. Checked with score() directly, not picked() -
// here null is the correct answer rather than a failure.
assert.strictEqual(score([row('Manage Users', 'changedProfile', 'Changed Standard User')], MENU), null,
    'an audit trail with none of these types should yield no pick');

assert.strictEqual(score([], MENU), null, 'no audit rows means no pick');
assert.strictEqual(score(null, MENU), null, 'a failed query means no pick');
assert.strictEqual(score([row('Apex Class', 'changedApexClass')], []), null,
    'no candidates means no pick');

/* ------------------------------------------------------------------ */
/* The specific answer beats the vague one                              */
/* ------------------------------------------------------------------ */

const bundleRows = [
    row('Lightning Component Bundle', 'changedLightningComponentBundle', 'Changed accountCard')
];
assert.strictEqual(picked(bundleRows, MENU, 'the most specific type name should win'),
    'LightningComponentBundle',
    'a long, specific type name should be preferred over any shorter partial match');

/* ------------------------------------------------------------------ */
/* It is only wired to the standalone page                              */
/* ------------------------------------------------------------------ */

assert.ok(/\$scope\._pendingFavourite\s*=\s*true/.test(controller),
    'the standalone startup must request the initial pick');
assert.ok(/if\s*\(\$scope\._pendingFavourite\)\s*\{[\s\S]*?openFavouriteMetadata\(\)/.test(controller),
    'the pick must run once the dynamic catalogue has populated the menu');

// The panel must not inherit it: it opens on nothing by design.
const standaloneBlock = controller.slice(controller.indexOf('$scope.isStandalonePage = ssIsStandalonePage()'));
assert.ok(standaloneBlock.indexOf('_pendingFavourite = true') > -1,
    'the flag should be set inside the standalone-only block');

/* ------------------------------------------------------------------ */
/* Who gets metadata, and who gets data                                 */
/*                                                                      */
/* System admins are here for the setup - that is what Modify All Data  */
/* and Author Apex are for, and the metadata lists are why such a       */
/* person installs this at all. Everyone else is likelier to want        */
/* records, but only their own history can say so: dropping a user who  */
/* has touched no records into one helps nobody.                        */
/* ------------------------------------------------------------------ */

const decideStart = controller.indexOf('function decideDefaultSelection(');
const decideEnd = controller.indexOf('$scope.decideDefaultSelection =');
assert.ok(decideStart > -1 && decideEnd > decideStart, 'the decision rule must still exist');
vm.runInContext(controller.slice(decideStart, decideEnd), context);
const decide = context.decideDefaultSelection;

const ADMIN    = { isAdmin: true,  isBuilder: false };
const BUILDER  = { isAdmin: false, isBuilder: true  };
const EVERYONE = { isAdmin: false, isBuilder: false };

// Admins get metadata, whatever the numbers say.
assert.strictEqual(decide(ADMIN, 0, 500), 'metadata',
    'a system admin should land on metadata even with far more data activity');
assert.strictEqual(decide(ADMIN, 3, 0), 'metadata', 'and with a little setup activity');
assert.strictEqual(decide(BUILDER, 0, 500), 'metadata',
    'someone who writes Apex is here for the metadata too');

// Everyone else gets data, but only on evidence.
assert.strictEqual(decide(EVERYONE, 2, 40), 'data',
    'a non-admin who mostly opens records should land on data');
assert.strictEqual(decide(EVERYONE, 40, 2), 'metadata',
    'a non-admin who mostly changes setup should still land on metadata');
assert.strictEqual(decide(EVERYONE, 0, 0), 'metadata',
    'with no evidence either way, do not drop them into a record list');
assert.strictEqual(decide(EVERYONE, 5, 5), 'metadata',
    'a tie is not evidence of a data preference');
assert.strictEqual(decide(null, 0, 9), 'data',
    'an unreadable profile must not be treated as an admin');

/* ------------------------------------------------------------------ */
/* The busiest object wins, counted not de-duplicated                   */
/* ------------------------------------------------------------------ */

const dataStart = controller.indexOf('function scoreDataAgainstRecent(');
const dataEnd = controller.indexOf('$scope.scoreDataAgainstRecent =');
vm.runInContext(controller.slice(dataStart, dataEnd), context);
const scoreData = context.scoreDataAgainstRecent;

const DATA_MENU = [
    { value: 'Case',    label: 'Case',    type: 'table', technologyFeature: 'Admin' },
    { value: 'Account', label: 'Account', type: 'table', technologyFeature: 'Admin' }
];
const viewed = ['Case','Case','Case','Account','Case','Report','Case'];
const dataPick = scoreData(viewed, DATA_MENU);
assert.ok(dataPick, 'a user who opens records should yield a pick');
assert.strictEqual(dataPick.item.value, 'Case', 'forty Cases beats one Account');
assert.strictEqual(dataPick.hits, 5, 'the weight is the row count, not the distinct count');
assert.strictEqual(scoreData(['Report','Dashboard'], DATA_MENU), null,
    'types that are not offered in the menu cannot be recommended');
assert.strictEqual(scoreData([], DATA_MENU), null, 'nothing viewed means no pick');
assert.strictEqual(scoreData(null, DATA_MENU), null, 'an unreadable history means no pick');

/* ------------------------------------------------------------------ */
/* Choosing data has to make data visible                               */
/* ------------------------------------------------------------------ */

// Data objects carry technologyFeature 'Admin' and are hidden unless the
// Data switch is on - which for a non-admin it is not, by default. Selecting
// one without turning it on would open an entry absent from the menu.
const picker = controller.slice(controller.indexOf('function openFavouriteMetadata()'));
assert.ok(/\$scope\.Admin = true/.test(picker),
    'choosing data must switch the Data feature on');
assert.ok(/setSimplifiedCookie\('Simplified_Admin', true\)/.test(picker),
    'and persist it, because it is now what the user wants');
assert.ok(/allMetadataList/.test(picker),
    'candidates must come from the full catalogue, not the filtered menu - ' +
    'the filtered menu hides the very data objects this rule recommends');

/* ------------------------------------------------------------------ */
/* Recency, not volume                                                  */
/*                                                                      */
/* "What is this person working on" and "what have they touched most"   */
/* are different questions with different answers. An org with a long   */
/* history of Profile edits opens on Profile forever - however long ago */
/* that was, and whatever the person has been doing since.              */
/* ------------------------------------------------------------------ */

const recentStart = controller.indexOf('function mostRecentMetadataFromAudit(');
const recentEnd = controller.indexOf('$scope.mostRecentMetadataFromAudit =');
assert.ok(recentStart > -1 && recentEnd > recentStart, 'the recency rule must still exist');
vm.runInContext(controller.slice(recentStart, recentEnd), context);
const mostRecent = context.mostRecentMetadataFromAudit;

// Newest first, as SetupAuditTrail returns it: one flow change today on top
// of a pile of historical profile edits.
const historyHeavy = [
    row('Flow', 'changedFlow', 'Changed Fix Schedule Overlaps'),
    row('Manage Users', 'changedProfile', 'Changed Standard User'),
    row('Manage Users', 'changedProfile', 'Changed Marketing User'),
    row('Manage Users', 'changedProfile', 'Changed Support User'),
    row('Manage Users', 'changedProfile', 'Changed Sales User')
];
const PROFILE_MENU = MENU.concat([
    { value: 'Profile',       label: 'Profile',        type: 'table' },
    { value: 'PermissionSet', label: 'Permission Set', type: 'table' }
]);

assert.strictEqual(score(historyHeavy, PROFILE_MENU).value, 'Profile',
    'by volume, the long profile history wins - which is the behaviour being replaced');
assert.strictEqual(mostRecent(historyHeavy, PROFILE_MENU).value, 'Flow',
    'by recency, the thing they changed most recently wins');

assert.strictEqual(mostRecent([], PROFILE_MENU), null, 'no rows means no pick');
assert.strictEqual(mostRecent(null, PROFILE_MENU), null, 'an unreadable trail means no pick');
assert.strictEqual(mostRecent([row('Manage Users', 'somethingUnknown')], PROFILE_MENU), null,
    'rows naming nothing in the menu yield no pick');

// Rows that name nothing are skipped rather than stopping the walk.
const noisyTop = [
    row('Manage Users', 'loginAsUser', 'Logged in as Test User'),
    row('Company Information', 'changedFiscalYear', ''),
    row('Apex Class', 'changedApexClass', 'Changed AccountService')
];
assert.strictEqual(mostRecent(noisyTop, PROFILE_MENU).value, 'ApexClass',
    'unrecognised rows should be walked past, not treated as the end of the trail');

/* ------------------------------------------------------------------ */
/* Salesforce's abbreviations                                           */
/*                                                                      */
/* Action names shorten words - "changedPermSet" - so PermissionSet     */
/* found "set" and never "permission", and lost to Profile, which       */
/* Salesforce happens to spell out in full. A prefix test fixes that    */
/* without a table of abbreviations to maintain.                        */
/* ------------------------------------------------------------------ */

// The hard case: Section says nothing useful, only the abbreviation does.
assert.strictEqual(picked([row('Manage Users', 'changedPermSet', 'Changed Sales_User')],
    PROFILE_MENU, 'an abbreviated action should still identify the type'), 'PermissionSet',
    'PermSet must resolve to PermissionSet');

assert.strictEqual(picked([row('Permission Sets', 'changedPermSet', '')],
    PROFILE_MENU, 'the spelt-out section should work too'), 'PermissionSet',
    'and the spelt-out form as well');

// And the distinction that the prefix test must not destroy.
assert.strictEqual(picked(workflowOnly, MENU,
    'a prefix test must not reintroduce the flow/workflow confusion'), 'WorkflowRule',
    '"flow" does not begin "workflow", so a workflow change is still not a flow change');

// Nor should a short prefix match anything it likes: "set" must not reach
// "setup", which is why the abbreviation has a minimum length.
assert.strictEqual(score([row('Setup', 'changedSetupEntity', '')],
    [{ value: 'PermissionSet', label: 'Permission Set', type: 'table' }]), null,
    '"setup" must not be read as "set"');

/* ------------------------------------------------------------------ */
/* Plurals, and the floor that keeps the prefix test honest             */
/* ------------------------------------------------------------------ */

// Salesforce pluralises Section names against our singular values.
assert.strictEqual(picked([row('Validation Rules', 'createdValidationRule', '')], MENU,
    'a plural section should match a singular menu value'), 'ValidationRule',
    '"Validation Rules" must reach ValidationRule');

// Section alone, plural, with no help from the Action.
assert.strictEqual(picked([row('Permission Sets', 'somethingOpaque', '')], PROFILE_MENU,
    'a plural section alone should be enough'), 'PermissionSet',
    '"Permission Sets" must reach PermissionSet without the Action');

// The floor: three letters is not an abbreviation of anything, or "set"
// reaches "setup" and every setup change looks like a permission set change.
assert.strictEqual(score([row('Set', '', '')], [{ value: 'Setup', label: 'Setup', type: 'table' }]),
    null, '"set" must not be treated as an abbreviation of "setup"');

// And the distinction the prefix test must never destroy, now that it works
// in both directions.
assert.strictEqual(picked(workflowOnly, MENU,
    'symmetry must not let flow reach workflow'), 'WorkflowRule',
    '"flow" is not a prefix of "workflow" in either direction');

/* ------------------------------------------------------------------ */
/* The order of evidence                                                */
/*                                                                      */
/* Each source answers "what is this person working on" less directly   */
/* than the one before, so the order is the feature: the last thing     */
/* they actually changed, then the last thing they opened here, then    */
/* whatever they use most. Volume comes last because a long history     */
/* outvotes this morning otherwise - which is exactly how a pile of old */
/* Profile edits kept winning.                                          */
/* ------------------------------------------------------------------ */

const chainStart = controller.indexOf('var metadataPick =');
const chain = controller.slice(chainStart, controller.indexOf(';', chainStart));

const byUsageAt   = chain.indexOf('topByUsage');
const ownRowsAt   = chain.indexOf('scoreMetadataAgainstAudit');
const lastOpenAt  = chain.indexOf('lastOpenedMetadata');
const recencyAt   = chain.indexOf('mostRecentMetadataFromAudit');

assert.ok(byUsageAt > -1,  'the pick must start from the usage ranking the menu is built on');
assert.ok(ownRowsAt > -1,  'and fall back to their own audit rows');
assert.ok(lastOpenAt > -1, 'then to what they last opened here');
assert.ok(recencyAt > -1,  'and finally to the last thing they changed');

/*
 * Frequency first. The metadata section is built on the audit-trail tally -
 * orgScore is what orders the menu - so the recommendation has to come from
 * the same ranking, or the page opens on one thing while the sidebar says
 * another is the favourite.
 */
assert.ok(byUsageAt < ownRowsAt,
    'the org usage ranking must be tried before recomputing from raw rows');
assert.ok(ownRowsAt < lastOpenAt,
    'frequency must be exhausted before falling back to a remembered choice');
assert.ok(lastOpenAt < recencyAt,
    'and recency is the last resort, not the first');

// The remembered choice only exists because opening something records it.
assert.ok(/rememberLastMetadata\(data\.value\)/.test(controller),
    'opening a metadata list must record it, or there is nothing to fall back to');
assert.ok(/function lastOpenedMetadata\(candidates\)/.test(controller),
    'and something must read it back');

/* ------------------------------------------------------------------ */
/* A refresh is not a new visit                                         */
/*                                                                      */
/* Someone reloading is in the middle of something and expects to come  */
/* back to it. Re-running the recommendation there takes the page away  */
/* from them - and the better the recommendation, the more annoying     */
/* that is.                                                             */
/*                                                                      */
/* sessionStorage carries it, because its lifetime is exactly the       */
/* behaviour wanted: survives a reload, dies with the tab. So a refresh */
/* restores and a fresh toolbar open recommends, with no need to ask    */
/* the browser how it was navigated to.                                 */
/* ------------------------------------------------------------------ */

assert.ok(/function openInitialMetadata\(\)/.test(controller),
    'the page must have a single entry point that decides restore vs recommend');

const initial = controller.slice(controller.indexOf('function openInitialMetadata()'),
                                 controller.indexOf('function restoreSessionSelection()'));
const restoreAt = initial.indexOf('restoreSessionSelection');
const recommendAt = initial.indexOf('openFavouriteMetadata');
assert.ok(restoreAt > -1 && recommendAt > -1,
    'it must consider both the restored selection and the recommendation');
assert.ok(restoreAt < recommendAt,
    'the restored selection must win over the recommendation, or a refresh moves the user');
assert.ok(/return;\s*\}\s*openFavouriteMetadata\(\)/.test(initial.replace(/\s+/g, ' ').replace(/ /g, ' ')) ||
          /if\s*\(restored\)/.test(initial),
    'the recommendation must be skipped entirely when a selection was restored');

// sessionStorage, specifically - a cookie or chrome.storage would outlive the
// tab and make every later open a "refresh".
assert.ok(/sessionStorage\.setItem/.test(controller) && /sessionStorage\.getItem/.test(controller),
    'the per-tab selection must use sessionStorage');
assert.ok(!/localStorage\.setItem\(sessionSelectionKey/.test(controller),
    'it must not be persisted beyond the tab');

// Keyed by org, so an org's selection cannot be restored while looking at a
// different one. The key is built for an arbitrary origin rather than only the
// loaded one, because switching org has to reach the *target* org's entry
// before the page reloads into it.
assert.ok(/function sessionSelectionKeyFor\(origin\)[\s\S]*?ssOrgKey/.test(controller),
    'the stored selection must be scoped to the org');
assert.ok(/function sessionSelectionKey\(\)\s*\{\s*return sessionSelectionKeyFor\(SS_ORIGIN\)/.test(controller),
    'and the current org is just one caller of that');

/*
 * Changing org opens that org's favourite, not what was last looked at there.
 *
 * Switching to an org for the first time already did this - there was no entry
 * to restore. Switching *back* to one visited earlier in the session restored
 * its last selection instead, and those are the same act to the user. So the
 * switch drops the target org's memory on the way out.
 */
/*
 * Bounded by the function's own braces rather than by a character count. The
 * count was 1400, and adding a branch at the top of switchOrg pushed the line
 * below out of the window - so this failed for a reason that had nothing to do
 * with what it checks.
 */
const switchFn = (() => {
    const start = controller.indexOf('$scope.switchOrg = function()');
    assert.notStrictEqual(start, -1, 'switchOrg must still exist');
    let depth = 0;
    for (let i = controller.indexOf('{', start); i < controller.length; i++) {
        if (controller[i] === '{') { depth++; }
        else if (controller[i] === '}') { depth--; if (depth === 0) { return controller.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in switchOrg');
})();
assert.ok(/sessionStorage\.removeItem\(sessionSelectionKeyFor\(\$scope\.currentOrigin\)\)/.test(switchFn),
    'switching org must clear that org\'s remembered selection, so it opens the favourite');
assert.ok(!/sessionStorage\.clear\(\)/.test(switchFn),
    'and only that org\'s - an ordinary refresh elsewhere must still restore what was on screen');

// Restoring has to make the entry visible, or it is selected in a menu that
// does not contain it.
const restoreFn = controller.slice(controller.indexOf('function restoreSessionSelection()'),
                                   controller.indexOf('function openFavouriteMetadata()'));
assert.ok(/\$scope\.Admin = true/.test(restoreFn) && /\$scope\.Developer = true/.test(restoreFn),
    'restoring a hidden family must switch that family back on');

console.log('favourite metadata regression test passed');
