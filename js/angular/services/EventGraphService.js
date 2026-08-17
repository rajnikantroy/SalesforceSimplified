/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * EventGraphService - the panel's side of the Event Graph Engine.
 *
 * Deliberately thin, like PipelineService. Every decision about what an event
 * is, what relates to what, and how confident that claim is lives in
 * js/event-graph/, which is plain JavaScript with no Angular and no network -
 * so all of it is testable without an org, and none of it can quietly start
 * making requests.
 *
 * What is here instead is the part that has to talk to Salesforce: which
 * queries to run for a given trace root, in what order, and what to do when
 * half of them are refused. That last part is most of the code. A user without
 * "View Setup and Configuration" gets nothing from SetupAuditTrail, most orgs
 * have no debug log for the transaction being investigated, and Event
 * Monitoring is a paid add-on. Every one of those is a normal outcome, not an
 * error, and each contributes an acknowledged gap rather than a failed load.
 *
 * Nothing here writes to the org. Every request is a read.
 */
(function () {
'use strict';
var app = window.app || angular.module("SalesforceSimplifiedApp");

app.service('EventGraphService', ['$q', 'sfdc', 'SchemaService',
            function($q, sfdc, SchemaService) {

    var self = this;

    var Model = window.SSEventModel;
    var StoreApi = window.SSEventStore;
    var Correlation = window.SSCorrelation;
    var Trace = window.SSTrace;
    var Replay = window.SSReplay;
    var Collectors = window.SSCollectors;
    var Analysis = window.SSAnalysis;
    var RecordGraph = window.SSRecordGraph;
    var Export = window.SSExport;

    /* Exposed so the controller and templates can name confidences, views and
     * relationship types without reaching into window themselves. */
    this.Model = Model;
    this.Trace = Trace;
    this.Replay = Replay;
    this.Analysis = Analysis;
    this.Collectors = Collectors;
    this.Export = Export;

    /*
     * How far either side of the anchor to look.
     *
     * A trace is a moment, not a day. Widening this is the easiest way to make
     * the graph appear richer and the fastest way to make it wrong: the more
     * time included, the more unrelated work the proximity rule will connect.
     */
    var WINDOW_BEFORE_MS = 10 * 60 * 1000;
    var WINDOW_AFTER_MS = 10 * 60 * 1000;

    /* Ceilings, so one busy org cannot hang the panel. */
    var MAX_LOGS = 5;
    var MAX_RELATED = 12;
    var MAX_AUDIT = 200;

    this.store = new StoreApi.EventStore();

    /*
     * Design-time dependencies, fed to the correlation engine.
     *
     * Kept separate from events on purpose - see the designTimeInvocation rule.
     * These say what the org is configured to do, never what it did.
     */
    this.dependencies = [];

    /*
     * Lookup and master-detail edges, produced by the record walk. Held apart
     * from correlation's output because they are facts read out of fields
     * rather than conclusions drawn from events.
     */
    this.structural = [];

    /* Everything a collector could not read, and why. Rendered as-is. */
    this.problems = [];

    this.reset = function() {
        self.store.clear();
        self.dependencies = [];
        self.structural = [];
        self.problems = [];
        return self;
    };

    function note(source, error) {
        var message = (error && error.message) ||
            (sfdc.errorMessage ? sfdc.errorMessage(error, source) : null) ||
            'Could not be read.';
        self.problems.push({ source: source, message: message });
    }

    /*
     * Every collector settles.
     *
     * A refused query contributes a note and an empty list. One source failing
     * must never take the trace with it - the commonest case is a permission
     * the user does not have, and a graph missing its audit trail is far more
     * use than an error page.
     */
    function settle(source, promise, transform) {
        return $q.when(promise).then(function(data) {
            try {
                return transform ? transform(data) : data;
            } catch (e) {
                note(source, e);
                return [];
            }
        }, function(error) {
            note(source, error);
            return [];
        });
    }

    /* ------------------------------------------------------------------ */
    /* Context                                                             */
    /* ------------------------------------------------------------------ */

    /*
     * What page this is. URL only - see the note in ss-collectors about why
     * nothing here reads the DOM.
     */
    this.context = function() {
        var context = Collectors.pageContext(window.location.href);
        context.userId = (typeof readCookie === 'function' && readCookie('uid')) || null;
        context.userName = (typeof readCookie === 'function' &&
            readCookie('SFDCSimplified_uname')) || null;
        context.org = (typeof ssOrgLabel === 'function' && ssOrgLabel()) || null;
        return context;
    };

    /* The offer made on a record page: what this context can be traced as. */
    this.traceOptions = function() {
        var context = self.context();
        var options = [];

        if (context.recordId) {
            options.push({
                kind: Trace.ROOT_KIND.RECORD, id: context.recordId,
                label: 'Trace this ' + (context.objectType || 'record'),
                detail: context.recordId
            });
        }
        if (context.userId) {
            options.push({
                kind: Trace.ROOT_KIND.USER, id: context.userId,
                label: 'Trace this user',
                detail: context.userName || context.userId
            });
        }
        options.push({
            kind: Trace.ROOT_KIND.SESSION, id: 'browser-session',
            label: 'Trace this session',
            detail: 'What this browser has done since the page loaded'
        });
        return options;
    };

    /* ------------------------------------------------------------------ */
    /* Browser-observed events                                             */
    /* ------------------------------------------------------------------ */

    /*
     * The extension's own record of what the user did in this tab.
     *
     * This is the only genuinely first-hand source available: everything else
     * is the org being asked afterwards what it remembers. Kept in memory for
     * the life of the page, because persisting a user's navigation history is
     * not something a metadata tool should be doing without being asked.
     */
    var browserEvents = [];
    var sessionId = 'browser-' + Date.now().toString(36);

    this.observeNavigation = function(url, when) {
        var context = self.context();
        var raw = Collectors.fromNavigation({
            url: url || window.location.href,
            timestamp: when || Date.now(),
            actor: context.userId
                ? { kind: Model.ACTOR_KIND.USER, id: context.userId, name: context.userName }
                : null,
            session: { id: sessionId }
        });
        browserEvents.push(raw);
        return raw;
    };

    /* An action the user took inside this extension - the one click the
     * extension can attribute with certainty, because it handled it. */
    this.observeAction = function(action, detail) {
        var context = self.context();
        browserEvents.push({
            eventType: 'BUTTON_CLICK',
            timestamp: Date.now(),
            actor: context.userId
                ? { kind: Model.ACTOR_KIND.USER, id: context.userId, name: context.userName }
                : null,
            session: { id: sessionId },
            source: { kind: Model.PROVENANCE.BROWSER, system: 'extension' },
            entity: context.recordId
                ? { type: context.objectType, id: context.recordId } : null,
            component: { kind: Model.COMPONENT_KIND.UI, name: 'Salesforce Simplified' },
            action: action,
            status: Model.STATUS.SUCCESS,
            metadata: detail || {}
        });
    };

    this.browserEvents = function() { return browserEvents.slice(); };

    /* ------------------------------------------------------------------ */
    /* Salesforce collectors                                               */
    /* ------------------------------------------------------------------ */

    function restVersionPath() {
        return '/services/data/v' + (window.SS_API_VERSION || '60.0');
    }

    function absolute(path) {
        return (typeof ssApiOrigin === 'function' ? ssApiOrigin() : '') + path;
    }

    /*
     * One record, in full.
     *
     * The REST sobject endpoint rather than SOQL: it returns every field the
     * user can see without this having to know what they are, which is what
     * makes the lookup-following below work on custom objects it has never
     * heard of.
     */
    function fetchRecord(objectType, recordId) {
        if (!objectType || !recordId) { return $q.when([]); }
        return settle('Record ' + recordId,
            sfdc.get(absolute(restVersionPath() + '/sobjects/' +
                encodeURIComponent(objectType) + '/' + encodeURIComponent(recordId))),
            function(row) {
                if (!row || !row.Id) { return []; }
                return Collectors.fromRecords([row], { objectType: objectType });
            });
    }

    /*
     * The records this one points at.
     *
     * One hop only. Two hops on a well-connected Account reaches most of the
     * org, which is neither useful nor fast - and Follow Record exists for
     * going further deliberately.
     */
    function fetchRelated(events) {
        var seen = Object.create(null);
        var targets = [];

        events.forEach(function(event) {
            ((event.metadata && event.metadata.references) || []).forEach(function(reference) {
                if (seen[reference.id] || targets.length >= MAX_RELATED) { return; }
                var type = Collectors.prefixToObject(reference.id);
                if (!type) { return; }
                seen[reference.id] = true;
                targets.push({ type: type, id: reference.id });
            });
        });

        if (!targets.length) { return $q.when([]); }

        return $q.all(targets.map(function(target) {
            return fetchRecord(target.type, target.id);
        })).then(function(lists) {
            return lists.reduce(function(all, list) { return all.concat(list); }, []);
        });
    }

    function fetchAuditTrail(from, to) {
        var soql = "SELECT Id, Action, Section, Display, CreatedById, CreatedBy.Name, " +
            "CreatedDate FROM SetupAuditTrail WHERE CreatedDate >= " + iso(from) +
            " AND CreatedDate <= " + iso(to) + " ORDER BY CreatedDate DESC LIMIT " + MAX_AUDIT;
        return settle('Setup Audit Trail', sfdc.query(soql), function(data) {
            return Collectors.fromAuditTrail((data && data.records) || []);
        });
    }

    function fetchAsyncJobs(from, to) {
        var soql = "SELECT Id, JobType, ApexClass.Name, MethodName, Status, ExtendedStatus, " +
            "NumberOfErrors, TotalJobItems, CreatedById, CreatedDate, CompletedDate " +
            "FROM AsyncApexJob WHERE CreatedDate >= " + iso(from) +
            " AND CreatedDate <= " + iso(to) + " ORDER BY CreatedDate DESC LIMIT 50";
        return settle('Async Apex jobs', sfdc.query(soql), function(data) {
            return Collectors.fromAsyncJobs((data && data.records) || []);
        });
    }

    /*
     * Debug logs, and their bodies.
     *
     * By far the richest source and almost never present: a trace flag has to
     * have been set before the transaction ran. When there is one, it supplies
     * the only real execution structure the engine ever gets, so it is worth
     * the extra round trip per log.
     */
    function fetchDebugLogs(from, to, userId) {
        var where = "StartTime >= " + iso(from) + " AND StartTime <= " + iso(to);
        if (userId) { where += " AND LogUserId = '" + escapeSoqlLiteral(userId) + "'"; }
        var soql = "SELECT Id, LogUserId, LogUser.Name, Operation, StartTime, " +
            "DurationMilliseconds, Status, LogLength FROM ApexLog WHERE " + where +
            " ORDER BY StartTime DESC LIMIT " + MAX_LOGS;

        return settle('Debug logs', sfdc.query(soql), function(data) {
            return (data && data.records) || [];
        }).then(function(logs) {
            if (!logs.length) { return []; }

            return $q.all(logs.map(function(log) {
                return settle('Debug log ' + log.Id,
                    sfdc.get(absolute(restVersionPath() + '/sobjects/ApexLog/' +
                        encodeURIComponent(log.Id) + '/Body')),
                    function(body) {
                        var parsed = Collectors.parseDebugLog(body, {
                            startTime: log.StartTime,
                            logId: log.Id,
                            actor: {
                                kind: Model.ACTOR_KIND.USER,
                                id: log.LogUserId,
                                name: (log.LogUser && log.LogUser.Name) || log.LogUserId
                            },
                            session: { id: sessionId }
                        });
                        if (parsed.truncated) {
                            self.problems.push({
                                source: 'Debug log ' + log.Id,
                                message: 'The log hit Salesforce\'s size limit and is cut ' +
                                         'off, so the end of this transaction is missing.'
                            });
                        }
                        return parsed.events;
                    });
            })).then(function(lists) {
                return lists.reduce(function(all, list) { return all.concat(list); }, []);
            });
        });
    }

    /*
     * OmniStudio configuration, for design-time dependencies only.
     *
     * The object is named differently depending on whether the org runs
     * OmniStudio standard objects or the older managed package, and plenty of
     * orgs have neither. All three outcomes are fine; the query that does not
     * apply simply contributes nothing.
     */
    function fetchOmniDependencies() {
        var attempts = [
            "SELECT Id, Name, PropertySetConfig FROM OmniProcessElement LIMIT 500",
            "SELECT Id, Name, PropertySetConfig FROM vlocity_cmt__Element__c LIMIT 500",
            "SELECT Id, Name, PropertySetConfig FROM vlocity_ins__Element__c LIMIT 500"
        ];

        return $q.all(attempts.map(function(soql) {
            return $q.when(sfdc.query(soql)).then(function(data) {
                return (data && data.records) || [];
            }, function() {
                /* Not an error: the org does not have this object. Silent on
                 * purpose - reporting "OmniStudio not installed" as a problem
                 * on every org without it is noise, not information. */
                return [];
            });
        })).then(function(lists) {
            var rows = lists.reduce(function(all, list) { return all.concat(list); }, []);
            return Collectors.omniDependencies(rows);
        });
    }

    function iso(when) {
        return new Date(when).toISOString();
    }

    /* ------------------------------------------------------------------ */
    /* Excluded objects                                                    */
    /* ------------------------------------------------------------------ */

    /*
     * Which objects to leave out, remembered per org.
     *
     * A walk from an Account in a large org reaches thousands of Tasks,
     * EmailMessages and feed items, and the graph becomes unreadable long
     * before it becomes slow. Which objects do that is a property of the org,
     * not something this extension can know in advance - an org that runs its
     * business on Tasks needs them, and one that keeps a decade of email
     * against every Case does not. So there is no built-in list of noisy
     * objects: the walk reports what it found, with counts, and the user says
     * what to drop.
     *
     * Kept per org because the answer differs between them, and remembered
     * because nobody wants to exclude the same six objects on every trace.
     */
    function storageKey(suffix) {
        var org = (typeof ssOrgKey === 'function' &&
                   ssOrgKey(window.location.hostname)) || 'default';
        return 'Simplified_EventGraph_' + suffix + '_' + org;
    }

    function readList(suffix) {
        try {
            var raw = localStorage.getItem(storageKey(suffix));
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            /* Corrupt or disabled storage is an empty list, not an exception
             * that stops the panel opening. */
            return [];
        }
    }

    function writeList(suffix, list) {
        var unique = (list || []).filter(function(name, index, all) {
            return name && all.indexOf(name) === index;
        });
        try {
            localStorage.setItem(storageKey(suffix), JSON.stringify(unique));
        } catch (e) {
            /* Quota or storage off. The caller has already updated the screen;
             * the choice holds for this session and is simply not saved. */
        }
        return unique;
    }

    this.excludedObjects = function() { return readList('Excluded'); };
    this.setExcludedObjects = function(list) { return writeList('Excluded', list); };

    /*
     * Objects pinned into the graph, exempt from the relationship budget.
     *
     * The counterpart to exclusion, and the answer to a panel that says "87
     * relationships not followed" with no way to reach any of them. A standard
     * object carries about a hundred child relationships; the budget follows
     * the first few by a sort order the user did not choose, so the one they
     * came for may be nowhere near the front.
     */
    this.includedObjects = function() { return readList('Included'); };
    this.setIncludedObjects = function(list) { return writeList('Included', list); };

    this.toggleExcluded = function(objectName) {
        if (!objectName) { return self.excludedObjects(); }
        var list = self.excludedObjects();
        var at = list.indexOf(objectName);
        if (at === -1) { list.push(objectName); } else { list.splice(at, 1); }
        /* Excluding something that was pinned drops the pin: holding both
         * would leave the object's fate depending on which list was read
         * first, which is not something a user can reason about. */
        if (at === -1) {
            var pins = self.includedObjects();
            var pinAt = pins.indexOf(objectName);
            if (pinAt !== -1) { pins.splice(pinAt, 1); self.setIncludedObjects(pins); }
        }
        return self.setExcludedObjects(list);
    };

    this.toggleIncluded = function(objectName) {
        if (!objectName) { return self.includedObjects(); }
        var list = self.includedObjects();
        var at = list.indexOf(objectName);
        if (at === -1) { list.push(objectName); } else { list.splice(at, 1); }
        return self.setIncludedObjects(list);
    };

    /* What is in the graph, so excluding is a decision rather than a guess. */
    this.inventory = function() {
        return RecordGraph.inventory(self.store.all(), {
            excluded: self.excludedObjects()
        });
    };

    /* ------------------------------------------------------------------ */
    /* The record relationship graph                                       */
    /* ------------------------------------------------------------------ */

    /*
     * Walk a record's relationships outward, breadth first.
     *
     * This is the mode that actually works in an ordinary org, and it is the
     * default for a record root. Every edge it produces is a lookup or a
     * master-detail field, so every edge is confirmed - no timing, no
     * proximity, nothing inferred.
     *
     * Breadth first and capped, because a well-connected Account reaches most
     * of the org in three hops. Two levels covers "this Case, what it belongs
     * to, and what came out of it", which is what somebody looking at a record
     * means by "related".
     */
    var describeCache = Object.create(null);
    var MAX_CHILDREN_PER_RELATION = 25;
    var MAX_RECORDS_PER_HOP = 60;
    var MAX_HISTORY = 100;

    function rawDescribe(objectName) {
        if (describeCache[objectName]) { return describeCache[objectName]; }
        describeCache[objectName] = $q.when(
            sfdc.get(absolute(restVersionPath() + '/sobjects/' +
                encodeURIComponent(objectName) + '/describe'))
        ).then(function(payload) {
            return payload && payload.fields ? payload : null;
        }, function(error) {
            /* Not memoised as a failure: a describe refused once because the
             * session was mid-refresh should not stay refused for the page. */
            describeCache[objectName] = null;
            note('Describe ' + objectName, error);
            return null;
        });
        return describeCache[objectName];
    }

    /* Key prefix to object name, from the org rather than from a table here -
     * which is what makes custom objects traceable at all. */
    var prefixMapPromise = null;
    function prefixMap() {
        if (prefixMapPromise) { return prefixMapPromise; }
        prefixMapPromise = $q.when(SchemaService.globalDescribe()).then(function(catalogue) {
            return RecordGraph.buildPrefixMap(catalogue);
        }, function() {
            return Object.create(null);
        });
        return prefixMapPromise;
    }

    this.objectForId = function(recordId) {
        return prefixMap().then(function(map) {
            return RecordGraph.objectForId(recordId, map) ||
                   Collectors.prefixToObject(recordId);
        });
    };

    /*
     * Names for the ids that appear as actors.
     *
     * Without this every node says "005XX0000012345 created this", which is
     * the single thing that makes an otherwise good graph look unfinished.
     * One query for the whole graph rather than one per record.
     */
    function resolveUserNames(events) {
        var ids = Object.create(null);
        events.forEach(function(event) {
            if (event.actor && event.actor.id && /^005/.test(event.actor.id)) {
                ids[event.actor.id] = true;
            }
        });
        var list = Object.keys(ids);
        if (!list.length) { return $q.when({}); }

        var soql = "SELECT Id, Name FROM User WHERE Id IN ('" +
            list.slice(0, 200).map(escapeSoqlLiteral).join("','") + "')";

        return settle('User names', sfdc.query(soql), function(data) {
            var names = {};
            ((data && data.records) || []).forEach(function(row) { names[row.Id] = row.Name; });
            return names;
        }).then(function(names) { return names || {}; });
    }

    function applyUserNames(events, names) {
        events.forEach(function(event) {
            if (event.actor && event.actor.id && names[event.actor.id]) {
                event.actor.name = names[event.actor.id];
            }
        });
        return events;
    }

    /* One object's rows, with the columns the graph needs. */
    function fetchRows(objectName, where, limit) {
        return rawDescribe(objectName).then(function(describe) {
            if (!describe) { return { rows: [], describe: null, selection: null }; }
            var selection = RecordGraph.selectFields(describe);
            var soql = RecordGraph.soqlFor(objectName, selection, where, limit);
            return settle(objectName, sfdc.query(soql), function(data) {
                return (data && data.records) || [];
            }).then(function(rows) {
                return { rows: rows, describe: describe, selection: selection };
            });
        });
    }

    /*
     * The walk.
     *
     * Each hop: fetch what the current frontier points at and what points at
     * it, turn every row into events, and use those rows to plan the next hop.
     * Records already seen are never re-fetched, which is what stops a cycle -
     * a Case whose parent Case lists it as a child - from running forever.
     */
    this.collectRecordGraph = function(spec) {
        spec = spec || {};
        self.problems = [];

        var depth = spec.depth === undefined ? 2 : spec.depth;
        var seen = Object.create(null);
        var allEvents = [];
        var histories = spec.includeHistory !== false;
        var excluded = spec.excluded || self.excludedObjects();
        var included = spec.included || self.includedObjects();
        var budget = spec.maxChildRelations === undefined ? 8 : spec.maxChildRelations;
        var skipped = Object.create(null);

        return prefixMap().then(function(map) {
            return $q.when(spec.objectType ||
                RecordGraph.objectForId(spec.id, map) ||
                Collectors.prefixToObject(spec.id)).then(function(objectType) {

                if (!objectType) {
                    return $q.reject({
                        message: 'Nothing in this org has the key prefix "' +
                                 String(spec.id).slice(0, 3) + '", so that id cannot be resolved ' +
                                 'to an object.'
                    });
                }

                seen[spec.id] = true;

                /* Hop zero: the record itself. */
                return fetchRows(objectType,
                    "Id = '" + escapeSoqlLiteral(spec.id) + "'", 1
                ).then(function(first) {
                    if (!first.rows.length) {
                        return $q.reject({
                            message: 'Record ' + spec.id + ' could not be read. It may not ' +
                                     'exist, or your user may not have access to it.'
                        });
                    }

                    var frontier = [{
                        row: first.rows[0], describe: first.describe,
                        selection: first.selection, objectType: objectType, depth: 0
                    }];

                    allEvents = allEvents.concat(RecordGraph.eventsForRecord(first.rows[0], {
                        objectType: objectType,
                        selection: first.selection,
                        parentLinks: RecordGraph.parentLinks(first.describe),
                        depth: 0,
                        isRoot: true
                    }));

                    return walk(frontier, 1);
                });

                function walk(frontier, level) {
                    if (level > depth || !frontier.length) {
                        return $q.when(allEvents);
                    }

                    var plan = RecordGraph.planHop({
                        records: frontier,
                        prefixMap: map,
                        seen: seen,
                        excluded: excluded,
                        included: included,
                        maxChildRelations: budget
                    });

                    /* Remembered so the panel can say what was left out and
                     * why - an exclusion nobody can see is one nobody can
                     * undo, and a relationship dropped for budget is a
                     * different fact from one the user chose to drop. */
                    (plan.skipped || []).forEach(function(entry) {
                        if (!skipped[entry.objectName] ||
                            skipped[entry.objectName] === 'budget') {
                            skipped[entry.objectName] = entry.reason;
                        }
                    });

                    /* Parents: one row each, grouped by object so a Case with
                     * three Contact lookups is one query, not three. */
                    var byObject = Object.create(null);
                    plan.parents.forEach(function(target) {
                        if (seen[target.recordId]) { return; }
                        seen[target.recordId] = true;
                        if (!byObject[target.objectName]) { byObject[target.objectName] = []; }
                        byObject[target.objectName].push(target);
                    });

                    var jobs = [];

                    Object.keys(byObject).slice(0, 12).forEach(function(objectName) {
                        var targets = byObject[objectName].slice(0, MAX_RECORDS_PER_HOP);
                        var ids = targets.map(function(t) {
                            return "'" + escapeSoqlLiteral(t.recordId) + "'";
                        }).join(',');

                        jobs.push(fetchRows(objectName, 'Id IN (' + ids + ')', targets.length)
                            .then(function(result) {
                                return result.rows.map(function(row) {
                                    var via = (targets.filter(function(t) {
                                        return t.recordId === row.Id;
                                    })[0] || {}).via;
                                    return {
                                        row: row, describe: result.describe,
                                        selection: result.selection,
                                        objectType: objectName, depth: level, via: via
                                    };
                                });
                            }));
                    });

                    /* Children: one query per relationship. */
                    plan.children.slice(0, 20).forEach(function(target) {
                        if (target.isHistory) {
                            if (!histories) { return; }
                            jobs.push(fetchHistory(target, frontier, level));
                            return;
                        }
                        var where = target.field + " = '" +
                                    escapeSoqlLiteral(target.parentId) + "'";
                        jobs.push(fetchRows(target.objectName, where, MAX_CHILDREN_PER_RELATION)
                            .then(function(result) {
                                return result.rows.filter(function(row) {
                                    if (seen[row.Id]) { return false; }
                                    seen[row.Id] = true;
                                    return true;
                                }).map(function(row) {
                                    return {
                                        row: row, describe: result.describe,
                                        selection: result.selection,
                                        objectType: target.objectName, depth: level,
                                        via: target.via
                                    };
                                });
                            }));
                    });

                    return $q.all(jobs).then(function(lists) {
                        var reached = [];
                        lists.forEach(function(list) {
                            (list || []).forEach(function(entry) {
                                if (entry.historyEvents) {
                                    allEvents = allEvents.concat(entry.historyEvents);
                                    return;
                                }
                                reached.push(entry);
                                allEvents = allEvents.concat(
                                    RecordGraph.eventsForRecord(entry.row, {
                                        objectType: entry.objectType,
                                        selection: entry.selection,
                                        parentLinks: RecordGraph.parentLinks(entry.describe),
                                        depth: entry.depth,
                                        reachedVia: entry.via
                                    }));
                            });
                        });
                        return walk(reached, level + 1);
                    });
                }

                function fetchHistory(target, frontier, level) {
                    var parent = frontier.filter(function(entry) {
                        return entry.row.Id === target.parentId;
                    })[0];
                    var where = target.field + " = '" +
                                escapeSoqlLiteral(target.parentId) + "'";
                    var soql = 'SELECT Id, Field, OldValue, NewValue, CreatedDate, CreatedById, ' +
                               target.field + ' FROM ' + target.objectName +
                               ' WHERE ' + where + ' ORDER BY CreatedDate DESC LIMIT ' + MAX_HISTORY;

                    return settle(target.objectName, sfdc.query(soql), function(data) {
                        return (data && data.records) || [];
                    }).then(function(rows) {
                        if (!rows.length) { return []; }
                        var names = {};
                        if (parent) {
                            names[parent.row.Id] = (parent.selection && parent.selection.nameField &&
                                parent.row[parent.selection.nameField]) || parent.row.Id;
                        }
                        return [{
                            historyEvents: RecordGraph.eventsForHistory(rows, {
                                objectType: target.objectName,
                                parentType: parent ? parent.objectType : null,
                                parentField: target.field,
                                recordNames: names,
                                depth: level
                            })
                        }];
                    });
                }
            });
        }).then(function() {
            return resolveUserNames(allEvents).then(function(names) {
                applyUserNames(allEvents, names);
                var ingested = self.store.ingest(allEvents);

                /*
                 * The lookup edges are computed after ingestion, because they
                 * join events by eventId and those are assigned during
                 * normalisation.
                 */
                self.structural = RecordGraph.relationshipsFor(self.store.all());

                return {
                    collected: ingested.added.length,
                    records: Object.keys(seen).length,
                    links: self.structural.length,
                    rejected: ingested.rejected,
                    problems: self.problems.slice(),
                    inventory: RecordGraph.inventory(self.store.all(), { excluded: excluded }),
                    excluded: excluded.slice(),
                    included: included.slice(),
                    budget: budget,
                    /* Relationships not followed, and whether that was the
                     * user's choice or the relationship budget running out. */
                    skipped: Object.keys(skipped).map(function(name) {
                        return { objectName: name, reason: skipped[name] };
                    })
                };
            });
        });
    };

    /* ------------------------------------------------------------------ */
    /* External ingestion                                                  */
    /* ------------------------------------------------------------------ */

    /*
     * The way in for everything this engine cannot observe.
     *
     * Accepts the documented envelope from a pasted payload or from a page
     * that posts one. Validated, never trusted: see ingestExternal, which
     * forces provenance to 'external' whatever the sender claims.
     */
    this.ingestExternal = function(payload) {
        var parsed = payload;
        if (typeof payload === 'string') {
            try {
                parsed = JSON.parse(payload);
            } catch (e) {
                return { added: 0, rejected: [{ index: 0, reason: 'Not valid JSON: ' + e.message }] };
            }
        }

        var isAgentTrace = parsed && (parsed.toolCalls || parsed.agentId);
        var result = isAgentTrace
            ? { events: Collectors.fromAgentTrace(parsed), rejected: [] }
            : Collectors.ingestExternal(parsed);

        var stored = self.store.ingest(result.events);
        return {
            added: stored.added.length,
            rejected: result.rejected.concat(stored.rejected.map(function(entry) {
                return { reason: entry.error };
            }))
        };
    };

    /* ------------------------------------------------------------------ */
    /* Collecting a trace                                                  */
    /* ------------------------------------------------------------------ */

    /*
     * Gather everything available for a root, then correlate it.
     *
     * The anchor decides the time window. For a record it is the record's own
     * last change; for a user or a session it is now. Sources that do not
     * apply to the chosen root are not asked - fetching the whole audit trail
     * to trace one API call is a slow way to add noise.
     */
    this.collect = function(spec) {
        spec = spec || {};
        self.problems = [];

        var anchor = spec.anchor || Date.now();
        var from = anchor - (spec.windowBefore || WINDOW_BEFORE_MS);
        var to = anchor + (spec.windowAfter || WINDOW_AFTER_MS);
        var context = self.context();

        var jobs = [];

        /* Always: what this browser saw. It costs nothing and it is the only
         * first-hand evidence in the whole collection. */
        jobs.push($q.when(browserEvents.slice()));

        if (spec.kind === Trace.ROOT_KIND.RECORD && spec.id) {
            var objectType = spec.objectType || Collectors.prefixToObject(spec.id);
            jobs.push(fetchRecord(objectType, spec.id).then(function(events) {
                return fetchRelated(events).then(function(related) {
                    return events.concat(related);
                });
            }));
        }

        if (spec.kind === Trace.ROOT_KIND.USER || spec.kind === Trace.ROOT_KIND.SESSION ||
            spec.kind === Trace.ROOT_KIND.RECORD) {
            jobs.push(fetchDebugLogs(from, to,
                spec.kind === Trace.ROOT_KIND.USER ? spec.id : context.userId));
        }

        if (spec.includeAudit !== false) {
            jobs.push(fetchAuditTrail(from, to));
        }
        if (spec.includeAsync !== false) {
            jobs.push(fetchAsyncJobs(from, to));
        }

        var dependencyJob = spec.includeOmni === false
            ? $q.when([])
            : fetchOmniDependencies();

        return $q.all(jobs).then(function(lists) {
            var raw = lists.reduce(function(all, list) { return all.concat(list || []); }, []);
            var ingested = self.store.ingest(raw);

            return dependencyJob.then(function(dependencies) {
                self.dependencies = dependencies || [];
                return {
                    collected: ingested.added.length,
                    rejected: ingested.rejected,
                    problems: self.problems.slice(),
                    dependencies: self.dependencies.length
                };
            });
        });
    };

    /*
     * The correlated graph over everything currently in the store.
     *
     * Rebuilt rather than cached: correlation is fast on a few thousand events
     * and a stale graph after an ingestion is a worse problem than a
     * recomputation nobody notices.
     */
    this.graph = function() {
        var events = self.store.all();
        var correlated = Correlation.correlate(events, {
            dependencies: self.dependencies
        });

        /*
         * The org's own lookups, added to what correlation worked out.
         *
         * These are not rules and do not belong in the rule set: a rule reads
         * events and reasons about them, while these are copied out of fields.
         * Merged through the same path so a lookup edge and an inferred edge
         * between the same pair collapse into one - and since these are
         * CONFIRMED they win, which is right. The org saying two records are
         * related beats this engine noticing they happened close together.
         */
        var all = Correlation.mergeRelationships(
            correlated.relationships.concat(self.structural || []));

        var graph = Trace.buildGraph(events, all);
        graph.correlationReport = correlated.report;
        graph.confidenceCounts = all.reduce(function(acc, rel) {
            acc[rel.confidence] = (acc[rel.confidence] || 0) + 1;
            return acc;
        }, {});
        graph.structuralCount = (self.structural || []).length;
        return graph;
    };

    /* One call for the panel: root and view in, everything to draw out. */
    this.trace = function(spec) {
        var graph = self.graph();
        var built = Trace.buildTrace(graph, spec);
        built.fullGraph = graph;
        built.gaps = Collectors.gapReport(self.store.all());
        built.problems = self.problems.slice();
        return built;
    };

    this.follow = function(spec) {
        return Trace.follow(self.graph(), spec);
    };

    this.script = function(subgraph, options) {
        return Replay.buildScript(subgraph, options);
    };

    this.player = function(script, options) {
        return new Replay.Player(script, options);
    };

    /* ------------------------------------------------------------------ */
    /* Questions                                                           */
    /* ------------------------------------------------------------------ */

    /*
     * Answered from the graph, deterministically. See ss-analysis for why
     * there is no model call behind this.
     */
    this.ask = function(question, target) {
        var graph = self.graph();
        switch (question) {
            case 'whyFailed':    return Analysis.whyDidThisFail(graph, target);
            case 'whatTriggered':return Analysis.whatTriggered(graph, target);
            case 'whoChanged':   return Analysis.whoChanged(graph, target);
            case 'slowest':      return Analysis.slowestOperations(graph);
            case 'summarize':    return Analysis.summarize(graph);
            default:
                return {
                    question: question,
                    answer: 'That question is not one this engine knows how to answer ' +
                            'from the graph.',
                    citations: [], gaps: [], grounded: false
                };
        }
    };

    /* Everything the store holds, for the header and the empty states. */
    this.stats = function() {
        return self.store.stats();
    };

    this.gaps = function() {
        return Collectors.gapReport(self.store.all());
    };

}]);
})();
