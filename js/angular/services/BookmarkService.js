/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
var app = window.app || angular.module("SalesforceSimplifiedApp");

/*
 * Watching a handful of components.
 *
 * The org tells you what changed only if you go and ask, and the audit trail
 * answers for the whole org at once - which is far too much to read when the
 * question is "has anyone touched the three classes my release depends on".
 * So this is a short, explicit list of components the user cares about, and a
 * record of every time one of them moved.
 *
 * Change is detected by comparing LastModifiedDate against the value stored
 * when the component was bookmarked or last checked, rather than by reading
 * SetupAuditTrail. Two reasons: the audit trail's Display text is prose, so
 * tying a row to a specific component means string-matching a sentence; and it
 * needs "View Setup and Configuration", which plenty of developers do not
 * have. Querying the components themselves needs only the read access the
 * user already used to find them.
 *
 * A component that has disappeared from the query is treated as deleted, which
 * is the one thing LastModifiedDate cannot report - a deleted row has no
 * timestamp to compare.
 *
 * Everything lives in localStorage, keyed by user id the way the news timeline
 * is, so two orgs open in one browser do not read each other's bookmarks.
 */
app.service('BookmarkService', function($q, sfdc, UserId) {

    var IDS_PER_QUERY = 200;          // the SOQL IN-clause chunk used elsewhere
    var MAX_BOOKMARKS = 100;
    var MAX_EVENTS = 300;
    var RETENTION_DAYS = 30;

    function storageKey(suffix) {
        var uid = (UserId && UserId.id) ? UserId.id : 'default';
        return 'Simplified_Bookmarks_' + suffix + '_' + uid;
    }

    function readList(suffix) {
        try {
            var raw = localStorage.getItem(storageKey(suffix));
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            // Corrupt or unreadable storage is an empty list, not an exception
            // that takes the panel down on open.
            return [];
        }
    }

    function writeList(suffix, list) {
        try {
            localStorage.setItem(storageKey(suffix), JSON.stringify(list));
            return true;
        } catch (e) {
            // Quota, or storage disabled. The caller has already updated what
            // is on screen; saying so is better than pretending it saved.
            return false;
        }
    }

    // Type and id together: two objects can carry the same 18-character id in
    // different orgs, and the same id never appears twice within one type.
    function keyOf(type, id) { return String(type) + ':' + String(id); }

    /* ------------------------------------------------------------------ */
    /* The bookmarks themselves                                            */
    /* ------------------------------------------------------------------ */

    this.list = function() { return readList('Items'); };

    this.count = function() { return this.list().length; };

    this.isBookmarked = function(type, id) {
        if (!type || !id) { return false; }
        var wanted = keyOf(type, id);
        return this.list().some(function(item) {
            return keyOf(item.type, item.id) === wanted;
        });
    };

    this.max = MAX_BOOKMARKS;

    /*
     * `record` is a row as the grid holds it, `meta` the selected metadata
     * entry it came from. The name is stored now rather than looked up later
     * because the field it lives in differs by type - Name, DeveloperName,
     * MasterLabel - and after a delete there is nothing left to ask.
     */
    this.add = function(record, meta) {
        if (!record || !record.Id) { return { ok: false, reason: 'This row has no id to watch.' }; }
        var type = meta && (meta.value || meta.label);
        if (!type) { return { ok: false, reason: 'Unknown metadata type.' }; }

        var items = this.list();
        if (items.length >= MAX_BOOKMARKS) {
            /*
             * Said as a state, not as a rule.
             *
             * "Up to 100 bookmarks" reads as a limit somewhere in the future;
             * what has actually happened is that the list is full now and this
             * click did nothing. The count is in it because the next question
             * is always how many that is.
             */
            return {
                ok: false,
                full: true,
                reason: 'The watch list is full - it already holds ' + MAX_BOOKMARKS +
                        ' components. Stop watching something before adding more.'
            };
        }
        if (this.isBookmarked(type, record.Id)) { return { ok: true, already: true }; }

        items.push({
            type: type,
            typeLabel: (meta && meta.label) || type,
            id: record.Id,
            name: record.Name || record.DeveloperName || record.MasterLabel ||
                  record.QualifiedApiName || record.Id,
            // The baseline every later check is compared against. A bookmark
            // with no timestamp would report "changed" on its first check.
            lastModifiedDate: record.LastModifiedDate || null,
            lastModifiedById: record.LastModifiedById || null,
            bookmarkedAt: Date.now(),
            missingSince: null
        });
        var saved = writeList('Items', items);
        return { ok: true, saved: saved };
    };

    /*
     * Fill in a baseline for a bookmark added from a list that did not carry
     * LastModifiedDate. Without one the first check has nothing to compare
     * against and would announce a change that never happened.
     */
    this.baseline = function(type, id, row) {
        if (!row) { return; }
        var wanted = keyOf(type, id);
        writeList('Items', this.list().map(function(item) {
            if (keyOf(item.type, item.id) === wanted) {
                item.lastModifiedDate = row.LastModifiedDate || item.lastModifiedDate;
                item.lastModifiedById = row.LastModifiedById || item.lastModifiedById;
            }
            return item;
        }));
    };

    this.remove = function(type, id) {
        var wanted = keyOf(type, id);
        writeList('Items', this.list().filter(function(item) {
            return keyOf(item.type, item.id) !== wanted;
        }));
    };

    /*
     * Everything of one type at once.
     *
     * A watch list built during a release is usually made of one type at a
     * time - the classes for this change, then the profiles - and it is
     * cleared the same way. Doing that one row at a time is a rewrite of
     * storage per click.
     */
    this.removeType = function(type) {
        var before = this.list();
        var kept = before.filter(function(item) { return item.type !== type; });
        writeList('Items', kept);
        return before.length - kept.length;
    };

    // What is being watched, grouped for a by-type control. Ordered by the
    // count, so the type worth clearing first is the one nearest to hand.
    this.countsByType = function() {
        var counts = Object.create(null);
        this.list().forEach(function(item) {
            var entry = counts[item.type] ||
                        (counts[item.type] = { type: item.type, label: item.typeLabel, count: 0 });
            entry.count++;
        });
        return Object.keys(counts).map(function(type) { return counts[type]; })
            .sort(function(a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
    };

    this.clear = function() { writeList('Items', []); };

    /* ------------------------------------------------------------------ */
    /* The timeline                                                        */
    /* ------------------------------------------------------------------ */

    this.timeline = function() { return readList('Events'); };

    this.clearTimeline = function() { writeList('Events', []); };

    this.unseenCount = function() {
        return this.timeline().filter(function(event) { return !event.seen; }).length;
    };

    this.markAllSeen = function() {
        writeList('Events', this.timeline().map(function(event) {
            event.seen = true;
            return event;
        }));
    };

    function recordEvents(newEvents) {
        if (!newEvents.length) { return; }
        var cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);

        /*
         * Pruned by when the change was noticed, not by when it happened.
         *
         * These were the same thing while `at` was the detection time. Once
         * `at` became the org's own LastModifiedDate - which it had to, or the
         * row sorts into the wrong place against audit history - pruning on it
         * started discarding events at the moment they were recorded: an edit
         * made in April and discovered today is four months old by this
         * measure, so a thirty-day window threw it away before the user ever
         * saw it. Retention is about how long this keeps what it saw, so it
         * counts from when it saw it.
         */
        var kept = newEvents.concat(readList('Events'))
            .filter(function(event) {
                if (!event) { return false; }
                var noticed = event.detectedAt || event.at;
                return noticed >= cutoff;
            })
            .slice(0, MAX_EVENTS);
        writeList('Events', kept);
    }

    /* ------------------------------------------------------------------ */
    /* History from before the watch started                               */
    /*                                                                     */
    /* The timeline can only hold what this extension saw, and it starts    */
    /* seeing when you star something. SetupAuditTrail holds what the org   */
    /* saw, which is everything, so it can fill in the past - at a cost     */
    /* worth being honest about.                                           */
    /*                                                                     */
    /* SetupAuditTrail carries no component id. It records Section, Action  */
    /* and a Display sentence, so tying a row to a component means finding  */
    /* the component's name inside that sentence. That is a guess, and it   */
    /* is wrong in both directions: a component renamed since the change    */
    /* will not be found under its current name, and a name that reads as   */
    /* an ordinary word will match rows about something else.               */
    /*                                                                     */
    /* Hence a toggle rather than always-on, entries marked as coming from  */
    /* the audit trail, and nothing from here written into stored history - */
    /* these are re-derived on demand and never mixed into what was         */
    /* actually observed.                                                   */
    /* ------------------------------------------------------------------ */

    var HISTORY_DAYS = 180;              // SetupAuditTrail's own retention
    var HISTORY_ROW_LIMIT = 2000;
    /*
     * Short names are refused rather than matched loosely.
     *
     * The floor is five because the names that cause trouble are four: Test,
     * Type, Name, Case, Task, User. Each is an ordinary English word that
     * appears in audit sentences about unrelated things, so a four-character
     * floor admits exactly the names it is meant to exclude - which is what
     * this was set to before the examples were checked against it.
     *
     * Five still admits Order, Quote, Asset and most real component names.
     * Anything shorter is reported as skipped rather than dropped in silence,
     * so the user can see that a component was left out and why.
     */
    var MIN_MATCHABLE_NAME = 5;

    this.historyDays = HISTORY_DAYS;
    this.minMatchableName = MIN_MATCHABLE_NAME;

    /* ------------------------------------------------------------------ */
    /* Auto-refresh                                                        */
    /*                                                                     */
    /* Off, or one of a few intervals. Not a free-text number of minutes:   */
    /* every tick is a query per watched type, and a field where someone    */
    /* can type 1 is a field where someone types 1.                         */
    /* ------------------------------------------------------------------ */

    var AUTO_REFRESH_CHOICES = [0, 5, 15, 30, 60];
    this.autoRefreshChoices = AUTO_REFRESH_CHOICES;

    this.autoRefreshMinutes = function() {
        var raw;
        try { raw = localStorage.getItem(storageKey('AutoRefresh')); }
        catch (e) { return 0; }
        var minutes = parseInt(raw, 10);
        // Anything not on the list - a stale value, a hand-edited one - is
        // off rather than honoured.
        return AUTO_REFRESH_CHOICES.indexOf(minutes) > 0 ? minutes : 0;
    };

    this.setAutoRefreshMinutes = function(minutes) {
        var value = AUTO_REFRESH_CHOICES.indexOf(parseInt(minutes, 10)) > 0
            ? parseInt(minutes, 10) : 0;
        try { localStorage.setItem(storageKey('AutoRefresh'), String(value)); }
        catch (e) { /* not kept; the timer still runs this session */ }
        return value;
    };

    // When the org was last actually asked - shown so an idle timer cannot be
    // mistaken for a component that has not changed.
    this.lastCheckedAt = function() {
        var raw;
        try { raw = localStorage.getItem(storageKey('LastChecked')); }
        catch (e) { return null; }
        var at = parseInt(raw, 10);
        return isNaN(at) ? null : at;
    };

    function recordChecked() {
        try { localStorage.setItem(storageKey('LastChecked'), String(Date.now())); }
        catch (e) { /* nothing to do */ }
    }

    /* ------------------------------------------------------------------ */
    /* Being told, or not                                                  */
    /*                                                                     */
    /* On unless it has been turned off, because a watch list that finds a  */
    /* change and says nothing is a watch list that did not work as far as  */
    /* the user can tell. But a release with fifty watched components fires */
    /* a toast on every check, and at that point the notice is noise over   */
    /* the thing being worked on - so it can be switched off without        */
    /* unwatching anything or losing the timeline.                          */
    /*                                                                     */
    /* Read as "not off" rather than "is on": an absent preference is a     */
    /* user who has never touched it, and they should be told.              */
    /* ------------------------------------------------------------------ */
    this.notifyEnabled = function() {
        try { return localStorage.getItem(storageKey('Notify')) !== 'off'; }
        catch (e) { return true; }
    };

    this.setNotifyEnabled = function(on) {
        try { localStorage.setItem(storageKey('Notify'), on ? 'on' : 'off'); }
        catch (e) { /* preference not kept; it still holds for this session */ }
        return !!on;
    };

    this.historyEnabled = function() {
        try { return localStorage.getItem(storageKey('History')) === 'on'; }
        catch (e) { return false; }
    };

    this.setHistoryEnabled = function(on) {
        try { localStorage.setItem(storageKey('History'), on ? 'on' : 'off'); }
        catch (e) { /* preference not kept; the toggle still works this session */ }
    };

    /*
     * Whole-name match, not substring.
     *
     * "Account" must not match "AccountHelper", or watching a common object
     * pulls in every row about anything built on it. Word characters include
     * the underscore and digits that API names are full of, so the boundary is
     * checked directly rather than with \b - \b sits happily between "t" and
     * "_", which would let Billing match Billing_Helper.
     */
    function mentions(display, name) {
        if (!display || !name || name.length < MIN_MATCHABLE_NAME) { return false; }
        var haystack = String(display).toLowerCase();
        var needle = String(name).toLowerCase();
        var at = haystack.indexOf(needle);
        while (at !== -1) {
            var before = at === 0 ? '' : haystack.charAt(at - 1);
            var after = haystack.charAt(at + needle.length);
            var isWord = function(ch) { return ch !== '' && /[a-z0-9_]/.test(ch); };
            if (!isWord(before) && !isWord(after)) { return true; }
            at = haystack.indexOf(needle, at + 1);
        }
        return false;
    }
    this.mentions = mentions;

    /*
     * One query for every watched component, matched client-side.
     *
     * Filtering on Display in SOQL would push the work to the org, but the
     * field's filterability is not something every org agrees on, and one
     * refused query would cost the whole feature. A bounded read plus local
     * matching behaves the same everywhere.
     */
    this.auditHistoryFor = function(items) {
        var watched = (items || []).filter(function(item) {
            return item && item.name && String(item.name).length >= MIN_MATCHABLE_NAME;
        });
        var tooShort = (items || []).length - watched.length;

        if (!watched.length) {
            return $q.when({ events: [], truncated: false, tooShort: tooShort, refused: false });
        }

        var soql = 'SELECT Id, Action, Section, Display, CreatedDate, CreatedBy.Name ' +
                   'FROM SetupAuditTrail WHERE CreatedDate = LAST_N_DAYS:' + HISTORY_DAYS +
                   ' ORDER BY CreatedDate DESC LIMIT ' + HISTORY_ROW_LIMIT;

        return $q.when(sfdc.query(soql)).then(function(data) {
            var rows = (data && data.records) ? data.records : [];
            var events = [];

            rows.forEach(function(row) {
                /*
                 * A row with no readable date cannot go on a timeline.
                 *
                 * Date.parse returns NaN here, and the || 0 that used to stand
                 * in for it renders as 1 January 1970 - a date that is not
                 * merely wrong but confidently wrong, sitting at the bottom of
                 * the list looking like the oldest thing that ever happened.
                 * Dropping the row is the honest answer.
                 */
                var at = Date.parse(row.CreatedDate);
                if (isNaN(at)) { return; }

                watched.forEach(function(item) {
                    if (!mentions(row.Display, item.name)) { return; }
                    events.push({
                        source: 'audit',
                        kind: 'history',
                        // The audit row this came from. One setup change per
                        // profile lands as several rows naming the same class
                        // at the same second, and without this they are
                        // indistinguishable.
                        auditId: row.Id || null,
                        type: item.type,
                        typeLabel: item.typeLabel,
                        id: item.id,
                        name: item.name,
                        at: at,
                        seen: true,               // history is not news
                        byName: (row.CreatedBy && row.CreatedBy.Name) || null,
                        section: row.Section || '',
                        action: row.Action || '',
                        display: row.Display || ''
                    });
                });
            });

            events.sort(function(a, b) { return b.at - a.at; });
            return {
                events: events,
                // A full page back means older changes exist that were not read.
                truncated: rows.length >= HISTORY_ROW_LIMIT,
                tooShort: tooShort,
                refused: false
            };
        }, function() {
            // SetupAuditTrail needs "View Setup and Configuration", which
            // plenty of developers do not have. That costs the history and
            // nothing else.
            return { events: [], truncated: false, tooShort: tooShort, refused: true };
        });
    };

    /* ------------------------------------------------------------------ */
    /* Detecting change                                                    */
    /* ------------------------------------------------------------------ */

    function quote(value) { return "'" + escapeSoqlLiteral(String(value)) + "'"; }

    function chunk(list, size) {
        var out = [];
        for (var i = 0; i < list.length; i += size) { out.push(list.slice(i, i + size)); }
        return out;
    }

    /*
     * One query per type. LastModifiedDate and LastModifiedById exist on every
     * type that can be bookmarked from a list; a type that refuses the query
     * resolves to null and is skipped rather than reported as deleted, because
     * "I could not ask" and "it is gone" must not look the same.
     */
    function fetchCurrent(type, ids) {
        return $q.all(chunk(ids, IDS_PER_QUERY).map(function(group) {
            var soql = 'SELECT Id, LastModifiedDate, LastModifiedById FROM ' + type +
                       ' WHERE Id IN (' + group.map(quote).join(',') + ')';
            return $q.when(sfdc.query(soql)).then(function(data) {
                return (data && data.records) ? data.records : [];
            }, function() {
                return null;
            });
        })).then(function(pages) {
            if (pages.some(function(page) { return page === null; })) { return null; }
            return pages.reduce(function(all, page) { return all.concat(page); }, []);
        });
    }

    /*
     * Returns the events discovered by this check, and updates each bookmark's
     * stored timestamp so the same edit is not reported twice.
     */
    this.checkForChanges = function() {
        var self = this;
        var items = self.list();
        if (!items.length) { return $q.when([]); }

        var byType = Object.create(null);
        items.forEach(function(item) {
            (byType[item.type] = byType[item.type] || []).push(item);
        });
        var types = Object.keys(byType);

        return $q.all(types.map(function(type) {
            return fetchCurrent(type, byType[type].map(function(item) { return item.id; }));
        })).then(function(results) {
            var events = [];
            var now = Date.now();
            var touchedBy = Object.create(null);

            results.forEach(function(records, i) {
                var type = types[i];
                if (records === null) { return; }   // refused; leave these alone

                var current = Object.create(null);
                records.forEach(function(row) { current[row.Id] = row; });

                byType[type].forEach(function(item) {
                    var live = current[item.id];

                    if (!live) {
                        // Reported once. Without this the component would
                        // generate a fresh "deleted" event on every check for
                        // as long as the bookmark is kept.
                        if (item.missingSince) { return; }
                        item.missingSince = now;
                        events.push({
                            kind: 'deleted', type: type, typeLabel: item.typeLabel,
                            id: item.id, name: item.name, at: now, seen: false,
                            /*
                             * The only event whose time really is the time we
                             * noticed. A deleted row has no timestamp left to
                             * read, so this is when it was found missing and
                             * not when anyone deleted it - flagged so the page
                             * can say "noticed" rather than claim otherwise.
                             */
                            atIsDetection: true, detectedAt: now,
                            byId: null, byName: null
                        });
                        return;
                    }

                    // It came back: an earlier delete was a permissions blip or
                    // a filter, not a deletion.
                    item.missingSince = null;

                    var was = item.lastModifiedDate;
                    if (was && live.LastModifiedDate && live.LastModifiedDate !== was) {
                        /*
                         * When the edit happened, not when this noticed it.
                         *
                         * These two are far apart whenever the panel has been
                         * shut for a while - a change made last month, seen
                         * today, was being stamped today. On its own that only
                         * misdates a row; merged with audit-trail history,
                         * which carries real historical dates, it also sorts
                         * the row into the wrong place, so the same edit
                         * appears above changes that genuinely came after it.
                         *
                         * LastModifiedDate is the org's own answer, so it is
                         * the one to keep. The detection time is kept beside
                         * it rather than thrown away - it is what "checked N
                         * minutes ago" is measured from.
                         */
                        var changedAt = Date.parse(live.LastModifiedDate);
                        events.push({
                            kind: 'changed', type: type, typeLabel: item.typeLabel,
                            id: item.id, name: item.name,
                            at: isNaN(changedAt) ? now : changedAt,
                            atIsDetection: isNaN(changedAt),
                            detectedAt: now,
                            seen: false,
                            from: was, to: live.LastModifiedDate,
                            byId: live.LastModifiedById || null, byName: null
                        });
                        if (live.LastModifiedById) { touchedBy[live.LastModifiedById] = true; }
                    }
                    item.lastModifiedDate = live.LastModifiedDate || was;
                    item.lastModifiedById = live.LastModifiedById || item.lastModifiedById;
                });
            });

            writeList('Items', items);
            recordChecked();
            if (!events.length) { return []; }

            // Who did it, in one query for the whole batch.
            var ids = Object.keys(touchedBy);
            if (!ids.length) { recordEvents(events); return events; }

            return $q.when(sfdc.query(
                'SELECT Id, Name FROM User WHERE Id IN (' + ids.map(quote).join(',') + ')'
            )).then(function(data) {
                var names = Object.create(null);
                ((data && data.records) || []).forEach(function(user) { names[user.Id] = user.Name; });
                events.forEach(function(event) {
                    if (event.byId && names[event.byId]) { event.byName = names[event.byId]; }
                });
                return events;
            }, function() {
                // Names refused - the change itself is still the news.
                return events;
            }).then(function(resolved) {
                recordEvents(resolved);
                return resolved;
            });
        });
    };
});
