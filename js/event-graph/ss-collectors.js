/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Collectors: turning what Salesforce will actually tell us into events.
 *
 * This file is where the engine meets reality, and reality is narrower than
 * the ambition. Salesforce does not expose a trace of its own execution. There
 * is no request id threaded from a click through a flow to a callout, no span
 * a browser extension can subscribe to. What there is:
 *
 *   a debug log        - the richest source by far, and the only one with
 *                        sub-millisecond ordering and real nesting. Requires a
 *                        trace flag to have been set *before* the thing you
 *                        want to look at happened, which is the whole problem
 *                        with debug logs as observability.
 *   record timestamps  - CreatedDate and LastModifiedDate. One per record, no
 *                        history of intermediate states, rounded to the second.
 *   SetupAuditTrail    - configuration changes only, and only for admins.
 *   AsyncApexJob       - queued and batch work, with start and end times.
 *   the browser        - navigation and the extension's own actions. Nothing
 *                        inside the page: a content script is in an isolated
 *                        world and cannot see an LWC's internals.
 *
 * Everything else in the specification's list - Event Monitoring, platform
 * event streams, OmniStudio runtime instances, external telemetry - requires
 * either a licence this org may not have or an integration the customer has to
 * build. Those arrive through ingestExternal, and until they do the engine
 * says the gap out loud rather than inferring across it. See ssEgGapReport.
 *
 * The parsers here are pure: text and rows in, raw events out. Nothing in this
 * file performs a query, which is what makes all of it testable without an org.
 */
(function (root) {
    'use strict';

    var Model = root.SSEventModel ||
        (typeof require !== 'undefined' ? require('./ss-event-model.js') : null);

    /* ------------------------------------------------------------------ */
    /* Browser context                                                     */
    /* ------------------------------------------------------------------ */

    /*
     * What page this is, from the URL alone.
     *
     * Deliberately no DOM inspection. Salesforce's markup is generated, is not
     * a contract, and changes between releases without notice - a selector
     * that reads the record id off a heading works until the Tuesday it does
     * not, and then reports the wrong record rather than none. A URL is a
     * stable, documented surface, and when it does not say, the honest answer
     * is that it does not say.
     */
    var LIGHTNING_RECORD = /\/lightning\/r\/(?:([A-Za-z0-9_]+)\/)?([a-zA-Z0-9]{15,18})(?:\/view)?/;
    var LIGHTNING_OBJECT = /\/lightning\/o\/([A-Za-z0-9_]+)\//;
    var CLASSIC_RECORD = /^\/([a-zA-Z0-9]{15,18})(?:\/|$)/;
    var SETUP_PAGE = /\/lightning\/setup\/([A-Za-z0-9_]+)/;

    /* The three-character prefix identifies the object without a describe. */
    var KNOWN_PREFIXES = {
        '001': 'Account', '003': 'Contact', '005': 'User', '006': 'Opportunity',
        '00Q': 'Lead', '500': 'Case', '801': 'Order', '802': 'OrderItem',
        '800': 'Contract', '0Q0': 'Quote', '01t': 'Product2', '701': 'Campaign'
    };

    function pageContext(url) {
        var context = {
            url: url || '', path: '', recordId: null, objectType: null,
            setupPage: null, kind: 'unknown'
        };
        if (!url) { return context; }

        var path;
        try {
            var parsed = new URL(url, 'https://example.com');
            path = parsed.pathname + (parsed.hash || '');
        } catch (e) {
            path = String(url);
        }
        context.path = path;

        var lightning = path.match(LIGHTNING_RECORD);
        if (lightning) {
            context.recordId = lightning[2];
            context.objectType = lightning[1] || prefixToObject(lightning[2]);
            context.kind = 'record';
            return context;
        }

        var list = path.match(LIGHTNING_OBJECT);
        if (list) {
            context.objectType = list[1];
            context.kind = 'list';
            return context;
        }

        var setup = path.match(SETUP_PAGE);
        if (setup) {
            context.setupPage = setup[1];
            context.kind = 'setup';
            return context;
        }

        var classic = path.match(CLASSIC_RECORD);
        if (classic) {
            context.recordId = classic[1];
            context.objectType = prefixToObject(classic[1]);
            context.kind = 'record';
            return context;
        }

        return context;
    }

    function prefixToObject(recordId) {
        if (!recordId || recordId.length < 3) { return null; }
        return KNOWN_PREFIXES[recordId.slice(0, 3)] || null;
    }

    /*
     * A navigation, as an event.
     *
     * This is a real observation - the user went somewhere - and it is the
     * anchor most traces hang off, because it is the one moment the extension
     * can timestamp precisely and attribute to a person with certainty.
     */
    function fromNavigation(spec) {
        var context = pageContext(spec.url);
        var isRecord = context.kind === 'record';

        return {
            eventType: isRecord ? 'RECORD_VIEW' : 'URL_NAVIGATION',
            timestamp: spec.timestamp || Date.now(),
            actor: spec.actor,
            session: spec.session,
            source: { kind: Model.PROVENANCE.BROWSER, system: 'extension', detail: 'navigation' },
            entity: isRecord
                ? { type: context.objectType, id: context.recordId, name: context.recordId }
                : null,
            component: { kind: Model.COMPONENT_KIND.UI, name: context.setupPage || context.objectType || 'Page' },
            action: isRecord
                ? 'Opened ' + (context.objectType || 'record') + ' ' + context.recordId
                : 'Navigated to ' + context.path,
            status: Model.STATUS.SUCCESS,
            metadata: { path: context.path, pageKind: context.kind }
        };
    }

    /* ------------------------------------------------------------------ */
    /* Debug logs                                                          */
    /* ------------------------------------------------------------------ */

    /*
     * A debug log into events.
     *
     * The one Salesforce source with true execution structure: nesting, real
     * ordering, and nanosecond offsets. Every line looks like
     *
     *   HH:MM:SS.mmm (nanosSinceStart)|EVENT_NAME|field|field|…
     *
     * The wall-clock part only carries a time of day, so the log's own
     * StartTime supplies the date; the nanosecond counter supplies precision
     * the timestamp does not have, which is what makes two callouts 3ms apart
     * orderable at all.
     *
     * Only the lines that describe work are read. METHOD_ENTRY and friends are
     * skipped by default - a FINEST log is hundreds of thousands of lines, and
     * a graph with one node per method call is not a graph anybody can use.
     */
    var LOG_LINE = /^(\d{2}):(\d{2}):(\d{2})\.(\d{1,3})\s+\((\d+)\)\|(.+)$/;

    function parseDebugLog(body, spec) {
        spec = spec || {};
        var lines = String(body || '').split(/\r?\n/);
        var events = [];

        /* The date the log belongs to; the lines only carry a time of day. */
        var base = spec.startTime ? Model.toMillis(spec.startTime) : null;
        var baseDay = base === null ? null : new Date(base);

        var traceId = spec.traceId || ('log-' + (spec.logId || Model.newId('log')));
        var actor = spec.actor || null;
        var stack = [];
        var unmatched = [];
        var pendingCallout = null;

        function timeOf(hh, mm, ss, ms, nanos) {
            if (baseDay === null) { return null; }
            var day = new Date(baseDay.getTime());
            day.setHours(Number(hh), Number(mm), Number(ss), Number(ms));
            /* Sub-millisecond ordering from the nanosecond counter, so events
             * inside one millisecond keep the order the log recorded. */
            return day.getTime() + (Number(nanos) % 1000000) / 1000000;
        }

        function base_(type, when, extra) {
            var event = {
                eventType: type,
                timestamp: when,
                traceId: traceId,
                actor: actor,
                session: spec.session,
                source: {
                    kind: Model.PROVENANCE.SALESFORCE,
                    system: 'Apex debug log',
                    detail: spec.logId || null
                },
                status: Model.STATUS.SUCCESS
            };
            Object.keys(extra || {}).forEach(function (key) { event[key] = extra[key]; });
            return event;
        }

        lines.forEach(function (line) {
            var match = line.match(LOG_LINE);
            if (!match) { return; }

            var when = timeOf(match[1], match[2], match[3], match[4], match[5]);
            if (when === null) { return; }

            var parts = match[6].split('|');
            var kind = parts[0];

            switch (kind) {
                case 'CODE_UNIT_STARTED': {
                    var name = parts[parts.length - 1] || 'Apex';
                    var isFlow = /Flow:|Workflow:|FlowInterview/i.test(name);
                    var event = base_(isFlow ? 'FLOW_START' : 'APEX_START', when, {
                        component: {
                            kind: isFlow ? Model.COMPONENT_KIND.FLOW : Model.COMPONENT_KIND.APEX,
                            name: name.replace(/^\[EXTERNAL\]\s*/, '')
                        },
                        action: name
                    });
                    events.push(event);
                    /*
                     * The frame is not the event. A unit that later throws did
                     * not fail *at its start* - marking the START event would
                     * put a red node at the moment execution entered the
                     * method, which reads as the call itself being rejected.
                     * The failure belongs to the END, so it is carried here
                     * and applied there.
                     */
                    stack.push({ event: event, failed: false, error: null });
                    break;
                }

                case 'CODE_UNIT_FINISHED': {
                    var frame = stack.pop();
                    if (!frame) { unmatched.push(kind); break; }
                    events.push(closeFrame(frame, when));
                    break;
                }

                case 'DML_BEGIN': {
                    /* Op:Insert|Type:Account|Rows:1 */
                    var fields = {};
                    parts.forEach(function (part) {
                        var pair = part.split(':');
                        if (pair.length === 2) { fields[pair[0]] = pair[1]; }
                    });
                    var operation = (fields.Op || '').toLowerCase();
                    var dmlType = operation === 'insert' ? 'RECORD_CREATE'
                                : operation === 'delete' ? 'RECORD_DELETE'
                                : 'RECORD_UPDATE';
                    events.push(base_(dmlType, when, {
                        entity: { type: fields.Type || null, id: null, name: fields.Type || null },
                        action: (fields.Op || 'DML') + ' ' + (fields.Rows || '?') +
                                ' × ' + (fields.Type || 'record'),
                        component: stack.length ? stack[stack.length - 1].component : null,
                        parentEventId: null,
                        metadata: { rows: Number(fields.Rows) || null, operation: fields.Op || null }
                    }));
                    break;
                }

                case 'CALLOUT_REQUEST': {
                    var endpointMatch = match[6].match(/Endpoint=([^,\]]+)/);
                    var methodMatch = match[6].match(/Method=([A-Z]+)/);
                    var endpoint = endpointMatch ? endpointMatch[1] : null;
                    pendingCallout = base_('HTTP_REQUEST', when, {
                        component: {
                            kind: Model.COMPONENT_KIND.REST_API,
                            name: hostOf(endpoint) || 'callout'
                        },
                        action: (methodMatch ? methodMatch[1] + ' ' : '') + (endpoint || 'callout'),
                        metadata: { endpoint: endpoint, method: methodMatch ? methodMatch[1] : null }
                    });
                    events.push(pendingCallout);
                    break;
                }

                case 'CALLOUT_RESPONSE': {
                    var statusMatch = match[6].match(/StatusCode=(\d+)/);
                    var code = statusMatch ? Number(statusMatch[1]) : null;
                    events.push(base_('HTTP_RESPONSE', when, {
                        component: pendingCallout ? pendingCallout.component
                            : { kind: Model.COMPONENT_KIND.REST_API, name: 'callout' },
                        action: 'Response ' + (code === null ? '' : code),
                        duration: pendingCallout ? Math.round(when - pendingCallout.timestamp) : null,
                        status: code === null ? Model.STATUS.UNKNOWN
                            : code >= 400 ? Model.STATUS.FAILURE : Model.STATUS.SUCCESS,
                        error: code !== null && code >= 400
                            ? { code: code, message: 'Callout returned HTTP ' + code } : null,
                        metadata: {
                            statusCode: code,
                            endpoint: pendingCallout && pendingCallout.metadata.endpoint
                        }
                    }));
                    pendingCallout = null;
                    break;
                }

                case 'FLOW_START_INTERVIEW_BEGIN': {
                    var flowName = parts[parts.length - 1] || 'Flow';
                    var flowEvent = base_('FLOW_START', when, {
                        component: { kind: Model.COMPONENT_KIND.FLOW, name: flowName },
                        action: 'Flow ' + flowName
                    });
                    events.push(flowEvent);
                    stack.push({ event: flowEvent, failed: false, error: null });
                    break;
                }

                case 'FLOW_START_INTERVIEW_END': {
                    var flowFrame = stack.pop();
                    if (!flowFrame) { unmatched.push(kind); break; }
                    events.push(closeFrame(flowFrame, when));
                    break;
                }

                case 'FATAL_ERROR':
                case 'EXCEPTION_THROWN': {
                    var message = parts.slice(1).join('|') || 'Unhandled exception';
                    /*
                     * Recorded against the frame, not emitted as an event of
                     * its own. An exception is how a unit ended, not a separate
                     * thing that happened alongside it - emitting both produced
                     * two ends for one method and made the graph's own root
                     * cause analysis pick the duplicate over the callout that
                     * actually caused it.
                     */
                    if (stack.length) {
                        var top = stack[stack.length - 1];
                        top.failed = true;
                        top.error = { code: kind, message: message };
                    }
                    break;
                }

                default:
                    break;
            }
        });

        /*
         * Frames still open at the end of the log.
         *
         * A log cut off by Salesforce's size cap leaves methods that never
         * finish. They are closed at the last moment observed and marked, so
         * the graph shows an operation of unknown length rather than silently
         * omitting it.
         */
        var lastSeen = events.length ? events[events.length - 1].timestamp : null;
        while (stack.length) {
            var open = stack.pop();
            var closed = closeFrame(open, lastSeen || open.event.timestamp);
            closed.metadata = closed.metadata || {};
            closed.metadata.neverClosed = true;
            closed.duration = null;
            events.push(closed);
        }

        function closeFrame(frame, when) {
            var isFlow = frame.event.eventType === 'FLOW_START';
            return base_(isFlow ? 'FLOW_END' : 'APEX_END', when, {
                component: frame.event.component,
                action: frame.event.action,
                duration: Math.round(when - frame.event.timestamp),
                status: frame.failed ? Model.STATUS.FAILURE : Model.STATUS.SUCCESS,
                error: frame.error
            });
        }

        events.sort(function (a, b) { return a.timestamp - b.timestamp; });

        return {
            events: events,
            unmatched: unmatched,
            traceId: traceId,
            /*
             * What the log could not tell us. A log truncated by Salesforce's
             * size cap is missing its tail, and a graph built from one must
             * say so rather than presenting a journey that simply stops.
             */
            truncated: /MAXIMUM DEBUG LOG SIZE REACHED/i.test(String(body || ''))
        };
    }

    function hostOf(url) {
        if (!url) { return null; }
        try { return new URL(url).hostname; } catch (e) {
            var match = String(url).match(/^https?:\/\/([^/]+)/);
            return match ? match[1] : null;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Records                                                             */
    /* ------------------------------------------------------------------ */

    /*
     * A record's own timestamps, as events.
     *
     * Two events at most per record, and that is the honest limit of this
     * source: CreatedDate says it was made, LastModifiedDate says it changed
     * at least once. Everything between is gone unless field history tracking
     * was on, and even then only for tracked fields.
     *
     * So an update event from here is marked as what it is - the *last* change,
     * not *a* change - because a graph that draws one update when there were
     * nine is understating by a factor nobody can see.
     */
    function fromRecords(rows, spec) {
        spec = spec || {};
        var events = [];

        (rows || []).forEach(function (row) {
            if (!row || !row.Id) { return; }
            var type = spec.objectType || prefixToObject(row.Id);
            var name = row.Name || row.CaseNumber || row.OrderNumber || row.Subject || row.Id;

            var references = [];
            Object.keys(row).forEach(function (key) {
                if (!/Id$/.test(key) || key === 'Id') { return; }
                var value = row[key];
                if (typeof value === 'string' && /^[a-zA-Z0-9]{15,18}$/.test(value)) {
                    references.push({ field: key, id: value });
                }
            });

            if (row.CreatedDate) {
                events.push({
                    eventType: 'RECORD_CREATE',
                    timestamp: row.CreatedDate,
                    actor: row.CreatedBy
                        ? { kind: Model.ACTOR_KIND.USER, id: row.CreatedById, name: row.CreatedBy.Name }
                        : (row.CreatedById ? { kind: Model.ACTOR_KIND.USER, id: row.CreatedById } : null),
                    source: { kind: Model.PROVENANCE.SALESFORCE, system: 'record', detail: 'CreatedDate' },
                    entity: { type: type, id: row.Id, name: name },
                    action: 'Created ' + (type || 'record') + ' ' + name,
                    status: Model.STATUS.SUCCESS,
                    metadata: { references: references }
                });
            }

            if (row.LastModifiedDate && row.LastModifiedDate !== row.CreatedDate) {
                events.push({
                    eventType: 'RECORD_UPDATE',
                    timestamp: row.LastModifiedDate,
                    actor: row.LastModifiedBy
                        ? { kind: Model.ACTOR_KIND.USER, id: row.LastModifiedById, name: row.LastModifiedBy.Name }
                        : (row.LastModifiedById ? { kind: Model.ACTOR_KIND.USER, id: row.LastModifiedById } : null),
                    source: { kind: Model.PROVENANCE.SALESFORCE, system: 'record', detail: 'LastModifiedDate' },
                    entity: { type: type, id: row.Id, name: name },
                    action: 'Last changed ' + (type || 'record') + ' ' + name,
                    status: Model.STATUS.SUCCESS,
                    metadata: {
                        references: references,
                        /* Said plainly, because the difference matters: this is
                         * the most recent change, not every change. */
                        isLatestOnly: true
                    }
                });
            }
        });

        return events;
    }

    /* Field history, where it was switched on: real intermediate changes. */
    function fromFieldHistory(rows, spec) {
        spec = spec || {};
        return (rows || []).filter(function (row) { return row && row.CreatedDate; })
            .map(function (row) {
                var parentId = row.ParentId || row.CaseId || row.OpportunityId || row.AccountId;
                return {
                    eventType: 'RECORD_UPDATE',
                    timestamp: row.CreatedDate,
                    actor: row.CreatedBy
                        ? { kind: Model.ACTOR_KIND.USER, id: row.CreatedById, name: row.CreatedBy.Name }
                        : null,
                    source: { kind: Model.PROVENANCE.SALESFORCE, system: 'field history',
                              detail: spec.objectType || null },
                    entity: { type: spec.objectType || null, id: parentId, name: parentId },
                    action: 'Changed ' + (row.Field || 'a field'),
                    status: Model.STATUS.SUCCESS,
                    metadata: { field: row.Field, from: row.OldValue, to: row.NewValue }
                };
            });
    }

    /* ------------------------------------------------------------------ */
    /* Setup audit trail                                                   */
    /* ------------------------------------------------------------------ */

    function fromAuditTrail(rows) {
        return (rows || []).filter(function (row) { return row && row.CreatedDate; })
            .map(function (row) {
                return {
                    eventType: 'RECORD_UPDATE',
                    timestamp: row.CreatedDate,
                    actor: row.CreatedBy
                        ? { kind: Model.ACTOR_KIND.USER, id: row.CreatedById, name: row.CreatedBy.Name }
                        : { kind: Model.ACTOR_KIND.USER, id: row.CreatedById },
                    source: { kind: Model.PROVENANCE.SALESFORCE, system: 'SetupAuditTrail',
                              detail: row.Section || null },
                    entity: { type: 'Setup', id: null, name: row.Section || 'Setup' },
                    component: { kind: null, name: row.Section || null },
                    action: row.Display || row.Action,
                    status: Model.STATUS.SUCCESS,
                    metadata: { section: row.Section, auditAction: row.Action,
                                delegate: row.DelegateUser || null }
                };
            });
    }

    /* ------------------------------------------------------------------ */
    /* Async jobs                                                          */
    /* ------------------------------------------------------------------ */

    function fromAsyncJobs(rows) {
        var events = [];
        (rows || []).forEach(function (row) {
            if (!row || !row.CreatedDate) { return; }
            var name = (row.ApexClass && row.ApexClass.Name) || row.MethodName || row.JobType || 'Async job';
            var failed = row.Status === 'Failed' || row.Status === 'Aborted' || row.NumberOfErrors > 0;

            events.push({
                eventType: 'APEX_START',
                timestamp: row.CreatedDate,
                actor: row.CreatedById ? { kind: Model.ACTOR_KIND.USER, id: row.CreatedById } : null,
                source: { kind: Model.PROVENANCE.SALESFORCE, system: 'AsyncApexJob', detail: row.JobType },
                component: { kind: Model.COMPONENT_KIND.APEX, name: name },
                action: (row.JobType || 'Async') + ' ' + name,
                status: Model.STATUS.SUCCESS,
                metadata: { jobId: row.Id, jobType: row.JobType, items: row.TotalJobItems }
            });

            if (row.CompletedDate) {
                events.push({
                    eventType: 'APEX_END',
                    timestamp: row.CompletedDate,
                    actor: row.CreatedById ? { kind: Model.ACTOR_KIND.USER, id: row.CreatedById } : null,
                    source: { kind: Model.PROVENANCE.SALESFORCE, system: 'AsyncApexJob', detail: row.JobType },
                    component: { kind: Model.COMPONENT_KIND.APEX, name: name },
                    action: (row.JobType || 'Async') + ' ' + name + ' finished',
                    duration: Model.toMillis(row.CompletedDate) - Model.toMillis(row.CreatedDate),
                    status: failed ? Model.STATUS.FAILURE : Model.STATUS.SUCCESS,
                    error: failed
                        ? { code: row.Status, message: row.ExtendedStatus || (row.NumberOfErrors + ' error(s)') }
                        : null,
                    metadata: { jobId: row.Id, errors: row.NumberOfErrors }
                });
            }
        });
        return events;
    }

    /* ------------------------------------------------------------------ */
    /* OmniStudio design-time                                              */
    /* ------------------------------------------------------------------ */

    /*
     * Which OmniStudio component calls which, from configuration.
     *
     * This produces dependencies for the correlation engine, never events.
     * The distinction is the one the specification is most insistent about and
     * the easiest to get wrong: that an OmniScript is configured to call an
     * Integration Procedure is a fact about the org, and evidence of nothing
     * whatsoever about 10:42 this morning.
     */
    function omniDependencies(rows) {
        var dependencies = [];
        (rows || []).forEach(function (row) {
            if (!row) { return; }
            var from = row.Name || row.name ||
                (row.OmniProcess && row.OmniProcess.Name) || null;
            if (!from) { return; }

            var definition = row.PropertySetConfig || row.propertySetConfig || '';
            var text = typeof definition === 'string' ? definition : JSON.stringify(definition);

            /* Named references inside the element's configuration. */
            [
                [/"integrationProcedureKey"\s*:\s*"([^"]+)"/g, 'integrationProcedure'],
                [/"bundle"\s*:\s*"([^"]+)"/g, 'dataMapper'],
                [/"dataRaptor(?:Bundle)?"\s*:\s*"([^"]+)"/g, 'dataMapper'],
                [/"remoteClass"\s*:\s*"([^"]+)"/g, 'apex']
            ].forEach(function (pair) {
                var pattern = pair[0];
                var kind = pair[1];
                var found;
                while ((found = pattern.exec(text)) !== null) {
                    dependencies.push({ from: from, to: found[1], kind: kind, designTime: true });
                }
            });
        });
        return dependencies;
    }

    /* ------------------------------------------------------------------ */
    /* External ingestion                                                  */
    /* ------------------------------------------------------------------ */

    /*
     * The documented way in for anything this engine cannot observe.
     *
     * Validated rather than trusted. An external system - a payment gateway, an
     * ERP, an agent runtime - submits events in the shape the specification
     * defines, and anything malformed is rejected with a reason rather than
     * being coerced into the graph. A trace containing a silently-repaired
     * event is worse than one with an acknowledged hole.
     */
    function ingestExternal(payload, spec) {
        spec = spec || {};
        var batch = Array.isArray(payload) ? payload : (payload && payload.events) || [];
        var accepted = [];
        var rejected = [];

        batch.forEach(function (raw, index) {
            if (!raw || typeof raw !== 'object') {
                rejected.push({ index: index, reason: 'Not an object.' });
                return;
            }
            if (!raw.eventType) {
                rejected.push({ index: index, reason: 'Missing eventType.' });
                return;
            }
            if (Model.toMillis(raw.timestamp) === null) {
                rejected.push({ index: index, reason: 'Missing or unparseable timestamp.' });
                return;
            }

            accepted.push({
                eventType: raw.eventType,
                timestamp: raw.timestamp,
                traceId: raw.traceId || null,
                parentEventId: raw.parentEventId || null,
                duration: typeof raw.duration === 'number' ? raw.duration : null,
                actor: raw.actor || { kind: Model.ACTOR_KIND.SYSTEM, name: raw.source || 'External' },
                session: raw.session || null,
                /*
                 * Forced to 'external' whatever the sender claimed. A system
                 * submitting telemetry does not get to describe itself as the
                 * browser or as Salesforce - provenance is a statement about
                 * how this engine came to know a thing, and it is not the
                 * sender's to make.
                 */
                source: {
                    kind: Model.PROVENANCE.EXTERNAL,
                    system: raw.source || spec.system || 'external',
                    detail: raw.sourceDetail || null
                },
                entity: raw.entity
                    ? { type: (raw.entity.type || null), id: raw.entity.id || null,
                        name: raw.entity.name || null, external: true,
                        system: raw.source || spec.system || null }
                    : null,
                component: raw.component || null,
                input: raw.input || null,
                output: raw.output || null,
                status: raw.status || Model.STATUS.UNKNOWN,
                error: raw.error || null,
                metadata: raw.metadata || {}
            });
        });

        return { events: accepted, rejected: rejected };
    }

    /* ------------------------------------------------------------------ */
    /* Agent and MCP                                                       */
    /* ------------------------------------------------------------------ */

    /*
     * An agent's work, in the same graph as everyone else's.
     *
     * There is no separate agent pipeline: an agent is an actor whose kind is
     * 'agent', and a tool call is an event with a component whose kind is
     * 'mcpTool'. That is the entire integration, and it is why "show me
     * everything this agent did" needs no traversal code of its own.
     */
    function fromAgentTrace(payload) {
        var events = [];
        var trace = payload || {};
        var traceId = trace.traceId || Model.newId('agent');
        var agent = {
            kind: Model.ACTOR_KIND.AGENT,
            id: trace.agentId || trace.agent || 'agent',
            name: trace.agentName || trace.agent || 'Agent',
            onBehalfOf: trace.onBehalfOf || trace.userId || null
        };

        if (trace.requestedAt) {
            events.push({
                eventType: 'AGENT_REQUEST',
                timestamp: trace.requestedAt,
                traceId: traceId,
                actor: agent,
                source: { kind: Model.PROVENANCE.INSTRUMENTATION, system: 'agent' },
                component: { kind: Model.COMPONENT_KIND.AGENT, name: agent.name },
                action: trace.prompt ? 'Agent asked: ' + String(trace.prompt).slice(0, 80) : 'Agent request',
                input: trace.input || null,
                status: Model.STATUS.SUCCESS,
                metadata: { approval: trace.approval || null, risk: trace.risk || null }
            });
        }

        (trace.toolCalls || []).forEach(function (call) {
            if (!call || !call.calledAt) { return; }
            events.push({
                eventType: 'MCP_TOOL_CALL',
                timestamp: call.calledAt,
                traceId: traceId,
                actor: agent,
                source: { kind: Model.PROVENANCE.INSTRUMENTATION, system: 'mcp' },
                component: { kind: Model.COMPONENT_KIND.MCP_TOOL, name: call.tool || 'tool' },
                action: 'Called ' + (call.tool || 'tool'),
                input: call.arguments || null,
                status: Model.STATUS.SUCCESS,
                metadata: { approval: call.approval || null, risk: call.risk || null }
            });

            if (call.respondedAt) {
                var failed = call.status === 'failure' || !!call.error;
                events.push({
                    eventType: 'MCP_TOOL_RESPONSE',
                    timestamp: call.respondedAt,
                    traceId: traceId,
                    actor: agent,
                    source: { kind: Model.PROVENANCE.INSTRUMENTATION, system: 'mcp' },
                    component: { kind: Model.COMPONENT_KIND.MCP_TOOL, name: call.tool || 'tool' },
                    action: (call.tool || 'tool') + ' returned',
                    duration: Model.toMillis(call.respondedAt) - Model.toMillis(call.calledAt),
                    output: call.result || null,
                    status: failed ? Model.STATUS.FAILURE : Model.STATUS.SUCCESS,
                    error: call.error || null,
                    metadata: {
                        recordsAccessed: call.recordsAccessed || [],
                        systemsAccessed: call.systemsAccessed || []
                    }
                });
            }
        });

        return events;
    }

    /* ------------------------------------------------------------------ */
    /* What is missing                                                     */
    /* ------------------------------------------------------------------ */

    /*
     * The gap report.
     *
     * The product principle is "what actually happened", and the honest half of
     * that is saying which parts nothing could see. A trace assembled only from
     * record timestamps looks thin because it *is* thin, and the interface must
     * say why rather than letting the user conclude that nothing else happened.
     *
     * This is why the engine is worth trusting: it volunteers its own blind
     * spots instead of waiting to be caught out by them.
     */
    var SOURCE_NOTES = [
        {
            id: 'debugLog',
            label: 'Apex debug logs',
            gives: 'Execution structure, callouts, DML, real ordering.',
            missing: 'Nothing was captured. A trace flag has to be set before the ' +
                     'transaction runs, so this cannot be collected after the fact.'
        },
        {
            id: 'eventMonitoring',
            label: 'Event Monitoring',
            gives: 'API calls, page views and logins across the whole org.',
            missing: 'Not read by this engine. It needs the Event Monitoring ' +
                     'add-on licence and EventLogFile access.'
        },
        {
            id: 'omniRuntime',
            label: 'OmniStudio runtime',
            gives: 'Which OmniScript and Integration Procedure actually ran.',
            missing: 'Only design-time configuration was read. Runtime execution ' +
                     'needs instrumentation the org has to publish.'
        },
        {
            id: 'external',
            label: 'External systems',
            gives: 'What happened outside Salesforce.',
            missing: 'No external telemetry has been submitted, so anything past ' +
                     'the callout boundary is unknown.'
        },
        {
            id: 'platformEvents',
            label: 'Platform events',
            gives: 'Published and consumed event streams.',
            missing: 'A browser extension cannot subscribe to an event bus ' +
                     'retrospectively; only aggregate usage metrics are available.'
        }
    ];

    function gapReport(events) {
        var present = Object.create(null);
        (events || []).forEach(function (event) {
            present[event.source.kind] = true;
            if (event.source.system === 'Apex debug log') { present.debugLog = true; }
            if (event.source.system === 'mcp' || event.source.system === 'agent') { present.agent = true; }
        });

        return SOURCE_NOTES.filter(function (note) {
            if (note.id === 'debugLog') { return !present.debugLog; }
            if (note.id === 'external') { return !present[Model.PROVENANCE.EXTERNAL]; }
            if (note.id === 'omniRuntime') { return !present[Model.PROVENANCE.INSTRUMENTATION]; }
            return true;
        });
    }

    var api = {
        pageContext: pageContext,
        prefixToObject: prefixToObject,
        fromNavigation: fromNavigation,
        parseDebugLog: parseDebugLog,
        fromRecords: fromRecords,
        fromFieldHistory: fromFieldHistory,
        fromAuditTrail: fromAuditTrail,
        fromAsyncJobs: fromAsyncJobs,
        omniDependencies: omniDependencies,
        ingestExternal: ingestExternal,
        fromAgentTrace: fromAgentTrace,
        gapReport: gapReport,
        SOURCE_NOTES: SOURCE_NOTES,
        hostOf: hostOf
    };

    root.SSCollectors = api;
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof self !== 'undefined' ? self : this);
