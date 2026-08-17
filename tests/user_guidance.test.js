/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The three places the panel explains itself.
 *
 * Each exists because something the app already knew was stated where it was
 * true rather than where it mattered:
 *
 *   1. A manifest built from the first 200 of 3,500 classes looked complete
 *      in a text editor, in a pull request, and in whatever deployed it a week
 *      later. The list header said "200 of 3,512"; the file said nothing.
 *
 *   2. All nineteen metadata entries carry a description, and the templates
 *      rendered it once - as a hover tooltip on a heading, which nobody
 *      hovers. Meanwhile every list showed the same generic subtitle.
 *
 *   3. Four different situations arrived as the same blank table: the org has
 *      none, a filter hid them, the response reported a total and sent no
 *      rows, or the columns cannot be read. Only the last explained itself.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const container = fs.readFileSync('./js/angular/services/MetaDataContainer.js', 'utf8');
const dynamic = fs.readFileSync('./js/angular/services/DynamicMetadataService.js', 'utf8');

function lift(source, signature) {
    const start = source.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0, i = source.indexOf('{', start);
    for (; i < source.length; i++) {
        if (source[i] === '{') { depth++; }
        else if (source[i] === '}') { depth--; if (depth === 0) { return source.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

function main() {

    /* ------------------------------------------------------------------ */
    /* 1. The caveat travels with the file                                 */
    /* ------------------------------------------------------------------ */

    const provenance = (scope) => {
        const $scope = Object.assign({ selectedMetadata: { label: 'Apex Classes' } }, scope);
        return new Function('$scope',
            lift(controller, 'function manifestProvenance(){') + '\nreturn manifestProvenance;')($scope)();
    };

    const truncated = provenance({
        totalSize_AllMetaDataRecords: 200, orgTotalRecords: 3512,
        managedSummary: { count: 12, namespaces: ['npsp', 'FSL'] }
    });
    assert.strictEqual(truncated.length, 2, 'both limits are disclosed');
    assert.ok(/200 Apex Classes on screen; the org has 3512/.test(truncated[0]),
        'the manifest says what it was selected from: ' + truncated[0]);
    assert.ok(/12 managed-package components \(npsp, FSL\)/.test(truncated[1]),
        'and what could not be retrieved: ' + truncated[1]);

    /* Silence when there is nothing to disclose - a note on every file is noise. */
    assert.deepStrictEqual(
        provenance({ totalSize_AllMetaDataRecords: 47, orgTotalRecords: 47, managedSummary: { count: 0 } }),
        [], 'a complete selection says nothing');

    /*
     * Not knowing is not the same as knowing. When the COUNT query was refused
     * there is no comparison to make, and inventing one would be worse than
     * saying nothing.
     */
    assert.deepStrictEqual(
        provenance({ totalSize_AllMetaDataRecords: 200, orgTotalRecords: null, managedSummary: { count: 0 } }),
        [], 'an unknown org total is not reported as a limit');

    const single = provenance({
        totalSize_AllMetaDataRecords: 5, orgTotalRecords: 5, managedSummary: { count: 1, namespaces: ['npsp'] }
    });
    assert.ok(/1 managed-package component .* is not included/.test(single[0]),
        'and it reads as English for one: ' + single[0]);

    /* It has to reach the file, as a comment every parser ignores. */
    const builder = lift(controller, 'function buildPkgXmlString(apiVersion){');
    assert.ok(/manifestProvenance\(\)/.test(builder),
        'the builder must emit it, or the disclosure never leaves the screen');
    assert.ok(/<!-- /.test(builder), 'as an XML comment');
    assert.ok(builder.indexOf('manifestProvenance()') < builder.indexOf('<Package'),
        'before the root element, where a comment is legal');

    /* ------------------------------------------------------------------ */
    /* 2. The type says what it is                                         */
    /* ------------------------------------------------------------------ */

    const described = [...container.matchAll(/tooltipMessage:\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(described.length >= 15, 'every system entry carries a description');

    /*
     * A description that names the click is not a description. These were the
     * actual strings - "Open home page" on Recently Viewed was also simply
     * wrong about what the entry does.
     */
    for (const weak of ['View Package.xml', 'Open home page', 'Simplified Launcher Color']) {
        assert.ok(!described.includes(weak),
            'a description that restates the button teaches nothing: "' + weak + '"');
    }

    /*
     * Matched with a closing quote, not as a substring: renaming the class to
     * ss-header-desc-gone still contains "ss-header-desc", so a loose test
     * passes while nothing renders.
     */
    assert.ok(/class="ss-header-desc"/.test(view),
        'and it is on screen, not only in a tooltip nobody hovers');
    assert.ok(/\.ss-header-desc\s*\{/.test(fs.readFileSync('./css/styles.css', 'utf8')),
        'with a rule of its own, or it renders as unstyled text');
    assert.ok(/ng-show="selectedMetadata\.tooltipMessage"/.test(view),
        'shown only when there is one');

    /* Objects discovered at runtime describe themselves from the describe. */
    const dynamicDesc = /tooltipMessage: \(function\(\)\{[\s\S]*?\}\)\(\)/.exec(dynamic);
    assert.ok(dynamicDesc, 'dynamic types build a description rather than carrying a fixed one');
    const makeDesc = new Function('name', 'isCustom', 'isDeployableMetadata',
        'return (' + dynamicDesc[0].replace('tooltipMessage: ', '') + ')');

    assert.ok(/Standard object in this org/.test(makeDesc('Account', false, false)));
    assert.ok(/Can be selected for package\.xml/.test(makeDesc('ApexClass', false, true)),
        'a deployable type says it can go in a manifest');
    assert.ok(/not part of a package\.xml/.test(makeDesc('Account', false, false)),
        'and a data object says it cannot');
    assert.ok(/from the npsp package/.test(makeDesc('npsp__Grant__c', true, false)),
        'a managed object names its package: ' + makeDesc('npsp__Grant__c', true, false));
    assert.ok(!/from the .* package/.test(makeDesc('Invoice__c', true, false)),
        'while an ordinary custom object is not mistaken for one');


    /* ------------------------------------------------------------------ */
    /* Said once, and only where it is a question                          */
    /*                                                                     */
    /* "Not a deployable component type, so these cannot be added to        */
    /* package.xml" was its own line under the heading. It predates the      */
    /* type description above, which now says the same thing for every list  */
    /* where the question arises - so on a metadata list it appeared twice,  */
    /* and on View As, Recently viewed and Debug logs it appeared at all,     */
    /* under a heading about looking at the org as another user.             */
    /* ------------------------------------------------------------------ */

    assert.ok(!/Not a deployable component type/.test(view),
        'the standalone note is gone - the description carries it');
    assert.ok(!/ss-not-packageable/.test(view + fs.readFileSync('./css/styles.css', 'utf8')),
        'and so are its markup and its rule, rather than left as dead code');

    /*
     * But the fact itself must survive, or removing the note loses what it was
     * for: a list with no tick column and no explanation reads as a bug.
     */
    assert.ok(/not part of a package\.xml/.test(makeDesc('FlowVersionView', false, false)),
        'a non-packageable type still says so: ' + makeDesc('FlowVersionView', false, false));
    assert.ok(/Can be selected for package\.xml/.test(makeDesc('ApexClass', false, true)),
        'and a packageable one still says that');

    /* The three utility pages say what they are and nothing about packaging. */
    const container2 = fs.readFileSync('./js/angular/services/MetaDataContainer.js', 'utf8');
    for (const label of ['View As', 'Recently viewed', 'Debug logs']) {
        const at = container2.indexOf('label: "' + label + '"');
        assert.notStrictEqual(at, -1, 'no entry for ' + label);
        const tip = /tooltipMessage:\s*"([^"]*)"/.exec(container2.slice(at, at + 400));
        assert.ok(tip, label + ' must still describe itself');
        assert.ok(!/package\.xml/i.test(tip[1]),
            label + ' is not a component list; packaging is not a question it raises: ' + tip[1]);
    }

    /* ------------------------------------------------------------------ */
    /* 3. Which kind of empty                                              */
    /* ------------------------------------------------------------------ */

    const why = (scope, context) => {
        const $scope = Object.assign({ AllMetaDataRecords: [], records: [] }, scope);
        return new Function('$scope',
            lift(controller, '$scope.emptyListReason = function(context){') +
            ';return $scope.emptyListReason;')($scope)(context) || '';
    };
    const namespaces = [{ key: 'npsp' }, { key: '__unmanaged__' }];

    assert.ok(/none were returned/.test(why({ orgTotalRecords: 79 }, 'all')),
        'a total with no rows is named - it is the one that reads as a bug');
    assert.ok(/Nothing matches "billing"/.test(why({ searchAllMetaData: 'billing' }, 'all')),
        'a search that excluded everything says so');
    assert.ok(/namespaces you have unticked/.test(
        why({ availableNamespaces: namespaces, selectedNamespaces: { npsp: false } }, 'all')),
        'and so does a namespace filter');

    /* Quiet when it cannot tell, or when something else is already talking. */
    assert.strictEqual(why({}, 'all'), '',
        'genuinely empty says nothing extra - the type\'s own message covers it');
    /*
     * Rows present *and* a search active. Without the early return the search
     * branch fires and a full list is captioned "Nothing matches" - and a
     * fixture with rows but no search cannot see that, because every branch
     * falls through to silence anyway.
     */
    assert.strictEqual(why({ AllMetaDataRecords: [{ Id: 1 }], searchAllMetaData: 'billing' }, 'all'), '',
        'a list that has rows is never explained, whatever filters are set');
    assert.strictEqual(why({ AllMetaDataRecords: [{ Id: 1 }] }, 'all'), '',
        'nor a list with rows and no filters');
    assert.strictEqual(why({ showErrorMessage: true, orgTotalRecords: 79 }, 'all'), '',
        'a refusal already explains itself, and two explanations are worse than one');
    assert.strictEqual(
        why({ availableNamespaces: namespaces, selectedNamespaces: { npsp: true, __unmanaged__: true } }, 'all'), '',
        'namespaces that are all ticked are not blamed');

    assert.ok(/emptyListReason\(/.test(view), 'and the reason is rendered');


    /* ------------------------------------------------------------------ */
    /* The empty state belongs to a record list                            */
    /*                                                                     */
    /* That div is inside the shared body, so it renders on utility pages   */
    /* too - Field Access, Watching List, Trust Status. It always did; it   */
    /* was invisible only because its content was an undefined message.     */
    /* Adding the reason line gave it text, and a page with no list at all  */
    /* announced that its rows were hidden by a namespace filter.           */
    /* ------------------------------------------------------------------ */

    const emptyState = /<div class="ss-empty-state" ng-if="([^"]*)"/.exec(view);
    assert.ok(emptyState, 'the empty state must still exist');
    assert.ok(/selectedMetadata\.isSearchable/.test(emptyState[1]),
        'gated on being a record list, or it speaks on pages that have no rows ' +
        'to explain: ' + emptyState[1]);

    /* ------------------------------------------------------------------ */
    /* And a page does not repeat the heading drawn above it               */
    /*                                                                     */
    /* Surfacing the type description under the title gave every page that  */
    /* draws its own header two titles and two descriptions.                */
    /* ------------------------------------------------------------------ */

    for (const page of ['watchinglist']) {
        const start = view.indexOf('this.' + page + ' =');
        assert.notStrictEqual(start, -1, 'no template ' + page);
        const segment = view.slice(start, view.indexOf('\nthis.', start + 10));
        assert.ok(!/<h2/.test(segment),
            page + ' must not draw its own heading - the shared header already ' +
            'shows the label and the description above it');
    }

    console.log('user guidance test passed');
}

main();
