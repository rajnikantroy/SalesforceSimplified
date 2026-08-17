/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * The error catalogue, and the two ways it rots.
 *
 * A code shown to somebody that the reference page does not explain is worse
 * than no code: it looks like a lookup key and answers nothing. A code in the
 * catalogue that nothing ever reports is a page of documentation for
 * something that does not happen, which is how a reference stops being
 * trusted.
 *
 * So both directions are checked against the source, and the page is checked
 * to be a view of the catalogue rather than a second copy of it.
 */

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { SS_ERRORS, ssErrorInfo, ssErrorPageUrl } = require(
    path.join(ROOT, 'js/ss-errors.js'));

const codes = Object.keys(SS_ERRORS);

/* ------------------------------------------------------------------ */
/* Every entry is usable                                               */
/* ------------------------------------------------------------------ */

assert.ok(codes.length >= 10, 'the catalogue has only ' + codes.length + ' entries');

codes.forEach((code) => {
    const entry = SS_ERRORS[code];

    assert.ok(/^SS-\d{3}$/.test(code), code + ' is not of the form SS-nnn');

    ['title', 'when', 'why'].forEach((field) => {
        assert.ok(typeof entry[field] === 'string' && entry[field].trim().length > 12,
            code + ' has no usable ' + field);
    });

    /*
     * The whole point of the page. An entry that explains a cause and offers
     * nothing to do about it has wasted the reader's time twice: once
     * looking it up, once reading it.
     */
    assert.ok(Array.isArray(entry.steps) && entry.steps.length >= 1,
        code + ' documents a cause with no steps to resolve it');
    entry.steps.forEach((step, i) => {
        assert.ok(typeof step === 'string' && step.trim().length > 12,
            code + ' step ' + (i + 1) + ' says nothing');
    });

    /*
     * "Why" has to carry a mechanism, not reassurance. A cause written as
     * "something went wrong, please try again" is the thing this page exists
     * to replace.
     */
    assert.ok(entry.why.length > 60,
        code + ' explains its cause in ' + entry.why.length + ' characters, which is ' +
        'a reassurance rather than a mechanism');

    /* Titles are read in a list; two the same cannot be told apart. */
    assert.strictEqual(
        codes.filter((other) => SS_ERRORS[other].title === entry.title).length, 1,
        'two entries share the title "' + entry.title + '"');
});

/* ------------------------------------------------------------------ */
/* Every code the extension reports is documented                      */
/* ------------------------------------------------------------------ */

/*
 * Read out of the source rather than listed here, so a code added to a
 * message without an entry fails immediately instead of reaching somebody as
 * a lookup key for a page that does not have it.
 */
const SOURCES = ['js/angular/services/PipelineService.js',
                 'js/angular/controllers/MenuAndDetailsCtrl.js',
                 'js/angular/services/ViewService.js',
                 'js/background.js',
                 'js/sync-engine.js'];

const used = new Set();
SOURCES.forEach((file) => {
    (read(file).match(/'SS-\d{3}'/g) || []).forEach((quoted) => {
        used.add(quoted.replace(/'/g, ''));
    });
});

assert.ok(used.size > 0, 'nothing in the extension reports a code at all');

used.forEach((code) => {
    assert.ok(SS_ERRORS[code],
        code + ' is reported to the user but has no entry in the catalogue, so the ' +
        'reference page answers nothing when they look it up');
});

/* ------------------------------------------------------------------ */
/* The page is a view, not a second copy                               */
/* ------------------------------------------------------------------ */

const page = read('error.html');
const renderer = read('js/error-page.js');

/*
 * Written out in the HTML, the two drift and the copy people find is always
 * the stale one - which is exactly what happened to the "what this does not
 * do" note on the sync page.
 */
codes.forEach((code) => {
    assert.ok(page.indexOf(code) === -1,
        code + ' is written into error.html, so it is a second copy of the ' +
        'catalogue rather than a view of it');
});
assert.ok(/<script src="js\/ss-errors\.js"><\/script>/.test(page),
    'error.html does not load the catalogue');
assert.ok(/SS_ERRORS/.test(renderer), 'the page renderer does not read the catalogue');

/*
 * Every group prefix the page offers has entries, and every entry falls in a
 * group - an entry in no group is rendered nowhere at all.
 */
const prefixes = (renderer.match(/prefix: '(SS-\d)'/g) || [])
    .map((m) => m.replace(/prefix: '|'/g, ''));
assert.ok(prefixes.length >= 3, 'the page groups only ' + prefixes.length + ' families');

prefixes.forEach((prefix) => {
    assert.ok(codes.some((code) => code.indexOf(prefix) === 0),
        'the page offers a ' + prefix + 'xx group that no entry belongs to');
});
codes.forEach((code) => {
    assert.ok(prefixes.some((prefix) => code.indexOf(prefix) === 0),
        code + ' falls outside every group the page renders, so it appears nowhere');
});

/* No inline script: extension pages run under a CSP that forbids it, and the
 * page would silently render nothing at all. */
assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(page),
    'error.html has an inline script, which Manifest V3 refuses to run');

/* ------------------------------------------------------------------ */
/* It is reachable                                                     */
/* ------------------------------------------------------------------ */

const manifest = JSON.parse(read('manifest.json'));

assert.ok(manifest.web_accessible_resources[0].resources.includes('error.html'),
    'error.html is not web-accessible, so a link to it from the panel is blocked');

const scripts = manifest.content_scripts[0].js;
assert.ok(scripts.includes('/js/ss-errors.js'),
    'the catalogue is not loaded in the panel, so ssErrorInfo is undefined there');
assert.ok(scripts.indexOf('/js/ss-errors.js') <
          scripts.indexOf('/js/angular/controllers/MenuAndDetailsCtrl.js'),
    'the catalogue loads after the controller that reads it');

/* And the panel actually shows the code, as a link rather than as text. */
const view = read('js/angular/services/ViewService.js');
assert.ok(/ng-if="sync\.errorCode"/.test(view),
    'the panel never shows the code, so it cannot be looked up or quoted');
assert.ok(/ng-href="\{\{syncErrorHelpUrl\(\)\}\}"/.test(view),
    'the code is shown but does not link to the page that explains it');

/* ------------------------------------------------------------------ */
/* The lookups                                                         */
/* ------------------------------------------------------------------ */

assert.strictEqual(ssErrorInfo('SS-101').title, SS_ERRORS['SS-101'].title);
assert.strictEqual(ssErrorInfo('SS-999'), null,
    'an unknown code returns something, which the panel would render as [object Object]');
assert.strictEqual(ssErrorInfo(null), null);
assert.strictEqual(ssErrorInfo(''), null);

assert.ok(/error\.html#SS-101$/.test(ssErrorPageUrl('SS-101')),
    'the help link does not point at the entry: ' + ssErrorPageUrl('SS-101'));
assert.ok(!/#/.test(ssErrorPageUrl(null)),
    'a link with no code should open the page, not a dangling anchor');

/* ------------------------------------------------------------------ */
/* The claim that went stale                                           */
/* ------------------------------------------------------------------ */

/*
 * Not about errors, but the same failure and found in the same pass: the
 * sync page carried "Record data is not synced" for as long as records could
 * be synced. Kept here because this file is where the rule lives - a page
 * that describes the product has to be checked against the product.
 */
/* Comments stripped first: the rewrite quotes the old sentence to say what
 * it replaced, and that is documentation, not something anybody renders. */
const rendered = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.ok(!/Record data is not synced/.test(rendered),
    'the sync page still says record data is not synced, which the Send records ' +
    'button two cards above it disproves');

/* And the replacement says something true and specific in its place, rather
 * than the section having simply been deleted. */
assert.ok(/rollback on error/.test(rendered) && /all or none/.test(rendered),
    'the "what this does not do" note lost the limits that are still real');

/*
 * A failed job keeps the code the throw carried, or the row reports a
 * sentence and links to nothing - the code exists only for as long as the
 * exception does.
 */
const engine = read('js/sync-engine.js');
assert.ok(/error: \{ message: said, code: \(error && error\.ssCode\) \|\| null \}/.test(engine),
    'a failed job does not store the code its failure carried');
assert.ok(/function ssSyncCoded\(code, message\)/.test(engine),
    'nothing in the engine can attach a code to a throw');

/* And the job row shows it, with the same link the banner uses. */
assert.ok(/ng-if="syncJobErrorCode\(job\)"/.test(view),
    'a failed job row never shows its code');
assert.ok(/ng-href="\{\{syncJobHelpUrl\(job\)\}\}"/.test(view),
    'the job row shows a code that links nowhere');

/* ------------------------------------------------------------------ */
/* The page can be found when nothing is wrong                         */
/* ------------------------------------------------------------------ */

/*
 * The links beside a message exist only while that message is on screen, so
 * on their own they make the reference unfindable at exactly the times
 * somebody wants to read it: before anything has gone wrong, and after they
 * have closed the error. It has to be reachable from a page you can just
 * open.
 */
assert.ok(/ng-href="\{\{errorReferenceUrl\(\)\}\}"/.test(view),
    'nothing links to the error reference except the code beside a live error, ' +
    'so the page cannot be found when there is no error');
assert.ok(/>Error reference<\/a>/.test(view),
    'the link to the reference is not named, so it reads as an unlabelled url');

const controller = read('js/angular/controllers/MenuAndDetailsCtrl.js');
assert.ok(/\$scope\.errorReferenceUrl = function/.test(controller),
    'errorReferenceUrl is not on the scope, so the About link renders with no href');

/*
 * On the About page, and above Report an issue: most of what gets reported
 * has an entry here with the fix already in it.
 */
/* Comments stripped: the block carries a comment explaining why the
 * reference comes first, and that comment names "Report an issue" above the
 * link it is about - which is enough to fail an ordering check that reads
 * the raw source. */
const helpSource = view.replace(/\/\*[\s\S]*?\*\//g, '');
const help = helpSource.slice(helpSource.indexOf('<h4>Help and feedback</h4>'),
                              helpSource.indexOf('<h4>More from this team</h4>'));
assert.ok(help.indexOf('Error reference') > -1,
    'the reference is not on the About page, which is where somebody with a ' +
    'problem looks first');

/*
 * And unconditionally. A row that is present but gated renders nowhere, and
 * the link existing in the source says nothing about it being on screen -
 * which is the whole complaint this section answers.
 */
const helpRow = help.slice(help.lastIndexOf('<tr', help.indexOf('Error reference')),
                           help.indexOf('Error reference'));
assert.ok(!/ng-(if|show|hide)=/.test(helpRow),
    'the reference row is conditional, so it can be absent exactly when it is ' +
    'wanted: ' + helpRow.slice(0, 120));
assert.ok(help.indexOf('Error reference') < help.indexOf('Report an issue'),
    'Report an issue comes before the reference that would have answered it');

/* And from the welcome page, which is what a new install opens. */
const welcome = read('welcome.html');
/*
 * Both places, counted. One link satisfying a search for the other is the
 * trap this suite keeps falling into: the quick-nav pill covered for the
 * explanation in the body, which is the half that says what a code is for.
 */
assert.ok(/<a href="error\.html" class="pill-link">/.test(welcome),
    'the welcome page has no quick-nav pill for the error reference');
assert.ok(/<a href="error\.html">error reference<\/a>/.test(welcome),
    'the welcome page mentions codes but does not link to what explains them');
assert.ok(/SS-101/.test(welcome),
    'the welcome page does not show what a code looks like, so nobody knows ' +
    'the thing beside a message is meant to be looked up');

console.log('error_catalogue: ok (' + codes.length + ' entries, ' + used.size +
            ' reported in code)');
