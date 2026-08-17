/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * SchemaService - the org's actual schema, cached.
 *
 * Every "sObject type 'X' is not supported" and "No such column 'Name' on
 * entity 'X'" error this extension has ever shown came from the same place:
 * queries were assembled from hand-maintained guess lists (everything has
 * Name, everything has LastModifiedBy, these 30 objects are Tooling-only)
 * instead of from what the org actually reports.
 *
 * This service replaces the guessing with three facts, fetched from the org:
 *
 *   1. Which objects the REST API can query      (/sobjects)
 *   2. Which objects the Tooling API can query   (/tooling/sobjects)
 *   3. For a given object, its real fields       (/sobjects/X/describe)
 *
 * (1) and (2) are two requests for the whole org and settle routing
 * definitively - no more falling back to an endpoint that was never going to
 * work. (3) is fetched lazily, only for objects the user actually opens, and
 * is what turns "SELECT Name FROM Task" into "SELECT Subject FROM Task".
 *
 * Deliberately depends only on $http/$q, never on the sfdc service, so that
 * sfdc can depend on this one without a circular injection.
 */
var app = window.app || angular.module("SalesforceSimplifiedApp");
app.service('SchemaService', ['$http', '$q', '$timeout', function($http, $q, $timeout) {

    var self = this;

    /*
     * Bumped with the digest shape. A v1 cache has no field types, and a
     * column picker that reads them would quietly fall back to four columns
     * for every object until the TTL happened to expire.
     */
    var CACHE_KEY      = 'SFDCSimplified_schema_v2';
    var GLOBAL_TTL_MS  = 24 * 60 * 60 * 1000;  // global describe: a day
    var OBJECT_TTL_MS  = 24 * 60 * 60 * 1000;  // per-object describe: a day
    var MAX_CACHED     = 250;                  // per-object digests kept on disk
    var REQUEST_TIMEOUT = 15000;

    var _rest    = null;   // name -> { queryable, label, keyPrefix, custom, ... }
    var _tooling = null;   // name -> { queryable, label }
    var _digests = Object.create(null);        // name -> digest (in-memory)
    var _inflight = Object.create(null);       // name -> promise
    var _readyPromise = null;
    var _dirty = false;

    /*
     * name -> 'rest' | 'tooling', for objects where the API that actually
     * answered is not the one routing would have guessed.
     *
     * This lives here rather than in the query engine because describe() has
     * the same problem queries do: FlexiPage is listed in the REST catalogue
     * but only Tooling will serve it, so a first attempt on REST is wasted.
     * Keeping the memory next to the routing means one place learns it and
     * both the describe and the query benefit, on this page load and every
     * later one.
     */
    var _endpoints = Object.create(null);

    /* ------------------------------------------------------------------ */
    /* Field-name preferences                                              */
    /* ------------------------------------------------------------------ */

    // Consulted only when describe reports no nameField, which happens on a
    // number of setup/junction objects. Order matters: most specific first.
    var DISPLAY_FALLBACKS = [
        'DeveloperName', 'MasterLabel', 'QualifiedApiName', 'FullName',
        'Name', 'Label', 'Title', 'Subject', 'DomainName', 'FriendlyName',
        'ValidationName', 'CaseNumber', 'ContractNumber', 'OrderNumber',
        'SolutionNumber', 'Operation'
    ];

    // Preference order for ORDER BY. A list the user opens is nearly always
    // most-useful newest-first, but plenty of setup objects have no audit
    // dates at all and sorting by them is a MALFORMED_QUERY.
    var ORDER_PREFERENCES = ['LastModifiedDate', 'CreatedDate', 'SystemModstamp'];

    /* ------------------------------------------------------------------ */
    /* Disk cache                                                          */
    /* ------------------------------------------------------------------ */

    function loadCache() {
        try {
            var raw = localStorage.getItem(CACHE_KEY);
            if (!raw) { return null; }
            var parsed = JSON.parse(raw);
            // A cache written against a different org is worse than none.
            if (!parsed || parsed.origin !== SS_ORIGIN) { return null; }
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function saveCache() {
        if (!_dirty) { return; }
        _dirty = false;
        try {
            var objects = _digests;
            var names = Object.keys(objects);
            // Keep the cache bounded; evict the least recently described.
            if (names.length > MAX_CACHED) {
                names.sort(function(a, b) {
                    return (objects[b].ts || 0) - (objects[a].ts || 0);
                });
                var trimmed = Object.create(null);
                for (var i = 0; i < MAX_CACHED; i++) {
                    trimmed[names[i]] = objects[names[i]];
                }
                objects = trimmed;
            }
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                origin:    SS_ORIGIN,
                ts:        Date.now(),
                rest:      _rest,
                tooling:   _tooling,
                objects:   objects,
                endpoints: _endpoints
            }));
        } catch (e) {
            // Quota exceeded or storage disabled: drop the cache and keep
            // serving from memory rather than failing the query.
            try { localStorage.removeItem(CACHE_KEY); } catch (e2) {}
        }
    }

    // Writing on every describe would serialise the whole cache each time.
    var _saveTimer = null;
    function scheduleSave() {
        _dirty = true;
        if (_saveTimer) { return; }
        _saveTimer = $timeout(function() {
            _saveTimer = null;
            saveCache();
        }, 1500, false);
    }

    /*
     * A debounce that never fires is a cache that never persists. Navigating
     * within the debounce window - which is most navigations in Salesforce -
     * would otherwise throw away everything learned on that page, and the next
     * one would rediscover it from scratch. pagehide covers the back/forward
     * cache too, which unload does not.
     */
    // Guarded so the service is constructible without a DOM, as in the tests.
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('pagehide', function() {
            if (_saveTimer) { $timeout.cancel(_saveTimer); _saveTimer = null; }
            saveCache();
        });
    }

    /* ------------------------------------------------------------------ */
    /* HTTP                                                                */
    /* ------------------------------------------------------------------ */

    function get(url) {
        return $q.when(ssAuthReady()).then(function() {
            var sid = ssSessionId();
            if (!sid) { return $q.reject({ noSession: true }); }
            return $http({
                url: url,
                method: 'GET',
                timeout: REQUEST_TIMEOUT,
                headers: { 'Authorization': 'Bearer ' + sid }
            }).then(function(res) { return res.data; }, function(rej) {
                // Same as SfdcApi, and for the same reason a describe must go
                // through the confirmation rather than act on the reply: a
                // Tooling describe refuses on session grounds routinely
                // without the session being gone.
                ssSessionRejected(rej);
                return $q.reject(rej);
            });
        });
    }

    function indexGlobalDescribe(data) {
        var map = Object.create(null);
        if (data && data.sobjects && data.sobjects.length) {
            for (var i = 0; i < data.sobjects.length; i++) {
                var o = data.sobjects[i];
                if (!o || !o.name) { continue; }
                map[o.name] = {
                    name:          o.name,
                    label:         o.label,
                    labelPlural:   o.labelPlural,
                    keyPrefix:     o.keyPrefix,
                    custom:        !!o.custom,
                    queryable:     !!o.queryable,
                    retrieveable:  !!o.retrieveable,
                    customSetting: !!o.customSetting,
                    /*
                     * Salesforce's own answers about what a thing is.
                     *
                     * deprecatedAndHidden marks objects it considers internal.
                     * associateEntityType is set on the auxiliary objects it
                     * generates alongside a real one - History, Feed, Share,
                     * ChangeEvent - and names which kind, with
                     * associateParentEntity naming the object they belong to.
                     *
                     * Kept because the alternative is guessing the same facts
                     * from name suffixes, which only works for as long as
                     * Salesforce keeps naming things the way it does today.
                     */
                    deprecatedAndHidden:   !!o.deprecatedAndHidden,
                    associateEntityType:   o.associateEntityType || null,
                    associateParentEntity: o.associateParentEntity || null,
                    createable:    !!o.createable,
                    updateable:    !!o.updateable
                };
            }
        }
        return map;
    }

    /* ------------------------------------------------------------------ */
    /* Global describes                                                    */
    /* ------------------------------------------------------------------ */

    /*
     * Resolves once both global describes are known. Never rejects: an org
     * that denies the Tooling API still gets a fully working REST path.
     */
    this.ready = function() {
        if (_readyPromise) { return _readyPromise; }

        var cached = loadCache();
        /*
         * An empty catalogue is a failure, not an answer.
         *
         * The test used to be `cached.rest`, and `{}` is truthy - so a run
         * where the global describe failed wrote an empty catalogue to disk
         * and every page load for the next day served it back without asking
         * the org again. The menu was left with only its built-in entries and
         * nothing said why, which is what a half-working extension looks like:
         * signed in, queries working, and no metadata in the list.
         */
        if (cached && cached.ts && (Date.now() - cached.ts < GLOBAL_TTL_MS) &&
            cached.rest && Object.keys(cached.rest).length) {
            _rest      = cached.rest;
            _tooling   = cached.tooling || Object.create(null);
            _digests   = cached.objects || Object.create(null);
            _endpoints = cached.endpoints || Object.create(null);
            _readyPromise = $q.when(true);
            return _readyPromise;
        }

        // A stale cache still has usable per-object digests, and the endpoint
        // memory does not go stale the way a field list does - an object that
        // only Tooling will serve stays that way. Keep both and let each
        // digest age out on its own TTL.
        if (cached) {
            if (cached.objects)   { _digests   = cached.objects; }
            if (cached.endpoints) { _endpoints = cached.endpoints; }
        }

        _readyPromise = $q.all([
            get(ssSobjectsUrl()).then(indexGlobalDescribe, function() { return null; }),
            get(ssToolingSobjectsUrl()).then(indexGlobalDescribe, function() { return null; })
        ]).then(function(results) {
            _rest    = results[0] || Object.create(null);
            _tooling = results[1] || Object.create(null);

            /*
             * Only a catalogue with something in it is worth keeping, and only
             * one worth keeping is worth remembering.
             *
             * Both describes are individually forgiving - each maps its own
             * failure to null - so a total failure arrives here looking like a
             * perfectly good answer of "this org has no objects". Writing that
             * to the cache made it durable, and memoising _readyPromise made
             * it final for the rest of the page: every later caller got the
             * same empty catalogue back without a request going out. Clearing
             * the promise lets the next menu open try again, which is what
             * makes a transient failure transient.
             */
            if (!Object.keys(_rest).length && !Object.keys(_tooling).length) {
                _readyPromise = null;
                return false;
            }

            scheduleSave();
            return true;
        }, function(error) {
            // Nothing above should reject, but a memoised rejected promise
            // would poison every later call, so it is not left to chance.
            _readyPromise = null;
            throw error;
        });

        return _readyPromise;
    };

    this.globalDescribe = function() {
        return self.ready().then(function() { return _rest || Object.create(null); });
    };

    /*
     * The Tooling catalogue. The developer metadata types live only here -
     * LightningComponentBundle, AuraDefinitionBundle, CustomField,
     * CustomObject, WorkflowRule, ValidationRule, Layout, FlexiPage - so a
     * menu built from the REST catalogue alone cannot show any of them.
     */
    this.toolingDescribe = function() {
        return self.ready().then(function() { return _tooling || Object.create(null); });
    };

    // Synchronous accessors, meaningful only after ready() has resolved.
    this.describeInfo = function(name) {
        return (_rest && _rest[name]) || (_tooling && _tooling[name]) || null;
    };

    function restCanQuery(name) {
        return !!(_rest && _rest[name] && _rest[name].queryable);
    }

    function toolingCanQuery(name) {
        return !!(_tooling && _tooling[name] && _tooling[name].queryable);
    }

    this.restCanQuery    = restCanQuery;
    this.toolingCanQuery = toolingCanQuery;

    /*
     * Whether the org's catalogues actually loaded. Callers must check this
     * before treating "not in the catalogue" as "does not exist": an org that
     * blocks or fails the global describe would otherwise look like an org
     * with no objects in it, and every query would be refused before it was
     * ever tried.
     */
    this.catalogueKnown = function() {
        return !!((_rest && Object.keys(_rest).length) ||
                  (_tooling && Object.keys(_tooling).length));
    };

    /*
     * Decides which API can actually serve an object.
     *
     * `hint` is what the caller believes ('rest' or 'tooling') - usually from
     * a hand-written spec's url. It is honoured only when the org agrees; a
     * spec that pins Tooling for an object the Tooling API has never heard of
     * gets silently corrected instead of producing "type is not supported".
     *
     * Returns 'rest', 'tooling', or null when neither API can query it - and
     * null is a real answer, not an error: it means don't send the request.
     */
    this.route = function(name, hint) {
        if (!name) { return hint || 'rest'; }

        var knowRest    = !!(_rest && Object.keys(_rest).length);
        var knowTooling = !!(_tooling && Object.keys(_tooling).length);

        // Schema not loaded yet - trust the caller rather than block.
        if (!knowRest && !knowTooling) { return _endpoints[name] || hint || 'rest'; }

        /*
         * Evidence outranks the caller's guess. If an earlier request proved
         * which API serves this object, go straight there: the hint is what a
         * hand-written spec assumed, this is what actually worked.
         */
        var learned = _endpoints[name];
        if (learned === 'tooling' && toolingCanQuery(name)) { return 'tooling'; }
        if (learned === 'rest'    && restCanQuery(name))    { return 'rest'; }

        if (hint === 'tooling' && toolingCanQuery(name)) { return 'tooling'; }
        if (hint === 'rest'    && restCanQuery(name))    { return 'rest'; }

        if (restCanQuery(name))    { return 'rest'; }
        if (toolingCanQuery(name)) { return 'tooling'; }

        // Present but explicitly not queryable, or absent from both catalogues.
        if (knowRest && knowTooling) { return null; }

        return hint || 'rest';
    };

    this.queryUrlFor = function(endpoint) {
        return endpoint === 'tooling' ? ssToolingQueryUrl() : ssQueryUrl();
    };

    /*
     * Records which API actually served an object, so the next request - this
     * page load or next week - skips the one that does not. Called on every
     * success, and a no-op when nothing changed, so it costs nothing to call
     * from the hot path.
     */
    this.rememberEndpoint = function(name, endpoint) {
        if (!name || !endpoint || _endpoints[name] === endpoint) { return; }
        _endpoints[name] = endpoint;
        scheduleSave();
    };

    this.knownEndpoint = function(name) {
        return _endpoints[name] || null;
    };

    /* ------------------------------------------------------------------ */
    /* Per-object describe                                                 */
    /* ------------------------------------------------------------------ */

    /*
     * Audit and plumbing columns. Never a record's label, and present on
     * almost every object, so they have to be excluded before the last-resort
     * scan below or every such object would be titled by its created date.
     */
    var SYSTEM_FIELDS = {
        'Id': true, 'IsDeleted': true, 'OwnerId': true,
        'CreatedById': true, 'CreatedDate': true,
        'LastModifiedById': true, 'LastModifiedDate': true,
        'SystemModstamp': true, 'LastViewedDate': true,
        'LastReferencedDate': true, 'LastActivityDate': true,
        'NamespacePrefix': true, 'ManageableState': true,
        'IsActive': true, 'IsDeprecated': true
    };

    function pickDisplayField(fields, fieldSet) {
        // describe marks exactly one field as the record's name; trust it.
        for (var i = 0; i < fields.length; i++) {
            if (fields[i] && fields[i].nameField) { return fields[i].name; }
        }
        for (var j = 0; j < DISPLAY_FALLBACKS.length; j++) {
            if (fieldSet[DISPLAY_FALLBACKS[j]]) { return DISPLAY_FALLBACKS[j]; }
        }

        /*
         * Some objects have no name-ish column at all - ApexOrgWideCoverage
         * carries nothing but PercentCovered. Falling straight through to Id
         * meant the query selected only Id and the row rendered as a checkbox
         * beside an empty cell, so take the first column that actually carries
         * information instead.
         */
        for (var k = 0; k < fields.length; k++) {
            var field = fields[k];
            if (!field || !field.name || SYSTEM_FIELDS[field.name]) { continue; }
            // References render as raw ids, which is no more use than Id was.
            if (field.type === 'reference' || field.type === 'id') { continue; }
            if (field.name.slice(-2) === 'Id') { continue; }
            return field.name;
        }

        return 'Id';
    }

    function pickOrderField(sortable, displayField) {
        for (var i = 0; i < ORDER_PREFERENCES.length; i++) {
            if (sortable[ORDER_PREFERENCES[i]]) { return ORDER_PREFERENCES[i]; }
        }
        if (displayField !== 'Id' && sortable[displayField]) { return displayField; }
        return null;
    }

    function buildDigest(name, endpoint, payload) {
        var fields   = (payload && payload.fields) || [];
        var fieldSet = Object.create(null);
        var sortable = Object.create(null);
        var filterable = Object.create(null);
        var rels     = Object.create(null);

        /*
         * Types and labels are kept as well as names.
         *
         * Columns used to be chosen from hand-written tables, so the digest
         * only had to answer "does this field exist". Choosing them from the
         * describe instead needs to know what a field *is*: a textarea holding
         * an Apex body and a picklist holding a status are both "a field the
         * object has", and only one of them belongs in a grid.
         */
        var types    = Object.create(null);
        var labels   = Object.create(null);

        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            if (!f || !f.name) { continue; }
            fieldSet[f.name] = true;
            types[f.name]  = f.type || '';
            labels[f.name] = f.label || f.name;
            if (f.sortable)   { sortable[f.name] = true; }
            if (f.filterable) { filterable[f.name] = true; }
            // relationshipName is what a dotted path like LastModifiedBy.Name
            // resolves against. Absent it, the path is a guaranteed error.
            if (f.relationshipName) { rels[f.relationshipName] = true; }
        }

        var displayField = pickDisplayField(fields, fieldSet);

        return {
            name:         name,
            endpoint:     endpoint,
            ts:           Date.now(),
            label:        (payload && payload.label) || name,
            keyPrefix:    (payload && payload.keyPrefix) || '',
            custom:       !!(payload && payload.custom),
            queryable:    payload ? payload.queryable !== false : true,
            displayField: displayField,
            orderField:   pickOrderField(sortable, displayField),
            fields:       fieldSet,
            types:        types,
            labels:       labels,
            sortable:     sortable,
            filterable:   filterable,
            rels:         rels
        };
    }

    // A digest we could not fetch. Recorded so a failing describe is not
    // retried on every keystroke, but marked so callers stay conservative.
    function unknownDigest(name, endpoint) {
        return {
            name: name, endpoint: endpoint, ts: Date.now(), partial: true,
            label: name, keyPrefix: '', custom: false, queryable: true,
            displayField: null, orderField: null,
            fields: null, sortable: null, filterable: null, rels: null
        };
    }

    function isFresh(digest) {
        return digest && digest.ts && (Date.now() - digest.ts < OBJECT_TTL_MS);
    }

    /*
     * describe(name) -> promise(digest)
     *
     * Never rejects. On failure it resolves a `partial` digest, and callers
     * treat a partial digest as "no schema knowledge" and fall back to their
     * own defaults rather than asserting a field does not exist.
     */
    this.describe = function(name) {
        if (!name) { return $q.when(null); }

        var cached = _digests[name];
        if (isFresh(cached)) { return $q.when(cached); }
        if (_inflight[name]) { return _inflight[name]; }

        var promise = self.ready().then(function() {
            var endpoint = self.route(name);
            if (!endpoint) {
                var dead = unknownDigest(name, null);
                dead.queryable = false;
                return dead;
            }
            var url = endpoint === 'tooling' ? ssToolingDescribeUrl(name) : ssDescribeUrl(name);
            return get(url).then(function(payload) {
                return buildDigest(name, endpoint, payload);
            }, function() {
                // Describe can be denied by FLS/permissions even when query
                // works. Try the other endpoint once before giving up.
                var other = endpoint === 'tooling' ? 'rest' : 'tooling';
                var otherOk = other === 'tooling' ? toolingCanQuery(name) : restCanQuery(name);
                if (!otherOk) { return unknownDigest(name, endpoint); }
                var otherUrl = other === 'tooling' ? ssToolingDescribeUrl(name) : ssDescribeUrl(name);
                return get(otherUrl).then(function(payload) {
                    return buildDigest(name, other, payload);
                }, function() {
                    return unknownDigest(name, endpoint);
                });
            });
        }).then(function(digest) {
            _digests[name] = digest;
            delete _inflight[name];
            scheduleSave();
            return digest;
        }, function() {
            delete _inflight[name];
            var fallback = unknownDigest(name, null);
            _digests[name] = fallback;
            return fallback;
        });

        _inflight[name] = promise;
        return promise;
    };

    // Cached digest without triggering a fetch, or null.
    this.digestSync = function(name) {
        var d = _digests[name];
        return isFresh(d) ? d : null;
    };

    /* ------------------------------------------------------------------ */
    /* Field questions the query builder asks                              */
    /* ------------------------------------------------------------------ */

    // For a partial digest every answer is "maybe", expressed as true, so the
    // builder keeps its existing behaviour instead of stripping real fields.
    this.hasField = function(digest, field) {
        if (!digest || !digest.fields) { return true; }
        return !!digest.fields[field];
    };

    this.hasRelationship = function(digest, rel) {
        if (!digest || !digest.rels) { return true; }
        return !!digest.rels[rel];
    };

    this.canSort = function(digest, field) {
        if (!digest || !digest.sortable) { return true; }
        return !!digest.sortable[field];
    };

    this.canFilter = function(digest, field) {
        if (!digest || !digest.filterable) { return true; }
        return !!digest.filterable[field];
    };

    // The field to show as the record's title. Falls back to the caller's
    // preference when schema is unavailable.
    /* ------------------------------------------------------------------ */
    /* Columns worth showing                                               */
    /*                                                                     */
    /* Every list used to select the same four things - Id, the name        */
    /* column, NamespacePrefix, LastModifiedBy - whatever the object was.   */
    /* That is right for none of them: a Flow row and a Debug Log row and a */
    /* custom object's rows all carry different information, and showing    */
    /* the same four columns for all three means most of the grid is blank  */
    /* and the useful part is missing.                                      */
    /*                                                                     */
    /* Chosen from the describe rather than from a table per object, so a   */
    /* type nobody anticipated gets sensible columns without anyone         */
    /* remembering to add it.                                              */
    /* ------------------------------------------------------------------ */

    /*
     * What cannot go in a grid cell.
     *
     * textarea and base64 hold Apex bodies, Visualforce markup and static
     * resource blobs - selecting one costs the whole source of every row in
     * the page. address and location are compound values that render as
     * [object Object]. The rest simply have nothing to show.
     */
    var UNRENDERABLE_TYPES = {
        'textarea': true, 'base64': true, 'address': true, 'location': true,
        'anyType': true, 'encryptedstring': true, 'complexvalue': true,
        'json': true, 'blob': true
    };

    /*
     * Tooling objects carry these, and they are not ordinary fields: querying
     * Metadata or FullName alongside anything else is rejected outright, and
     * the query fails rather than returning a heavy row. Named rather than
     * typed because describe reports them as ordinary strings.
     */
    var NEVER_SELECT = {
        'Metadata': true, 'FullName': true, 'Body': true, 'Markup': true,
        'SymbolTable': true, 'Source': true, 'ContentBlob': true
    };

    /*
     * Deliberately not SYSTEM_FIELDS, which exists to stop a system column
     * being used as a record's *label* - a different question with a different
     * answer. LastModifiedDate is a poor name for a row and the single most
     * useful column on a metadata list; IsActive likewise. Excluded here are
     * only the ones that carry nothing a reader wants: bookkeeping flags, raw
     * owner and author ids, and the two "when did I last look at this"
     * timestamps that say nothing about the record.
     */
    var NOT_A_COLUMN = {
        'Id': true, 'IsDeleted': true, 'OwnerId': true,
        'CreatedById': true, 'LastModifiedById': true,
        'SystemModstamp': true, 'LastViewedDate': true,
        'LastReferencedDate': true, 'ManageableState': true,
        'NamespacePrefix': true
    };

    // Ranked by how much a row is worth reading for. Dates first because a
    // metadata list is nearly always "what changed lately".
    var TYPE_RANK = {
        'datetime': 1, 'date': 1,
        'picklist': 2, 'multipicklist': 2, 'combobox': 2,
        'boolean': 3,
        'string': 4, 'email': 4, 'phone': 4, 'url': 4,
        'int': 5, 'double': 5, 'currency': 5, 'percent': 5, 'long': 5
    };

    /*
     * A column heading a person can read.
     *
     * describe usually supplies a proper label - "Api Version" - but plenty of
     * Tooling objects return the API name in that slot, so the heading came
     * out "LengthWithoutComments". Split on the case boundary when the label
     * is missing or is just the field name again, and fix the acronyms that
     * otherwise read as typos.
     *
     * A label the org actually wrote is left exactly as written: it is the
     * admin's own wording for that field, and second-guessing it would rename
     * their columns.
     */
    var HEADING_ACRONYMS = { 'Api': 'API', 'Id': 'ID', 'Url': 'URL', 'Mb': 'MB',
                             'Kb': 'KB', 'Xml': 'XML', 'Html': 'HTML', 'Sms': 'SMS',
                             'Cpu': 'CPU', 'Ip': 'IP' };

    function headingFor(name, label) {
        var text = (label && label !== name) ? label : String(name)
            .replace(/__c$|__r$/i, '')
            .replace(/_/g, ' ')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2');

        return text.split(' ')
            .map(function(word) { return HEADING_ACRONYMS[word] || word; })
            .join(' ')
            .trim();
    }
    this.headingFor = headingFor;

    this.columnsFor = function(digest, max) {
        var limit = max || 3;
        if (!digest || !digest.fields || !digest.types) { return []; }

        var display = digest.displayField;
        var candidates = [];

        Object.keys(digest.fields).forEach(function(name) {
            if (name === 'Id' || name === display) { return; }
            if (NEVER_SELECT[name]) { return; }
            if (NOT_A_COLUMN[name]) { return; }

            var type = digest.types[name] || '';
            if (UNRENDERABLE_TYPES[type]) { return; }
            // A raw 18-character id is not information; the relationship that
            // resolves it to a name is handled separately.
            if (type === 'reference' || type === 'id') { return; }
            if (name.length > 2 && name.slice(-2) === 'Id') { return; }

            var rank = TYPE_RANK[type];
            if (!rank) { return; }

            candidates.push({
                field: name,
                label: headingFor(name, digest.labels && digest.labels[name]),
                type: type,
                rank: rank
            });
        });

        /*
         * Created and modified lead, because "when did this last move" is what
         * a metadata list is read for. Named explicitly rather than left to the
         * type ranking: plenty of objects carry other dates - a close date, an
         * expiry - and by type alone those sort level with the audit ones and
         * can take both slots.
         */
        var DATE_PREFERENCE = { 'CreatedDate': 1, 'LastModifiedDate': 2 };

        candidates.sort(function(a, b) {
            if (a.rank !== b.rank) { return a.rank - b.rank; }
            var preferA = DATE_PREFERENCE[a.field] || 99;
            var preferB = DATE_PREFERENCE[b.field] || 99;
            if (preferA !== preferB) { return preferA - preferB; }
            return a.field.localeCompare(b.field);
        });

        /*
         * At most two date columns.
         *
         * Without this a custom object with three or four dates fills every
         * slot with timestamps and never reaches the one column that says what
         * state a row is in - which is the column people actually scan for.
         * Two is created and modified; anything else waits its turn.
         */
        var MAX_DATE_COLUMNS = 2;
        var dates = 0;
        var chosen = [];

        candidates.forEach(function(candidate) {
            if (chosen.length >= limit) { return; }
            var isDate = candidate.type === 'date' || candidate.type === 'datetime';
            if (isDate && dates >= MAX_DATE_COLUMNS) { return; }
            if (isDate) { dates++; }
            chosen.push(candidate);
        });

        return chosen;
    };

    this.displayFieldOf = function(digest, preferred) {
        if (digest && digest.displayField) { return digest.displayField; }
        return preferred || 'Name';
    };

    this.forget = function(name) {
        if (name) {
            delete _digests[name];
            delete _endpoints[name];
        } else {
            _digests   = Object.create(null);
            _endpoints = Object.create(null);
        }
        scheduleSave();
    };
}]);
