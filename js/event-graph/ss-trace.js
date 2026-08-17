/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * The trace engine: from a graph of everything to the story of one thing.
 *
 * Three jobs, in order.
 *
 *   traverse  - from a root, reach what is connected to it. Upstream is "what
 *               led here", downstream is "what this caused", and they are
 *               genuinely different questions - the answer to why an order
 *               failed is upstream, the answer to what the failure cost is
 *               downstream.
 *
 *   project   - the same subgraph, seen as a user journey, a record's life, a
 *               technical execution path, a business transaction or an agent's
 *               work. These are not five datasets. They are five sets of nodes
 *               kept, with the paths through the hidden ones preserved so a
 *               chain never appears broken because a middle step was filtered.
 *
 *   arrange   - group the repetition, lay it out in time, and hand the view
 *               something it can draw and animate without doing any thinking
 *               of its own.
 *
 * Projection is where most tools cheat, by building a separate query per view
 * and letting the five drift apart until they contradict each other. Bridging
 * is the honest alternative and it costs one thing worth stating plainly: an
 * edge that spans hidden nodes is only ever as strong as the weakest step it
 * replaced, and it says so.
 */
(function (root) {
    'use strict';

    var Model = root.SSEventModel ||
        (typeof require !== 'undefined' ? require('./ss-event-model.js') : null);
    var Correlation = root.SSCorrelation ||
        (typeof require !== 'undefined' ? require('./ss-correlation.js') : null);

    var VIEW = {
        USER:      'USER',
        RECORD:    'RECORD',
        TECHNICAL: 'TECHNICAL',
        BUSINESS:  'BUSINESS',
        AGENT:     'AGENT',
        ALL:       'ALL'
    };

    /*
     * What each view keeps.
     *
     * A predicate per view rather than a list of types, so a type registered
     * later by a package lands in the right views without this file changing -
     * the same openness the event registry has.
     *
     * The second argument is what the subgraph as a whole contains, and it
     * exists because two of these views are otherwise wrong in opposite ways.
     * A business view built from event types alone let a button click in on
     * the grounds that the record behind it was an Order - a UI event in a
     * view that is meant to be about the transaction. And an agent view showed
     * a lone business outcome on traces with no agent in them at all, because
     * "agent → outcome" was read as "outcome always belongs here". Both are
     * decisions about the trace, not about the event, so both need to see it.
     */
    var VIEW_KEEPS = {
        USER: function (event) {
            return event.category === Model.CATEGORY.UI ||
                   event.outcome ||
                   (event.actor && event.actor.kind === Model.ACTOR_KIND.USER &&
                    event.category === Model.CATEGORY.SALESFORCE &&
                    /RECORD_/.test(event.eventType));
        },
        RECORD: function (event) {
            return !!(event.entity && event.entity.id) ||
                   event.category === Model.CATEGORY.BUSINESS;
        },
        TECHNICAL: function (event) {
            return event.category === Model.CATEGORY.SALESFORCE ||
                   event.category === Model.CATEGORY.INTEGRATION ||
                   event.category === Model.CATEGORY.CUSTOM;
        },
        /*
         * The transaction, not the clicking. A record change to a business
         * object belongs here; opening that record does not.
         */
        BUSINESS: function (event) {
            if (event.category === Model.CATEGORY.UI) { return false; }
            return event.category === Model.CATEGORY.BUSINESS ||
                   event.outcome ||
                   (event.entity && BUSINESS_ENTITIES.indexOf(event.entity.type) !== -1 &&
                    event.category === Model.CATEGORY.SALESFORCE);
        },
        /*
         * Outcomes are what an agent's work was for, so they belong - but only
         * where there was an agent. On a trace with none, an outcome on its own
         * is not an agent view, it is one unexplained node.
         */
        AGENT: function (event, context) {
            var isAgent = event.category === Model.CATEGORY.AGENT ||
                (event.actor && event.actor.kind === Model.ACTOR_KIND.AGENT);
            if (isAgent) { return true; }
            return event.outcome && context && context.hasAgent;
        },
        ALL: function () { return true; }
    };

    /* What the subgraph contains, for the views that need to know. */
    function viewContext(nodes) {
        return {
            hasAgent: (nodes || []).some(function (event) {
                return event.category === Model.CATEGORY.AGENT ||
                    (event.actor && event.actor.kind === Model.ACTOR_KIND.AGENT);
            })
        };
    }

    /*
     * The objects a business transaction is usually told in.
     *
     * A hint for the business view, never a gate: anything carrying a business
     * event type or a terminal outcome is in that view regardless, so an org
     * whose transactions run on custom objects is not left with an empty
     * screen. Orgs differ, and a fixed list is exactly the assumption that
     * makes a tool useless in the org it was not written for.
     */
    var BUSINESS_ENTITIES = [
        'Account', 'Contact', 'Case', 'Opportunity', 'Order', 'OrderItem',
        'Contract', 'Quote', 'Invoice', 'Payment', 'Document', 'Asset'
    ];

    /* ------------------------------------------------------------------ */
    /* Building                                                            */
    /* ------------------------------------------------------------------ */

    function buildGraph(events, relationships) {
        var graph = {
            nodes: Object.create(null),
            edges: [],
            out: Object.create(null),
            in: Object.create(null)
        };

        (events || []).forEach(function (event) {
            graph.nodes[event.eventId] = event;
            graph.out[event.eventId] = [];
            graph.in[event.eventId] = [];
        });

        (relationships || []).forEach(function (rel) {
            if (!graph.nodes[rel.sourceEventId] || !graph.nodes[rel.targetEventId]) { return; }
            graph.edges.push(rel);
            graph.out[rel.sourceEventId].push(rel);
            graph.in[rel.targetEventId].push(rel);
        });

        return graph;
    }

    /* ------------------------------------------------------------------ */
    /* Roots                                                               */
    /* ------------------------------------------------------------------ */

    var ROOT_KIND = {
        USER:        'user',
        RECORD:      'record',
        SESSION:     'session',
        TRANSACTION: 'transaction',
        COMPONENT:   'component',
        API:         'api',
        AGENT:       'agent',
        MCP_TOOL:    'mcpTool',
        EVENT:       'event'
    };

    /*
     * Which events a root selects.
     *
     * The root is a set of seed events, not a single one - "this user" is
     * every event they acted in. Traversal then expands from all of them at
     * once, which is why "show everything this user did" and "show everything
     * caused by this click" run through identical code.
     */
    function seedsFor(graph, spec) {
        var all = Object.keys(graph.nodes).map(function (id) { return graph.nodes[id]; });

        switch (spec.kind) {
            case ROOT_KIND.USER:
                return all.filter(function (e) {
                    return e.actor && (e.actor.id === spec.id || e.actor.name === spec.id);
                });
            case ROOT_KIND.RECORD:
                return all.filter(function (e) { return e.entity && e.entity.id === spec.id; });
            case ROOT_KIND.SESSION:
                return all.filter(function (e) { return e.session && e.session.id === spec.id; });
            case ROOT_KIND.TRANSACTION:
                return all.filter(function (e) { return e.traceId === spec.id; });
            case ROOT_KIND.COMPONENT:
                return all.filter(function (e) {
                    return e.component && (e.component.name === spec.id || e.component.id === spec.id);
                });
            case ROOT_KIND.API:
                return all.filter(function (e) {
                    return e.category === Model.CATEGORY.INTEGRATION &&
                        (!spec.id || (e.component && e.component.name === spec.id) ||
                         (e.metadata && e.metadata.endpoint === spec.id));
                });
            case ROOT_KIND.AGENT:
                return all.filter(function (e) {
                    return (e.actor && e.actor.kind === Model.ACTOR_KIND.AGENT &&
                            (!spec.id || e.actor.id === spec.id)) ||
                           (e.category === Model.CATEGORY.AGENT && !spec.id);
                });
            case ROOT_KIND.MCP_TOOL:
                return all.filter(function (e) {
                    return e.component && e.component.kind === Model.COMPONENT_KIND.MCP_TOOL &&
                        (!spec.id || e.component.name === spec.id);
                });
            case ROOT_KIND.EVENT:
                return graph.nodes[spec.id] ? [graph.nodes[spec.id]] : [];
            default:
                return [];
        }
    }

    /* ------------------------------------------------------------------ */
    /* Traversal                                                           */
    /* ------------------------------------------------------------------ */

    /*
     * Walk out from the seeds.
     *
     * Confidence decays along the path: reaching a node through an inferred
     * edge makes everything past it inferred too, however confident the later
     * edges are. That is not pessimism, it is what a chain of reasoning is
     * worth, and it is what stops a graph from presenting a distant guess with
     * the same weight as the click it started from.
     */
    function traverse(graph, spec) {
        spec = spec || {};
        var direction = spec.direction || 'both';
        var maxDepth = spec.maxDepth === undefined ? 6 : spec.maxDepth;
        var minConfidence = spec.minConfidence || Model.CONFIDENCE.UNKNOWN;

        var seeds = spec.seeds || seedsFor(graph, spec);
        if (!seeds.length) {
            return { nodes: [], edges: [], seeds: [], reached: {}, truncated: false };
        }

        var reached = Object.create(null);
        var edges = [];
        var seenEdge = Object.create(null);
        var queue = [];
        var truncated = false;

        seeds.forEach(function (event) {
            reached[event.eventId] = {
                event: event, depth: 0, confidence: Model.CONFIDENCE.CONFIRMED, via: null
            };
            queue.push(event.eventId);
        });

        while (queue.length) {
            var id = queue.shift();
            var here = reached[id];
            if (here.depth >= maxDepth) { truncated = true; continue; }

            var candidates = [];
            if (direction === 'downstream' || direction === 'both') {
                (graph.out[id] || []).forEach(function (rel) {
                    candidates.push({ rel: rel, next: rel.targetEventId });
                });
            }
            if (direction === 'upstream' || direction === 'both') {
                (graph.in[id] || []).forEach(function (rel) {
                    candidates.push({ rel: rel, next: rel.sourceEventId });
                });
            }

            candidates.forEach(function (step) {
                if (!Model.confidenceAtLeast(step.rel.confidence, minConfidence)) { return; }

                var carried = Model.weakestConfidence(here.confidence, step.rel.confidence);
                if (!Model.confidenceAtLeast(carried, minConfidence)) { return; }

                if (!seenEdge[step.rel.relationshipId]) {
                    seenEdge[step.rel.relationshipId] = true;
                    edges.push(step.rel);
                }

                var existing = reached[step.next];
                if (existing) {
                    /* A better route to a node already reached: keep the
                     * stronger claim, since the weaker one no longer limits
                     * what can be believed about it. */
                    if (Model.CONFIDENCE_RANK[carried] > Model.CONFIDENCE_RANK[existing.confidence]) {
                        existing.confidence = carried;
                        existing.via = step.rel;
                    }
                    return;
                }

                reached[step.next] = {
                    event: graph.nodes[step.next],
                    depth: here.depth + 1,
                    confidence: carried,
                    via: step.rel
                };
                queue.push(step.next);
            });
        }

        var nodes = Object.keys(reached).map(function (key) { return reached[key].event; })
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        return {
            nodes: nodes,
            edges: edges,
            seeds: seeds,
            reached: reached,
            truncated: truncated
        };
    }

    /* ------------------------------------------------------------------ */
    /* Following a business entity                                         */
    /* ------------------------------------------------------------------ */

    /*
     * Follow a record across the entities it becomes.
     *
     * Case → Order → Payment → Invoice → Document is not written down
     * anywhere here. It emerges: start at the record, walk confirmed and
     * likely references outward, and collect the distinct entities met. An org
     * that runs on different objects produces a different chain from the same
     * code, which is the only way this can work across orgs.
     */
    function follow(graph, spec) {
        spec = spec || {};
        var start = traverse(graph, {
            kind: spec.kind || ROOT_KIND.RECORD,
            id: spec.id,
            direction: 'both',
            maxDepth: spec.maxDepth === undefined ? 8 : spec.maxDepth,
            minConfidence: spec.minConfidence || Model.CONFIDENCE.INFERRED
        });

        var chain = [];
        var seen = Object.create(null);

        start.nodes.forEach(function (event) {
            if (!event.entity || !event.entity.id) { return; }
            var key = event.entity.id;
            if (seen[key]) {
                var known = seen[key];
                known.events.push(event);
                if (event.timestamp < known.firstSeen) { known.firstSeen = event.timestamp; }
                if (event.timestamp > known.lastSeen) { known.lastSeen = event.timestamp; }
                if (event.status === Model.STATUS.FAILURE || event.error) { known.failed = true; }
                return;
            }
            var link = {
                entity: event.entity,
                firstSeen: event.timestamp,
                lastSeen: event.timestamp,
                events: [event],
                failed: event.status === Model.STATUS.FAILURE || !!event.error,
                confidence: (start.reached[event.eventId] || {}).confidence || Model.CONFIDENCE.UNKNOWN
            };
            seen[key] = link;
            chain.push(link);
        });

        chain.sort(function (a, b) { return a.firstSeen - b.firstSeen; });

        return { chain: chain, trace: start };
    }

    /* ------------------------------------------------------------------ */
    /* Projection                                                          */
    /* ------------------------------------------------------------------ */

    /*
     * Keep some nodes, and do not break the chain through the ones dropped.
     *
     * When B is hidden between A and C, a bridged A→C edge replaces the pair.
     * It is marked bridged, carries the weakest confidence of the steps it
     * stands for, and its evidence names the hidden node - so a user who
     * wonders how A reached C can find out rather than being shown a
     * relationship the data never contained.
     */
    function project(subgraph, view, options) {
        options = options || {};
        var keeps = VIEW_KEEPS[view] || VIEW_KEEPS.ALL;
        var context = viewContext(subgraph.nodes);

        var kept = Object.create(null);
        var nodes = subgraph.nodes.filter(function (event) {
            var keep = keeps(event, context);
            if (keep) { kept[event.eventId] = event; }
            return keep;
        });

        var out = Object.create(null);
        subgraph.edges.forEach(function (rel) {
            if (!out[rel.sourceEventId]) { out[rel.sourceEventId] = []; }
            out[rel.sourceEventId].push(rel);
        });

        var edges = [];
        var seen = Object.create(null);

        function walk(fromId, currentId, confidence, hops, guard) {
            (out[currentId] || []).forEach(function (rel) {
                var nextId = rel.targetEventId;
                if (guard[nextId]) { return; }

                var carried = Model.weakestConfidence(confidence, rel.confidence);

                if (kept[nextId]) {
                    var key = fromId + '->' + nextId + ':' + rel.relationshipType;
                    if (seen[key]) { return; }
                    seen[key] = true;

                    if (hops.length === 0) {
                        edges.push(rel);
                        return;
                    }

                    edges.push({
                        relationshipId: key,
                        sourceEventId: fromId,
                        targetEventId: nextId,
                        relationshipType: rel.relationshipType,
                        confidence: carried,
                        state: 'inferred',
                        bridged: true,
                        bridgedOver: hops.slice(),
                        evidence: [Correlation.evidence('projection',
                            'This view hides ' + hops.length + ' step' +
                            (hops.length === 1 ? '' : 's') + ' between these two: ' +
                            hops.map(function (id) {
                                var node = subgraph.nodes.filter(function (n) {
                                    return n.eventId === id;
                                })[0];
                                return node ? (node.action || node.typeLabel) : id;
                            }).join(' → ') + '.')]
                    });
                    return;
                }

                /* Hidden node: keep walking, remembering what was stepped over
                 * so the bridged edge can name it. */
                var nextGuard = Object.create(null);
                Object.keys(guard).forEach(function (k) { nextGuard[k] = true; });
                nextGuard[nextId] = true;
                if (hops.length < (options.maxBridge || 6)) {
                    walk(fromId, nextId, carried, hops.concat([nextId]), nextGuard);
                }
            });
        }

        nodes.forEach(function (event) {
            var guard = Object.create(null);
            guard[event.eventId] = true;
            walk(event.eventId, event.eventId, Model.CONFIDENCE.CONFIRMED, [], guard);
        });

        return {
            nodes: nodes,
            edges: edges,
            view: view,
            hidden: subgraph.nodes.length - nodes.length,
            /* Empty because this trace has nothing of that kind in it, which
             * is a different message from "your filters hid everything". */
            emptyReason: nodes.length ? null : (
                view === VIEW.AGENT
                    ? 'No agent or tool activity was collected for this trace.'
                    : view === VIEW.BUSINESS
                        ? 'No business outcome or business-object change was collected.'
                        : 'Nothing in this trace belongs to this view.')
        };
    }

    /* ------------------------------------------------------------------ */
    /* Grouping                                                            */
    /* ------------------------------------------------------------------ */

    /*
     * Ten identical API calls are one row until somebody asks otherwise.
     *
     * Grouped by what makes them the same thing - type, component, and the
     * parent they hang off - and never across a status boundary: nine
     * successes and one failure must not collapse into "10 API calls", because
     * the failure is the entire reason the graph is open.
     */
    function groupLabel(members) {
        var first = members[0];
        var subject = (first.entity && first.entity.type) ||
                      (first.component && first.component.name) ||
                      first.typeLabel || first.eventType;

        /* Several changes to one record, rather than several records. */
        if (/^RECORD_(UPDATE|DELETE)$/.test(first.eventType)) {
            var records = Object.create(null);
            members.forEach(function (event) {
                if (event.entity && event.entity.id) { records[event.entity.id] = true; }
            });
            if (Object.keys(records).length === 1) {
                return subject + ': ' + members.length + ' changes';
            }
        }

        return subject + ' × ' + members.length;
    }

    function group(subgraph, options) {
        options = options || {};
        var threshold = options.threshold || 3;

        var parentOf = Object.create(null);
        subgraph.edges.forEach(function (rel) {
            if (rel.relationshipType === Correlation.REL.FOLLOWED_BY) { return; }
            if (!parentOf[rel.targetEventId]) { parentOf[rel.targetEventId] = rel.sourceEventId; }
        });

        var buckets = Object.create(null);
        subgraph.nodes.forEach(function (event) {
            var failed = event.status === Model.STATUS.FAILURE || !!event.error;
            var key = [
                parentOf[event.eventId] || 'root',
                event.eventType,
                (event.component && event.component.name) || '',
                /*
                 * The object, so a group is always one kind of thing.
                 *
                 * Without it a record graph bucketed purely on "RECORD_CREATE
                 * under this parent", so an Order's two OrderItems and its
                 * Payment collapsed into "Record created × 3" - three
                 * different objects presented as three of the same, with the
                 * Payment no longer visible as a distinct thing at all. Two
                 * OrderItems are a group; an OrderItem and a Payment are two
                 * groups.
                 */
                (event.entity && event.entity.type) || '',
                failed ? 'failed' : 'ok'
            ].join('|');
            if (!buckets[key]) { buckets[key] = []; }
            buckets[key].push(event);
        });

        var groups = [];
        var grouped = Object.create(null);

        Object.keys(buckets).forEach(function (key) {
            var members = buckets[key];
            if (members.length < threshold) { return; }

            members.sort(function (a, b) { return a.timestamp - b.timestamp; });
            var last = members[members.length - 1];
            var failed = members.filter(function (e) {
                return e.status === Model.STATUS.FAILURE || e.error;
            }).length;

            var groupNode = {
                eventId: 'group-' + Model.derivedId([key, members.length]),
                isGroup: true,
                groupKey: key,
                members: members,
                count: members.length,
                eventType: members[0].eventType,
                category: members[0].category,
                typeLabel: members[0].typeLabel,
                /*
                 * Named by what it is a group of. "Record created × 12" says
                 * only that the engine counted to twelve.
                 *
                 * Creations and changes are worded differently on purpose:
                 * "OrderItem × 3" is three OrderItems, while three edits to
                 * one Case is "Case: 3 changes". Both were "Case × 3" at one
                 * point, and one of them was a lie.
                 */
                action: groupLabel(members),
                component: members[0].component,
                actor: members[0].actor,
                entity: null,
                timestamp: members[0].timestamp,
                endsAt: last.timestamp + (last.duration || 0),
                duration: (last.timestamp + (last.duration || 0)) - members[0].timestamp,
                totalDuration: members.reduce(function (sum, e) { return sum + (e.duration || 0); }, 0),
                status: failed ? Model.STATUS.FAILURE : members[0].status,
                failedCount: failed,
                state: members[0].state,
                confidence: members.reduce(function (worst, e) {
                    return Model.weakestConfidence(worst, e.confidence);
                }, Model.CONFIDENCE.CONFIRMED),
                source: members[0].source
            };

            groups.push(groupNode);
            members.forEach(function (event) { grouped[event.eventId] = groupNode.eventId; });
        });

        /* Edges are rewritten onto the group, so a collapsed graph is still a
         * connected one. An edge that becomes a self-loop - two members of the
         * same group calling each other - is dropped rather than drawn. */
        var nodes = subgraph.nodes.filter(function (event) { return !grouped[event.eventId]; })
            .concat(groups)
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        var seen = Object.create(null);
        var edges = [];
        subgraph.edges.forEach(function (rel) {
            var source = grouped[rel.sourceEventId] || rel.sourceEventId;
            var target = grouped[rel.targetEventId] || rel.targetEventId;
            if (source === target) { return; }
            var key = source + '->' + target + ':' + rel.relationshipType;
            if (seen[key]) { return; }
            seen[key] = true;
            edges.push(source === rel.sourceEventId && target === rel.targetEventId
                ? rel
                : {
                    relationshipId: key,
                    sourceEventId: source,
                    targetEventId: target,
                    relationshipType: rel.relationshipType,
                    confidence: rel.confidence,
                    state: rel.state,
                    evidence: rel.evidence,
                    collapsed: true
                });
        });

        return { nodes: nodes, edges: edges, groups: groups, view: subgraph.view };
    }

    /* ------------------------------------------------------------------ */
    /* Filtering                                                           */
    /* ------------------------------------------------------------------ */

    function filter(subgraph, spec) {
        spec = spec || {};

        /*
         * Objects hidden from the drawing.
         *
         * The same exclusions are applied at collection, where they save the
         * query - but a graph already fetched should hide an object the moment
         * it is unticked rather than after a re-walk. So the list is honoured
         * in both places: here for the instant answer, and in planHop for the
         * one that actually makes a large org tractable.
         */
        var hiddenTypes = Object.create(null);
        (spec.excludeTypes || []).forEach(function (name) { hiddenTypes[name] = true; });

        var keep = subgraph.nodes.filter(function (event) {
            if (event.entity && event.entity.type && hiddenTypes[event.entity.type]) { return false; }
            if (spec.failuresOnly && event.status !== Model.STATUS.FAILURE && !event.error) { return false; }
            if (spec.slowerThan && !((event.duration || 0) >= spec.slowerThan)) { return false; }
            if (spec.categories && spec.categories.length &&
                spec.categories.indexOf(event.category) === -1) { return false; }
            if (spec.hiddenCategories && spec.hiddenCategories.indexOf(event.category) !== -1) { return false; }
            if (spec.sources && spec.sources.length &&
                spec.sources.indexOf(event.source && event.source.kind) === -1) { return false; }
            if (spec.minConfidence &&
                !Model.confidenceAtLeast(event.confidence, spec.minConfidence)) { return false; }
            if (spec.text) {
                var hay = [
                    event.action, event.eventType, event.typeLabel,
                    event.entity && event.entity.name, event.entity && event.entity.id,
                    event.component && event.component.name,
                    event.actor && event.actor.name,
                    event.error && event.error.message
                ].join(' ').toLowerCase();
                if (hay.indexOf(String(spec.text).toLowerCase()) === -1) { return false; }
            }
            return true;
        });

        var kept = Object.create(null);
        keep.forEach(function (event) { kept[event.eventId] = true; });

        return {
            nodes: keep,
            edges: subgraph.edges.filter(function (rel) {
                return kept[rel.sourceEventId] && kept[rel.targetEventId];
            }),
            view: subgraph.view
        };
    }

    /*
     * One branch, and nothing else. What "focus on this" means: everything
     * this node led to, plus the path that led to it, so the branch keeps its
     * context instead of floating unattached.
     */
    function focus(graph, eventId, options) {
        options = options || {};
        var down = traverse(graph, {
            kind: ROOT_KIND.EVENT, id: eventId, direction: 'downstream',
            maxDepth: options.maxDepth === undefined ? 6 : options.maxDepth
        });
        var up = traverse(graph, {
            kind: ROOT_KIND.EVENT, id: eventId, direction: 'upstream',
            maxDepth: options.upstreamDepth === undefined ? 3 : options.upstreamDepth
        });

        var nodes = Object.create(null);
        down.nodes.concat(up.nodes).forEach(function (event) { nodes[event.eventId] = event; });

        var edgeIds = Object.create(null);
        var edges = [];
        down.edges.concat(up.edges).forEach(function (rel) {
            if (edgeIds[rel.relationshipId]) { return; }
            edgeIds[rel.relationshipId] = true;
            edges.push(rel);
        });

        return {
            nodes: Object.keys(nodes).map(function (id) { return nodes[id]; })
                .sort(function (a, b) { return a.timestamp - b.timestamp; }),
            edges: edges
        };
    }

    /* ------------------------------------------------------------------ */
    /* Layout                                                              */
    /* ------------------------------------------------------------------ */

    /*
     * Where each node is drawn.
     *
     * Columns are causal depth, not time: two calls made in parallel are the
     * same distance from the click that made them, and putting them in one
     * column is what makes parallelism visible at a glance. Rows separate them.
     *
     * Time still governs the row order inside a column, so reading top to
     * bottom within a column is reading in the order things happened.
     */
    function layout(subgraph, options) {
        options = options || {};
        var columnWidth = options.columnWidth || 200;
        var rowHeight = options.rowHeight || 72;
        var padding = options.padding || 28;

        var indegree = Object.create(null);
        var out = Object.create(null);
        subgraph.nodes.forEach(function (node) {
            indegree[node.eventId] = 0;
            out[node.eventId] = [];
        });
        subgraph.edges.forEach(function (rel) {
            if (indegree[rel.targetEventId] === undefined) { return; }
            if (rel.relationshipType === Correlation.REL.FOLLOWED_BY) { return; }
            indegree[rel.targetEventId]++;
            out[rel.sourceEventId].push(rel.targetEventId);
        });

        /*
         * Longest-path layering, with cycles broken rather than fatal.
         *
         * The plain Kahn walk assumed at least one node with no incoming edge.
         * Real graphs routinely have none: a Case whose parent Case references
         * it back, a failure that propagates in a loop, or simply two rules
         * asserting opposite directions over the same pair. With every node at
         * indegree one or more the queue started empty, nothing was ever
         * layered, and every node fell through to depth 0 - the entire graph
         * rendered as a single column with the edges crossing behind it.
         *
         * So when the walk stalls with nodes left, the earliest unplaced node
         * is seeded as a new root and the walk continues. That breaks the
         * cycle at the point that reads best - the oldest event in it - and
         * degrades a cyclic region to a reasonable layering instead of
         * discarding the layout for the whole graph.
         */
        var depth = Object.create(null);
        var placed = 0;
        var total = subgraph.nodes.length;
        var guard = 0;

        var queue = [];
        subgraph.nodes.forEach(function (node) {
            if (indegree[node.eventId] === 0) { depth[node.eventId] = 0; queue.push(node.eventId); }
        });

        while (placed < total && guard++ < 100000) {
            if (!queue.length) {
                /* Stalled: seed the earliest node that has no depth yet. */
                var stranded = subgraph.nodes.filter(function (node) {
                    return depth[node.eventId] === undefined;
                }).sort(function (a, b) { return a.timestamp - b.timestamp; })[0];
                if (!stranded) { break; }
                depth[stranded.eventId] = 0;
                queue.push(stranded.eventId);
            }

            var id = queue.shift();
            placed++;

            out[id].forEach(function (next) {
                var candidate = depth[id] + 1;
                if (depth[next] === undefined || candidate > depth[next]) { depth[next] = candidate; }
                if (--indegree[next] === 0 && queue.indexOf(next) === -1) { queue.push(next); }
            });
        }

        var maxDepth = 0;
        subgraph.nodes.forEach(function (node) {
            if (depth[node.eventId] === undefined) { depth[node.eventId] = 0; }
            if (depth[node.eventId] > maxDepth) { maxDepth = depth[node.eventId]; }
        });

        var columns = [];
        subgraph.nodes.forEach(function (node) {
            var column = depth[node.eventId];
            if (!columns[column]) { columns[column] = []; }
            columns[column].push(node);
        });

        var positioned = [];
        var widest = 0;
        columns.forEach(function (column, index) {
            if (!column) { return; }
            column.sort(function (a, b) { return a.timestamp - b.timestamp; });
            if (column.length > widest) { widest = column.length; }
            column.forEach(function (node, row) {
                positioned.push({
                    node: node,
                    eventId: node.eventId,
                    column: index,
                    row: row,
                    x: padding + index * columnWidth,
                    y: padding + row * rowHeight
                });
            });
        });

        var byId = Object.create(null);
        positioned.forEach(function (item) { byId[item.eventId] = item; });

        return {
            positions: positioned,
            byId: byId,
            width: padding * 2 + (maxDepth + 1) * columnWidth,
            height: padding * 2 + Math.max(1, widest) * rowHeight,
            columns: maxDepth + 1
        };
    }

    /* ------------------------------------------------------------------ */
    /* Assembling a trace                                                  */
    /* ------------------------------------------------------------------ */

    /*
     * The one call the panel makes: root in, everything the screen needs out.
     *
     * Order matters and is fixed here rather than left to the caller: traverse,
     * then project, then filter, then group, then lay out. Grouping before
     * filtering would collapse a failure into a group and then hide the group;
     * projecting after grouping would bridge over nodes that are no longer
     * individually present.
     */
    function buildTrace(graph, spec) {
        spec = spec || {};
        var traversed = traverse(graph, spec);
        var projected = project(traversed, spec.view || VIEW.ALL, spec);
        var filtered = filter(projected, spec.filter || {});
        var grouped = spec.grouping === false
            ? filtered
            : group(filtered, { threshold: spec.groupThreshold || 3 });
        var placed = layout(grouped, spec);

        return {
            root: { kind: spec.kind, id: spec.id },
            view: spec.view || VIEW.ALL,
            traversed: traversed,
            projected: projected,
            graph: grouped,
            layout: placed,
            truncated: traversed.truncated,
            emptyReason: projected.emptyReason,
            stats: {
                reached: traversed.nodes.length,
                shown: grouped.nodes.length,
                hiddenByView: projected.hidden,
                groups: (grouped.groups || []).length,
                edges: grouped.edges.length,
                failures: grouped.nodes.filter(function (n) {
                    return n.status === Model.STATUS.FAILURE || n.error;
                }).length
            }
        };
    }

    /* ------------------------------------------------------------------ */
    /* Recently traced                                                     */
    /* ------------------------------------------------------------------ */

    var RECENT_MAX = 8;

    /*
     * The last few roots, most recent first.
     *
     * Pure so the ordering and de-duplication can be tested without a browser,
     * because both are easy to get subtly wrong: a list that appends rather
     * than promotes leaves the record you trace every day sinking towards the
     * bottom, and one that de-duplicates on the label rather than the id
     * collapses two different Cases that happen to share a subject.
     *
     * Keyed on kind plus id, so tracing user 005AAA and record 005AAA - the
     * same string, two different questions - are two entries.
     */
    function rememberTrace(list, entry, max) {
        if (!entry || !entry.id) { return (list || []).slice(); }

        var key = (entry.kind || 'record') + ':' + entry.id;
        var kept = (list || []).filter(function (item) {
            return item && item.id && ((item.kind || 'record') + ':' + item.id) !== key;
        });

        kept.unshift({
            kind: entry.kind || 'record',
            id: entry.id,
            objectType: entry.objectType || null,
            /* The label can improve on a later visit - the first trace of a
             * record may only know its id, and the walk then finds its name -
             * so it is taken from the newest entry rather than the oldest. */
            label: entry.label || entry.id,
            at: entry.at || Date.now()
        });

        return kept.slice(0, max || RECENT_MAX);
    }

    function forgetTrace(list, kind, id) {
        var key = (kind || 'record') + ':' + id;
        return (list || []).filter(function (item) {
            return item && ((item.kind || 'record') + ':' + item.id) !== key;
        });
    }

    var api = {
        VIEW: VIEW,
        VIEW_KEEPS: VIEW_KEEPS,
        ROOT_KIND: ROOT_KIND,
        RECENT_MAX: RECENT_MAX,
        rememberTrace: rememberTrace,
        forgetTrace: forgetTrace,
        BUSINESS_ENTITIES: BUSINESS_ENTITIES,
        buildGraph: buildGraph,
        seedsFor: seedsFor,
        traverse: traverse,
        follow: follow,
        project: project,
        group: group,
        filter: filter,
        focus: focus,
        layout: layout,
        buildTrace: buildTrace
    };

    root.SSTrace = api;
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof self !== 'undefined' ? self : this);
