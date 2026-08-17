/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * SfdcApi - self-correcting SOQL query engine for Salesforce Simplified.
 *
 * The engine assumes it will get queries slightly wrong, because across an
 * arbitrary org it always will: objects differ in whether they have Name or
 * DeveloperName or Subject, whether LastModifiedBy is traversable, whether
 * audit dates are sortable, and which of the two query APIs will serve them.
 * So a request goes through:
 *
 *   1. ROUTE      Ask SchemaService which API can actually query the object.
 *                 A spec that pins the wrong endpoint is corrected, and an
 *                 object neither API can query is never requested at all.
 *
 *   2. PREFLIGHT  Drop fields, relationships and ORDER BY terms the object's
 *                 describe says it does not have, plus any already learned to
 *                 be unsupported here - this session or a previous one.
 *
 *   3. REPAIR     On a Salesforce field/relationship/sort error, read what the
 *                 error names, remove exactly that, and retry. Bounded, and
 *                 each repair is remembered so the same object never pays for
 *                 the same mistake twice.
 *
 * The error surfaced to the user is always the FIRST failure, not the last, so
 * a missing Name column on Task reads as a missing column - not as
 * "sObject type 'Task' is not supported", which is what the recovery attempt
 * against the wrong API used to report.
 *
 * Every request also carries a real 15s timeout and is cancellable; the UI
 * runs two queries at once, so cancellation tracks all of them, not the last.
 */
var app = window.app || angular.module("SalesforceSimplifiedApp");
app.service('sfdc', ['$http', '$q', '$timeout', 'SchemaService',
            function($http, $q, $timeout, SchemaService) {

    var self = this;

    var NO_SESSION  = 'Unable to fetch session id.';
    var TIMEOUT_MS  = 15000;
    var MAX_REPAIRS = 4;
    var LEARNED_KEY = 'SFDCSimplified_soqlLearned_v1';
    var LEARNED_TTL = 7 * 24 * 60 * 60 * 1000;

    /* ------------------------------------------------------------------ */
    /* Learned schema corrections                                          */
    /*                                                                     */
    /* Keyed by object rather than by query text, so a correction learned  */
    /* while listing records still applies when the user searches, sorts   */
    /* or pages - the query string differs every time, the schema doesn't. */
    /* ------------------------------------------------------------------ */

    var learned = { fields: {}, rels: {}, noOrder: {}, dead: {} };

    (function loadLearned() {
        try {
            var raw = localStorage.getItem(LEARNED_KEY);
            if (!raw) { return; }
            var parsed = JSON.parse(raw);
            if (!parsed || parsed.origin !== SS_ORIGIN) { return; }
            // A correction is only as good as the schema it was learned from;
            // expire weekly so a fixed org is not penalised forever.
            if (!parsed.ts || (Date.now() - parsed.ts > LEARNED_TTL)) { return; }
            learned.fields   = parsed.fields   || {};
            learned.rels     = parsed.rels     || {};
            learned.noOrder  = parsed.noOrder  || {};
            learned.dead     = parsed.dead     || {};
        } catch (e) {}
    })();

    // Debounced through $timeout rather than the ambient setTimeout: repairs
    // arrive in bursts, and serialising the whole table for each one is waste.
    var _saveTimer = null;

    function writeLearned() {
        try {
            localStorage.setItem(LEARNED_KEY, JSON.stringify({
                origin: SS_ORIGIN, ts: Date.now(),
                fields: learned.fields, rels: learned.rels,
                noOrder: learned.noOrder, dead: learned.dead
            }));
        } catch (e) {}
    }

    function saveLearned() {
        if (_saveTimer) { return; }
        _saveTimer = $timeout(function() {
            _saveTimer = null;
            writeLearned();
        }, 1500, false);
    }

    // Repairs learned on a page the user then navigates away from would
    // otherwise be discarded inside the debounce window, and rediscovered -
    // at the cost of a failed request each - on the very next page.
    // Guarded so the service is constructible without a DOM, as in the tests.
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('pagehide', function() {
            if (_saveTimer) { $timeout.cancel(_saveTimer); _saveTimer = null; }
            writeLearned();
        });
    }

    function remember(bucket, obj, key) {
        if (!obj) { return; }
        if (key === undefined) {
            learned[bucket][obj] = true;
        } else {
            if (!learned[bucket][obj]) { learned[bucket][obj] = {}; }
            learned[bucket][obj][key] = true;
        }
        saveLearned();
    }

    /*
     * Objects this org has already refused to query. The menu uses this to
     * leave them out of the list entirely: an entry that can only ever open
     * an empty pane is worse than no entry, and it persists across sessions
     * so the list settles after the first encounter rather than each reload.
     */
    /*
     * Undo a refusal.
     *
     * learned.dead persists across sessions on purpose - an object the org has
     * refused should not cost a failed request every reload. But nothing ever
     * cleared it, so a single wrong entry meant that object showed an empty
     * pane forever, with no way back short of wiping the extension's storage.
     *
     * Permissions change, objects get deployed, and an org that refused
     * something last week may not now.
     */
    this.forgetUnqueryable = function(obj) {
        if (!obj) { return false; }
        if (!learned.dead[obj] && !learned.fields[obj] &&
            !learned.rels[obj] && !learned.noOrder[obj]) { return false; }

        // Everything learned about this object, not only the blacklist: a
        // dropped field or a stripped ORDER BY may have been the same mistake.
        delete learned.dead[obj];
        delete learned.fields[obj];
        delete learned.rels[obj];
        delete learned.noOrder[obj];
        saveLearned();
        return true;
    };

    this.isKnownUnqueryable = function(obj) {
        return !!(obj && learned.dead[obj]);
    };

    // Escape hatch for an org whose schema changed under a cached correction.
    this.resetLearned = function() {
        learned = { fields: {}, rels: {}, noOrder: {}, dead: {} };
        try { localStorage.removeItem(LEARNED_KEY); } catch (e) {}
        // Endpoint memory lives in SchemaService now, so forget() clears both.
        SchemaService.forget();
    };

    /* ------------------------------------------------------------------ */
    /* SOQL parsing                                                        */
    /*                                                                     */
    /* Only as much parser as is needed to take a clause out of a query    */
    /* this extension generated: depth- and quote-aware, so a subquery, a  */
    /* function call or an apostrophe in a search term is never mistaken   */
    /* for a clause boundary.                                              */
    /* ------------------------------------------------------------------ */

    var CLAUSES = [
        { name: 'where',   re: /^WHERE\b/i },
        { name: 'groupBy', re: /^GROUP\s+BY\b/i },
        { name: 'having',  re: /^HAVING\b/i },
        { name: 'orderBy', re: /^ORDER\s+BY\b/i },
        { name: 'limit',   re: /^LIMIT\b/i },
        { name: 'offset',  re: /^OFFSET\b/i },
        { name: 'tail',    re: /^(?:FOR|WITH|UPDATE)\b/i }
    ];

    // Walks `text`, invoking onChar at every depth-0, outside-quote position.
    function scanTopLevel(text, onChar) {
        var depth = 0, inStr = false;
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            if (inStr) {
                if (ch === '\\') { i++; continue; }
                if (ch === "'") { inStr = false; }
                continue;
            }
            if (ch === "'") { inStr = true; continue; }
            if (ch === '(') { depth++; continue; }
            if (ch === ')') { depth--; continue; }
            if (depth === 0) { onChar(ch, i); }
        }
    }

    function matchClauseAt(text, i) {
        var slice = text.slice(i);
        for (var c = 0; c < CLAUSES.length; c++) {
            var m = slice.match(CLAUSES[c].re);
            if (m) { return { name: CLAUSES[c].name, len: m[0].length }; }
        }
        return null;
    }

    /*
     * parseSoql -> { select, from, where, orderBy, limit, ... }, or null when
     * the statement is not the simple shape this engine can repair. Returning
     * null is safe: the caller sends the query untouched.
     */
    function parseSoql(soql) {
        var head = /^\s*SELECT\s+([\s\S]+?)\s+FROM\s+([A-Za-z0-9_]+)\s*([\s\S]*)$/i.exec(soql);
        if (!head) { return null; }

        var parsed = {
            select: head[1].trim(), from: head[2], where: '', groupBy: '',
            having: '', orderBy: '', limit: '', offset: '', tail: ''
        };

        var rest = head[3] || '';
        var marks = [];
        scanTopLevel(rest, function(ch, i) {
            if (!/[A-Za-z]/.test(ch)) { return; }
            // Word boundary only, so ORDERBY inside an identifier is not a clause.
            if (i > 0 && /[A-Za-z0-9_.]/.test(rest.charAt(i - 1))) { return; }
            var kw = matchClauseAt(rest, i);
            if (kw) { marks.push({ name: kw.name, start: i, valueAt: i + kw.len }); }
        });

        for (var m = 0; m < marks.length; m++) {
            var end = (m + 1 < marks.length) ? marks[m + 1].start : rest.length;
            if (marks[m].name === 'tail') {
                var raw = rest.slice(marks[m].start, end).trim();
                parsed.tail = parsed.tail ? (parsed.tail + ' ' + raw) : raw;
            } else {
                parsed[marks[m].name] = rest.slice(marks[m].valueAt, end).trim();
            }
        }
        return parsed;
    }

    function buildSoql(p) {
        var s = 'SELECT ' + p.select + ' FROM ' + p.from;
        if (p.where)   { s += ' WHERE ' + p.where; }
        if (p.groupBy) { s += ' GROUP BY ' + p.groupBy; }
        if (p.having)  { s += ' HAVING ' + p.having; }
        if (p.orderBy) { s += ' ORDER BY ' + p.orderBy; }
        if (p.limit)   { s += ' LIMIT ' + p.limit; }
        if (p.offset)  { s += ' OFFSET ' + p.offset; }
        if (p.tail)    { s += ' ' + p.tail; }
        return s;
    }

    // Depth-aware split on a single character, for field and argument lists.
    function splitTopLevel(text, sep) {
        var parts = [], last = 0;
        scanTopLevel(text, function(ch, i) {
            if (ch === sep) { parts.push(text.slice(last, i)); last = i + 1; }
        });
        parts.push(text.slice(last));
        return parts.map(function(s) { return s.trim(); })
                    .filter(function(s) { return !!s; });
    }

    // Depth-aware split on a boolean keyword (AND / OR).
    function splitBoolean(expr, keyword) {
        var parts = [], last = 0;
        var kwLen = keyword.length;
        var upper = expr.toUpperCase();
        scanTopLevel(expr, function(ch, i) {
            if (upper.slice(i, i + kwLen) !== keyword) { return; }
            var before = i === 0 ? ' ' : expr.charAt(i - 1);
            var after  = expr.charAt(i + kwLen) || ' ';
            if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) { return; }
            parts.push(expr.slice(last, i));
            last = i + kwLen;
        });
        parts.push(expr.slice(last));
        return parts.map(function(s) { return s.trim(); })
                    .filter(function(s) { return !!s; });
    }

    // Remove parentheses that wrap the entire expression, repeatedly.
    function stripOuterParens(expr) {
        var trimmed = expr.trim();
        if (trimmed.charAt(0) !== '(' || trimmed.charAt(trimmed.length - 1) !== ')') {
            return trimmed;
        }
        var depth = 0, inStr = false;
        for (var i = 0; i < trimmed.length; i++) {
            var ch = trimmed.charAt(i);
            if (inStr) {
                if (ch === '\\') { i++; continue; }
                if (ch === "'") { inStr = false; }
                continue;
            }
            if (ch === "'") { inStr = true; continue; }
            if (ch === '(') { depth++; continue; }
            if (ch === ')') {
                depth--;
                // Closes before the end, so the parens are not a wrapper.
                if (depth === 0 && i < trimmed.length - 1) { return trimmed; }
            }
        }
        return stripOuterParens(trimmed.slice(1, -1));
    }

    // Whole-identifier reference, so "Name" does not match "DeveloperName"
    // and "LastModifiedBy" does not match "LastModifiedById".
    function referencesField(text, field) {
        return new RegExp('(^|[^A-Za-z0-9_.])' + field + '($|[^A-Za-z0-9_])', 'i').test(text);
    }

    function referencesRelationship(text, rel) {
        return new RegExp('(^|[^A-Za-z0-9_.])' + rel + '\\.', 'i').test(text);
    }

    /* ------------------------------------------------------------------ */
    /* Query surgery                                                       */
    /* ------------------------------------------------------------------ */

    // Never returns an empty projection - Id is always valid and keeps row
    // identity intact for the UI's selection and package.xml features.
    function pruneSelect(parsed, matches) {
        var kept = splitTopLevel(parsed.select, ',').filter(function(item) {
            return !matches(item);
        });
        parsed.select = (kept.length ? kept : ['Id']).join(', ');
    }

    function pruneOrderBy(parsed, matches) {
        if (!parsed.orderBy) { return; }
        parsed.orderBy = splitTopLevel(parsed.orderBy, ',').filter(function(term) {
            return !matches(term);
        }).join(', ');
    }

    /*
     * Remove only the comparisons that touch a field, rather than discarding
     * the whole WHERE. The generated filter is
     * "(LastModifiedById = 'x' OR CreatedById = 'x')", and on an object with
     * only one of those columns the right answer is to keep the other -
     * dropping the clause outright would silently widen a "my records" list
     * into every record in the org.
     */
    function pruneCondition(expr, matches) {
        var inner = stripOuterParens(expr);
        if (!inner) { return ''; }

        var ands = splitBoolean(inner, 'AND');
        if (ands.length > 1) {
            var keptAnds = ands.map(function(p) { return pruneCondition(p, matches); })
                               .filter(function(p) { return !!p; });
            return keptAnds.join(' AND ');
        }

        var ors = splitBoolean(inner, 'OR');
        if (ors.length > 1) {
            var keptOrs = ors.map(function(p) { return pruneCondition(p, matches); })
                             .filter(function(p) { return !!p; });
            if (!keptOrs.length) { return ''; }
            return keptOrs.length > 1 ? '(' + keptOrs.join(' OR ') + ')' : keptOrs[0];
        }

        return matches(inner) ? '' : inner;
    }

    function pruneWhere(parsed, matches) {
        if (!parsed.where) { return; }
        parsed.where = pruneCondition(parsed.where, matches);
    }

    // Drop a column everywhere it can legally appear.
    function dropField(parsed, field) {
        var hit = function(text) { return referencesField(text, field); };
        pruneSelect(parsed, hit);
        pruneOrderBy(parsed, hit);
        pruneWhere(parsed, hit);
    }

    function dropRelationship(parsed, rel) {
        var hit = function(text) { return referencesRelationship(text, rel); };
        pruneSelect(parsed, hit);
        pruneOrderBy(parsed, hit);
        pruneWhere(parsed, hit);
    }

    /*
     * ORDER BY across a relationship ("EntityDefinition.QualifiedApiName") is
     * rejected by both APIs on most metadata objects. Stripping it up front
     * costs an ordering the client can redo and saves a round trip.
     *
     * The previous implementation did this with a regex whose lookahead
     * required trailing whitespace, so it silently did nothing on any query
     * without a LIMIT - which was most of them.
     */
    function stripRelationshipOrderBy(parsed) {
        pruneOrderBy(parsed, function(term) { return term.indexOf('.') !== -1; });
    }

    function applyLearned(parsed) {
        var obj = parsed.from;
        var badFields = learned.fields[obj];
        if (badFields) {
            Object.keys(badFields).forEach(function(f) { dropField(parsed, f); });
        }
        var badRels = learned.rels[obj];
        if (badRels) {
            Object.keys(badRels).forEach(function(r) { dropRelationship(parsed, r); });
        }
        if (learned.noOrder[obj]) { parsed.orderBy = ''; }
    }

    /*
     * Remove anything the describe says this object does not have, before
     * spending a round trip discovering it. This is what turns the common
     * failures into successful queries: Task keeps Subject and drops Name,
     * PermissionSetTabSetting drops LastModifiedBy.Name, and objects with no
     * audit dates lose an ORDER BY that would have been a hard error.
     */
    // COUNT(), SUM() and friends. An aggregate projection cannot carry a bare
    // column or an ORDER BY without a GROUP BY, so the repairs below that add
    // one would turn a valid aggregate into a MALFORMED_QUERY.
    function isAggregate(parsed) {
        return /\b(?:COUNT|SUM|AVG|MIN|MAX|COUNT_DISTINCT)\s*\(/i.test(parsed.select) ||
               !!parsed.groupBy;
    }

    function alignToSchema(parsed, digest) {
        if (!digest || !digest.fields) { return; }   // partial - change nothing

        splitTopLevel(parsed.select, ',').forEach(function(item) {
            var path = item.split(/\s+/)[0];
            if (path.indexOf('.') !== -1) {
                var rel = path.split('.')[0];
                if (!SchemaService.hasRelationship(digest, rel)) {
                    dropRelationship(parsed, rel);
                }
            } else if (path.indexOf('(') === -1 && !SchemaService.hasField(digest, path)) {
                dropField(parsed, path);
            }
        });

        if (parsed.where) {
            ['LastModifiedById', 'CreatedById', 'OwnerId', 'NamespacePrefix'].forEach(function(f) {
                if (referencesField(parsed.where, f) && !SchemaService.hasField(digest, f)) {
                    dropField(parsed, f);
                }
            });
        }

        pruneOrderBy(parsed, function(term) {
            var field = term.split(/\s+/)[0];
            if (field.indexOf('.') !== -1) { return true; }
            return !SchemaService.hasField(digest, field) ||
                   !SchemaService.canSort(digest, field);
        });

        // An aggregate query wants neither of the repairs below: a count has
        // no display column to preserve, and sorting one without a GROUP BY
        // is an error rather than a nicety.
        if (isAggregate(parsed)) { return; }

        // Nothing left to sort by, but the describe knows a column that works.
        if (!parsed.orderBy && digest.orderField) {
            parsed.orderBy = digest.orderField + ' DESC';
        }

        // Guarantee a displayable column survived the pruning.
        var hasDisplay = splitTopLevel(parsed.select, ',').some(function(item) {
            var path = item.split(/\s+/)[0];
            return path !== 'Id' && path.indexOf('.') === -1;
        });
        if (!hasDisplay && digest.displayField && digest.displayField !== 'Id') {
            parsed.select += ', ' + digest.displayField;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Error classification                                                */
    /* ------------------------------------------------------------------ */

    function firstError(rejection) {
        var data = rejection && rejection.data;
        var entry = Array.isArray(data) ? data[0] : data;
        return entry && entry.message ? entry : null;
    }

    function errorText(rejection) {
        var entry = firstError(rejection);
        return entry ? String(entry.message) : '';
    }

    /*
     * Turn a Salesforce error into a repair instruction, or null when nothing
     * in the message says what to change - in which case the engine stops
     * rather than retrying blindly.
     */
    function diagnose(rejection) {
        var entry = firstError(rejection);
        if (!entry) { return null; }
        var message = String(entry.message);
        var code = entry.errorCode || '';
        var m;

        if ((m = /Didn't understand relationship '([^']+)'/i.exec(message))) {
            // Salesforce echoes the path as typed; the relationship is the
            // first segment ("LastModifiedBy" out of "LastModifiedBy.Name").
            return { kind: 'relationship', name: m[1].split('.')[0] };
        }
        if ((m = /No such column '([^']+)'/i.exec(message)) ||
            (m = /No such field '([^']+)'/i.exec(message))) {
            return { kind: 'field', name: m[1] };
        }
        if (code === 'INVALID_TYPE' ||
            /sObject type '[^']+' is not supported/i.test(message) ||
            /entity type \w+ does not support query/i.test(message)) {
            return { kind: 'endpoint' };
        }
        if (/can ?not be sorted/i.test(message) ||
            /ORDER BY[\s\S]*(?:not supported|not allowed)/i.test(message)) {
            return { kind: 'order' };
        }
        // Salesforce phrases this a few ways; the constant is "a filter is
        // required", whether or not it calls it an implementation restriction.
        if (/requires? a filter/i.test(message) ||
            (/Implementation restriction/i.test(message) && /filter/i.test(message))) {
            return { kind: 'unfilterable' };
        }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /* HTTP layer                                                          */
    /* ------------------------------------------------------------------ */

    // A list, not a single slot: the UI fires the "my records" and the "all
    // records" queries together, and with one shared canceller the second
    // overwrote the first, leaving it uncancellable on navigation.
    var _pending = [];

    function release(request) {
        $timeout.cancel(request.timeoutHandle);
        var i = _pending.indexOf(request);
        if (i !== -1) { _pending.splice(i, 1); }
    }

    this.cancelPending = function() {
        var inflight = _pending;
        _pending = [];
        inflight.forEach(function(request) {
            $timeout.cancel(request.timeoutHandle);
            request.resolve('cancelled');
        });
    };

    /*
     * One retry after a refresh, per request.
     *
     * A 401 on an OAuth session is usually just an access token that has aged
     * out, and the refresh token exists precisely so the user does not have to
     * notice. Without the flag a refresh that succeeds but returns a token the
     * org still refuses would retry forever.
     */
    function send(url, sid, alreadyRetried) {
        var request = $q.defer();
        _pending.push(request);
        request.timeoutHandle = $timeout(function() {
            request.reason = 'timedout';
            request.resolve('timedout');
        }, TIMEOUT_MS);

        return $http({
            url:     url,
            method:  'GET',
            timeout: request.promise,
            headers: { 'Authorization': 'Bearer ' + sid }
        }).then(function(res) {
            release(request);
            return res.data;
        }, function(rej) {
            release(request);
            if (rej && (rej.status === -1 || rej.xhrStatus === 'abort')) {
                return $q.reject(request.reason === 'timedout'
                                 ? { timedout: true }
                                 : { cancelled: true });
            }
            if (rej && rej.status === 401 && !alreadyRetried &&
                typeof ssRefreshSession === 'function') {
                return $q.when(ssRefreshSession()).then(function(refreshed) {
                    if (!refreshed) {
                        ssSessionRejected(rej);
                        return $q.reject(rej);
                    }
                    // A new token, so the request is worth making again. The
                    // caller never learns this happened, which is the point.
                    return send(url, ssSessionId(), true);
                });
            }

            // The org refused this request on session grounds. Whether that
            // means the session is gone, or only that this resource would not
            // serve it, is confirmed against the org - see ssSessionRejected.
            ssSessionRejected(rej);
            return $q.reject(rej);
        });
    }

    function withSession(run) {
        return $q.when(ssAuthReady()).then(function() {
            var sid = ssSessionId();
            if (!sid) { return $q.reject({ noSession: true }); }
            return run(sid);
        });
    }

    function endpointOfUrl(url) {
        if (!url) { return null; }
        return url.indexOf('/tooling/') !== -1 ? 'tooling' : 'rest';
    }

    // Repairing only makes sense for a query Salesforce actually judged.
    function isTerminal(rejection) {
        return !rejection || rejection.cancelled ||
               rejection.noSession || rejection.timedout;
    }

    /* ------------------------------------------------------------------ */
    /* Public API                                                          */
    /* ------------------------------------------------------------------ */

    this.noSessionMessage = NO_SESSION;

    this.get = function(url) {
        return withSession(function(sid) { return send(url, sid); });
    };

    this.remove = function(url) {
        return withSession(function(sid) {
            var request = $q.defer();
            _pending.push(request);
            request.timeoutHandle = $timeout(function() {
                request.reason = 'timedout';
                request.resolve('timedout');
            }, TIMEOUT_MS);
            return $http({
                url: url, method: 'DELETE',
                timeout: request.promise,
                headers: { 'Authorization': 'Bearer ' + sid }
            }).then(function(r) {
                release(request);
                return r.data;
            }, function(e) {
                release(request);
                return $q.reject(e);
            });
        });
    };

    // An object no API can query resolves as an ordinary empty result, so the
    // UI shows its "nothing here" copy instead of a red error the user can do
    // nothing about.
    function emptyResult(reason) {
        return { totalSize: 0, records: [], done: true, ssUnsupported: true, ssReason: reason };
    }

    /*
     * smartQuery(soql, explicitUrl, limit)
     *
     * explicitUrl is a preference, not an instruction: the org's own describe
     * decides which endpoint can serve the object.
     */
    this.smartQuery = function(soql, explicitUrl, limit) {
        var hint = endpointOfUrl(explicitUrl);

        return SchemaService.ready().then(function() {
            var parsed = parseSoql(soql);

            // Not a shape we can reason about - send it as the caller wrote it.
            if (!parsed) {
                var raw = soql + (limit ? ' LIMIT ' + limit : '');
                var url = (explicitUrl || ssQueryUrl()) + encodeURIComponent(raw);
                return withSession(function(sid) { return send(url, sid); });
            }

            var obj = parsed.from;

            if (learned.dead[obj]) {
                return emptyResult(obj + ' cannot be queried in this org.');
            }

            var endpoint = SchemaService.route(obj, hint);
            if (!endpoint) {
                remember('dead', obj);
                return emptyResult(obj + ' is not queryable through the REST or Tooling API.');
            }

            stripRelationshipOrderBy(parsed);
            applyLearned(parsed);
            if (limit && !parsed.limit) { parsed.limit = String(limit); }

            return SchemaService.describe(obj).then(function(digest) {
                alignToSchema(parsed, digest);
                return attempt(parsed, endpoint, obj, 0, null, {});
            });
        });
    };

    /*
     * One send, plus whatever repair its failure justifies.
     *
     * `original` is threaded through every retry so the message the user
     * eventually sees describes what actually went wrong, not the last thing
     * the engine tried while recovering from it.
     */
    function attempt(parsed, endpoint, obj, depth, original, tried) {
        var soql = buildSoql(parsed);
        var url  = SchemaService.queryUrlFor(endpoint) + encodeURIComponent(soql);
        tried[endpoint] = true;

        return withSession(function(sid) {
            return send(url, sid);
        }).then(function(data) {
            /*
             * Remember which API actually answered.
             *
             * Routing prefers REST whenever the REST catalogue lists an
             * object, but a few - FlexiPage is the clearest - are listed there
             * and still refuse to be queried, so the first attempt fails and
             * the retry on Tooling succeeds. Recording only the INVALID_TYPE
             * crossover was not enough: anything that reached the right API by
             * another route paid the failed first request again every session.
             * Recording it on success means one wasted request ever, not one
             * per session.
             */
            SchemaService.rememberEndpoint(obj, endpoint);
            return data;
        }, function(rejection) {
            if (isTerminal(rejection)) { return $q.reject(rejection); }

            var reportable = original || rejection;
            if (depth >= MAX_REPAIRS) { return $q.reject(reportable); }

            var fix = diagnose(rejection);
            if (!fix) { return $q.reject(reportable); }

            var next = JSON.parse(JSON.stringify(parsed));

            if (fix.kind === 'field') {
                // Only a repair if it actually changes the query; otherwise
                // the same request would be retried until the depth cap.
                if (!referencesField(soql, fix.name)) { return $q.reject(reportable); }
                remember('fields', obj, fix.name);
                dropField(next, fix.name);
                if (!next.orderBy && !isAggregate(next)) {
                    var digest = SchemaService.digestSync(obj);
                    if (digest && digest.orderField && digest.orderField !== fix.name) {
                        next.orderBy = digest.orderField + ' DESC';
                    }
                }
                return attempt(next, endpoint, obj, depth + 1, reportable, tried);
            }

            if (fix.kind === 'relationship') {
                if (!referencesRelationship(soql, fix.name)) { return $q.reject(reportable); }
                remember('rels', obj, fix.name);
                dropRelationship(next, fix.name);
                return attempt(next, endpoint, obj, depth + 1, reportable, tried);
            }

            if (fix.kind === 'order') {
                if (!next.orderBy) { return $q.reject(reportable); }
                remember('noOrder', obj);
                next.orderBy = '';
                return attempt(next, endpoint, obj, depth + 1, reportable, tried);
            }

            /*
             * "Implementation restriction: X requires a filter by a single Id"
             * means the opposite of what the old repair assumed: the object
             * cannot be listed at all without a filter this extension has no
             * way to supply, so widening the query by dropping the WHERE only
             * makes it more illegal. Record it as unqueryable, which also
             * takes it out of the menu on the next load - ApexTypeImplementor,
             * ApexTestRunResult and AppExtension all land here.
             */
            if (fix.kind === 'unfilterable') {
                remember('dead', obj);
                return emptyResult(obj + ' cannot be listed without a filter.');
            }

            if (fix.kind === 'endpoint') {
                var other = endpoint === 'tooling' ? 'rest' : 'tooling';
                var viable = other === 'tooling'
                    ? SchemaService.toolingCanQuery(obj)
                    : SchemaService.restCanQuery(obj);
                // Refuse the cross-over only when the org positively told us
                // the other side lacks this object - which is what stops the
                // misleading "sObject type is not supported" errors. When the
                // catalogue never loaded we know nothing, so try it anyway
                // rather than refusing a query that would have worked.
                var known = SchemaService.catalogueKnown();
                if (tried[other] || (known && !viable)) {
                    if (known) { remember('dead', obj); }
                    return emptyResult(obj + ' is not queryable in this org.');
                }
                SchemaService.rememberEndpoint(obj, other);
                return attempt(next, other, obj, depth + 1, reportable, tried);
            }

            return $q.reject(reportable);
        });
    }

    // Existing callers pass an explicit base url; it becomes a routing hint.
    // The {uid} placeholder (see ssResolveQueryUid) is resolved here so every
    // caller - menu, debug-log grid, modal - asks for the current user.
    this.query = function(soql, baseUrl, limit) {
        return self.smartQuery(ssResolveQueryUid(soql), baseUrl, limit);
    };

    /*
     * query(), but every page of it.
     *
     * Salesforce answers 2,000 rows at a time and says so in nextRecordsUrl.
     * query() hands back the first page and stops, which is the right trade
     * for a list someone is reading - a grid showing the first 2,000 rows is
     * a grid, and paging it would cost several round trips on every panel.
     *
     * It is the wrong trade for a count. A total computed from one page is
     * silently understated, and reads as fact: "214 logins" when it was 214
     * of however many there really were. So this exists as a separate call
     * rather than a change to query(), and callers reach for it only when the
     * answer is an aggregate rather than a page.
     *
     * MAX_ROWS is a sanity bound, not a page size - it stops a pathological
     * org spinning here forever. `truncated` says whether it was hit, because
     * a capped total is exactly the silent understatement this is meant to
     * avoid.
     */
    var QUERY_ALL_MAX_ROWS = 20000;

    this.queryAll = function(soql, baseUrl) {
        return self.query(soql, baseUrl).then(function(data) {
            var records = (data && data.records) ? data.records.slice() : [];

            function follow(page) {
                var next = page && page.nextRecordsUrl;
                if (!next || records.length >= QUERY_ALL_MAX_ROWS) {
                    return {
                        records: records,
                        totalSize: records.length,
                        done: !next,
                        truncated: !!next
                    };
                }

                var url = /^https?:/i.test(next) ? next : (ssApiOrigin() + next);
                return self.get(url).then(function(more) {
                    if (more && more.records) {
                        records = records.concat(more.records);
                    }
                    return follow(more);
                }, function() {
                    // A page that fails keeps the pages that worked, and says
                    // the total is short rather than presenting it as whole.
                    return {
                        records: records,
                        totalSize: records.length,
                        done: false,
                        truncated: true
                    };
                });
            }

            return follow(data);
        });
    };

    /* ------------------------------------------------------------------ */
    /* Error messaging                                                     */
    /* ------------------------------------------------------------------ */
    this.errorMessage = function(rejection, label) {
        if (!rejection || rejection.cancelled) {
            return null;
        }
        if (rejection.timedout) {
            return 'The query took too long. Please try again or use a narrower filter.';
        }
        if (rejection.noSession) {
            return NO_SESSION;
        }

        /*
         * The org's own message comes first.
         *
         * The disco-cookie check used to run ahead of it, so on any page
         * without that cookie every failure - a filter restriction, a missing
         * column, a permission - was reported as "Cannot query from this
         * page", which is both wrong and unactionable when the very next
         * object queries fine. It is a reasonable guess only when Salesforce
         * told us nothing at all.
         */
        var message = errorText(rejection);
        if (!message && !readCookie('disco')) {
            return 'Cannot query from this page. Try navigating to your Salesforce home page.';
        }
        if (message) {
            // This reaches the user only after the engine has confirmed that
            // neither API can serve the object, so say so plainly rather than
            // quoting an API-internal complaint about a type that does exist.
            if (/is not supported|does not support query/i.test(message)) {
                return (label || 'This object') + ' is not available in this org.';
            }
            return message;
        }
        if (rejection.status === 401) {
            return 'Your Salesforce session has expired. Please refresh Salesforce and try again.';
        }
        if (rejection.status === 403) {
            return 'You do not have permission to query this data.';
        }
        if (rejection.statusText === 'Bad Request' && label) {
            return label + ' is not available in this org.';
        }
        return rejection.statusText || 'Request failed.';
    };

    /* Exposed for tests. */
    this._internals = {
        parseSoql: parseSoql,
        buildSoql: buildSoql,
        dropField: dropField,
        dropRelationship: dropRelationship,
        pruneCondition: pruneCondition,
        stripRelationshipOrderBy: stripRelationshipOrderBy,
        diagnose: diagnose
    };
}]);
