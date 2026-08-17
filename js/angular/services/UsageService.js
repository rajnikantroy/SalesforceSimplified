/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * UsageService - how much this extension is actually being used, and what for.
 *
 * Everything here is counted locally and stays local: the tallies live in this
 * browser's localStorage, keyed by org, and are never sent anywhere. Nothing
 * about a record, a user, or a query is stored - only that a feature was used,
 * and when.
 *
 * The time-saved figure is an estimate, not a measurement. Each feature is
 * given a rough number of seconds it avoids compared with doing the same thing
 * through Setup navigation - opening a metadata list, running a search, or
 * building a package.xml by hand - and the total is that number multiplied by
 * how often the feature was used. The per-feature weights are stated in
 * SECONDS_SAVED below so the number can be argued with rather than trusted
 * blindly.
 */
var app = window.app || angular.module("SalesforceSimplifiedApp");
app.service('UsageService', ['sfdc', '$q', 'SchemaService', function(sfdc, $q, SchemaService) {

    /*
     * One key per org.
     *
     * Every org used to share this one key, and save() writes whichever org
     * is in front of you - so opening the extension in a second org silently
     * destroyed the first org's tally. The origin stamp inside the record
     * caught the mismatch on read and started from zero, which is how "Days
     * used" reset itself for anyone who works across a sandbox and a
     * production org. Separate keys mean the two records simply coexist.
     */
    var STORE_KEY = 'SFDCSimplified_usage_v1';

    function storeKey() {
        var org = ssOrgKey(window.location.hostname);
        return org ? (STORE_KEY + '_' + org) : STORE_KEY;
    }

    /*
     * Every countable feature, with the label the analytics view shows and a
     * rough seconds-saved-per-use weight. The weights are deliberately
     * conservative: the point is a defensible order of magnitude, not a claim
     * of precision.
     */
    var FEATURES = {
        menuOpen:      { label: 'Menu opened',            seconds: 5 },
        metadataView:  { label: 'Metadata list opened',   seconds: 25 },
        search:        { label: 'Searches run',           seconds: 15 },
        advanceSearch: { label: 'Advanced searches',      seconds: 30 },
        recordOpen:    { label: 'Records opened',         seconds: 10 },
        packageXml:    { label: 'package.xml built',      seconds: 120 },
        dataExport:    { label: 'Data exported',          seconds: 90 },
        debugLog:      { label: 'Debug logs opened',      seconds: 20 },
        viewAsUser:    { label: 'Viewed as another user', seconds: 45 },
        copyRecord:    { label: 'Records copied',         seconds: 60 }
    };

    var _state = null;

    /* ------------------------------------------------------------------ */
    /* Storage                                                             */
    /* ------------------------------------------------------------------ */

    function emptyState() {
        return { origin: SS_ORIGIN, firstUsed: Date.now(), counts: {}, days: {} };
    }

    /*
     * Whether stored counters belong to the org being browsed.
     *
     * By org, not by origin. Classic and Lightning are two hosts of one org,
     * so an exact origin match declared every switch between them a different
     * org and started the tallies again - "Days used" reset on the way from
     * Setup to Lightning and back. Compared by org key, one org's usage is one
     * story however the user happens to be looking at it.
     */
    function isThisOrg(origin) {
        if (!origin) { return false; }
        if (origin === SS_ORIGIN) { return true; }
        var here = ssOrgKey(window.location.hostname);
        if (here === null) { return false; }
        try {
            return ssOrgKey(new URL(origin).hostname) === here;
        } catch (e) {
            return false;
        }
    }

    function read(key) {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    }

    function load() {
        if (_state) { return _state; }
        try {
            // The org's own record, or - for anyone upgrading - the single
            // shared record left by the previous scheme, but only if it was
            // this org that wrote it.
            var parsed = read(storeKey());
            if (!parsed) {
                var legacy = read(STORE_KEY);
                if (legacy && isThisOrg(legacy.origin)) { parsed = legacy; }
            }
            _state = parsed || emptyState();
            // Keep counting under the origin in front of us, so a record
            // adopted from another host of the same org stays in one place.
            _state.origin = SS_ORIGIN;
            if (!_state.counts) { _state.counts = {}; }
            if (!_state.days) { _state.days = {}; }
        } catch (e) {
            _state = emptyState();
        }
        return _state;
    }

    function save() {
        try {
            localStorage.setItem(storeKey(), JSON.stringify(_state));
        } catch (e) {
            // Storage full or disabled. Counting is a nicety; never let it
            // interfere with the thing the user actually asked for.
        }
    }

    /*
     * The user's today, not UTC's.
     *
     * toISOString() is UTC, so east of Greenwich everything done before local
     * midday-minus-the-offset - a whole morning in IST - was filed under the
     * previous day, and "Days used" counted a single evening's work as two.
     */
    function dayKey(date) {
        var month = date.getMonth() + 1;
        var day = date.getDate();
        return date.getFullYear() + '-' +
               (month < 10 ? '0' : '') + month + '-' +
               (day < 10 ? '0' : '') + day;
    }

    function today() {
        return dayKey(new Date());
    }

    /*
     * The day before a key, through a real Date so month ends, leap years and
     * the days either side of a daylight-saving change all land correctly.
     * Constructed from the parts rather than parsed from the string, because
     * `new Date('2026-08-10')` is parsed as UTC and would shift the day for
     * anyone west of Greenwich.
     */
    function previousDay(key) {
        var parts = String(key).split('-');
        var date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        date.setDate(date.getDate() - 1);
        return dayKey(date);
    }

    /* ------------------------------------------------------------------ */
    /* Recording                                                           */
    /* ------------------------------------------------------------------ */

    /*
     * record('metadataView') - call from wherever a feature is genuinely
     * exercised. Unknown keys are ignored rather than stored, so a typo can
     * never invent a feature in the analytics view.
     */
    this.record = function(feature) {
        if (!FEATURES[feature]) { return; }
        var state = load();
        var day = today();
        state.counts[feature] = (state.counts[feature] || 0) + 1;
        state.days[day] = (state.days[day] || 0) + 1;
        save();

        // Feeds the weekly opacity review, which is browser-wide rather than
        // per org - see the adaptive opacity section below.
        var adapt = loadAdapt();
        adapt.actions = (adapt.actions || 0) + 1;
        saveAdapt(adapt);

        // The service worker decides whether to nudge from how long it has
        // been since the user last did anything here, and this is the only
        // place that knows. See ssUpdateBrief.
        ssUpdateBrief({ lastActiveAt: Date.now() });
    };

    this.reset = function() {
        _state = emptyState();
        save();
    };

    /* ------------------------------------------------------------------ */
    /* Streaks                                                             */
    /*                                                                     */
    /* Built from the same per-day tally the analytics page already keeps,  */
    /* so nothing new is recorded to produce it - a streak is a reading of  */
    /* what was there, not another thing to store.                         */
    /*                                                                     */
    /* Per org, because the day tally is: "you have used this here N days   */
    /* running". Someone working across a sandbox and production has a      */
    /* streak in each, which is the honest answer - the counters behind     */
    /* them are separate.                                                   */
    /* ------------------------------------------------------------------ */

    // Something to aim at, spaced so the next one is always in sight.
    var STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365];
    var STREAK_STRIP_DAYS = 14;

    function milestoneFor(streak) {
        var reached = 0;
        for (var i = 0; i < STREAK_MILESTONES.length; i++) {
            if (streak >= STREAK_MILESTONES[i]) { reached = STREAK_MILESTONES[i]; }
        }
        return reached;
    }

    function nextMilestone(streak) {
        for (var i = 0; i < STREAK_MILESTONES.length; i++) {
            if (streak < STREAK_MILESTONES[i]) { return STREAK_MILESTONES[i]; }
        }
        return null;
    }

    /*
     * getStreak() -> { current, longest, activeToday, milestone, next,
     *                  toNext, strip }
     *
     * A day counts when anything at all was recorded on it. Today not being
     * used yet does not break the streak - it is still going until the day
     * ends - so the count runs back from yesterday and `activeToday` says
     * whether it has been kept up today.
     */
    this.getStreak = function() {
        var days = load().days || {};
        var todayKey = today();
        var activeToday = !!days[todayKey];

        var current = 0;
        var cursor = activeToday ? todayKey : previousDay(todayKey);
        while (days[cursor]) {
            current++;
            cursor = previousDay(cursor);
        }

        // Longest ever: walk the days in order, breaking the run wherever
        // the previous day is missing.
        var keys = Object.keys(days).sort();
        var longest = 0;
        var run = 0;
        var previous = null;
        keys.forEach(function(key) {
            run = (previous && previousDay(key) === previous) ? run + 1 : 1;
            if (run > longest) { longest = run; }
            previous = key;
        });

        // The last fortnight, oldest first, for the strip on the page.
        var strip = [];
        var walk = todayKey;
        for (var i = 0; i < STREAK_STRIP_DAYS; i++) {
            strip.unshift({ day: walk, active: !!days[walk], count: days[walk] || 0 });
            walk = previousDay(walk);
        }

        var next = nextMilestone(current);
        return {
            current: current,
            longest: longest,
            activeToday: activeToday,
            milestone: milestoneFor(current),
            next: next,
            toNext: next === null ? 0 : next - current,
            strip: strip
        };
    };

    /* ------------------------------------------------------------------ */
    /* Adaptive launcher opacity                                           */
    /*                                                                     */
    /* Once a week the launcher fades a little for people who are using it */
    /* and brightens for people who are not. Someone who opens it daily    */
    /* knows exactly where it is and does not need it shouting over the    */
    /* org's own UI; someone who has forgotten it is installed does.       */
    /*                                                                     */
    /* Kept outside the per-org record on purpose. The counters are per    */
    /* org, but opacity is one browser-wide preference, so scoring it per  */
    /* org would have a quiet sandbox brightening the same launcher that a */
    /* busy production org is trying to dim.                               */
    /* ------------------------------------------------------------------ */

    var ADAPT_KEY = 'SFDCSimplified_opacity_adapt_v1';
    var ADAPT_MIN = 30;
    var ADAPT_MAX = 100;
    var ADAPT_STEP = 10;
    var ADAPT_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
    // One menu open is a glance, not use. Three actions in a week is the bar
    // for "this is part of how I work", and the launcher page states it so
    // the behaviour is legible rather than mysterious.
    var ADAPT_ACTIVE_ACTIONS = 3;

    function loadAdapt() {
        try {
            var raw = localStorage.getItem(ADAPT_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            if (parsed && typeof parsed.reviewedAt === 'number') {
                if (typeof parsed.actions !== 'number') { parsed.actions = 0; }
                return parsed;
            }
        } catch (e) {
            // Fall through to a fresh cycle.
        }
        return { reviewedAt: Date.now(), actions: 0 };
    }

    function saveAdapt(state) {
        try {
            localStorage.setItem(ADAPT_KEY, JSON.stringify(state));
        } catch (e) {}
    }

    function clampOpacity(value) {
        if (typeof value !== 'number' || isNaN(value)) { return ADAPT_MAX; }
        return Math.max(ADAPT_MIN, Math.min(ADAPT_MAX, Math.round(value)));
    }

    /*
     * reviewOpacity(current) -> report, applying at most one week's change.
     *
     * Also the source of the explanation shown on the launcher page, so what
     * the user reads is the same calculation that moved the slider rather
     * than a description of it written separately.
     */
    this.reviewOpacity = function(current) {
        var state = loadAdapt();
        var now = Date.now();
        var elapsed = now - state.reviewedAt;
        var weeks = Math.floor(elapsed / ADAPT_PERIOD_MS);
        var active = state.actions >= ADAPT_ACTIVE_ACTIONS;
        var from = clampOpacity(current);
        var opacity = from;

        if (weeks >= 1) {
            if (active) {
                // One step down per review: someone using it every week
                // should drift to the floor gradually, not fall off it.
                opacity = clampOpacity(from - ADAPT_STEP);
            } else {
                // Several quiet weeks brighten by several steps, so a
                // forgotten launcher is properly visible on the day they
                // come back rather than one step brighter.
                opacity = clampOpacity(from + (ADAPT_STEP * weeks));
            }
            state.reviewedAt = now;
            state.actions = 0;
            saveAdapt(state);
        }

        return {
            opacity: opacity,
            from: from,
            changed: opacity !== from,
            active: active,
            actions: state.actions,
            threshold: ADAPT_ACTIVE_ACTIONS,
            direction: opacity === from ? 'steady' : (opacity < from ? 'down' : 'up'),
            min: ADAPT_MIN,
            max: ADAPT_MAX,
            step: ADAPT_STEP,
            reviewedAt: state.reviewedAt,
            nextReviewAt: state.reviewedAt + ADAPT_PERIOD_MS
        };
    };

    // Called when the user sets opacity by hand: their choice starts a fresh
    // week rather than being walked over by a review that was already due.
    this.noteOpacitySetManually = function() {
        saveAdapt({ reviewedAt: Date.now(), actions: 0 });
    };

    /* ------------------------------------------------------------------ */
    /* Reporting                                                           */
    /* ------------------------------------------------------------------ */

    function humanDuration(totalSeconds) {
        if (totalSeconds < 60) { return Math.round(totalSeconds) + ' seconds'; }
        var minutes = totalSeconds / 60;
        if (minutes < 60) { return Math.round(minutes) + ' minutes'; }
        var hours = minutes / 60;
        if (hours < 24) { return (Math.round(hours * 10) / 10) + ' hours'; }
        return (Math.round((hours / 24) * 10) / 10) + ' days';
    }

    /*
     * getUsage() -> {
     *   features: [{ key, label, count, seconds, share }],  most used first
     *   mostUsed, totalActions, activeDays, dailyAverage,
     *   timeSaved, firstUsed
     * }
     */
    this.getUsage = function() {
        var state = load();
        var features = [];
        var totalActions = 0;
        var totalSeconds = 0;

        Object.keys(FEATURES).forEach(function(key) {
            var count = state.counts[key] || 0;
            if (!count) { return; }
            var seconds = count * FEATURES[key].seconds;
            totalActions += count;
            totalSeconds += seconds;
            features.push({
                key: key,
                label: FEATURES[key].label,
                count: count,
                seconds: seconds
            });
        });

        // Most used first - that ordering is the answer to "what do people
        // actually use this for", so it is the view's default.
        features.sort(function(a, b) { return b.count - a.count; });
        features.forEach(function(entry) {
            entry.share = totalActions ? Math.round((entry.count / totalActions) * 100) : 0;
        });

        var activeDays = Object.keys(state.days).length;

        return {
            features: features,
            mostUsed: features.length ? features[0] : null,
            totalActions: totalActions,
            activeDays: activeDays,
            dailyAverage: activeDays ? Math.round(totalActions / activeDays) : 0,
            timeSaved: humanDuration(totalSeconds),
            timeSavedSeconds: totalSeconds,
            firstUsed: state.firstUsed || null
        };
    };

    /* ------------------------------------------------------------------ */
    /* Org API consumption                                                 */
    /* ------------------------------------------------------------------ */

    /*
     * Daily API usage for the org as a whole, from /limits. This is the org's
     * consumption, not this extension's - the platform does not attribute API
     * calls to a caller - so the view labels it as such rather than implying
     * the extension is responsible for it.
     */
    this.getApiUsage = function() {
        return sfdc.get(ssRestBase() + '/limits').then(function(data) {
            var limit = data && data.DailyApiRequests;
            if (!limit || typeof limit.Max !== 'number' || !limit.Max) { return null; }
            var remaining = typeof limit.Remaining === 'number' ? limit.Remaining : limit.Max;
            var used = limit.Max - remaining;
            return {
                used: used,
                max: limit.Max,
                remaining: remaining,
                percent: Math.round((used / limit.Max) * 100)
            };
        }, function() {
            return null;
        });
    };

    /* ------------------------------------------------------------------ */
    /* The rest of the platform limits                                     */
    /*                                                                     */
    /* /limits answers with several dozen entries and this read exactly one */
    /* of them. The others are the ones that actually bite: storage fills   */
    /* up quietly, async Apex runs out mid-batch, and an org near its       */
    /* permission set ceiling fails the next deployment with an error that  */
    /* names nothing useful.                                               */
    /*                                                                     */
    /* Nothing here lists which limits exist. Salesforce adds them every    */
    /* release, so anything with a numeric Max and Remaining is reported,   */
    /* and a limit introduced next release appears without being taught.    */
    /* ------------------------------------------------------------------ */

    /*
     * "DailyAsyncApexExecutions" -> "Daily Async Apex Executions".
     *
     * The API's own key is the only name available - /limits carries no
     * labels - so it is split on the case boundary rather than looked up.
     * The acronyms are fixed up afterwards because "Api" and "Mb" read as
     * mistakes, and there are few enough of them to say out loud.
     */
    var ACRONYMS = { 'Api': 'API', 'Mb': 'MB', 'Id': 'ID', 'Cpu': 'CPU', 'Sms': 'SMS' };

    function labelForLimit(key) {
        return String(key)
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .split(' ')
            .map(function(word) { return ACRONYMS[word] || word; })
            .join(' ');
    }

    /*
     * A limit worth showing has a ceiling and a remainder, both numbers.
     * /limits also carries per-namespace sub-objects for managed packages,
     * which have the same shape one level down and are not org limits.
     */
    function readableLimit(key, entry) {
        if (!entry || typeof entry.Max !== 'number' || typeof entry.Remaining !== 'number') {
            return null;
        }
        if (entry.Max <= 0) { return null; }
        var used = entry.Max - entry.Remaining;
        return {
            key: key,
            label: labelForLimit(key),
            used: used,
            max: entry.Max,
            remaining: entry.Remaining,
            percent: Math.round((used / entry.Max) * 100)
        };
    }

    this.getPlatformLimits = function() {
        return sfdc.get(ssRestBase() + '/limits').then(function(data) {
            if (!data) { return []; }
            var limits = [];
            Object.keys(data).forEach(function(key) {
                var limit = readableLimit(key, data[key]);
                if (limit) { limits.push(limit); }
            });
            // Closest to its ceiling first: that is the one about to cause a
            // failure, and the reason to look at this page at all.
            limits.sort(function(a, b) { return b.percent - a.percent || a.label.localeCompare(b.label); });
            return limits;
        }, function() {
            return [];
        });
    };

    /*
     * Licences, which /limits does not report.
     *
     * An org runs out of these long before it runs out of API calls, and the
     * failure is somebody being unable to log in rather than a request being
     * refused - so it is worth seeing beside the rest.
     */
    this.getLicenseUsage = function() {
        var soql = 'SELECT Name, TotalLicenses, UsedLicenses FROM UserLicense ' +
                   "WHERE Status = 'Active' AND TotalLicenses > 0 ORDER BY Name";
        return $q.when(sfdc.query(soql)).then(function(data) {
            var rows = (data && data.records) ? data.records : [];
            return rows.map(function(row) {
                var total = row.TotalLicenses || 0;
                var used = row.UsedLicenses || 0;
                return {
                    label: row.Name,
                    used: used,
                    max: total,
                    remaining: Math.max(total - used, 0),
                    percent: total ? Math.round((used / total) * 100) : 0
                };
            }).sort(function(a, b) { return b.percent - a.percent; });
        }, function() {
            // UserLicense needs "View Setup and Configuration"; without it the
            // section is absent rather than broken.
            return [];
        });
    };

    /* ------------------------------------------------------------------ */
    /* Org usage                                                           */
    /* ------------------------------------------------------------------ */

    // Same "settle rather than reject" discipline the ticker uses: one
    // unreadable object must not blank the whole panel.
    function settle(promise) {
        return $q.when(promise).then(function(value) { return value; },
                                     function() { return null; });
    }

    function available(name) {
        return SchemaService.restCanQuery(name) || SchemaService.toolingCanQuery(name);
    }

    function countToday(object, dateField, extraWhere) {
        if (!available(object)) { return $q.when(null); }
        var soql = 'SELECT COUNT() FROM ' + object +
                   ' WHERE ' + dateField + ' = TODAY' +
                   (extraWhere ? (' AND ' + extraWhere) : '');
        return settle(sfdc.query(soql).then(function(data) {
            if (!data || data.ssUnsupported) { return null; }
            return typeof data.totalSize === 'number' ? data.totalSize : null;
        }));
    }

    // GROUP BY returns one row per value, so the row count is the distinct
    // count - SOQL has no COUNT(DISTINCT).
    function distinctToday(object, field, dateField, extraWhere) {
        if (!available(object)) { return $q.when(null); }
        var soql = 'SELECT COUNT(Id) FROM ' + object +
                   ' WHERE ' + dateField + ' = TODAY' +
                   (extraWhere ? (' AND ' + extraWhere) : '') +
                   ' GROUP BY ' + field;
        return settle(sfdc.query(soql).then(function(data) {
            if (!data || data.ssUnsupported || !data.records) { return null; }
            return data.records.length;
        }));
    }

    /*
     * getOrgUsage() -> promise({ ... }) - how the org itself is being used
     * today, as distinct from how this extension is being used.
     *
     * LoginHistory needs setup-level read access and simply resolves null for
     * everyone else, so each figure is rendered only when it has a value
     * rather than being shown as a misleading zero.
     */
    this.getOrgUsage = function() {
        return SchemaService.ready().then(function() {
            return $q.all({
                logins:        countToday('LoginHistory', 'LoginTime'),
                activeUsers:   distinctToday('LoginHistory', 'UserId', 'LoginTime'),
                failedLogins:  countToday('LoginHistory', 'LoginTime', "Status != 'Success'"),
                // Logs captured, not errors: an ApexLog row is a debug log,
                // which is what the view says it is.
                debugLogs:     countToday('ApexLog', 'StartTime'),
                totalUsers:    settle(sfdc.query(
                                   'SELECT COUNT() FROM User WHERE IsActive = true'
                               ).then(function(data) {
                                   return data && typeof data.totalSize === 'number'
                                        ? data.totalSize : null;
                               }))
            });
        }).then(function(result) {
            // Adoption only means something when both halves are known.
            if (result.activeUsers && result.totalUsers) {
                result.adoption = Math.round((result.activeUsers / result.totalUsers) * 100);
            }
            return result;
        }, function() {
            return {};
        });
    };

    function refreshWeeklyUsageFromOrg(org, cacheKey) {
        var deferred = $q.defer();
        var scores = Object.create(null);

        var AUDIT_SECTION_MAP = {
            'Apex Class': 'ApexClass',
            'Apex Trigger': 'ApexTrigger',
            'Apex Page': 'ApexPage',
            'Flow': 'Flow',
            'Custom Field': 'CustomField',
            'Custom Object': 'CustomObject',
            'Validation Rule': 'ValidationRule',
            'Profile': 'Profile',
            'Permission Set': 'PermissionSet',
            'Page Layout': 'Layout',
            'Custom Label': 'CustomLabel',
            'Workflow': 'WorkflowRule'
        };

        var pAudit = sfdc.query("SELECT Section, Action FROM SetupAuditTrail ORDER BY CreatedDate DESC LIMIT 200").then(function(data) {
            if (data && data.records) {
                for (var i = 0; i < data.records.length; i++) {
                    var r = data.records[i];
                    var sec = r.Section || r.Action || '';
                    for (var key in AUDIT_SECTION_MAP) {
                        if (sec.includes(key)) {
                            var val = AUDIT_SECTION_MAP[key];
                            scores[val] = (scores[val] || 0) + 5;
                        }
                    }
                }
            }
        }, function() {});

        var pRecent = sfdc.query("SELECT Type FROM RecentlyViewed WHERE LastViewedDate != null ORDER BY LastViewedDate DESC LIMIT 200").then(function(data) {
            if (data && data.records) {
                for (var i = 0; i < data.records.length; i++) {
                    var type = data.records[i] && data.records[i].Type;
                    if (type) {
                        scores[type] = (scores[type] || 0) + 3;
                    }
                }
            }
        }, function() {});

        $q.all([pAudit, pRecent]).then(function() {
            var now = Date.now();
            var payload = { lastUpdated: now, scores: scores };
            try {
                var write = {};
                write[cacheKey] = payload;
                chrome.storage.local.set(write, function() {
                    void chrome.runtime.lastError;
                });
            } catch(e) {}
            deferred.resolve(payload);
        }, function() {
            deferred.resolve({ lastUpdated: Date.now(), scores: scores });
        });

        return deferred.promise;
    }

    this.getWeeklyOrgMenuUsage = function() {
        var org = (typeof ssOrgKey === 'function' && ssOrgKey(window.location.hostname)) || 'global';
        var cacheKey = 'SS_weekly_menu_usage_' + org;
        var ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
        var now = Date.now();
        var deferred = $q.defer();

        try {
            chrome.storage.local.get([cacheKey], function(result) {
                void chrome.runtime.lastError;
                var cached = result && result[cacheKey];
                if (cached && cached.lastUpdated && (now - cached.lastUpdated < ONE_WEEK_MS) && cached.scores) {
                    deferred.resolve(cached);
                    return;
                }
                refreshWeeklyUsageFromOrg(org, cacheKey).then(function(fresh) {
                    deferred.resolve(fresh);
                }, function() {
                    deferred.resolve(cached || { scores: {} });
                });
            });
        } catch(e) {
            deferred.resolve({ scores: {} });
        }

        return deferred.promise;
    };
}]);
