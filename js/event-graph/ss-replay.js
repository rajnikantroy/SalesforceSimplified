/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Replay.
 *
 * This replays a recording. It does not re-execute anything: no callout is
 * made, no record is touched, no flow is started. The distinction is worth
 * stating in the code as well as the interface, because "replay" in a
 * Salesforce context can reasonably be read as "run it again", and running a
 * payment again because somebody wanted to see why it failed the first time is
 * about the worst outcome this feature could have.
 *
 * The script is computed once from timestamps and is pure data: a list of
 * moments and what becomes true at each. The clock walks it. That split is
 * what makes scrubbing to 40% as cheap as playing to it, and it is why the
 * state at any instant is derived rather than accumulated - a scrub backwards
 * cannot leave a node stuck in a state it should have left.
 *
 * Two things the animation must convey that a naive timestamp walk does not:
 *
 *   dead time    - a trace with a four minute wait between two calls is mostly
 *                  a still picture. Long gaps are compressed, and the timeline
 *                  marks where, so the compression is visible rather than a
 *                  silent lie about how long things took.
 *
 *   parallelism  - two calls in flight at once must be seen to be in flight at
 *                  once. Because state is derived from the interval each event
 *                  occupies rather than from a cursor, overlap comes out for
 *                  free.
 */
(function (root) {
    'use strict';

    var Model = root.SSEventModel ||
        (typeof require !== 'undefined' ? require('./ss-event-model.js') : null);

    var NODE_STATE = {
        PENDING: 'pending',
        ACTIVE:  'active',
        DONE:    'done',
        FAILED:  'failed'
    };

    var EDGE_STATE = {
        PENDING: 'pending',
        FIRING:  'firing',
        DONE:    'done'
    };

    /* An instant event still needs to be visible for long enough to see. */
    var MIN_VISIBLE_MS = 240;
    /* A gap longer than this is compressed to GAP_KEPT_MS of replay time. */
    var GAP_THRESHOLD_MS = 4000;
    var GAP_KEPT_MS = 600;
    /* How long an edge animates once its source completes. */
    var EDGE_FIRE_MS = 320;

    /* ------------------------------------------------------------------ */
    /* The script                                                          */
    /* ------------------------------------------------------------------ */

    /*
     * Real timestamps become replay time.
     *
     * Every node gets an interval on a compressed axis. The compression is
     * recorded as a list of skips so the timeline can draw them, and so a
     * duration shown next to a node is always the real one - only the axis is
     * compressed, never the numbers.
     */
    function buildScript(subgraph, options) {
        options = options || {};
        var nodes = (subgraph.nodes || []).slice()
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        if (!nodes.length) {
            return {
                nodes: [], edges: [], skips: [], duration: 0,
                startedAt: null, endedAt: null, empty: true
            };
        }

        var compress = options.compressGaps !== false;
        var startedAt = nodes[0].timestamp;
        var endedAt = nodes.reduce(function (latest, node) {
            var ends = node.timestamp + (node.duration || 0);
            return ends > latest ? ends : latest;
        }, startedAt);

        /*
         * Where the quiet stretches are.
         *
         * A gap counts only when nothing at all is in flight - an event with a
         * long duration is not dead time, it is the thing being waited on, and
         * compressing it would hide the latency the graph exists to show.
         */
        var skips = [];
        if (compress) {
            var frontier = startedAt;
            nodes.forEach(function (node) {
                if (node.timestamp > frontier + GAP_THRESHOLD_MS) {
                    skips.push({
                        from: frontier,
                        to: node.timestamp,
                        realMs: node.timestamp - frontier,
                        keptMs: GAP_KEPT_MS
                    });
                }
                var ends = node.timestamp + (node.duration || 0);
                if (ends > frontier) { frontier = ends; }
            });
        }

        /* Real instant → replay instant, with the skips taken out. */
        function toReplay(realTime) {
            var replay = realTime - startedAt;
            skips.forEach(function (skip) {
                if (realTime > skip.to) {
                    replay -= (skip.realMs - skip.keptMs);
                } else if (realTime > skip.from) {
                    replay -= (realTime - skip.from) *
                              (1 - skip.keptMs / Math.max(1, skip.realMs));
                }
            });
            return Math.max(0, replay);
        }

        var scripted = nodes.map(function (node) {
            var realEnd = node.timestamp + (node.duration || 0);
            var from = toReplay(node.timestamp);
            var to = toReplay(realEnd);
            if (to - from < MIN_VISIBLE_MS) { to = from + MIN_VISIBLE_MS; }

            var failed = node.status === Model.STATUS.FAILURE || !!node.error;

            return {
                eventId: node.eventId,
                node: node,
                from: from,
                to: to,
                realFrom: node.timestamp,
                realTo: realEnd,
                realDuration: node.duration || 0,
                failed: failed,
                isGroup: !!node.isGroup
            };
        });

        var byId = Object.create(null);
        scripted.forEach(function (item) { byId[item.eventId] = item; });

        /*
         * An edge fires when its source finishes, not when its target starts.
         * The two differ whenever a target was already running - a parallel
         * branch - and firing on the source is the one that reads as causality.
         */
        var edges = (subgraph.edges || []).map(function (rel) {
            var source = byId[rel.sourceEventId];
            var target = byId[rel.targetEventId];
            if (!source || !target) { return null; }
            var at = Math.min(source.to, target.from);
            return {
                relationshipId: rel.relationshipId,
                edge: rel,
                from: at,
                to: at + EDGE_FIRE_MS,
                confidence: rel.confidence
            };
        }).filter(Boolean);

        var duration = scripted.reduce(function (max, item) {
            return item.to > max ? item.to : max;
        }, 0);

        return {
            nodes: scripted,
            byId: byId,
            edges: edges,
            skips: skips,
            duration: Math.max(duration, MIN_VISIBLE_MS),
            startedAt: startedAt,
            endedAt: endedAt,
            realDuration: endedAt - startedAt,
            compressed: skips.length > 0,
            empty: false
        };
    }

    /* ------------------------------------------------------------------ */
    /* State at an instant                                                 */
    /* ------------------------------------------------------------------ */

    /*
     * Derived, never accumulated.
     *
     * The state of the whole graph at time t is a function of t alone. Stepping
     * back, scrubbing, or jumping to an event all go through this same
     * function, so none of them can leave the picture inconsistent with the
     * clock - the bug every play/pause animation built on incremental state
     * eventually has.
     */
    function stateAt(script, at) {
        var nodes = Object.create(null);
        var edges = Object.create(null);
        var active = [];
        var completed = 0;
        var failures = 0;

        script.nodes.forEach(function (item) {
            var state;
            if (at < item.from) {
                state = NODE_STATE.PENDING;
            } else if (at >= item.from && at < item.to) {
                state = NODE_STATE.ACTIVE;
            } else {
                state = item.failed ? NODE_STATE.FAILED : NODE_STATE.DONE;
            }

            /* A failure shows as failed once its interval is nearly over
             * rather than only after it: it is the thing being looked for, and
             * "jump to the first failure" must land on it looking failed. */
            if (state === NODE_STATE.ACTIVE && item.failed && at >= item.to - MIN_VISIBLE_MS) {
                state = NODE_STATE.FAILED;
            }

            /*
             * Tallied from the state that was decided, not from the branch that
             * decided it. Counting inside the branches meant a node the override
             * had just turned red was still absent from the failure count -
             * so the header could read "0 failed" over a graph with a red node
             * on it, which is the one number on that bar nobody would think to
             * doubt.
             */
            nodes[item.eventId] = state;
            if (state === NODE_STATE.ACTIVE) { active.push(item); }
            if (state === NODE_STATE.DONE || state === NODE_STATE.FAILED) { completed++; }
            if (state === NODE_STATE.FAILED) { failures++; }
        });

        script.edges.forEach(function (item) {
            edges[item.relationshipId] = at < item.from ? EDGE_STATE.PENDING
                : at < item.to ? EDGE_STATE.FIRING
                : EDGE_STATE.DONE;
        });

        return {
            at: at,
            nodes: nodes,
            edges: edges,
            active: active,
            activeCount: active.length,
            completed: completed,
            failures: failures,
            /* More than one thing in flight is the parallelism the animation
             * is meant to show; the view uses this to label it. */
            parallel: active.length > 1,
            progress: script.duration ? Math.min(1, at / script.duration) : 1,
            finished: at >= script.duration
        };
    }

    /* Which real moment a replay instant corresponds to, for the clock readout
     * next to the scrubber. Approximate inside a compressed gap by design -
     * the gap is not being shown, so there is no exact answer to give. */
    function realTimeAt(script, at) {
        if (!script.nodes.length) { return null; }
        var real = script.startedAt + at;
        script.skips.forEach(function (skip) {
            var skipReplayStart = skip.from - script.startedAt;
            if (at > skipReplayStart) {
                real += Math.min(skip.realMs - skip.keptMs,
                                 (at - skipReplayStart) * (skip.realMs / Math.max(1, skip.keptMs)));
            }
        });
        return Math.min(real, script.endedAt);
    }

    /* ------------------------------------------------------------------ */
    /* The clock                                                           */
    /* ------------------------------------------------------------------ */

    /*
     * Driven by injected now() and schedule(), so the whole thing can be
     * stepped through in a test without a browser and without waiting in real
     * time for a replay to finish.
     */
    function Player(script, options) {
        options = options || {};
        this.script = script;
        this.at = 0;
        this.speed = options.speed || 1;
        this.playing = false;
        this.now = options.now || function () { return Date.now(); };
        this.schedule = options.schedule || function (fn, ms) { return setTimeout(fn, ms); };
        this.cancel = options.cancel || function (handle) { clearTimeout(handle); };
        this.onTick = options.onTick || function () {};
        this.tickMs = options.tickMs || 60;
        this.handle = null;
        this.anchorWall = null;
        this.anchorAt = 0;
    }

    Player.prototype.state = function () {
        return stateAt(this.script, this.at);
    };

    Player.prototype.play = function () {
        if (this.playing || this.script.empty) { return this; }
        if (this.at >= this.script.duration) { this.at = 0; }
        this.playing = true;
        this.anchorWall = this.now();
        this.anchorAt = this.at;
        this.loop();
        return this;
    };

    Player.prototype.loop = function () {
        var self = this;
        if (!this.playing) { return; }
        this.handle = this.schedule(function () {
            if (!self.playing) { return; }
            var elapsed = (self.now() - self.anchorWall) * self.speed;
            self.at = Math.min(self.anchorAt + elapsed, self.script.duration);
            self.onTick(self.state());
            if (self.at >= self.script.duration) { self.pause(); return; }
            self.loop();
        }, this.tickMs);
    };

    Player.prototype.pause = function () {
        this.playing = false;
        if (this.handle !== null) { this.cancel(this.handle); this.handle = null; }
        this.onTick(this.state());
        return this;
    };

    Player.prototype.toggle = function () {
        return this.playing ? this.pause() : this.play();
    };

    /*
     * Seeking while playing re-anchors the clock rather than stopping it: a
     * scrub during playback should carry on from where it was dropped, which
     * is what makes the scrubber feel like a control rather than a stop button.
     */
    Player.prototype.seek = function (at) {
        this.at = Math.max(0, Math.min(at, this.script.duration));
        this.anchorWall = this.now();
        this.anchorAt = this.at;
        this.onTick(this.state());
        return this;
    };

    Player.prototype.seekFraction = function (fraction) {
        return this.seek(this.script.duration * Math.max(0, Math.min(1, fraction)));
    };

    Player.prototype.setSpeed = function (speed) {
        this.anchorAt = this.at;
        this.anchorWall = this.now();
        this.speed = speed || 1;
        return this;
    };

    /*
     * Step to the next thing that happens, not by a fixed interval.
     *
     * A step of 100ms lands between events and shows the same picture twice;
     * stepping to the next boundary means every press changes something, which
     * is what somebody pressing it is asking for.
     */
    Player.prototype.boundaries = function () {
        if (this._boundaries) { return this._boundaries; }
        var points = [0];
        this.script.nodes.forEach(function (item) {
            points.push(item.from);
            points.push(item.to);
        });
        points.push(this.script.duration);
        this._boundaries = points
            .filter(function (value, index, all) { return all.indexOf(value) === index; })
            .sort(function (a, b) { return a - b; });
        return this._boundaries;
    };

    Player.prototype.stepForward = function () {
        var points = this.boundaries();
        var at = this.at;
        for (var i = 0; i < points.length; i++) {
            if (points[i] > at + 1) { return this.seek(points[i]); }
        }
        return this.seek(this.script.duration);
    };

    Player.prototype.stepBack = function () {
        var points = this.boundaries();
        var at = this.at;
        for (var i = points.length - 1; i >= 0; i--) {
            if (points[i] < at - 1) { return this.seek(points[i]); }
        }
        return this.seek(0);
    };

    /* Land just inside the event so it reads as active rather than about to
     * start - somebody who asked to jump to it wants to see it happening. */
    Player.prototype.jumpToEvent = function (eventId) {
        var item = this.script.byId && this.script.byId[eventId];
        if (!item) { return this; }
        return this.seek(item.from + Math.min(40, (item.to - item.from) / 2));
    };

    /*
     * The first failure, which is the question most replays are opened with.
     *
     * Lands at the end of its interval rather than inside it, unlike
     * jumpToEvent. Jumping into the middle showed the operation still in
     * flight - honest, and not what somebody who pressed "first failure" is
     * asking to see. They want the moment it went red.
     */
    Player.prototype.jumpToFirstFailure = function () {
        var failure = this.script.nodes.filter(function (item) { return item.failed; })[0];
        if (!failure) { return this; }
        return this.seek(Math.max(failure.from, failure.to - 1));
    };

    Player.prototype.destroy = function () {
        this.playing = false;
        if (this.handle !== null) { this.cancel(this.handle); this.handle = null; }
        this.onTick = function () {};
        return this;
    };

    /* ------------------------------------------------------------------ */
    /* Timeline                                                            */
    /* ------------------------------------------------------------------ */

    /*
     * The chronological view, as rows.
     *
     * Lanes are assigned greedily: a row is reused when the previous occupant
     * has finished. Overlapping work therefore lands on separate lanes and
     * parallelism is visible in the shape of the timeline before anything is
     * played at all.
     */
    function timeline(script, options) {
        options = options || {};
        var width = options.width || 1000;
        var laneEnds = [];

        var rows = script.nodes.map(function (item) {
            var lane = 0;
            while (lane < laneEnds.length && laneEnds[lane] > item.from) { lane++; }
            laneEnds[lane] = item.to;

            var left = script.duration ? (item.from / script.duration) * width : 0;
            var right = script.duration ? (item.to / script.duration) * width : width;

            return {
                eventId: item.eventId,
                node: item.node,
                lane: lane,
                left: left,
                width: Math.max(4, right - left),
                from: item.from,
                to: item.to,
                realDuration: item.realDuration,
                failed: item.failed
            };
        });

        return {
            rows: rows,
            lanes: laneEnds.length,
            width: width,
            skips: script.skips.map(function (skip) {
                return {
                    realMs: skip.realMs,
                    left: script.duration
                        ? ((skip.from - script.startedAt) / script.duration) * width : 0
                };
            })
        };
    }

    var api = {
        NODE_STATE: NODE_STATE,
        EDGE_STATE: EDGE_STATE,
        MIN_VISIBLE_MS: MIN_VISIBLE_MS,
        GAP_THRESHOLD_MS: GAP_THRESHOLD_MS,
        buildScript: buildScript,
        stateAt: stateAt,
        realTimeAt: realTimeAt,
        timeline: timeline,
        Player: Player
    };

    root.SSReplay = api;
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof self !== 'undefined' ? self : this);
