/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Where events live, and what they cost.
 *
 * The store is in memory with an optional persisted mirror. It is deliberately
 * not a database: a trace is a few thousand events at most, and the queries
 * that matter - by trace, by actor, by entity, by time window - are all served
 * by four indexes maintained on write.
 *
 * Two behaviours here are load-bearing rather than housekeeping:
 *
 *   dedup   - the same real event arrives from more than one collector. A
 *             record update is seen by the browser as a save and by Salesforce
 *             as a LastModifiedDate, and those are one event. They merge, and
 *             the nearer source wins the fields they disagree about.
 *
 *   capping - a trace that grows without bound is a browser tab that stops
 *             responding. The cap drops the least interesting events first
 *             rather than the oldest, because the oldest are usually the click
 *             the whole trace hangs off.
 */
(function (root) {
    'use strict';

    var Model = root.SSEventModel ||
        (typeof require !== 'undefined' ? require('./ss-event-model.js') : null);

    /* A trace bigger than this is not readable and not worth holding. */
    var DEFAULT_CAPACITY = 5000;

    /*
     * Retention is off by default, and that is a correction rather than a
     * preference.
     *
     * It was seven days, culling by the event's own timestamp. That is right
     * for a buffer of live telemetry and catastrophically wrong for anything
     * historical: a record graph reaches an Account created last year and a
     * Case opened last month, and every one of those events was older than the
     * window the moment it arrived. The store accepted them, reported them as
     * added, and then dropped them inside the same call - so the graph came
     * back with the handful of events from the last week and no indication
     * that the rest had ever existed.
     *
     * Culling by age only makes sense when age correlates with irrelevance,
     * and for deliberately fetched history it is the opposite: the old events
     * are the ones that were asked for. Capacity still bounds memory, and it
     * sheds by interest rather than by date - see enforceLimits.
     */
    var DEFAULT_RETENTION_MS = 0;

    function EventStore(options) {
        options = options || {};
        this.capacity = options.capacity || DEFAULT_CAPACITY;
        this.retentionMs = options.retentionMs || DEFAULT_RETENTION_MS;
        /*
         * Sampling is applied at write, per event type. It exists so a noisy
         * source - a component that emits a render event per keystroke -
         * cannot flood a trace. Never applied to failures or outcomes: the
         * one event somebody opened this to find is the one sampling would
         * throw away.
         */
        this.sampling = options.sampling || {};
        this.clear();
    }

    EventStore.prototype.clear = function () {
        this.events = [];
        this.byId = Object.create(null);
        this.byTrace = Object.create(null);
        this.byActor = Object.create(null);
        this.byEntity = Object.create(null);
        this.byComponent = Object.create(null);
        this.bySession = Object.create(null);
        this.dropped = { sampled: 0, capacity: 0, retention: 0, rejected: 0 };
        return this;
    };

    function push(index, key, event) {
        if (!key) { return; }
        if (!index[key]) { index[key] = []; }
        index[key].push(event);
    }

    function entityKey(entity) {
        if (!entity) { return null; }
        return (entity.type || '?') + ':' + (entity.id || entity.name || '?');
    }

    function componentKey(component) {
        if (!component) { return null; }
        return (component.kind || '?') + ':' + (component.name || component.id || '?');
    }

    /*
     * How much an event actually says. Used only to break a provenance tie -
     * an empty object or string counts for nothing, so a record padded with
     * blanks does not outrank one carrying real detail.
     */
    function populated(event) {
        var count = 0;
        Object.keys(event).forEach(function (key) {
            var value = event[key];
            if (value === null || value === undefined || value === '') { return; }
            if (typeof value === 'object' && !Object.keys(value).length) { return; }
            count++;
        });
        return count;
    }

    EventStore.prototype.index = function (event) {
        this.byId[event.eventId] = event;
        push(this.byTrace, event.traceId, event);
        push(this.byActor, event.actor && event.actor.id, event);
        push(this.byEntity, entityKey(event.entity), event);
        push(this.byComponent, componentKey(event.component), event);
        push(this.bySession, event.session && event.session.id, event);
    };

    /*
     * Rebuilt wholesale after a removal.
     *
     * Splicing one event out of six indexes is six searches and an easy place
     * to leave a dangling reference; a rebuild is O(n) over a list that is
     * capped at a few thousand and runs only when something was actually
     * dropped. Correctness over cleverness, on the path that runs least.
     */
    EventStore.prototype.reindex = function () {
        this.byId = Object.create(null);
        this.byTrace = Object.create(null);
        this.byActor = Object.create(null);
        this.byEntity = Object.create(null);
        this.byComponent = Object.create(null);
        this.bySession = Object.create(null);
        var self = this;
        this.events.forEach(function (event) { self.index(event); });
    };

    /*
     * Whether this event survives sampling.
     *
     * Anything that failed, anything that is a business outcome, and anything
     * carrying an error is kept whatever the rate says. Sampling is for volume,
     * and none of those are volume.
     */
    EventStore.prototype.sampleAllows = function (event) {
        var rate = this.sampling[event.eventType];
        if (rate === undefined || rate >= 1) { return true; }
        if (event.status === Model.STATUS.FAILURE || event.error || event.outcome) { return true; }
        if (rate <= 0) { return false; }
        return Math.random() < rate;
    };

    /*
     * Two records of the same event become one.
     *
     * The nearer source wins a disagreement - a browser-observed timestamp is
     * the moment somebody saw it happen, while a Salesforce LastModifiedDate is
     * rounded and late - but only for fields it actually has. Everything the
     * weaker source knows and the stronger one does not is kept, which is the
     * whole reason to merge rather than discard: Salesforce knows the record
     * id, the browser knows the click.
     */
    EventStore.prototype.merge = function (existing, incoming) {
        var existingRank = Model.PROVENANCE_RANK[existing.source.kind] || 9;
        var incomingRank = Model.PROVENANCE_RANK[incoming.source.kind] || 9;

        /*
         * A tie is the normal case, not an edge case: the browser and the org
         * are both first-hand witnesses and share a rank. Left to arrival
         * order, which collector happened to run first would decide what the
         * event looks like - so the same two observations could merge two
         * different ways between one refresh and the next.
         *
         * Broken on substance instead: the record that knows more wins. That
         * is deterministic, independent of collector order, and picks the
         * version whose provenance label actually matches the data kept.
         */
        var winner;
        if (incomingRank !== existingRank) {
            winner = incomingRank < existingRank ? incoming : existing;
        } else {
            winner = populated(incoming) > populated(existing) ? incoming : existing;
        }
        var loser = winner === incoming ? existing : incoming;

        var merged = {};
        Object.keys(loser).forEach(function (key) { merged[key] = loser[key]; });
        Object.keys(winner).forEach(function (key) {
            var value = winner[key];
            if (value !== null && value !== undefined && value !== '') { merged[key] = value; }
        });

        merged.eventId = existing.eventId;
        merged.confidence = winner.confidence;
        merged.state = winner.state;
        /*
         * Both provenances are kept. "Seen in the browser and confirmed by the
         * org" is a stronger statement than either alone, and the inspector
         * shows it as such.
         */
        merged.source = winner.source;
        merged.corroboratedBy = (existing.corroboratedBy || [])
            .concat([loser.source.kind])
            .filter(function (kind, i, all) {
                return kind !== winner.source.kind && all.indexOf(kind) === i;
            });
        return merged;
    };

    EventStore.prototype.add = function (event) {
        if (!event || !event.eventId) { this.dropped.rejected++; return null; }

        var existing = this.byId[event.eventId];
        if (existing) {
            var merged = this.merge(existing, event);
            var at = this.events.indexOf(existing);
            if (at !== -1) { this.events[at] = merged; }
            this.byId[merged.eventId] = merged;
            this.reindex();
            return merged;
        }

        if (!this.sampleAllows(event)) { this.dropped.sampled++; return null; }

        this.events.push(event);
        this.index(event);
        return event;
    };

    EventStore.prototype.addAll = function (events) {
        var self = this;
        var added = [];
        (events || []).forEach(function (event) {
            var stored = self.add(event);
            if (stored) { added.push(stored); }
        });
        this.enforceLimits();
        return added;
    };

    /* Raw collector output straight into the store, normalisation included. */
    EventStore.prototype.ingest = function (rawEvents, options) {
        var result = Model.normalizeAll(rawEvents, options);
        this.dropped.rejected += result.rejected.length;
        return { added: this.addAll(result.events), rejected: result.rejected };
    };

    /*
     * What gets dropped when there is too much.
     *
     * Not the oldest. The oldest event in a trace is usually the click that
     * started it, and a journey missing its first step is a journey nobody can
     * read. So the score keeps what carries meaning - failures, outcomes,
     * observed events, anything with an error - and sheds the repetitive middle.
     */
    EventStore.prototype.interest = function (event) {
        var score = 0;
        if (event.status === Model.STATUS.FAILURE || event.error) { score += 100; }
        if (event.outcome) { score += 60; }
        if (event.state === 'observed') { score += 20; }
        if (event.category === Model.CATEGORY.UI) { score += 10; }
        if (event.category === Model.CATEGORY.AGENT) { score += 15; }
        if (event.duration && event.duration > 1000) { score += 25; }
        return score;
    };

    EventStore.prototype.enforceLimits = function () {
        var self = this;
        var changed = false;

        if (this.retentionMs > 0) {
            var floor = Date.now() - this.retentionMs;
            var kept = this.events.filter(function (event) { return event.timestamp >= floor; });
            if (kept.length !== this.events.length) {
                this.dropped.retention += this.events.length - kept.length;
                this.events = kept;
                changed = true;
            }
        }

        if (this.events.length > this.capacity) {
            var ranked = this.events.slice().sort(function (a, b) {
                var diff = self.interest(b) - self.interest(a);
                return diff !== 0 ? diff : b.timestamp - a.timestamp;
            });
            var survivors = ranked.slice(0, this.capacity);
            this.dropped.capacity += this.events.length - survivors.length;
            survivors.sort(function (a, b) { return a.timestamp - b.timestamp; });
            this.events = survivors;
            changed = true;
        }

        if (changed) { this.reindex(); }
        return this;
    };

    /* ------------------------------------------------------------------ */
    /* Reading                                                             */
    /* ------------------------------------------------------------------ */

    EventStore.prototype.get = function (eventId) {
        return this.byId[eventId] || null;
    };

    EventStore.prototype.all = function () {
        return this.events.slice().sort(function (a, b) { return a.timestamp - b.timestamp; });
    };

    EventStore.prototype.trace = function (traceId) {
        return (this.byTrace[traceId] || []).slice()
            .sort(function (a, b) { return a.timestamp - b.timestamp; });
    };

    EventStore.prototype.forActor = function (actorId) {
        return (this.byActor[actorId] || []).slice()
            .sort(function (a, b) { return a.timestamp - b.timestamp; });
    };

    EventStore.prototype.forEntity = function (type, id) {
        var key = (type || '?') + ':' + (id || '?');
        return (this.byEntity[key] || []).slice()
            .sort(function (a, b) { return a.timestamp - b.timestamp; });
    };

    /* Any event touching this record id, whatever the object was called. */
    EventStore.prototype.forRecordId = function (recordId) {
        if (!recordId) { return []; }
        return this.events.filter(function (event) {
            return event.entity && event.entity.id === recordId;
        }).sort(function (a, b) { return a.timestamp - b.timestamp; });
    };

    EventStore.prototype.forComponent = function (kind, name) {
        var key = (kind || '?') + ':' + (name || '?');
        return (this.byComponent[key] || []).slice()
            .sort(function (a, b) { return a.timestamp - b.timestamp; });
    };

    EventStore.prototype.forSession = function (sessionId) {
        return (this.bySession[sessionId] || []).slice()
            .sort(function (a, b) { return a.timestamp - b.timestamp; });
    };

    /* Events inside a window, used by proximity correlation and by the
     * timeline's viewport. */
    EventStore.prototype.between = function (from, to) {
        return this.events.filter(function (event) {
            return event.timestamp >= from && event.timestamp <= to;
        }).sort(function (a, b) { return a.timestamp - b.timestamp; });
    };

    EventStore.prototype.query = function (filter) {
        filter = filter || {};
        return this.all().filter(function (event) {
            if (filter.category && event.category !== filter.category) { return false; }
            if (filter.eventType && event.eventType !== filter.eventType) { return false; }
            if (filter.status && event.status !== filter.status) { return false; }
            if (filter.actorId && (!event.actor || event.actor.id !== filter.actorId)) { return false; }
            if (filter.traceId && event.traceId !== filter.traceId) { return false; }
            if (filter.sourceKind && event.source.kind !== filter.sourceKind) { return false; }
            if (filter.failuresOnly && event.status !== Model.STATUS.FAILURE && !event.error) { return false; }
            if (filter.slowerThan && !(event.duration >= filter.slowerThan)) { return false; }
            if (filter.text) {
                var hay = [
                    event.action, event.eventType, event.typeLabel,
                    event.entity && event.entity.name, event.entity && event.entity.id,
                    event.component && event.component.name,
                    event.actor && event.actor.name,
                    event.error && event.error.message
                ].join(' ').toLowerCase();
                if (hay.indexOf(String(filter.text).toLowerCase()) === -1) { return false; }
            }
            return true;
        });
    };

    /* What the store holds, for the panel's header and for deciding whether a
     * trace is worth drawing at all. */
    EventStore.prototype.stats = function () {
        var byCategory = {};
        var bySource = {};
        var failures = 0;
        var earliest = null;
        var latest = null;

        this.events.forEach(function (event) {
            byCategory[event.category] = (byCategory[event.category] || 0) + 1;
            bySource[event.source.kind] = (bySource[event.source.kind] || 0) + 1;
            if (event.status === Model.STATUS.FAILURE || event.error) { failures++; }
            if (earliest === null || event.timestamp < earliest) { earliest = event.timestamp; }
            if (latest === null || event.timestamp > latest) { latest = event.timestamp; }
        });

        return {
            total: this.events.length,
            traces: Object.keys(this.byTrace).length,
            actors: Object.keys(this.byActor).length,
            failures: failures,
            byCategory: byCategory,
            bySource: bySource,
            earliest: earliest,
            latest: latest,
            span: earliest !== null && latest !== null ? latest - earliest : 0,
            dropped: this.dropped
        };
    };

    /* ------------------------------------------------------------------ */
    /* Persistence                                                         */
    /* ------------------------------------------------------------------ */

    /*
     * Serialised without the indexes, which are derivable, and restored
     * through add() so a stored event that no longer passes the current
     * policy does not come back.
     */
    EventStore.prototype.toJSON = function () {
        return {
            version: 1,
            savedAt: Date.now(),
            capacity: this.capacity,
            retentionMs: this.retentionMs,
            events: this.events
        };
    };

    EventStore.fromJSON = function (data, options) {
        var store = new EventStore(options || {
            capacity: data && data.capacity,
            retentionMs: data && data.retentionMs
        });
        if (data && data.events) { store.addAll(data.events); }
        return store;
    };

    var api = {
        EventStore: EventStore,
        DEFAULT_CAPACITY: DEFAULT_CAPACITY,
        DEFAULT_RETENTION_MS: DEFAULT_RETENTION_MS,
        entityKey: entityKey,
        componentKey: componentKey
    };

    root.SSEventStore = api;
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof self !== 'undefined' ? self : this);
