/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * A name cut at 30 characters can still be read in full.
 *
 * The grid shortens names with limitTo:30 and marks the cut with an ellipsis.
 * Every one of those cells has always carried data-title with the whole value,
 * and on the org panel that is enough - the suppressor in ss-core only hides a
 * tooltip whose text matches what is rendered, and a shortened name does not
 * match.
 *
 * The standalone page turned all of them off, in two places at once: the
 * stylesheet blanks the generated content, and simplified.js strips the
 * attributes outright. That decision was made when a tooltip only ever
 * repeated something already on screen. Truncation changed that: the full name
 * is now nowhere else on the page, and "MyLongIntegrationHandlerFor..." does
 * not distinguish two components that share a prefix.
 */

const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const css = fs.readFileSync('./css/styles.css', 'utf8');
const stripper = fs.readFileSync('./js/simplified.js', 'utf8');

function main() {

    /* ------------------------------------------------------------------ */
    /* Every shortened cell is marked, and marked by the same test          */
    /* that draws the ellipsis                                             */
    /*                                                                     */
    /* Two expressions that mean "this was cut" would eventually disagree,  */
    /* and the disagreement is invisible: an ellipsis with no tooltip, or a */
    /* tooltip on a name that fits.                                        */
    /* ------------------------------------------------------------------ */

    const cut = [...view.matchAll(/\{\{([^{}]+?\.length > 30) \? \\'\\u2026\\'/g)].map((m) => m[1]);
    assert.strictEqual(cut.length, 14, 'the 14 name cells still truncate, found ' + cut.length);

    const marked = [...view.matchAll(/ng-class="\{\\'ss-truncated\\': ([^"]+?)\}"/g)].map((m) => m[1]);
    assert.strictEqual(marked.length, cut.length,
        'every truncating cell is marked: ' + marked.length + ' of ' + cut.length);
    assert.deepStrictEqual(marked, cut,
        'and marked by the identical expression, in the same order');

    /*
     * The fallback binding renders (Name || MasterLabel || _ssLabel) but its
     * data-title is {{r._ssLabel}}. Its marker must follow what is rendered,
     * not what the tooltip says, or a long Name in a row that also has an
     * _ssLabel gets an ellipsis and no tooltip.
     */
    assert.ok(cut.some((expr) => /r\.Name \|\| r\.MasterLabel \|\| r\._ssLabel/.test(expr)),
        'the compound fallback binding is among them');
    marked.filter((expr) => /\|\|/.test(expr)).forEach((expr) => {
        assert.ok(/^\(r\.Name \|\| r\.MasterLabel \|\| r\._ssLabel\)\.length > 30$/.test(expr),
            'the compound marker tests the rendered value: ' + expr);
    });

    /* Each marker sits on the element that carries the tooltip. */
    const cells = [...view.matchAll(/data-title="\{\{[^"{}]*\}\}" ng-class="\{\\'ss-truncated\\'[^"]*\}"/g)];
    assert.strictEqual(cells.length, 14,
        'the marker is on the same element as data-title, or the CSS selector ' +
        'and the attribute never meet: ' + cells.length);
    assert.strictEqual((view.match(/ss-truncated/g) || []).length, 14,
        'and nowhere else in the templates');


    /* ------------------------------------------------------------------ */
    /* The cells are still well-formed                                     */
    /*                                                                     */
    /* Everything above matches patterns inside the template text, and a    */
    /* pattern match says nothing about the markup around it. A scripted    */
    /* edit that duplicated half of each cell satisfied every assertion in  */
    /* this file while the grid rendered raw template source into the page  */
    /* - "Gold Partner User{{r.Name.length > 30..." in the name column.     */
    /*                                                                     */
    /* So: count the parts. A name cell is one anchor inside one td, cut    */
    /* once, described once.                                               */
    /* ------------------------------------------------------------------ */

    const nameCells = view.split('\n').filter((line) => /limitTo:30/.test(line));
    assert.strictEqual(nameCells.length, 14, 'one per name column, found ' + nameCells.length);

    nameCells.forEach((line, i) => {
        const once = {
            'opening td': (line.match(/<td[\s>]/g) || []).length,
            'closing td': (line.match(/<\/td>/g) || []).length,
            'anchor': (line.match(/<a[\s]/g) || []).length,
            'closing anchor': (line.match(/<\/a>/g) || []).length,
            'limitTo:30': (line.match(/limitTo:30/g) || []).length,
            'data-title': (line.match(/data-title=/g) || []).length,
            'ng-class': (line.match(/ng-class=/g) || []).length,
            'ellipsis': (line.match(/\\'\\u2026\\'/g) || []).length
        };
        Object.keys(once).forEach((part) => {
            assert.strictEqual(once[part], 1,
                'name cell ' + i + ' has ' + once[part] + ' of "' + part + '", expected 1 - ' +
                'a duplicated fragment renders template source as text');
        });
        assert.strictEqual((line.match(/"/g) || []).length % 2, 0,
            'name cell ' + i + ' has an odd number of quotes, so an attribute is unterminated');
    });

    /* ------------------------------------------------------------------ */
    /* The stylesheet lets exactly those through                           */
    /* ------------------------------------------------------------------ */

    const banned = css.slice(css.indexOf('body.ss-standalone .tooltip-me'));
    const offRule = banned.slice(0, banned.indexOf('}') + 1);
    assert.ok(/:not\(\.ss-truncated\)/.test(offRule),
        'the blanket off-switch must exempt them: ' + offRule.split('\n')[0]);

    /*
     * Exempting is not the same as showing. The off rule uses
     * content: none !important, so the exemption has to restore content
     * with !important of its own or the pseudo-element renders nothing.
     */
    const onRule = /body\.ss-standalone \.tooltip-me\.ss-truncated:hover:after \{([^}]*)\}/.exec(css);
    assert.ok(onRule, 'and something must turn them back on');
    assert.ok(/content:\s*attr\(data-title\)\s*!important/.test(onRule[1]),
        'restoring the content, with !important: ' + onRule[1].trim());
    assert.ok(/display:\s*block\s*!important/.test(onRule[1]),
        'and the display the off rule set to none');

    /* Counted, so a stray :not() left on one selector cannot pass. */
    const offSelectors = offRule.slice(0, offRule.indexOf('{')).split(',')
        .map((s) => s.trim()).filter((s) => /\.tooltip-me/.test(s));
    offSelectors.forEach((selector) => {
        assert.ok(/:not\(\.ss-truncated\)/.test(selector),
            'every .tooltip-me selector in the off rule needs the exemption, ' +
            'or one of them still wins: ' + selector);
    });

    /* ------------------------------------------------------------------ */
    /* And the stripper leaves the attribute alone                         */
    /*                                                                     */
    /* CSS alone is not enough here: content: attr(data-title) on an element */
    /* whose data-title has been removed renders an empty box.              */
    /* ------------------------------------------------------------------ */

    const clean = /function clean\(node\) \{[\s\S]*?\n        \}/.exec(stripper);
    assert.ok(clean, 'the stripper must still exist');
    assert.ok(/ss-truncated/.test(clean[0]),
        'it has to know about the exception, or CSS shows an empty tooltip');

    /* Run it, rather than trust the shape of it. */
    const removals = [];
    const node = (classes, attrs) => ({
        nodeType: 1,
        classList: { contains: (c) => classes.includes(c) },
        hasAttribute: (a) => attrs.includes(a),
        removeAttribute: (a) => removals.push(a),
        querySelectorAll: () => []
    });
    /* ATTRS is closed over from stripTooltips; lift it rather than restate it. */
    const attrs = /var ATTRS = \[[^\]]*\];/.exec(stripper);
    assert.ok(attrs, 'the attribute list must still be there');
    assert.ok(/'data-title'/.test(attrs[0]) && /'title'/.test(attrs[0]),
        'covering both kinds of tooltip: ' + attrs[0]);
    const run = new Function('node',
        attrs[0] + '\n' + clean[0] + '\nreturn clean(node);');

    removals.length = 0;
    run(node(['tooltip-me', 'ss-truncated'], ['title', 'data-title']));
    assert.deepStrictEqual(removals, ['title'],
        'a shortened name keeps data-title and loses the native title - keeping ' +
        'both would draw two tooltips over each other');

    removals.length = 0;
    run(node(['tooltip-me'], ['title', 'data-title']));
    assert.deepStrictEqual(removals, ['title', 'data-title'],
        'everything else is still stripped - the page is not meant to have tooltips');

    console.log('truncated name tooltip test passed');
}

main();
