/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The list header, on a small screen.
 *
 * Two of these stack on every metadata page - the user's records and the
 * org's - each with a title, a row of actions and a description. That is a lot
 * of furniture above four rows of data, and it was worst where there is least
 * room: every glyph carried its own inline font-size with no box to sit in, so
 * a font substitution on Windows put them on different baselines and the row
 * read as a jumble.
 */

const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const css = fs.readFileSync('./css/styles.css', 'utf8');

function rule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(css);
    return found ? found[1] : null;
}

function main() {

    /* ------------------------------------------------------------------ */
    /* Nothing in the header is sized inline any more                      */
    /* ------------------------------------------------------------------ */

    const headers = [...view.matchAll(/this\.(usersrecords|allrecords) = '([\s\S]*?)\n/g)];
    assert.strictEqual(headers.length, 2, 'both list headers must exist');

    for (const [, name, markup] of headers) {
        /*
         * A font-size in a style attribute is the fault itself: each glyph got
         * its own, so nothing shared a baseline once a font was substituted.
         */
        assert.ok(!/style="[^"]*font-size/.test(markup),
            name + ': no glyph may carry its own font-size - that is what put ' +
            'them on different baselines');
        assert.ok(!/style="[^"]*cursor:pointer[^"]*color:/.test(markup),
            name + ': and none may carry its own colour');

        assert.ok(/class="ss-record-title"/.test(markup),
            name + ': the title row is a class, not a repeated style string');
        assert.ok(/class="ss-record-actions"/.test(markup),
            name + ': and so is the action cluster');
    }

    /* Both sections say it the same way, or they are two designs. */
    assert.strictEqual((view.match(/class="ss-record-title"/g) || []).length, 2,
        'both headers use the same title row');
    assert.strictEqual((view.match(/class="ss-record-actions"/g) || []).length, 2,
        'and the same action cluster');
    assert.strictEqual((view.match(/class="ss-raw-copied"/g) || []).length, 2,
        'and the same confirmation');

    /* ------------------------------------------------------------------ */
    /* Every action sits in the same box                                   */
    /* ------------------------------------------------------------------ */

    const actions = rule('.theme-lightning .ss-record-actions .ss-raw-action,\n.theme-lightning .ss-record-actions .ss-selectall');
    assert.ok(actions, 'the actions need one shared rule');

    assert.ok(/min-height:\s*\d+px/.test(actions),
        'a fixed box, so a substituted font changes what is drawn and not where ' +
        'it sits: ' + actions.trim());
    assert.ok(/align-items:\s*center/.test(actions) && /justify-content:\s*center/.test(actions),
        'with the glyph centred in it');
    assert.ok(/font-size:\s*\d/.test(actions) && /line-height:\s*1/.test(actions),
        'one font-size and a fixed line-height for all of them');

    /*
     * The row wraps rather than overflowing. At 1280px with a long object
     * label the actions used to run off the right edge, which is exactly the
     * screen this was reported on.
     */
    const title = rule('.theme-lightning .ss-record-title');
    assert.ok(title, 'the title row needs a rule');
    assert.ok(/flex-wrap:\s*wrap/.test(title),
        'the header wraps instead of overflowing: ' + title.trim());
    assert.ok(/display:\s*flex/.test(title), 'as a flex row');

    const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(title);
    assert.ok(size && Number(size[1]) <= 16,
        'and the title is not so large that two of them fill a short screen: ' +
        (size ? size[1] : 'none') + 'px');

    /* ------------------------------------------------------------------ */
    /* The description gives way first                                     */
    /*                                                                     */
    /* It says the same thing under both lists, so on a short screen it is  */
    /* the line worth losing before the data is.                           */
    /* ------------------------------------------------------------------ */

    const description = rule('.theme-lightning .recorddescription');
    assert.ok(description, 'the description needs a rule now that it has no inline one');
    const descSize = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(description);
    assert.ok(descSize && Number(descSize[1]) < Number(size[1]),
        'quieter than the title it sits under');

    const short = /@media \(max-height: (\d+)px\) \{\s*\.theme-lightning \.recorddescription \{([^}]*)\}/
        .exec(css);
    assert.ok(short, 'a short screen must drop it');
    assert.ok(/display:\s*none/.test(short[2]),
        'entirely, rather than merely shrinking it further: ' + short[2].trim());
    assert.ok(Number(short[1]) >= 700,
        'and only when the screen is genuinely short, not on every laptop');

    console.log('record header density test passed');
}

main();
