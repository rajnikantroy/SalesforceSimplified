/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The Event Graph, joined up.
 *
 * The engine has its own tests and they pass without any of it being reachable
 * from the product. This is the other half: eight files that have to agree with
 * each other, none of which imports another, and every disagreement between
 * them fails silently in a different way.
 *
 *   a registry entry with no rank        - sorts into the metadata list
 *   a template with no directive         - renders nothing, no error
 *   a directive not in the panel body    - never mounted, no error
 *   an engine file missing from the      - Unknown provider, which aborts the
 *     manifest                             digest and blanks the whole panel
 *   a service injected but not loaded    - the same, on the standalone page only
 *
 * The last one is the reason this exists at all: the two surfaces load their
 * scripts from different files, and a service added to one and not the other
 * works perfectly in the panel and takes the standalone page down completely.
 */

const manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
const standalone = fs.readFileSync('./simplified.html', 'utf8');
const container = fs.readFileSync('./js/angular/services/MetaDataContainer.js', 'utf8');
const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const directives = fs.readFileSync('./js/angular/directives.js', 'utf8');
const service = fs.readFileSync('./js/angular/services/EventGraphService.js', 'utf8');

const contentScripts = manifest.content_scripts[0].js;

/* The engine, in the order it has to load: each file reads the ones above it
 * off the global at definition time. */
const ENGINE = [
    'ss-event-model.js',
    'ss-event-store.js',
    'ss-correlation.js',
    'ss-trace.js',
    'ss-replay.js',
    'ss-collectors.js',
    'ss-record-graph.js',
    'ss-analysis.js'
];

function main() {

    /* ------------------------------------------------------------------ */
    /* 1. Every engine file loads, on both surfaces, in dependency order   */
    /* ------------------------------------------------------------------ */

    ENGINE.forEach((file) => {
        const path = '/js/event-graph/' + file;
        assert.ok(fs.existsSync('.' + path), `${file} must exist`);
        assert.ok(contentScripts.indexOf(path) !== -1,
            `${file} must be in the manifest, or the panel gets an Unknown provider`);
        assert.ok(standalone.indexOf('js/event-graph/' + file) !== -1,
            `${file} must be in simplified.html, or the standalone page blanks`);
    });

    /*
     * Order, on both. ss-correlation reads SSEventModel off the global as it
     * defines itself, so loading it first yields a null Model and every rule
     * throws on the first trace - long after the mistake was made.
     */
    function positionsIn(list, mapper) {
        return ENGINE.map((file) => list.indexOf(mapper(file)));
    }

    const manifestOrder = positionsIn(contentScripts, (f) => '/js/event-graph/' + f);
    for (let i = 1; i < manifestOrder.length; i++) {
        assert.ok(manifestOrder[i] > manifestOrder[i - 1],
            `${ENGINE[i]} must load after ${ENGINE[i - 1]} in the manifest`);
    }

    const standaloneOrder = ENGINE.map((f) => standalone.indexOf('js/event-graph/' + f));
    for (let i = 1; i < standaloneOrder.length; i++) {
        assert.ok(standaloneOrder[i] > standaloneOrder[i - 1],
            `${ENGINE[i]} must load after ${ENGINE[i - 1]} in simplified.html`);
    }

    /* The engine loads before Angular and before anything that consumes it. */
    ENGINE.forEach((file) => {
        assert.ok(contentScripts.indexOf('/js/event-graph/' + file) <
                  contentScripts.indexOf('/js/angular/services/EventGraphService.js'),
            `${file} must load before the service that reads it`);
    });

    /* ------------------------------------------------------------------ */
    /* 2. The Angular service is loaded wherever it is injected            */
    /* ------------------------------------------------------------------ */

    assert.ok(contentScripts.indexOf('/js/angular/services/EventGraphService.js') !== -1,
        'EventGraphService must be in the manifest');
    assert.ok(standalone.indexOf('js/angular/services/EventGraphService.js') !== -1,
        'EventGraphService must be in simplified.html');

    const signature = controller.match(/app\.controller\('MenuAndDetailsCtrl',\s*function\(([^)]*)\)/);
    assert.ok(signature, 'the controller signature must still be readable');
    assert.ok(/\bEventGraphService\b/.test(signature[1]),
        'MenuAndDetailsCtrl must inject EventGraphService');

    /* ------------------------------------------------------------------ */
    /* 3. Menu entry, rank, template, directive, mount, dispatch           */
    /* ------------------------------------------------------------------ */

    assert.ok(/value:\s*"EventGraph"/.test(container),
        'the registry must carry an EventGraph entry');
    assert.ok(/label:\s*"Event Graph"/.test(container),
        'and it must be labelled for the menu');

    /*
     * Both casings, because populateMenus matches on the raw value and the
     * two spellings are the same entry. Missing one means the utility sorts
     * alphabetically into the org's metadata list instead of the System Apps
     * bar - which is silent, and is where the Notifications panel first landed.
     */
    const rank = controller.match(/var BOTTOM_UTILITY_KEYS = \{([\s\S]*?)\};/);
    assert.ok(rank, 'BOTTOM_UTILITY_KEYS must still exist');
    assert.ok(/'eventgraph':\s*\d+/.test(rank[1]), 'lower-case key must be ranked');
    assert.ok(/'EventGraph':\s*\d+/.test(rank[1]), 'and the capitalised one too');

    const lower = rank[1].match(/'eventgraph':\s*(\d+)/)[1];
    const upper = rank[1].match(/'EventGraph':\s*(\d+)/)[1];
    assert.strictEqual(lower, upper, 'both spellings must share a rank, or the bar sorts oddly');

    /* Ranks stay unique per entry, so the bar has one defined order. */
    const byRank = {};
    for (const entry of rank[1].matchAll(/'([^']+)':\s*(\d+)/g)) {
        const key = entry[1].toLowerCase();
        if (byRank[entry[2]] && byRank[entry[2]] !== key) {
            assert.fail(`rank ${entry[2]} is used by both ${byRank[entry[2]]} and ${key}`);
        }
        byRank[entry[2]] = key;
    }

    assert.ok(/this\.eventgraph\s*=/.test(view), 'ViewService must define the eventgraph template');
    assert.ok(/eventgraph:\s*'eventgraph'/.test(directives),
        'the directive must be registered against that template');
    assert.ok(/<eventgraph><\/eventgraph>/.test(view),
        'and mounted in SS_PANEL_BODY, or it never renders on either surface');

    assert.ok(/data\.value === 'EventGraph'/.test(controller),
        'openMetadata must have a branch for EventGraph');
    assert.ok(/\$scope\.loadEventGraph\s*=/.test(controller),
        'and loadEventGraph must exist on the scope');

    /* ------------------------------------------------------------------ */
    /* 4. Every handler the template calls exists                          */
    /*                                                                     */
    /* template_scope_bindings covers this for the whole view file. Done    */
    /* again here, scoped to eg*, because that test's failure names a       */
    /* handler without saying which panel it belongs to.                    */
    /* ------------------------------------------------------------------ */

    const template = view.slice(view.indexOf('this.eventgraph ='),
                                view.indexOf('this.restexplorer ='));
    assert.ok(template.length > 2000, 'the eventgraph template should be substantial');

    const handlers = new Set();
    for (const match of template.matchAll(/ng-(?:click|change)=\\?"(eg[A-Za-z]*)\s*\(/g)) {
        handlers.add(match[1]);
    }
    assert.ok(handlers.size >= 10, `expected many eg handlers, found ${handlers.size}`);

    const missing = [...handlers].filter((name) =>
        !new RegExp('\\$scope\\.' + name + '\\s*=').test(controller));
    assert.deepStrictEqual(missing, [],
        'eventgraph handlers with no $scope function: ' + missing.join(', '));

    /* ------------------------------------------------------------------ */
    /* 5. No nested controller                                             */
    /* ------------------------------------------------------------------ */

    /*
     * panel_compiles enforces that a nested controller is reached through
     * ng-if. This panel has none, and the assertion is that it stays that way
     * while it is mounted with ng-show - the combination that took the whole
     * extension down the last time it was written.
     */
    assert.ok(!/ng-controller/.test(template),
        'the eventgraph template must not introduce a nested controller ' +
        'while it is mounted with ng-show');

    /* ------------------------------------------------------------------ */
    /* 6. The engine cannot reach the network                              */
    /*                                                                     */
    /* The whole point of the js/event-graph split is that correlation and  */
    /* replay are pure. If a query creeps into them they stop being         */
    /* testable, and replay stops being provably read-only.                 */
    /* ------------------------------------------------------------------ */

    ENGINE.forEach((file) => {
        const source = fs.readFileSync('./js/event-graph/' + file, 'utf8');
        [/\bfetch\s*\(/, /XMLHttpRequest/, /\$\.ajax/, /chrome\.runtime/, /ssRestCall/,
         /sfdc\.query/].forEach((pattern) => {
            assert.ok(!pattern.test(source),
                `${file} must stay pure: found ${pattern}`);
        });
    });

    /*
     * And the service, which is allowed to query, must only ever read. A
     * write from an observability tool is never correct.
     */
    [/\.post\s*\(/, /method:\s*['"]POST/, /method:\s*['"]PATCH/, /method:\s*['"]PUT/,
     /method:\s*['"]DELETE/, /sfdc\.remove/].forEach((pattern) => {
        assert.ok(!pattern.test(service),
            `EventGraphService must only read from the org: found ${pattern}`);
    });

    /* ------------------------------------------------------------------ */
    /* 7. No AI endpoint is wired                                          */
    /*                                                                     */
    /* The specification asks for AI analysis and, in the same breath, that */
    /* complete Salesforce payloads are not sent to AI services by default. */
    /* Shipping a configured endpoint would resolve that tension in the     */
    /* wrong direction, so its absence is asserted rather than assumed.     */
    /* ------------------------------------------------------------------ */

    const analysis = fs.readFileSync('./js/event-graph/ss-analysis.js', 'utf8');
    [/api\.openai\.com/, /api\.anthropic\.com/, /generativelanguage/,
     /\bfetch\s*\(/, /XMLHttpRequest/].forEach((pattern) => {
        assert.ok(!pattern.test(analysis),
            `the analysis layer must not call out: found ${pattern}`);
    });
    assert.ok(/ready:\s*false/.test(analysis),
        'the AI seam must declare itself unwired');

    /* ------------------------------------------------------------------ */
    /* 8. The stylesheet covers what the template asks for                 */
    /* ------------------------------------------------------------------ */

    const css = fs.readFileSync('./css/styles.css', 'utf8');
    ['ss-eg-node', 'ss-eg-edge', 'ss-eg-bar', 'ss-eg-inspector', 'ss-eg-replay',
     'ss-eg-gaps', 'ss-eg-conf', 'ss-eg-prov', 'ss-eg-redactions'].forEach((className) => {
        assert.ok(css.indexOf('.' + className) !== -1,
            `.${className} is used by the template but has no rule`);
    });

    /* Each confidence and provenance the model can emit must be styled, or a
     * value renders with no colour and reads as "no opinion". */
    const model = require('../js/event-graph/ss-event-model.js');
    Object.keys(model.CONFIDENCE).forEach((key) => {
        assert.ok(css.indexOf('.ss-eg-conf.is-' + key) !== -1 || key === 'UNKNOWN',
            `confidence ${key} has no style`);
    });
    Object.keys(model.PROVENANCE).forEach((key) => {
        const value = model.PROVENANCE[key];
        assert.ok(css.indexOf('.ss-eg-prov.is-' + value) !== -1,
            `provenance ${value} has no style`);
    });

    console.log('event graph wiring test passed');
}

main();
