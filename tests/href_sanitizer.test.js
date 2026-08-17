/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/*
 * Links to the extension's own pages.
 *
 * AngularJS rewrites an href whose scheme is not on its whitelist to
 * "unsafe:" + the url, and the browser then refuses to open it. The default
 * list is https, ftp, mailto, tel and file - so every link to one of this
 * extension's own pages rendered as
 *
 *     unsafe:chrome-extension://<id>/error.html
 *
 * and did nothing when clicked, with the word "unsafe" in the address as the
 * only explanation on offer. The images had already hit this and been fixed;
 * links had not, because until the error reference there were none.
 *
 * The other half matters more than the fix. Widening a sanitiser is exactly
 * the kind of change that quietly admits javascript: alongside what it meant
 * to admit, so what the list still refuses is asserted here as carefully as
 * what it now allows.
 */

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const index = read('index.js');
const angular = read('js/angular/angular.min.js');

/* ------------------------------------------------------------------ */
/* The fix is still necessary                                          */
/* ------------------------------------------------------------------ */

/*
 * Read out of the shipped Angular rather than assumed. If a future version
 * allows the scheme by itself, this fails and says so - a workaround kept
 * after the thing it worked around is gone is how a file fills with rules
 * nobody dares remove.
 */
const shipped = angular.match(/\/\^\\s\*\(https\?\|ftp\|mailto\|tel\|file\)\:\//);
assert.ok(shipped,
    'the shipped Angular no longer carries the href whitelist this works around - ' +
    'check whether the config in index.js is still needed');

const shippedRule = new RegExp(shipped[0].slice(1, -1));
assert.strictEqual(shippedRule.test('chrome-extension://abc/error.html'), false,
    'Angular now allows chrome-extension: by default, so the config in index.js ' +
    'is dead weight and should be removed');
assert.strictEqual(shippedRule.test('https://example.com'), true,
    'the whitelist extracted from Angular is not the one this test thinks it is');

/* ------------------------------------------------------------------ */
/* The config, and what it lets through                                */
/* ------------------------------------------------------------------ */

const configured = index.match(
    /var allowed = (\/\^\\s\*\([^)]*\)\:\/)/);
assert.ok(configured, 'index.js no longer configures an href whitelist at all');

const rule = new RegExp(configured[1].slice(1, -1));

/* What it has to allow. */
[
    ['chrome-extension://abc/error.html', 'the extension\'s own pages'],
    ['https://acme.my.salesforce.com', 'an org'],
    ['http://localhost:8080', 'plain http'],
    ['mailto:someone@example.com', 'a mail link'],
    ['file:///tmp/x.txt', 'a local file']
].forEach(([url, what]) => {
    assert.strictEqual(rule.test(url), true, what + ' is refused: ' + url);
});

/*
 * And what it must go on refusing. A whitelist widened by hand is the change
 * most likely to admit something nobody meant to: a javascript: href in a
 * binding is script execution with the page's privileges, and this extension
 * renders org-supplied text in plenty of places.
 */
[
    'javascript:alert(1)',
    '  javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'blob:https://example.com/abc'
].forEach((url) => {
    assert.strictEqual(rule.test(url), false,
        'the whitelist now admits a scheme it must not: ' + url);
});

/*
 * The images keep their own rule, and it must not have been widened by
 * accident while this one was - they are different lists with different
 * reasons, and data:image/ belongs to exactly one of them.
 */
const imgRule = index.match(/imgSrcSanitizationWhitelist\(\s*(\/[^;]*\/)\)/);
assert.ok(imgRule, 'the image whitelist is gone');
assert.ok(/data:image\\\//.test(imgRule[1]),
    'the image whitelist lost data:image/, which the launcher icons use');
assert.ok(!/data:image/.test(configured[1]),
    'data:image/ leaked into the href whitelist, where it is a way to open a ' +
    'document this extension did not write');

/* ------------------------------------------------------------------ */
/* It is applied, under whichever name this Angular uses               */
/* ------------------------------------------------------------------ */

/*
 * The method was renamed in Angular 1.8. This ships 1.6.4, so the old name
 * is the one that runs - but a version bump must not silently take the links
 * out again, which is what calling only one of them would do.
 */
assert.ok(/aHrefSanitizationWhitelist/.test(index),
    'the 1.6 name is not called, so nothing applies on the version that ships');
assert.ok(/aHrefSanitizationTrustedUrlList/.test(index),
    'the 1.8 name is not called, so an Angular upgrade silently breaks the links');

assert.ok(/typeof \$compileProvider\.aHrefSanitizationWhitelist === 'function'/.test(index),
    'the call is not guarded, so the version that lacks it throws during config - ' +
    'which takes the whole app down, not just the links');

const version = angular.match(/full:"([\d.]+)"/);
assert.ok(version, 'could not read the Angular version');
assert.ok(/^1\.6\./.test(version[1]),
    'Angular is now ' + version[1] + ' - check which sanitiser name it uses');

/* ------------------------------------------------------------------ */
/* The links that needed it                                            */
/* ------------------------------------------------------------------ */

/*
 * Every href that resolves to an extension page goes through this. Listed
 * from the source so a fourth one added later is covered without anybody
 * remembering this file exists.
 */
const controller = read('js/angular/controllers/MenuAndDetailsCtrl.js');
const view = read('js/angular/services/ViewService.js');

const urlBuilders = (controller.match(/\$scope\.(\w*(?:HelpUrl|ReferenceUrl))\s*=/g) || [])
    .map((m) => m.replace(/\$scope\.|\s*=/g, ''));
assert.ok(urlBuilders.length >= 3,
    'expected the extension-page url builders, found ' + urlBuilders.join(', '));

urlBuilders.forEach((name) => {
    assert.ok(new RegExp('ng-href="\\{\\{' + name + '\\(').test(view),
        name + ' builds an extension url that nothing binds to an href');
});

/*
 * And they all come from one place, so the scheme they produce is the one
 * the whitelist was widened for.
 */
assert.ok(/ssErrorPageUrl/.test(controller),
    'the url builders no longer share ssErrorPageUrl, so they can produce ' +
    'schemes the whitelist was never checked against');

console.log('href_sanitizer: ok (angular ' + version[1] + ')');
