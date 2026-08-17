/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Exporting a graph: JSON, SVG, PNG and PDF.
 *
 * The picture on screen is HTML nodes over an SVG edge layer, which is right
 * for something interactive and wrong for something to export - it carries the
 * panel's stylesheet, its fonts, and a dozen classes that mean nothing outside
 * the extension. So nothing here screenshots the DOM. The graph is redrawn
 * from the layout the trace already produced, into a small set of primitives:
 *
 *     rect, curve, line, text
 *
 * SVG and PDF are two renderers over that one list. They cannot drift apart,
 * because neither knows anything about graphs - they only know how to draw four
 * shapes. PNG is the SVG rasterised by the browser, so it is the same drawing
 * again rather than a third implementation.
 *
 * The PDF is written by hand. There is no build step in this extension and the
 * content security policy forbids loading a library from a CDN, so the choice
 * was between a real vector PDF of about two hundred lines or an image wrapped
 * in a PDF container. Vector won: the text stays selectable and searchable,
 * which is most of the reason to want a PDF of a diagram at all.
 *
 * On what leaves the browser: payloads were redacted on the way into the store,
 * so an export carries what the panel carries and nothing more. The JSON says
 * so per event, and the redaction list travels with it - an export that looked
 * complete while quietly omitting fields would be worse than one that did not
 * exist.
 */
(function (root) {
    'use strict';

    var Model = root.SSEventModel ||
        (typeof require !== 'undefined' ? require('./ss-event-model.js') : null);

    var NODE_W = 150;
    var NODE_H = 44;
    var PAD = 28;
    var LEGEND_H = 58;

    /* ------------------------------------------------------------------ */
    /* Colour                                                              */
    /* ------------------------------------------------------------------ */

    var CATEGORY_COLOUR = {
        UI: '#8b5cf6', SALESFORCE: '#0ea5e9', INTEGRATION: '#f97316',
        BUSINESS: '#10b981', AGENT: '#ec4899', CUSTOM: '#94a3b8'
    };

    var EDGE_COLOUR = {
        CONFIRMED: '#10b981', LIKELY: '#3b82f6',
        INFERRED: '#f59e0b', UNKNOWN: '#cbd5e1'
    };

    var STRUCTURAL_COLOUR = '#0ea5e9';
    var MASTER_DETAIL_COLOUR = '#0369a1';
    var SEQUENCE_COLOUR = '#e2e8f0';

    function edgeStyle(edge) {
        if (edge.relationshipType === 'FOLLOWED_BY') {
            return { colour: SEQUENCE_COLOUR, width: 1, dash: null };
        }
        if (edge.masterDetail) {
            return { colour: MASTER_DETAIL_COLOUR, width: 2.5, dash: null };
        }
        if (edge.relationshipType === 'PARENT_OF') {
            return { colour: STRUCTURAL_COLOUR, width: 2, dash: null };
        }
        var colour = EDGE_COLOUR[edge.confidence] || EDGE_COLOUR.UNKNOWN;
        var dash = edge.confidence === Model.CONFIDENCE.INFERRED ? [3, 3]
                 : edge.confidence === Model.CONFIDENCE.UNKNOWN ? [2, 4] : null;
        if (edge.bridged) { dash = [8, 4]; }
        return { colour: colour, width: edge.confidence === 'CONFIRMED' ? 2 : 1.5, dash: dash };
    }

    /* ------------------------------------------------------------------ */
    /* The drawing                                                         */
    /* ------------------------------------------------------------------ */

    function label(node) {
        if (node.entity && node.entity.name && node.eventType === 'RECORD_CREATE') {
            return node.entity.name;
        }
        return node.action || node.typeLabel || node.eventType || '';
    }

    function kindOf(node) {
        if (node.entity && node.entity.type) { return node.entity.type; }
        if (node.component && node.component.kind) { return node.component.kind; }
        return (node.category || '').toLowerCase();
    }

    /*
     * Truncated by measurement, roughly.
     *
     * Helvetica at 9pt averages about 0.5em per character, which is close
     * enough for a label that has a hard box to fit in - and far better than
     * letting it run past the node's edge, which is what a naive export does.
     */
    function fit(text, widthPx, size) {
        var perChar = size * 0.5;
        var max = Math.floor(widthPx / perChar);
        if (text.length <= max) { return text; }
        return text.slice(0, Math.max(1, max - 1)) + '…';
    }

    function buildDrawing(built, options) {
        options = options || {};
        var layout = built.layout;
        var items = [];

        var width = Math.max(layout.width, 320);
        var height = layout.height + LEGEND_H;

        /* Title band, so an exported picture says what it is of. */
        if (options.title) {
            items.push({ kind: 'text', x: PAD, y: 18, text: options.title,
                         size: 13, colour: '#0f172a', bold: true });
        }
        if (options.subtitle) {
            items.push({ kind: 'text', x: PAD, y: 33, text: options.subtitle,
                         size: 9, colour: '#64748b' });
        }
        var top = options.title ? 44 : 0;
        height += top;

        /* Edges first, so nodes sit over them - same order as the panel. */
        (built.graph.edges || []).forEach(function (edge) {
            var from = layout.byId[edge.sourceEventId];
            var to = layout.byId[edge.targetEventId];
            if (!from || !to || from === to) { return; }

            var style = edgeStyle(edge);
            var x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2 + top;
            var x2 = to.x, y2 = to.y + NODE_H / 2 + top;
            var bend = Math.max(24, Math.abs(x2 - x1) / 2);

            items.push({
                kind: 'curve',
                x1: x1, y1: y1,
                cx1: x1 + bend, cy1: y1,
                cx2: x2 - bend, cy2: y2,
                x2: x2, y2: y2,
                stroke: style.colour, width: style.width, dash: style.dash
            });
        });

        (layout.positions || []).forEach(function (item) {
            var node = item.node;
            var failed = node.status === Model.STATUS.FAILURE || !!node.error;
            var y = item.y + top;

            items.push({
                kind: 'rect',
                x: item.x, y: y, w: NODE_W, h: NODE_H,
                fill: failed ? '#fef2f2' : (node.outcome ? '#f0fdf4' : '#ffffff'),
                stroke: failed ? '#ef4444' : '#cbd5e1',
                width: 1, radius: 5,
                dash: node.state === 'inferred' || node.isGroup ? [3, 2] : null
            });

            /* The category stripe down the left edge, as on screen. */
            items.push({
                kind: 'rect',
                x: item.x, y: y, w: 3, h: NODE_H,
                fill: failed ? '#ef4444'
                    : (CATEGORY_COLOUR[node.category] || CATEGORY_COLOUR.CUSTOM),
                stroke: null, width: 0, radius: 0
            });

            items.push({
                kind: 'text', x: item.x + 8, y: y + 13,
                text: fit(String(kindOf(node)).toUpperCase(), NODE_W - 16, 7),
                size: 7, colour: '#94a3b8'
            });
            items.push({
                kind: 'text', x: item.x + 8, y: y + 26,
                text: fit(label(node), NODE_W - 16, 9),
                size: 9, colour: '#0f172a'
            });

            var meta = [];
            if (node.actor && node.actor.name) { meta.push(node.actor.name); }
            if (node.duration) { meta.push(node.duration + 'ms'); }
            if (meta.length) {
                items.push({
                    kind: 'text', x: item.x + 8, y: y + 38,
                    text: fit(meta.join(' · '), NODE_W - 16, 7),
                    size: 7, colour: '#64748b'
                });
            }
        });

        /* The legend, because a picture of coloured lines with no key is a
         * picture of coloured lines. */
        var legendY = height - LEGEND_H + 18;
        items.push({ kind: 'line', x1: PAD, y1: legendY - 12,
                     x2: width - PAD, y2: legendY - 12, stroke: '#e2e8f0', width: 1 });

        var legend = [
            { text: 'Confirmed', colour: EDGE_COLOUR.CONFIRMED },
            { text: 'Likely', colour: EDGE_COLOUR.LIKELY },
            { text: 'Inferred', colour: EDGE_COLOUR.INFERRED },
            { text: 'Lookup', colour: STRUCTURAL_COLOUR },
            { text: 'Master-detail', colour: MASTER_DETAIL_COLOUR }
        ];

        var lx = PAD;
        legend.forEach(function (entry) {
            items.push({ kind: 'line', x1: lx, y1: legendY - 3, x2: lx + 16, y2: legendY - 3,
                         stroke: entry.colour, width: 2 });
            items.push({ kind: 'text', x: lx + 21, y: legendY,
                         text: entry.text, size: 8, colour: '#475569' });
            lx += 24 + entry.text.length * 4.6 + 14;
        });

        if (options.footer) {
            items.push({ kind: 'text', x: PAD, y: legendY + 16,
                         text: options.footer, size: 7, colour: '#94a3b8' });
        }

        return {
            width: Math.max(width, lx + PAD),
            height: height,
            items: items,
            background: '#ffffff'
        };
    }

    /* ------------------------------------------------------------------ */
    /* SVG                                                                 */
    /* ------------------------------------------------------------------ */

    function escapeXml(text) {
        return String(text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    function toSVG(drawing) {
        var parts = [];
        parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + drawing.width +
                   '" height="' + drawing.height + '" viewBox="0 0 ' + drawing.width +
                   ' ' + drawing.height + '">');
        parts.push('<rect width="100%" height="100%" fill="' + drawing.background + '"/>');
        /*
         * A font stack, not a font. The file has to open in a browser, in
         * Illustrator and in whatever the recipient has - naming one family
         * that may not exist gives different metrics everywhere.
         */
        parts.push('<g font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, ' +
                   'Helvetica, Arial, sans-serif">');

        drawing.items.forEach(function (item) {
            if (item.kind === 'rect') {
                parts.push('<rect x="' + item.x + '" y="' + item.y + '" width="' + item.w +
                    '" height="' + item.h + '"' +
                    (item.radius ? ' rx="' + item.radius + '"' : '') +
                    ' fill="' + (item.fill || 'none') + '"' +
                    (item.stroke ? ' stroke="' + item.stroke + '" stroke-width="' +
                        (item.width || 1) + '"' : '') +
                    (item.dash ? ' stroke-dasharray="' + item.dash.join(' ') + '"' : '') +
                    '/>');
            } else if (item.kind === 'curve') {
                parts.push('<path d="M' + item.x1 + ',' + item.y1 + ' C' + item.cx1 + ',' +
                    item.cy1 + ' ' + item.cx2 + ',' + item.cy2 + ' ' + item.x2 + ',' + item.y2 +
                    '" fill="none" stroke="' + item.stroke + '" stroke-width="' + item.width + '"' +
                    (item.dash ? ' stroke-dasharray="' + item.dash.join(' ') + '"' : '') + '/>');
            } else if (item.kind === 'line') {
                parts.push('<line x1="' + item.x1 + '" y1="' + item.y1 + '" x2="' + item.x2 +
                    '" y2="' + item.y2 + '" stroke="' + item.stroke + '" stroke-width="' +
                    (item.width || 1) + '"/>');
            } else if (item.kind === 'text') {
                parts.push('<text x="' + item.x + '" y="' + item.y + '" font-size="' + item.size +
                    '" fill="' + item.colour + '"' + (item.bold ? ' font-weight="700"' : '') +
                    '>' + escapeXml(item.text) + '</text>');
            }
        });

        parts.push('</g></svg>');
        return parts.join('\n');
    }

    /* ------------------------------------------------------------------ */
    /* PDF                                                                 */
    /* ------------------------------------------------------------------ */

    function hexToRgb(hex) {
        var value = String(hex || '#000000').replace('#', '');
        if (value.length === 3) {
            value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
        }
        return [
            parseInt(value.slice(0, 2), 16) / 255,
            parseInt(value.slice(2, 4), 16) / 255,
            parseInt(value.slice(4, 6), 16) / 255
        ].map(function (n) { return isNaN(n) ? 0 : Math.round(n * 1000) / 1000; });
    }

    /*
     * Helvetica is one of the fourteen fonts every PDF reader must provide, so
     * no font is embedded and the file stays small. The cost is the encoding:
     * WinAnsi has no arrow and no multiplication sign, and a byte outside it
     * renders as a random glyph. The characters this engine actually produces
     * are replaced rather than dropped, so "New -> Working" still reads.
     */
    function pdfText(text) {
        return String(text)
            .replace(/→/g, '->')
            .replace(/×/g, 'x')
            .replace(/…/g, '...')
            .replace(/·/g, '-')
            /* Dashes and quotes, which are the characters most likely to reach
             * here - they arrive in titles and in record names typed by people
             * with smart quotes switched on. Dropping an em-dash silently left
             * "Event Graph  Case 00012" with a gap where the dash had been. */
            .replace(/[—–]/g, '-')
            .replace(/[’‘]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[^\x20-\x7e]/g, '')
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
    }

    function toPDF(drawing) {
        var W = Math.ceil(drawing.width);
        var H = Math.ceil(drawing.height);

        /* PDF's origin is the bottom-left; the drawing's is the top-left. */
        function fy(y) { return Math.round((H - y) * 100) / 100; }
        function n(value) { return Math.round(value * 100) / 100; }

        var ops = [];
        var bg = hexToRgb(drawing.background);
        ops.push(bg.join(' ') + ' rg', '0 0 ' + W + ' ' + H + ' re f');

        drawing.items.forEach(function (item) {
            if (item.kind === 'rect') {
                var painted = false;
                if (item.fill && item.fill !== 'none') {
                    ops.push(hexToRgb(item.fill).join(' ') + ' rg');
                    painted = true;
                }
                if (item.stroke) {
                    ops.push(hexToRgb(item.stroke).join(' ') + ' RG',
                             n(item.width || 1) + ' w');
                    ops.push(item.dash ? '[' + item.dash.join(' ') + '] 0 d' : '[] 0 d');
                }
                ops.push(n(item.x) + ' ' + n(fy(item.y + item.h)) + ' ' +
                         n(item.w) + ' ' + n(item.h) + ' re');
                ops.push(painted && item.stroke ? 'B' : (item.stroke ? 'S' : 'f'));
            } else if (item.kind === 'curve') {
                ops.push(hexToRgb(item.stroke).join(' ') + ' RG', n(item.width) + ' w');
                ops.push(item.dash ? '[' + item.dash.join(' ') + '] 0 d' : '[] 0 d');
                ops.push(n(item.x1) + ' ' + n(fy(item.y1)) + ' m');
                ops.push(n(item.cx1) + ' ' + n(fy(item.cy1)) + ' ' +
                         n(item.cx2) + ' ' + n(fy(item.cy2)) + ' ' +
                         n(item.x2) + ' ' + n(fy(item.y2)) + ' c');
                ops.push('S');
            } else if (item.kind === 'line') {
                ops.push(hexToRgb(item.stroke).join(' ') + ' RG', n(item.width || 1) + ' w',
                         '[] 0 d');
                ops.push(n(item.x1) + ' ' + n(fy(item.y1)) + ' m');
                ops.push(n(item.x2) + ' ' + n(fy(item.y2)) + ' l', 'S');
            } else if (item.kind === 'text') {
                ops.push('BT', '/' + (item.bold ? 'F2' : 'F1') + ' ' + item.size + ' Tf');
                ops.push(hexToRgb(item.colour).join(' ') + ' rg');
                ops.push(n(item.x) + ' ' + n(fy(item.y)) + ' Td');
                ops.push('(' + pdfText(item.text) + ') Tj', 'ET');
            }
        });

        var content = ops.join('\n');

        var objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + ']' +
                ' /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
            '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
        ];

        /*
         * The cross-reference table is byte offsets, so every string above has
         * to be Latin-1 - which is why pdfText strips anything else. A single
         * multi-byte character would put every offset after it out by one and
         * the file would not open.
         */
        var header = '%PDF-1.4\n';
        var body = '';
        var offsets = [];

        objects.forEach(function (object, index) {
            offsets.push(header.length + body.length);
            body += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
        });

        var xrefAt = header.length + body.length;
        var xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
        offsets.forEach(function (offset) {
            xref += String(offset).padStart(10, '0') + ' 00000 n \n';
        });

        var trailer = 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\n' +
                      'startxref\n' + xrefAt + '\n%%EOF\n';

        return header + body + xref + trailer;
    }

    /* ------------------------------------------------------------------ */
    /* JSON                                                                */
    /* ------------------------------------------------------------------ */

    /*
     * The whole graph, not a picture of it.
     *
     * This is the export that matters most for this product: every event with
     * its provenance and confidence, every relationship with the evidence
     * behind it, and the gaps the engine could not fill. A consumer can rebuild
     * the graph, audit a conclusion, or diff two traces - none of which a PNG
     * allows.
     */
    function toJSON(built, options) {
        options = options || {};
        var nodes = (built.graph && built.graph.nodes) || [];
        var edges = (built.graph && built.graph.edges) || [];

        return {
            format: 'salesforce-simplified/event-graph',
            version: 1,
            exportedAt: new Date().toISOString(),
            org: options.org || null,
            root: built.root || null,
            view: built.view || null,
            stats: built.stats || null,

            /* What the reader must know before trusting any of it. */
            legend: {
                confidence: {
                    CONFIRMED: 'Something in the data ties these two together explicitly.',
                    LIKELY: 'Ordering plus a known relationship. Not recorded as a fact.',
                    INFERRED: 'Proximity only. Often right, never evidence.',
                    UNKNOWN: 'The reason did not survive.'
                },
                provenance: Model.PROVENANCE_LABEL,
                redaction: 'Payloads were redacted before storage. Each event lists what ' +
                           'was removed and why under privacy.redactions.'
            },

            events: nodes.map(function (node) {
                if (node.isGroup) {
                    return {
                        eventId: node.eventId, isGroup: true, count: node.count,
                        action: node.action,
                        members: (node.members || []).map(function (m) { return m.eventId; })
                    };
                }
                return node;
            }),

            relationships: edges.map(function (edge) {
                return {
                    relationshipId: edge.relationshipId,
                    from: edge.sourceEventId,
                    to: edge.targetEventId,
                    type: edge.relationshipType,
                    confidence: edge.confidence,
                    state: edge.state,
                    rule: edge.rule || null,
                    evidence: edge.evidence || [],
                    bridged: !!edge.bridged,
                    lookupField: edge.lookupField || null
                };
            }),

            /* Stated as loudly in the file as on screen. */
            gaps: options.gaps || built.gaps || [],
            problems: options.problems || built.problems || [],
            inventory: options.inventory || null
        };
    }

    /* ------------------------------------------------------------------ */
    /* Filenames                                                           */
    /* ------------------------------------------------------------------ */

    function filename(built, extension) {
        var root = built.root || {};
        var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        var subject = (root.id || root.kind || 'graph').replace(/[^\w.-]/g, '');
        return 'event-graph-' + subject + '-' + stamp + '.' + extension;
    }

    var api = {
        NODE_W: NODE_W,
        NODE_H: NODE_H,
        CATEGORY_COLOUR: CATEGORY_COLOUR,
        EDGE_COLOUR: EDGE_COLOUR,
        buildDrawing: buildDrawing,
        toSVG: toSVG,
        toPDF: toPDF,
        toJSON: toJSON,
        filename: filename,
        edgeStyle: edgeStyle,
        hexToRgb: hexToRgb,
        pdfText: pdfText,
        escapeXml: escapeXml
    };

    root.SSExport = api;
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof self !== 'undefined' ? self : this);
