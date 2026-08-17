/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/*
 * The version lives in manifest.json, and welcome.html states it three times -
 * the tab title, the badge under the logo, and the footer. Nothing keeps them
 * together, so a release that bumps the manifest and misses one of the three
 * ships a page that introduces itself as the previous version. That is the
 * kind of wrong that nobody notices for several releases.
 *
 * Three separate assertions rather than a count, because the interesting
 * failure is "two of the three were updated", and a count of matches would
 * pass on the wrong distribution of them.
 */

const ROOT = path.join(__dirname, '..');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const welcome = fs.readFileSync(path.join(ROOT, 'welcome.html'), 'utf8');

const version = manifest.version;

assert.ok(/^\d+\.\d+\.\d+$/.test(version),
    'manifest version should be three dotted numbers, got: ' + version);

assert.ok(welcome.includes('<title>Welcome to Salesforce Simplified v' + version + '</title>'),
    'welcome.html <title> should name manifest version ' + version);

assert.ok(welcome.includes('<span class="version-badge">v' + version + '</span>'),
    'welcome.html version badge should name manifest version ' + version);

assert.ok(welcome.includes('<b>Salesforce Simplified v' + version + '</b>'),
    'welcome.html footer should name manifest version ' + version);

/*
 * And no other version anywhere on the page: the three above are the only
 * places it belongs, so a leftover elsewhere is a stale copy that the three
 * assertions above cannot see.
 */
const others = (welcome.match(/v\d+\.\d+\.\d+/g) || []).filter(function (found) {
    return found !== 'v' + version;
});
assert.deepStrictEqual(others, [],
    'welcome.html still names other versions: ' + others.join(', '));

/*
 * The quick-nav pills are the page's table of contents, and a section added
 * without its pill is unreachable from the top of a page this long.
 */
const sections = (welcome.match(/<section id="([a-z-]+)"/g) || []).map(function (tag) {
    return tag.replace(/<section id="/, '').replace(/"$/, '');
});
assert.ok(sections.length > 5, 'expected the welcome page to have sections, found ' + sections.length);

const missing = sections.filter(function (id) {
    return !welcome.includes('href="#' + id + '"');
});
assert.deepStrictEqual(missing, [],
    'welcome.html sections with no quick-nav pill: ' + missing.join(', '));

/*
 * Nothing of substance may sit between two sections.
 *
 * A block that lands after </section> and before the next <section> still
 * renders - which is why this is worth a check rather than an eye. It is
 * outside the section wrapper, so it loses that styling, and it belongs to no
 * quick-nav pill, so nothing on the page leads to it. Made this mistake twice
 * in one sitting appending to a section by anchoring on the comment that
 * introduces the next one, which is one line too far down.
 */
const between = welcome.split(/<\/section>/).slice(1);
between.forEach(function (chunk, index) {
    const next = chunk.indexOf('<section');
    const gap = (next === -1 ? chunk : chunk.slice(0, next))
        /* Comments and whitespace are the whole of what belongs here. */
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim();

    /* The tail after the last section is the page footer, which is markup by
     * design - only the gaps between sections are checked. */
    if (next === -1) { return; }

    assert.strictEqual(gap, '',
        'content sits between section ' + (index + 1) + ' and the next one, so it ' +
        'renders outside any section and no quick-nav pill leads to it:\n    ' +
        gap.slice(0, 160).replace(/\s+/g, ' '));
});

console.log('version_stamp: ok (v' + version + ', ' + sections.length + ' sections all linked)');
