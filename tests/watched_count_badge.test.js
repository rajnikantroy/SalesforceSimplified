/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * How many of the rows in front of you are watched.
 *
 * "Unwatch all" over a list of 42 says nothing about whether that clears 42 or
 * 1, and the star column is only readable a screenful at a time.
 *
 * The count is read from a binding, so it runs on every digest, and
 * isBookmarked resolves each row's real type - a schema lookup per row. It is
 * therefore memoised, and the memo is what this mostly checks: a stale count
 * beside a live "Unwatch all" is worse than no count.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const css = fs.readFileSync('./css/styles.css', 'utf8');

function lift(signature) {
    const start = controller.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0;
    for (let i = controller.indexOf('{', start); i < controller.length; i++) {
        if (controller[i] === '{') { depth++; }
        else if (controller[i] === '}') { depth--; if (depth === 0) { return controller.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

function main() {

    /*
     * bookmarkRevision is read, never written, by the code under test, so it is
     * wired as a getter. Reading the live value is the point: a copy taken at
     * construction would make the memo look correct forever.
     */
    const rows = [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }, { /* no Id */ }];
    const state = { revision: 0, list: rows, watched: new Set(['a', 'b']), resolves: 0 };
    const $scope = {
        canBookmark: (r) => !!(r && r.Id),
        isBookmarked: (r) => { state.resolves++; return state.watched.has(r.Id); }
    };
    const scope = new Function('$scope', 'packageListFor', 'bookmarkRevisionRef',
        'var watchedCountCache = {};\n' +
        lift('$scope.watchedCount = function(context){')
            .replace(/bookmarkRevision\b/g, 'bookmarkRevisionRef()') + ';\n' +
        lift('$scope.anyWatched = function(context){') + ';\n' +
        'return $scope;')($scope, () => state.list, () => state.revision);

    assert.strictEqual(scope.watchedCount('my'), 2, 'two of the four rows are watched');
    assert.strictEqual(scope.anyWatched('my'), true);

    /* Rows without an Id cannot be watched and must not be counted. */
    state.watched.add(undefined);
    state.revision++;
    assert.strictEqual(scope.watchedCount('my'), 2, 'a row with no Id is not a watched row');

    /* ------------------------------------------------------------------ */
    /* The memo                                                            */
    /* ------------------------------------------------------------------ */

    state.revision++;
    scope.watchedCount('my');
    const after = state.resolves;
    for (let i = 0; i < 20; i++) { scope.watchedCount('my'); scope.anyWatched('my'); }
    assert.strictEqual(state.resolves, after,
        'repeated digests must not re-resolve every row - that is a schema lookup each');

    /* Starring something changes the answer, and the revision is what says so. */
    state.watched.add('c');
    assert.strictEqual(scope.watchedCount('my'), 2,
        'without a revision bump the cached answer stands - which is why every ' +
        'change to the watch list has to go through refreshBookmarkState');
    state.revision++;
    assert.strictEqual(scope.watchedCount('my'), 3, 'and once it does, the count moves');

    /* A new fetch replaces the array wholesale; the count must follow it. */
    state.list = [{ Id: 'a' }];
    assert.strictEqual(scope.watchedCount('my'), 1,
        'a new list is a new answer even at the same revision');

    /* And the revision really is bumped where the watch list changes. */
    const refresh = lift('function refreshBookmarkState(){');
    assert.ok(/bookmarkRevision\+\+/.test(refresh),
        'refreshBookmarkState must bump the revision, or every count goes stale ' +
        'the first time something is starred');

    /*
     * Declared with the rest of the watch state, above anything that reads it.
     * A var declared further down hoists as undefined, and a cache key of
     * undefined === undefined never invalidates - it has taken this controller
     * down before.
     */
    assert.ok(controller.indexOf('var bookmarkRevision = 0;') <
              controller.indexOf('$scope.watchedCount = function'),
        'the revision is declared before it is read');

    /* ------------------------------------------------------------------ */
    /* On screen, in its own colour, on both lists                         */
    /* ------------------------------------------------------------------ */

    for (const context of ['my', 'all']) {
        const badge = new RegExp(
            '<span class="ss-watch-count" ng-show="watchedCount\\(\\\\\'' + context + '\\\\\'\\)"');
        assert.ok(badge.test(view), context + ' list must show the count');
    }
    assert.strictEqual((view.match(/ss-watch-count/g) || []).length, 2,
        'one per list, and no more');

    /* Hidden at zero: a "0" beside "Watch all" is noise, not information. */
    const shown = /<span class="ss-watch-count" ng-show="watchedCount\(\\'my\\'\)"/.test(view);
    assert.ok(shown, 'shown only when something is watched');

    const rule = /\.theme-lightning \.ss-watch-count \{([^}]*)\}/.exec(css);
    assert.ok(rule, 'it needs a rule of its own or it renders as plain text');
    const colour = /(?:^|;)\s*color:\s*(#[0-9a-f]{6})/i.exec(rule[1]);
    assert.ok(colour, 'with a colour: ' + rule[1].trim());

    /*
     * A different colour from the text beside it, and not the panel's blue -
     * blue reads as a third action next to two that already are.
     */
    assert.ok(!/0176d3|--ss-blue/.test(rule[1]),
        'the count is not blue - it is not something to click: ' + rule[1].trim());
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour[1].substr(i, 2), 16));
    assert.ok(r > b, 'a warm colour, belonging to the star column it counts: ' + colour[1]);
    assert.ok(/tabular-nums/.test(rule[1]),
        'tabular figures, or the badge jumps width between 9 and 10 while a ' +
        'Watch all runs down the list');

    console.log('watched count badge test passed');
}

main();
