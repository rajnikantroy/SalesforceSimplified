/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');

/*
 * Exporting the graph.
 *
 * The PDF gets most of the attention here because it is the only format this
 * codebase writes by hand, and the ways it goes wrong are all silent: a
 * cross-reference offset out by one byte, or a single multi-byte character in
 * a string, produces a file that downloads happily and then will not open. So
 * the assertions parse the output back rather than pattern-matching it.
 *
 * The other property worth protecting is that SVG and PDF are two renderers
 * over one drawing. If they ever diverge, the picture somebody exports stops
 * matching the picture they were looking at, and nothing on screen would say
 * so - which is why the shape counts are compared between them.
 */

const Model = require('../js/event-graph/ss-event-model.js');
const Store = require('../js/event-graph/ss-event-store.js');
const Correlation = require('../js/event-graph/ss-correlation.js');
const Trace = require('../js/event-graph/ss-trace.js');
const RecordGraph = require('../js/event-graph/ss-record-graph.js');
const Export = require('../js/event-graph/ss-export.js');

function build() {
    const mk = (type, id, name, created, by, refs, nameField) =>
        RecordGraph.eventsForRecord(
            Object.assign({ Id: id, CreatedDate: created, CreatedById: by,
                            LastModifiedDate: created, [nameField]: name },
                refs.reduce((a, r) => (a[r.f] = r.id, a), {})),
            { objectType: type, selection: { nameField: nameField },
              parentLinks: refs.map((r) => ({ field: r.f, masterDetail: r.md })) });

    const raw = []
        .concat(mk('Account', '001XX0000000009', 'Acme Industries',
            '2025-01-04T09:00:00Z', '005CCC', [], 'Name'))
        .concat(mk('Case', '500XX0000012345', '00012',
            '2026-08-10T09:00:00Z', '005AAA',
            [{ f: 'AccountId', id: '001XX0000000009' }], 'CaseNumber'))
        .concat(mk('Order', '801XX0000000001', '00045',
            '2026-08-10T09:00:05Z', '005AAA',
            [{ f: 'CaseId__c', id: '500XX0000012345' }], 'OrderNumber'))
        /*
         * A failure carrying a card number, so both the red path and the
         * redaction path are exercised. Attached to the Order rather than
         * floating: an event the trace cannot reach is not exported at all,
         * and a redaction assertion against an absent event proves nothing.
         */
        .concat([{
            eventType: 'HTTP_RESPONSE', timestamp: '2026-08-10T09:00:06Z',
            traceId: 'txn-1', source: { kind: 'external' }, duration: 400,
            component: { kind: 'restApi', name: 'erp.example.com' },
            entity: { type: 'Order', id: '801XX0000000001' },
            status: 'failure', error: { code: 403, message: 'Refused' },
            input: { card: '4111111111111111', amount: 240 }
        }]);

    const store = new Store.EventStore();
    store.ingest(raw);
    const structural = RecordGraph.relationshipsFor(store.all());
    const merged = Correlation.mergeRelationships(
        Correlation.correlate(store.all(), {}).relationships.concat(structural));
    const graph = Trace.buildGraph(store.all(), merged);
    const built = Trace.buildTrace(graph, {
        kind: 'record', id: '500XX0000012345', view: 'ALL', grouping: false
    });
    built.gaps = [{ id: 'debugLog', label: 'Apex debug logs', missing: 'Nothing captured.' }];
    return { built, store };
}

/* A deliberately small PDF reader: enough to prove the file is structurally
 * sound, which is the only thing worth asserting about one. */
function parsePdf(text) {
    const startxref = text.lastIndexOf('startxref');
    assert.notStrictEqual(startxref, -1, 'a PDF must have startxref');
    const xrefAt = parseInt(text.slice(startxref + 9).trim().split(/\s/)[0], 10);

    assert.strictEqual(text.slice(xrefAt, xrefAt + 4), 'xref',
        'startxref must point at the xref table, got: ' +
        JSON.stringify(text.slice(xrefAt, xrefAt + 20)));

    const lines = text.slice(xrefAt).split('\n');
    const count = parseInt(lines[1].split(' ')[1], 10);
    const offsets = [];
    for (let i = 3; i < 2 + count; i++) {
        offsets.push(parseInt(lines[i].slice(0, 10), 10));
    }
    return { xrefAt, count, offsets };
}

function main() {

    const { built } = build();

    /* ------------------------------------------------------------------ */
    /* 1. The drawing is built from the layout, not from the DOM           */
    /* ------------------------------------------------------------------ */

    const drawing = Export.buildDrawing(built, {
        title: 'Event Graph — 500XX0000012345',
        subtitle: 'Org: acme   ·   View: ALL',
        footer: 'Exported for the test'
    });

    assert.ok(drawing.width > 100 && drawing.height > 100, 'the drawing has a size');
    assert.ok(drawing.items.length > 10, 'and something in it');

    const kinds = {};
    drawing.items.forEach((item) => { kinds[item.kind] = (kinds[item.kind] || 0) + 1; });
    assert.ok(kinds.rect > 0, 'nodes are drawn');
    assert.ok(kinds.curve > 0, 'edges are drawn');
    assert.ok(kinds.text > 0, 'labels are drawn');

    /* One node box plus one category stripe per node. */
    assert.ok(kinds.rect >= built.layout.positions.length * 2,
        'every node contributes a box and its category stripe');

    /*
     * No part of the export may reach into the page. A screenshot of the panel
     * would carry the extension's stylesheet, and would break the moment the
     * panel's markup changed.
     */
    const source = require('fs').readFileSync('./js/event-graph/ss-export.js', 'utf8');
    [/document\./, /querySelector/, /getElementById/, /window\.(?!SS)/, /canvas/i].forEach((p) => {
        assert.ok(!p.test(source), `the export module must not touch the DOM: found ${p}`);
    });

    /* ------------------------------------------------------------------ */
    /* 2. SVG                                                              */
    /* ------------------------------------------------------------------ */

    const svg = Export.toSVG(drawing);

    assert.ok(svg.startsWith('<svg'), 'it is an SVG');
    assert.ok(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg),
        'with the namespace, or nothing will render it as an image');
    assert.ok(svg.indexOf('</svg>') === svg.length - 6, 'and it is closed');

    assert.strictEqual((svg.match(/<rect /g) || []).length, kinds.rect + 1,
        'every rect is emitted, plus the background');
    assert.strictEqual((svg.match(/<path /g) || []).length, kinds.curve,
        'every edge is emitted');
    assert.strictEqual((svg.match(/<text /g) || []).length, kinds.text,
        'every label is emitted');

    /* Text is escaped, or an ampersand in a record name breaks the file. */
    const tricky = Export.toSVG(Export.buildDrawing(built, { title: 'A & B <script>' }));
    assert.ok(tricky.indexOf('A &amp; B &lt;script&gt;') !== -1,
        'markup in a label is escaped');
    assert.ok(tricky.indexOf('<script>') === -1, 'and cannot inject anything');

    /* ------------------------------------------------------------------ */
    /* 3. PDF structure                                                    */
    /* ------------------------------------------------------------------ */

    const pdf = Export.toPDF(drawing);

    assert.ok(pdf.startsWith('%PDF-1.4'), 'it declares itself a PDF');
    assert.ok(pdf.trimEnd().endsWith('%%EOF'), 'and terminates properly');

    const parsed = parsePdf(pdf);
    assert.strictEqual(parsed.count, 7, 'six objects plus the free entry');

    /*
     * Every offset must land exactly on its object header. This is the
     * assertion that matters: a table that is out by even one byte produces a
     * file that downloads without complaint and opens in nothing.
     */
    parsed.offsets.forEach((offset, index) => {
        const expected = (index + 1) + ' 0 obj';
        assert.strictEqual(pdf.slice(offset, offset + expected.length), expected,
            `xref offset ${index + 1} must point at "${expected}", found ` +
            JSON.stringify(pdf.slice(offset, offset + 20)));
    });

    /* The stream length must match what is actually between the keywords. */
    const declared = parseInt(pdf.match(/\/Length (\d+) >>\nstream/)[1], 10);
    const streamStart = pdf.indexOf('stream\n') + 'stream\n'.length;
    const streamEnd = pdf.indexOf('\nendstream');
    assert.strictEqual(streamEnd - streamStart, declared,
        'the declared stream length must match the real one');

    /* Both base-14 fonts are declared, so no font has to be embedded. */
    assert.ok(/\/BaseFont \/Helvetica[ /]/.test(pdf), 'Helvetica is declared');
    assert.ok(pdf.indexOf('/BaseFont /Helvetica-Bold') !== -1, 'and its bold face');

    /* ------------------------------------------------------------------ */
    /* 4. PDF encoding                                                     */
    /* ------------------------------------------------------------------ */

    /*
     * Single-byte throughout. The xref offsets are byte counts, so one
     * multi-byte character anywhere shifts every offset after it - and the
     * graph is full of arrows, multiplication signs and ellipses.
     */
    for (let i = 0; i < pdf.length; i++) {
        assert.ok(pdf.charCodeAt(i) <= 0xff,
            `PDF must be single-byte; found U+${pdf.charCodeAt(i).toString(16)} at ${i}`);
    }

    assert.strictEqual(Export.pdfText('New → Working'), 'New -> Working',
        'an arrow becomes something Helvetica can draw');
    assert.strictEqual(Export.pdfText('OrderItem × 3'), 'OrderItem x 3');
    assert.strictEqual(Export.pdfText('Truncated…'), 'Truncated...');
    assert.strictEqual(Export.pdfText('a (b) c\\d'), 'a \\(b\\) c\\\\d',
        'parentheses and backslashes are escaped, or the string ends early');
    assert.strictEqual(Export.pdfText('café ☕'), 'caf ', 'anything else is dropped');

    /*
     * Dashes and smart quotes, which are the characters that actually reach
     * here - they come from titles and from record names typed with smart
     * punctuation on. Dropping an em-dash silently left the exported title
     * reading "Event Graph  Case 00012", with a gap where the dash had been.
     */
    assert.strictEqual(Export.pdfText('Event Graph — Case 00012'),
        'Event Graph - Case 00012', 'an em-dash becomes a hyphen, not a hole');
    assert.strictEqual(Export.pdfText('Acme’s “Order”'), 'Acme\'s "Order"',
        'smart punctuation survives as its plain equivalent');

    /* A graph whose labels are full of the characters above still produces a
     * structurally valid file. */
    const awkward = Export.buildDrawing(built, { title: 'Case → Order × 3 …' });
    const awkwardPdf = Export.toPDF(awkward);
    parsePdf(awkwardPdf).offsets.forEach((offset, index) => {
        assert.strictEqual(awkwardPdf.slice(offset, offset + 5), (index + 1) + ' 0 o',
            'offsets survive characters that had to be replaced');
    });

    /* ------------------------------------------------------------------ */
    /* 5. SVG and PDF draw the same graph                                  */
    /* ------------------------------------------------------------------ */

    /*
     * Two renderers, one drawing. If these drift, an exported picture stops
     * matching what was on screen and nothing would report it.
     */
    const pdfCurves = (pdf.match(/ c\n/g) || []).length;
    const pdfText = (pdf.match(/\) Tj/g) || []).length;
    assert.strictEqual(pdfCurves, kinds.curve, 'the PDF draws every edge the SVG does');
    assert.strictEqual(pdfText, kinds.text, 'and every label');

    /* Colour survives the conversion. */
    assert.deepStrictEqual(Export.hexToRgb('#ffffff'), [1, 1, 1]);
    assert.deepStrictEqual(Export.hexToRgb('#000000'), [0, 0, 0]);
    assert.deepStrictEqual(Export.hexToRgb('#ef4444').map((n) => Math.round(n * 255)),
        [239, 68, 68], 'the failure red is the same red');

    /* ------------------------------------------------------------------ */
    /* 6. JSON carries the evidence, not just the shapes                   */
    /* ------------------------------------------------------------------ */

    const json = Export.toJSON(built, { org: 'acme', gaps: built.gaps });

    assert.strictEqual(json.format, 'salesforce-simplified/event-graph');
    assert.ok(json.events.length > 0 && json.relationships.length > 0);

    /* Round-trips as JSON - an export that will not parse is not an export. */
    const round = JSON.parse(JSON.stringify(json));
    assert.strictEqual(round.events.length, json.events.length);

    /*
     * Every relationship keeps its evidence and its confidence. This is the
     * whole reason the JSON export exists: a picture shows a line, and only
     * this says why the line is there and how far to trust it.
     */
    json.relationships.forEach((rel) => {
        assert.ok(rel.confidence, 'every exported relationship states its confidence');
        assert.ok(Array.isArray(rel.evidence), 'and carries its evidence');
    });
    assert.ok(json.relationships.some((rel) => rel.evidence.length > 0),
        'with at least some of it populated');

    /* The legend travels with the file, so a reader who has never seen the
     * panel knows what CONFIRMED and INFERRED mean. */
    assert.ok(json.legend.confidence.CONFIRMED && json.legend.confidence.INFERRED);
    assert.ok(json.legend.provenance.browser && json.legend.provenance.inferred);

    /* And so do the gaps. */
    assert.ok(json.gaps.length >= 1, 'the gaps are exported as loudly as they are shown');

    /* ------------------------------------------------------------------ */
    /* 7. Nothing redacted is un-redacted on the way out                   */
    /* ------------------------------------------------------------------ */

    /*
     * Redaction happens at ingest, so this should hold by construction - but
     * an export is exactly where a well-meaning "include the raw payload for
     * completeness" would get added, and it would leak a card number into a
     * file somebody emails.
     */
    const serialised = JSON.stringify(json);
    assert.ok(serialised.indexOf('4111111111111111') === -1,
        'a card number never appears in an export');
    assert.ok(/\*\*\*/.test(serialised), 'the masked form does');
    assert.ok(serialised.indexOf('redactions') !== -1,
        'and the export says what was removed');

    assert.ok(svg.indexOf('4111111111111111') === -1, 'nor in the SVG');
    assert.ok(pdf.indexOf('4111111111111111') === -1, 'nor in the PDF');

    /* ------------------------------------------------------------------ */
    /* 8. Filenames                                                        */
    /* ------------------------------------------------------------------ */

    const name = Export.filename(built, 'png');
    assert.ok(/^event-graph-500XX0000012345-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.png$/.test(name),
        'the filename names the record and the moment: ' + name);
    assert.ok(!/[/\\:*?"<>|]/.test(name), 'and is safe on every filesystem');

    /* ------------------------------------------------------------------ */
    /* 9. Degenerate graphs do not throw                                   */
    /* ------------------------------------------------------------------ */

    const empty = { root: { kind: 'record', id: 'x' }, view: 'ALL', stats: {},
                    graph: { nodes: [], edges: [] },
                    layout: { positions: [], byId: {}, width: 0, height: 0, columns: 0 } };

    const emptyDrawing = Export.buildDrawing(empty, {});
    assert.ok(Export.toSVG(emptyDrawing).indexOf('</svg>') !== -1,
        'an empty graph still produces a valid SVG');
    const emptyPdf = Export.toPDF(emptyDrawing);
    assert.ok(emptyPdf.trimEnd().endsWith('%%EOF'), 'and a valid PDF');
    parsePdf(emptyPdf);
    assert.ok(Export.toJSON(empty, {}).events.length === 0, 'and an empty JSON export');

    console.log('event graph export test passed');
}

main();
