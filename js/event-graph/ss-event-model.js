/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * The canonical event.
 *
 * Everything in the Event Graph Engine is one shape: an event. A click in the
 * browser, a row in SetupAuditTrail, an HTTP callout a customer's Apex logged,
 * an MCP tool call an agent made - they arrive from six different places in six
 * different shapes and become this, or they do not enter the graph at all.
 *
 * Two fields carry more weight than the rest, and they are the two that most
 * observability tools leave out:
 *
 *   source.kind  - where this event came from. A record that exists is not the
 *                  same claim as a click somebody watched, and neither is the
 *                  same as a relationship a metadata dependency implies. The
 *                  graph shows all three and never lets them look alike.
 *
 *   state        - observed or inferred. An inferred event is one nothing
 *                  reported: it is reconstructed from its consequences. It may
 *                  be right and it is never a fact.
 *
 * The event type registry is open on purpose. A managed package, an external
 * system or a tool that does not exist yet registers its own types and the
 * graph carries them without a line changing here - which is the whole reason
 * the engine keys on category and provenance rather than on a fixed enum.
 */
(function (root) {
    'use strict';

    /* ------------------------------------------------------------------ */
    /* Provenance - where a claim came from                                */
    /* ------------------------------------------------------------------ */

    /*
     * Ordered from "somebody watched this happen" to "something worked this
     * out". The order is used: when two sources describe the same event, the
     * one nearer the top wins, because it is nearer the event.
     */
    var PROVENANCE = {
        BROWSER:         'browser',
        SALESFORCE:      'salesforce',
        INSTRUMENTATION: 'instrumentation',
        EXTERNAL:        'external',
        METADATA:        'metadata',
        INFERRED:        'inferred'
    };

    var PROVENANCE_RANK = {
        browser: 1, salesforce: 1, instrumentation: 2,
        external: 3, metadata: 4, inferred: 5
    };

    var PROVENANCE_LABEL = {
        browser:         'Observed in the browser',
        salesforce:      'Reported by Salesforce',
        instrumentation: 'Customer instrumentation',
        external:        'External telemetry',
        metadata:        'Derived from metadata',
        inferred:        'Inferred by this engine'
    };

    /* ------------------------------------------------------------------ */
    /* Confidence                                                          */
    /* ------------------------------------------------------------------ */

    /*
     * Four words, not a percentage. A number invites arithmetic on it - an
     * average of two confidences means nothing - and reads as a measurement
     * when it is a category. The numeric band exists only for ordering.
     */
    var CONFIDENCE = {
        CONFIRMED: 'CONFIRMED',
        LIKELY:    'LIKELY',
        INFERRED:  'INFERRED',
        UNKNOWN:   'UNKNOWN'
    };

    var CONFIDENCE_RANK = { CONFIRMED: 4, LIKELY: 3, INFERRED: 2, UNKNOWN: 1 };

    var CONFIDENCE_LABEL = {
        CONFIRMED: 'Confirmed',
        LIKELY:    'Likely',
        INFERRED:  'Inferred',
        UNKNOWN:   'Unknown'
    };

    function confidenceAtLeast(value, floor) {
        return (CONFIDENCE_RANK[value] || 0) >= (CONFIDENCE_RANK[floor] || 0);
    }

    // The weaker of two, which is what a chain of reasoning is worth: a
    // confirmed step reached through an inferred one is inferred.
    function weakestConfidence(a, b) {
        return (CONFIDENCE_RANK[a] || 0) <= (CONFIDENCE_RANK[b] || 0) ? a : b;
    }

    /* ------------------------------------------------------------------ */
    /* Actors, components, entities                                        */
    /* ------------------------------------------------------------------ */

    var ACTOR_KIND = {
        USER:       'user',
        AGENT:      'agent',
        API_CLIENT: 'apiClient',
        SYSTEM:     'system'
    };

    /*
     * Component kinds are a hint for rendering and grouping, never a gate.
     * An unrecognised kind renders as itself rather than being dropped -
     * dropping it is how a managed package becomes invisible in its own trace.
     */
    var COMPONENT_KIND = {
        LWC:                   'lwc',
        AURA:                  'aura',
        VISUALFORCE:           'visualforce',
        FLOW:                  'flow',
        APEX:                  'apex',
        OMNISCRIPT:            'omniscript',
        INTEGRATION_PROCEDURE: 'integrationProcedure',
        DATA_MAPPER:           'dataMapper',
        REST_API:              'restApi',
        SOAP_API:              'soapApi',
        PLATFORM_EVENT:        'platformEvent',
        AGENT:                 'agent',
        MCP_TOOL:              'mcpTool',
        EXTERNAL_SERVICE:      'externalService',
        UI:                    'ui'
    };

    var STATUS = {
        SUCCESS: 'success',
        FAILURE: 'failure',
        PENDING: 'pending',
        UNKNOWN: 'unknown'
    };

    /* ------------------------------------------------------------------ */
    /* Event type registry                                                 */
    /* ------------------------------------------------------------------ */

    /*
     * Open by design. register() is how a managed package, an external system
     * or a future agent runtime adds its vocabulary; nothing downstream
     * switches on the literal type, only on category, so the graph engine
     * never has to learn about them.
     */
    var CATEGORY = {
        UI:          'UI',
        SALESFORCE:  'SALESFORCE',
        INTEGRATION: 'INTEGRATION',
        BUSINESS:    'BUSINESS',
        AGENT:       'AGENT',
        CUSTOM:      'CUSTOM'
    };

    var types = Object.create(null);

    function registerEventType(type, spec) {
        if (!type) { return null; }
        var entry = {
            type: type,
            category: (spec && spec.category) || CATEGORY.CUSTOM,
            label: (spec && spec.label) || humanize(type),
            // Whether this type opens or closes a span. A START with a matching
            // END is one operation with a duration, not two events.
            phase: (spec && spec.phase) || null,
            // The type that closes this one, for span pairing.
            closedBy: (spec && spec.closedBy) || null,
            componentKind: (spec && spec.componentKind) || null,
            // A terminal business fact - what the trace was ultimately for.
            outcome: !!(spec && spec.outcome),
            registeredAt: Date.now()
        };
        types[type] = entry;
        return entry;
    }

    /*
     * An unknown type is registered on first sight rather than refused.
     *
     * Refusing it means an event from a system this build has never heard of
     * is silently dropped, and the gap it leaves is invisible - which is the
     * exact failure the engine exists to stop. It enters as CUSTOM, and the
     * interface shows it as a type nothing here knows about.
     */
    function eventType(type) {
        if (!type) { return null; }
        return types[type] || registerEventType(type, { category: CATEGORY.CUSTOM });
    }

    function knownEventTypes() {
        return Object.keys(types).map(function (key) { return types[key]; });
    }

    function humanize(type) {
        return String(type).toLowerCase().replace(/_/g, ' ')
            .replace(/^(.)/, function (c) { return c.toUpperCase(); });
    }

    /* The vocabulary this build ships with. */
    var SEED = [
        /* UI - only ever browser-observed. */
        ['PAGE_OPEN',        CATEGORY.UI, 'Page opened',        COMPONENT_KIND.UI],
        ['URL_NAVIGATION',   CATEGORY.UI, 'Navigated',          COMPONENT_KIND.UI],
        ['RECORD_VIEW',      CATEGORY.UI, 'Record viewed',      COMPONENT_KIND.UI],
        ['BUTTON_CLICK',     CATEGORY.UI, 'Button clicked',     COMPONENT_KIND.UI],
        ['COMPONENT_OPEN',   CATEGORY.UI, 'Component opened',   COMPONENT_KIND.UI],
        ['TAB_CHANGE',       CATEGORY.UI, 'Tab changed',        COMPONENT_KIND.UI],
        ['FORM_SUBMIT',      CATEGORY.UI, 'Form submitted',     COMPONENT_KIND.UI],

        /* Salesforce execution. */
        ['RECORD_CREATE',    CATEGORY.SALESFORCE, 'Record created'],
        ['RECORD_UPDATE',    CATEGORY.SALESFORCE, 'Record updated'],
        ['RECORD_DELETE',    CATEGORY.SALESFORCE, 'Record deleted'],
        ['FLOW_START',       CATEGORY.SALESFORCE, 'Flow started',  COMPONENT_KIND.FLOW, 'start', 'FLOW_END'],
        ['FLOW_END',         CATEGORY.SALESFORCE, 'Flow finished', COMPONENT_KIND.FLOW, 'end'],
        ['APEX_START',       CATEGORY.SALESFORCE, 'Apex started',  COMPONENT_KIND.APEX, 'start', 'APEX_END'],
        ['APEX_END',         CATEGORY.SALESFORCE, 'Apex finished', COMPONENT_KIND.APEX, 'end'],
        ['OMNISCRIPT_START', CATEGORY.SALESFORCE, 'OmniScript started', COMPONENT_KIND.OMNISCRIPT, 'start', 'OMNISCRIPT_END'],
        ['OMNISCRIPT_END',   CATEGORY.SALESFORCE, 'OmniScript finished', COMPONENT_KIND.OMNISCRIPT, 'end'],
        ['INTEGRATION_PROCEDURE_START', CATEGORY.SALESFORCE, 'Integration Procedure started',
            COMPONENT_KIND.INTEGRATION_PROCEDURE, 'start', 'INTEGRATION_PROCEDURE_END'],
        ['INTEGRATION_PROCEDURE_END',   CATEGORY.SALESFORCE, 'Integration Procedure finished',
            COMPONENT_KIND.INTEGRATION_PROCEDURE, 'end'],
        ['DATA_MAPPER_EXECUTION', CATEGORY.SALESFORCE, 'Data Mapper ran', COMPONENT_KIND.DATA_MAPPER],

        /* Integration. */
        ['HTTP_REQUEST',   CATEGORY.INTEGRATION, 'HTTP request',  COMPONENT_KIND.REST_API, 'start', 'HTTP_RESPONSE'],
        ['HTTP_RESPONSE',  CATEGORY.INTEGRATION, 'HTTP response', COMPONENT_KIND.REST_API, 'end'],
        ['PLATFORM_EVENT', CATEGORY.INTEGRATION, 'Platform event', COMPONENT_KIND.PLATFORM_EVENT],

        /* Business outcomes - what the journey was for. */
        ['ORDER_CREATED',      CATEGORY.BUSINESS, 'Order created',      null, null, null, true],
        ['PAYMENT_COMPLETED',  CATEGORY.BUSINESS, 'Payment completed',  null, null, null, true],
        ['DOCUMENT_GENERATED', CATEGORY.BUSINESS, 'Document generated', null, null, null, true],
        ['EMAIL_SENT',         CATEGORY.BUSINESS, 'Email sent',         null, null, null, true],

        /* AI and agents. */
        ['AGENT_REQUEST',     CATEGORY.AGENT, 'Agent request',   COMPONENT_KIND.AGENT],
        ['MCP_TOOL_CALL',     CATEGORY.AGENT, 'MCP tool call',   COMPONENT_KIND.MCP_TOOL, 'start', 'MCP_TOOL_RESPONSE'],
        ['MCP_TOOL_RESPONSE', CATEGORY.AGENT, 'MCP tool result', COMPONENT_KIND.MCP_TOOL, 'end'],
        ['AGENT_ACTION',      CATEGORY.AGENT, 'Agent action',    COMPONENT_KIND.AGENT]
    ];

    SEED.forEach(function (row) {
        registerEventType(row[0], {
            category: row[1], label: row[2], componentKind: row[3],
            phase: row[4], closedBy: row[5], outcome: row[6]
        });
    });

    /* ------------------------------------------------------------------ */
    /* Privacy                                                             */
    /* ------------------------------------------------------------------ */

    /*
     * Redaction happens on the way in, not on the way out.
     *
     * A payload that has been in the store unredacted has already been written
     * to disk, and every later consumer - the inspector, an export, anything
     * sent to an AI service - is then one bug away from leaking it. So the
     * store never holds the raw value: normalizeEvent redacts, and what is
     * kept is the shape plus whatever the policy allows.
     */
    var CLASSIFICATION = {
        PUBLIC:   'public',
        INTERNAL: 'internal',
        PII:      'pii',
        SECRET:   'secret'
    };

    /* Key names that are secret whatever they contain. */
    var SECRET_KEY = /(pass(word|wd)?|secret|token|bearer|authorization|auth|api[-_]?key|client[-_]?secret|sessionid|sid|credential|private[-_]?key|signature)/i;

    /* Key names that are personal whatever they contain. */
    var PII_KEY = /(email|phone|mobile|ssn|social.?security|dob|birth|passport|licen[cs]e|address|street|postal|zip|salary|iban|account.?number|card|cvv|tax.?id)/i;

    /* Values that are personal whatever they are called. */
    var EMAIL_VALUE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
    var LONG_DIGITS = /\b\d{9,19}\b/;

    function classifyField(key, value) {
        var name = String(key || '');
        if (SECRET_KEY.test(name)) { return CLASSIFICATION.SECRET; }
        if (PII_KEY.test(name)) { return CLASSIFICATION.PII; }
        if (typeof value === 'string') {
            if (EMAIL_VALUE.test(value)) { return CLASSIFICATION.PII; }
            if (LONG_DIGITS.test(value)) { return CLASSIFICATION.PII; }
        }
        return CLASSIFICATION.INTERNAL;
    }

    function defaultPrivacyPolicy() {
        return {
            /*
             * blocklist keeps what is not forbidden; allowlist keeps only what
             * is named. allowlist is the safer default for anything leaving the
             * browser, and is what the AI seam uses - see ssEgAiSafePolicy.
             */
            mode: 'blocklist',
            allow: [],
            block: [],
            maskPii: true,
            /* Strings longer than this are cut: a base64 document in an event
             * payload is neither readable nor worth storing. */
            maxStringLength: 512,
            maxDepth: 6,
            maxKeys: 60
        };
    }

    /*
     * The policy for anything handed to an AI service.
     *
     * Nothing is sent unless it was named. The spec's rule - do not send
     * complete Salesforce record payloads to AI services by default - is not
     * a warning in a comment here, it is the default mode.
     */
    function aiSafePolicy(allow) {
        var policy = defaultPrivacyPolicy();
        policy.mode = 'allowlist';
        policy.allow = allow || [];
        policy.maxStringLength = 200;
        return policy;
    }

    function maskValue(value, classification) {
        if (classification === CLASSIFICATION.SECRET) { return '[redacted]'; }
        if (typeof value !== 'string') { return '[redacted]'; }
        // Keep enough to recognise a value you already know, never enough to
        // learn one you do not: the local part of an email, the last four of
        // a number.
        var at = value.indexOf('@');
        if (at > 0) { return value.slice(0, 1) + '***@' + value.slice(at + 1); }
        if (value.length > 4) { return '***' + value.slice(-4); }
        return '***';
    }

    /*
     * Redact a payload, and say what was taken.
     *
     * The redactions list is the point: an inspector that shows "{ redacted }"
     * with no indication of what was there is indistinguishable from one
     * showing an empty payload, and the difference matters when the question
     * is why a call failed.
     */
    function redact(payload, policy, state, path) {
        policy = policy || defaultPrivacyPolicy();
        state = state || { redactions: [], keys: 0 };
        path = path || '';

        var depth = path ? path.split('.').length : 0;
        if (depth > policy.maxDepth) { return '[depth limit]'; }

        if (payload === null || payload === undefined) { return payload; }

        if (Array.isArray(payload)) {
            // A long array is summarised rather than kept: fifty rows of the
            // same shape answer no question the first three do not.
            var head = payload.slice(0, 3).map(function (item, index) {
                return redact(item, policy, state, path + '[' + index + ']');
            });
            if (payload.length > 3) {
                head.push('… ' + (payload.length - 3) + ' more');
            }
            return head;
        }

        if (typeof payload === 'object') {
            var out = {};
            Object.keys(payload).forEach(function (key) {
                if (state.keys >= policy.maxKeys) { return; }
                var here = path ? path + '.' + key : key;
                var classification = classifyField(key, payload[key]);

                var kept = policy.mode === 'allowlist'
                    ? policy.allow.indexOf(here) !== -1 || policy.allow.indexOf(key) !== -1
                    : policy.block.indexOf(here) === -1 && policy.block.indexOf(key) === -1;

                if (!kept) {
                    state.redactions.push({ path: here, classification: classification, reason: 'policy' });
                    out[key] = '[redacted]';
                    state.keys++;
                    return;
                }

                if (classification === CLASSIFICATION.SECRET ||
                    (policy.maskPii && classification === CLASSIFICATION.PII)) {
                    state.redactions.push({ path: here, classification: classification, reason: 'classification' });
                    out[key] = maskValue(payload[key], classification);
                    state.keys++;
                    return;
                }

                state.keys++;
                out[key] = redact(payload[key], policy, state, here);
            });
            return out;
        }

        if (typeof payload === 'string' && payload.length > policy.maxStringLength) {
            return payload.slice(0, policy.maxStringLength) + '… (' + payload.length + ' chars)';
        }

        return payload;
    }

    function redactPayload(payload, policy) {
        if (payload === null || payload === undefined) {
            return { value: null, redactions: [] };
        }
        var state = { redactions: [], keys: 0 };
        var value = redact(payload, policy, state, '');
        return { value: value, redactions: state.redactions };
    }

    /* ------------------------------------------------------------------ */
    /* Identity                                                            */
    /* ------------------------------------------------------------------ */

    var counter = 0;

    function newId(prefix) {
        counter += 1;
        return (prefix || 'evt') + '-' +
               Date.now().toString(36) + '-' +
               counter.toString(36) + '-' +
               Math.random().toString(36).slice(2, 7);
    }

    /*
     * A stable id for an event that has no id of its own.
     *
     * Collectors re-read the same sources on every refresh - SetupAuditTrail
     * has no event id, and the same row read twice must not become two events.
     * So the id is derived from the content that identifies it, and a re-read
     * produces the same id and collapses onto the event already there.
     */
    function derivedId(parts) {
        var text = (parts || []).map(function (p) {
            return p === null || p === undefined ? '' : String(p);
        }).join('|');
        var hash = 5381;
        for (var i = 0; i < text.length; i++) {
            hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
        }
        return 'evt-d' + (hash >>> 0).toString(36) + '-' + (text.length % 997).toString(36);
    }

    /* ------------------------------------------------------------------ */
    /* Normalisation                                                       */
    /* ------------------------------------------------------------------ */

    function toMillis(value) {
        if (value === null || value === undefined || value === '') { return null; }
        if (typeof value === 'number' && isFinite(value)) { return value; }
        var parsed = Date.parse(value);
        return isNaN(parsed) ? null : parsed;
    }

    function normalizeActor(raw) {
        if (!raw) { return { kind: ACTOR_KIND.SYSTEM, id: null, name: 'System' }; }
        if (typeof raw === 'string') {
            return { kind: ACTOR_KIND.USER, id: raw, name: raw };
        }
        return {
            kind: raw.kind || ACTOR_KIND.SYSTEM,
            id: raw.id || null,
            name: raw.name || raw.id || 'Unknown',
            /* An agent acting for a person: both are kept, because "who did
             * this" and "on whose behalf" are different questions and the
             * second one is the one an approval trail needs. */
            onBehalfOf: raw.onBehalfOf || null
        };
    }

    function normalizeEntity(raw) {
        if (!raw) { return null; }
        if (typeof raw === 'string') { return { type: null, id: raw, name: raw, external: false }; }
        return {
            type: raw.type || null,
            id: raw.id || null,
            name: raw.name || raw.id || null,
            external: !!raw.external,
            system: raw.system || null
        };
    }

    function normalizeComponent(raw) {
        if (!raw) { return null; }
        if (typeof raw === 'string') { return { kind: null, name: raw, id: null }; }
        return {
            kind: raw.kind || null,
            name: raw.name || null,
            id: raw.id || null,
            namespace: raw.namespace || null
        };
    }

    function normalizeError(raw) {
        if (!raw) { return null; }
        if (typeof raw === 'string') { return { code: null, message: raw }; }
        return {
            code: raw.code || raw.statusCode || null,
            message: raw.message || String(raw),
            detail: raw.detail || null
        };
    }

    /*
     * A raw record from any collector becomes an event here, or is rejected.
     *
     * Rejected rather than repaired: an event with no timestamp cannot be
     * placed on a timeline, and one invented for it would put a made-up
     * moment on a graph whose whole claim is that it shows what happened.
     */
    function normalizeEvent(raw, options) {
        options = options || {};
        if (!raw || !raw.eventType) {
            return { error: 'An event needs an eventType.' };
        }

        var timestamp = toMillis(raw.timestamp);
        if (timestamp === null) {
            return { error: 'An event needs a timestamp that can be parsed: ' + raw.eventType };
        }

        var type = eventType(raw.eventType);
        var policy = options.privacyPolicy || defaultPrivacyPolicy();

        var input = redactPayload(raw.input, policy);
        var output = redactPayload(raw.output, policy);

        var sourceKind = (raw.source && raw.source.kind) || raw.source || PROVENANCE.INFERRED;
        var state = raw.state || (sourceKind === PROVENANCE.INFERRED ||
                                  sourceKind === PROVENANCE.METADATA ? 'inferred' : 'observed');

        /*
         * An event's own confidence, which is not the same as a relationship's.
         * Something observed is confirmed to have happened; something inferred
         * is not, however good the reasoning.
         */
        var confidence = raw.confidence ||
            (state === 'observed' ? CONFIDENCE.CONFIRMED : CONFIDENCE.INFERRED);

        var redactions = input.redactions.concat(output.redactions);
        var classification = redactions.reduce(function (worst, entry) {
            if (entry.classification === CLASSIFICATION.SECRET) { return CLASSIFICATION.SECRET; }
            if (entry.classification === CLASSIFICATION.PII && worst !== CLASSIFICATION.SECRET) {
                return CLASSIFICATION.PII;
            }
            return worst;
        }, CLASSIFICATION.INTERNAL);

        return {
            event: {
                eventId: raw.eventId || derivedId([
                    raw.eventType, timestamp, raw.traceId,
                    raw.entity && (raw.entity.id || raw.entity),
                    raw.component && (raw.component.name || raw.component),
                    raw.action
                ]),
                traceId: raw.traceId || null,
                parentEventId: raw.parentEventId || null,

                timestamp: timestamp,
                timestampIso: new Date(timestamp).toISOString(),
                duration: typeof raw.duration === 'number' && isFinite(raw.duration)
                    ? raw.duration : null,

                actor: normalizeActor(raw.actor),
                session: raw.session
                    ? (typeof raw.session === 'string' ? { id: raw.session } : raw.session)
                    : null,

                source: {
                    kind: sourceKind,
                    system: (raw.source && raw.source.system) || null,
                    detail: (raw.source && raw.source.detail) || null
                },

                eventType: raw.eventType,
                category: type.category,
                typeLabel: type.label,
                phase: type.phase,
                outcome: !!type.outcome,
                action: raw.action || type.label,

                entity: normalizeEntity(raw.entity),
                component: normalizeComponent(raw.component) ||
                    (type.componentKind ? { kind: type.componentKind, name: null, id: null } : null),

                input: input.value,
                output: output.value,

                status: raw.status || STATUS.UNKNOWN,
                error: normalizeError(raw.error),

                metadata: raw.metadata || {},

                confidence: confidence,
                state: state,

                privacy: {
                    classification: classification,
                    redactions: redactions
                }
            }
        };
    }

    /* Many at once, keeping the rejections so a collector can report them
     * rather than quietly contributing nothing. */
    function normalizeAll(rawEvents, options) {
        var accepted = [];
        var rejected = [];
        (rawEvents || []).forEach(function (raw) {
            var result = normalizeEvent(raw, options);
            if (result.error) { rejected.push({ raw: raw, error: result.error }); }
            else { accepted.push(result.event); }
        });
        return { events: accepted, rejected: rejected };
    }

    var api = {
        PROVENANCE: PROVENANCE,
        PROVENANCE_RANK: PROVENANCE_RANK,
        PROVENANCE_LABEL: PROVENANCE_LABEL,
        CONFIDENCE: CONFIDENCE,
        CONFIDENCE_RANK: CONFIDENCE_RANK,
        CONFIDENCE_LABEL: CONFIDENCE_LABEL,
        ACTOR_KIND: ACTOR_KIND,
        COMPONENT_KIND: COMPONENT_KIND,
        CATEGORY: CATEGORY,
        STATUS: STATUS,
        CLASSIFICATION: CLASSIFICATION,

        registerEventType: registerEventType,
        eventType: eventType,
        knownEventTypes: knownEventTypes,

        classifyField: classifyField,
        defaultPrivacyPolicy: defaultPrivacyPolicy,
        aiSafePolicy: aiSafePolicy,
        redactPayload: redactPayload,

        newId: newId,
        derivedId: derivedId,
        toMillis: toMillis,

        normalizeEvent: normalizeEvent,
        normalizeAll: normalizeAll,
        confidenceAtLeast: confidenceAtLeast,
        weakestConfidence: weakestConfidence
    };

    root.SSEventModel = api;
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof self !== 'undefined' ? self : this);
