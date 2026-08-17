/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Selecting data, the way metadata is selected.
 *
 * The two selections sit side by side in the same lists and had drifted into
 * behaving differently. Metadata's Select all is in the list header, acts on
 * the rows the filters have left on screen, and its sidebar card appears only
 * once something is selected. Data's Select all was inside the card, took
 * every row loaded rather than every row visible, and the card was on screen
 * permanently - so it read as an export panel that never did anything.
 *
 * What is checked here is that the two are now the same shape, because the
 * cost of them differing is not cosmetic: a Select all that ignores the
 * active search silently exports records the user never saw.
 */

const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

function main() {

    /* ------------------------------------------------------------------ */
    /* The card is gone; the footer carries it                             */
    /* ------------------------------------------------------------------ */

    /*
     * The Data JSON card only appeared on pages where downloading was
     * possible, so a basket built against one object was invisible from
     * everywhere else. It was replaced by a footer chip, which is on every
     * page - and the same rule holds there: nothing shown when nothing is
     * selected, because a control for something that is not there is noise.
     */
    assert.ok(!/this\.datajson\s*=/.test(view),
        'the Data JSON card is gone - its count, download and clear are in the footer');

    /*
     * The package.xml card used to be the pair to this and the shape being
     * matched. It is a footer count now, and the same rule holds there: no
     * selection, nothing on screen.
     */
    const flatView = view.replace(/'\s*\+\s*\n\s*'/g, '');
    // The class and the handler, not the tag: it is a <button> now.
    const metaChip = /class="ss-foot-chip" ng-show="([^"]+)" ng-click="openPackageXml\(\)"/
        .exec(flatView);
    assert.ok(metaChip, 'the manifest count must still be somewhere');
    assert.ok(/selectedMetaForPackageXml\.size/.test(metaChip[1]),
        'and still gated on there being a selection: ' + metaChip[1]);

    /*
     * The record basket needs the same treatment, and for a sharper reason:
     * its card only appears on pages where downloading is possible, so a
     * selection made against one object was invisible from everywhere else -
     * which is exactly when somebody forgets it is there.
     */
    const dataChip = /class="ss-foot-chip" ng-show="([^"]+)" ng-click="downloadSelectedDataAsJson\(\)"/
        .exec(flatView);
    assert.ok(dataChip, 'the record count must be in the footer too');
    assert.ok(/selectedDataForDownload\.size/.test(dataChip[1]),
        'gated on there being records selected: ' + dataChip[1]);

    /*
     * And it cannot be pressed twice while the first download is still
     * fetching every field of up to two hundred records.
     */
    /*
     * The footer chip, not the sidebar card. Both call the same handler and
     * the card comes first in the file, so a window around the first match
     * checked the card and passed while the chip had lost its guard.
     */
    const chipAt = flatView.indexOf('class="ss-foot-chip" ng-show="selectedDataForDownload.size"');
    assert.ok(chipAt > -1, 'the footer chip must exist');
    const dataButton = flatView.slice(chipAt, flatView.indexOf('</button>', chipAt));
    assert.ok(/ng-disabled="downloadState\.running"/.test(dataButton),
        'the chip is disabled while a download is running: ' + dataButton.slice(0, 160));
    assert.ok(/downloadState\.running \?/.test(dataButton),
        'and says so rather than looking idle');

    /*
     * The two chips stay told apart. They sit side by side and both are
     * downloads, so the word is the only thing distinguishing them.
     */
    const metaAt = flatView.indexOf('class="ss-foot-chip" ng-show="selectedMetaForPackageXml.size"');
    const metaButton = flatView.slice(metaAt, flatView.indexOf('</button>', metaAt));
    assert.ok(/>package\.xml</.test(metaButton),
        'the manifest chip still says what it is: ' + metaButton.slice(-90));
    assert.ok(/Data JSON/.test(dataButton) && !/package\.xml/.test(dataButton),
        'and the record chip says something else');

    /*
     * Select all lives in the list header, which is the point the card could
     * never satisfy: a control hidden until something is selected cannot be
     * the way to make the first selection. The footer chip has the same
     * shape, which is why Select all is not in it either.
     */
    assert.ok(!/selectAllVisibleData\(\)/.test(dataButton),
        'Select all must not be inside the chip it would be needed to reveal');

    /* ------------------------------------------------------------------ */
    /* Select all sits in the list header, on both lists                   */
    /* ------------------------------------------------------------------ */

    // The templates are JavaScript string literals, so the quotes around the
    // context arrive backslash-escaped: selectAllForDataDownload(\\'my\\').
    for (const context of ['my', 'all']) {
        const call = (fn) => fn + "(\\'" + context + "\\')";
        assert.ok(view.includes(call('selectAllForDataDownload')),
            `the ${context} list header needs a data Select all`);
        /*
         * Reports whether *anything* is selected, not whether everything is.
         *
         * "All of them" cannot be reached on a list longer than the two
         * hundred an export allows, so the old test left the control stuck
         * on: a second press tried to select again, the cap refused it, and
         * there was no way to clear a Select all. It only showed on objects
         * with enough rows to pass the cap - Account, in the report.
         */
        assert.ok(view.includes(call('anySelectedForDataDownload')),
            `and the ${context} list must flip on anything being selected`);
        assert.ok(!view.includes(call('allSelectedForDataDownload')),
            `and not on the ${context} list being selected in full, which past ` +
            'the cap never happens');
        assert.ok(view.includes(call('selectAllForPackageXml')),
            `the ${context} list header still has the metadata one to sit beside`);
    }

    // One per list, no more: a duplicated header control is two checkboxes
    // reporting the same state and disagreeing about it.
    assert.strictEqual((view.match(/selectAllForDataDownload\(/g) || []).length, 2,
        'exactly one data Select all per list');

    // It is only offered where data can actually be exported.
    const gated = view.match(
        /ss-selectall" ng-if="selectedMetadata\.eligibleForDataDownload"/g) || [];
    assert.strictEqual(gated.length, 2,
        'both data Select alls are gated on eligibleForDataDownload');

    /* ------------------------------------------------------------------ */
    /* Both handlers exist, and act on the visible rows                    */
    /* ------------------------------------------------------------------ */

    for (const fn of ['selectAllForDataDownload', 'allSelectedForDataDownload']) {
        assert.ok(new RegExp('\\$scope\\.' + fn + '\\s*=').test(controller),
            `${fn} must exist on the scope, or the header control does nothing`);
    }

    /*
     * packageListFor is what applies the namespace filter and the search box.
     * Using it is the whole point: Select all has to mean the rows on screen.
     * The old data version walked $scope.records directly and took everything
     * loaded, including rows the active filter had removed from view.
     */
    const selectAllBody = controller.slice(
        controller.indexOf('$scope.selectAllForDataDownload = function(context){'),
        controller.indexOf('$scope.allSelectedForPackageXml = function(context){'));
    assert.ok(selectAllBody.includes('packageListFor(context)'),
        'data Select all must act on the filtered list, not on every row loaded');

    const anySelectedBody = controller.slice(
        controller.indexOf('$scope.anySelectedForDataDownload = function(context){'),
        controller.indexOf('$scope.selectAllForDataDownload = function(context){'));
    assert.ok(anySelectedBody.includes('packageListFor(context)'),
        'and the checked state must be judged against the same rows');

    /*
     * A second click clears, and the test for it is "anything selected" -
     * not "everything". On a list longer than the two hundred an export
     * allows, everything is unreachable, so the old test left the control
     * switched on for good: pressing again tried to select more, the cap
     * refused, and the selection could not be cleared. It only bit on
     * objects with enough rows to pass the cap.
     */
    assert.ok(/var select = !\$scope\.anySelectedForDataDownload\(context\)/.test(selectAllBody),
        'a second click clears whatever is selected, however much of the list that is');

    /* ------------------------------------------------------------------ */
    /* A tick is a tick in both views                                      */
    /*                                                                     */
    /* The same record appears in "mine" and in "all", and the tick is held */
    /* on the row object rather than read back from the map - so a record   */
    /* selected in one view showed as unticked in the other while the count */
    /* insisted it was selected.                                            */
    /* ------------------------------------------------------------------ */

    /*
     * A flag on the record object cannot express this. Two ordinary situations
     * break it: a list where several rows carry the same Id, and a record that
     * appears in both "mine" and "all" as one shared object. Setting the flag
     * then ticked every row sharing it, which read as Select all firing on a
     * single click.
     *
     * So the map is the only place a selection lives, and the checkbox asks it.
     */
    assert.ok(/\$scope\.isDataSelected\s*=/.test(controller),
        'there must be one place that answers whether a row is selected');
    assert.ok(view.includes('ng-checked="isDataSelected(r)"'),
        'the row checkbox must read the map, not a flag on the row');
    assert.ok(!view.includes('ng-model="r.dataSelected"'),
        'no row may own its own selection state');
    assert.ok(!/\.dataSelected\s*=/.test(controller),
        'and nothing may write a per-row selection flag any more');

    const isSelectedBody = controller.slice(
        controller.indexOf('$scope.isDataSelected = function(record){'),
        controller.indexOf('$scope.isDataSelected = function(record){') + 400);
    assert.ok(/selectedDataForDownload\.has\(record\.Id\)/.test(isSelectedBody),
        'selection is keyed by record id, so a tick belongs to a record and nothing else');

    // The count and the checkboxes cannot disagree if they read the same map.
    const allSelectedUsesMap = controller.slice(
        controller.indexOf('$scope.allSelectedForDataDownload = function(context){'),
        controller.indexOf('$scope.selectAllForDataDownload = function(context){'));
    assert.ok(allSelectedUsesMap.includes('isDataSelected('),
        'the header checkbox judges fullness by the same answer the rows give');

    /* ------------------------------------------------------------------ */
    /* package.xml selection works the same way                            */
    /*                                                                     */
    /* It had the identical per-row flag, and it costs more here: a         */
    /* manifest that names components nobody chose deploys the wrong        */
    /* things, where a wrong export merely exports too much.               */
    /* ------------------------------------------------------------------ */

    assert.ok(/\$scope\.isMetaSelected\s*=/.test(controller),
        'one place must answer whether a component is in the package');
    assert.ok(view.includes('ng-checked="isMetaSelected(r)"'),
        'the component checkbox must read the selection map');
    assert.ok(!view.includes('ng-model="r.selected"'),
        'no row may own whether it is in the package');
    assert.ok(!/\.selected\s*=\s*(true|false)/.test(controller),
        'and nothing may write a per-row selection flag');

    /*
     * Keyed on a stable identity, not on record.Id alone.
     *
     * Id is that identity almost always - but the Custom Metadata list queries
     * EntityDefinition, which carries no ordinary Id, so every row shared the
     * same absent key and ticking one reported all of them as ticked. The key
     * falls back to QualifiedApiName, which is unique per row and is also the
     * string the manifest names, so a row that can be selected is a row that
     * can be packaged.
     */
    const keyFn = controller.slice(
        controller.indexOf('function recordKey(record){'),
        controller.indexOf('function recordKey(record){') + 320);
    assert.ok(/record\.Id \|\| record\.QualifiedApiName/.test(keyFn),
        'the selection key prefers Id and falls back to a name that is unique per row');

    const metaSelected = controller.slice(
        controller.indexOf('$scope.isMetaSelected = function(record){'),
        controller.indexOf('$scope.isMetaSelected = function(record){') + 400);
    assert.ok(/selectedMetaForPackageXml\.has\(key\)/.test(metaSelected),
        'membership is keyed by that identity, so a tick belongs to one component');
    assert.ok(!/has\(record\.Id\)/.test(metaSelected),
        'and not by record.Id alone, which is absent on EntityDefinition rows');

    // Unticking must clear the manifest entry too, or the package keeps a
    // member the user removed.
    const removeBody = controller.slice(
        controller.indexOf('function removeMetaFromPackage(id){'),
        controller.indexOf('function removeMetaFromPackage(id){') + 500);
    assert.ok(/selectedMetaForPackageXml\.delete\(id\)/.test(removeBody) &&
              /packageMetaTypeAndName\.forEach/.test(removeBody),
        'removing a component clears it from both the selection and the manifest map');

    /* ------------------------------------------------------------------ */
    /* A row with nothing but an id is still identifiable                  */
    /*                                                                     */
    /* An object with no label column gets displayField 'Id', so the query  */
    /* selects Id and nothing else. labelFor skips Id on purpose - it is a  */
    /* poor label wherever a real one exists - and used to return '',       */
    /* rendering a checkbox beside blank space. Unreadable, and             */
    /* unselectable in any meaningful sense.                               */
    /* ------------------------------------------------------------------ */

    const labelBody = controller.slice(
        controller.indexOf('function labelFor(record, meta){'),
        controller.indexOf('// Applies the per-metadata display rules'));
    assert.ok(/return record\.Id \? String\(record\.Id\) : ''/.test(labelBody),
        'a record carrying only an id falls back to showing it');
    assert.ok(labelBody.indexOf("key === 'Id'") < labelBody.indexOf('return record.Id'),
        'the id remains the last resort, not preferred over a real label');

    console.log('data selection regression test passed');
}

main();
