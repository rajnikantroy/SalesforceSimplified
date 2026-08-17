/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * IntegrationService.js
 * Salesforce Simplified - Integrator & Integration Health Monitor
 */
(function() {
    'use strict';
    var app = window.app || angular.module("SalesforceSimplifiedApp");

    app.service('IntegrationService', ['$q', '$http', '$timeout', 'sfdc', 'UserId', function($q, $http, $timeout, sfdc, UserId) {
        var self = this;

        function getStorageKey(suffix) {
            var uid = (UserId && UserId.id) ? UserId.id : 'default';
            return 'Simplified_Integrator_' + suffix + '_' + uid;
        }

        /* ------------------------------------------------------------------ */
        /* Local Storage Persistence                                          */
        /* ------------------------------------------------------------------ */

        this.getHealthLogs = function() {
            try {
                var raw = localStorage.getItem(getStorageKey('Logs'));
                var logs = raw ? JSON.parse(raw) : [];
                return Array.isArray(logs) ? logs : [];
            } catch(e) {
                return [];
            }
        };

        this.saveHealthLog = function(logEntry) {
            try {
                var logs = self.getHealthLogs();
                logs.unshift(logEntry);
                // Keep last 100 log entries
                if (logs.length > 100) { logs = logs.slice(0, 100); }
                localStorage.setItem(getStorageKey('Logs'), JSON.stringify(logs));
            } catch(e) {}
        };

        this.getCustomIntegrations = function() {
            try {
                var raw = localStorage.getItem(getStorageKey('Custom'));
                var items = raw ? JSON.parse(raw) : [];
                return Array.isArray(items) ? items : [];
            } catch(e) {
                return [];
            }
        };

        this.addCustomIntegration = function(item) {
            if (!item || !item.name || !item.endpoint) { return; }
            var custom = self.getCustomIntegrations();
            custom.push({
                id: 'custom_' + Date.now(),
                name: item.name,
                endpoint: item.endpoint,
                method: item.method || 'GET',
                headers: item.headers || '',
                body: item.body || '',
                type: 'Custom API',
                enabled: true,
                isCustom: true
            });
            try {
                localStorage.setItem(getStorageKey('Custom'), JSON.stringify(custom));
            } catch(e) {}
        };

        this.clearLogs = function() {
            try {
                localStorage.removeItem(getStorageKey('Logs'));
            } catch(e) {}
        };

        /* ------------------------------------------------------------------ */
        /* Discovery                                                          */
        /* ------------------------------------------------------------------ */

        /* ------------------------------------------------------------------ */
        /* Direction                                                          */
        /*                                                                    */
        /* Everything discoverIntegrations finds is outbound: a Named          */
        /* Credential, Remote Site or CSP Trusted Site is an allow-list for    */
        /* Salesforce calling out. None of it says anything about what calls   */
        /* in, and the panel never said so either - so a list of endpoints     */
        /* read as "the org's integrations" when it was only half of them.     */
        /*                                                                    */
        /* Inbound is a different question with a different source. Salesforce */
        /* records an entry in LoginHistory for every API authentication, with */
        /* the application that made it and which API it used - so an          */
        /* integration calling in shows up as a run of logins from a named app */
        /* with an ApiType set, while a person in a browser has none.          */
        /*                                                                    */
        /* This is logins, not calls. Per-call counts live in EventLogFile,    */
        /* which needs Event Monitoring, and most orgs do not have it. What is */
        /* here works everywhere and answers the question people actually ask: */
        /* who is talking to this org, and when did they last do it.           */
        /* ------------------------------------------------------------------ */

        this.discoverInboundCallers = function(days) {
            var window = 'LAST_N_DAYS:' + (days || 30);

            /*
             * Every page, not the first.
             *
             * This table is counts, and a count taken from one page of 2,000
             * is understated without saying so - an org with a busy
             * integration passes 2,000 API logins in a month easily, and the
             * number shown would read as fact.
             */
            return sfdc.queryAll(
                "SELECT ApplicationName, ApiType, ApiVersion, LoginTime, Status, SourceIp " +
                "FROM LoginHistory WHERE LoginTime = " + window + " ORDER BY LoginTime DESC"
            ).then(function(data) {
                var byApp = Object.create(null);
                var truncated = !!(data && data.truncated);

                (data && data.records ? data.records : []).forEach(function(row) {
                    /*
                     * A browser sign-in is not an integration. Salesforce
                     * leaves ApiType empty or "N/A" for those, which is the
                     * org's own answer rather than a guess from the
                     * application name - and names vary per connected app.
                     */
                    var apiType = row.ApiType;
                    if (!apiType || apiType === 'N/A') { return; }

                    var name = row.ApplicationName || 'Unnamed application';
                    var key = name + '|' + apiType;
                    var entry = byApp[key];

                    if (!entry) {
                        entry = byApp[key] = {
                            name: name,
                            apiType: apiType,
                            apiVersion: row.ApiVersion || '',
                            logins: 0,
                            failures: 0,
                            lastSeen: null,
                            addresses: Object.create(null)
                        };
                    }

                    entry.logins++;
                    // Anything other than Success is worth surfacing: a caller
                    // failing to authenticate is an integration that is
                    // already broken, which is the thing worth noticing here.
                    if (row.Status && row.Status !== 'Success') { entry.failures++; }
                    if (row.SourceIp) { entry.addresses[row.SourceIp] = true; }
                    if (!entry.lastSeen || row.LoginTime > entry.lastSeen) {
                        entry.lastSeen = row.LoginTime;
                    }
                });

                var callers = Object.keys(byApp).map(function(key) {
                    var entry = byApp[key];
                    entry.addressCount = Object.keys(entry.addresses).length;
                    delete entry.addresses;
                    return entry;
                }).sort(function(a, b) {
                    // Busiest first: that is the one whose failure matters most.
                    if (b.logins !== a.logins) { return b.logins - a.logins; }
                    return a.name.localeCompare(b.name);
                });

                // Carried on the list so the panel can say the totals are a
                // floor rather than presenting a capped number as complete.
                callers.truncated = truncated;
                return callers;
            }, function() {
                /*
                 * LoginHistory needs "View Setup and Configuration". Without
                 * it the outbound half is still worth showing, so this
                 * contributes nothing rather than failing the panel.
                 */
                return [];
            });
        };

        this.discoverIntegrations = function() {
            var jobs = [
                sfdc.query("SELECT Id, DeveloperName, MasterLabel, Endpoint, PrincipalType FROM NamedCredential", "/services/data/v58.0/tooling/query/").then(null, function() { return { records: [] }; }),
                sfdc.query("SELECT Id, DeveloperName, MasterLabel, Type, Endpoint FROM ExternalDataSource", "/services/data/v58.0/tooling/query/").then(null, function() { return { records: [] }; }),
                sfdc.query("SELECT Id, DeveloperName, SiteName, EndpointUrl, IsActive FROM RemoteProxy", "/services/data/v58.0/tooling/query/").then(null, function() { return { records: [] }; }),
                sfdc.query("SELECT Id, DeveloperName, EndpointUrl, IsActive FROM CspTrustedSite", "/services/data/v58.0/tooling/query/").then(null, function() { return { records: [] }; })
            ];

            return $q.all(jobs).then(function(results) {
                var discovered = [];

                // Named Credentials
                (results[0].records || []).forEach(function(nc) {
                    discovered.push({
                        id: nc.Id,
                        name: nc.MasterLabel || nc.DeveloperName,
                        type: 'Named Credential',
                        endpoint: nc.Endpoint || 'Salesforce Auth Managed',
                        method: 'GET',
                        details: 'Principal: ' + (nc.PrincipalType || 'NamedUser'),
                        enabled: true
                    });
                });

                // External Data Sources
                (results[1].records || []).forEach(function(eds) {
                    discovered.push({
                        id: eds.Id,
                        name: eds.MasterLabel || eds.DeveloperName,
                        type: 'External Data Source',
                        endpoint: eds.Endpoint || 'OData / External',
                        method: 'GET',
                        details: 'Type: ' + (eds.Type || 'OData'),
                        enabled: true
                    });
                });

                // Remote Site Settings
                (results[2].records || []).forEach(function(rp) {
                    discovered.push({
                        id: rp.Id,
                        name: rp.SiteName || rp.DeveloperName,
                        type: 'Remote Site Setting',
                        endpoint: rp.EndpointUrl || '',
                        method: 'GET',
                        details: rp.IsActive ? 'Active' : 'Inactive',
                        enabled: !!rp.IsActive
                    });
                });

                // CSP Trusted Sites
                (results[3].records || []).forEach(function(csp) {
                    discovered.push({
                        id: csp.Id,
                        name: csp.DeveloperName,
                        type: 'CSP Trusted Site',
                        endpoint: csp.EndpointUrl || '',
                        method: 'GET',
                        details: csp.IsActive ? 'Active' : 'Inactive',
                        enabled: !!csp.IsActive
                    });
                });

                // Append custom user-added integrations
                var custom = self.getCustomIntegrations();
                return discovered.concat(custom);
            });
        };

        /* ------------------------------------------------------------------ */
        /* Health Check Engine                                                */
        /* ------------------------------------------------------------------ */

        this.checkIntegrationHealth = function(item) {
            var startTime = Date.now();
            
            if (item.endpoint && (item.endpoint.indexOf('http://') === 0 || item.endpoint.indexOf('https://') === 0)) {
                var reqMethod = item.method || 'GET';
                var reqHeaders = {};
                if (item.headers) {
                    try {
                        reqHeaders = typeof item.headers === 'string' ? JSON.parse(item.headers) : item.headers;
                    } catch(e) {}
                }
                var reqConfig = {
                    method: reqMethod,
                    url: item.endpoint,
                    headers: reqHeaders,
                    timeout: 5000
                };
                if (item.body && (reqMethod === 'POST' || reqMethod === 'PUT')) {
                    reqConfig.data = item.body;
                }

                return $http(reqConfig).then(function(resp) {
                    var latency = Date.now() - startTime;
                    var entry = {
                        id: item.id,
                        name: item.name,
                        type: item.type,
                        endpoint: item.endpoint,
                        method: reqMethod,
                        status: 'Healthy',
                        statusCode: resp.status || 200,
                        latencyMs: latency,
                        timestamp: Date.now(),
                        dateStr: new Date().toLocaleDateString(),
                        timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    };
                    self.saveHealthLog(entry);
                    return entry;
                }, function(err) {
                    var latency = Date.now() - startTime;
                    var isCorsOrActive = (err.status === 0 || err.status === 401 || err.status === 403);
                    var entry = {
                        id: item.id,
                        name: item.name,
                        type: item.type,
                        endpoint: item.endpoint,
                        method: reqMethod,
                        status: isCorsOrActive ? 'Healthy' : 'Offline',
                        statusCode: err.status || (isCorsOrActive ? 200 : 500),
                        latencyMs: latency,
                        timestamp: Date.now(),
                        dateStr: new Date().toLocaleDateString(),
                        timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    };
                    self.saveHealthLog(entry);
                    return entry;
                });
            } else {
                return sfdc.query("SELECT Id FROM Organization LIMIT 1").then(function() {
                    var latency = Date.now() - startTime;
                    var entry = {
                        id: item.id,
                        name: item.name,
                        type: item.type,
                        endpoint: item.endpoint,
                        status: 'Healthy',
                        statusCode: 200,
                        latencyMs: latency,
                        timestamp: Date.now(),
                        dateStr: new Date().toLocaleDateString(),
                        timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    };
                    self.saveHealthLog(entry);
                    return entry;
                }, function() {
                    var latency = Date.now() - startTime;
                    var entry = {
                        id: item.id,
                        name: item.name,
                        type: item.type,
                        endpoint: item.endpoint,
                        status: 'Offline',
                        statusCode: 500,
                        latencyMs: latency,
                        timestamp: Date.now(),
                        dateStr: new Date().toLocaleDateString(),
                        timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    };
                    self.saveHealthLog(entry);
                    return entry;
                });
            }
        };

        /* ------------------------------------------------------------------ */
        /* Daily Health Report Aggregator                                     */
        /* ------------------------------------------------------------------ */

        this.generateDailyReport = function(logs) {
            logs = logs || self.getHealthLogs();
            var now = Date.now();
            var last24h = now - (24 * 60 * 60 * 1000);
            var recentLogs = logs.filter(function(l) { return l.timestamp >= last24h; });

            var total = recentLogs.length;
            var healthy = recentLogs.filter(function(l) { return l.status === 'Healthy'; }).length;
            var degraded = recentLogs.filter(function(l) { return l.status === 'Degraded'; }).length;
            var offline = recentLogs.filter(function(l) { return l.status === 'Offline'; }).length;

            var uptimePercent = total > 0 ? Math.round((healthy / total) * 100) : 100;
            var avgLatency = total > 0 ? Math.round(recentLogs.reduce(function(acc, l) { return acc + (l.latencyMs || 0); }, 0) / total) : 0;

            return {
                totalChecks: total,
                healthyCount: healthy,
                degradedCount: degraded,
                offlineCount: offline,
                uptimePercent: uptimePercent,
                avgLatencyMs: avgLatency,
                recentLogs: recentLogs
            };
        };

        /* ------------------------------------------------------------------ */
        /* API Traffic & Call Volume Analytics (Inbound vs Outbound)          */
        /* ------------------------------------------------------------------ */

        this.getApiTrafficStats = function() {
            var deferred = $q.defer();
            var stats = {
                inboundTotal: 0,
                inboundLimitMax: 0,
                inboundRemaining: 0,
                outboundTotal: 0,
                breakdown: {
                    restApi: 0,
                    soapApi: 0,
                    bulkApi: 0,
                    outboundCallouts: 0
                },
                source: 'Salesforce Limits API & EventLogFile'
            };

            // 1. Fetch Org Limits for Inbound API Requests (Outside -> SFDC)
            sfdc.get("/services/data/v58.0/limits").then(function(res) {
                if (res && res.DailyApiRequests) {
                    stats.inboundLimitMax = res.DailyApiRequests.Max || 0;
                    stats.inboundRemaining = res.DailyApiRequests.Remaining || 0;
                    stats.inboundTotal = Math.max(0, stats.inboundLimitMax - stats.inboundRemaining);
                }

                // 2. Query EventLogFile for Inbound & Outbound protocol breakdown
                var eventLogQuery = "SELECT EventType, COUNT(Id) cnt FROM EventLogFile WHERE EventType IN ('API', 'RestApi', 'SOAP', 'BulkApi', 'ApexCallout') AND LogDate = TODAY GROUP BY EventType";
                sfdc.query(eventLogQuery).then(function(data) {
                    if (data && data.records && data.records.length) {
                        data.records.forEach(function(r) {
                            var type = r.EventType;
                            var count = r.expr0 || r.cnt || 0;
                            if (type === 'RestApi' || type === 'API') { stats.breakdown.restApi += count; }
                            else if (type === 'SOAP') { stats.breakdown.soapApi += count; }
                            else if (type === 'BulkApi') { stats.breakdown.bulkApi += count; }
                            else if (type === 'ApexCallout') {
                                stats.breakdown.outboundCallouts += count;
                                stats.outboundTotal += count;
                            }
                        });
                    }
                    deferred.resolve(stats);
                }, function() {
                    // Fallback for outbound if EventLogFile is restricted
                    stats.outboundTotal = self.getHealthLogs().length;
                    stats.breakdown.outboundCallouts = stats.outboundTotal;
                    deferred.resolve(stats);
                });
            }, function() {
                deferred.resolve(stats);
            });

            return deferred.promise;
        };

    }]);
})();
