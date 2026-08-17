/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * A component name cannot widen the table without limit.
 *
 * The name cell carried .trim-info-content, which looked like truncation - it
 * has overflow:hidden, text-overflow:ellipsis and white-space:nowrap - but its
 * ceiling was max-width: 100%. That bounds the text to a cell that grows to
 * fit the text, so it never truncated anything. A long API name
 * (MyObject__c.Some_Very_Long_Field_Name__c, or a namespaced managed-package
 * member) stretched the row past the window and took the whole grid with it.
 *
 * The fix is a ceiling in ch - the width of a "0" in the current font - so the
 * limit is about forty-five characters whatever the user has zoomed to, rather
 * than a pixel count that means different things at different sizes.
 *
 * The trap this guards is specific: a rule can carry every truncation property
 * and still truncate nothing, and it reads as correct in the stylesheet.
 */

const css = fs.readFileSync('./css/styles.css', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');

function ruleFor(selector) {
    const at = css.indexOf(selector);
    assert.notStrictEqual(at, -1, 'no rule for ' + selector);
    return css.slice(at, css.indexOf('}', at) + 1);
}

function main() {

    /* ------------------------------------------------------------------ */
    /* The ceiling is a real one                                           */
    /* ------------------------------------------------------------------ */

    const trim = ruleFor('.trim-info-content{');

    const maxWidth = /max-width:\s*([^;]+);/.exec(trim);
    assert.ok(maxWidth, '.trim-info-content must set a max-width');

    assert.ok(!/^\s*100%/.test(maxWidth[1]),
        'max-width: 100% bounds the name to a cell that grows to fit it, so it ' +
        'truncates nothing - which is exactly how this looked correct while the ' +
        'table ran off the screen');

    const chLimit = /(\d+)ch/.exec(maxWidth[1]);
    assert.ok(chLimit,
        'the ceiling should be in ch so it means the same number of characters at ' +
        'any zoom level, got: ' + maxWidth[1]);

    const characters = Number(chLimit[1]);
    // 30-50 is the stated intent: long enough to read a component name,
    // short enough that one long API name cannot set the table width.
    assert.ok(characters >= 30 && characters <= 50,
        'a name column of ' + characters + ' characters is outside the range that ' +
        'keeps the grid on screen while still showing a usable name');

    /* The properties that make a ceiling actually cut text. */
    for (const property of ['overflow', 'text-overflow', 'white-space']) {
        assert.ok(new RegExp(property + ':').test(trim),
            '.trim-info-content needs ' + property + ' or the ceiling only clips, ' +
            'it does not ellipsise');
    }

    /* ------------------------------------------------------------------ */
    /* Every cell that shows a name uses it                                */
    /*                                                                     */
    /* A label cell added later without a capped class reintroduces the     */
    /* whole problem for that one metadata type, and nothing else notices.  */
    /* ------------------------------------------------------------------ */

    const capped = new Set();
    for (const match of css.matchAll(/\.([a-z0-9-]+)\s*\{[^}]*max-width[^}]*\}/gi)) {
        capped.add(match[1]);
    }
    assert.ok(capped.size > 3, 'expected several capped classes, found ' + capped.size);

    for (const template of ['allrecords', 'usersrecords']) {
        const start = view.indexOf('this.' + template + ' =');
        const segment = view.slice(start, view.indexOf('\nthis.', start + 10));
        const rowAt = segment.indexOf('<tr ng-repeat="r in');
        const rowEnd = segment.indexOf("'   </tr>'", rowAt);
        const row = segment.slice(rowAt, rowEnd);

        /*
         * The cells that render a record's own label. Not every cell - the
         * timestamp column beside a debug log is fixed width by its content
         * and needs no ceiling.
         */
        const NAME_FIELDS = ['r.Name', 'r.MasterLabel', 'r.DeveloperName', 'r._ssLabel',
                             'r.CaseNumber', 'r.ContractNumber', 'r.OrderNumber'];

        for (const field of NAME_FIELDS) {
            const cellAt = row.indexOf('ng-if="' + field);
            if (cellAt === -1) { continue; }
            const cell = row.slice(cellAt, row.indexOf('</td>', cellAt) + 5);

            const classes = [...cell.matchAll(/[Cc]lass=\\?"([^"\\]*)\\?"/g)]
                .flatMap((m) => m[1].split(/\s+/)).filter(Boolean);

            assert.ok(classes.some((name) => capped.has(name)),
                template + ': the cell for ' + field + ' has no width-capped class (' +
                (classes.join(' ') || 'no classes') + '), so a long name there widens ' +
                'the whole table');
        }
    }


    /* ------------------------------------------------------------------ */
    /* The cut is a character count, not a width                           */
    /*                                                                     */
    /* A ch ceiling is the width of a "0", and in a proportional font       */
    /* nearly every letter is narrower - 45ch showed 57 characters, and the */
    /* count drifted with the content, since iiiii and WWWWW are not the    */
    /* same width. limitTo counts characters, so 30 means 30 whatever the   */
    /* name is.                                                             */
    /*                                                                     */
    /* This applies to every metadata list, not one type: the fallback      */
    /* binding - the cell used by every object with no Name, MasterLabel or */
    /* DeveloperName - renders a compound expression and was missed by a    */
    /* first pass that only matched plain {{r.Field}} tokens.               */
    /* ------------------------------------------------------------------ */

    const NAME_BINDING = /r\.(Name|MasterLabel|DeveloperName|_ssLabel|CaseNumber|ContractNumber|OrderNumber)/;
    let limitedCount = 0;

    for (const template of ['allrecords', 'usersrecords']) {
        const start = view.indexOf('this.' + template + ' =');
        const segment = view.slice(start, view.indexOf('\nthis.', start + 10));
        const rowAt = segment.indexOf('<tr ng-repeat="r in');
        const rowEnd = segment.indexOf("'   </tr>'", rowAt);
        const row = segment.slice(rowAt, rowEnd);

        const unlimited = [];
        for (const binding of row.matchAll(/\{\{([^}]+)\}\}/g)) {
            const at = binding.index;
            // Attribute values - the tooltips - keep the whole name on purpose.
            if (row.lastIndexOf('>', at) <= row.lastIndexOf('<', at)) { continue; }
            const expression = binding[1];
            if (!NAME_BINDING.test(expression)) { continue; }
            if (/\.length >/.test(expression)) { continue; }   // the ellipsis half

            if (/limitTo:\d+/.test(expression)) { limitedCount++; }
            else { unlimited.push(template + ': {{' + expression.slice(0, 70) + '}}'); }
        }

        assert.deepStrictEqual(unlimited, [],
            'these render a component name with no character limit, so one long ' +
            'API name sets the width of the whole grid:\n  ' + unlimited.join('\n  '));
    }

    assert.ok(limitedCount >= 12,
        'expected every name binding in both grids to be limited, found only ' +
        limitedCount + ' - a scan that matches nothing passes for the wrong reason');

    /* The cut and the CSS backstop must agree on the number. */
    const cut = /limitTo:(\d+)/.exec(view);
    assert.ok(cut, 'no limitTo in the templates at all');
    assert.strictEqual(Number(cut[1]), characters,
        'the character cut (' + cut[1] + ') and the CSS ceiling (' + characters +
        'ch) should be the same number, or one of them is doing nothing');

    /* Truncated names still carry the full value somewhere reachable. */
    for (const template of ['allrecords', 'usersrecords']) {
        const start = view.indexOf('this.' + template + ' =');
        const segment = view.slice(start, view.indexOf('\nthis.', start + 10));
        assert.ok(/data-title="\{\{r\.[A-Za-z_]+\}\}"/.test(segment),
            template + ' must keep an untruncated tooltip - the name is cut on screen ' +
            'and there has to be a way to read the rest');

        /*
         * And none of them may be cut. Asserting only that a full tooltip
         * exists is not enough: truncate one and the others still match, so
         * the row whose name was shortened loses the only way to read it.
         */
        const cutTooltips = [...segment.matchAll(/(?:data-)?title="\{\{([^}"]*limitTo[^}"]*)\}\}"/g)]
            .map((m) => m[1]);
        assert.deepStrictEqual(cutTooltips, [],
            template + ': a tooltip is truncated, which leaves no way to read the full ' +
            'name of the row it belongs to: ' + cutTooltips.join(', '));
    }

    console.log('name column width test passed (' + characters + 'ch ceiling)');
}

main();
