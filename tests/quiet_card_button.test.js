/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The sidebar cards' primary button is grey, not blue.
 *
 * Greping for the class would prove nothing here. .viewasdifferentuser is
 * declared three times in this stylesheet, every declaration on it is
 * !important, and the last one sits 900 lines below the first. A new rule that
 * looks right in isolation loses silently to any of them, and the button keeps
 * rendering blue while the test passes.
 *
 * So this resolves the cascade: for each button, collect every rule in the
 * sheet that matches its class list, rank by (!important, specificity, source
 * order) the way a browser does, and assert on the declaration that actually
 * wins.
 */

const css = fs.readFileSync('./css/styles.css', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');

/* Rules, in source order, with comments stripped so a commented-out rule
 * cannot be mistaken for a live one. */
function rules(source) {
    const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const found = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(clean)) !== null) {
        const body = m[2];
        m[1].split(',').forEach((selector) => {
            selector = selector.trim();
            /* An @media prelude is swallowed into the first selector inside it. */
            if (!selector || selector.startsWith('@')) { return; }
            found.push({ selector, body, order: found.length });
        });
    }
    return found;
}

/* a,b,c - ids, classes/attributes/pseudo-classes, elements. */
function specificity(selector) {
    const ids = (selector.match(/#[\w-]+/g) || []).length;
    const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
    const elements = (selector.replace(/[.#:[][^\s>+~]*/g, ' ').match(/\b[a-z][\w-]*/gi) || []).length;
    return [ids, classes, elements];
}

/* True when every compound in the selector is satisfied by this element's
 * classes/tag. Descendant combinators are treated as satisfied by ancestry we
 * know is there (.theme-lightning wraps the panel); a compound naming a class
 * the button does not carry is not. */
function matches(selector, el) {
    if (/:hover|:focus|:disabled|:visited|:after|:before/.test(selector)) { return false; }
    const parts = selector.split(/\s+|\s*>\s*/).filter(Boolean);
    const target = parts[parts.length - 1];
    const ancestors = parts.slice(0, -1);
    const compoundOk = (compound, classes, tag) => {
        /* These buttons carry no id, so any id in the compound rules it out.
         * Without this, #sfdcSimplifiedTitle { color: #000 } matched every
         * element and won on specificity - a false answer, not a false alarm. */
        if (/#/.test(compound)) { return false; }
        const tagMatch = /^[a-z][\w-]*/i.exec(compound);
        if (tagMatch && tag && tagMatch[0].toLowerCase() !== tag) { return false; }
        return (compound.match(/\.[\w-]+/g) || []).every((c) => classes.has(c.slice(1)));
    };
    if (!compoundOk(target, el.classes, el.tag)) { return false; }
    return ancestors.every((a) => compoundOk(a, el.ancestorClasses, null));
}

function winner(property, el) {
    const candidates = [];
    rules(css).forEach((rule) => {
        if (!matches(rule.selector, el)) { return; }
        const re = new RegExp('(?:^|;)\\s*' + property + '\\s*:\\s*([^;]+)', 'g');
        let d;
        while ((d = re.exec(rule.body)) !== null) {
            const value = d[1].trim();
            candidates.push({
                selector: rule.selector,
                value: value.replace(/\s*!important$/, ''),
                important: /!important$/.test(value),
                spec: specificity(rule.selector),
                order: rule.order
            });
        }
    });
    /* Inline styles beat normal author rules but lose to !important ones. */
    if (el.inline && el.inline[property] !== undefined) {
        candidates.push({ selector: '[inline]', value: el.inline[property],
                          important: false, spec: [1, 0, 0], order: -1, inline: true });
    }
    candidates.sort((x, y) => {
        if (x.important !== y.important) { return x.important ? -1 : 1; }
        if (x.inline !== y.inline) { return x.inline ? -1 : 1; }
        for (let i = 0; i < 3; i++) { if (x.spec[i] !== y.spec[i]) { return y.spec[i] - x.spec[i]; } }
        return y.order - x.order;
    });
    return candidates[0];
}

function main() {

    const ancestorClasses = new Set(['theme-lightning', 'userdetails', 'ss-right-card']);

    /* ------------------------------------------------------------------ */
    /* The sheet is understood well enough to trust the answers            */
    /*                                                                     */
    /* If the resolver could not see the blue in the first place, it would */
    /* report "grey wins" no matter what was written.                      */
    /* ------------------------------------------------------------------ */

    const plain = { tag: 'button', classes: new Set(['viewasdifferentuser']), ancestorClasses };
    const blue = winner('background-color', plain);
    assert.ok(blue, 'the resolver must find a background-color for the shared button class');
    assert.ok(/--ss-blue|0176d3/.test(blue.value),
        'an untouched .viewasdifferentuser is still blue, so the grey below is a real ' +
        'change and not a hole in this test: ' + blue.selector + ' -> ' + blue.value);
    assert.ok(blue.important, 'and it wins on !important - which is what a plain new rule loses to');

    /* ------------------------------------------------------------------ */
    /* The card buttons resolve to grey                                    */
    /* ------------------------------------------------------------------ */

    const quiet = {
        tag: 'button',
        classes: new Set(['viewasdifferentuser', 'ss-btn-quiet']),
        ancestorClasses,
        /* One of these carried style="background: rgb(48,100,133)". Inline or
         * not, an author !important beats it - so the inline was never doing
         * anything, and removing it must not change the answer. */
        inline: { 'background-color': 'rgb(48, 100, 133)' }
    };
    const grey = winner('background-color', quiet);
    assert.ok(!/--ss-blue|0176d3|3064 ?85|rgb\(48/.test(grey.value),
        'the card button must not resolve to blue: ' + grey.selector + ' -> ' + grey.value);
    assert.ok(/ss-btn-quiet/.test(grey.selector),
        'and the winning rule must be the quiet one, not something that happens to ' +
        'be grey for another reason: ' + grey.selector);

    /* Grey, and light enough to recede - #f1f5f9 not #64748b. */
    const rgb = /^#([0-9a-f]{6})$/i.exec(grey.value);
    assert.ok(rgb, 'a flat hex, so this can be checked: ' + grey.value);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(rgb[1].substr(i, 2), 16));
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 24,
        'grey means the channels are close, not a tinted blue: ' + grey.value);
    assert.ok(r > 200 && g > 200 && b > 200,
        'and light, or it is a dark button drawing more attention than the blue did');

    /* Text has to survive the change of ground. White on #f1f5f9 is unreadable,
     * and the base rule sets color: #ffffff !important. */
    const ink = winner('color', quiet);
    assert.ok(/ss-btn-quiet/.test(ink.selector),
        'the label colour must be overridden too, or white text lands on light grey: ' +
        ink.selector + ' -> ' + ink.value);
    const ic = /^#([0-9a-f]{6})$/i.exec(ink.value);
    assert.ok(ic && parseInt(ic[1].substr(0, 2), 16) < 120,
        'and it is dark ink: ' + ink.value);

    /* ------------------------------------------------------------------ */
    /* Applied to the two cards, and only to them                          */
    /* ------------------------------------------------------------------ */

    /*
     * The Watching and package.xml cards are gone - their counts are in the
     * footer now and their actions were always on the pages behind them. The
     * treatment moved with the reasoning: Data JSON export is the rail card
     * that is left, and a solid blue fill there competes with the record list
     * exactly as it did in the other two.
     */
    const cardButtons = [
        /*
         * datajson was here. The card is gone: its download is a footer
         * chip now, which is not a card button and has its own check in
         * tests/data_selection.test.js.
         */
    ];
    for (const [card, handler] of cardButtons) {
        const start = view.indexOf('this.' + card + ' =');
        assert.notStrictEqual(start, -1, 'no template ' + card);
        const segment = view.slice(start, view.indexOf('\nthis.', start + 10));
        const button = new RegExp('<button[^>]*' + handler + '\\([^>]*>').exec(segment);
        assert.ok(button, handler + ' button missing from ' + card);
        assert.ok(/ss-btn-quiet/.test(button[0]),
            handler + ' must be quiet - it is one of the two cards the request named');
        assert.ok(!/style="[^"]*background/.test(button[0]),
            handler + ' must not carry an inline background as well: two colours in ' +
            'two places is how the next person changes the wrong one');
    }

    /*
     * The class is shared. Greying it everywhere would have taken the primary
     * action on the panel body with it.
     */
    const bodyButton = /<button[^>]*getChangeUserObj\(\)[^>]*>/.exec(view);
    assert.ok(bodyButton, 'the View as different user button must still exist');
    assert.ok(!/ss-btn-quiet/.test(bodyButton[0]),
        'a button outside the sidebar cards stays blue');

    console.log('quiet card button test passed');
}

main();
