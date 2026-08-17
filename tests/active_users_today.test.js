/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Who is in the org today, beside the audit trail.
 *
 * The audit trail answers what changed; this answers who else is here. They
 * are deliberately different sources - the audit trail lists only people who
 * changed setup, and most people using an org change nothing, so building
 * "who is using this org" from the rows already on screen would quietly omit
 * everyone doing ordinary work. It comes from LoginHistory instead.
 *
 * These execute the shipped functions. A substring check for this controller's
 * selection cap once passed against a different function that happened to
 * contain the same expression while the cap was not applied at all, so what is
 * asserted here is behaviour.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

// Brace-matched: bounding a function at its first "\n    }" truncates it at
// the first nested block, which has produced tests that passed against half a
// function.
function lift(signature) {
    const start = controller.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0;
    let index = controller.indexOf('{', start);
    for (; index < controller.length; index++) {
        if (controller[index] === '{') { depth++; }
        else if (controller[index] === '}') {
            depth--;
            if (depth === 0) { return controller.slice(start, index + 1); }
        }
    }
    throw new Error('unbalanced braces in ' + signature);
}

const soqlDecl = controller.match(/var ACTIVE_TODAY_SOQL =[\s\S]*?;/);
assert.ok(soqlDecl, 'could not find ACTIVE_TODAY_SOQL');

const SOURCE = [
    soqlDecl[0],
    lift('function summariseLogins(records){'),
    lift('$scope.loadActiveUsersToday = function(){') + ';'
].join('\n');

function load(loginRows, userRows, options) {
    const opts = options || {};
    const asked = [];
    const $scope = {};

    const sfdc = {
        query(soql) {
            asked.push(soql);
            if (/FROM LoginHistory/.test(soql)) {
                return opts.refuseLogins
                    ? Promise.reject({ message: 'INSUFFICIENT_ACCESS' })
                    : Promise.resolve({ records: loginRows });
            }
            return opts.refuseNames
                ? Promise.reject({ message: 'INSUFFICIENT_ACCESS' })
                : Promise.resolve({ records: userRows });
        },
        errorMessage: (error, label) => label + ': ' + ((error && error.message) || 'refused')
    };

    const env = {
        $scope: $scope,
        $q: Object.assign((fn) => new Promise(fn), {
            when: (v) => Promise.resolve(v), all: (list) => Promise.all(list)
        }),
        sfdc: sfdc,
        escapeSoqlLiteral: (v) => String(v)
    };
    const names = Object.keys(env);
    new Function(...names, SOURCE)(...names.map((n) => env[n]));

    return { $scope, asked };
}

const login = (userId, time, status, application) => ({
    UserId: userId,
    LoginTime: time,
    Status: status || 'Success',
    Application: application || 'Browser',
    LoginType: 'Application'
});

const user = (id, name) => ({ Id: id, Name: name, Username: name.toLowerCase() + '@acme.com' });

async function main() {

    /* ------------------------------------------------------------------ */
    /* Today, in the viewer's own timezone                                 */
    /*                                                                     */
    /* TODAY is a date literal Salesforce resolves in the user's timezone,  */
    /* which is the only reading of "today" that matches what they see in   */
    /* Salesforce. A computed UTC range would disagree with the org for      */
    /* everyone not on UTC, by up to a day at the edges.                    */
    /* ------------------------------------------------------------------ */

    const windowed = load([], []);
    await windowed.$scope.loadActiveUsersToday();
    assert.ok(/FROM LoginHistory/.test(windowed.asked[0]), 'read from login history');
    assert.ok(/LoginTime = TODAY/.test(windowed.asked[0]),
        'bounded to today by the org\'s own date literal, not a computed range');
    assert.ok(/LIMIT \d+/.test(windowed.asked[0]),
        'and bounded in size - a busy org logs in thousands of times a day');

    /* ------------------------------------------------------------------ */
    /* One row per person, however many times they signed in               */
    /* ------------------------------------------------------------------ */

    /*
     * The busiest person is deliberately last alphabetically and their ids
     * arrive second. Sorting by name, or leaving the order the org returned,
     * would both put Ada on top - so this fixture is what makes "busiest
     * first" a claim the test can actually check.
     */
    const busy = load([
        login('005a', '2026-08-14T09:00:00Z'),
        login('005z', '2026-08-14T10:00:00Z'),
        login('005z', '2026-08-14T14:00:00Z')
    ], [user('005a', 'Ada'), user('005z', 'Zoe')]);
    await busy.$scope.loadActiveUsersToday();

    const rows = busy.$scope.activeUsersToday;
    assert.strictEqual(rows.length, 2, 'two people, not three logins');
    assert.strictEqual(rows[0].label, 'Zoe',
        'the busiest person leads the list - not the first alphabetically, and ' +
        'not whoever the org happened to return first');
    assert.strictEqual(rows[1].label, 'Ada', 'the quieter one follows');
    assert.strictEqual(rows[0].logins, 2, 'their logins are counted');
    assert.strictEqual(rows[0].lastLogin, '2026-08-14T14:00:00Z',
        'and the most recent is kept, whatever order the rows arrive in');

    /* ------------------------------------------------------------------ */
    /* A sign-in that failed                                               */
    /*                                                                     */
    /* Someone locked out mid-release is the most useful row this card can  */
    /* carry, and it is invisible in a plain list of names.                 */
    /* ------------------------------------------------------------------ */

    const lockedOut = load([
        login('005c', '2026-08-14T08:00:00Z', 'Invalid Password'),
        login('005c', '2026-08-14T08:05:00Z', 'Invalid Password'),
        login('005c', '2026-08-14T08:10:00Z')
    ], [user('005c', 'Bot')]);
    await lockedOut.$scope.loadActiveUsersToday();

    const person = lockedOut.$scope.activeUsersToday[0];
    assert.strictEqual(person.logins, 3, 'every attempt counts as a login');
    assert.strictEqual(person.failures, 2, 'and the refused ones are counted separately');

    /* ------------------------------------------------------------------ */
    /* Names come from a second query                                      */
    /*                                                                     */
    /* LoginHistory carries UserId and no name, and the User relationship   */
    /* is not traversable on it in every org - so the ids are resolved       */
    /* separately rather than with a query that works in one org and fails   */
    /* in the next.                                                         */
    /* ------------------------------------------------------------------ */

    assert.ok(/FROM User WHERE Id IN/.test(busy.asked[1]), 'names are asked for by id');
    assert.ok(/'005a'/.test(busy.asked[1]) && /'005z'/.test(busy.asked[1]),
        'every id seen today is included');
    assert.ok(!/FROM LoginHistory[\s\S]*User\./.test(busy.asked[0]),
        'and the login query does not traverse the User relationship');

    // Nobody signed in means no second query at all, rather than one with an
    // empty IN list - which is a syntax error, not an empty result.
    assert.strictEqual(windowed.asked.length, 1,
        'an empty org costs one query, not a malformed second');

    /* ------------------------------------------------------------------ */
    /* Degrading, rather than emptying the card                            */
    /* ------------------------------------------------------------------ */

    // Names refused: the counts are still the answer to "how many, how busy".
    const anonymous = load([login('005a', '2026-08-14T09:00:00Z')], [], { refuseNames: true });
    await anonymous.$scope.loadActiveUsersToday();
    assert.strictEqual(anonymous.$scope.activeUsersToday.length, 1,
        'a refused name query does not empty the card');
    assert.strictEqual(anonymous.$scope.activeUsersToday[0].label, '005a',
        'the id stands in for the name');
    assert.strictEqual(anonymous.$scope.activeUsersTodayError, '',
        'and it is not reported as a failure, because the card still answers');

    /*
     * LoginHistory needs "View Setup and Configuration" - the same permission
     * as SetupAuditTrail itself, so this fails exactly when the page does.
     * It has to say so rather than showing an empty list, which reads as an
     * org where nobody worked today.
     */
    const refused = load([], [], { refuseLogins: true });
    await refused.$scope.loadActiveUsersToday();
    assert.deepStrictEqual(Array.from(refused.$scope.activeUsersToday), [],
        'no permission is no rows');
    assert.ok(/login history/i.test(refused.$scope.activeUsersTodayError),
        'and the reason is shown, not an empty list that looks like a quiet day');
    assert.strictEqual(refused.$scope.isLoadingActiveUsersToday, false,
        'the spinner stops on failure - it used to be the only thing left on screen');

    // A genuinely quiet day is not an error.
    assert.strictEqual(windowed.$scope.activeUsersTodayError, '',
        'nobody signing in today is an empty list, not a failure');
    assert.strictEqual(windowed.$scope.isLoadingActiveUsersToday, false,
        'and the spinner stops');

    /* ------------------------------------------------------------------ */
    /* The card belongs to the audit trail page only                       */
    /* ------------------------------------------------------------------ */

    const page = load([], []);
    const isAuditTrailPage = new Function('$scope',
        lift('$scope.isAuditTrailPage = function(){') + ';\nreturn $scope.isAuditTrailPage;')(page.$scope);

    page.$scope.selectedMetadata = { value: 'AuditTrail' };
    assert.strictEqual(isAuditTrailPage(), true, 'shown on the audit trail');
    page.$scope.selectedMetadata = { value: 'ApexClass' };
    assert.strictEqual(isAuditTrailPage(), false, 'and nowhere else');
    page.$scope.selectedMetadata = null;
    assert.strictEqual(isAuditTrailPage(), false, 'including before anything is chosen');

    console.log('active users today regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
