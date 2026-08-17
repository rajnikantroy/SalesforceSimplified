/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * MetadataApiService - retrieving a deployable package.
 *
 * The rest of this extension talks REST. This one file talks SOAP, because
 * retrieve() is only offered there: the Metadata API has no REST equivalent,
 * and it is the only thing that will hand back a real deployable package.
 *
 * The alternative was to fetch each component over REST and assemble a zip in
 * the browser, which would mean shipping a zip library and, worse, encoding
 * the folder layout and the -meta.xml rules for every metadata type by hand -
 * a copy of Salesforce's own packaging rules, wrong in a different way each
 * release. Asking the org to build it means the structure is by definition
 * the right one, and what comes back deploys with `sf project deploy` or the
 * Ant tool without being touched.
 *
 * Three steps, all against /services/Soap/m/{version}:
 *
 *   retrieve()             -> an async process id
 *   checkRetrieveStatus()  -> polled until done
 *   the zip                -> base64 in that last response
 */
(function() {
    'use strict';
    var app = window.app || angular.module("SalesforceSimplifiedApp");

    var META_NS = 'http://soap.sforce.com/2006/04/metadata';

    // Retrieval is queued server-side, so the first answer is almost never
    // ready. Backs off to avoid hammering the org while a big package builds.
    var POLL_START_MS = 1200;
    var POLL_MAX_MS = 5000;
    var POLL_GROWTH = 1.4;
    var POLL_TIMEOUT_MS = 5 * 60 * 1000;
    var REQUEST_TIMEOUT_MS = 60000;

    app.service('MetadataApiService', ['$q', '$timeout', function($q, $timeout) {
        var self = this;

        function escapeXml(value) {
            return String(value === null || value === undefined ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }

        // Not ssApiOrigin(): only the my-domain host serves SOAP. See
        // ssSoapOrigin in ss-core.
        function soapUrl() {
            return ssSoapOrigin() + '/services/Soap/m/' + SS_API_VERSION;
        }

        /*
         * The manifest the user is actually looking at, re-expressed in the
         * envelope's namespace prefix.
         *
         * Parsed from the package.xml rather than rebuilt from the selection
         * behind it, so what gets retrieved is what the textarea shows - the
         * field is editable, and someone who trims a member out of it means
         * it. Two builders would eventually disagree about which is the real
         * manifest.
         */
        this.buildUnpackaged = function(packageXml) {
            /*
             * The editor is free text, so this can be anything. Say which
             * kind of wrong it is: XML that will not parse is a different
             * problem from a valid document that asks for nothing, and
             * "nothing selected" sent to someone staring at a typo is no
             * help at all.
             */
            if (!String(packageXml || '').trim()) {
                return { error: 'There is no package.xml to retrieve.' };
            }

            var doc = new DOMParser().parseFromString(packageXml, 'text/xml');
            if (doc.getElementsByTagName('parsererror').length) {
                return {
                    error: 'Validation failed: this is not valid XML, so it is not a ' +
                           'correct package.xml. Check for an unclosed tag or a stray ' +
                           'character in the editor below.'
                };
            }

            var typeNodes = doc.getElementsByTagNameNS(META_NS, 'types');
            if (!typeNodes.length) {
                // A manifest written without the namespace still describes a
                // package; take it rather than refusing on a technicality.
                typeNodes = doc.getElementsByTagName('types');
            }
            if (!typeNodes.length) {
                return {
                    error: 'Validation failed: not a correct package.xml. It parses, but ' +
                           'has no <types> block naming what to retrieve.'
                };
            }

            var xml = '';
            var members = 0;
            for (var i = 0; i < typeNodes.length; i++) {
                var node = typeNodes[i];
                var names = node.getElementsByTagName('name');
                var name = names.length ? names[0].textContent.trim() : '';
                if (!name) { continue; }

                var memberNodes = node.getElementsByTagName('members');
                if (!memberNodes.length) { continue; }

                xml += '<met:types>';
                for (var m = 0; m < memberNodes.length; m++) {
                    var member = memberNodes[m].textContent.trim();
                    if (!member) { continue; }
                    xml += '<met:members>' + escapeXml(member) + '</met:members>';
                    members++;
                }
                xml += '<met:name>' + escapeXml(name) + '</met:name></met:types>';
            }

            if (!members) {
                return {
                    error: 'Validation failed: not a correct package.xml. Every <types> ' +
                           'block needs at least one <members> entry and a <name>.'
                };
            }

            var versionNodes = doc.getElementsByTagName('version');
            var version = versionNodes.length
                ? versionNodes[versionNodes.length - 1].textContent.trim()
                : SS_API_VERSION;

            return {
                xml: xml + '<met:version>' + escapeXml(version) + '</met:version>',
                version: version,
                members: members
            };
        };

        function envelope(body) {
            return '<?xml version="1.0" encoding="UTF-8"?>' +
                '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
                'xmlns:met="' + META_NS + '">' +
                '<soapenv:Header><met:SessionHeader><met:sessionId>' +
                escapeXml(ssSessionId()) +
                '</met:sessionId></met:SessionHeader></soapenv:Header>' +
                '<soapenv:Body>' + body + '</soapenv:Body></soapenv:Envelope>';
        }

        /*
         * Sent from the service worker, not from here.
         *
         * A content script's fetch carries the page's origin and none of the
         * extension's host permissions, so posting to the org's my-domain
         * host from a Lightning page is blocked by CORS before it leaves the
         * browser - which arrives as status 0 and reads as "the org could not
         * be reached" when the org was never asked. The worker holds the host
         * permissions and is not subject to CORS.
         */
        function post(body) {
            var deferred = $q.defer();
            var settled = false;

            function fail(message) {
                if (settled) { return; }
                settled = true;
                deferred.reject({ message: message });
            }

            var timer = $timeout(function() {
                fail('The Metadata API did not answer within ' +
                     Math.round(REQUEST_TIMEOUT_MS / 1000) + ' seconds.');
            }, REQUEST_TIMEOUT_MS);

            try {
                chrome.runtime.sendMessage({
                    type: 'SS_SOAP_REQUEST',
                    url: soapUrl(),
                    body: envelope(body)
                }, function(response) {
                    $timeout.cancel(timer);
                    if (settled) { return; }

                    var lost = chrome.runtime.lastError;
                    if (lost) {
                        return fail('The extension could not reach its own background worker (' +
                                    lost.message + '). Reloading the page usually fixes this.');
                    }
                    if (!response) {
                        return fail('The Metadata API request returned nothing.');
                    }
                    if (!response.ok) {
                        return fail(soapFault(response.text) ||
                                    httpMessage(response.status, response.error));
                    }
                    settled = true;
                    deferred.resolve(response.text);
                });
            } catch (e) {
                $timeout.cancel(timer);
                fail('The Metadata API is only available inside the extension.');
            }

            return deferred.promise;
        }

        function httpMessage(status, error) {
            if (!status) {
                return error || 'The org could not be reached for the Metadata API request.';
            }
            if (status === 401 || status === 403) {
                return 'The Metadata API refused this session. Retrieving metadata needs the ' +
                       '"Modify Metadata Through Metadata API Functions" or "Modify All Data" permission.';
            }
            if (status === 404) {
                return 'No Metadata API at that address. This org may not expose it on the ' +
                       'host being browsed.';
            }
            return 'Metadata API request failed (HTTP ' + status + ').';
        }

        // A SOAP fault carries the real reason; without this every failure
        // reads as a bare status code.
        function soapFault(text) {
            if (!text) { return null; }
            var match = /<faultstring>([\s\S]*?)<\/faultstring>/i.exec(text);
            return match ? match[1].trim() : null;
        }

        function firstText(text, tag) {
            var match = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i').exec(text);
            return match ? match[1] : null;
        }

        /*
         * checkRetrieveStatus, read out of the response.
         *
         * Regex rather than DOMParser for the zip: the payload is base64 that
         * routinely runs to tens of megabytes, and handing that to the XML
         * parser to build a DOM around costs far more than finding one tag.
         */
        this.parseRetrieveStatus = function(text) {
            if (!text) { return { done: false }; }

            var status = {
                done: /<done>\s*true\s*<\/done>/i.test(text),
                status: (firstText(text, 'status') || '').trim(),
                id: (firstText(text, 'id') || '').trim(),
                zipFile: firstText(text, 'zipFile')
            };

            // Component-level problems: the call succeeds and the package
            // simply lacks what could not be read.
            var problems = [];
            var re = /<messages>([\s\S]*?)<\/messages>/gi;
            var found;
            while ((found = re.exec(text)) !== null) {
                var problem = firstText(found[1], 'problem');
                var file = firstText(found[1], 'fileName');
                if (problem) {
                    problems.push((file ? file.trim() + ': ' : '') + problem.trim());
                }
            }
            status.problems = problems;

            if (status.done && status.status && status.status !== 'Succeeded' &&
                status.status !== 'SucceededPartial') {
                status.error = problems.length
                    ? problems.join('; ')
                    : ('The retrieve finished as ' + status.status + '.');
            }
            return status;
        };

        /*
         * Which metadata types this org actually has, asked of the org.
         *
         * The alternative is a table of type names kept in this repository,
         * which is wrong the moment Salesforce adds a type and wrong for any
         * org on a different API version. describeMetadata is the org's own
         * answer and is exactly the list a manifest may name.
         *
         * Asked once. Resolves to null - not an empty set - when the org will
         * not answer, so callers can tell "no types" from "not known", which
         * are opposite instructions.
         */
        var describedTypes = null;

        this.describeTypes = function(apiVersion) {
            if (describedTypes) { return describedTypes; }

            var version = ssPackageApiVersion(apiVersion);
            describedTypes = post(
                '<met:describeMetadata><met:asOfVersion>' + escapeXml(version) +
                '</met:asOfVersion></met:describeMetadata>'
            ).then(function(text) {
                var names = Object.create(null);
                var re = /<xmlName>([^<]+)<\/xmlName>/gi;
                var match;
                while ((match = re.exec(text))) {
                    names[match[1].trim()] = true;
                }
                return Object.keys(names).length ? names : null;
            }, function() {
                // No permission, or the Metadata API is unreachable. Not
                // knowing is a valid answer here and the caller handles it.
                return null;
            });

            return describedTypes;
        };

        this.startRetrieve = function(unpackagedXml, apiVersion) {
            var body = '<met:retrieve><met:retrieveRequest>' +
                '<met:apiVersion>' + escapeXml(apiVersion) + '</met:apiVersion>' +
                '<met:singlePackage>true</met:singlePackage>' +
                '<met:unpackaged>' + unpackagedXml + '</met:unpackaged>' +
                '</met:retrieveRequest></met:retrieve>';

            return post(body).then(function(text) {
                var id = (firstText(text, 'id') || '').trim();
                if (!id) {
                    return $q.reject({
                        message: soapFault(text) || 'The org did not return a retrieve id.'
                    });
                }
                return id;
            });
        };

        function poll(id, startedAt, delay, onProgress) {
            var body = '<met:checkRetrieveStatus>' +
                '<met:asyncProcessId>' + escapeXml(id) + '</met:asyncProcessId>' +
                '<met:includeZip>true</met:includeZip>' +
                '</met:checkRetrieveStatus>';

            return post(body).then(function(text) {
                var status = self.parseRetrieveStatus(text);
                if (status.done) {
                    return status;
                }
                if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
                    return $q.reject({
                        message: 'The retrieve is taking longer than five minutes. It may still ' +
                                 'be running in the org - try a smaller package.'
                    });
                }
                if (onProgress) {
                    onProgress(status.status || 'Pending');
                }
                var next = Math.min(Math.round(delay * POLL_GROWTH), POLL_MAX_MS);
                return $timeout(function() {
                    return poll(id, startedAt, next, onProgress);
                }, delay);
            });
        }

        /*
         * retrieve(packageXml, onProgress) -> promise({ blob, filename, ... })
         *
         * Resolves with the zip exactly as the org built it. Rejects with a
         * { message } the panel can show.
         */
        this.retrieve = function(packageXml, onProgress) {
            var unpackaged = self.buildUnpackaged(packageXml);
            if (!unpackaged || unpackaged.error) {
                return $q.reject({
                    message: (unpackaged && unpackaged.error) ||
                             'Validation failed: not a correct package.xml.'
                });
            }
            if (!ssSessionId()) {
                return $q.reject({ message: 'No Salesforce session available.' });
            }

            if (onProgress) { onProgress('Requesting'); }

            return self.startRetrieve(unpackaged.xml, unpackaged.version)
                .then(function(id) {
                    if (onProgress) { onProgress('Queued'); }
                    return poll(id, Date.now(), POLL_START_MS, onProgress);
                })
                .then(function(status) {
                    if (status.error) {
                        return $q.reject({ message: status.error });
                    }
                    if (!status.zipFile) {
                        return $q.reject({
                            message: 'The retrieve finished but returned no package.'
                        });
                    }
                    return {
                        blob: self.zipBlob(status.zipFile),
                        filename: 'package-' + stamp() + '.zip',
                        members: unpackaged.members,
                        version: unpackaged.version,
                        problems: status.problems || []
                    };
                });
        };

        function stamp() {
            var d = new Date();
            function pad(n) { return (n < 10 ? '0' : '') + n; }
            return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
                   '-' + pad(d.getHours()) + pad(d.getMinutes());
        }

        /*
         * base64 -> Blob, in chunks.
         *
         * atob gives a binary string; converting it one character at a time
         * through String.prototype.charCodeAt is fine, but pushing the whole
         * thing through a single apply() blows the argument limit on a large
         * package, so it is sliced.
         */
        this.zipBlob = function(base64) {
            var binary = atob(String(base64).replace(/\s/g, ''));
            var CHUNK = 8192;
            var parts = [];
            for (var offset = 0; offset < binary.length; offset += CHUNK) {
                var slice = binary.slice(offset, offset + CHUNK);
                var bytes = new Uint8Array(slice.length);
                for (var i = 0; i < slice.length; i++) {
                    bytes[i] = slice.charCodeAt(i);
                }
                parts.push(bytes);
            }
            return new Blob(parts, { type: 'application/zip' });
        };
    }]);
})();
