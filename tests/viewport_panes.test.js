/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/*
 * Panes that are meant to fill the screen, on the surfaces that have one.
 *
 * There are three surfaces and only two of them own the viewport: the panel
 * when it is full screen, and simplified.html. The windowed panel is a small
 * box, and a pane sized to the window inside it puts a scrollbar inside a
 * scrollbar.
 *
 * This file exists because the same mistake has now been made three times in
 * this stylesheet, and each time it was invisible - nothing was broken, there
 * was simply several hundred pixels of nothing under a box being scrolled by
 * hand:
 *
 *   - a rule written only for #SimplifiedMainModal.ssFullScreen, which the
 *     standalone page cannot match: it carries neither that id nor that
 *     class, so it stayed pinned at the windowed default;
 *   - min() against a flat pixel value, where on any screen tall enough to
 *     matter the flat operand always won and the calc never got a say;
 *   - a plain vh fraction, which is right at exactly one window size.
 */

const ROOT = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');

/* Comments first. The file is full of prose containing braces and selectors,
 * and every check below would otherwise read explanations as rules. */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/* ------------------------------------------------------------------ */
/* The stylesheet parses at all                                        */
/* ------------------------------------------------------------------ */

let depth = 0;
let stray = 0;
for (const ch of css) {
    if (ch === '{') { depth += 1; }
    else if (ch === '}') { depth -= 1; if (depth < 0) { stray += 1; depth = 0; } }
}
assert.strictEqual(depth, 0, 'the stylesheet leaves ' + depth + ' rule(s) unclosed');
assert.strictEqual(stray, 0, 'the stylesheet has ' + stray + ' close brace(s) matching nothing');

/* ------------------------------------------------------------------ */
/* Every viewport-sized pane covers both surfaces                      */
/* ------------------------------------------------------------------ */

/*
 * Read out of the file rather than listed here, so a pane added later is
 * covered without anybody remembering to come back and add it.
 */
const rules = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
}
assert.ok(rules.length > 500, 'the rule extraction found only ' + rules.length + ' rules');

/* A rule is "viewport-sized" when its height depends on the window. */
const viewportRules = rules.filter((r) =>
    /(?:max-)?height:[^;]*\b(?:100vh|[0-9.]+vh)/.test(r.body));
assert.ok(viewportRules.length >= 3,
    'expected several viewport-sized panes, found ' + viewportRules.length);

/*
 * Of those, the ones written for the full-screen modal must name the
 * standalone page too. That page owns the whole window and matches neither
 * the id nor the class, so a rule that mentions only the modal leaves it on
 * whatever the windowed default was.
 */
viewportRules.forEach((rule) => {
    if (!/#SimplifiedMainModal\.ssFullScreen/.test(rule.selector)) { return; }
    assert.ok(/\.ss-page|\.ss-standalone/.test(rule.selector),
        'this rule sizes a pane to the window for the full-screen panel but not ' +
        'for the standalone page, which owns the window just as much:\n    ' +
        rule.selector);
});

/*
 * min() against a flat pixel value is not wrong on its own - "at most 460,
 * and never taller than the window" is a reasonable windowed cap. It is
 * wrong when it is the only rule, because min() picks the smaller operand:
 * on every screen tall enough for the calc to have mattered, the flat value
 * wins, and the taller the screen the more empty space under the box.
 *
 * So what is required is a companion rule for the surfaces that own the
 * viewport. That is exactly the fix the timeline list already carries, and
 * exactly what the REST response was missing.
 */
const lastClass = (selector) => {
    const found = selector.match(/\.[A-Za-z][\w-]*/g);
    return found ? found[found.length - 1] : null;
};

viewportRules.forEach((rule) => {
    if (!/min\(\s*[0-9.]+px\s*,\s*calc\([^)]*vh[^)]*\)\s*\)/.test(rule.body)) { return; }
    const target = lastClass(rule.selector);
    assert.ok(target, 'could not read a target class from: ' + rule.selector);

    const freed = rules.some((other) =>
        other !== rule &&
        other.selector.indexOf(target) > -1 &&
        /#SimplifiedMainModal\.ssFullScreen|\.ss-page|\.ss-standalone/.test(other.selector) &&
        /(?:max-)?height:/.test(other.body));

    assert.ok(freed,
        target + ' is capped with min() against a flat pixel value and has no rule ' +
        'for the surfaces that own the viewport - so on any screen tall enough to ' +
        'matter the flat value always wins:\n    ' + rule.selector);
});

/* ------------------------------------------------------------------ */
/* The REST Explorer response                                          */
/* ------------------------------------------------------------------ */

function ruleFor(selectorPart, needle) {
    return rules.filter((r) => r.selector.indexOf(selectorPart) > -1 &&
        (!needle || r.body.indexOf(needle) > -1))[0];
}

/*
 * The windowed panel keeps a modest cap; it is a small box. Losing this
 * makes the response taller than the panel that contains it.
 */
const windowed = ruleFor('.theme-lightning .ss-rest-response', '46vh');
assert.ok(windowed, 'the windowed default for the REST response is gone');
assert.ok(/min-height:/.test(windowed.body),
    'the response has no floor, so on a short window it collapses to nothing');

/*
 * The two surfaces that own the viewport fill it. This is the whole change:
 * 46vh left most of a large screen empty under a box that was scrolling.
 */
const filled = rules.filter((r) => /\.ss-rest-response$/.test(r.selector) &&
    /calc\(100vh/.test(r.body));
assert.ok(filled.length >= 1, 'the REST response never fills the viewport on any surface');

/*
 * Each rule on its own, and each selector within it on its own.
 *
 * Joining every matching selector into one string and searching that is the
 * trap this whole file is about: with two rules in play, one of them naming
 * the modal satisfied the check while the other had lost it. A rule that
 * sizes the response to the window has to name both surfaces itself.
 */
const selectorsOf = (rule) => rule.selector.split(',').map((one) => one.trim());

filled.forEach((rule) => {
    const parts = selectorsOf(rule);
    assert.ok(parts.some((one) => /#SimplifiedMainModal\.ssFullScreen/.test(one)),
        'this rule fills the viewport but never for the full-screen panel:\n    ' +
        rule.selector);
    assert.ok(parts.some((one) => /\.ss-page|\.ss-standalone/.test(one)),
        'this rule fills the viewport but never for the standalone page, which ' +
        'owns the whole window and would stay pinned at the windowed default:\n    ' +
        rule.selector);
});

/*
 * A request body is another textarea above the response, so there is less
 * room left. Only POST, PUT, PATCH and DELETE show one.
 */
const withBody = rules.filter((r) => /ss-rest-body/.test(r.selector) &&
    /calc\(100vh/.test(r.body));
assert.ok(withBody.length >= 1,
    'with a request body on screen the response is sized as though it were not there');

withBody.forEach((rule) => {
    /* Every selector in the list, not just one of them - a comma-separated
     * rule where only the first was fixed reads as fixed when it is half so. */
    selectorsOf(rule).forEach((one) => {
        assert.ok(/:not\(\.ng-hide\)/.test(one),
            'this selector does not test for the body being shown - ng-show hides ' +
            'by adding .ng-hide, so it applies whether or not there is a body:\n    ' +
            one);
    });
});

/* And it must leave less room than the no-body rule, not more. */
const offset = (list) => Number((list[0].body.match(/calc\(100vh - (\d+)px\)/) || [, 0])[1]);
assert.ok(offset(withBody) > offset(filled),
    'the with-a-body response is allowed at least as much height as the one ' +
    'without, though there is a textarea above it');

console.log('viewport_panes: ok (' + viewportRules.length + ' viewport-sized panes checked)');
