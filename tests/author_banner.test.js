/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/*
 * Every file this project wrote carries its author, and none of the files it
 * did not.
 *
 * The second half is the part worth a test. jQuery, AngularJS and W3.CSS are
 * bundled here and are somebody else's work; a banner claiming authorship of
 * them is a false statement, and one that a bulk edit run again later would
 * add without anyone noticing. The login-form fixture is a captured copy of
 * Salesforce's own markup and is the same case.
 */

const AUTHOR = 'Rajni Kant Roy(Salesforce Technical Architect)';

const VENDOR = [
    'js/jq.js',
    'js/angular/angular.min.js',
    'css/w3c.css',
    'tests/fixtures/salesforce-login-form.html'
];

function walk(dir, found) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') { continue; }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full, found); continue; }
        if (/\.(js|css|html)$/.test(entry.name)) { found.push(path.relative('.', full)); }
    }
    return found;
}

function main() {
    const files = walk('.', []);
    assert.ok(files.length > 50, 'expected the project, found ' + files.length + ' files');

    let stamped = 0;
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        const has = text.includes(AUTHOR);

        if (VENDOR.includes(file)) {
            assert.ok(!has,
                file + ' is not this project\'s work and must not carry its author');
            continue;
        }

        assert.ok(has, file + ' is missing the author banner');
        stamped++;

        /*
         * At the top, where a banner is read. Anywhere else it is a line in
         * the middle of a file that happens to contain a name.
         */
        const head = text.slice(0, 200);
        assert.ok(head.includes(AUTHOR),
            file + ': the banner must be at the top, not buried');

        if (file.endsWith('.html')) {
            /*
             * After the doctype and nowhere else. A comment before it makes
             * the document quirks-mode in some browsers, which changes how
             * every box on the page is measured.
             */
            /*
             * Guarded on the doctype existing, not on it being first - which
             * is false exactly when the banner has been put in front of it,
             * so the check skipped itself in the one case it is for.
             */
            const doctypeAt = text.toLowerCase().indexOf('<!doctype');
            if (doctypeAt !== -1) {
                assert.ok(doctypeAt < text.indexOf(AUTHOR),
                    file + ': the doctype must still come first, or the page is ' +
                    'parsed in quirks mode and every box on it is measured ' +
                    'differently');
            }
            assert.ok(/<!--[^>]*Author:/.test(head), file + ': as an HTML comment');
        } else {
            assert.ok(head.trimStart().startsWith('/*'),
                file + ': as a block comment, on the first line');
        }
    }

    assert.ok(stamped > 50, 'expected most of the project stamped, got ' + stamped);
    assert.strictEqual(files.filter((f) => VENDOR.includes(f)).length, VENDOR.length,
        'every file named as vendor must actually exist - a stale name here ' +
        'silently stops excluding anything');

    console.log('author banner test passed (' + stamped + ' files, ' +
                VENDOR.length + ' vendor files left alone)');
}

main();
