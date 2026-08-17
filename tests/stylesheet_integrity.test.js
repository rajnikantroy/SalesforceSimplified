/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The stylesheets must parse as the author intended.
 *
 * CSS has no syntax errors in the useful sense: a browser given a broken
 * stylesheet recovers and carries on, silently, with some of the rules gone.
 * An unbalanced brace is the worst of them, because of how recovery works -
 * a `}` with nothing open is not skipped, it is read as the beginning of a
 * rule, and the parser then consumes everything up to and including the next
 * block. The stray brace does not break itself; it deletes the rule after it.
 *
 * That is exactly what had happened here: one extra `}` after
 * `.sfdcSimplifiedUserTitle button`, and `.ARISearch span` had never applied
 * on any page, in any browser, since it was written. Nothing reported it -
 * the file parses cleanly either side of the damage, so it looked fine.
 *
 * Braces are checked with comments blanked out, because `{` and `}` inside a
 * comment are not structure.
 */

const sheets = ['./css/styles.css', './css/w3c.css'];

for (const path of sheets) {
    const source = fs.readFileSync(path, 'utf8');

    // Blank comments but keep their newlines, so reported line numbers are true.
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));

    let depth = 0;
    const strays = [];
    const openLines = [];
    const lines = stripped.split('\n');

    lines.forEach((line, index) => {
        for (const character of line) {
            if (character === '{') {
                depth++;
                openLines.push(index + 1);
            } else if (character === '}') {
                if (depth === 0) {
                    strays.push(index + 1);
                } else {
                    depth--;
                    openLines.pop();
                }
            }
        }
    });

    assert.deepStrictEqual(
        strays, [],
        `${path}: closing brace with no open block at line(s) ${strays.join(', ')} - ` +
        'this silently deletes the rule that follows it'
    );

    assert.strictEqual(
        depth, 0,
        `${path}: ${depth} block(s) left unclosed at end of file, opened at line(s) ` +
        openLines.join(', ') + ' - everything after them is trapped inside'
    );
}

/* ------------------------------------------------------------------ */
/* w3c.css must stay confined to this extension's own markup            */
/*                                                                      */
/* These class names are not ours. w3c.css is a subset of W3.CSS, a     */
/* widely used framework, and it is injected into every Salesforce page */
/* whole - so an unscoped `.w3-button` here restyles anything on the    */
/* page carrying that class, whether that is Salesforce's own markup or */
/* another extension's UI sharing the document. The colour utilities    */
/* are !important, so a collision would not merely compete, it would    */
/* win.                                                                 */
/*                                                                      */
/* .theme-lightning is on all three extension roots and index.js sets   */
/* it unconditionally, so scoping to it confines every rule at no cost. */
/* ------------------------------------------------------------------ */

const w3 = fs.readFileSync('./css/w3c.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));

const unscoped = [];
for (const rule of w3.matchAll(/(?:^|\})\s*([^{}@]+?)\s*\{/gs)) {
    const prelude = rule[1].split(/\s+/).join(' ').trim();
    if (!prelude) { continue; }
    for (const part of prelude.split(',')) {
        const selector = part.trim();
        // Keyframe stops are not selectors.
        if (!selector || selector === 'from' || selector === 'to' || /^\d+%$/.test(selector)) { continue; }
        if (!selector.startsWith('.theme-lightning')) { unscoped.push(selector); }
    }
}

assert.deepStrictEqual(
    unscoped, [],
    'w3c.css rules must be scoped to .theme-lightning so they cannot restyle the host page or ' +
    'another extension sharing the document. Unscoped: ' + unscoped.join(', ')
);

console.log('stylesheet integrity test passed');
