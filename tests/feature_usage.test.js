/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * What the extension has been used for.
 *
 * Counted in chrome.storage.local rather than in each feature's own store: the
 * panel is Angular on one page, the record and list modules are plain scripts
 * on another, and localStorage is per-origin - so the standalone page and the
 * org page would each keep half the tally.
 *
 * None of it leaves the browser, and the org tally is a count rather than a
 * list of names.
 */

const core = fs.readFileSync('./js/ss-core.js', 'utf8');
const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const recordFields = fs.readFileSync('./js/record-fields.js', 'utf8');
const listExport = fs.readFileSync('./js/list-export.js', 'utf8');
const bootstrap = fs.readFileSync('./js/bootstrap.js', 'utf8');

function lift(source, signature) {
    const start = source.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') { depth++; }
        else if (source[i] === '}') { depth--; if (depth === 0) { return source.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

/* A stand-in for chrome.storage.local that remembers. */
function store(initial) {
    const bag = { ssFeatureUse: initial || {} };
    const self = {
        bag,
        writes: 0,
        chrome: {
            runtime: { lastError: null },
            storage: { local: {
                get: (key, cb) => cb({ ssFeatureUse: bag.ssFeatureUse }),
                set: (items, cb) => { self.writes++; Object.assign(bag, items); cb(); }
            } }
        }
    };
    return self;
}

async function main() {

    /* ------------------------------------------------------------------ */
    /* Counting                                                            */
    /* ------------------------------------------------------------------ */

    {
        const s = store();
        const count = new Function('chrome', 'SS_USAGE_KEY', 'Promise',
            lift(core, 'function ssCountUse(key, amount)') + ';return ssCountUse;')
            (s.chrome, 'ssFeatureUse', Promise);

        await count('exports');
        await count('exports');
        assert.strictEqual(s.bag.ssFeatureUse.exports, 2, 'it adds up across calls');

        await count('recordsExported', 4200);
        assert.strictEqual(s.bag.ssFeatureUse.recordsExported, 4200,
            'and takes an amount - one export of four thousand rows is not the ' +
            'same as four thousand exports');

        /*
         * Asked on a key that does not exist yet: adding zero to an existing
         * counter leaves it unchanged either way, so only a new key shows
         * whether the guard is there.
         */
        await count('neverHappened', 0);
        assert.strictEqual(s.bag.ssFeatureUse.neverHappened, undefined,
            'nothing did not happen - an export of no rows must not create a ' +
            'counter that has never counted anything');
        await count('exports', 0);
        assert.strictEqual(s.bag.ssFeatureUse.exports, 2, 'nor change one that has');
        await count('');
        assert.strictEqual(Object.keys(s.bag.ssFeatureUse).length, 2, 'nor a nameless one');
    }

    /* A tally is not worth failing a feature over. */
    {
        const broken = { runtime: {}, storage: { local: { get() { throw new Error('no'); } } } };
        const count = new Function('chrome', 'SS_USAGE_KEY', 'Promise',
            lift(core, 'function ssCountUse(key, amount)') + ';return ssCountUse;')
            (broken, 'ssFeatureUse', Promise);
        assert.strictEqual(await count('exports'), null,
            'storage being unavailable resolves as nothing counted, not a rejection');
    }

    /* ------------------------------------------------------------------ */
    /* Orgs: a number, not a list of names                                 */
    /* ------------------------------------------------------------------ */

    {
        const s = store();
        const note = (origin) => new Function('chrome', 'SS_USAGE_KEY', 'Promise', 'URL',
            'var SS_ORIGIN = ' + JSON.stringify(origin) + ';' +
            'function ssHostOf(u){ try { return new URL(u).hostname; } catch (e) { return ""; } }' +
            'var SS_ORG_HOSTS = /(?:^|\\.)(?:my\\.salesforce\\.com|lightning\\.force\\.com)$/i;' +
            lift(core, 'function ssOrgKey(hostname)') + '\n' +
            lift(core, 'function ssOrgFingerprint(key)') + '\n' +
            lift(core, 'function ssNoteOrgUse()') + ';return ssNoteOrgUse;')
            (s.chrome, 'ssFeatureUse', Promise, URL)();

        await note('https://acme.my.salesforce.com');
        await note('https://acme.lightning.force.com');
        assert.strictEqual(s.bag.ssFeatureUse.orgs, 1,
            'two hosts of one org are one org - the key folds them together');

        await note('https://other.my.salesforce.com');
        assert.strictEqual(s.bag.ssFeatureUse.orgs, 2, 'and a different org is a second');

        /*
         * An org already counted writes nothing. Every page load in the same
         * org would otherwise rewrite the whole tally - which is not wrong,
         * just a write per page for a number that has not changed.
         */
        const before = s.writes;
        await note('https://acme.my.salesforce.com');
        assert.strictEqual(s.writes, before,
            'a familiar org is recognised and left alone, not rewritten on every ' +
            'page load');
        assert.strictEqual(s.bag.ssFeatureUse.orgs, 2, 'and the count is unchanged');

        /*
         * A count, not a record of which. Keeping the names would be building
         * a list of somebody's customers for no better reason than that it
         * was easy - so what is stored is a set of org keys and what is shown
         * is its size.
         */
        assert.strictEqual(typeof s.bag.ssFeatureUse.orgs, 'number', 'the figure is a number');

        /*
         * Counting distinct orgs means remembering which have been seen, and
         * the first version of this remembered the org keys - a list of
         * somebody's clients in browser storage. What is kept now is a digest
         * that answers "have I seen this one" and nothing else.
         */
        const kept = JSON.stringify(s.bag.ssFeatureUse);
        for (const name of ['acme', 'other', 'salesforce', 'force.com']) {
            assert.ok(!kept.includes(name),
                'no org name survives in storage - found "' + name + '" in ' + kept);
        }

        const fingerprint = new Function(
            lift(core, 'function ssOrgFingerprint(key)') + ';return ssOrgFingerprint;')();
        assert.strictEqual(fingerprint('acme'), fingerprint('acme'),
            'the digest is stable, or the same org is counted again on every visit');
        assert.notStrictEqual(fingerprint('acme'), fingerprint('acme--sandbox1'),
            'and a sandbox is not its production org');
        assert.ok(!fingerprint('acme').includes('acme'), 'and it is not the name in disguise');

        /*
         * A plain unsigned hex word. Dropping the >>> 0 leaves the arithmetic
         * in floating point and the digest comes out as "-c99595a4.33cb98" -
         * still deterministic, but a signed fraction used as a storage key,
         * which is not what anyone reading this store would expect to find.
         */
        for (const key of ['acme', 'acme--sandbox1', 'a', 'a-very-long-org-key-indeed']) {
            assert.ok(/^[0-9a-f]{1,8}$/.test(fingerprint(key)),
                'the fingerprint is an unsigned hex word: ' + key + ' -> ' +
                fingerprint(key));
        }

        /*
         * Distinct keys stay distinct. Determinism alone is not enough - a
         * digest that loses precision on longer keys collides, and two orgs
         * that collide are counted as one for ever after.
         */
        const marks = new Set();
        const keys = [];
        for (let i = 0; i < 500; i++) {
            keys.push('customer' + i + '--sandbox' + i + '.long.enough.to.overflow.a.float');
        }
        keys.forEach((k) => marks.add(fingerprint(k)));
        assert.strictEqual(marks.size, keys.length,
            'no two org keys share a fingerprint - ' + (keys.length - marks.size) +
            ' collisions in ' + keys.length);
    }

    /* ------------------------------------------------------------------ */
    /* Counted where the thing happened                                    */
    /* ------------------------------------------------------------------ */

    const save = lift(recordFields, '    function save() {');
    /* ------------------------------------------------------------------ */
    /* The deployment features, which is most of what this release added   */
    /* ------------------------------------------------------------------ */

    /*
     * Every counter that is written must have a tile, or it is a number
     * nobody ever sees - and every tile must have a counter, or it is a row
     * that can only ever say zero. Both halves are checked, because the two
     * lists live in different places and drift apart quietly.
     */
    const tileSource = controller.slice(controller.indexOf('function featureUseTiles'),
        controller.indexOf('$scope.featureUseTiles = featureUseTiles'));
    const tileKeys = [...tileSource.matchAll(/key:\s*'(\w+)'/g)].map((m) => m[1]);

    ['syncStaged', 'syncDataStaged', 'syncApplied', 'syncRetried', 'syncQuickDeployed',
     'componentsDeployed', 'recordsWritten'].forEach((key) => {
        assert.ok(tileKeys.includes(key),
            'Usage Analytics must show ' + key + ' - it is counted and would ' +
            'otherwise be a number nobody sees');
    });

    /*
     * The two lists reconcile, in both directions.
     *
     * A counter with no tile is a number nobody ever sees; a tile with no
     * counter is a row that can only say zero, which reads as "nobody uses
     * this feature" rather than "nothing counts it". The lists live in
     * different files and drift apart quietly, so this checks the whole of
     * both rather than the handful named above.
     */
    const counted = new Set(
        [...(controller + recordFields + listExport + bootstrap)
            .matchAll(/ssCountUse\(\s*'(\w+)'/g)].map((m) => m[1]));
    /* The ones written through a variable, from the labels runJob is given. */
    [...controller.matchAll(/runJob\([^)]*'(\w+)'\)/g)].forEach((m) => counted.add(m[1]));
    /* And the org tally, which has its own helper. */
    if (/ssNoteOrgUse/.test(controller + bootstrap)) { counted.add('orgs'); }

    const shown = new Set(tileKeys);

    const unseen = [...counted].filter((key) => !shown.has(key));
    assert.deepStrictEqual(unseen, [],
        'counted but never shown in Usage Analytics: ' + unseen.join(', '));

    const uncounted = [...shown].filter((key) => !counted.has(key));
    assert.deepStrictEqual(uncounted, [],
        'shown in Usage Analytics but never counted, so it can only read zero: ' +
        uncounted.join(', '));

    /*
     * The applied/retried/quick-deploy counters are written through a
     * variable, so a grep for the literal finds nothing. They come from the
     * labels these three pass to runJob.
     */
    ['syncApplied', 'syncRetried', 'syncQuickDeployed'].forEach((label) => {
        assert.ok(new RegExp("runJob\\([^)]*'" + label + "'\\)").test(controller),
            label + ' is passed to runJob as the thing to count');
    });

    /*
     * What landed, not only what was pressed.
     *
     * "12 jobs applied" cannot tell a dozen deploys of one class from a dozen
     * of a hundred, and a failed job moved nothing at all - so the outcome is
     * counted from the finished job.
     */
    const outcome = controller.slice(controller.indexOf('function syncCountOutcome'),
        controller.indexOf('function runJob'));
    assert.ok(/done\.state !== 'succeeded'/.test(outcome),
        'only a job that succeeded counts as work done');
    assert.ok(/result\.checkOnly\)\{ return; \}/.test(outcome),
        'a validation deployed nothing - it only proved it could');
    assert.ok(/recordsWritten', Number\(result\.upserted\)/.test(outcome),
        'records written comes from what the org accepted');
    assert.ok(/componentsDeployed', Number\(result\.deployed\)/.test(outcome),
        'and components deployed from what it deployed');

    /* And it is actually called - a counter nothing invokes is a counter that
     * always reads zero, which looks identical to a feature nobody uses. */
    const runner = controller.slice(controller.indexOf('function runJob(job, how, label)'),
        controller.indexOf('$scope.syncApply = function'));
    assert.ok(/syncCountOutcome\(answer\)/.test(runner),
        'every finished run reports what it moved');

    assert.ok(/ssCountUse\('recordsEdited', 1\)/.test(save) &&
              /ssCountUse\('fieldsEdited', count\)/.test(save),
        'an edit is counted on the save');
    const onSaved = /saveChanges\([\s\S]*?\.then\(function \(\) \{([\s\S]*?)\}, function \(error\)/.exec(save);
    assert.ok(onSaved && /ssCountUse/.test(onSaved[1]),
        'in the success branch - an attempt the org refused is not an edit, and ' +
        'counting it would make the tally a measure of typing');

    const download = lift(listExport, '    function download(kind) {');
    assert.ok(/ssCountUse\('exports', 1\)/.test(download) &&
              /ssCountUse\('recordsExported', flat\.length\)/.test(download),
        'an export counts the file and what went in it');
    assert.ok(download.indexOf("ssCountUse('exports'") > download.indexOf('if (!matches.length) { return; }'),
        'and only once there is something to write');

    for (const [name, key] of [['sendRest', 'restCalls'],
                               ['downloadPackageXml', 'manifests']]) {
        assert.ok(new RegExp("ssCountUse\\('" + key + "'").test(controller),
            name + ' is counted');
    }
    assert.ok(/ssCountUse\('objectsDescribed', 1\)/.test(controller), 'describes are counted');
    assert.ok(/ssCountUse\('bulkJobsChecked', 1\)/.test(controller), 'bulk lookups are counted');
    assert.ok(/ssCountUse\('componentsWatched', 1\)/.test(controller), 'watches are counted');

    /* Every call site is guarded - ss-core may not be there in every context. */
    /*
     * Every call, not most of them. A count is not worth an exception, and one
     * unguarded call in a context without ss-core is a feature that throws for
     * a tally nobody asked for.
     */
    for (const [name, source] of [['controller', controller], ['record-fields', recordFields],
                                  ['list-export', listExport], ['bootstrap', bootstrap]]) {
        const all = source.split('\n');
        all.forEach((line, index) => {
            if (!/ssCountUse\(|ssNoteOrgUse\(\)/.test(line)) { return; }
            if (/^\s*[*/]/.test(line.trim())) { return; }          // a comment about it
            if (/function ssCountUse|function ssNoteOrgUse/.test(line)) { return; }

            /*
             * The guard is on this line, or on one of the few above it - a
             * multi-line block opens with the check and calls inside it. Any
             * further away and it is not guarding this call.
             */
            const window = all.slice(Math.max(0, index - 4), index + 1).join('\n');
            assert.ok(/typeof ssCountUse === 'function'|typeof ssNoteOrgUse === 'function'/
                .test(window),
                name + ' line ' + (index + 1) + ': unguarded counter call - ' +
                line.trim());
        });
    }
    const blocks = (controller + recordFields + listExport + bootstrap)
        .match(/typeof ssCountUse === 'function'|typeof ssNoteOrgUse === 'function'/g) || [];
    assert.ok(blocks.length >= 8,
        'and there are guards on every site, found ' + blocks.length);

    /* The org page counts itself, where it is known to be an org page. */
    assert.ok(/ssNoteOrgUse\(\)/.test(bootstrap), 'an org page is counted');
    assert.ok(bootstrap.indexOf('ssIsOrgPage()') < bootstrap.indexOf('ssNoteOrgUse()'),
        'after the org check - a key taken from a login host would be an org ' +
        'that does not exist');

    /* ------------------------------------------------------------------ */
    /* Shown                                                               */
    /* ------------------------------------------------------------------ */

    const tiles = new Function('$scope',
        lift(controller, 'function featureUseTiles(){') + ';return featureUseTiles;');

    const withCounts = tiles({ featureUse: { orgs: 3, exports: 2 } })();
    const byKey = Object.fromEntries(withCounts.map((t) => [t.key, t]));
    assert.strictEqual(byKey.orgs.value, 3, 'a counted feature shows its number');
    assert.strictEqual(byKey.restCalls.value, 0,
        'and one never used is zero rather than undefined - the template shows a ' +
        'number, not a blank');
    assert.ok(byKey.orgs.label && byKey.recordsExported.label, 'each has a label');

    const empty = tiles({ featureUse: {} })();
    assert.ok(empty.every((t) => t.value === 0), 'nothing used is all zeros');
    assert.ok(tiles({})().length > 5, 'and no counts at all is not a crash');

    /* ------------------------------------------------------------------ */
    /* Built once, not on every digest                                     */
    /*                                                                     */
    /* This was a function bound straight into ng-repeat, returning a fresh */
    /* array of fresh objects each call. ngRepeat watches its collection    */
    /* with $watchCollection, which compares elements by identity - so the  */
    /* digest never settled and Angular stopped with $rootScope:infdig.     */
    /* track by does not help: it decides which DOM node belongs to which   */
    /* item, long after the watcher has fired.                             */
    /* ------------------------------------------------------------------ */

    const build = new Function('$scope', 'featureUseTiles',
        lift(controller, 'function buildFeatureUse(counts){') + ';return buildFeatureUse;');

    const scope = { featureUse: {} };
    build(scope, tiles(scope))({ exports: 2, orgs: 1 });

    assert.ok(Array.isArray(scope.featureUseList), 'the template binds to an array');
    assert.strictEqual(scope.featureUseAny, true, 'and to a boolean, not a call');
    assert.strictEqual(typeof scope.featureUseAny, 'boolean',
        'featureUseAny is a value - a function here is one more thing evaluated ' +
        'on every digest');
    assert.deepStrictEqual(scope.featureUseList.map((t) => t.key).sort(), ['exports', 'orgs'],
        'holding only the counters that have counted something');

    const untouched = { featureUse: {} };
    build(untouched, tiles(untouched))({});
    assert.deepStrictEqual(untouched.featureUseList, [], 'nothing used is an empty list');
    assert.strictEqual(untouched.featureUseAny, false, 'and says so');

    /*
     * The binding itself. A function in ng-repeat is the fault this section
     * exists for, and it is invisible until the page is opened.
     */
    const usagePage = view.slice(view.indexOf('this.usageanalytics ='),
                                 view.indexOf('\nthis.', view.indexOf('this.usageanalytics =') + 10));
    const repeats = [...usagePage.matchAll(/ng-repeat="[^"]*in ([A-Za-z_$][\w.$]*)\s*(?:\|[^"]*)?(?:track by[^"]*)?"/g)]
        .map((m) => m[1]);
    repeats.forEach((expression) => {
        assert.ok(!/\(\)$/.test(expression),
            'ng-repeat must not iterate a function call - a fresh array each ' +
            'digest never settles: ' + expression);
    });
    assert.ok(/ng-repeat="tile in featureUseList track by tile\.key"/.test(usagePage),
        'the tiles iterate the prepared array');

    /*
     * And something fills it. Testing the builder in isolation says nothing
     * about whether it is ever called - the counts would load, the array would
     * stay empty, and the page would say "nothing counted yet" for ever.
     */
    const refresh = lift(controller, '    function refreshUsage(){');
    assert.ok(/buildFeatureUse\(counts\)/.test(refresh),
        'the counts are turned into the list when they arrive');
    assert.ok(/ssUsageCounts\(\)/.test(refresh), 'from the shared tally');
    assert.ok(!/featureUseAny\(\)/.test(usagePage),
        'and the empty state reads the flag rather than calling for it');

    /*
     * Nothing used yet is a different thing from a page that failed to load,
     * and eleven tiles of zero says less than four tiles of something.
     */
    assert.ok(/ng-show="!featureUseAny"/.test(view),
        'an empty tally explains itself rather than showing zeros');
    assert.ok(/return tile\.value > 0;/.test(controller),
        'and a counter at zero is left out of the list rather than hidden in the ' +
        'template - a hidden element is still an element ngRepeat maintains');
    assert.ok(/none of it is sent anywhere/.test(view),
        'the page says where these figures live, since every other figure on it ' +
        'came from the org');

    console.log('feature usage test passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
