/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The watch list is full, and it says so where the click was.
 *
 * A refusal was written to bookmarkNotice, which is rendered on the watching
 * list page. The star is not on that page - it is on a record list - so the
 * click appeared to do nothing at all and the reason sat behind a navigation
 * nobody had a reason to make.
 */

const service = fs.readFileSync('./js/angular/services/BookmarkService.js', 'utf8');
const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');

function lift(source, signature) {
    const start = source.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') { depth++; }
        else if (source[i] === '}') { depth--; if (depth === 0) { return source.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

function main() {

    /* ------------------------------------------------------------------ */
    /* The refusal, from the service                                       */
    /* ------------------------------------------------------------------ */

    const cap = /var MAX_BOOKMARKS = (\d+);/.exec(service);
    assert.ok(cap, 'the cap must still be a named number');
    const max = Number(cap[1]);

    const add = lift(service, 'this.add = function(record, meta) {');
    const full = new Function('MAX_BOOKMARKS', 'items',
        'var self = { list: function(){ return items; }, isBookmarked: function(){ return false; } };' +
        'var writeList = function(){ return true; };' +
        'return (' + add.replace('this.add = ', '') + ').call(self, { Id: "1" }, { value: "ApexClass" });'
    )(max, new Array(max).fill({}));

    assert.strictEqual(full.ok, false, 'a full list refuses');
    assert.strictEqual(full.full, true,
        'and says which refusal it is - the caller offers a different way out for ' +
        'this one than for a row with no id');

    /*
     * Said as a state, not a rule. "Up to 100 bookmarks" reads as a limit
     * somewhere ahead; what has happened is that it is full now and this click
     * did nothing.
     */
    assert.ok(/already holds/.test(full.reason),
        'the message is about now, not about a policy: ' + full.reason);
    assert.ok(full.reason.indexOf(String(max)) !== -1,
        'with the count in it - the next question is always how many that is');
    assert.ok(/Stop watching something/.test(full.reason),
        'and what to do about it');

    /* A list with room does not refuse. */
    const room = new Function('MAX_BOOKMARKS', 'items',
        'var self = { list: function(){ return items; }, isBookmarked: function(){ return false; } };' +
        'var writeList = function(){ return true; };' +
        'return (' + add.replace('this.add = ', '') + ').call(self, { Id: "1" }, { value: "ApexClass" });'
    )(max, new Array(max - 1).fill({}));
    assert.strictEqual(room.ok, true, 'one below the cap still fits');

    /* ------------------------------------------------------------------ */
    /* And it is shown where the star is                                   */
    /* ------------------------------------------------------------------ */

    const toggle = lift(controller, '$scope.toggleBookmark = function(record){');
    assert.ok(/showToast\(/.test(toggle),
        'a refused star must say so on the page it was clicked on');
    assert.ok(/result\.reason/.test(toggle), 'carrying the service\'s own words');
    assert.ok(/variant: 'warning'/.test(toggle),
        'as a warning - nothing was added, and an info toast reads as though ' +
        'something was');
    assert.ok(/result\.full \? \$scope\.openWatchingList : null/.test(toggle),
        'and a full list offers the page where the fix is, while other refusals ' +
        'have nowhere useful to point');

    /* Watch-all refuses in bulk, and says so the same way. */
    const watchAll = lift(controller, '$scope.watchAllVisible = function(context){');
    assert.ok(/showToast\(/.test(watchAll),
        'a partial Watch all must also say so where it was clicked');
    assert.ok(/None were added/.test(watchAll),
        'and distinguish nothing fitting from some of it fitting - "watching 0 more" ' +
        'reads as success');
    assert.ok(/is now full/.test(watchAll), 'saying why the rest did not go in');

    /* The page keeps its own copy, for anyone who is already on it. */
    /*
     * The assignment that carries the reason, not any assignment. Both
     * functions clear bookmarkNotice on the way in, so testing that the name
     * appears passes with the message itself removed.
     */
    assert.ok(/\$scope\.bookmarkNotice = result\.reason;/.test(toggle),
        'the watching list keeps its own copy of the reason - the toast has gone ' +
        'by the time someone navigates there');
    assert.ok(/\$scope\.bookmarkNotice = summary;/.test(watchAll),
        'and so does the bulk case');
    assert.ok(/ng-show="bookmarkNotice"/.test(view),
        'and that page still renders it');

    /* The variant has to exist, or the toast renders without a ground. */
    const css = fs.readFileSync('./css/styles.css', 'utf8');
    assert.ok(/\.ss-toast-warning\s*\{/.test(css),
        'the warning variant needs a rule - an invented variant renders transparent');

    console.log('watch list full test passed');
}

main();
