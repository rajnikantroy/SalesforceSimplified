/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Buttons that are actually visible.
 *
 * This extension injects its UI into somebody else's page, and Salesforce
 * styles bare <button> elements. Two ways of losing that fight have already
 * shipped, and both produce the same useless result - a control that is
 * present, clickable, and invisible:
 *
 *   1. A rule setting light text with no background of its own, relying on a
 *      second rule elsewhere to supply the background. When the host page
 *      beats that second rule the text colour survives and the background
 *      does not. `.viewasdifferentuser` said `color: white` and nothing else,
 *      and depended on `.theme-lightning .viewasdifferentuser` 900 lines
 *      further down; under a `button { background: #fff }` reset it computed
 *      to white-on-white.
 *
 *   2. A class the templates ask for that the stylesheet never defines.
 *      w3c.css is a hand-trimmed subset of W3.CSS, and the trim kept
 *      w3-button while dropping every colour, size and shape utility used
 *      beside it - so `w3-button w3-blue w3-round` rendered as bare text.
 *
 * Both checks below are derived from the templates rather than from a list
 * kept by hand, so they stay true as the markup changes.
 */

const templates = ['./js/angular/services/ViewService.js', './js/angular/services/mygridviewservices.js', './index.js']
    .filter((path) => fs.existsSync(path))
    .map((path) => fs.readFileSync(path, 'utf8'))
    .join('\n');

const styles = fs.readFileSync('./css/styles.css', 'utf8');
const w3 = fs.readFileSync('./css/w3c.css', 'utf8');

/* ------------------------------------------------------------------ */
/* 1. Every w3- class the templates use must be defined                 */
/* ------------------------------------------------------------------ */

const used = new Set();
for (const attr of templates.matchAll(/class=\\?"([^"]*)"/g)) {
    for (const cls of attr[1].split(/\s+/)) {
        if (/^w3-[a-z-]+$/.test(cls)) { used.add(cls); }
    }
}
assert.ok(used.size > 5, `expected the templates to use several w3- classes, found ${used.size}`);

const defined = new Set();
for (const sel of w3.matchAll(/\.(w3-[a-z-]+)/g)) { defined.add(sel[1]); }

const undefinedClasses = [...used].filter((cls) => !defined.has(cls)).sort();
assert.deepStrictEqual(
    undefinedClasses, [],
    'templates use w3- classes that w3c.css does not define, so those controls render as ' +
    'unstyled text: ' + undefinedClasses.join(', ')
);

/* ------------------------------------------------------------------ */
/* 2. No rule may set near-white text without its own background        */
/*                                                                      */
/* Scoped to rules that name a button, because a button is a            */
/* self-contained control - unlike a heading inside a coloured bar,     */
/* which legitimately takes its background from its parent.             */
/* ------------------------------------------------------------------ */

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

const LIGHT_TEXT = /color\s*:\s*(white|#fff(?:fff)?\b|rgb\(\s*255\s*,\s*255\s*,\s*255)/i;
const HAS_BACKGROUND = /background(-color|-image)?\s*:/i;

// Classes the templates actually put on a <button> or button-like <input>.
const buttonClasses = new Set();
for (const tag of templates.matchAll(/<(?:button|input)[^>]*class=\\?"([^"]*)"/g)) {
    for (const cls of tag[1].split(/\s+/)) {
        if (/^[A-Za-z][\w-]*$/.test(cls)) { buttonClasses.add(cls); }
    }
}

const offenders = [];
for (const source of [{ name: 'styles.css', css: styles }, { name: 'w3c.css', css: w3 }]) {
    const clean = stripComments(source.css);
    for (const rule of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim().split('\n').pop().trim();
        const body = rule[2];
        if (!LIGHT_TEXT.test(body) || HAS_BACKGROUND.test(body)) { continue; }
        // Does this selector target one of the button classes?
        const targetsButton = [...buttonClasses].some((cls) => selector.includes('.' + cls));
        if (targetsButton) {
            const line = clean.slice(0, rule.index).split('\n').length;
            offenders.push(`${source.name}:${line} ${selector}`);
        }
    }
}

assert.deepStrictEqual(
    offenders, [],
    'these button rules set near-white text but declare no background of their own - if a host ' +
    'page beats whichever other rule supplies the background, the button becomes invisible:\n  ' +
    offenders.join('\n  ')
);

console.log('button style regression test passed');
