/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * PackageDependencyService - what else a manifest needs to deploy.
 *
 * A package.xml that names a thing without naming what that thing points at
 * does not fail politely. Deploying a permission set that grants access to a
 * field the target org has not got fails the whole deployment on that one
 * line; retrieving an object without its fields produces a manifest that
 * looks right and is missing everything anyone actually wanted.
 *
 * So: given something the user has ticked, work out what travels with it.
 *
 * Every answer comes from the org, at the moment it is asked. There is no
 * table here of which fields belong to Account, because the org knows and
 * this does not - and an org with a managed package, or a field added this
 * morning, is exactly the case a table would get wrong.
 *
 * Two families are handled, because they are the two that fail:
 *
 *   an object   - its fields, layouts, record types, validation rules, list
 *                 views, buttons and compact layouts
 *   an access   - permission sets, permission set groups and profiles, whose
 *     grant       every grant names something that has to exist first
 *
 * Nothing here rejects. A dependency that cannot be read is one the user does
 * not get offered, not a failure of the whole resolve - most of these queries
 * need permissions that plenty of users do not have, and a manifest missing
 * one section is far better than a dialog that only ever shows an error.
 */
var app = window.app || angular.module("SalesforceSimplifiedApp");
app.service('PackageDependencyService', ['sfdc', '$q', 'SchemaService', 'MetadataApiService',
            function(sfdc, $q, SchemaService, MetadataApiService) {

    var self = this;

    /* ------------------------------------------------------------------ */
    /* Asking                                                              */
    /* ------------------------------------------------------------------ */

    /*
     * Every lookup settles to a list, never a rejection.
     *
     * These queries lean on objects with their own permissions -
     * FieldPermissions, SetupEntityAccess, ValidationRule - and a user
     * without "View Setup and Configuration" gets nothing from several of
     * them. That is a normal outcome, not an error, so it contributes an
     * empty list and the rest of the resolve carries on.
     */
    /*
     * A ceiling, so that an org answering strangely cannot spin forever. Well
     * above anything real: an object cannot have 10,000 fields, and a
     * permission set with this many grants has bigger problems than a
     * manifest.
     */
    var MAX_RECORDS = 10000;

    function absoluteUrl(path) {
        if (/^https?:/i.test(path)) { return path; }
        return (typeof ssApiOrigin === 'function' ? ssApiOrigin() : '') + path;
    }

    /*
     * Salesforce answers a query one page at a time and says so, in
     * nextRecordsUrl. sfdc.query hands back that first page as-is, which for
     * most of this extension is the right trade - a list view showing the
     * first 2,000 rows is a list view.
     *
     * A manifest is not. A permission set granting field access across a large
     * org runs to several thousand FieldPermissions rows, and stopping at the
     * page boundary produces the failure that is hardest to notice: a
     * package.xml that looks complete, deploys cleanly, and is quietly missing
     * the fields that happened to fall on page two.
     */
    function follow(data, collected) {
        var records = collected.concat((data && data.records) ? data.records : []);
        var next = data && data.nextRecordsUrl;

        if (!next || records.length >= MAX_RECORDS) { return $q.when(records); }

        return $q.when(sfdc.get(absoluteUrl(next))).then(function(more) {
            return follow(more, records);
        }, function() {
            // A page that fails keeps the pages that worked. Fewer members
            // than the org has beats no members at all.
            return records;
        });
    }

    function ask(soql, url) {
        return $q.when(sfdc.query(soql, url)).then(function(data) {
            return follow(data, []);
        }, function() {
            return [];
        });
    }

    function toolingAsk(soql) {
        return ask(soql, typeof ssToolingQueryUrl === 'function' ? ssToolingQueryUrl() : undefined);
    }

    function escape(value) {
        return (typeof escapeSoqlLiteral === 'function')
            ? escapeSoqlLiteral(value)
            : String(value || '').replace(/'/g, "\\'");
    }

    /* ------------------------------------------------------------------ */
    /* Members                                                             */
    /* ------------------------------------------------------------------ */

    /*
     * A dependency is only useful as the exact string a manifest expects, and
     * the shape differs per type: a field is Object.Field, a layout is
     * Object-Layout Name, a record type is Object.DeveloperName. Built here
     * so the caller only ever deals in { type, name }.
     */
    function member(type, name, namespace) {
        var m = { type: type, name: name };
        // Only when the org actually told us. An absent namespace means "not
        // known from this query", which namespaceOfMember then infers from the
        // name - keeping the authoritative answer and the inferred one apart.
        if (namespace) { m.namespace = namespace; }
        return m;
    }

    /* ------------------------------------------------------------------ */
    /* Managed package components                                          */
    /* ------------------------------------------------------------------ */

    /*
     * A component installed from a managed package is not yours to retrieve.
     * The Metadata API does not refuse - it returns a zip with the component
     * missing, or with a stub that will not deploy anywhere - so a manifest
     * full of managed components is the failure that looks most like success.
     *
     * The namespace is read off the member name. A Salesforce API name is
     * namespace__Name__suffix, so a name split on '__' into three or more
     * parts carries a namespace in the first. Two parts is Name__suffix - an
     * ordinary local custom component.
     *
     * That leaves one case it cannot see: a managed component with no suffix,
     * such as the Apex class npsp__BatchJob, which splits into two exactly
     * like Rating__c does. Those are covered by asking the org for
     * NamespacePrefix directly wherever the query supports the column, which
     * is why member() carries one.
     */
    function namespaceOfMember(name) {
        var text = String(name || '');

        // An object-scoped member is Owner.Part or Owner-Part, and either half
        // may be namespaced - a local permission set can grant access to a
        // managed package's field.
        var halves = text.split(/[.-]/);
        for (var i = 0; i < halves.length; i++) {
            var parts = halves[i].split('__');
            if (parts.length >= 3 && parts[0]) { return parts[0]; }
        }
        return null;
    }

    /*
     * The org's own namespace, if it has one.
     *
     * This matters because "has a namespace" is not the same as "came from
     * somebody else's package". A packaging org's own components carry its
     * namespace and retrieve perfectly well - warning about those would be
     * crying wolf at the one org where every component looks managed.
     *
     * One query, asked once. An org without a namespace answers null, which
     * is the ordinary case and means every namespace seen is foreign.
     */
    var orgNamespacePromise = null;

    this.orgNamespace = function() {
        if (!orgNamespacePromise) {
            orgNamespacePromise = ask("SELECT NamespacePrefix FROM Organization LIMIT 1")
                .then(function(records) {
                    var value = records.length ? records[0].NamespacePrefix : null;
                    return (value && value !== 'null') ? value : null;
                });
        }
        return orgNamespacePromise;
    };

    /*
     * Which namespace a component belongs to, preferring what the org said
     * over what the name suggests.
     */
    this.namespaceOf = function(item) {
        if (!item) { return null; }
        if (item.namespace) { return item.namespace; }
        if (item.NamespacePrefix && item.NamespacePrefix !== 'null') {
            return item.NamespacePrefix;
        }
        return namespaceOfMember(item.name || item.QualifiedApiName ||
                                 item.DeveloperName || item.Name);
    };

    /*
     * An IN clause has to fit in a URL.
     *
     * These queries go out as GET with the SOQL in the query string, and
     * Salesforce refuses a URI past roughly 16KB. A permission set granting a
     * thousand Apex classes builds a 23KB URL - measured, not estimated - so
     * the request fails, ask() turns the rejection into an empty list, and
     * every Apex class the permission set grants disappears from the manifest
     * without a word. Two hundred ids is about 4.6KB, comfortably inside it.
     */
    var IDS_PER_QUERY = 200;

    function chunk(list, size) {
        var out = [];
        for (var i = 0; i < list.length; i += size) {
            out.push(list.slice(i, i + size));
        }
        return out;
    }

    function dedupe(items) {
        var seen = Object.create(null);
        var out = [];
        (items || []).forEach(function(item) {
            if (!item || !item.type || !item.name) { return; }
            var key = item.type + '|' + item.name;
            if (seen[key]) { return; }
            seen[key] = true;
            out.push(item);
        });
        return out;
    }

    /* ------------------------------------------------------------------ */
    /* An object's own parts                                               */
    /* ------------------------------------------------------------------ */

    /*
     * Each entry is one query and one way of naming what comes back. Kept as
     * data rather than eight near-identical functions, so adding a type is a
     * line rather than a copy-paste - and so a type whose query the org
     * refuses simply contributes nothing.
     *
     * These are Salesforce API facts, not org-specific corrections: the name
     * of the field that holds an object's layouts is the same in every org.
     */
    var OBJECT_PARTS = [
        {
            type: 'CustomField',
            tooling: true,
            soql: function(obj) {
                return "SELECT QualifiedApiName FROM FieldDefinition " +
                       "WHERE EntityDefinition.QualifiedApiName = '" + escape(obj) + "'";
            },
            name: function(obj, r) { return r.QualifiedApiName ? obj + '.' + r.QualifiedApiName : null; }
        },
        {
            type: 'Layout',
            tooling: true,
            soql: function(obj) {
                return "SELECT Name FROM Layout WHERE TableEnumOrId = '" + escape(obj) + "'";
            },
            // A layout member is Object-Layout Name, with the space kept.
            name: function(obj, r) { return r.Name ? obj + '-' + r.Name : null; }
        },
        {
            type: 'RecordType',
            soql: function(obj) {
                return "SELECT DeveloperName FROM RecordType WHERE SobjectType = '" + escape(obj) + "'";
            },
            name: function(obj, r) { return r.DeveloperName ? obj + '.' + r.DeveloperName : null; }
        },
        {
            type: 'ValidationRule',
            tooling: true,
            soql: function(obj) {
                return "SELECT ValidationName FROM ValidationRule " +
                       "WHERE EntityDefinition.QualifiedApiName = '" + escape(obj) + "'";
            },
            name: function(obj, r) { return r.ValidationName ? obj + '.' + r.ValidationName : null; }
        },
        {
            type: 'WebLink',
            tooling: true,
            soql: function(obj) {
                return "SELECT Name FROM WebLink WHERE PageOrSobjectType = '" + escape(obj) + "'";
            },
            name: function(obj, r) { return r.Name ? obj + '.' + r.Name : null; }
        },
        {
            type: 'CompactLayout',
            tooling: true,
            soql: function(obj) {
                return "SELECT DeveloperName FROM CompactLayout " +
                       "WHERE EntityDefinition.QualifiedApiName = '" + escape(obj) + "'";
            },
            name: function(obj, r) { return r.DeveloperName ? obj + '.' + r.DeveloperName : null; }
        },
        {
            type: 'ListView',
            soql: function(obj) {
                return "SELECT DeveloperName FROM ListView WHERE SobjectType = '" + escape(obj) + "'";
            },
            name: function(obj, r) { return r.DeveloperName ? obj + '.' + r.DeveloperName : null; }
        }
    ];

    this.forObject = function(objectName) {
        if (!objectName) { return $q.when([]); }
        var jobs = OBJECT_PARTS.map(function(part) {
            var soql = part.soql(objectName);
            var query = part.tooling ? toolingAsk(soql) : ask(soql);
            return query.then(function(records) {
                return records.map(function(r) {
                    var name = part.name(objectName, r);
                    return name ? member(part.type, name) : null;
                }).filter(Boolean);
            });
        });
        return $q.all(jobs).then(function(lists) {
            return dedupe([].concat.apply([], lists));
        });
    };

    /* ------------------------------------------------------------------ */
    /* What an access grant points at                                      */
    /* ------------------------------------------------------------------ */

    /*
     * A permission set is a list of references. Every one of them names
     * something that must already exist in the target org, which is why a
     * permission set is the single most common thing to fail a deployment on
     * its own.
     *
     * SetupEntityAccess covers the ones that are not objects or fields -
     * Apex classes, Visualforce pages, custom permissions - and it reports
     * the type alongside the id, so the mapping is the org's rather than a
     * guess about which id prefix means what.
     */
    function forPermissionSetId(permissionSetId) {
        var id = escape(permissionSetId);

        var objects = ask(
            "SELECT SobjectType FROM ObjectPermissions WHERE ParentId = '" + id + "'"
        ).then(function(records) {
            return records.map(function(r) {
                return r.SobjectType ? member('CustomObject', r.SobjectType) : null;
            }).filter(Boolean);
        });

        var fields = ask(
            "SELECT Field FROM FieldPermissions WHERE ParentId = '" + id + "'"
        ).then(function(records) {
            return records.map(function(r) {
                // Field is already Object.Field, which is the member form.
                return r.Field ? member('CustomField', r.Field) : null;
            }).filter(Boolean);
        });

        var setup = ask(
            "SELECT SetupEntityId, SetupEntityType FROM SetupEntityAccess WHERE ParentId = '" + id + "'"
        ).then(function(records) {
            var wanted = records.filter(function(r) {
                return r.SetupEntityType && SETUP_ENTITY_TYPES[r.SetupEntityType];
            });
            if (!wanted.length) { return []; }
            return resolveSetupEntities(wanted);
        });

        return $q.all([objects, fields, setup]).then(function(lists) {
            return dedupe([].concat.apply([], lists));
        });
    }

    /*
     * SetupEntityAccess gives an id and a type, not a name, so each family has
     * to be looked up in its own object to find out what it is called. Only
     * the ones that belong in a manifest are followed.
     */
    var SETUP_ENTITY_TYPES = {
        ApexClass:        { type: 'ApexClass',        from: 'ApexClass',        field: 'Name' },
        ApexPage:         { type: 'ApexPage',         from: 'ApexPage',         field: 'Name' },
        CustomPermission: { type: 'CustomPermission', from: 'CustomPermission', field: 'DeveloperName' }
    };

    function resolveSetupEntities(records) {
        var byType = Object.create(null);
        records.forEach(function(r) {
            (byType[r.SetupEntityType] = byType[r.SetupEntityType] || []).push(r.SetupEntityId);
        });

        var jobs = [];
        Object.keys(byType).forEach(function(setupType) {
            var spec = SETUP_ENTITY_TYPES[setupType];
            chunk(byType[setupType], IDS_PER_QUERY).forEach(function(batch) {
                var ids = batch.map(function(id) { return "'" + escape(id) + "'"; }).join(',');
                /*
                 * NamespacePrefix comes back too. These three are exactly the
                 * types whose member name carries no suffix to infer from -
                 * npsp__BatchJob splits like Rating__c does - so the column is
                 * the only reliable answer for them.
                 */
                jobs.push(ask(
                    "SELECT " + spec.field + ", NamespacePrefix FROM " + spec.from +
                    " WHERE Id IN (" + ids + ")"
                ).then(function(rows) {
                    return rows.map(function(row) {
                        if (!row[spec.field]) { return null; }
                        var ns = (row.NamespacePrefix && row.NamespacePrefix !== 'null')
                            ? row.NamespacePrefix : null;
                        var name = ns ? ns + '__' + row[spec.field] : row[spec.field];
                        return member(spec.type, name, ns);
                    }).filter(Boolean);
                }));
            });
        });

        return $q.all(jobs).then(function(lists) {
            return [].concat.apply([], lists);
        });
    }

    this.forPermissionSet = function(permissionSetId) {
        if (!permissionSetId) { return $q.when([]); }
        return forPermissionSetId(permissionSetId);
    };

    /*
     * A group is its members, and each member brings its own dependencies -
     * deploying the group without the sets it is made of fails on the first
     * one.
     */
    this.forPermissionSetGroup = function(groupId) {
        if (!groupId) { return $q.when([]); }
        return ask(
            "SELECT PermissionSetId, PermissionSet.Name FROM PermissionSetGroupComponent " +
            "WHERE PermissionSetGroupId = '" + escape(groupId) + "'"
        ).then(function(records) {
            var named = records.map(function(r) {
                var name = r.PermissionSet && r.PermissionSet.Name;
                return name ? member('PermissionSet', name) : null;
            }).filter(Boolean);

            var nested = records.map(function(r) {
                return r.PermissionSetId ? forPermissionSetId(r.PermissionSetId) : $q.when([]);
            });

            return $q.all(nested).then(function(lists) {
                return dedupe(named.concat([].concat.apply([], lists)));
            });
        });
    };

    /*
     * A profile's permissions live in a PermissionSet record that Salesforce
     * owns on its behalf, so the profile is resolved by finding that record
     * and asking the same questions of it.
     */
    this.forProfile = function(profileId) {
        if (!profileId) { return $q.when([]); }
        return ask(
            "SELECT Id FROM PermissionSet WHERE IsOwnedByProfile = true " +
            "AND ProfileId = '" + escape(profileId) + "'"
        ).then(function(records) {
            var owned = records[0];
            return owned ? forPermissionSetId(owned.Id) : [];
        });
    };

    /* ------------------------------------------------------------------ */
    /* The one entry point                                                 */
    /* ------------------------------------------------------------------ */

    /*
     * Given what the user ticked, what travels with it. Anything without
     * dependencies answers with an empty list rather than an error, so the
     * caller can offer this for every selection without knowing which types
     * have anything to offer.
     */
    /*
     * Answers are remembered for the session.
     *
     * The panel rescans whenever the selection changes, because working out
     * which dependency is still owed by which remaining tick is harder to get
     * right than starting over. Without a cache that is quadratic: ticking
     * fifty objects one at a time re-resolves every earlier one each time,
     * about 1,275 resolves for a fifty-object package.
     *
     * Stale only if the org's metadata changes mid-session, and switching the
     * checkbox off and on again clears it - so there is a way to ask again
     * that does not involve reloading the page.
     */
    var cache = Object.create(null);

    this.clearCache = function() {
        cache = Object.create(null);
    };

    /* ------------------------------------------------------------------ */
    /* Named credentials                                                   */
    /*                                                                     */
    /* The one family here where the useful direction is backwards.        */
    /*                                                                     */
    /* A Named Credential points at an External Credential, and that has   */
    /* to exist first - an ordinary forward dependency, and the kind       */
    /* forReferences already looks for. What is missing is the other way   */
    /* round: the External Services point *at* the credential, so no       */
    /* forward query from the credential can ever reach them, however good */
    /* its coverage. Deploying a Named Credential and finding its External */
    /* Services left behind is the failure that follows.                   */
    /* ------------------------------------------------------------------ */

    var EXTERNAL_SERVICE = 'ExternalServiceRegistration';
    var credentialColumn = null;

    /*
     * Which column on ExternalServiceRegistration names the credential.
     *
     * Asked of the org rather than written down here. The field has not kept
     * one name across releases - it was a plain text reference before
     * credentials became records - and a name hardcoded in this file does not
     * fail on the releases it does not match: the query simply returns
     * nothing, which is indistinguishable from "this credential has no
     * external services". A wrong answer that looks like a right one is the
     * worst outcome available, so the org is asked instead.
     */
    function externalServiceCredentialColumn() {
        if (credentialColumn) { return credentialColumn; }

        var base = (typeof ssToolingSobjectsUrl === 'function') ? ssToolingSobjectsUrl() : null;
        if (!base) { return $q.when(null); }

        credentialColumn = $q.when(sfdc.get(base + '/' + EXTERNAL_SERVICE + '/describe'))
            .then(function(described) {
                var names = (((described || {}).fields) || [])
                    .map(function(field) { return field && field.name; })
                    .filter(Boolean);

                /*
                 * The plain reference wins when both are present. An Id
                 * column has to be matched against the credential's Id and a
                 * name column against its DeveloperName, and the name is the
                 * one this service can always supply - a record reaching
                 * resolve() from a list that carried no Id still has a name.
                 */
                var named = names.filter(function(name) {
                    return /NamedCredential/i.test(name) && !/Id$/.test(name);
                })[0];
                if (named) { return { column: named, byId: false }; }

                var byId = names.filter(function(name) {
                    return /NamedCredential/i.test(name);
                })[0];
                return byId ? { column: byId, byId: true } : null;
            }, function() {
                /* No describe - no permission, or the object does not exist
                 * on this org. Contributes nothing, like everything else
                 * here, rather than failing the resolve. */
                return null;
            });

        return credentialColumn;
    }

    /* The external services registered against this credential. */
    function externalServicesFor(record) {
        return $q.all([externalServiceCredentialColumn(), loadDeployableTypes()])
                 .then(function(answers) {
            var found = answers[0];
            if (!found) { return []; }

            /*
             * Only if the org can actually retrieve the type. A manifest
             * naming a metadata type this org does not have fails the whole
             * retrieve, and one dependency is not worth that - the same rule
             * referenceMember applies to everything the dependency API
             * reports.
             */
            if (!isDeployableType(EXTERNAL_SERVICE, answers[1])) { return []; }

            var value = found.byId
                ? record.Id
                : (record.DeveloperName || record.QualifiedApiName || record.Name);
            if (!value) { return []; }

            return toolingAsk(
                'SELECT DeveloperName, NamespacePrefix FROM ' + EXTERNAL_SERVICE +
                " WHERE " + found.column + " = '" + escape(value) + "'"
            ).then(function(rows) {
                return rows.map(function(row) {
                    if (!row || !row.DeveloperName) { return null; }
                    var ns = (row.NamespacePrefix && row.NamespacePrefix !== 'null')
                        ? row.NamespacePrefix : null;
                    return member(EXTERNAL_SERVICE,
                        ns ? ns + '__' + row.DeveloperName : row.DeveloperName, ns);
                }).filter(Boolean);
            });
        });
    }

    /*
     * And whatever else in the org points at this credential.
     *
     * MetadataComponentDependency is symmetric: the same row answers "what
     * does X point at" and "what points at X" depending on which end the
     * filter is on. Everything else in this service asks it forwards; this is
     * the one place that asks it backwards.
     *
     * Scoped to a single component on purpose. Asked of an object or a
     * permission set the reverse question returns most of an org, which is
     * why it is not offered generally - a credential has a handful of users
     * and every one of them stops working without it.
     */
    function dependentsOf(record) {
        if (!record.Id) { return $q.when([]); }

        return loadDeployableTypes().then(function(described) {
            return rawToolingQuery(
                'SELECT MetadataComponentName, MetadataComponentType, ' +
                'MetadataComponentNamespace FROM MetadataComponentDependency ' +
                "WHERE RefMetadataComponentId = '" + escape(record.Id) + "'"
            ).then(function(rows) {
                return rows.map(function(row) {
                    return referenceMember({
                        RefMetadataComponentName: row.MetadataComponentName,
                        RefMetadataComponentType: row.MetadataComponentType,
                        RefMetadataComponentNamespace: row.MetadataComponentNamespace
                    }, described);
                }).filter(Boolean);
            });
        });
    }

    /*
     * Both sources, because neither is reliable on its own.
     *
     * MetadataComponentDependency has been Beta for years and its coverage
     * varies by type, so it may not know about external services at all. The
     * direct query knows about exactly one kind of dependent and nothing
     * else. Together they cover more than either, and a failure of one is an
     * empty list rather than a failure of the resolve.
     */
    this.forNamedCredential = function(record) {
        if (!record) { return $q.when([]); }
        return $q.all([externalServicesFor(record), dependentsOf(record)])
            .then(function(both) {
                return dedupe([].concat(both[0] || [], both[1] || []));
            });
    };

    function cacheKey(type, record) {
        var identity = record.Id || record.QualifiedApiName || record.DeveloperName || record.Name;
        return identity ? type + '|' + identity : null;
    }

    this.resolve = function(type, record) {
        if (!type || !record) { return $q.when([]); }

        var key = cacheKey(type, record);
        if (key && cache[key]) { return cache[key]; }
        var answer = resolveUncached(type, record);
        if (key) { cache[key] = answer; }
        return answer;
    };

    function resolveUncached(type, record) {

        /*
         * EntityDefinition is the same thing under the name the query gave it
         * - the object list and the custom metadata list both come back that
         * way - and a custom metadata type owns fields and layouts exactly as
         * a custom object does.
         */
        if (type === 'CustomObject' || type === 'EntityDefinition') {
            return self.forObject(record.QualifiedApiName || record.DeveloperName || record.Name);
        }
        if (type === 'PermissionSet') {
            return self.forPermissionSet(record.Id);
        }
        if (type === 'PermissionSetGroup') {
            return self.forPermissionSetGroup(record.Id);
        }
        if (type === 'Profile') {
            return self.forProfile(record.Id);
        }
        if (type === 'NamedCredential') {
            return self.forNamedCredential(record);
        }
        return $q.when([]);
    };

    /* ------------------------------------------------------------------ */
    /* What a component references                                         */
    /*                                                                     */
    /* A different question from everything above. The queries so far ask   */
    /* what belongs to a thing - an object's fields, a permission set's     */
    /* grants. This asks what a thing points at: the fields an Apex class   */
    /* reads, the objects a Flow touches, the Apex a Lightning bundle       */
    /* calls. Those are the dependencies that fail a deployment without     */
    /* appearing anywhere in the component you selected.                    */
    /*                                                                     */
    /* Three things to know about the answer:                               */
    /*                                                                     */
    /*   - MetadataComponentDependency has been Beta for years and its      */
    /*     coverage varies by type. It is a strong signal, not an authority.*/
    /*   - It cannot see dynamic references: SOQL built as a string,        */
    /*     Schema.getGlobalDescribe, Type.forName, a field name passed      */
    /*     around as text. Absence of a dependency here is not proof there  */
    /*     is not one.                                                      */
    /*   - It needs View Setup and Configuration, so it degrades the same   */
    /*     way everything else here does - contributing nothing rather than */
    /*     failing the resolve.                                             */
    /* ------------------------------------------------------------------ */

    /*
     * Sent raw, not through sfdc.query.
     *
     * smartQuery rewrites what it is given - it appends a LIMIT, strips
     * relationship ORDER BY clauses, and drops fields an org has previously
     * rejected. MetadataComponentDependency is unusually strict about query
     * shape and refuses several of those rewrites, so this builds the URL and
     * uses sfdc.get, which sends exactly what it is handed.
     */
    function rawToolingQuery(soql) {
        var base = (typeof ssToolingQueryUrl === 'function') ? ssToolingQueryUrl() : null;
        if (!base) { return $q.when([]); }
        return $q.when(sfdc.get(base + encodeURIComponent(soql))).then(function(data) {
            return follow(data, []);
        }, function() {
            return [];
        });
    }

    /*
     * Types that come back as references but do not belong in a manifest.
     * StandardEntity is every reference to Account or Contact - true, and
     * useless: retrieving the standard objects bloats the package without
     * making it deploy any better.
     */
    var UNWANTED_REFERENCE_TYPES = { StandardEntity: true };

    /*
     * Only deployable components may reach the manifest.
     *
     * The dependency API reports what a component points at, and plenty of
     * that is not metadata: a Flow references a User, a report references its
     * running user. Emitted as-is that produced
     *
     *     <types><members>User</members><name>User</name></types>
     *
     * and there is no User metadata type, so the block fails the whole
     * retrieve - one bad reference costing the entire package.
     *
     * The org is asked which types exist rather than a list being kept here,
     * because such a list is wrong as soon as Salesforce adds a type and
     * wrong for any org on a different API version.
     */
    var deployableTypes = null;

    function loadDeployableTypes() {
        if (!deployableTypes) {
            deployableTypes = (MetadataApiService && MetadataApiService.describeTypes)
                ? $q.when(MetadataApiService.describeTypes()).catch(function() { return null; })
                : $q.when(null);
        }
        return deployableTypes;
    }

    /*
     * What to do when the org will not say.
     *
     * Falling back to "allow everything" reinstates the bug; falling back to
     * "allow nothing" throws away the whole feature over a permission. So the
     * fallback is the set this service already knows to be deployable -
     * derived from the queries it makes rather than written out again, so it
     * cannot drift from them.
     */
    function selfKnownTypes() {
        var known = Object.create(null);
        OBJECT_PARTS.forEach(function(part) { known[part.type] = true; });
        Object.keys(SETUP_ENTITY_TYPES).forEach(function(key) {
            known[SETUP_ENTITY_TYPES[key].type] = true;
        });
        ['CustomObject', 'PermissionSet', 'Profile', 'PermissionSetGroup'].forEach(function(t) {
            known[t] = true;
        });
        return known;
    }

    function isDeployableType(type, described) {
        if (!type || UNWANTED_REFERENCE_TYPES[type]) { return false; }
        return described ? !!described[type] : !!selfKnownTypes()[type];
    }

    function referenceMember(row, described) {
        var type = row.RefMetadataComponentType;
        var name = row.RefMetadataComponentName;
        if (!name || !isDeployableType(type, described)) { return null; }

        var ns = (row.RefMetadataComponentNamespace &&
                  row.RefMetadataComponentNamespace !== 'null')
            ? row.RefMetadataComponentNamespace : null;

        /*
         * A field member must be Object.Field. When the API reports a field
         * without its object there is nothing here that can supply one - the
         * row does not say which object it belongs to - and a bare field name
         * is not a member any org can resolve. Skipping it costs one
         * dependency; emitting it fails the whole retrieve.
         */
        if (type === 'CustomField' && name.indexOf('.') === -1) { return null; }

        return member(type, ns ? ns + '__' + name : name, ns);
    }

    /*
     * What the given components reference, one hop out.
     *
     * One hop on purpose: dependency graphs chain, and following them to the
     * end on a mature org pulls in most of it. One hop is the set that has to
     * exist for the selection to deploy at all.
     */
    this.forReferences = function(ids) {
        var wanted = (ids || []).filter(Boolean);
        if (!wanted.length) { return $q.when([]); }

        return loadDeployableTypes().then(function(described) {
            var jobs = chunk(wanted, IDS_PER_QUERY).map(function(batch) {
                var list = batch.map(function(id) { return "'" + escape(id) + "'"; }).join(',');
                return rawToolingQuery(
                    "SELECT RefMetadataComponentName, RefMetadataComponentType, " +
                    "RefMetadataComponentNamespace FROM MetadataComponentDependency " +
                    "WHERE MetadataComponentId IN (" + list + ")"
                ).then(function(rows) {
                    return rows.map(function(row) {
                        return referenceMember(row, described);
                    }).filter(Boolean);
                });
            });

            return $q.all(jobs).then(function(lists) {
                return dedupe([].concat.apply([], lists));
            });
        });
    };

    /*
     * Resolving a whole selection, a few at a time.
     *
     * Each object costs seven queries and each permission set four, so a user
     * who ticks fifty objects and asks for related components would otherwise
     * put 350 requests in flight at once. Chrome queues them six-per-host and
     * the org counts every one against the API limit, so the honest outcomes
     * are a UI that looks frozen for a minute and, in a busy org, requests
     * refused for concurrency - the manifest failing for reasons that have
     * nothing to do with what was in it.
     *
     * Four at a time keeps it responsive and bounded. onProgress is called
     * with (done, total) so the panel can say how far along it is rather than
     * spinning silently.
     */
    var MAX_CONCURRENT = 4;

    this.resolveAll = function(selections, onProgress) {
        var queue = (selections || []).filter(function(s) {
            return s && self.hasDependencies(s.type);
        });
        var total = queue.length;
        if (!total) { return $q.when([]); }

        var found = [];
        var done = 0;
        var next = 0;

        function report() {
            if (typeof onProgress === 'function') { onProgress(done, total); }
        }

        function worker() {
            if (next >= queue.length) { return $q.when(null); }
            var item = queue[next++];
            return self.resolve(item.type, item.record).then(function(members) {
                // concat, not push.apply: a selection resolving to thousands
                // of members would blow the argument limit on apply.
                found = found.concat(members || []);
                done++;
                report();
                return worker();
            });
        }

        report();
        var workers = [];
        for (var i = 0; i < Math.min(MAX_CONCURRENT, total); i++) {
            workers.push(worker());
        }
        return $q.all(workers).then(function() {
            return dedupe(found);
        });
    };

    /*
     * What of a manifest belongs to somebody else's package.
     *
     * Returns the count and the namespaces involved, so the panel can name
     * them - "14 components from npsp, FinServ" is actionable in a way that
     * "some components may not retrieve" is not.
     */
    this.summariseManaged = function(items) {
        return self.orgNamespace().then(function(own) {
            var namespaces = [];
            var seen = Object.create(null);
            var count = 0;

            (items || []).forEach(function(item) {
                var ns = self.namespaceOf(item);
                if (!ns || ns === own) { return; }
                count++;
                if (!seen[ns]) { seen[ns] = true; namespaces.push(ns); }
            });

            namespaces.sort();
            return { count: count, namespaces: namespaces, orgNamespace: own };
        });
    };

    // Which selections are worth offering the prompt for at all.
    this.hasDependencies = function(type) {
        return type === 'CustomObject' || type === 'EntityDefinition' ||
               type === 'PermissionSet' || type === 'PermissionSetGroup' ||
               type === 'Profile' || type === 'NamedCredential';
    };
}]);
