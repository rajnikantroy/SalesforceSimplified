/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The watch list gets the summary the manifest gets.
 *
 * It had a row of chips: type and count, and nothing to compare them against.
 * "Watching 42" answers how many; the question at this point is the one the
 * package.xml page already answers - which types, how many of each, and how
 * lopsided. Forty-one Profiles and one Apex class is a different watch list
 * from a dozen of each, and the numbers alone do not say so.
 *
 * Same block, same classes, different list. So this checks that it really is
 * the same block - a parallel set of styles for one appearance drifts - and
 * that the numbers behind it are computed over the watch list rather than
 * copied from the manifest's.
 */

const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
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

function fn(signature, scope) {
    return new Function('$scope', lift(signature) + ';return ' +
        signature.slice(0, signature.indexOf(' =')) + ';')(scope);
}

function main() {

    const watchPage = (() => {
        const start = view.indexOf('this.watchinglist =');
        assert.notStrictEqual(start, -1, 'the watching list page must exist');
        return view.slice(start, view.indexOf('\nthis.', start + 10));
    })();
    const pkgPage = (() => {
        const start = view.indexOf('this.packagexmleditor =');
        return view.slice(start, view.indexOf('\nthis.', start + 10));
    })();

    /* ------------------------------------------------------------------ */
    /* The proportion bar                                                  */
    /* ------------------------------------------------------------------ */

    const share = fn('$scope.watchTypeShare = function(entry){',
        { watchedTypes: [{ count: 40 }, { count: 20 }, { count: 1 }] });

    assert.strictEqual(share({ count: 40 }), 100, 'the largest type fills the bar');
    assert.strictEqual(share({ count: 20 }), 50, 'and the rest are relative to it');

    /*
     * The floor. One out of four hundred rounds to zero percent, and a bar of
     * zero width is indistinguishable from a type that is not there.
     */
    const lopsided = fn('$scope.watchTypeShare = function(entry){',
        { watchedTypes: [{ count: 400 }, { count: 1 }] });
    assert.strictEqual(lopsided({ count: 1 }), 4,
        'a count of one is still a visible mark beside a type with four hundred');

    /* Nothing to divide by is not a crash. */
    assert.strictEqual(fn('$scope.watchTypeShare = function(entry){', {})({ count: 3 }), 0);
    assert.strictEqual(share(null), 0, 'and neither is no entry');
    assert.strictEqual(share({ count: 0 }), 0);

    /* It reads the watch list, not the manifest's frequency table. */
    const crossed = fn('$scope.watchTypeShare = function(entry){',
        { watchedTypes: [{ count: 4 }], packageMetaDataFrequency: [{ Frequency: 400 }] });
    assert.strictEqual(crossed({ count: 4 }), 100,
        'scaled against the watch list - a manifest of 400 must not flatten it');

    /* ------------------------------------------------------------------ */
    /* The "gone" tile                                                     */
    /* ------------------------------------------------------------------ */

    const gone = fn('$scope.watchGoneCount = function(){', {
        bookmarks: [{ missingSince: 1 }, {}, { missingSince: 0 }, { missingSince: 99 }]
    });
    assert.strictEqual(gone(), 2, 'only the ones the org no longer has');
    assert.strictEqual(fn('$scope.watchGoneCount = function(){', {})(), 0, 'and none is none');

    /* ------------------------------------------------------------------ */
    /* It is the package summary's own block                               */
    /* ------------------------------------------------------------------ */

    for (const part of ['ss-pkg-stats', 'ss-pkg-tiles', 'ss-pkg-tile-n', 'ss-pkg-tile-l',
                        'ss-pkg-breakdown', 'ss-pkg-breakdown-head', 'ss-pkg-breakdown-table',
                        'ss-pkg-type', 'ss-pkg-bar-fill', 'ss-pkg-count', 'ss-pkg-type-remove']) {
        assert.ok(watchPage.includes(part), 'the watch summary uses ' + part);
        assert.ok(pkgPage.includes(part), 'which is the manifest summary\'s own ' + part);
        assert.ok(new RegExp('\\.' + part + '[\\s,{:]').test(css),
            part + ' must have a rule, or the block renders unstyled');
    }

    /*
     * And those rules must not be scoped to the package page, or the watch page
     * gets the markup and none of the appearance.
     */
    const scoped = [...css.matchAll(/^([^\n{]*\.ss-pkg-(?:stats|tiles|breakdown)\b[^\n{]*)\{/gm)]
        .map((m) => m[1].trim());
    assert.ok(scoped.length, 'the summary rules must exist');
    scoped.forEach((selector) => {
        assert.ok(!/searchCodeFieldset|packagexml/.test(selector),
            'a rule tied to the package page cannot style the watch page: ' + selector);
    });

    /* ------------------------------------------------------------------ */
    /* Over the watch list, not the manifest                               */
    /* ------------------------------------------------------------------ */

    assert.ok(/ss-pkg-tile-n">\{\{bookmarks\.length\}\}/.test(watchPage.replace(/'\+\n'\s*/g, '')),
        'the first tile counts watched components');
    assert.ok(/watchedTypes\.length/.test(watchPage), 'the second counts their types');
    assert.ok(!/selectedMetaForPackageXml|packageMetaDataFrequency/.test(watchPage),
        'and nothing on this page reads the manifest');

    const rows = /<tr ng-repeat="group in ([^"]*)"/.exec(watchPage);
    assert.ok(rows, 'the breakdown must repeat over something');
    assert.ok(/^watchedTypes track by group\.type$/.test(rows[1]),
        'the watch list\'s own groups, keyed by type: ' + rows[1]);

    /* Removing a type is still one click, as it was on the chip. */
    assert.ok(/ng-click="removeWatchedType\(group\.type\)"/.test(watchPage),
        'a whole type can still be dropped in one click');
    assert.ok(/aria-label="Stop watching all \{\{group\.label\}\}"/.test(watchPage),
        'and the control says what it does without a hover');

    /* The chips are gone, and so are their styles. */
    assert.ok(!/ss-watch-type-chip|ss-watch-type-x|ss-watch-types/.test(view + css),
        'the chips they replaced must not survive as dead markup or dead rules');

    /*
     * Warning tiles appear only when there is something to warn about.
     *
     * Matched on the tile itself, not on the gate anywhere in the page: the
     * "N new" badge further down carries ng-show="bookmarkUnseen" too, so a
     * looser test passes while the tile is ungated.
     */
    const flat = watchPage.replace(/'\+\n'\s*/g, '').replace(/\\'/g, "'");
    /*
     * The lookahead matters: ss-pkg-tile[^"]* also matches the ss-pkg-tiles
     * container that wraps them, which parsed as a tile, shifted every gate by
     * one, and left the first real tile unchecked.
     */
    const tiles = [...flat.matchAll(/<div class="ss-pkg-tile(?![-a-z])[^"]*"([^>]*)>([\s\S]*?)<\/div>/g)]
        .map((m) => ({
            gate: (/ng-show="([^"]*)"/.exec(m[1]) || [])[1] || null,
            label: (/ss-pkg-tile-l">([^<]*)/.exec(m[2]) || [])[1] || ''
        }));
    assert.ok(tiles.length >= 4, 'four tiles, found ' + tiles.length);

    for (const [label, gate] of [['changed', 'bookmarkUnseen'], ['gone', 'watchGoneCount()']]) {
        const tile = tiles.find((t) => t.label.trim() === label);
        assert.ok(tile, 'no "' + label + '" tile');
        assert.strictEqual(tile.gate, gate,
            'the ' + label + ' tile must be gated on ' + gate + ' - a zero there reads ' +
            'as reassurance nobody asked for; got ' + tile.gate);
    }

    /* The two facts are unconditional: they are counts, not warnings. */
    for (const label of ['component', 'type']) {
        const tile = tiles.find((t) => t.label.trim().startsWith(label));
        assert.ok(tile, 'no "' + label + '" tile');
        assert.strictEqual(tile.gate, null, label + ' is a fact and is always shown');
    }

    console.log('watch summary test passed');
}

main();
