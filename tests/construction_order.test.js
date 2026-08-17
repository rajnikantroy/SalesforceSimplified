/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Nothing the controller runs while it is being built may call a function that
 * does not exist yet.
 *
 * "$scope.x = function(){}" is an assignment, not a declaration: it exists
 * only once execution reaches that line. A function declaration hoists, so it
 * exists from the first statement. Mixing the two is invisible until the wrong
 * one is called early, and then it is not a small failure - the controller
 * throws mid-construction, Angular abandons it, and the whole panel comes up
 * blank with one TypeError in the console:
 *
 *   TypeError: $scope.loadBookmarkHistory is not a function
 *
 * That shipped. refreshBookmarkState runs during construction and had been
 * given a call to $scope.loadBookmarkHistory, which is assigned three hundred
 * lines further down. It only fired when the audit-trail preference was
 * already on, so it was invisible in any session that had never switched it
 * on - including every harness run.
 *
 * The rule enforced here: anything reached from controller construction must
 * already exist when construction runs - functions must be declarations, and
 * module state must be declared above the code that reads it.
 *
 * The second half was added after the first missed a repeat of the same fault
 * in state rather than in a function:
 *
 *   TypeError: Cannot read properties of undefined (reading 'has')
 *
 * historyFetchedKeys was declared two hundred lines below the construction
 * call that reads it. var hoists as undefined, so .has threw and the panel
 * went blank exactly as before. A guard that only understood functions had
 * nothing to say about it.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

/*
 * Statements at the controller's own level - what runs on construction, and
 * where.
 *
 * The position is the earliest such call, because that is the moment the
 * function first runs. Taking the last one lets an early call be judged
 * against a late one and reported safe: the exact hole that let a real
 * offence through when this check first grew an order test.
 */
function topLevelCalls(source) {
    const first = new Map();
    const pattern = /^ {4}([A-Za-z_$][\w$]*)\(\);?$/gm;
    for (const match of source.matchAll(pattern)) {
        let depth = 0;
        for (const ch of source.slice(0, match.index)) {
            if (ch === '{') { depth++; }
            else if (ch === '}') { depth--; }
        }
        if (depth !== 1) { continue; }
        if (!first.has(match[1])) { first.set(match[1], match.index); }
    }
    return first;
}

/*
 * Comments are not code.
 *
 * A body explaining "packageIsReady() reads the summary" was read as a call
 * to packageIsReady, and reported as a construction-order fault that does not
 * exist. Prose about a function is not an invocation of it.
 */
function withoutComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function bodyOf(source, name) {
    const start = source.indexOf('function ' + name + '(');
    if (start === -1) { return null; }
    let depth = 0, i = source.indexOf('{', start);
    for (; i < source.length; i++) {
        if (source[i] === '{') { depth++; }
        else if (source[i] === '}') { depth--; if (depth === 0) { return source.slice(start, i + 1); } }
    }
    return null;
}

function main() {

    /* Every name assigned as an expression - these do not hoist. */
    const assigned = new Set(
        [...controller.matchAll(/\$scope\.([A-Za-z_$][\w$]*)\s*=\s*function/g)].map((m) => m[1]));
    assert.ok(assigned.size > 20,
        'expected many $scope function expressions, found ' + assigned.size +
        ' - if this stops matching, the check below silently verifies nothing');

    /*
     * Where each assignment happens, so the check can tell "not yet" from
     * "already". A function assigned above the construction call that reaches
     * it does exist by then; the rule is about order, and ignoring order made
     * it report safe code.
     */
    const assignedAt = {};
    [...controller.matchAll(/\$scope\.([A-Za-z_$][\w$]*)\s*=\s*function/g)]
        .forEach((m) => {
            if (assignedAt[m[1]] === undefined) { assignedAt[m[1]] = m.index; }
        });

    const runOnConstruction = topLevelCalls(controller);
    assert.ok(runOnConstruction.size >= 3,
        'expected several functions to run during construction, found ' +
        runOnConstruction.size);

    /*
     * One level of indirection, which is where the real one hid: the top-level
     * call was to refreshBookmarkState, and the missing function was called
     * from inside it.
     */
    const offences = [];
    for (const [name, callAt] of runOnConstruction) {
        const body = bodyOf(controller, name);
        if (!body) {
            offences.push(name + ' runs on construction but is not a function declaration');
            continue;
        }

        const code = withoutComments(body);
        for (const called of assigned) {
            const direct = new RegExp('(?<![.\\w$])' + called + '\\s*\\(');
            const viaScope = new RegExp('\\$scope\\.' + called + '\\s*\\(');

            /* Assigned before the call that reaches it: it exists by then. */
            if (assignedAt[called] !== undefined && assignedAt[called] < callAt) { continue; }

            if (direct.test(code) || viaScope.test(code)) {
                offences.push(name + '() runs during construction and calls ' + called +
                              '(), which is assigned as $scope.' + called +
                              ' = function - not hoisted, so it is undefined at that moment');
            }
        }
    }

    assert.deepStrictEqual(offences, [],
        'these calls throw while the controller is being built, which blanks the ' +
        'whole panel:\n  ' + offences.join('\n  '));

    /*
     * And the two that actually broke stay declarations. Naming them keeps the
     * regression pinned even if the scan above is ever loosened.
     */
    for (const name of ['loadBookmarkHistory', 'checkBookmarks']) {
        assert.ok(bodyOf(controller, name),
            name + ' must be a function declaration - it is reached from ' +
            'construction and from the template both');
        assert.ok(controller.includes('$scope.' + name + ' = ' + name + ';'),
            name + ' must still be exposed on $scope for the template to call');
        assert.ok(!new RegExp('\\$scope\\.' + name + '\\s*=\\s*function').test(controller),
            name + ' must not go back to an assigned expression');
    }


    /* ------------------------------------------------------------------ */
    /* State read during construction is declared before it                */
    /*                                                                     */
    /* var hoists as undefined, so a Set or Map declared below the code     */
    /* that reads it is not a missing value - it is undefined, and the      */
    /* first .has or .get on it throws.                                     */
    /* ------------------------------------------------------------------ */

    // Module state that construction-time code cannot do without.
    const stateDecls = [...controller.matchAll(/^ {4}var ([A-Za-z_$][\w$]*)\s*=\s*(new (?:Set|Map)\(|\[|null|\{)/gm)]
        .map((m) => ({ name: m[1], at: m.index }));
    assert.ok(stateDecls.length > 3,
        'expected several module-level state declarations, found ' + stateDecls.length);

    const stateAt = new Map(stateDecls.map((d) => [d.name, d.at]));

    const lateReads = [];
    for (const name of runOnConstruction) {
        const start = controller.indexOf('function ' + name + '(');
        const body = bodyOf(controller, name);
        if (!body) { continue; }

        for (const [state, declaredAt] of stateAt) {
            // Read as a property, which is what throws on undefined.
            if (!new RegExp('(?<![.\\w$])' + state + '\\s*\\.').test(body)) { continue; }
            if (declaredAt > start) {
                lateReads.push(name + '() runs during construction and reads ' + state +
                               ', which is declared after it - var hoists as undefined, ' +
                               'so the first property access on it throws');
            }
        }
    }

    assert.deepStrictEqual(lateReads, [],
        'these read state that does not exist yet when the controller is built:\n  ' +
        lateReads.join('\n  '));

    /* The three that actually broke stay above the construction call. */
    const constructionCall = controller.indexOf('\n    refreshBookmarkState();');
    assert.notStrictEqual(constructionCall, -1, 'refreshBookmarkState must still run on construction');
    for (const name of ['historyFetchedFor', 'historyRaw', 'historyFetchedKeys']) {
        const at = stateAt.get(name);
        assert.ok(typeof at === 'number', name + ' must be declared as module state');
        assert.ok(at < constructionCall,
            name + ' must be declared before refreshBookmarkState() runs, or reading it ' +
            'during construction throws on undefined');
    }

    console.log('construction order test passed (' + runOnConstruction.size +
        ' functions run on construction, ' + assigned.size + ' scope expressions checked)');
}

main();
