/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The header sits over the right columns.
 *
 * The record grids had no header at all, which was fine while a row showed a
 * name and nothing else. Now each object contributes columns chosen from its
 * describe, so a row reads "62.0  Active  1843" and there is no way to tell
 * which number is which - the labels are the point of the feature.
 *
 * A label is only useful over the column it names, and the cells before the
 * described columns are conditional: a star only where rows carry ids, one
 * cell per applicable field action, two checkboxes that depend on the type,
 * and a label cell chosen from whichever field the row actually has. The
 * header spans all of that with a single colspan, so that number has to equal
 * the number of cells the body really renders.
 *
 * Nothing breaks when it drifts. The labels simply sit one column to the left
 * of what they describe, which is worse than having no header at all - so this
 * counts the body's own cells from the shipped template and compares.
 */

const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

function lift(signature) {
    const start = controller.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0, i = controller.indexOf('{', start);
    for (; i < controller.length; i++) {
        if (controller[i] === '{') { depth++; }
        else if (controller[i] === '}') { depth--; if (depth === 0) { return controller.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

/*
 * Count the cells a body row renders, by evaluating each cell's own ng-if
 * out of the template. Deliberately not a second copy of the conditions -
 * that is the thing being checked, and a copy would drift with it.
 */
function bodyCellCount(templateName, meta, row) {
    const start = view.indexOf('this.' + templateName + ' =');
    assert.notStrictEqual(start, -1, 'no template ' + templateName);
    const segment = view.slice(start, view.indexOf('\nthis.', start + 10));

    const rowAt = segment.indexOf('<tr ng-repeat="r in');
    assert.notStrictEqual(rowAt, -1, 'no body row in ' + templateName);
    // Searched from the body row, not from the start: the header row added
    // above it also ends in </tr>, and matching that one yields an empty
    // slice and a count of zero - which reads as "the body renders nothing".
    const rowEnd = segment.indexOf("'   </tr>'", rowAt);
    assert.ok(rowEnd > rowAt, 'could not bound the body row of ' + templateName);

    const cells = [...segment.slice(rowAt, rowEnd).matchAll(/<td\s([^>]*)>/g)];
    assert.ok(cells.length > 5, 'expected a good number of cells, found ' + cells.length);

    let count = 0;
    for (const cell of cells) {
        const attrs = cell[1];
        const condition = /ng-if="((?:\\.|[^"\\])*)"/.exec(attrs);
        const repeat = /ng-repeat="([^"]*)"/.exec(attrs);

        // The described columns are what the header labels, not what it spans.
        if (repeat && /_ssCols/.test(repeat[1])) { continue; }

        if (repeat && /fieldlevelactions/.test(repeat[1])) {
            (meta.fieldlevelactions || []).forEach((faction) => {
                if (faction && faction.name && (faction.actionUrl || meta.value === 'ChangeUser')) {
                    count++;
                }
            });
            continue;
        }

        if (!condition) { count++; continue; }
        const expression = condition[1].replace(/\\'/g, "'");
        const evaluate = new Function('r', 'selectedMetadata', 'canBookmark',
            'return !!(' + expression + ')');
        if (evaluate(row, meta, (rr) => !!(rr && rr.Id && meta.value))) { count++; }
    }
    return count;
}

const CASES = [
    ['an ordinary type, star and package.xml', {
        value: 'ApexClass', label: 'Apex Classes',
        eligibleForPackageXml: true, eligibleForDataDownload: false,
        fieldlevelactions: [{ name: 'view', actionUrl: '/' }, { name: 'edit', actionUrl: '/e' }]
    }, { Id: '01p1', Name: 'BillingService' }],

    ['a data object, download checkbox', {
        value: 'Account', label: 'Accounts',
        eligibleForPackageXml: false, eligibleForDataDownload: true,
        fieldlevelactions: [{ name: 'view', actionUrl: '/' }]
    }, { Id: '001x', Name: 'Acme' }],

    // A debug log spends three cells on its label block where most rows spend
    // one - the case a fixed guess at the leading width would get wrong.
    ['a debug log, three label cells', {
        value: 'ApexLog', label: 'Debug Logs',
        eligibleForPackageXml: false, eligibleForDataDownload: false,
        fieldlevelactions: [{}]
    }, { Id: '07L1', LogLength: 2048, Operation: 'Api' }],

    // No Id, so no star: the leading block shrinks.
    ['an object with no Id', {
        value: 'AppDefinition', label: 'Apps',
        eligibleForPackageXml: false, eligibleForDataDownload: false,
        fieldlevelactions: [{}]
    }, { DurableId: '06m1', DeveloperName: 'Sales' }],

    ['a row labelled only by _ssLabel', {
        value: 'EntityDefinition', label: 'Objects',
        eligibleForPackageXml: true, eligibleForDataDownload: false,
        fieldlevelactions: [{}]
    }, { QualifiedApiName: 'Account', _ssLabel: 'Account' }],

    /*
     * A row carrying Type. Every fixture above happened to lack one, and the
     * my-view body had a cell for it that the all-view body and the shared
     * counter did not - so a Permission Set rendered "Regular" in an unlabelled
     * cell after the name and shifted Created Date, Last Modified Date and
     * Permission Set Type one column right, each under the wrong heading.
     *
     * Type is one of the columns the describe already picks, so the value was
     * on the row twice.
     */
    ['a row with a Type field', {
        value: 'PermissionSet', label: 'Permission Set',
        eligibleForPackageXml: true, eligibleForDataDownload: false,
        fieldlevelactions: [{ name: 'view', actionUrl: '/' }],
        columns: [{ label: 'Created Date' }, { label: 'Last Modified Date' },
                  { label: 'Permission Set Type' }]
    }, { Id: '0PS1', Name: 'DevConsole_Admin', Type: 'Regular' }],

    /* And the change-user rows, whose username cell only the my grid had. */
    ['a change-user row', {
        value: 'ChangeUser', label: 'Users',
        eligibleForPackageXml: false, eligibleForDataDownload: false,
        fieldlevelactions: [{ name: 'view as' }]
    }, { Id: '005x', Name: 'Mark', email: 'mark@example.com', username: 'mark@acme.com' }]
];

function main() {
    const gridLeadColumns = new Function('$scope',
        lift('$scope.gridLeadColumns = function(rows){') + ';\nreturn $scope.gridLeadColumns;');

    for (const [label, meta, row] of CASES) {
        const $scope = {
            selectedMetadata: meta,
            canBookmark: (r) => !!(r && r.Id && meta.value)
        };
        const claimed = gridLeadColumns($scope)([row]);

        for (const template of ['allrecords', 'usersrecords']) {
            const actual = bodyCellCount(template, meta, row);
            assert.strictEqual(claimed, actual,
                label + ' in ' + template + ': the header spans ' + claimed +
                ' cells but the row renders ' + actual + ' before its columns, so every ' +
                'label sits ' + Math.abs(claimed - actual) + ' column(s) off the value it names');
        }
    }

    /* Both grids carry a header, and it only appears once there is something
       to disambiguate - over a lone name column it is noise. */
    for (const template of ['allrecords', 'usersrecords']) {
        const start = view.indexOf('this.' + template + ' =');
        const segment = view.slice(start, view.indexOf('\nthis.', start + 10));
        assert.ok(/ss-grid-head/.test(segment), template + ' must have a header row');
        assert.ok(/ng-if="selectedMetadata\.columns\.length/.test(segment),
            template + ' header must be gated on there being described columns');
        assert.ok(/gridLeadColumns\(/.test(segment),
            template + ' header must span the computed lead, not a fixed number');
    }



    /* ------------------------------------------------------------------ */
    /* The two bodies must agree                                           */
    /*                                                                     */
    /* One counter spans the lead block of both grids, so any cell that one */
    /* body renders and the other does not is a miscount by construction -  */
    /* in whichever grid the counter does not describe. The counter was     */
    /* written from the all grid; the my grid had two cells more.           */
    /* ------------------------------------------------------------------ */

    for (const [label, meta, row] of CASES) {
        assert.strictEqual(
            bodyCellCount('usersrecords', meta, row),
            bodyCellCount('allrecords', meta, row),
            label + ': the my and all grids must render the same lead cells, or the ' +
            'shared colspan is wrong for one of them');
    }

    /* ------------------------------------------------------------------ */
    /* No rows, no header                                                  */
    /*                                                                     */
    /* The header was gated on the array the rows came from, not on the     */
    /* rows themselves - so a filter that hid everything, or a response     */
    /* that reported a total and sent no records, drew a column header over */
    /* an empty table. A header with nothing under it is worse than none:   */
    /* it says the list loaded.                                            */
    /* ------------------------------------------------------------------ */

    /*
     * Each list has its own alias, and this is the reason.
     *
     * All three lists - search, my view, all view - assigned one shared
     * `filterItem` from their ng-repeat. They live in the same scope and are
     * in the DOM at once, so the last repeat to evaluate won, and DOM order
     * made that the All list. The My header was therefore gated on the All
     * list's row count: in a big org where All had rows and My had none, the
     * My header drew over an empty table. "Sometimes", because it only shows
     * when the two lists disagree.
     */
    /*
     * The column header is above the repeat, so it asks the controller for the
     * count rather than reading the variable the repeat assigns - the same
     * change as the heading and the empty state.
     */
    const aliases = { allrecords: 'all', usersrecords: 'my' };
    for (const template of ['allrecords', 'usersrecords']) {
        const start = view.indexOf('this.' + template + ' =');
        const segment = view.slice(start, view.indexOf('\nthis.', start + 10));
        const gate = /<tr class="ss-grid-head" ng-if="([^"]*)"/.exec(segment);
        assert.ok(gate, template + ' must have a gated header row');

        const alias = aliases[template];
        assert.ok(new RegExp("visibleCount\\(\\\\'" + alias + "\\\\'\\)").test(gate[1]),
            template + ": the header must be gated on its own list (" + alias +
            "), not on another's - got: " + gate[1]);

        assert.ok(!/AllMetaDataRecords\.length|\brecords\.length/.test(gate[1]),
            template + ': gating on the raw array draws a header over an empty table ' +
            'whenever a filter has hidden everything: ' + gate[1]);

        /*
         * The repeat still assigns its own alias, for the rows and the
         * "more rows" line that sit with it. Nothing above the table reads it
         * any more - that was the fault.
         */
        const repeatAlias = template === 'allrecords' ? 'allFilterItem' : 'myFilterItem';
        const assigned = [...segment.matchAll(/ng-repeat="r in (\w+) = \(/g)].map((m) => m[1]);
        assert.deepStrictEqual(assigned, [repeatAlias],
            template + ' must define exactly its own alias, got: ' + assigned.join(', '));

        const headAt = segment.indexOf('ss-grid-head');
        const assignAt = segment.indexOf(repeatAlias + ' = (');
        assert.ok(headAt < assignAt,
            template + ': the header is above the repeat, which is why it cannot ' +
            'read what the repeat assigns');
        assert.ok(!segment.slice(0, assignAt).includes(repeatAlias + '.length'),
            template + ': nothing above the repeat may read ' + repeatAlias +
            ' - it has not been assigned yet, and that is how "no records" ' +
            'appeared over a full table');
    }

    /* Nothing shares one any more. */
    const allAliases = [...view.matchAll(/ng-repeat="r in (\w+) = \(/g)].map((m) => m[1]);
    assert.strictEqual(new Set(allAliases).size, allAliases.length,
        'every list needs its own alias - shared: ' + allAliases.join(', '));
    assert.strictEqual(allAliases.length, 3, 'search, my and all');


    /* ------------------------------------------------------------------ */
    /* Nor the section heading above it                                    */
    /*                                                                     */
    /* The column header was gated; the "Mark's Profile (0)" heading, its   */
    /* row of actions and the "recently created/modified by Mark" line were */
    /* not. A my-view with nothing in it still announced itself, offered    */
    /* "Watch all" and "Add all to package.xml" over no rows, and put a     */
    /* count next to a table that had none.                                */
    /* ------------------------------------------------------------------ */

    {
        const start = view.indexOf('this.usersrecords =');
        const segment = view.slice(start, view.indexOf('\nthis.', start + 10));

        const heading = /<div class="ss-record-header" ng-show="([^"]*)"/.exec(segment);
        assert.ok(heading, 'the my-view heading must still have a gate');
        assert.ok(/visibleCount\(/.test(heading[1]),
            'gated on its own rendered rows: ' + heading[1]);
        assert.ok(/showloading/.test(heading[1]),
            'but kept while the query is still running, or the heading flickers ' +
            'away and back on every load: ' + heading[1]);

        const desc = /<div ng-show="([^"]*)" class="recorddescription"/.exec(segment);
        assert.ok(desc, 'the description line must still be there');
        assert.ok(/visibleCount\(/.test(desc[1]),
            '"These X are recently created/modified by Y" needs rows to describe: ' + desc[1]);

        /* The empty state is the one thing that must appear when there are none. */
        const empty = /<div class="ss-empty-state" ng-if="([^"]*)"/.exec(segment);
        assert.ok(empty, 'the empty state must still exist');
        assert.ok(/!visibleCount\(/.test(empty[1]),
            'and it covers a list filtered down to nothing, not only one that came ' +
            'back empty: ' + empty[1]);

        /* Evaluate the two together: they must never both show, nor both hide. */
        const evaluate = (expr, state) => new Function('s',
            'with (s) { return !!(' + expr.replace(/\\'/g, "'") + '); }')(new Proxy(state, {
                has: () => true, get: (t, k) => t[k]
            }));
        const base = { showmyview: true, showErrorMessage: false,
                       selectedMetadata: { isSearchable: true }, unamewithoutastr: 'Mark' };
        const cases = [
            ['rows',            { visibleCount: () => 1, showloading: false }, true,  false],
            ['none',            { visibleCount: () => 0, showloading: false }, false, true],
            ['loading',         { visibleCount: () => 0, showloading: true },  true,  false],
            ['filtered to none',{ visibleCount: () => 0, records: [{}, {}], showloading: false }, false, true]
        ];
        for (const [label, state, wantHeading, wantEmpty] of cases) {
            const s2 = Object.assign({}, base, state);
            assert.strictEqual(evaluate(heading[1], s2), wantHeading, label + ': heading');
            assert.strictEqual(evaluate(empty[1], s2), wantEmpty, label + ': empty state');
        }
    }

    /* ------------------------------------------------------------------ */
    /* And the reason explains what is on screen                           */
    /* ------------------------------------------------------------------ */

    {
        const reason = (scope, context) => {
            const $scope = Object.assign({ AllMetaDataRecords: [], records: [] }, scope);
            return new Function('$scope',
                lift('$scope.emptyListReason = function(context){') +
                ';return $scope.emptyListReason;')($scope)(context) || '';
        };
        const namespaces = [{ key: 'npsp' }, { key: '__unmanaged__' }];

        /* Rows fetched, all hidden by the namespace filter - the case the new
         * empty state exposes, and the one where the cause is off-screen. */
        assert.ok(/namespaces you have unticked/.test(reason({
            records: [{ Id: 1 }, { Id: 2 }], myFilterItem: [],
            availableNamespaces: namespaces, selectedNamespaces: { npsp: false }
        }, 'my')), 'a my-list filtered to nothing names the filter that did it');

        /* Still silent while the user can see rows. */
        assert.strictEqual(reason({
            records: [{ Id: 1 }], myFilterItem: [{ Id: 1 }], searchAllMetaData: 'billing'
        }, 'my'), '', 'a list with visible rows is never explained');

        /* Rows returned then filtered away is not "the org sent none". */
        assert.strictEqual(reason({
            AllMetaDataRecords: [{ Id: 1 }], allFilterItem: [],
            orgTotalRecords: 79
        }, 'all'), '', 'rows that arrived and were filtered are not reported as missing');

        /* But a genuine total-with-no-rows still is. */
        assert.ok(/none were returned/.test(reason({
            AllMetaDataRecords: [], allFilterItem: [], orgTotalRecords: 79
        }, 'all')), 'a real total-with-no-rows is still named');
    }


    /* ------------------------------------------------------------------ */
    /* The count is what is on screen                                      */
    /*                                                                     */
    /* "All Permission Set (47)" over an empty table. The header counted    */
    /* what was fetched and the table drew what survived the namespace      */
    /* filter, so the two disagreed - and which number you got depended on  */
    /* whether a filter happened to be on, which is why it looked           */
    /* intermittent.                                                        */
    /* ------------------------------------------------------------------ */

    {
        const flat = view.replace(/'\s*\+\s*\n\s*'/g, '');

        /*
         * visibleCount is a controller function now, not a variable the table
         * assigns - so the harness supplies it the way the scope would.
         */
        const render = (template, state) => {
            const scope = new Proxy(state, { has: () => true, get: (t, k) => t[k] });
            return template
                .replace(/<span ng-if="([^"]+)">([\s\S]*?)<\/span>/g, (m, gate, inner) =>
                    new Function('s', 'with (s) { return !!(' + gate.replace(/\\'/g, "'") + '); }')(scope)
                        ? inner : '')
                // Unescaped like the gates above: these come out of a JS string
                // literal, so their quotes are still backslashed.
                .replace(/\{\{([^}]+)\}\}/g, (m, expression) =>
                    new Function('s', 'with (s) { return ' +
                        expression.replace(/\\'/g, "'") + '; }')(scope));
        };

        const allCount = /<span>All \{\{selectedMetadata\.label\}\}[\s\S]*?\)<\/span>/.exec(flat);
        assert.ok(allCount, 'the All header must still carry a count');

        const label = { label: 'Permission Set' };

        /* Nothing hidden: one number, as before. */
        assert.ok(/\(47\)/.test(render(allCount[0], {
            selectedMetadata: label, visibleCount: () => 47,
            totalSize_AllMetaDataRecords: 47, orgTotalRecords: 47
        })), 'an unfiltered list reports one number');

        /* Some hidden: both, so the difference is visible rather than implied. */
        const partly = render(allCount[0], {
            selectedMetadata: label, visibleCount: () => 12,
            totalSize_AllMetaDataRecords: 47, orgTotalRecords: 47
        });
        assert.ok(/12 of 47/.test(partly),
            'a filtered list says how many of how many: ' + partly);

        /* The reported case: the count can no longer claim rows that are not there. */
        const none = render(allCount[0], {
            selectedMetadata: label, visibleCount: () => 0,
            totalSize_AllMetaDataRecords: 47, orgTotalRecords: 47
        });
        assert.ok(/\(0 of 47\)/.test(none),
            'and an empty one says nought, not forty-seven: ' + none);
        assert.ok(!/\(47\)/.test(none), 'the fetched total is never the headline on its own');

        /* The org total is still reported, and is a different fact. */
        const capped = render(allCount[0], {
            selectedMetadata: { label: 'Apex Class' }, visibleCount: () => 200,
            totalSize_AllMetaDataRecords: 200, orgTotalRecords: 3512
        });
        assert.ok(/200/.test(capped) && /3512/.test(capped),
            'a capped list still says what the org holds: ' + capped);

        /* The my-view header had the same fault and gets the same treatment. */
        const myCount = /<span>\{\{uname\}\} \{\{selectedMetadata\.label\}\}[\s\S]*?\)<\/span>/.exec(flat);
        assert.ok(myCount, 'the my-view header must still carry a count');
        assert.ok(/visibleCount\(/.test(myCount[0]),
            'counting what is rendered, not what was fetched: ' + myCount[0]);
        const mine = render(myCount[0], {
            uname: "Rajni's", selectedMetadata: label,
            visibleCount: () => 3, total_records: 9
        });
        assert.ok(/3 of 9/.test(mine), 'and saying both when they differ: ' + mine);
    }


    /* ------------------------------------------------------------------ */
    /* And the count itself is the filtered one                            */
    /*                                                                     */
    /* Everything above tests the bindings with visibleCount stubbed. This  */
    /* is the function they call - if it returned the raw list the headings */
    /* would be wrong again in exactly the way that was reported.           */
    /* ------------------------------------------------------------------ */

    {
        const counted = new Function('$scope', 'packageListFor',
            lift('$scope.visibleCount = function(context){') + ';return $scope.visibleCount;');

        const lists = {
            all: new Array(12).fill({}),
            my: new Array(3).fill({})
        };
        const scope = { AllMetaDataRecords: new Array(47), records: new Array(9),
                        renderLimit: 5 };
        const count = counted(scope, (context) => lists[context]);

        assert.strictEqual(count('all'), 12,
            'the count is what survived the filters, not what was fetched - ' +
            'forty-seven fetched and twelve shown is twelve');
        assert.strictEqual(count('my'), 3, 'and the same for the user\'s own list');

        /*
         * Not capped by renderLimit. This is how many match; how many are drawn
         * is what the "more rows" line under the table is for, and folding the
         * two together would make a long list report its own page size.
         */
        assert.strictEqual(count('all'), 12,
            'and it is not clipped to the render limit of ' + scope.renderLimit);

        lists.all = [];
        assert.strictEqual(count('all'), 0, 'everything filtered away is nought');
    }

    /* ------------------------------------------------------------------ */
    /* And an all-filtered list explains itself                            */
    /* ------------------------------------------------------------------ */

    {
        const allHeader = /<div class="ss-record-header" ng-show="([^"]*)" ng-if="AllMetaDataRecords\.length>0">/
            .exec(view);
        assert.ok(allHeader, 'the All header must still be gated');
        assert.ok(/visibleCount\(/.test(allHeader[1]),
            'on its own rendered rows, so it cannot stand over an empty table: ' +
            allHeader[1]);
        assert.ok(/showallloading/.test(allHeader[1]),
            'while a load in progress keeps it, or the heading flickers away and back');

        const allEmpty = [...view.matchAll(/<div class="ss-empty-state" ng-if="([^"]*)"/g)]
            .map((m) => m[1]);
        assert.strictEqual(allEmpty.length, 2, 'both lists have an empty state');
        allEmpty.forEach((gate) => {
            assert.ok(/!visibleCount\(/.test(gate),
                'each covers a list filtered down to nothing, not only one that came ' +
                'back empty: ' + gate);
            assert.ok(!/AllMetaDataRecords\.length==0|records\.length==0/.test(gate),
                'and none of them still keys off the fetched array: ' + gate);
        });

        /* The reason that fires for it is the one about namespaces. */
        const reason = (scope, context) => new Function('$scope',
            lift('$scope.emptyListReason = function(context){') +
            ';return $scope.emptyListReason;')(
            Object.assign({ AllMetaDataRecords: [], records: [] }, scope))(context) || '';

        assert.ok(/namespaces you have unticked/.test(reason({
            AllMetaDataRecords: new Array(47), allFilterItem: [],
            availableNamespaces: [{ key: 'npsp' }, { key: '__unmanaged__' }],
            selectedNamespaces: { npsp: false }
        }, 'all')),
            'forty-seven fetched and none shown is explained by the filter that did ' +
            'it - which is off-screen in the right rail');
    }

    /* ------------------------------------------------------------------ */
    /* And the count says how many are shown                               */
    /*                                                                     */
    /* It read data.totalSize - the org's answer about the query - while    */
    /* the rows came from data.records. When those disagree the header says */
    /* "(79)" over nothing.                                                 */
    /* ------------------------------------------------------------------ */

    assert.ok(!/(total_records|totalSize_AllMetaDataRecords)\s*=\s*data\.totalSize/.test(controller),
        'the row count must not come from data.totalSize - that is what the org said ' +
        'about the query, not what it sent');
    /*
     * The property, not one particular spelling of it. The first version of
     * this pinned the exact expression and broke the moment the expression was
     * simplified - which says nothing about whether the count is right.
     */
    assert.ok(/totalSize_AllMetaDataRecords =[^;]*AllMetaDataRecords\.length/.test(controller),
        'the all-records count must be the number of records actually held');
    assert.ok(/total_records =[^;]*records\.length/.test(controller),
        "and the same for the user's own list");


    /* ------------------------------------------------------------------ */
    /* The count is taken after the rows are assigned                      */
    /*                                                                     */
    /* Making the count describe the rendered rows introduced a subtler     */
    /* fault than the one it fixed: written one line above the assignment,  */
    /* it counted the *previous* response's array - which the reset had     */
    /* just emptied - so every list reported (0) over its own rows.         */
    /*                                                                     */
    /* And a third handler, the one behind the search box, replaced the     */
    /* rows without touching the count at all, leaving the previous list's  */
    /* number above the results.                                            */
    /*                                                                     */
    /* Derived from the source so a fourth handler cannot be added without  */
    /* answering the same question.                                        */
    /* ------------------------------------------------------------------ */

    for (const [rows, count] of [['records', 'total_records'],
                                 ['AllMetaDataRecords', 'totalSize_AllMetaDataRecords']]) {
        const assignments = [...controller.matchAll(
            new RegExp('\\$scope\\.' + rows + ' = decorateRecords', 'g'))];

        assert.ok(assignments.length > 0,
            'expected at least one handler assigning ' + rows +
            ' - a scan that matches nothing passes for the wrong reason');

        for (const assignment of assignments) {
            const line = controller.slice(0, assignment.index).split('\n').length;
            // The handler's own body: far enough to cover it, not so far as to
            // find the next one's count and call it this one's.
            const following = controller.slice(assignment.index, assignment.index + 900);
            const countAt = following.indexOf('$scope.' + count + ' =');

            assert.ok(countAt > 0,
                'the handler assigning ' + rows + ' at line ' + line + ' never sets ' +
                count + ', so the header keeps whatever the last list showed');

            // Before the assignment it would read the previous array.
            const precedingCount = controller.slice(Math.max(0, assignment.index - 200),
                                                    assignment.index);
            assert.ok(!precedingCount.includes('$scope.' + count + ' ='),
                count + ' is set just before ' + rows + ' is assigned at line ' + line +
                ' - it would count the previous response, which is how a full list ' +
                'came to report (0)');
        }
    }

    console.log('grid header alignment test passed (' + CASES.length + ' shapes x 2 grids)');
}

main();
