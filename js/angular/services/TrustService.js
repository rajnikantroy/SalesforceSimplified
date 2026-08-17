/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * TrustService.js
 * Salesforce Simplified - Salesforce Trust Status (org-specific).
 *
 * Resolves the org's instance key from the Organization object, then pulls
 * that instance's live status from the public Trust API. The API is CORS-open
 * (access-control-allow-origin: *) so it can be called straight from the
 * content script. Every public method settles - a blocked endpoint or a
 * missing InstanceName yields { error } instead of a rejection, so the panel
 * can say what happened rather than failing silently.
 */
(function() {
    'use strict';
    var app = window.app || angular.module("SalesforceSimplifiedApp");

    var TRUST_API = 'https://api.status.salesforce.com/v1/';
    var TRUST_TIMEOUT_MS = 15000;

    // The API's status codes, which are not showable as they come.
    var STATUS_LABELS = {
        'OK': 'OK',
        'MAJOR_INCIDENT_CORE': 'Major Incident (Core)',
        'MAJOR_INCIDENT_NONCORE': 'Major Incident',
        'MINOR_INCIDENT_CORE': 'Minor Incident (Core)',
        'MINOR_INCIDENT_NONCORE': 'Minor Incident',
        'MAINTENANCE_CORE': 'Maintenance (Core)',
        'MAINTENANCE_NONCORE': 'Maintenance'
    };

    /*
     * A sanity bound, not the display width.
     *
     * This was 55 characters, chosen when the footer was a narrow strip shared
     * with four stat tabs. The footer now gives the ticker the whole bar, and
     * a fixed character count cannot know how wide that is - so on a
     * full-screen window a headline was cut to "...multiple customers with
     * the..." with most of the bar left empty.
     *
     * The display decides how much shows, by measuring the bar it has to fill
     * (see buildVisibleNews). This only stops a multi-paragraph incident
     * message from being carried around in full for a line that can never
     * show it.
     */
    var TICKER_MAX = 300;
    var TICKER_LINES = 3;

    app.service('TrustService', ['$q', 'sfdc', function($q, sfdc) {
        var self = this;

        // Resolved once per page and memoised; the panel is opened repeatedly
        // during a session, but the instance never changes.
        var instanceKeyPromise = null;

        this.getInstanceKey = function() {
            if (instanceKeyPromise) {
                return instanceKeyPromise;
            }
            instanceKeyPromise = sfdc.query("SELECT Id, InstanceName FROM Organization LIMIT 1")
                .then(function(data) {
                    var record = data && data.records && data.records[0];
                    var key = record && record.InstanceName;
                    if (!key) {
                        return $q.reject({ message: 'This org does not expose an instance key.' });
                    }
                    key = String(key).trim();
                    // The service worker cannot run this query - it has no
                    // session - but it can ask the public Trust API about an
                    // instance it already knows the name of. See ssUpdateBrief.
                    ssUpdateBrief({ instanceKey: key, alias: orgAlias() });
                    return key;
                }, function(error) {
                    /*
                     * Memoise the answer, never the failure.
                     *
                     * The instance never changes, so caching it is right - but
                     * caching a rejection meant one unlucky lookup was the
                     * answer for the rest of the page's life, and Refresh
                     * handed back the same stale error without going near the
                     * network. The usual cause is the cheapest possible one:
                     * this query is in flight when the menu closes and
                     * cancelPending() aborts it.
                     */
                    instanceKeyPromise = null;
                    return $q.reject(error);
                });
            return instanceKeyPromise;
        };

        /*
         * What actually went wrong, in the user's words.
         *
         * "Trust API request failed." was reported for everything, including
         * the failures that never reached the Trust API: resolving the
         * instance goes through a SOQL query, and a cancelled or refused
         * query has no .message of its own, so it fell through to that line
         * and sent people looking at an API that was working fine.
         */
        function describe(error) {
            if (!error) { return 'Trust Status could not be loaded.'; }
            if (error.cancelled) {
                return 'The request was cancelled before it finished. Try again.';
            }
            if (error.message) { return error.message; }
            // A query rejection: let SfdcApi phrase it - no session, timed
            // out, permissions - since it is the one that knows.
            return sfdc.errorMessage(error, 'Organization') ||
                   'Trust Status could not be loaded.';
        }

        // Every public method settles: callers get the payload or an
        // { error } marker, never a rejection.
        function settle(promise) {
            return $q.when(promise).then(function(data) {
                return data;
            }, function(error) {
                return { error: describe(error) };
            });
        }

        function fetchTrust(path) {
            var deferred = $q.defer();
            $.ajax({
                url: TRUST_API + path,
                type: 'GET',
                dataType: 'json',
                timeout: TRUST_TIMEOUT_MS
            }).done(function(data) {
                deferred.resolve(data);
            }).fail(function(xhr) {
                deferred.reject({ message: 'Trust API unreachable (HTTP ' + (xhr && xhr.status) + ').' });
            });
            return deferred.promise;
        }

        function fetchStatus(key) {
            return fetchTrust('instances/' + encodeURIComponent(key) + '/status');
        }

        /*
         * The same status document, asked for by My Domain instead of by
         * instance key.
         *
         * /instanceAliases/{alias}/status returns a document identical in
         * shape to /instances/{key}/status - same fields, same nesting - so
         * normalize() handles either without knowing which one it was given.
         */
        function fetchStatusByAlias(alias) {
            return fetchTrust('instanceAliases/' + encodeURIComponent(alias) + '/status');
        }

        /*
         * The My Domain of the org this extension is actually talking to,
         * which is the alias the Trust API knows it by.
         *
         * Deliberately ssApiOrigin() and not window.location: the two are not
         * always the same org. Signing in through the Connected App can point
         * the extension at a different one entirely - the card offers
         * Production, Sandbox and a custom URL - and from then on every query,
         * including the instance-key lookup this is the fallback for, runs
         * against that org rather than the host in the address bar. Reading
         * the browsed hostname here meant the panel named one org when the key
         * lookup answered and a different one when the fallback did, with
         * nothing on screen to say which.
         *
         * ssOrgKey reduces any of the org's UI hosts to its own domain, and
         * the alias is the first label of that - acme, from
         * acme.my.salesforce.com or acme.lightning.force.com alike. It returns
         * null for a host that is not a UI host, which an OAuth instance_url
         * often is not (na45.salesforce.com, for an org without enhanced
         * domains). Null is the right answer there: reporting the browsed
         * org's status instead would be confidently describing the wrong org.
         */
        function orgAlias() {
            if (typeof ssOrgKey !== 'function') { return null; }
            var host;
            try {
                host = new URL(ssApiOrigin()).hostname;
            } catch (e) {
                host = window.location.hostname;
            }
            var key = ssOrgKey(host);
            return key ? key.split('.')[0] : null;
        }

        // Incident event messages are whole paragraphs; the panel shows a
        // short version (ssTruncate) and exposes the full text as a tooltip.

        // Normalizes a /instances/{key}/status document into what the panel
        // renders, so the view never has to know the API's shape.
        function normalize(data) {
            var incidents = (data && data.Incidents) || [];
            var maintenances = (data && data.Maintenances) || [];
            var messages = (data && data.GeneralMessages) || [];

            return {
                key: data && data.key,
                location: data && data.location,
                status: (data && data.status) || 'UNKNOWN',
                maintenanceWindow: data && data.maintenanceWindow,
                incidents: incidents.map(function(incident) {
                    var events = incident.IncidentEvents || [];
                    var latest = events.length ? events[events.length - 1] : null;
                    var full = latest && latest.message ? latest.message : 'No description yet.';
                    return {
                        id: incident.id,
                        severity: (latest && latest.type) || 'incident',
                        fullMessage: full,
                        message: ssTruncate(full, 240),
                        createdAt: latest ? latest.createdAt : incident.createdAt,
                        serviceKeys: incident.serviceKeys || [],
                        isCore: !!incident.isCore
                    };
                }),
                maintenances: maintenances.map(function(maintenance) {
                    return {
                        id: maintenance.id,
                        name: maintenance.name || 'Planned maintenance',
                        type: maintenance.releaseType || maintenance.type || 'maintenance',
                        status: maintenance.status,
                        plannedStartTime: maintenance.plannedStartTime,
                        plannedEndTime: maintenance.plannedEndTime,
                        isCore: !!maintenance.isCore
                    };
                }),
                messages: messages.map(function(gm) {
                    return {
                        id: gm.id,
                        subject: gm.subject,
                        body: gm.body,
                        startDate: gm.startDate,
                        endDate: gm.endDate
                    };
                })
            };
        }

        // Showable form of a raw API status code.
        this.statusLabel = function(status) {
            return STATUS_LABELS[status] || status || 'Unknown';
        };

        // A maintenance that has already run is not news.
        function isFinished(maintenance) {
            return /complete/i.test((maintenance && maintenance.status) || '');
        }

        /*
         * The footer ticker's view of this instance: a few short lines a user
         * reads without opening anything, each one a reason to click through
         * to the full panel.
         *
         * Takes a normalized status rather than loading one, so the phrasing
         * is decided in one place and can be checked without the network.
         * An { error } status yields nothing at all - a ticker is ambient,
         * and a failed background call has no business shouting about itself.
         */
        this.summaryLines = function(status) {
            if (!status || status.error) {
                return [];
            }
            var instance = status.key || 'This instance';
            var lines = [];

            (status.incidents || []).forEach(function(incident) {
                lines.push(instance + ' incident: ' +
                    ssTruncate(incident.fullMessage || incident.message, TICKER_MAX));
            });

            (status.maintenances || []).forEach(function(maintenance) {
                if (isFinished(maintenance)) { return; }
                lines.push(instance + ' maintenance: ' +
                    ssTruncate(maintenance.name, TICKER_MAX));
            });

            // Nothing outstanding still says something: the instance is fine,
            // or it carries a status that no incident row explained.
            if (!lines.length) {
                lines.push(instance + ' · ' + (status.status === 'OK'
                    ? 'all services operational'
                    : self.statusLabel(status.status)));
            }

            return lines.slice(0, TICKER_LINES);
        };

        /*
         * Full load: instance key, then its status - and a way through when
         * the key cannot be resolved.
         *
         * Resolving it goes through SOQL against Organization, so the whole
         * panel used to need a session. That made it the one org-health view
         * that was unavailable precisely when someone would want it: signed
         * out, or in an org that will not give the extension a session at
         * all. It also failed for any user without read on Organization.
         *
         * The Trust API can answer for a My Domain directly, needs no
         * session, and is CORS-open - so when the key lookup fails for any
         * reason, ask it that way instead. The instance key stays the first
         * choice: it is what the org itself says, and it is right for orgs
         * whose My Domain the Trust API does not list (sandboxes among them).
         *
         * A failed fallback reports the original error rather than its own.
         * "Trust API unreachable (HTTP 404)" describes the second attempt and
         * would send someone looking at an API that is working fine; the
         * reason they are here is the first failure.
         */
        this.loadStatus = function() {
            return settle(self.getInstanceKey().then(function(key) {
                return fetchStatus(key).then(normalize);
            }, function(keyError) {
                var alias = orgAlias();
                if (!alias) {
                    return $q.reject(keyError);
                }
                return fetchStatusByAlias(alias).then(normalize, function() {
                    return $q.reject(keyError);
                });
            }));
        };

        // One-shot load against a known key; the test harness uses this.
        this.getStatus = function(key) {
            return settle(fetchStatus(key).then(normalize));
        };
    }]);
})();
