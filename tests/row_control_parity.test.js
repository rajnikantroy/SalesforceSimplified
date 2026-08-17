/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The two record lists carry the same per-row controls.
 *
 * A metadata type is shown twice on the same screen: "My <type>" from the
 * records the current user touched, and "All <type>" from the org. They are
 * two templates over the same rows, so a control added to one and forgotten
 * in the other does not look like a bug - it looks like that row not
 * supporting the feature. The bookmark star shipped in the All list only, and
 * read exactly that way: starrable in one list, apparently not in the other,
 * for the very same component.
 *
 * Rather than listing the controls that must exist - a list that goes stale
 * the moment someone adds the next one - this derives them. Every per-row
 * control in these templates is a <td class="SimplifiedAction">, so the set of
 * conditions guarding those cells is the set of controls, and the two lists
 * must agree. A control added to one template alone fails here without anyone
 * remembering to add it to a table.
 */

const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');

function templateOf(name) {
    const start = view.indexOf('this.' + name + ' =');
    assert.notStrictEqual(start, -1, 'could not find template ' + name);
    const end = view.indexOf('\nthis.', start + 10);
    assert.notStrictEqual(end, -1, 'could not find the end of ' + name);
    return view.slice(start, end);
}

/*
 * The conditions guarding each action cell.
 *
 * These templates are JavaScript string literals holding escaped quotes, so a
 * [^"]* run stops at the first \" and silently captures a fragment - which is
 * how an earlier test in this project matched nothing and passed. The value is
 * therefore read to the closing quote that is not escaped.
 */
function actionControls(template) {
    const found = new Set();
    // Attribute order varies between these cells - some declare class first,
    // some ng-if first - so the tag is matched whole and its attributes read
    // out afterwards, rather than assuming an order that happens to hold today.
    for (const tag of template.matchAll(/<td\s([^>]*)>/g)) {
        const attributes = tag[1];
        if (!/class="[^"]*SimplifiedAction/.test(attributes)) { continue; }
        const condition = attributes.match(/ng-if="((?:\\.|[^"\\])*)"/);
        if (condition) { found.add(condition[1].replace(/\s+/g, ' ').trim()); }
    }
    return found;
}

function main() {
    const myView = templateOf('usersrecords');
    const allRecords = templateOf('allrecords');

    const mine = actionControls(myView);
    const all = actionControls(allRecords);

    // If the extraction ever matches nothing, two empty sets are equal and
    // this passes while checking nothing at all.
    assert.ok(mine.size >= 3,
        'expected several per-row controls in the My view list, found ' + mine.size +
        ' - an extraction that matches nothing looks exactly like a pass');
    assert.ok(all.size >= 3,
        'expected several per-row controls in the All list, found ' + all.size);

    const missingFromMine = [...all].filter((control) => !mine.has(control));
    const missingFromAll = [...mine].filter((control) => !all.has(control));

    assert.deepStrictEqual(missingFromMine, [],
        'these row controls are in the All list but not in My view, so the same ' +
        'component appears to support them in one list and not the other:\n  ' +
        missingFromMine.join('\n  '));

    assert.deepStrictEqual(missingFromAll, [],
        'these row controls are in My view but not in the All list:\n  ' +
        missingFromAll.join('\n  '));

    /*
     * Both lists reach the same watch list.
     *
     * The star's identity is the metadata type plus the row id, and both
     * templates render inside the same controller - so a component starred in
     * one list has to read as starred in the other. Rendering the star from a
     * different expression in each template is how that quietly stops being
     * true.
     */
    for (const [name, template] of [['My view', myView], ['All records', allRecords]]) {
        assert.ok(/ng-click="toggleBookmark\(r\)"/.test(template),
            name + ' must toggle the bookmark through the same handler');
        assert.ok(/isBookmarked\(r\)/.test(template),
            name + ' must read the bookmark state through the same accessor');
    }

    console.log('row control parity regression test passed (' +
        all.size + ' controls, both lists)');
}

main();
