/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Analysis: answering questions from the graph.
 *
 * The specification asks for AI here. What it asks for underneath is more
 * specific than that, and worth separating: answers that cite the events they
 * came from, that never invent a step, and that say when the data cannot
 * support a conclusion. Those are properties of the *retrieval*, not of the
 * language model, and they are the properties that decide whether anybody can
 * act on the answer.
 *
 * So this layer is deterministic. Every question below is answered by walking
 * the graph, and every answer carries the event and relationship ids it was
 * derived from, so a reader can open each one and check. Run it twice on the
 * same trace and it says the same thing - which is not true of a model, and
 * matters when the answer is going in an incident report.
 *
 * Where a language model belongs is on top of this, phrasing these findings
 * for a particular reader. That seam is `narrate()`: it takes a finding and
 * returns the grounded, redacted material a model would need, and this build
 * ships no model call behind it. An engine that quietly posted a customer's
 * event graph to an inference endpoint would violate the security section of
 * the very specification asking for the feature, so the wiring is left
 * explicit and unmade rather than guessed at.
 */
(function (root) {
    'use strict';

    var Model = root.SSEventModel ||
        (typeof require !== 'undefined' ? require('./ss-event-model.js') : null);
    var Trace = root.SSTrace ||
        (typeof require !== 'undefined' ? require('./ss-trace.js') : null);
    var Collectors = root.SSCollectors ||
        (typeof require !== 'undefined' ? require('./ss-collectors.js') : null);

    function citation(event) {
        return {
            eventId: event.eventId,
            at: event.timestampIso,
            what: event.action || event.typeLabel,
            source: event.source.kind,
            confidence: event.confidence
        };
    }

    function relCitation(rel) {
        return {
            relationshipId: rel.relationshipId,
            type: rel.relationshipType,
            confidence: rel.confidence,
            evidence: rel.evidence
        };
    }

    function describe(event) {
        var who = event.actor && event.actor.name ? event.actor.name : 'Something';
        var what = event.action || event.typeLabel || event.eventType;
        var where = event.component && event.component.name
            ? ' (' + event.component.name + ')' : '';
        return who + ': ' + what + where;
    }

    function finding(question, answer, citations, gaps, extra) {
        var result = {
            question: question,
            answer: answer,
            citations: citations || [],
            gaps: gaps || [],
            /*
             * Whether the graph actually supports this, which is a different
             * thing from whether an answer was produced. A finding built
             * entirely on inferred edges is still worth showing and must not
             * be read as a conclusion.
             */
            grounded: (citations || []).length > 0
        };
        Object.keys(extra || {}).forEach(function (key) { result[key] = extra[key]; });
        return result;
    }

    /* ------------------------------------------------------------------ */
    /* Why did this fail?                                                  */
    /* ------------------------------------------------------------------ */

    /*
     * Walk upstream from a failure to the earliest failure it descends from.
     *
     * The first failure in a chain is almost always the real one - everything
     * after it is a consequence being reported as a cause, which is why an
     * error list sorted by time is so misleading. The chain is returned whole
     * so the reader can see the propagation rather than being handed a verdict.
     */
    function whyDidThisFail(graph, eventId) {
        var target = graph.nodes[eventId];
        if (!target) {
            return finding('Why did this fail?', 'That event is not in this trace.', [], []);
        }

        var failed = target.status === Model.STATUS.FAILURE || !!target.error;
        if (!failed) {
            return finding('Why did this fail?',
                describe(target) + ' did not fail.', [citation(target)], []);
        }

        var chain = [target];
        var seen = Object.create(null);
        seen[target.eventId] = true;
        var usedRelationships = [];
        var current = target;

        /* Upstream, preferring the edges that assert causation. */
        for (var hop = 0; hop < 12; hop++) {
            var incoming = (graph.in[current.eventId] || []).filter(function (rel) {
                var from = graph.nodes[rel.sourceEventId];
                if (!from || seen[from.eventId]) { return false; }
                return from.status === Model.STATUS.FAILURE || !!from.error;
            });

            if (!incoming.length) { break; }

            incoming.sort(function (a, b) {
                var causal = { FAILED_BECAUSE_OF: 3, CAUSED: 2, INVOKED: 1 };
                var byType = (causal[b.relationshipType] || 0) - (causal[a.relationshipType] || 0);
                if (byType !== 0) { return byType; }
                var byConfidence = Model.CONFIDENCE_RANK[b.confidence] -
                                   Model.CONFIDENCE_RANK[a.confidence];
                if (byConfidence !== 0) { return byConfidence; }
                /*
                 * Still tied: take the earliest.
                 *
                 * A failure usually has several failed things pointing at it,
                 * all equally well evidenced - the callout that was refused and
                 * the method that gave up because of it both precede the same
                 * end state. Walking towards the earliest is what makes this
                 * converge on the callout rather than on whichever edge the
                 * correlation engine happened to emit first, which is the
                 * difference between naming the cause and naming a symptom.
                 */
                return graph.nodes[a.sourceEventId].timestamp -
                       graph.nodes[b.sourceEventId].timestamp;
            });

            var step = incoming[0];
            var previous = graph.nodes[step.sourceEventId];
            seen[previous.eventId] = true;
            usedRelationships.push(step);
            chain.push(previous);
            current = previous;
        }

        var rootCause = chain[chain.length - 1];
        var message = rootCause.error ? rootCause.error.message : 'no error message was recorded';

        var answer;
        if (chain.length === 1) {
            answer = describe(target) + ' failed with: ' + message + '. ' +
                'Nothing upstream of it in this trace had failed, so this is where ' +
                'the failure starts as far as the collected data shows.';
        } else {
            answer = 'The earliest failure in this chain is ' + describe(rootCause) +
                ' - ' + message + '. ' + (chain.length - 1) + ' further ' +
                (chain.length === 2 ? 'failure' : 'failures') +
                ' followed it, ending at ' + describe(target) + '.';
        }

        var weakest = usedRelationships.reduce(function (worst, rel) {
            return Model.weakestConfidence(worst, rel.confidence);
        }, Model.CONFIDENCE.CONFIRMED);

        var gaps = [];
        if (usedRelationships.length && weakest !== Model.CONFIDENCE.CONFIRMED) {
            gaps.push('The chain from cause to effect is ' + Model.CONFIDENCE_LABEL[weakest] +
                      ', not confirmed - it is read from ordering and context, ' +
                      'not from an execution trace that recorded the link.');
        }

        return finding('Why did this fail?', answer,
            chain.map(citation), gaps,
            {
                chain: chain.map(function (e) { return e.eventId; }),
                relationships: usedRelationships.map(relCitation),
                rootCauseEventId: rootCause.eventId,
                confidence: weakest
            });
    }

    /* ------------------------------------------------------------------ */
    /* What triggered this?                                                */
    /* ------------------------------------------------------------------ */

    function whatTriggered(graph, eventId) {
        var target = graph.nodes[eventId];
        if (!target) {
            return finding('What triggered this?', 'That event is not in this trace.', [], []);
        }

        var incoming = (graph.in[eventId] || []).slice().sort(function (a, b) {
            return Model.CONFIDENCE_RANK[b.confidence] - Model.CONFIDENCE_RANK[a.confidence];
        });

        if (!incoming.length) {
            return finding('What triggered this?',
                'Nothing in the collected data leads to ' + describe(target) + '. ' +
                'It is a starting point of this trace, which may mean it began the ' +
                'journey or simply that whatever caused it was not observed.',
                [citation(target)],
                ['No upstream event was collected. If this should have a cause, ' +
                 'the source that would show it is not being read.']);
        }

        var best = incoming[0];
        var cause = graph.nodes[best.sourceEventId];

        return finding('What triggered this?',
            describe(target) + ' follows ' + describe(cause) + '. ' +
            'The link is ' + Model.CONFIDENCE_LABEL[best.confidence].toLowerCase() +
            ' (' + best.relationshipType + ').',
            [citation(cause), citation(target)],
            best.confidence === Model.CONFIDENCE.CONFIRMED ? []
                : ['This link is ' + Model.CONFIDENCE_LABEL[best.confidence] +
                   '. See the relationship evidence for what it rests on.'],
            {
                relationships: incoming.map(relCitation),
                causeEventId: cause.eventId,
                confidence: best.confidence
            });
    }

    /* ------------------------------------------------------------------ */
    /* Who changed this record?                                            */
    /* ------------------------------------------------------------------ */

    function whoChanged(graph, recordId) {
        var touching = Object.keys(graph.nodes)
            .map(function (id) { return graph.nodes[id]; })
            .filter(function (event) {
                return event.entity && event.entity.id === recordId &&
                    /RECORD_(CREATE|UPDATE|DELETE)/.test(event.eventType);
            })
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        if (!touching.length) {
            return finding('Who changed this record?',
                'No change to ' + recordId + ' appears in the collected data.',
                [], ['Record changes are only visible where a timestamp, field ' +
                     'history entry or debug log was collected for them.']);
        }

        var actors = Object.create(null);
        touching.forEach(function (event) {
            var name = (event.actor && event.actor.name) || 'Unknown';
            if (!actors[name]) { actors[name] = { name: name, count: 0, kind: event.actor && event.actor.kind }; }
            actors[name].count++;
        });

        var names = Object.keys(actors);
        var gaps = [];

        /* The honest caveat about record timestamps, every time it applies. */
        if (touching.some(function (e) { return e.metadata && e.metadata.isLatestOnly; })) {
            gaps.push('Some of these come from LastModifiedDate, which records only ' +
                      'the most recent change. Earlier changes are not visible unless ' +
                      'field history tracking was on.');
        }

        return finding('Who changed this record?',
            names.length === 1
                ? names[0] + ' made ' + touching.length + ' recorded change' +
                  (touching.length === 1 ? '' : 's') + ' to ' + recordId + '.'
                : names.length + ' actors changed ' + recordId + ': ' +
                  names.map(function (n) { return n + ' (' + actors[n].count + ')'; }).join(', ') + '.',
            touching.map(citation), gaps,
            { actors: names.map(function (n) { return actors[n]; }) });
    }

    /* ------------------------------------------------------------------ */
    /* Which operation caused the latency?                                 */
    /* ------------------------------------------------------------------ */

    function slowestOperations(graph, options) {
        options = options || {};
        var limit = options.limit || 5;

        var timed = Object.keys(graph.nodes)
            .map(function (id) { return graph.nodes[id]; })
            .filter(function (event) { return event.duration > 0; })
            .sort(function (a, b) { return b.duration - a.duration; });

        if (!timed.length) {
            return finding('Which operation caused the latency?',
                'No operation in this trace recorded a duration.', [],
                ['Durations come from debug logs, callout responses and external ' +
                 'telemetry. None of those are present here, so timing can only be ' +
                 'read from the gaps between events.']);
        }

        var top = timed.slice(0, limit);
        var total = timed.reduce(function (sum, event) { return sum + event.duration; }, 0);
        var worst = top[0];
        var share = total ? Math.round((worst.duration / total) * 100) : 0;

        return finding('Which operation caused the latency?',
            describe(worst) + ' took ' + worst.duration + 'ms, ' + share +
            '% of all measured time in this trace.',
            top.map(citation),
            /*
             * Nested spans double-count: an Apex unit's duration includes the
             * callout inside it. Said plainly rather than silently producing a
             * percentage that sums past 100.
             */
            ['Durations of nested operations overlap - an Apex unit includes the ' +
             'callouts inside it - so these shares are indicative, not additive.'],
            {
                slowest: top.map(function (event) {
                    return { eventId: event.eventId, what: describe(event), ms: event.duration };
                }),
                measuredTotalMs: total
            });
    }

    /* ------------------------------------------------------------------ */
    /* What happened between two moments?                                  */
    /* ------------------------------------------------------------------ */

    function whatHappenedBetween(graph, fromEventId, toEventId) {
        var from = graph.nodes[fromEventId];
        var to = graph.nodes[toEventId];
        if (!from || !to) {
            return finding('What happened in between?',
                'One of those events is not in this trace.', [], []);
        }

        var start = Math.min(from.timestamp, to.timestamp);
        var end = Math.max(from.timestamp, to.timestamp);

        var between = Object.keys(graph.nodes)
            .map(function (id) { return graph.nodes[id]; })
            .filter(function (event) {
                return event.timestamp >= start && event.timestamp <= end;
            })
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        var failures = between.filter(function (e) {
            return e.status === Model.STATUS.FAILURE || e.error;
        });

        return finding('What happened in between?',
            between.length + ' event' + (between.length === 1 ? '' : 's') + ' over ' +
            (end - start) + 'ms, from ' + describe(from) + ' to ' + describe(to) + '.' +
            (failures.length ? ' ' + failures.length + ' of them failed.' : ''),
            between.map(citation),
            [], { failures: failures.map(function (e) { return e.eventId; }),
                  elapsedMs: end - start });
    }

    /* ------------------------------------------------------------------ */
    /* Summarise the journey                                               */
    /* ------------------------------------------------------------------ */

    /*
     * The story of the trace, in the order it happened.
     *
     * Written as a sequence of steps rather than prose so nothing has to be
     * invented to join them up - the joins are the relationships, and where
     * there is no relationship the summary says the step simply followed,
     * rather than implying it was caused.
     */
    function summarize(graph, options) {
        options = options || {};
        var events = Object.keys(graph.nodes)
            .map(function (id) { return graph.nodes[id]; })
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        if (!events.length) {
            return finding('Summarise this journey', 'There is nothing in this trace.', [], []);
        }

        var actors = Object.create(null);
        var outcomes = [];
        var failures = [];
        var systems = Object.create(null);

        events.forEach(function (event) {
            if (event.actor && event.actor.name) { actors[event.actor.name] = event.actor.kind; }
            if (event.outcome) { outcomes.push(event); }
            if (event.status === Model.STATUS.FAILURE || event.error) { failures.push(event); }
            if (event.component && event.component.kind === Model.COMPONENT_KIND.REST_API &&
                event.component.name) {
                systems[event.component.name] = true;
            }
        });

        var first = events[0];
        var last = events[events.length - 1];
        var elapsed = last.timestamp - first.timestamp;

        var steps = events.map(function (event) {
            var incoming = (graph.in[event.eventId] || []);
            var causal = incoming.filter(function (rel) {
                return rel.relationshipType !== 'FOLLOWED_BY';
            })[0];
            return {
                eventId: event.eventId,
                at: event.timestampIso,
                offsetMs: event.timestamp - first.timestamp,
                what: describe(event),
                status: event.status,
                because: causal
                    ? {
                        eventId: causal.sourceEventId,
                        type: causal.relationshipType,
                        confidence: causal.confidence
                    }
                    : null
            };
        });

        var sentences = [];
        sentences.push(Object.keys(actors).join(', ') + ' produced ' + events.length +
            ' recorded event' + (events.length === 1 ? '' : 's') + ' over ' +
            formatDuration(elapsed) + '.');

        if (Object.keys(systems).length) {
            sentences.push('External systems involved: ' + Object.keys(systems).join(', ') + '.');
        }
        if (outcomes.length) {
            sentences.push('Business outcomes reached: ' + outcomes.map(function (e) {
                return e.typeLabel;
            }).join(', ') + '.');
        } else {
            sentences.push('No business outcome was reached in this trace.');
        }
        if (failures.length) {
            sentences.push(failures.length + ' failure' + (failures.length === 1 ? '' : 's') +
                ', the first being ' + describe(failures[0]) + '.');
        }

        var gaps = Collectors ? Collectors.gapReport(events).map(function (note) {
            return note.label + ': ' + note.missing;
        }) : [];

        return finding('Summarise this journey', sentences.join(' '),
            events.map(citation), gaps,
            {
                steps: steps,
                elapsedMs: elapsed,
                outcomes: outcomes.map(function (e) { return e.eventId; }),
                failures: failures.map(function (e) { return e.eventId; }),
                actors: Object.keys(actors)
            });
    }

    /*
     * Scales all the way up, because a record graph does.
     *
     * This stopped at minutes, which was fine while every trace was one
     * transaction. A record's life is measured in months - an Account created
     * in 2025 reported as "845430 min", a number nobody can read as anything.
     */
    function formatDuration(ms) {
        if (ms === null || ms === undefined) { return ''; }
        if (ms < 1000) { return Math.round(ms) + 'ms'; }
        if (ms < 60000) { return (ms / 1000).toFixed(1) + 's'; }
        if (ms < 3600000) { return Math.round(ms / 60000) + ' min'; }
        if (ms < 86400000) { return (ms / 3600000).toFixed(1) + ' hours'; }
        if (ms < 2592000000) { return Math.round(ms / 86400000) + ' days'; }
        if (ms < 31536000000) { return (ms / 2592000000).toFixed(1) + ' months'; }
        return (ms / 31536000000).toFixed(1) + ' years';
    }

    /* ------------------------------------------------------------------ */
    /* Find traces matching a business condition                           */
    /* ------------------------------------------------------------------ */

    /*
     * "Payment succeeded but document generation failed."
     *
     * Expressed as event types that must be present and absent rather than as
     * a query language, because the interesting questions are all of this
     * shape: something reached one outcome and not the next.
     */
    function tracesWhere(store, spec) {
        spec = spec || {};
        var byTrace = Object.create(null);
        store.all().forEach(function (event) {
            var key = event.traceId || '(untraced)';
            if (!byTrace[key]) { byTrace[key] = []; }
            byTrace[key].push(event);
        });

        var matches = [];
        Object.keys(byTrace).forEach(function (traceId) {
            var events = byTrace[traceId];
            var succeeded = (spec.succeeded || []).every(function (type) {
                return events.some(function (e) {
                    return e.eventType === type && e.status !== Model.STATUS.FAILURE;
                });
            });
            var absentOrFailed = (spec.failedOrMissing || []).every(function (type) {
                return !events.some(function (e) {
                    return e.eventType === type && e.status === Model.STATUS.SUCCESS;
                });
            });
            if (succeeded && absentOrFailed) {
                matches.push({
                    traceId: traceId,
                    events: events.length,
                    from: events[0].timestampIso,
                    failures: events.filter(function (e) {
                        return e.status === Model.STATUS.FAILURE || e.error;
                    }).length
                });
            }
        });

        return finding('Traces matching that condition',
            matches.length + ' trace' + (matches.length === 1 ? '' : 's') + ' matched.',
            [], matches.length ? [] :
                ['Nothing matched. This may mean it did not happen, or that the ' +
                 'events which would show it are not being collected.'],
            { matches: matches });
    }

    /* ------------------------------------------------------------------ */
    /* The AI seam                                                         */
    /* ------------------------------------------------------------------ */

    /*
     * What a language model would be given, and nothing more.
     *
     * Returns the grounded material for a finding with every payload put
     * through the allowlist policy - so what leaves is event types, timings,
     * statuses and the shape of the causal chain, never record contents.
     *
     * There is no call here. Wiring one is a decision about where a customer's
     * event graph is allowed to travel, and that belongs to whoever deploys
     * this, not to a default in a browser extension.
     */
    function narrate(finding, options) {
        options = options || {};
        var allow = options.allow || [];

        return {
            question: finding.question,
            groundedAnswer: finding.answer,
            /* Facts only, redacted. A model may phrase these; it may not add to
             * them, and anything it adds is not in this list to be checked. */
            facts: (finding.citations || []).map(function (item) {
                return {
                    eventId: item.eventId,
                    at: item.at,
                    what: item.what,
                    source: item.source,
                    confidence: item.confidence
                };
            }),
            relationships: finding.relationships || [],
            gaps: finding.gaps || [],
            policy: Model.aiSafePolicy(allow),
            /*
             * The instruction that has to survive to whatever is on the other
             * end. Kept with the payload rather than in a prompt template
             * somewhere, so it cannot be lost when the call is finally wired.
             */
            constraints: [
                'Answer only from the facts provided.',
                'Never introduce an event, record or system that is not listed.',
                'State the gaps as gaps; do not fill them.',
                'Preserve the stated confidence of each link.'
            ],
            ready: false,
            note: 'No inference endpoint is configured. This is the payload such a ' +
                  'call would carry, exposed so it can be reviewed before anything ' +
                  'leaves the browser.'
        };
    }

    var api = {
        whyDidThisFail: whyDidThisFail,
        whatTriggered: whatTriggered,
        whoChanged: whoChanged,
        slowestOperations: slowestOperations,
        whatHappenedBetween: whatHappenedBetween,
        summarize: summarize,
        tracesWhere: tracesWhere,
        narrate: narrate,
        describe: describe,
        formatDuration: formatDuration
    };

    root.SSAnalysis = api;
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof self !== 'undefined' ? self : this);
