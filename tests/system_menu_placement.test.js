/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Where a menu entry ends up in the sidebar.
 *
 * The sidebar is two blocks: the metadata list, which scrolls, and the
 * utilities pinned to its foot. populateMenus decides which an entry joins by
 * looking it up in BOTTOM_UTILITY_KEYS - a table in the controller, listing
 * names defined in a different file.
 *
 * Nothing connects those two files, and the failure is silent. An entry added
 * to MetaDataContainer.systemData but forgotten in BOTTOM_UTILITY_KEYS does
 * not error; it quietly joins the scrolling metadata list and is sorted
 * alphabetically in among the org's objects, which is where the Notifications
 * panel first landed.
 *
 * The two are joined here by a property of the data rather than by a list
 * kept alongside it: a pinned utility is a Settings entry that is not
 * searchable. That describes all nine of them and none of the entries that
 * belong in the scrolling list - View As, Recently viewed and Debug logs are
 * Settings too, but searchable, and the metadata types carry a different
 * feature entirely. So a new utility is placed correctly or this test says
 * so, without anyone having to remember to add it here.
 */

const container = fs.readFileSync('./js/angular/services/MetaDataContainer.js', 'utf8');
const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

/* ------------------------------------------------------------------ */
/* What the controller pins                                            */
/* ------------------------------------------------------------------ */

const tableMatch = controller.match(/var BOTTOM_UTILITY_KEYS = \{([\s\S]*?)\};/);
assert.ok(tableMatch, 'BOTTOM_UTILITY_KEYS must still exist in MenuAndDetailsCtrl');

const pinned = new Set();
/*
 * The map holds a rank now, not a flag - the bar is sorted by it. Anything
 * truthy still means pinned, so this reads the key and ignores the value.
 */
for (const entry of tableMatch[1].matchAll(/'([^']+)'\s*:\s*\d+/g)) {
    pinned.add(entry[1]);
}
assert.ok(pinned.size > 5, `expected several pinned keys, found ${pinned.size}`);

/* ------------------------------------------------------------------ */
/* What the data says should be pinned                                 */
/* ------------------------------------------------------------------ */

const systemData = container.slice(container.indexOf('this.systemData'));
const entries = [];
for (const chunk of systemData.split(/\n    \}, \{/)) {
    const value = chunk.match(/value:\s*"([^"]+)"/);
    if (!value) { continue; }
    const label = chunk.match(/label:\s*"([^"]+)"/);
    const feature = chunk.match(/technologyFeature:\s*"([^"]+)"/);
    const searchable = chunk.match(/isSearchable:\s*(true|false)/);
    entries.push({
        value: value[1],
        label: label ? label[1] : value[1],
        feature: feature ? feature[1] : '',
        searchable: searchable ? searchable[1] === 'true' : true
    });
}
assert.ok(entries.length > 10, `expected systemData to hold many entries, found ${entries.length}`);

// A utility panel: about the extension, not about the org, so nothing to
// search within it.
const isUtility = (entry) => entry.feature === 'Settings' && entry.searchable === false;

const shouldPin = entries.filter(isUtility);
assert.ok(shouldPin.length >= 8, `expected the foot bar to hold several utilities, found ${shouldPin.length}`);

const notPinned = shouldPin.filter((entry) => !pinned.has(entry.value)).map((e) => e.value);
assert.deepStrictEqual(
    notPinned, [],
    'these utility panels are missing from BOTTOM_UTILITY_KEYS, so they will be sorted into the ' +
    'scrolling metadata list instead of the pinned foot bar: ' + notPinned.join(', ')
);

// And nothing that belongs in the scrolling list may be pinned by mistake.
const wronglyPinned = entries
    .filter((entry) => !isUtility(entry) && pinned.has(entry.value))
    .map((e) => e.value);
assert.deepStrictEqual(
    wronglyPinned, [],
    'these are searchable metadata entries and belong in the scrolling list, not the foot bar: ' +
    wronglyPinned.join(', ')
);

/* ------------------------------------------------------------------ */
/* Order within the foot bar                                           */
/*                                                                     */
/* bottomList is built by walking systemData and is never re-sorted,   */
/* so the order entries are declared in is the order they appear on    */
/* screen. Notifications is the last setting; About Us is not a        */
/* setting at all and stays the final row.                             */
/* ------------------------------------------------------------------ */

const order = shouldPin.map((e) => e.value);
const notifications = order.indexOf('NotificationSettings');
const about = order.indexOf('AboutUs');

assert.ok(notifications !== -1, 'the Notifications panel must be one of the pinned utilities');
assert.strictEqual(about, order.length - 1, 'About Us must stay the last row of the menu');
assert.strictEqual(
    notifications, about - 1,
    'Notifications must sit directly above About Us; the pinned order is currently: ' + order.join(' -> ')
);


/* ---------------------------------------------------------------------- */
/* The utility bar is in the order it is used                             */
/*                                                                        */
/* It used to be in the order the entries happen to sit in systemData -    */
/* the order they were added over time - so the colour picker sat above    */
/* the manifest and the news ticker above the audit trail.                 */
/* ---------------------------------------------------------------------- */

const ranks = {};
for (const entry of tableMatch[1].matchAll(/'([^']+)'\s*:\s*(\d+)/g)) {
    ranks[entry[1]] = Number(entry[2]);
}

/* Both spellings of a value are the same entry and must rank the same. */
for (const key of Object.keys(ranks)) {
    const other = key.charAt(0) === key.charAt(0).toUpperCase()
        ? key.charAt(0).toLowerCase() + key.slice(1)
        : key.charAt(0).toUpperCase() + key.slice(1);
    if (ranks[other] === undefined) { continue; }
    assert.strictEqual(ranks[key], ranks[other],
        key + ' and ' + other + ' are one entry and must rank together, or the ' +
        'bar order depends on which casing the menu happened to carry');
}

/*
 * The shape of the order: what you came to do, then what you came to find
 * out, then what the extension has to say for itself.
 */
const ORDER = [
    'PackageXml', 'WatchingList', 'AuditTrail',
    'ObjectDescribe', 'RestExplorer', 'BulkJobs', 'Integrator', 'UsageAnalytics',
    'ApiMonitor', 'TrustStatus', 'NewsTimeline',
    'NotificationSettings', 'LauncherColor', 'AboutUs'
];

ORDER.forEach((key) => {
    assert.notStrictEqual(ranks[key], undefined, key + ' must have a rank');
});
for (let i = 1; i < ORDER.length; i++) {
    assert.ok(ranks[ORDER[i - 1]] < ranks[ORDER[i]],
        ORDER[i - 1] + ' must come before ' + ORDER[i] + ' - got ' +
        ranks[ORDER[i - 1]] + ' and ' + ranks[ORDER[i]]);
}

/*
 * The four that are true and are not why anyone opened the panel, plus About
 * Us, which is not about the org at all. Named individually rather than left
 * to the list above, because this is the part that was actually wrong.
 */
for (const late of ['ApiMonitor', 'TrustStatus', 'NewsTimeline', 'LauncherColor', 'AboutUs']) {
    assert.ok(ranks[late] > ranks.PackageXml && ranks[late] > ranks.WatchingList &&
              ranks[late] > ranks.AuditTrail && ranks[late] > ranks.ObjectDescribe,
        late + ' belongs after the things people come here to do');
}

/* And the bar is actually sorted by it, not merely declared in order. */
assert.ok(/bottomList\.sort\(/.test(controller),
    'the bar is sorted by rank - a map nothing reads is a comment');
assert.ok(/BOTTOM_UTILITY_KEYS\[a\.value\] \|\| 99/.test(controller),
    'and an unranked entry goes to the end rather than to the front, which is ' +
    'where a missing rank of undefined would put it');
assert.ok(/a\._barIndex - b\._barIndex/.test(controller),
    'with a stable tie-break, so two unranked entries keep their order');

console.log('system menu placement test passed');
