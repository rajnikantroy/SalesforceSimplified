/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * NewsService - "what happened in this org today".
 *
 * Produces a short list of plain-text headlines for the footer ticker. Two
 * audiences, decided by what the user is actually permitted to do rather than
 * by profile name, which is free text and differs in every org:
 *
 *   Builders  (Author Apex / Customize Application / Modify All Data)
 *             Apex and metadata created or changed today, tests run, logs
 *             captured - the shape of today's deployment.
 *
 *   Everyone  Records touched across the objects the org actually uses, and
 *             the pipeline value that moved. An admin sees both sets.
 *
 * Every headline is one COUNT() or SUM(), which the org answers from an index
 * rather than by returning rows. Each one starts at TODAY and widens through
 * YESTERDAY, THIS_WEEK and THIS_MONTH only if the shorter window was empty, so
 * a quiet day still has something to say and a busy org never pays for the
 * extra queries. The headline names the window it actually used.
 *
 * A headline whose query fails - no permission, object absent, aggregate not
 * allowed - is dropped without a word: a ticker is ambient, and an error
 * belongs nowhere near it.
 */
var app = window.app || angular.module("SalesforceSimplifiedApp");
app.service('NewsService', ['sfdc', '$q', 'UserId', 'SchemaService', 'TrustService',
            function(sfdc, $q, UserId, SchemaService, TrustService) {

    var self = this;

    // Today's numbers, but not worth re-querying on every menu open.
    var REFRESH_MS = 10 * 60 * 1000;
    var _cache = null;
    var _cachedAt = 0;
    var _inflight = null;

    /* ------------------------------------------------------------------ */
    /* Audience                                                            */
    /* ------------------------------------------------------------------ */

    /*
     * Permissions, not profile names. "System Administrator" is renamed and
     * cloned constantly, and plenty of orgs grant developer access through a
     * custom profile, so the only durable question is what the user can do.
     */
    this.getAudience = function() {
        var soql = "SELECT Id, Profile.Name, Profile.PermissionsAuthorApex, " +
                   "Profile.PermissionsModifyAllData, Profile.PermissionsCustomizeApplication, " +
                   "Profile.PermissionsViewSetup " +
                   "FROM User WHERE Id = '" + escapeSoqlLiteral(UserId.id) + "'";

        return sfdc.query(soql, ssQueryUrl(), 1).then(function(data) {
            var record = data && data.records && data.records[0];
            var profile = (record && record.Profile) || {};
            return {
                profileName: profile.Name || '',
                isBuilder: !!(profile.PermissionsAuthorApex ||
                              profile.PermissionsCustomizeApplication ||
                              profile.PermissionsModifyAllData),
                isAdmin: !!profile.PermissionsModifyAllData
            };
        }, function() {
            // Profile unreadable: fall back to the data headlines, which need
            // no special permission to be meaningful.
            return { profileName: '', isBuilder: false, isAdmin: false };
        });
    };

    /* ------------------------------------------------------------------ */
    /* Counting                                                            */
    /* ------------------------------------------------------------------ */

    /*
     * Widening windows.
     *
     * A quiet day - a weekend, a fresh sandbox, an org nobody deployed to -
     * leaves every count at zero and the ticker empty. Rather than show
     * nothing, each headline falls back through progressively longer windows
     * until one has something to report, and says which window it used.
     *
     * The order matters: TODAY first so an active org always reads as today,
     * and each fallback is only attempted once the shorter one came back
     * empty, so a busy org never pays for the extra queries.
     */
    var WINDOWS = [
        { literal: 'TODAY',      phrase: 'today' },
        { literal: 'YESTERDAY',  phrase: 'yesterday' },
        { literal: 'THIS_WEEK',  phrase: 'this week' },
        { literal: 'THIS_MONTH', phrase: 'this month' }
    ];

    // SELECT COUNT() answers in totalSize with no rows, so a count costs the
    // org almost nothing however large the object.
    function countIn(object, dateField, literal, extraWhere) {
        var soql = 'SELECT COUNT() FROM ' + object +
                   ' WHERE ' + (dateField || 'LastModifiedDate') + ' = ' + literal +
                   (extraWhere ? (' AND ' + extraWhere) : '');
        return sfdc.query(soql).then(function(data) {
            if (!data || data.ssUnsupported) { return null; }
            return typeof data.totalSize === 'number' ? data.totalSize : null;
        }, function() {
            return null;
        });
    }

    /*
     * How many distinct values of `field` appear in the window. GROUP BY
     * returns one row per value, so the row count is the answer - there is no
     * COUNT(DISTINCT) in SOQL.
     */
    function distinctCount(object, field, dateField, literal, extraWhere) {
        var soql = 'SELECT COUNT(Id) FROM ' + object +
                   ' WHERE ' + (dateField || 'LastModifiedDate') + ' = ' + literal +
                   (extraWhere ? (' AND ' + extraWhere) : '') +
                   ' GROUP BY ' + field;
        return sfdc.query(soql).then(function(data) {
            if (!data || data.ssUnsupported || !data.records) { return null; }
            return data.records.length;
        }, function() {
            return null;
        });
    }

    /*
     * The single busiest value of `field` in the window, as { name, count }.
     * Same GROUP BY, ordered so the leader is first.
     */
    function busiestBy(object, field, dateField, literal, extraWhere) {
        var soql = 'SELECT COUNT(Id) total, ' + field + ' grouped FROM ' + object +
                   ' WHERE ' + (dateField || 'LastModifiedDate') + ' = ' + literal +
                   (extraWhere ? (' AND ' + extraWhere) : '') +
                   ' GROUP BY ' + field + ' ORDER BY COUNT(Id) DESC LIMIT 1';
        return sfdc.query(soql).then(function(data) {
            var record = data && data.records && data.records[0];
            if (!record) { return null; }
            var count = record.total !== undefined ? record.total : record.expr0;
            var name = record.grouped !== undefined ? record.grouped : record.expr1;
            if (!count || !name) { return null; }
            return { name: String(name), count: count };
        }, function() {
            return null;
        });
    }

    function sumIn(object, field, dateField, literal) {
        var soql = 'SELECT SUM(' + field + ') total FROM ' + object +
                   ' WHERE ' + (dateField || 'LastModifiedDate') + ' = ' + literal;
        return sfdc.query(soql).then(function(data) {
            var record = data && data.records && data.records[0];
            var value = record && (record.total !== undefined ? record.total : record.expr0);
            return typeof value === 'number' ? value : null;
        }, function() {
            return null;
        });
    }

    // Cheap, high-traffic objects used to find the window - not to report on.
    var PROBE_OBJECTS = ['ApexClass', 'Account', 'Opportunity', 'Contact', 'Task', 'Lead', 'Case'];
    var MAX_PROBES = 4;

    /*
     * Picks one window for the whole ticker.
     *
     * Widening each headline independently would multiply every count by the
     * number of windows - on the quiet org that needs the fallback most, that
     * is four times the queries - and a ticker whose lines each cover a
     * different period reads as noise rather than news. So a handful of busy
     * objects are probed once per window, and the first window with any
     * activity at all becomes the window every headline is phrased against.
     *
     * Falls through to the widest window when nothing has moved this month;
     * the headlines will then all come back empty and the ticker stays hidden,
     * which is the honest outcome for an org where nothing has happened.
     */
    function resolveWindow(index) {
        index = index || 0;
        if (index >= WINDOWS.length) { return $q.when(WINDOWS[WINDOWS.length - 1]); }

        var window = WINDOWS[index];
        var probes = PROBE_OBJECTS.filter(available).slice(0, MAX_PROBES).map(function(name) {
            return settle(countIn(name, null, window.literal));
        });
        if (!probes.length) { return $q.when(window); }

        return $q.all(probes).then(function(counts) {
            var active = counts.some(function(count) { return !!count; });
            return active ? window : resolveWindow(index + 1);
        }, function() {
            return window;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Formatting                                                          */
    /* ------------------------------------------------------------------ */

    function plural(count, singular, pluralForm) {
        return count === 1 ? singular : (pluralForm || singular + 's');
    }

    // 1 200 000 -> "1.2M". Ticker text has to read at a glance.
    function compact(value) {
        var n = Math.abs(value);
        if (n >= 1e9) { return (value / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; }
        if (n >= 1e6) { return (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; }
        if (n >= 1e3) { return (value / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; }
        return String(Math.round(value));
    }

    /*
     * category says which notification setting this headline answers to -
     * see SS_NOTIFY_KINDS in ss-core. Defaults to 'activity', which is what
     * almost every headline is: something that changed in the org. The two
     * exceptions are the limits, which people want to hear about on quite
     * different terms from "3 Apex classes changed".
     */
    function headline(text, target, category) {
        var item = { text: text, category: category || 'activity' };
        // target is a metadata `value`; the ticker opens that list on click.
        if (target) { item.target = target; }
        return item;
    }

    /*
     * Neutralises a headline job so it can only ever contribute a value.
     *
     * $q.all rejects the moment any input rejects, so a single unreadable
     * object would take every other headline down with it and leave the
     * ticker blank. Anything that fails - the query, or the formatting that
     * runs on its result - becomes null here and is filtered out later, so
     * one bad headline costs exactly itself and the rest still show.
     */
    function settle(promise) {
        return $q.when(promise).then(function(value) {
            return value;
        }, function() {
            return null;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Headline sources                                                    */
    /* ------------------------------------------------------------------ */

    // Only objects this org actually exposes are asked about, so a headline is
    // never built on a query that was always going to fail.
    function available(name) {
        return SchemaService.restCanQuery(name) || SchemaService.toolingCanQuery(name);
    }

    function builderHeadlines(win) {
        var jobs = [];

        // build(count, phrase) -> headline. phrase names the window in use, so
        // the text says "today" or "this week" honestly rather than assuming.
        function add(object, dateField, build) {
            if (!available(object)) { return; }
            jobs.push(settle(countIn(object, dateField, win.literal).then(function(count) {
                return count ? build(count, win.phrase) : null;
            })));
        }

        add('ApexClass', 'CreatedDate', function(n, w) {
            return headline(n + ' new Apex ' + plural(n, 'class', 'classes') + ' created ' + w, 'ApexClass');
        });
        add('ApexClass', 'LastModifiedDate', function(n, w) {
            return headline(n + ' Apex ' + plural(n, 'class', 'classes') + ' changed ' + w, 'ApexClass');
        });
        add('ApexTrigger', 'LastModifiedDate', function(n, w) {
            return headline(n + ' Apex ' + plural(n, 'trigger') + ' changed ' + w, 'ApexTrigger');
        });
        add('LightningComponentBundle', 'LastModifiedDate', function(n, w) {
            return headline(n + ' Lightning web ' + plural(n, 'component') + ' changed ' + w, 'LightningComponentBundle');
        });
        add('AuraDefinitionBundle', 'LastModifiedDate', function(n, w) {
            return headline(n + ' Aura ' + plural(n, 'bundle') + ' changed ' + w, 'AuraDefinitionBundle');
        });
        add('Flow', 'LastModifiedDate', function(n, w) {
            return headline(n + ' ' + plural(n, 'flow') + ' changed ' + w, 'Flow');
        });
        add('CustomField', 'LastModifiedDate', function(n, w) {
            return headline(n + ' custom ' + plural(n, 'field') + ' changed ' + w, 'CustomField');
        });
        add('ApexTestRunResult', 'StartTime', function(n, w) {
            return headline(n + ' test ' + plural(n, 'run') + ' executed ' + w, null);
        });
        add('ApexLog', 'StartTime', function(n, w) {
            return headline(n + ' debug ' + plural(n, 'log') + ' captured ' + w, 'ApexLog');
        });

        return jobs;
    }

    // Standard objects worth counting, in the order a reader cares about.
    // Anything the org does not have is skipped by available().
    var DATA_OBJECTS = [
        { name: 'Opportunity', label: 'opportunity', plural: 'opportunities' },
        { name: 'Account',     label: 'account' },
        { name: 'Contact',     label: 'contact' },
        { name: 'Case',        label: 'case' },
        { name: 'Lead',        label: 'lead' },
        { name: 'Task',        label: 'task' }
    ];

    function dataHeadlines(win) {
        var jobs = [];

        DATA_OBJECTS.forEach(function(entry) {
            if (!available(entry.name)) { return; }
            jobs.push(settle(countIn(entry.name, null, win.literal).then(function(count) {
                if (!count) { return null; }
                return headline(count + ' ' + plural(count, entry.label, entry.plural) +
                                ' updated ' + win.phrase, entry.name);
            })));
        });

        // The one number a non-admin actually feels: pipeline value that moved.
        if (available('Opportunity')) {
            jobs.push(settle(sumIn('Opportunity', 'Amount', null, win.literal).then(function(total) {
                if (!total) { return null; }
                return headline(compact(total) + ' in opportunity value moved ' +
                                win.phrase, 'Opportunity');
            })));
        }

        return jobs;
    }

    /* ------------------------------------------------------------------ */
    /* Org health                                                          */
    /* ------------------------------------------------------------------ */

    /*
     * Limits come from /services/data/vXX/limits, not SOQL - one request for
     * the lot. Only a limit that is actually close to its ceiling is reported:
     * "12% of file storage used" is not news, and a ticker that cries wolf
     * stops being read.
     */
    var LIMIT_WARN_PCT = 70;

    var WATCHED_LIMITS = [
        { key: 'DataStorageMB',            label: 'data storage',                category: 'storage' },
        { key: 'FileStorageMB',            label: 'file storage',                category: 'storage' },
        { key: 'DailyApiRequests',         label: 'the daily API limit',         category: 'api' },
        { key: 'DailyAsyncApexExecutions', label: 'daily async Apex executions', category: 'api' },
        { key: 'DailyBulkApiBatches',      label: 'daily Bulk API batches',      category: 'api' }
    ];

    function limitHeadlines() {
        return settle(sfdc.get(ssRestBase() + '/limits').then(function(data) {
            if (!data) { return null; }
            var found = [];
            WATCHED_LIMITS.forEach(function(entry) {
                var limit = data[entry.key];
                if (!limit || typeof limit.Max !== 'number' || !limit.Max) { return; }
                var remaining = typeof limit.Remaining === 'number' ? limit.Remaining : limit.Max;
                var percent = Math.round(((limit.Max - remaining) / limit.Max) * 100);
                if (percent < LIMIT_WARN_PCT) { return; }
                found.push(headline(percent + '% of ' + entry.label + ' used', null, entry.category));
            });
            return found;
        }));
    }

    /*
     * Security signals, both of which need setup-level read access and are
     * simply absent for everyone else - LoginHistory is not readable without
     * it, and the query fails into nothing rather than an error.
     */
    function securityHeadlines(win) {
        var jobs = [];
        if (!available('LoginHistory')) { return jobs; }

        // Failed sign-ins. A handful is normal; a spike is worth a look.
        jobs.push(settle(countIn('LoginHistory', 'LoginTime', win.literal,
                                 "Status != 'Success'").then(function(count) {
            if (!count) { return null; }
            return headline(count + ' failed login ' + plural(count, 'attempt') +
                            ' ' + win.phrase, null);
        })));

        /*
         * Distinct countries people signed in from. GROUP BY returns one row
         * per country, so the row count is the answer. Two or more is the
         * interesting case - a single country is just the office.
         */
        jobs.push(settle(distinctCount('LoginHistory', 'LoginGeo.Country', 'LoginTime',
                                       win.literal).then(function(countries) {
            if (!countries || countries < 2) { return null; }
            return headline('Sign-ins from ' + countries + ' different countries ' +
                            win.phrase, null);
        })));

        return jobs;
    }

    /*
     * Deployments.
     *
     * DeployRequest is the Metadata API's record of change sets and CI
     * deployments, and it is Tooling-only and setup-gated - so this is
     * naturally an admin headline and simply produces nothing for anyone else.
     * Status is an enum; Succeeded and Failed are the two anyone reads.
     */
    function deploymentHeadlines(win) {
        var jobs = [];
        if (!available('DeployRequest')) { return jobs; }

        jobs.push(settle(countIn('DeployRequest', 'CompletedDate', win.literal,
                                 "Status = 'Succeeded'").then(function(count) {
            if (!count) { return null; }
            return headline(count + ' ' + plural(count, 'deployment') +
                            ' succeeded ' + win.phrase, null);
        })));

        jobs.push(settle(countIn('DeployRequest', 'CompletedDate', win.literal,
                                 "Status = 'Failed'").then(function(count) {
            if (!count) { return null; }
            return headline(count + ' ' + plural(count, 'deployment') +
                            ' failed ' + win.phrase, null);
        })));

        return jobs;
    }

    /*
     * Where the volume is coming from - which person and which object account
     * for the most record changes. Both are a GROUP BY over the busiest data
     * object the org has, so the question is answered without guessing which
     * object matters in this org.
     */
    function volumeHeadlines(win) {
        var jobs = [];

        // The first data object this org actually exposes stands in for
        // "where records are being written"; Opportunity leads DATA_OBJECTS
        // because it is the one an admin is asked about.
        var subject = null;
        for (var i = 0; i < DATA_OBJECTS.length; i++) {
            if (available(DATA_OBJECTS[i].name)) { subject = DATA_OBJECTS[i]; break; }
        }
        if (!subject) { return jobs; }

        jobs.push(settle(busiestBy(subject.name, 'LastModifiedBy.Name', null,
                                   win.literal).then(function(top) {
            if (!top || top.count < 2) { return null; }
            return headline(top.name + ' changed the most ' +
                            plural(2, subject.label, subject.plural) + ' ' + win.phrase +
                            ' (' + top.count + ')', subject.name);
        })));

        return jobs;
    }

    /*
     * Live service health for the org's own instance, from the public Trust
     * API. Not a SOQL count like everything else here, and not gated on the
     * builder audience either: an incident on the instance is the one thing
     * in this ticker that matters to whoever is looking at it.
     *
     * Every line targets the Trust Status view, so the trimmed headline is
     * also the way into the full picture.
     */
    function trustHeadlines() {
        return [settle(TrustService.loadStatus().then(function(status) {
            return TrustService.summaryLines(status).map(function(line) {
                return headline(line, 'TrustStatus');
            });
        }))];
    }

    function healthHeadlines(win) {
        return [limitHeadlines()]
            .concat(securityHeadlines(win))
            .concat(deploymentHeadlines(win))
            .concat(volumeHeadlines(win));
    }

    /* ------------------------------------------------------------------ */
    /* Assembly                                                            */
    /* ------------------------------------------------------------------ */

    /*
     * getHeadlines() -> promise([{ text, target? }])
     *
     * Never rejects. An org where every query fails simply gets an empty list
     * and the ticker stays hidden.
     */
    this.getHeadlines = function(force) {
        if (!force && _cache && (Date.now() - _cachedAt < REFRESH_MS)) {
            return $q.when(_cache);
        }
        if (_inflight) { return _inflight; }

        _inflight = SchemaService.ready().then(function() {
            // The window has to be settled before any headline is phrased, so
            // every line covers the same period.
            return $q.all([self.getAudience(), resolveWindow()]);
        }).then(function(results) {
            var audience = results[0];
            var win = results[1];

            var jobs = dataHeadlines(win);
            if (audience.isBuilder) {
                // Health, deployments and volume lead: an admin opening this
                // wants the exceptions before the routine counts.
                jobs = healthHeadlines(win)
                    .concat(builderHeadlines(win))
                    .concat(jobs);
            }
            // Ahead of both audiences' lists: if the instance itself is in
            // trouble, that outranks anything counted inside the org.
            jobs = trustHeadlines().concat(jobs);

            return $q.all(jobs).then(function(items) {
                // limitHeadlines() resolves an array; everything else resolves
                // a single headline. Flatten before filtering so both shapes
                // land in the same list.
                var flat = [];
                items.forEach(function(item) {
                    if (Array.isArray(item)) { flat = flat.concat(item); }
                    else { flat.push(item); }
                });
                // Every job settles to a value, so this filter is what drops
                // the ones that failed or had nothing to report.
                var headlines = flat.filter(function(item) {
                    return !!(item && item.text);
                });
                _cache = headlines;
                _cachedAt = Date.now();
                _inflight = null;
                self.recordHeadlines(headlines);
                return headlines;
            });
        }).then(null, function() {
            _inflight = null;
            return [];
        });

        return _inflight;
    };

    this.clearCache = function() {
        _cache = null;
        _cachedAt = 0;
    };

    /* ------------------------------------------------------------------ */
    /* Timeline & LocalStorage Persistence                                 */
    /* ------------------------------------------------------------------ */

    function getStorageKey(suffix) {
        var uid = (UserId && UserId.id) ? UserId.id : 'default';
        return 'Simplified_NewsTimeline_' + suffix + '_' + uid;
    }

    this.getRetention = function() {
        try {
            var val = localStorage.getItem(getStorageKey('Retention'));
            var days = parseInt(val, 10);
            return (days === 30 || days === 7) ? days : 7;
        } catch(e) {
            return 7;
        }
    };

    this.setRetention = function(days) {
        var num = parseInt(days, 10);
        if (num !== 7 && num !== 30) { num = 7; }
        try {
            localStorage.setItem(getStorageKey('Retention'), String(num));
        } catch(e) {}
        this.pruneTimeline();
    };

    this.getTimeline = function() {
        try {
            var raw = localStorage.getItem(getStorageKey('Items'));
            var items = raw ? JSON.parse(raw) : [];
            return Array.isArray(items) ? items : [];
        } catch(e) {
            return [];
        }
    };

    this.clearTimeline = function() {
        try {
            localStorage.removeItem(getStorageKey('Items'));
        } catch(e) {}
    };

    this.pruneTimeline = function() {
        var items = this.getTimeline();
        if (!items.length) { return; }
        var retentionDays = this.getRetention();
        var cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
        var filtered = items.filter(function(item) {
            return item && item.timestamp && item.timestamp >= cutoff;
        });
        try {
            localStorage.setItem(getStorageKey('Items'), JSON.stringify(filtered));
        } catch(e) {}
    };

    this.recordHeadlines = function(headlines) {
        if (!headlines || !headlines.length) { return; }
        var current = this.getTimeline();
        var now = Date.now();
        var thirtyMins = 30 * 60 * 1000;
        var addedAny = false;

        headlines.forEach(function(h) {
            if (!h || !h.text) { return; }
            // Duplicate check within last 30 minutes
            var isDuplicate = current.some(function(item) {
                return item.text === h.text && (now - item.timestamp < thirtyMins);
            });
            if (!isDuplicate) {
                var dateObj = new Date(now);
                current.unshift({
                    id: 'news_' + now + '_' + Math.random().toString(36).substr(2, 5),
                    text: h.text,
                    target: h.target || null,
                    category: h.category || 'activity',
                    timestamp: now,
                    dateStr: dateObj.toLocaleDateString(),
                    timeStr: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });
                addedAny = true;
            }
        });

        if (addedAny) {
            var retentionDays = this.getRetention();
            var cutoff = now - (retentionDays * 24 * 60 * 60 * 1000);
            current = current.filter(function(item) {
                return item && item.timestamp && item.timestamp >= cutoff;
            });
            try {
                localStorage.setItem(getStorageKey('Items'), JSON.stringify(current));
            } catch(e) {}
        }

        /*
         * Leave a copy where the service worker can reach it.
         *
         * The timeline above lives in page localStorage, which a service
         * worker cannot read, and these headlines were built from queries
         * that need a session it does not have. The off-hours notification
         * is therefore assembled from whatever the last open page left
         * behind - so this is that.
         *
         * Only the few most recent, and only their text: a notification has
         * room for one line, and the rest would be storing data for its own
         * sake.
         */
        ssUpdateBrief({
            headlines: current.slice(0, 5).map(function(item) {
                return {
                    text: item.text,
                    timestamp: item.timestamp,
                    category: item.category || 'activity'
                };
            })
        });
    };
}]);
