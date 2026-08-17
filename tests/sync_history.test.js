/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * The history, split by attempt.
 *
 * PipelineService is an Angular service and cannot be required, so the one
 * function worth proving is lifted out and run. Checking it as text - "the
 * file mentions grouping" - passed while every line was its own group and
 * while staging was labelled "Attempt 0", which are the two ways this can be
 * wrong and both look fine in a grep.
 */

const ROOT = path.join(__dirname, '..');
const service = fs.readFileSync(
    path.join(ROOT, 'js/angular/services/PipelineService.js'), 'utf8');

function lift(name) {
    const at = service.indexOf('this.' + name + ' = function');
    assert.ok(at > -1, name + ' not found - it has been renamed or removed');

    let depth = 0;
    let started = false;
    for (let i = at; i < service.length; i += 1) {
        if (service[i] === '{') { depth += 1; started = true; }
        else if (service[i] === '}') {
            depth -= 1;
            if (started && depth === 0) {
                return service.slice(at, i + 1).replace('this.' + name + ' =', 'var ' + name + ' =');
            }
        }
    }
    throw new Error('Could not find the end of ' + name);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(lift('historyGroups') + ';', sandbox);
const historyGroups = sandbox.historyGroups;

/* ------------------------------------------------------------------ */
/* A job run three times                                               */
/* ------------------------------------------------------------------ */

const groups = historyGroups({ history: [
    { note: 'Staged for review.', attempt: 0 },
    { note: 'Reading records.', attempt: 1 },
    { note: 'It broke.', attempt: 1 },
    { note: 'Reading records.', attempt: 2 },
    { note: 'It broke again.', attempt: 2 },
    { note: 'Reading records.', attempt: 3 }
] });

assert.strictEqual(groups.length, 4, 'staging plus three attempts');
/* Array.from, because the arrays come out of the vm realm and
 * deepStrictEqual compares prototypes - identical contents, different
 * Array.prototype, and a diff that looks like it matches. */
assert.deepStrictEqual(Array.from(groups.map(function (group) { return group.label; })),
    ['Staged', 'Attempt 1', 'Attempt 2', 'Attempt 3'],
    'each run is named, and staging is not called an attempt - it is not an ' +
    'attempt at anything');

/*
 * The lines stay with their run. One group per line would be technically
 * grouped and no more readable than the flat list it replaced.
 */
assert.deepStrictEqual(Array.from(groups[1].entries.map(function (entry) { return entry.note; })),
    ['Reading records.', 'It broke.'],
    'both lines of a run belong to that run');
assert.strictEqual(groups[3].entries.length, 1, 'a run still going has the lines it has');

/* Every line is somewhere, and nowhere twice. */
const regrouped = groups.reduce(function (all, group) {
    return all.concat(group.entries.map(function (entry) { return entry.note; }));
}, []);
assert.strictEqual(regrouped.length, 6, 'no line is dropped and none duplicated');

/* ------------------------------------------------------------------ */
/* Records written before attempts were stamped                        */
/* ------------------------------------------------------------------ */

/*
 * There is no way to reconstruct which run those lines belonged to, so they
 * come back as one unlabelled group and render exactly as the flat list did.
 * Numbering them would be a guess presented as history.
 */
const old = historyGroups({ history: [
    { note: 'Staged for review.' },
    { note: 'Reading records.' },
    { note: 'It broke.' }
] });
assert.strictEqual(old.length, 1, 'unstamped history is one group');
assert.strictEqual(old[0].label, null, 'with no label, because none is known');
assert.strictEqual(old[0].entries.length, 3, 'and every line still shown');

/* A job with no history at all is no groups, not one empty one. */
assert.strictEqual(Array.from(historyGroups({ history: [] })).length, 0);
assert.strictEqual(Array.from(historyGroups({})).length, 0);
assert.strictEqual(Array.from(historyGroups(null)).length, 0);

/*
 * A half-stamped record - written across an upgrade - is grouped on what it
 * does have rather than thrown away. The unstamped lines fall into attempt
 * zero, which is where the staging line lives, and that is the closest thing
 * to true that can be said about them.
 */
const mixed = historyGroups({ history: [
    { note: 'Staged for review.' },
    { note: 'Reading records.', attempt: 1 }
] });
assert.strictEqual(mixed.length, 2, 'a half-stamped record still splits on what it knows');
assert.strictEqual(mixed[0].label, 'Staged');
assert.strictEqual(mixed[1].label, 'Attempt 1');

console.log('sync_history: ok');

/* ------------------------------------------------------------------ */
/* One page of a list                                                  */
/* ------------------------------------------------------------------ */

vm.runInContext(lift('paginate') + ';', sandbox);
const paginate = sandbox.paginate;

const many = [];
for (let i = 1; i <= 47; i += 1) { many.push('job ' + i); }

const first = paginate(many, 0, 10);
assert.strictEqual(first.items.length, 10, 'a page is ten rows');
assert.strictEqual(first.items[0], 'job 1');
assert.strictEqual(first.pages, 5, '47 rows is five pages');
assert.strictEqual(first.total, 47, 'and the total is the whole list, not the page');

/* One-based, because these numbers are read: "1-10 of 47". */
assert.strictEqual(first.from, 1);
assert.strictEqual(first.to, 10);
assert.strictEqual(first.hasPrevious, false, 'the first page has nothing before it');
assert.strictEqual(first.hasNext, true);

const last = paginate(many, 4, 10);
assert.strictEqual(last.items.length, 7, 'the last page is the remainder');
assert.strictEqual(last.items[6], 'job 47', 'and reaches the end of the list');
assert.strictEqual(last.from, 41);
assert.strictEqual(last.to, 47, 'the range never claims rows that are not there');
assert.strictEqual(last.hasNext, false, 'and nothing follows it');

/*
 * The page is clamped, not trusted.
 *
 * Discarding the last job on page five leaves the caller asking for a page
 * that no longer exists - and an empty list with a Previous button is worse
 * than no pager at all.
 */
const past = paginate(many, 99, 10);
assert.strictEqual(past.page, 4, 'a page beyond the end lands on the last one');
assert.strictEqual(past.items.length, 7, 'showing rows rather than nothing');

const before = paginate(many, -3, 10);
assert.strictEqual(before.page, 0, 'and one before the start lands on the first');

/* A list that fits on one page says so, so the pager can hide itself. */
const short = paginate(['only one'], 0, 10);
assert.strictEqual(short.pages, 1);
assert.strictEqual(short.hasPrevious, false);
assert.strictEqual(short.hasNext, false);

/* An empty list is one empty page, not zero pages - "0 of 0" beats a
 * division by zero. */
const none = paginate([], 0, 10);
assert.strictEqual(none.pages, 1);
assert.strictEqual(none.total, 0);
assert.strictEqual(none.from, 0, 'and does not claim to start at row one');
assert.strictEqual(none.to, 0);
assert.strictEqual(Array.from(none.items).length, 0);
