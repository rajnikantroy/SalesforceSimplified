/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/*
 * The About page now claims, in nine rows, things this extension can do that
 * the org's own tooling cannot. Claims rot: a feature gets removed or renamed
 * and the boast for it stays behind, which is worse than never having made it.
 *
 * So every row is held to the thing that backs it, and - the part that matters
 * more - a row with nothing behind it fails rather than passing unnoticed. The
 * mapping below is exhaustive by assertion: if the page grows a tenth row, the
 * count check fails until somebody says what implements it.
 */

const ROOT = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const view = read('js/angular/services/ViewService.js');
const container = read('js/angular/services/MetaDataContainer.js');
const controller = read('js/angular/controllers/MenuAndDetailsCtrl.js');

/* ------------------------------------------------------------------ */
/* Lift the section out of the template                                */
/* ------------------------------------------------------------------ */

/*
 * The template is a concatenation of single-quoted strings, so the joins have
 * to come out before the markup reads as markup. Doing it by hand rather than
 * by eval: this file is 2,000 lines of someone else's quoting, and a test that
 * executes the thing it is checking can be fooled by it.
 */
function unquote(source) {
    return source.replace(/'\s*\+\s*\n?\s*'/g, '').replace(/\\'/g, "'");
}

const startAt = view.indexOf('What you can do here');
assert.ok(startAt > -1, 'the About page should still have a "What you can do here" section');

const endAt = view.indexOf('</table>', startAt);
assert.ok(endAt > startAt, 'the "What you can do here" section should still be a table');

const section = unquote(view.slice(startAt, endAt));

const rows = (section.match(/<span class="ss-usage-feature-name">([^<]+)<\/span>/g) || [])
    .map(function (hit) {
        return hit.replace(/^<span class="ss-usage-feature-name">/, '').replace(/<\/span>$/, '');
    });

assert.ok(rows.length > 0, 'no feature rows found - the extraction is wrong, not the page');

/* Each row needs a description under it, or it is a headline with no claim. */
const subs = (section.match(/<div class="ss-about-sub">/g) || []).length;
assert.strictEqual(subs, rows.length,
    'every feature row needs its one-line explanation: ' + rows.length +
    ' rows but ' + subs + ' explanations');

/* ------------------------------------------------------------------ */
/* What has to exist for each row to be true                           */
/* ------------------------------------------------------------------ */

function systemEntry(value) {
    return container.includes('value: "' + value + '"');
}

function fileExists(rel) {
    return fs.existsSync(path.join(ROOT, rel));
}

const BACKED_BY = {
    'package.xml, built while you browse': function () {
        assert.ok(systemEntry('PackageXml'), 'no PackageXml entry in the system menu');
        assert.ok(fileExists('js/angular/services/PackageDependencyService.js'),
            'no package service');
        assert.ok(/retrieve/i.test(controller), 'nothing in the controller retrieves a zip');
    },
    'A watch list for components': function () {
        assert.ok(systemEntry('WatchingList'), 'no WatchingList entry in the system menu');
        assert.ok(fileExists('js/angular/services/BookmarkService.js'), 'no watch-list service');
    },
    'What you touched, before what exists': function () {
        assert.ok(systemEntry('RecentlyViewed'), 'no RecentlyViewed entry in the system menu');
        assert.ok(/LastModifiedById/.test(controller) || /myFilterItem/.test(view),
            'nothing narrows a list to the current user\'s own work');
    },
    'Every field on a record, editable': function () {
        assert.ok(fileExists('js/record-fields.js'), 'the All Fields module is gone');
        const module = read('js/record-fields.js');
        assert.ok(/updateable/.test(module),
            'All Fields should still decide editability from the describe');
        assert.ok(/showAllFieldsTab|Simplified_ShowAllFields/.test(view + controller),
            'All Fields should still have its switch under Features');
    },
    'A list view out as a file': function () {
        assert.ok(fileExists('js/list-export.js'), 'the Export module is gone');
        const module = read('js/list-export.js');
        // The open bracket matters: without it a renamed-away toCsvSomething
        // still satisfies the match, which is exactly how this escaped once.
        assert.ok(/function toCsv\s*\(/.test(module), 'CSV output is claimed but not implemented');
        assert.ok(/function toExcelHtml\s*\(/.test(module), 'Excel output is claimed but not implemented');
        assert.ok(/JSON\.stringify/.test(module), 'JSON output is claimed but not implemented');
    },
    'REST and Tooling calls in the same tab': function () {
        assert.ok(systemEntry('RestExplorer'), 'no RestExplorer entry in the system menu');
        assert.ok(/restMethods\s*=\s*\[[^\]]*'PATCH'/.test(controller),
            'REST Explorer should still offer more than GET');
    },
    'Bulk API 2.0 job status': function () {
        assert.ok(systemEntry('BulkJobs'), 'no BulkJobs entry in the system menu');
        /*
         * The row's whole point is 2.0 - Setup's own Bulk Data Load Jobs page
         * covers v1. If this ever queried the v1 endpoint the row would be a
         * duplicate of Setup rather than an addition to it.
         */
        assert.ok(/jobs\/ingest/.test(controller) && /jobs\/query/.test(controller),
            'the Bulk page should still read the 2.0 ingest and query endpoints');
    },
    'A describe, as a tree': function () {
        assert.ok(systemEntry('ObjectDescribe'), 'no ObjectDescribe entry in the system menu');
        assert.ok(/childRelationships|describeGroups/.test(controller),
            'the describe tree should still group the describe\'s own lists');
    },
    'Several orgs, one workspace': function () {
        assert.ok(systemEntry('ChangeUser'), 'no ChangeUser entry in the system menu');
        assert.ok(fileExists('js/ss-core.js'), 'no core module');
        assert.ok(/ssDropForeignCredentials/.test(read('js/ss-core.js')),
            'the claim that each org\'s session is kept to itself needs the guard that does it');
    }
};

/* ------------------------------------------------------------------ */
/* Hold the page to it                                                 */
/* ------------------------------------------------------------------ */

const unbacked = rows.filter(function (row) { return !BACKED_BY[row]; });
assert.deepStrictEqual(unbacked, [],
    'About page rows with nothing asserted behind them: ' + unbacked.join(' | ') +
    ' - add the check to BACKED_BY, or drop the claim');

const stale = Object.keys(BACKED_BY).filter(function (row) { return rows.indexOf(row) === -1; });
assert.deepStrictEqual(stale, [],
    'BACKED_BY names rows the page no longer has: ' + stale.join(' | '));

rows.forEach(function (row) {
    BACKED_BY[row]();
});

/*
 * The section sits on the About page, which is where somebody goes to find out
 * what this is - not buried behind the diagnostics they go there to copy.
 */
const aboutAt = view.indexOf('this.aboutus');
const heroAt = view.indexOf('ss-about-hero', aboutAt);
const buildAt = view.indexOf('This build, and this org', aboutAt);
assert.ok(aboutAt > -1 && heroAt > aboutAt, 'the About page should still open with its hero');
assert.ok(startAt > heroAt && startAt < buildAt,
    'the feature list belongs between the hero and the diagnostics');

console.log('about_features: ok (' + rows.length + ' claims, each backed)');
