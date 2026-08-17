/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * The correlation engine.
 *
 * Events arrive independent. This is what makes them a graph, and it does so
 * with rules that can be read and argued with rather than with a model that
 * cannot. Nothing here calls an AI service: correlation is the foundation the
 * rest stands on, and a foundation whose answers change between runs is not
 * one you can debug a production incident against.
 *
 * Every rule states its own evidence, and every relationship carries it. That
 * is the difference between this and a log viewer that draws lines: when the
 * graph says the payment API caused the order to fail, the user can open the
 * edge and read exactly which signals produced that claim and how strong each
 * one is.
 *
 * The confidence ladder is honest about its own limits:
 *
 *   CONFIRMED - a shared identifier, a declared parent, a matched request id.
 *               Something in the data explicitly ties these two together.
 *   LIKELY    - ordering plus a known relationship. The flow that ran does
 *               modify this object, and the update happened inside its span.
 *   INFERRED  - proximity. Same user, same record, seconds apart. Often right,
 *               never evidence.
 *   UNKNOWN   - the pair is in the graph because something put it there and
 *               the reason did not survive.
 *
 * A metadata dependency never produces CONFIRMED. That OmniScript calls that
 * Integration Procedure is a fact about the org's configuration and says
 * nothing about whether it did so at 10:42 - which is the single most common
 * way an observability tool tells a confident lie.
 */
(function (root) {
    'use strict';

    var Model = root.SSEventModel ||
        (typeof require !== 'undefined' ? require('./ss-event-model.js') : null);

    var REL = {
        CAUSED:             'CAUSED',
        TRIGGERED:          'TRIGGERED',
        INVOKED:            'INVOKED',
        /*
         * Structural, from the org's own lookup and master-detail fields.
         * Unlike every other type here these are never inferred - the link is
         * held in a field, so the evidence is that field's name and the
         * confidence is always CONFIRMED. See ss-record-graph.
         */
        PARENT_OF:          'PARENT_OF',
        CHILD_OF:           'CHILD_OF',
        CREATED:            'CREATED',
        UPDATED:            'UPDATED',
        DELETED:            'DELETED',
        CALLED:             'CALLED',
        RETURNED:           'RETURNED',
        DEPENDS_ON:         'DEPENDS_ON',
        RELATED_TO:         'RELATED_TO',
        FOLLOWED_BY:        'FOLLOWED_BY',
        PART_OF:            'PART_OF',
        FAILED_BECAUSE_OF:  'FAILED_BECAUSE_OF'
    };

    /*
     * How near in time two things must be before nearness means anything.
     *
     * These are the engine's only magic numbers and they are all overridable.
     * They are deliberately tight: a wide window turns a busy org into a graph
     * where everything is related to everything, which is the same as a graph
     * with no edges at all.
     */
    var DEFAULTS = {
        /* Same user, same record - a click and its consequence. */
        proximityMs: 5000,
        /* A component starting and the work it kicks off. */
        invocationMs: 30000,
        /* A request and the response that answers it. */
        responseMs: 120000,
        /* Consecutive events in one trace. */
        sequenceMs: 300000
    };

    function evidence(signal, detail, weight) {
        return { signal: signal, detail: detail, weight: weight || null };
    }

    function relationship(source, target, type, confidence, evidenceList, extra) {
        var rel = {
            relationshipId: source + '->' + target + ':' + type,
            sourceEventId: source,
            targetEventId: target,
            relationshipType: type,
            confidence: confidence,
            evidence: evidenceList || [],
            /*
             * A relationship is observed only when something recorded it -
             * a declared parent, a matched id. Everything else is this engine
             * working it out, and says so.
             */
            state: confidence === Model.CONFIDENCE.CONFIRMED ? 'observed' : 'inferred'
        };
        if (extra) {
            Object.keys(extra).forEach(function (key) { rel[key] = extra[key]; });
        }
        return rel;
    }

    /* ------------------------------------------------------------------ */
    /* Rules                                                               */
    /* ------------------------------------------------------------------ */

    var rules = [];

    function rule(name, label, run) {
        rules.push({ name: name, label: label, run: run });
    }

    /*
     * A declared parent. The strongest signal there is: something in the
     * execution path recorded who called it, which is not a guess at all.
     */
    rule('explicitParent', 'Declared parent event', function (ctx) {
        var out = [];
        ctx.events.forEach(function (event) {
            if (!event.parentEventId) { return; }
            var parent = ctx.byId[event.parentEventId];
            if (!parent) { return; }
            out.push(relationship(parent.eventId, event.eventId, REL.CAUSED,
                Model.CONFIDENCE.CONFIRMED,
                [evidence('parentEventId',
                    'The event declares ' + parent.eventId + ' as its parent.')]));
        });
        return out;
    });

    /*
     * Trace membership is deliberately not a rule. See attachOrphans below.
     */

    /*
     * A request and the response that answered it.
     *
     * A correlation id makes this certain. Without one, the nearest later
     * response on the same component is the answer often enough to be worth
     * drawing - and never more than LIKELY, because two calls in flight at
     * once is exactly when this guess goes wrong and exactly when somebody is
     * looking at the graph.
     */
    rule('requestResponse', 'Request matched to response', function (ctx) {
        var out = [];
        var openRequests = [];

        ctx.events.forEach(function (event) {
            var type = Model.eventType(event.eventType);
            if (type.phase === 'start' && type.closedBy) {
                openRequests.push(event);
                return;
            }
            if (type.phase !== 'end') { return; }

            var correlationId = (event.metadata && (event.metadata.requestId ||
                event.metadata.correlationId)) || null;

            var matchIndex = -1;
            for (var i = openRequests.length - 1; i >= 0; i--) {
                var candidate = openRequests[i];
                var candidateType = Model.eventType(candidate.eventType);
                if (candidateType.closedBy !== event.eventType) { continue; }
                if (event.timestamp < candidate.timestamp) { continue; }
                if (event.timestamp - candidate.timestamp > ctx.options.responseMs) { continue; }

                var candidateId = (candidate.metadata && (candidate.metadata.requestId ||
                    candidate.metadata.correlationId)) || null;

                if (correlationId && candidateId) {
                    if (correlationId === candidateId) { matchIndex = i; break; }
                    continue;
                }
                if (matchIndex === -1) { matchIndex = i; }
            }

            if (matchIndex === -1) { return; }
            var request = openRequests.splice(matchIndex, 1)[0];
            var requestId = (request.metadata && (request.metadata.requestId ||
                request.metadata.correlationId)) || null;

            var confirmed = correlationId && requestId && correlationId === requestId;
            var why = confirmed
                ? [evidence('requestId', 'Request and response share id ' + correlationId + '.')]
                : [
                    evidence('typePairing', request.eventType + ' is closed by ' + event.eventType + '.'),
                    evidence('ordering', 'The response is the next matching one, ' +
                        (event.timestamp - request.timestamp) + 'ms later.'),
                    evidence('noCorrelationId',
                        'No request id was recorded, so the pairing is by order alone.')
                ];

            /*
             * A call being answered and a span being closed are not the same
             * relationship, though the pairing that finds them is identical.
             * RETURNED means something came back; an Apex or Flow unit ending
             * is the same operation finishing, which is PART_OF. Calling both
             * RETURNED made every method look like it had a caller waiting on
             * a response.
             */
            var pairType = request.category === Model.CATEGORY.INTEGRATION ||
                           request.category === Model.CATEGORY.AGENT
                ? REL.RETURNED : REL.PART_OF;

            out.push(relationship(request.eventId, event.eventId, pairType,
                confirmed ? Model.CONFIDENCE.CONFIRMED : Model.CONFIDENCE.LIKELY, why,
                { latencyMs: event.timestamp - request.timestamp }));
        });

        return out;
    });

    /*
     * Work that happened inside another operation's span.
     *
     * This is what reconstructs OmniScript → Integration Procedure → Data
     * Mapper when all the engine has is start and end times. Containment plus
     * a shared trace or session is a strong signal; containment alone is not,
     * because two unrelated things overlapping in time is the normal state of
     * a busy org.
     */
    rule('spanNesting', 'Ran inside another operation', function (ctx) {
        var out = [];
        var spans = [];

        ctx.events.forEach(function (event) {
            var type = Model.eventType(event.eventType);
            var span = null;
            if (event.duration) {
                span = { event: event, from: event.timestamp, to: event.timestamp + event.duration };
            } else if (type.phase === 'start' && ctx.spanEnd[event.eventId]) {
                span = { event: event, from: event.timestamp, to: ctx.spanEnd[event.eventId] };
            }
            if (span) { spans.push(span); }
        });

        ctx.events.forEach(function (event) {
            if (event.parentEventId) { return; }

            var innermost = null;
            spans.forEach(function (span) {
                if (span.event.eventId === event.eventId) { return; }
                if (event.timestamp < span.from || event.timestamp > span.to) { return; }
                var sameContext =
                    (span.event.traceId && span.event.traceId === event.traceId) ||
                    (span.event.session && event.session &&
                     span.event.session.id === event.session.id);
                if (!sameContext) { return; }
                if (!innermost || (span.to - span.from) < (innermost.to - innermost.from)) {
                    innermost = span;
                }
            });

            if (!innermost) { return; }
            out.push(relationship(innermost.event.eventId, event.eventId, REL.INVOKED,
                Model.CONFIDENCE.LIKELY,
                [
                    evidence('containment', 'Ran inside the span of ' +
                        (innermost.event.component && innermost.event.component.name ||
                         innermost.event.typeLabel) + '.'),
                    evidence('sharedContext', 'Same trace or session.')
                ]));
        });

        return out;
    });

    /*
     * A design-time dependency that the runtime ordering is consistent with.
     *
     * Deliberately capped at LIKELY, and the evidence says why in as many
     * words. The org's configuration says this OmniScript calls that
     * Integration Procedure; the timing says something matching it ran just
     * after. Both are true and neither is a recording of the call.
     */
    rule('designTimeInvocation', 'Known dependency, consistent timing', function (ctx) {
        var out = [];
        if (!ctx.options.dependencies || !ctx.options.dependencies.length) { return out; }

        ctx.options.dependencies.forEach(function (dependency) {
            var callers = ctx.byComponentName[dependency.from] || [];
            var callees = ctx.byComponentName[dependency.to] || [];
            if (!callers.length || !callees.length) { return; }

            callers.forEach(function (caller) {
                callees.forEach(function (callee) {
                    if (callee.timestamp < caller.timestamp) { return; }
                    var gap = callee.timestamp - caller.timestamp;
                    if (gap > ctx.options.invocationMs) { return; }
                    if (callee.parentEventId) { return; }

                    out.push(relationship(caller.eventId, callee.eventId, REL.INVOKED,
                        Model.CONFIDENCE.LIKELY,
                        [
                            evidence('designTime', dependency.from + ' is configured to call ' +
                                dependency.to + '.'),
                            evidence('runtimeOrdering', 'It ran ' + gap + 'ms after.'),
                            evidence('designTimeIsNotProof',
                                'Metadata says this call can happen, not that it did.')
                        ],
                        { designTime: true }));
                });
            });
        });

        return out;
    });

    /*
     * Automation, and the record change that followed it.
     *
     * With a declared target object the claim is LIKELY - this flow does write
     * this object and the write landed inside its span. Without one it is
     * INFERRED, which is the right word for "these two things happened near
     * each other in the same transaction".
     */
    rule('automationToRecordChange', 'Automation and the record it changed', function (ctx) {
        var out = [];
        var automation = ctx.events.filter(function (event) {
            return event.component && (
                event.component.kind === Model.COMPONENT_KIND.FLOW ||
                event.component.kind === Model.COMPONENT_KIND.APEX ||
                event.component.kind === Model.COMPONENT_KIND.INTEGRATION_PROCEDURE);
        });

        var changes = ctx.events.filter(function (event) {
            return event.eventType === 'RECORD_CREATE' ||
                   event.eventType === 'RECORD_UPDATE' ||
                   event.eventType === 'RECORD_DELETE';
        });

        automation.forEach(function (source) {
            changes.forEach(function (change) {
                if (change.parentEventId) { return; }
                if (change.timestamp < source.timestamp) { return; }
                var gap = change.timestamp - source.timestamp;
                var window = source.duration
                    ? source.duration + ctx.options.proximityMs
                    : ctx.options.invocationMs;
                if (gap > window) { return; }

                var sameContext =
                    (source.traceId && source.traceId === change.traceId) ||
                    (source.session && change.session && source.session.id === change.session.id);
                if (!sameContext) { return; }

                var writes = (source.metadata && source.metadata.writesObjects) || [];
                var target = change.entity && change.entity.type;
                var declared = target && writes.indexOf(target) !== -1;

                var type = change.eventType === 'RECORD_CREATE' ? REL.CREATED
                         : change.eventType === 'RECORD_DELETE' ? REL.DELETED
                         : REL.UPDATED;

                var why = [evidence('ordering', 'The change landed ' + gap + 'ms after it started.')];
                if (declared) {
                    why.push(evidence('declaredWrite',
                        (source.component.name || 'The automation') + ' is known to write ' + target + '.'));
                } else {
                    why.push(evidence('noDeclaredWrite',
                        'Nothing records which objects this automation writes, so the link is by timing.'));
                }

                out.push(relationship(source.eventId, change.eventId, type,
                    declared ? Model.CONFIDENCE.LIKELY : Model.CONFIDENCE.INFERRED, why));
            });
        });

        return out;
    });

    /*
     * An agent, its tools, and what they touched.
     *
     * Agent journeys are not a separate graph; they are the same graph with an
     * actor whose kind is 'agent'. That is the whole design, and it is why
     * "show me everything this agent did" needs no code of its own beyond this.
     */
    rule('agentToolCalls', 'Agent to tool call', function (ctx) {
        var out = [];
        var requests = ctx.events.filter(function (e) { return e.eventType === 'AGENT_REQUEST'; });
        var calls = ctx.events.filter(function (e) { return e.eventType === 'MCP_TOOL_CALL'; });

        requests.forEach(function (request) {
            calls.forEach(function (call) {
                if (call.timestamp < request.timestamp) { return; }
                if (call.timestamp - request.timestamp > ctx.options.invocationMs) { return; }
                var sameAgent = request.actor && call.actor && request.actor.id === call.actor.id;
                var sameTrace = request.traceId && request.traceId === call.traceId;
                if (!sameAgent && !sameTrace) { return; }

                out.push(relationship(request.eventId, call.eventId, REL.INVOKED,
                    sameTrace ? Model.CONFIDENCE.CONFIRMED : Model.CONFIDENCE.LIKELY,
                    [
                        evidence(sameTrace ? 'traceId' : 'sameAgent',
                            sameTrace ? 'Same trace as the agent request.'
                                      : 'Same agent identity, within the invocation window.'),
                        evidence('toolName', 'Tool: ' +
                            ((call.component && call.component.name) || 'unnamed') + '.')
                    ]));
            });
        });

        return out;
    });

    /*
     * A business entity referencing another.
     *
     * Case → Order → Payment → Invoice → Document is not a hardcoded chain
     * here; it falls out of records naming each other. A declared reference is
     * confirmed - the org itself holds the link - while entities that merely
     * appear together in one trace are related and nothing stronger.
     */
    rule('entityReference', 'One record referencing another', function (ctx) {
        var out = [];
        ctx.events.forEach(function (event) {
            var references = (event.metadata && event.metadata.references) || [];
            references.forEach(function (reference) {
                /*
                 * One edge per referenced record, not one per event on it.
                 *
                 * A lookup relates two *records*. Fanning it out across every
                 * event either record carries meant a Case with nine tracked
                 * status changes gained nine edges to each of its Orders -
                 * nine identical claims about the same single field, and a
                 * layout pushed a column wider for each one.
                 *
                 * The record's earliest event is its anchor, which is the same
                 * convention ss-record-graph uses, so the two agree instead of
                 * producing parallel edges between different pairs.
                 */
                var anchor = (ctx.byRecordId[reference.id] || []).slice()
                    .sort(function (a, b) { return a.timestamp - b.timestamp; })[0];
                [anchor].filter(Boolean).forEach(function (target) {
                    if (target.eventId === event.eventId) { return; }
                    /*
                     * Referenced record first, then the record referencing it.
                     *
                     * The direction was the other way round, which reads
                     * naturally - "the Order points at the Case" - and put
                     * this edge in direct opposition to the PARENT_OF edge
                     * ss-record-graph derives from the same field. Every
                     * parent/child pair then had an arrow each way, which is a
                     * cycle, and a graph of cycles has no node to lay out
                     * first: the whole tree collapsed into a single column.
                     *
                     * A lookup means the target existed first and the
                     * referencing record hangs off it, so parent-to-child is
                     * also the truer direction.
                     */
                    /*
                     * PARENT_OF, the same type ss-record-graph uses for the
                     * same fact. These two arrive at one relationship from
                     * different directions - one reads the field off the row,
                     * the other reads it off the event's metadata - and while
                     * they carried different types they could not merge, so a
                     * record graph drew two curves between every related pair
                     * saying the same thing about the same field.
                     */
                    out.push(relationship(target.eventId, event.eventId, REL.PARENT_OF,
                        Model.CONFIDENCE.CONFIRMED,
                        [evidence('recordReference',
                            (event.entity && event.entity.type || 'A record') +
                            ' references ' + (reference.field || 'a related record') +
                            ' = ' + reference.id + '.')]));
                });
            });
        });
        return out;
    });

    /*
     * A failure, and what stopped because of it.
     *
     * The rule everybody actually opens the tool for. It only fires within one
     * trace and only forwards in time, and it says LIKELY rather than
     * CONFIRMED: that the order failed after the payment API returned 403 is
     * observed, that it failed *because* of it is a reading of the evidence.
     */
    rule('failurePropagation', 'Failure and what followed it', function (ctx) {
        var out = [];
        var failures = ctx.events.filter(function (event) {
            return event.status === Model.STATUS.FAILURE || !!event.error;
        });

        failures.forEach(function (failure) {
            var siblings = failure.traceId ? ctx.byTrace[failure.traceId] || [] : [];
            siblings.forEach(function (event) {
                if (event.eventId === failure.eventId) { return; }
                if (event.timestamp < failure.timestamp) { return; }
                if (event.status !== Model.STATUS.FAILURE && !event.error) { return; }
                if (event.timestamp - failure.timestamp > ctx.options.invocationMs) { return; }

                out.push(relationship(failure.eventId, event.eventId, REL.FAILED_BECAUSE_OF,
                    Model.CONFIDENCE.LIKELY,
                    [
                        evidence('earlierFailure', 'An earlier failure in the same trace: ' +
                            ((failure.error && failure.error.message) || failure.action) + '.'),
                        evidence('ordering', 'This failed ' +
                            (event.timestamp - failure.timestamp) + 'ms later.')
                    ],
                    { direction: 'downstream' }));
            });
        });

        return out;
    });

    /*
     * Same user, same record, seconds apart.
     *
     * The weakest rule in the engine and the one that most needs to exist: it
     * is what connects a click the browser saw to a record change Salesforce
     * reported, when nothing carries an id that joins them. INFERRED, always,
     * and the interface never draws it as anything else.
     */
    rule('userRecordProximity', 'Same user and record, moments apart', function (ctx) {
        var out = [];
        var ordered = ctx.events;

        for (var i = 0; i < ordered.length; i++) {
            var a = ordered[i];
            if (!a.actor || !a.actor.id || !a.entity || !a.entity.id) { continue; }

            for (var j = i + 1; j < ordered.length; j++) {
                var b = ordered[j];
                if (b.timestamp - a.timestamp > ctx.options.proximityMs) { break; }
                if (b.parentEventId || (a.traceId && a.traceId === b.traceId)) { continue; }
                if (!b.actor || b.actor.id !== a.actor.id) { continue; }
                if (!b.entity || b.entity.id !== a.entity.id) { continue; }

                out.push(relationship(a.eventId, b.eventId, REL.RELATED_TO,
                    Model.CONFIDENCE.INFERRED,
                    [
                        evidence('sameActor', 'Both by ' + a.actor.name + '.'),
                        evidence('sameRecord', 'Both touching ' + a.entity.id + '.'),
                        evidence('proximity', (b.timestamp - a.timestamp) + 'ms apart.'),
                        evidence('noSharedIdentifier',
                            'No trace, request or parent id joins these - proximity only.')
                    ]));
            }
        }

        return out;
    });

    /*
     * Plain order within a trace.
     *
     * Not causality and not drawn as such: it is what lets the timeline read as
     * a sequence when nothing stronger is known about two neighbours.
     */
    rule('sequence', 'Consecutive within one trace', function (ctx) {
        var out = [];
        Object.keys(ctx.byTrace).forEach(function (traceId) {
            if (!traceId) { return; }
            var members = ctx.byTrace[traceId];
            for (var i = 0; i < members.length - 1; i++) {
                var a = members[i];
                var b = members[i + 1];
                if (b.timestamp - a.timestamp > ctx.options.sequenceMs) { continue; }
                out.push(relationship(a.eventId, b.eventId, REL.FOLLOWED_BY,
                    Model.CONFIDENCE.CONFIRMED,
                    [evidence('traceOrder', 'Consecutive events in trace ' + traceId + '.')]));
            }
        });
        return out;
    });

    /* ------------------------------------------------------------------ */
    /* Running them                                                        */
    /* ------------------------------------------------------------------ */

    function buildContext(events, options) {
        var ordered = (events || []).slice()
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        var ctx = {
            events: ordered,
            options: options,
            byId: Object.create(null),
            byTrace: Object.create(null),
            byRecordId: Object.create(null),
            byComponentName: Object.create(null),
            spanEnd: Object.create(null)
        };

        ordered.forEach(function (event) {
            ctx.byId[event.eventId] = event;

            if (event.traceId) {
                if (!ctx.byTrace[event.traceId]) { ctx.byTrace[event.traceId] = []; }
                ctx.byTrace[event.traceId].push(event);
            }
            if (event.entity && event.entity.id) {
                if (!ctx.byRecordId[event.entity.id]) { ctx.byRecordId[event.entity.id] = []; }
                ctx.byRecordId[event.entity.id].push(event);
            }
            var name = event.component && event.component.name;
            if (name) {
                if (!ctx.byComponentName[name]) { ctx.byComponentName[name] = []; }
                ctx.byComponentName[name].push(event);
            }
        });

        /*
         * Where each span ends, resolved before the rules run.
         *
         * A START event carries no duration; its END does, by being a separate
         * event later on. Pairing them once here means the nesting rule can ask
         * "when did this finish" without re-scanning.
         */
        var open = {};
        ordered.forEach(function (event) {
            var type = Model.eventType(event.eventType);
            var key = (event.component && event.component.name) || event.eventType;
            if (type.phase === 'start') {
                if (!open[key]) { open[key] = []; }
                open[key].push(event);
            } else if (type.phase === 'end' && open[key] && open[key].length) {
                var start = open[key].pop();
                ctx.spanEnd[start.eventId] = event.timestamp;
            }
        });

        return ctx;
    }

    /*
     * Two rules reaching the same pair is the normal case, not a conflict.
     * The stronger claim wins and both sets of evidence are kept, because the
     * question the inspector answers is "why do you believe this", and two
     * independent reasons is a better answer than one.
     */
    function mergeRelationships(list) {
        var byKey = Object.create(null);

        list.forEach(function (rel) {
            var existing = byKey[rel.relationshipId];
            if (!existing) { byKey[rel.relationshipId] = rel; return; }

            var incomingRank = Model.CONFIDENCE_RANK[rel.confidence] || 0;
            var existingRank = Model.CONFIDENCE_RANK[existing.confidence] || 0;

            var merged = incomingRank > existingRank ? rel : existing;
            var other = merged === rel ? existing : rel;

            merged.evidence = merged.evidence.concat(other.evidence.filter(function (item) {
                return !merged.evidence.some(function (kept) {
                    return kept.signal === item.signal && kept.detail === item.detail;
                });
            }));
            merged.state = merged.confidence === Model.CONFIDENCE.CONFIRMED ? 'observed' : 'inferred';
            byKey[merged.relationshipId] = merged;
        });

        return Object.keys(byKey).map(function (key) { return byKey[key]; });
    }

    /*
     * Trace membership, added only where it is the difference between an event
     * being in the graph and falling out of it.
     *
     * A shared trace id is a confirmed fact, and the obvious thing to do with
     * it - join every member of a trace to a common anchor - was the first
     * version of this and it was unusable. Thirteen events produced twelve
     * edges radiating from one node, and the causal structure the whole engine
     * exists to show was buried inside the fan.
     *
     * Nothing needed them, either. A transaction root seeds on every event
     * carrying the id, so reachability never depended on these edges, and
     * ordering inside a trace is what the sequence rule is for.
     *
     * So this runs after every rule, sees what they actually produced, and
     * attaches only the events that no other rule connected to anything. Those
     * are real - an event nothing could be related to - and without this they
     * would silently vanish from a trace they demonstrably belong to.
     */
    function attachOrphans(relationships, ctx) {
        var connected = Object.create(null);
        relationships.forEach(function (rel) {
            connected[rel.sourceEventId] = true;
            connected[rel.targetEventId] = true;
        });

        var added = [];
        Object.keys(ctx.byTrace).forEach(function (traceId) {
            var members = ctx.byTrace[traceId];
            if (!traceId || members.length < 2) { return; }
            var anchor = members[0];

            members.forEach(function (event) {
                if (event.eventId === anchor.eventId || connected[event.eventId]) { return; }
                added.push(relationship(anchor.eventId, event.eventId, REL.PART_OF,
                    Model.CONFIDENCE.CONFIRMED,
                    [evidence('traceId', 'Both events carry trace ' + traceId + '. ' +
                        'Nothing else in the trace relates to this event, so it is ' +
                        'attached here to keep it in the graph.')],
                    { rule: 'traceMembership', structural: true }));
            });
        });

        return relationships.concat(added);
    }

    /*
     * Correlate.
     *
     * Returns relationships plus a per-rule account of what each contributed,
     * which is what the Trace Explorer's confidence panel is built from and
     * what makes a surprising graph diagnosable rather than merely wrong.
     */
    function correlate(events, options) {
        var settings = {};
        Object.keys(DEFAULTS).forEach(function (key) { settings[key] = DEFAULTS[key]; });
        Object.keys(options || {}).forEach(function (key) { settings[key] = options[key]; });

        var ctx = buildContext(events, settings);
        var produced = [];
        var report = [];

        rules.forEach(function (entry) {
            if (settings.disabledRules && settings.disabledRules.indexOf(entry.name) !== -1) {
                report.push({ rule: entry.name, label: entry.label, produced: 0, skipped: true });
                return;
            }
            var found = [];
            try {
                found = entry.run(ctx) || [];
            } catch (e) {
                report.push({ rule: entry.name, label: entry.label, produced: 0, error: e.message });
                return;
            }
            report.push({ rule: entry.name, label: entry.label, produced: found.length });
            found.forEach(function (rel) { rel.rule = entry.name; produced.push(rel); });
        });

        var merged = attachOrphans(mergeRelationships(produced), ctx);

        return {
            relationships: merged,
            report: report,
            counts: merged.reduce(function (acc, rel) {
                acc[rel.confidence] = (acc[rel.confidence] || 0) + 1;
                return acc;
            }, {})
        };
    }

    /* Registering a rule is how a package or an external system teaches the
     * engine a signal it could not otherwise know about. */
    function registerRule(name, label, run) {
        rule(name, label, run);
        return rules.length;
    }

    function knownRules() {
        return rules.map(function (entry) {
            return { name: entry.name, label: entry.label };
        });
    }

    var api = {
        REL: REL,
        DEFAULTS: DEFAULTS,
        correlate: correlate,
        registerRule: registerRule,
        knownRules: knownRules,
        mergeRelationships: mergeRelationships,
        relationship: relationship,
        evidence: evidence,
        _buildContext: buildContext
    };

    root.SSCorrelation = api;
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof self !== 'undefined' ? self : this);
