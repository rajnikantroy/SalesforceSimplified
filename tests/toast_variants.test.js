/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Every toast variant the code asks for has a colour.
 *
 * The toast builds its class as 'ss-toast-' + variant, and .ss-toast sets
 * white text but took its background entirely from the variant rule. So a
 * variant with no rule of its own rendered white text on nothing - a toast
 * that is there, occupying space, saying something, and unreadable.
 *
 * That is not hypothetical: the bookmark check raised variant 'warn' while the
 * stylesheet defines 'warning', and the notification came out transparent. The
 * mismatch is invisible in both files on their own, which is the reason this
 * exists: nothing else connects the string in the controller to the selector
 * in the stylesheet.
 *
 * The list of variants is derived from the source rather than kept here, so a
 * new one is checked without anyone remembering to add it.
 */

const css = fs.readFileSync('./css/styles.css', 'utf8');

const SOURCES = [
    './js/angular/controllers/MenuAndDetailsCtrl.js',
    './js/angular/controllers/MyViewGridCtrl.js',
    './js/angular/services/ViewService.js'
];

function main() {
    const requested = new Set();
    for (const path of SOURCES) {
        const source = fs.readFileSync(path, 'utf8');
        for (const match of source.matchAll(/variant:\s*'([a-zA-Z-]+)'/g)) {
            requested.add(match[1]);
        }
    }

    assert.ok(requested.size >= 2,
        'expected the code to raise several toast variants, found ' + requested.size +
        ' - an extraction that matches nothing looks exactly like a pass');

    const missing = [...requested].filter((variant) =>
        !new RegExp('\\.ss-toast-' + variant + '\\b').test(css));

    assert.deepStrictEqual(missing, [],
        'these toast variants are raised in code but have no rule in styles.css, so ' +
        'the toast renders with no background and its white text is invisible: ' +
        missing.join(', '));

    /*
     * And a floor under the whole thing: the base class carries a background
     * of its own, so a variant this check has not seen - one built from a
     * value at runtime, say - is still legible. Asserted without !important,
     * because the variant rules must stay able to override it.
     */
    const base = css.match(/\.ss-toast\s*\{[^}]*\}/);
    assert.ok(base, 'could not find the base .ss-toast rule');
    assert.ok(/background-color\s*:/.test(base[0]),
        'the base .ss-toast rule must set a background, or an unrecognised variant ' +
        'renders as white text on transparency');

    // The variant rules still win, or the fallback would flatten all of them.
    for (const variant of requested) {
        const rule = css.match(new RegExp('\\.ss-toast-' + variant + '\\s*\\{[^}]*\\}'));
        assert.ok(/background-color[^;]*!important/.test(rule[0]),
            'ss-toast-' + variant + ' must set its background with !important, or the ' +
            'base fallback overrides every variant and they all look the same');
    }

    console.log('toast variant regression test passed (' +
        [...requested].sort().join(', ') + ')');
}

main();
