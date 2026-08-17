/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * Today's users, as a way into the audit trail.
 *
 * The sidebar knew who had signed in and the trail knew what they changed,
 * and nothing joined the two: you read a name on the right and typed it into
 * the box on the left. Clicking now does that.
 *
 * The value pasted is the one thing here that can be quietly wrong. Quick
 * Find compares against CreatedBy.Name, and the row's display label falls
 * back to the user's Id when the org refused the name query - so pasting the
 * label would put an 18-character Id in the box, match nothing, and look
 * exactly like a filter that found no changes rather than one that was given
 * nothing to find.
 */

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const controller = read('js/angular/controllers/MenuAndDetailsCtrl.js');
const view = read('js/angular/services/ViewService.js');
const css = read('css/styles.css');

function lift(signature) {
    const at = controller.indexOf(signature);
    assert.ok(at > -1, signature + ' not found - it has been renamed or removed');
    let depth = 0, started = false;
    for (let i = at; i < controller.length; i += 1) {
        if (controller[i] === '{') { depth += 1; started = true; }
        else if (controller[i] === '}') {
            depth -= 1;
            if (started && depth === 0) { return controller.slice(at, i + 1); }
        }
    }
    throw new Error('unterminated ' + signature);
}

/* The real functions, over a stub scope that records what was filtered. */
function panel() {
    const box = { $scope: { auditFilters: { search: '', section: '', user: '' }, applied: 0 } };
    box.globalThis = box;
    vm.createContext(box);
    vm.runInContext(
        '$scope.applyAuditFilters = function(){ $scope.applied += 1; };\n' +
        lift('$scope.canFindAuditUser = function(person){') + ';\n' +
        lift('$scope.findAuditUser = function(person){') + ';', box);

    return {
        scope: box.$scope,
        click: (person) => vm.runInContext(
            '$scope.findAuditUser(' + JSON.stringify(person) + ')', box),
        canClick: (person) => vm.runInContext(
            '$scope.canFindAuditUser(' + JSON.stringify(person) + ')', box)
    };
}

const ALICE = { userId: '005000000000001', name: 'Alice Chen',
                username: 'alice@acme.com', logins: 4 };
/* The org refused the name query, so the row shows the id. */
const NAMELESS = { userId: '005000000000002', label: '005000000000002', logins: 1 };

/* ------------------------------------------------------------------ */
/* Clicking a person filters the trail to them                         */
/* ------------------------------------------------------------------ */

{
    const p = panel();
    p.click(ALICE);
    assert.strictEqual(p.scope.auditFilters.search, 'Alice Chen',
        'the person\'s name is not put in Quick Find');
    assert.strictEqual(p.scope.applied, 1,
        'the filter was set but never applied, so the list does not change');
}

/*
 * The name, never the label. This is the whole reason the two are kept apart:
 * an Id in Quick Find matches nothing in the trail.
 */
{
    const p = panel();
    p.click(NAMELESS);
    assert.strictEqual(p.scope.auditFilters.search, '',
        'a row with no name pasted something anyway - which can only be the id, ' +
        'and an id matches nothing in the audit trail');
    assert.strictEqual(p.scope.applied, 0,
        'the trail was re-filtered on a click that changed nothing');
    assert.strictEqual(p.canClick(NAMELESS), false,
        'a row with no name is still offered as clickable');
    assert.strictEqual(p.canClick(ALICE), true);
}

/*
 * And the label is not what is read. A row can carry both, and reading the
 * wrong one is invisible until a user's name and display label differ.
 */
{
    const p = panel();
    p.click({ userId: '005', name: 'Real Name', label: 'Different Label' });
    assert.strictEqual(p.scope.auditFilters.search, 'Real Name',
        'the display label was pasted instead of the name Quick Find matches on');
}

/* ------------------------------------------------------------------ */
/* Clicking the same person again clears it                            */
/* ------------------------------------------------------------------ */

/*
 * Otherwise the only way back to the whole trail is to select the text and
 * delete it - a strange thing to have to do to a list you filtered with one
 * click.
 */
{
    const p = panel();
    p.click(ALICE);
    p.click(ALICE);
    assert.strictEqual(p.scope.auditFilters.search, '',
        'clicking the filtering row again does not clear the filter');
    assert.strictEqual(p.scope.applied, 2, 'clearing the filter did not re-apply it');
}

/* A different person replaces the filter rather than clearing it. */
{
    const p = panel();
    p.click(ALICE);
    p.click({ userId: '005000000000003', name: 'Bob Ray' });
    assert.strictEqual(p.scope.auditFilters.search, 'Bob Ray',
        'clicking a second person cleared the filter instead of moving it');
}

/* The other filters are left alone - section and user are separate controls,
 * and resetting them would undo a choice nobody touched. */
{
    const p = panel();
    p.scope.auditFilters.section = 'Manage Users';
    p.scope.auditFilters.user = 'Someone Else';
    p.click(ALICE);
    assert.strictEqual(p.scope.auditFilters.section, 'Manage Users',
        'the section filter was reset by a click on a user');
    assert.strictEqual(p.scope.auditFilters.user, 'Someone Else',
        'the user dropdown was reset by a click on a user');
}

/* Nothing at all is a no-op rather than a throw. */
{
    const p = panel();
    p.click(null);
    p.click({});
    assert.strictEqual(p.scope.auditFilters.search, '');
    assert.strictEqual(p.scope.applied, 0);
}

/* ------------------------------------------------------------------ */
/* The heading counts, and the row is wired                            */
/* ------------------------------------------------------------------ */

const card = view.slice(view.indexOf('this.activeuserstoday'),
                        view.indexOf('this.searchdata'));
assert.ok(card.length > 400, 'the active-users card could not be read');

assert.ok(/In the org today[\s\S]{0,200}\{\{activeUsersToday\.length\}\}/.test(card),
    'the heading does not carry the count');

/*
 * And only once there is a list. Shown unconditionally it reads "(0)" for as
 * long as the login query takes, which is a statement about the org rather
 * than about the query still running.
 */
assert.ok(/ng-show="activeUsersToday\.length"> \(\{\{activeUsersToday\.length\}\}\)/.test(card),
    'the count is shown before the list has loaded, so it reads "(0)" while ' +
    'the query is still running');

assert.ok(/ng-click="findAuditUser\(person\)"/.test(card),
    'the rows do not filter the trail when clicked');
assert.ok(/is-filtering[\s\S]{0,120}auditFilters\.search === person\.name/.test(card),
    'the row doing the filtering is not marked, so nothing on the page says ' +
    'which row applied the filter');
assert.ok(/is-inert[\s\S]{0,60}!canFindAuditUser\(person\)/.test(card),
    'a row that cannot filter still looks clickable');

/* The bindings exist, or the whole row is decoration. */
['findAuditUser', 'canFindAuditUser', 'applyAuditFilters'].forEach((name) => {
    assert.ok(new RegExp('\\$scope\\.' + name + ' = function').test(controller),
        name + ' is not on the scope, so the row does nothing when clicked');
});

/* And the two states are actually drawn. */
assert.ok(/\.ss-user-row\.is-filtering \{/.test(css),
    'the filtering row has no style, so the mark is invisible');
assert.ok(/\.ss-user-row\.is-inert \{[^}]*cursor:\s*default/.test(css),
    'an unclickable row still shows a pointer cursor');

console.log('audit_user_filter: ok');
