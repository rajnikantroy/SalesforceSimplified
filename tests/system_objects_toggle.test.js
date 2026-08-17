/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * "Show All System Objects" belongs to Data.
 *
 * System objects are data objects: with Data unticked, this offered to reveal
 * more of a list that was not being shown. A control whose effect cannot be
 * seen reads as one that does not work.
 *
 * Hiding it is only half of it. A ticked box that is merely hidden keeps
 * filtering the menu with nothing on screen saying so, and comes back ticked
 * the next time Data is turned on - from a decision the user can no longer
 * remember making.
 */

const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

function lift(signature) {
    const start = controller.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0;
    for (let i = controller.indexOf('{', start); i < controller.length; i++) {
        if (controller[i] === '{') { depth++; }
        else if (controller[i] === '}') { depth--; if (depth === 0) { return controller.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

function main() {

    /* ------------------------------------------------------------------ */
    /* Shown only with Data                                                */
    /* ------------------------------------------------------------------ */

    const row = /<div class="ss-sys-objects-row"([^>]*)>'\+\n'<label[^>]*><input type="checkbox" ng-model="showAllSystemObjects"/
        .exec(view);
    assert.ok(row, 'the system-objects row must still exist and hold that checkbox');

    const gate = /ng-show="([^"]*)"/.exec(row[1]);
    assert.ok(gate, 'and be gated: ' + row[1]);

    const shows = (state) => new Function('s',
        'with (s) { return !!(' + gate[1] + '); }')(new Proxy(state, {
            has: () => true, get: (t, k) => t[k]
        }));

    assert.ok(shows({ Admin: true }), 'with Data on, it is offered');
    assert.ok(!shows({ Admin: false }), 'with Data off, it is not');
    assert.ok(!shows({}), 'and not before Data has been decided either');

    /*
     * Data, not Metadata. They are separate switches and the system objects
     * are on the data side; gating on the wrong one would hide it exactly
     * when it is wanted.
     */
    assert.ok(!shows({ Developer: true }), 'Metadata alone does not bring it back');
    assert.ok(shows({ Admin: true, Developer: false }), 'and Data alone is enough');

    /* ------------------------------------------------------------------ */
    /* And cleared when Data goes off                                      */
    /* ------------------------------------------------------------------ */

    const extend = lift('$scope.extendMenu = function(){');
    assert.ok(/if\(!\$scope\.Admin\)\{ \$scope\.showAllSystemObjects = false; \}/.test(extend),
        'turning Data off must clear it, not merely hide it');

    const clearAt = extend.indexOf('$scope.showAllSystemObjects = false');
    const saveAt = extend.indexOf("setSimplifiedCookie('Simplified_ShowAllSystemObjects'");
    assert.notStrictEqual(clearAt, -1);
    assert.notStrictEqual(saveAt, -1);
    assert.ok(clearAt < saveAt,
        'and cleared before the preference is written, or the old value is saved ' +
        'and comes back next session');

    const rebuildAt = extend.indexOf('populateMenus');
    assert.ok(clearAt < rebuildAt,
        'and before the menu is rebuilt, or the menu is built from the value ' +
        'that was just abandoned');

    /* Run it, rather than trust the order by eye. */
    const run = (admin, ticked) => {
        const scope = { Admin: admin, showAllSystemObjects: ticked, Developer: true, Vlocity: false };
        const saved = {};
        scope.setSimplifiedCookie = (key, value) => { saved[key] = value; };
        new Function('$scope', extend + ';$scope.extendMenu();')(scope);
        return { scope, saved };
    };

    const off = run(false, true);
    assert.strictEqual(off.scope.showAllSystemObjects, false,
        'Data off clears the flag itself');
    assert.strictEqual(off.saved.Simplified_ShowAllSystemObjects, false,
        'and what is written down agrees with it');

    const on = run(true, true);
    assert.strictEqual(on.scope.showAllSystemObjects, true,
        'while Data on leaves a ticked box alone');
    assert.strictEqual(on.saved.Simplified_ShowAllSystemObjects, true);

    /* ------------------------------------------------------------------ */
    /* The preference is read back at all                                  */
    /*                                                                     */
    /* It had been written since it was added and never restored, so the    */
    /* box came up unticked every session however it had been left.         */
    /* ------------------------------------------------------------------ */

    assert.ok(/readCookie\('Simplified_ShowAllSystemObjects'\)/.test(controller),
        'the preference must be read, not only written');

    /*
     * The assignment that reads the cookie, not merely the first one - the
     * clear inside extendMenu is also an assignment to this property. [^;]
     * rather than a lazy [\\s\\S]: the lazy form still started at the clear and
     * ran past the semicolon to find a readCookie in some later statement.
     */
    const restore = /\$scope\.showAllSystemObjects = ([^;]*readCookie[^;]*);/.exec(controller);
    assert.ok(restore, 'and assigned from it');
    assert.ok(/=== "true"/.test(restore[1]),
        'compared against the string a cookie holds: ' + restore[1]);
    assert.ok(/\$scope\.Admin &&/.test(restore[1]),
        'and only when Data is on - restoring it under a hidden checkbox would ' +
        'filter the menu with nothing on screen saying why: ' + restore[1]);

    /* Written and read under one name. */
    const written = (controller.match(/Simplified_ShowAllSystemObjects/g) || []).length;
    assert.strictEqual(written, 2, 'one write, one read, same spelling - found ' + written);

    console.log('system objects toggle test passed');
}

main();
