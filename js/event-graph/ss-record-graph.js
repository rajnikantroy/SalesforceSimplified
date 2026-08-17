/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * The record relationship graph.
 *
 * This exists because the journey the engine was first built for is, in almost
 * every real org, unobservable. Reconstructing "user clicked, OmniScript ran,
 * two APIs were called" needs runtime telemetry a browser extension cannot
 * get: debug logs require a trace flag set before the transaction happened,
 * Event Monitoring is a paid add-on, and OmniStudio runtime execution has to
 * be published by the org. Trace a Case with none of those and the graph is
 * two nodes - created, last changed - joined to whatever happened to be nearby
 * in time. Technically correct, and no use to anybody.
 *
 * What every org does have, always, with no configuration at all:
 *
 *   lookup and master-detail fields  - what this record points at
 *   childRelationships               - what points at this record
 *   audit fields                     - who made each one, and when
 *   history objects, where tracked   - the actual intermediate changes
 *
 * All of it comes from describe and SOQL, all of it is confirmed rather than
 * inferred, and together it answers the question people actually open a record
 * asking: what is this connected to, what came out of it, and who did that.
 *
 * The output is deliberately the same shape as every other collector's -
 * events and relationships - so the store, correlation, projections, layout,
 * timeline, replay and inspector all work on it unchanged. A record tree is
 * just an event graph whose edges happen to be lookups, and whose timeline
 * happens to span months rather than milliseconds.
 */
(function (root) {
    'use strict';

    var Model = root.SSEventModel ||
        (typeof require !== 'undefined' ? require('./ss-event-model.js') : null);

    /*
     * Auxiliary objects Salesforce generates alongside a real one. Following
     * them as ordinary children buries the record you asked about under its own
     * feed - but History is not noise, it is the only source of intermediate
     * changes there is, so it is picked out rather than skipped.
     */
    var AUXILIARY = {
        Feed: true, Share: true, ChangeEvent: true, Tag: true
    };

    /* Audit columns every queryable object carries. */
    var AUDIT_FIELDS = ['Id', 'CreatedDate', 'CreatedById', 'LastModifiedDate', 'LastModifiedById'];

    /* ------------------------------------------------------------------ */
    /* Resolving an id to an object                                        */
    /* ------------------------------------------------------------------ */

    /*
     * Key prefix to object name, from the org's own global describe.
     *
     * The hardcoded prefix table in ss-collectors covers a dozen standard
     * objects and nothing else, which means every custom object - the ones an
     * org's actual business runs on - resolved to null and could not be
     * traced at all. The org already knows this mapping for every object it
     * has; asking it is both complete and correct, and costs nothing because
     * the global describe is cached for a day.
     */
    function buildPrefixMap(globalDescribe) {
        var map = Object.create(null);
        Object.keys(globalDescribe || {}).forEach(function (name) {
            var info = globalDescribe[name];
            if (!info || !info.keyPrefix) { return; }
            /*
             * Prefixes are not unique - a handful are shared between an object
             * and one of its auxiliaries. The queryable, non-auxiliary one is
             * what somebody pasting an id means.
             */
            var existing = map[info.keyPrefix];
            if (!existing || (info.queryable && !existing.queryable)) {
                map[info.keyPrefix] = info;
            }
        });
        return map;
    }

    function objectForId(recordId, prefixMap) {
        if (!recordId || String(recordId).length < 15) { return null; }
        var info = prefixMap && prefixMap[String(recordId).slice(0, 3)];
        return info ? info.name : null;
    }

    function isRecordId(value) {
        return typeof value === 'string' && /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(value);
    }

    /* ------------------------------------------------------------------ */
    /* Reading a describe                                                  */
    /* ------------------------------------------------------------------ */

    /*
     * What this record points at.
     *
     * Polymorphic fields (OwnerId, WhatId, WhoId) reference several objects at
     * once, and which one a given row means is only knowable from the id
     * itself - so referenceTo is kept whole and resolved per record later.
     */
    function parentLinks(describe) {
        return ((describe && describe.fields) || []).filter(function (field) {
            return field && field.type === 'reference' &&
                   field.referenceTo && field.referenceTo.length &&
                   field.name !== 'CreatedById' && field.name !== 'LastModifiedById';
        }).map(function (field) {
            return {
                field: field.name,
                label: field.label,
                referenceTo: field.referenceTo,
                relationshipName: field.relationshipName || null,
                /* A master-detail child is owned by its parent; a lookup is
                 * merely associated. Worth distinguishing on screen. */
                masterDetail: field.relationshipOrder !== null &&
                              field.relationshipOrder !== undefined,
                polymorphic: field.referenceTo.length > 1
            };
        });
    }

    /*
     * What points at this record.
     *
     * Ordered so the ones a person means by "related records" come first: a
     * master-detail child before a lookup, and anything before the auxiliary
     * objects. Only the first few are followed, and which few matters.
     */
    function childLinks(describe, options) {
        options = options || {};
        var seen = Object.create(null);

        return ((describe && describe.childRelationships) || []).filter(function (rel) {
            if (!rel || !rel.childSObject || !rel.field) { return false; }
            if (!rel.relationshipName) { return false; }
            if (AUXILIARY[classifyAuxiliary(rel.childSObject)]) { return false; }
            /* One entry per child object: an object related twice (a Case with
             * ParentId and a second lookup) would otherwise be queried twice. */
            var key = rel.childSObject + '.' + rel.field;
            if (seen[key]) { return false; }
            seen[key] = true;
            return true;
        }).map(function (rel) {
            return {
                childSObject: rel.childSObject,
                field: rel.field,
                relationshipName: rel.relationshipName,
                cascadeDelete: !!rel.cascadeDelete,
                isHistory: classifyAuxiliary(rel.childSObject) === 'History'
            };
        }).sort(function (a, b) {
            /* Cascade-delete means master-detail: those are the record's own
             * parts and belong nearest to it. History last - it is detail
             * about the record rather than a related record. */
            if (a.isHistory !== b.isHistory) { return a.isHistory ? 1 : -1; }
            if (a.cascadeDelete !== b.cascadeDelete) { return a.cascadeDelete ? -1 : 1; }
            return a.childSObject.localeCompare(b.childSObject);
        });
    }

    /* Which auxiliary kind an object name is, by Salesforce's own suffixes. */
    function classifyAuxiliary(name) {
        if (/History$/.test(name)) { return 'History'; }
        if (/Feed$/.test(name)) { return 'Feed'; }
        if (/Share$/.test(name)) { return 'Share'; }
        if (/ChangeEvent$/.test(name)) { return 'ChangeEvent'; }
        if (/Tag$/.test(name)) { return 'Tag'; }
        return null;
    }

    /*
     * The columns worth selecting.
     *
     * Audit fields, the record's name, and every reference - because the
     * references are the edges. Deliberately not "everything": a wide object
     * has five hundred fields, and selecting them all makes a slow query whose
     * result is mostly discarded, then redacted.
     */
    function selectFields(describe, options) {
        options = options || {};
        var fields = (describe && describe.fields) || [];
        var wanted = Object.create(null);
        var available = Object.create(null);

        fields.forEach(function (field) { if (field && field.name) { available[field.name] = field; } });

        AUDIT_FIELDS.forEach(function (name) {
            if (available[name]) { wanted[name] = true; }
        });
        if (!available.Id) { wanted.Id = true; }

        var nameField = null;
        fields.forEach(function (field) {
            if (field && field.nameField) { nameField = field.name; }
        });
        ['Name', 'CaseNumber', 'OrderNumber', 'Subject', 'Title'].forEach(function (fallback) {
            if (!nameField && available[fallback]) { nameField = fallback; }
        });
        if (nameField) { wanted[nameField] = true; }

        parentLinks(describe).forEach(function (link) {
            if (available[link.field]) { wanted[link.field] = true; }
        });

        /* A status-ish column, so a node can say what state the record is in
         * without opening it. */
        ['Status', 'StageName', 'State', 'IsClosed', 'IsWon'].forEach(function (name) {
            if (available[name]) { wanted[name] = true; }
        });

        return {
            fields: Object.keys(wanted),
            nameField: nameField,
            statusField: ['Status', 'StageName', 'State'].filter(function (n) {
                return available[n];
            })[0] || null
        };
    }

    function soqlFor(objectName, selection, where, limit) {
        return 'SELECT ' + selection.fields.join(', ') +
               ' FROM ' + objectName +
               (where ? ' WHERE ' + where : '') +
               ' ORDER BY CreatedDate DESC' +
               ' LIMIT ' + (limit || 50);
    }

    /* ------------------------------------------------------------------ */
    /* Records to events                                                   */
    /* ------------------------------------------------------------------ */

    /*
     * A record becomes one node plus its changes.
     *
     * The creation is the record's node - it is the moment the thing came into
     * existence, and it is what lookups connect to. Its last modification, and
     * any tracked history, hang off it as further events, so the graph reads as
     * a tree of records rather than a tree of timestamps.
     */
    function eventsForRecord(row, spec) {
        spec = spec || {};
        var objectType = spec.objectType;
        var selection = spec.selection || {};
        var events = [];

        var name = (selection.nameField && row[selection.nameField]) || row.Id;
        var status = selection.statusField ? row[selection.statusField] : null;

        var references = [];
        (spec.parentLinks || []).forEach(function (link) {
            var value = row[link.field];
            if (!isRecordId(value)) { return; }
            references.push({
                field: link.field,
                label: link.label,
                id: value,
                masterDetail: link.masterDetail
            });
        });

        var entity = {
            type: objectType,
            id: row.Id,
            name: name
        };

        var actor = function (id, resolved) {
            if (!id) { return null; }
            return {
                kind: Model.ACTOR_KIND.USER,
                id: id,
                name: (resolved && resolved[id]) || id
            };
        };

        if (row.CreatedDate) {
            events.push({
                eventType: 'RECORD_CREATE',
                timestamp: row.CreatedDate,
                actor: actor(row.CreatedById, spec.userNames),
                source: {
                    kind: Model.PROVENANCE.SALESFORCE,
                    system: 'record',
                    detail: 'CreatedDate'
                },
                entity: entity,
                action: 'Created ' + objectType + ' ' + name,
                status: Model.STATUS.SUCCESS,
                metadata: {
                    references: references,
                    recordStatus: status,
                    depth: spec.depth || 0,
                    /* How this record was reached, which is what the edge
                     * label and the "why is this here" answer come from. */
                    reachedVia: spec.reachedVia || null,
                    isRoot: !!spec.isRoot
                }
            });
        }

        /*
         * The last change, stated as exactly that.
         *
         * Only emitted when history is not being read for this object -
         * otherwise the same edit appears twice, once as a real tracked change
         * and once as this summary of it, and the graph double-counts.
         */
        if (row.LastModifiedDate && row.LastModifiedDate !== row.CreatedDate &&
            !spec.hasHistory) {
            events.push({
                eventType: 'RECORD_UPDATE',
                timestamp: row.LastModifiedDate,
                actor: actor(row.LastModifiedById, spec.userNames),
                source: {
                    kind: Model.PROVENANCE.SALESFORCE,
                    system: 'record',
                    detail: 'LastModifiedDate'
                },
                entity: entity,
                action: 'Last changed ' + objectType + ' ' + name,
                status: Model.STATUS.SUCCESS,
                metadata: {
                    references: references,
                    isLatestOnly: true,
                    depth: spec.depth || 0
                }
            });
        }

        return events;
    }

    /*
     * Tracked field changes - the only genuine intermediate history there is.
     *
     * Where field history tracking is on, this turns "last changed on Tuesday"
     * into the actual sequence of edits, each with its own actor, timestamp,
     * old value and new value. It is the single biggest upgrade in fidelity
     * available without instrumentation, and it costs one query per object.
     */
    function eventsForHistory(rows, spec) {
        spec = spec || {};
        return (rows || []).filter(function (row) {
            if (!row || !row.CreatedDate || !row.Field) { return false; }
            /*
             * Salesforce writes a synthetic 'created' row into history on
             * insert. The record's own CreatedDate already produces that
             * event, so keeping this one gave every record two creation nodes
             * at the same instant - which then anchored half the lookup edges
             * to one and half to the other, and drew the record's relations
             * twice.
             */
            if (row.Field === 'created') { return false; }
            return true;
        }).map(function (row) {
            var parentId = row[spec.parentField] || row.ParentId;

            return {
                eventType: 'RECORD_UPDATE',
                timestamp: row.CreatedDate,
                actor: row.CreatedById
                    ? {
                        kind: Model.ACTOR_KIND.USER,
                        id: row.CreatedById,
                        name: (spec.userNames && spec.userNames[row.CreatedById]) || row.CreatedById
                    }
                    : null,
                source: {
                    kind: Model.PROVENANCE.SALESFORCE,
                    system: 'field history',
                    detail: spec.objectType || null
                },
                entity: {
                    type: spec.parentType || null,
                    id: parentId,
                    name: (spec.recordNames && spec.recordNames[parentId]) || parentId
                },
                action: 'Changed ' + row.Field +
                      (row.OldValue !== null && row.OldValue !== undefined
                          ? ': ' + describeValue(row.OldValue) + ' → ' + describeValue(row.NewValue)
                          : ''),
                status: Model.STATUS.SUCCESS,
                metadata: {
                    field: row.Field,
                    from: row.OldValue,
                    to: row.NewValue,
                    tracked: true,
                    depth: spec.depth || 0
                }
            };
        });
    }

    function describeValue(value) {
        if (value === null || value === undefined || value === '') { return 'blank'; }
        var text = String(value);
        return text.length > 40 ? text.slice(0, 39) + '…' : text;
    }

    /* ------------------------------------------------------------------ */
    /* Records to relationships                                            */
    /* ------------------------------------------------------------------ */

    /*
     * The edges: one per lookup that actually points at something in the graph.
     *
     * Every one of these is CONFIRMED, and the distinction from the rest of the
     * engine is worth stating. A correlation rule infers that two events are
     * related because of when they happened. This does not infer anything - the
     * org holds the link, in a field, and the evidence is that field's name.
     * A record graph is the only part of this engine whose edges are facts.
     */
    function relationshipsFor(events, options) {
        options = options || {};
        var byRecordId = Object.create(null);
        var relationships = [];

        /* The creation event is a record's node; everything else about that
         * record hangs off it. */
        events.forEach(function (event) {
            if (!event.entity || !event.entity.id) { return; }
            if (event.eventType !== 'RECORD_CREATE') { return; }
            var existing = byRecordId[event.entity.id];
            if (!existing || event.timestamp < existing.timestamp) {
                byRecordId[event.entity.id] = event;
            }
        });

        events.forEach(function (event) {
            if (!event.entity || !event.entity.id) { return; }
            var anchor = byRecordId[event.entity.id];

            /* A change belongs to the record it changed. */
            if (anchor && anchor.eventId !== event.eventId) {
                relationships.push({
                    sourceEventId: anchor.eventId,
                    targetEventId: event.eventId,
                    relationshipType: 'PART_OF',
                    confidence: Model.CONFIDENCE.CONFIRMED,
                    state: 'observed',
                    rule: 'recordOwnHistory',
                    evidence: [{
                        signal: 'sameRecord',
                        detail: 'This change is recorded against ' +
                                (event.entity.name || event.entity.id) + '.'
                    }]
                });
            }

            /* And a lookup is a link between two records. */
            ((event.metadata && event.metadata.references) || []).forEach(function (reference) {
                var parent = byRecordId[reference.id];
                if (!parent || !anchor) { return; }
                if (parent.eventId === anchor.eventId) { return; }

                relationships.push({
                    sourceEventId: parent.eventId,
                    targetEventId: anchor.eventId,
                    relationshipType: 'PARENT_OF',
                    confidence: Model.CONFIDENCE.CONFIRMED,
                    state: 'observed',
                    rule: 'recordLookup',
                    masterDetail: !!reference.masterDetail,
                    lookupField: reference.field,
                    evidence: [{
                        signal: 'lookupField',
                        detail: (event.entity.type || 'This record') + '.' + reference.field +
                                ' points at ' + (parent.entity.name || reference.id) +
                                (reference.masterDetail ? ' (master-detail)' : ' (lookup)') + '.'
                    }]
                });
            });
        });

        /* Dedup - an object related through two fields yields two identical
         * edges only if the field is the same, which it is not, so the key
         * includes it. */
        /*
         * One edge per pair per type. The lookup field is kept as a property
         * and named in the evidence, but deliberately not part of the id:
         * including it produced a separate edge for each field when two
         * records are related through more than one, and - more importantly -
         * meant this edge could never merge with the correlation engine's
         * entityReference edge describing the very same field.
         */
        var seen = Object.create(null);
        return relationships.filter(function (rel) {
            var key = rel.sourceEventId + '->' + rel.targetEventId + ':' + rel.relationshipType;
            if (seen[key]) { return false; }
            seen[key] = true;
            rel.relationshipId = key;
            return true;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Planning the walk                                                   */
    /* ------------------------------------------------------------------ */

    /*
     * What to fetch next, given what has been fetched.
     *
     * Returned as a plan rather than executed, so the traversal can be tested
     * without an org and so the caller decides how much of it to run. Breadth
     * first: everything one hop away before anything two hops away, because a
     * partial answer that covers the immediate neighbours is far more useful
     * than one that went deep down a single branch.
     */
    function planHop(spec) {
        spec = spec || {};
        var seen = spec.seen || Object.create(null);
        var plan = { parents: [], children: [], skipped: [] };

        /*
         * Objects the user has excluded.
         *
         * Applied here, at planning, rather than when drawing - which is the
         * whole point. Hiding an object after the fact still costs the query
         * that fetched it, and on a large Account the objects worth excluding
         * are exactly the ones that take longest to fetch: the Tasks, the
         * EmailMessages, the feed items numbering in the thousands. Excluded
         * objects are never asked for.
         */
        var excluded = Object.create(null);
        (spec.excluded || []).forEach(function (name) { excluded[name] = true; });

        /*
         * Objects the user asked for by name, exempt from the budget.
         *
         * The budget exists because a standard object can carry a hundred
         * child relationships and following them all is a hundred queries per
         * record per hop. Taking the first eight keeps that tractable, but it
         * picks them by a sort order the user did not choose - so the one
         * relationship they actually came to see could sit at position forty
         * with no way to reach it.
         *
         * Pinning is that way. A pinned object is always followed, however
         * long the list, and the budget then applies to whatever is left.
         * Exclusion still wins: naming something explicitly to remove it is a
         * stronger statement than naming it to keep it.
         */
        var pinned = Object.create(null);
        (spec.included || []).forEach(function (name) {
            if (!excluded[name]) { pinned[name] = true; }
        });

        function skip(objectName, reason, via) {
            plan.skipped.push({ objectName: objectName, reason: reason, via: via || null });
        }

        (spec.records || []).forEach(function (entry) {
            var row = entry.row;
            var describe = entry.describe;
            if (!row || !describe) { return; }

            parentLinks(describe).forEach(function (link) {
                var value = row[link.field];
                if (!isRecordId(value) || seen[value]) { return; }
                /*
                 * A polymorphic field names several possible objects and the
                 * id says which. Resolving it from the prefix map is the only
                 * correct answer - guessing referenceTo[0] would query the
                 * wrong object for every Task whose WhatId is an Opportunity.
                 */
                var objectName = link.polymorphic
                    ? objectForId(value, spec.prefixMap)
                    : link.referenceTo[0];
                if (!objectName) { return; }
                if (excluded[objectName]) { skip(objectName, 'excluded', link.field); return; }

                plan.parents.push({
                    objectName: objectName,
                    recordId: value,
                    via: { field: link.field, label: link.label, direction: 'parent',
                           from: row.Id, masterDetail: link.masterDetail }
                });
            });

            /*
             * The cap is applied after exclusions, not before.
             *
             * Taking the first eight relationships and then dropping the
             * excluded ones meant excluding a noisy object did not make room
             * for anything else - the graph just got smaller. Excluding first
             * means the budget is spent on relationships the user wants.
             */
            var candidates = childLinks(describe).filter(function (link) {
                if (excluded[link.childSObject]) {
                    skip(link.childSObject, 'excluded', link.relationshipName);
                    return false;
                }
                return true;
            });

            /* Pinned first and in full; the budget then covers the remainder. */
            var wanted = candidates.filter(function (link) { return pinned[link.childSObject]; });
            var rest = candidates.filter(function (link) { return !pinned[link.childSObject]; });
            var budget = spec.maxChildRelations === undefined ? 8 : spec.maxChildRelations;
            var followed = wanted.concat(budget < 0 ? rest : rest.slice(0, budget));

            followed.forEach(function (link) {
                plan.children.push({
                    objectName: link.childSObject,
                    parentId: row.Id,
                    field: link.field,
                    isHistory: link.isHistory,
                    pinned: !!pinned[link.childSObject],
                    via: { field: link.field, label: link.relationshipName,
                           direction: 'child', from: row.Id }
                });
            });

            /* Relationships that fell off the end of the budget, so the panel
             * can say the graph is partial rather than implying it is whole -
             * and so each one can be pinned. */
            if (budget >= 0) {
                rest.slice(budget).forEach(function (link) {
                    skip(link.childSObject, 'budget', link.relationshipName);
                });
            }
        });

        return plan;
    }

    /* ------------------------------------------------------------------ */
    /* What is in the graph                                                */
    /* ------------------------------------------------------------------ */

    /*
     * The objects present, with counts - which is what makes excluding them
     * a decision rather than a guess.
     *
     * Deliberately derived from the events themselves rather than from a list
     * of "usually noisy" objects. Which objects overwhelm a graph is a fact
     * about this org and this record: an org that runs on Tasks needs them,
     * and one that keeps a million EmailMessages against every Case does not.
     * A hardcoded table would be wrong for somebody on their first trace.
     */
    function inventory(events, options) {
        options = options || {};
        var excluded = Object.create(null);
        (options.excluded || []).forEach(function (name) { excluded[name] = true; });

        var byType = Object.create(null);

        (events || []).forEach(function (event) {
            var type = event.entity && event.entity.type;
            if (!type) { return; }
            if (!byType[type]) {
                byType[type] = {
                    name: type, records: Object.create(null), events: 0,
                    changes: 0, depth: null, excluded: !!excluded[type]
                };
            }
            var entry = byType[type];
            entry.events++;
            if (event.entity.id) { entry.records[event.entity.id] = true; }
            if (event.eventType === 'RECORD_UPDATE') { entry.changes++; }

            var depth = event.metadata && event.metadata.depth;
            if (typeof depth === 'number' && (entry.depth === null || depth < entry.depth)) {
                entry.depth = depth;
            }
        });

        /* Objects excluded before the walk contribute nothing, so they would
         * not appear at all - and an exclusion you cannot see is one you
         * cannot undo. They are listed with a zero count. */
        Object.keys(excluded).forEach(function (name) {
            if (byType[name]) { return; }
            byType[name] = { name: name, records: {}, events: 0, changes: 0,
                             depth: null, excluded: true };
        });

        return Object.keys(byType).map(function (name) {
            var entry = byType[name];
            return {
                name: name,
                count: Object.keys(entry.records).length,
                events: entry.events,
                changes: entry.changes,
                depth: entry.depth,
                excluded: entry.excluded
            };
        }).sort(function (a, b) {
            /* Busiest first: the object worth excluding is the one filling the
             * graph, and it should not need hunting for. */
            if (a.excluded !== b.excluded) { return a.excluded ? 1 : -1; }
            if (b.count !== a.count) { return b.count - a.count; }
            return a.name.localeCompare(b.name);
        });
    }

    var api = {
        AUDIT_FIELDS: AUDIT_FIELDS,
        buildPrefixMap: buildPrefixMap,
        objectForId: objectForId,
        isRecordId: isRecordId,
        classifyAuxiliary: classifyAuxiliary,
        parentLinks: parentLinks,
        childLinks: childLinks,
        selectFields: selectFields,
        soqlFor: soqlFor,
        eventsForRecord: eventsForRecord,
        eventsForHistory: eventsForHistory,
        relationshipsFor: relationshipsFor,
        planHop: planHop,
        inventory: inventory,
        describeValue: describeValue
    };

    root.SSRecordGraph = api;
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof self !== 'undefined' ? self : this);
