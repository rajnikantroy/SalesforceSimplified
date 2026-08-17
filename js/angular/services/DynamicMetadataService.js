/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Dynamic Metadata Discovery Engine for Salesforce Simplified.
 *
 * Dynamically discovers accessible objects (Standard, Custom, and Managed Packages)
 * based on user activity (RecentlyViewed & modified records) and Global Describe (/sobjects/).
 * Generates runtime query specifications and menu item definitions on the fly.
 */
var app = window.app || angular.module("SalesforceSimplifiedApp");
app.service('DynamicMetadataService', ['sfdc', '$q', 'UserId', 'SchemaService',
            function(sfdc, $q, UserId, SchemaService) {

    var self = this;
    var _sobjectDescribeMap = null;
    var _dynamicCache = Object.create(null);

    // Known display field overrides for objects without a standard 'Name' field
    var DISPLAY_FIELDS = {
        'AuraDefinitionBundle':      'DeveloperName',
        'LightningComponentBundle':  'DeveloperName',
        'Flow':                      'MasterLabel',
        'FlowDefinition':            'MasterLabel',
        'FlowVersionView':           'MasterLabel',
        'FlowDefinitionView':        'MasterLabel',
        'CustomField':               'DeveloperName',
        'CustomObject':              'DeveloperName',
        'CustomApplication':         'DeveloperName',
        'CustomTab':                 'DeveloperName',
        'FlexiPage':                 'DeveloperName',
        'CustomPermission':          'DeveloperName',
        'ValidationRule':            'ValidationName',
        'ExternalDataSource':        'DeveloperName',
        'NamedCredential':           'DeveloperName',
        'ConnectedApp':              'Name',
        'RemoteProxy':               'SiteName',
        'CspTrustedSite':            'DeveloperName',
        'Case':                      'CaseNumber',
        'Contract':                  'ContractNumber',
        'Order':                     'OrderNumber',
        'Solution':                  'SolutionNumber',
        'SchedulingRuleParameter':   'DeveloperName',
        'GtwyProvPaymentMethodType': 'DeveloperName',
        'PaymentGatewayProvider':    'DeveloperName',
        'UiFormulaRule':             'DeveloperName',
        'AuraDefinition':            'MasterLabel',
        'Auth_Settings__mdt':        'DeveloperName',
        'BriefcaseDefinition':       'DeveloperName',
        'ColorDefinition':           'DeveloperName',
        'ConversationChannelDefinition': 'DeveloperName',
        'EntityDefinition':          'QualifiedApiName',
        'FieldDefinition':          'QualifiedApiName',
        'IconDefinition':           'DeveloperName',
        'MLPredictionDefinition':   'DeveloperName',
        'MLRecommendationDefinition': 'DeveloperName',
        'PermissionSetGroupComponent': 'MasterLabel',
        'RelatedListColumnDefinition': 'DeveloperName',
        'RelatedListDefinition':    'DeveloperName',
        'SchedulingRule':           'DeveloperName',
        'SearchLayout':             'DeveloperName',
        'TabDefinition':            'Name',
        'UiFormulaRule':            'DeveloperName',
        'FSL__O2_Settings__mdt':    'DeveloperName',
        'Task':                      'Subject',
        'Event':                     'Subject',
        'ApexLog':                   'Operation',
        'ApexOrgWideCoverage':        'PercentCovered',
        'ApexCodeCoverageAggregate': 'ApexClassOrTrigger.Name',
        'ApexCodeCoverage':          'ApexClassOrTrigger.Name',
        'ApexTestQueueItem':         'ApexClass.Name',
        'Dashboard':                 'Title',
        'Report':                    'Name',
        'User':                      'Name',
        'RecentlyViewed':            'Name'
    };

    // Objects that do NOT have a NamespacePrefix field.
    // Querying it causes: "No such column 'NamespacePrefix' on entity 'X'"
    var NO_NAMESPACE_FIELD = {
        'Profile': true, 'AssignmentRule': true, 'AutoResponseRule': true,
        'EscalationRule': true, 'Queue': true, 'Group': true,
        'Role': true, 'User': true, 'RecordType': true,
        'Document': true, 'Folder': true, 'Report': true,
        'Dashboard': true, 'EmailTemplate': true, 'ApexLog': true,
        'RecentlyViewed': true, 'CspTrustedSite': true,
        'SamlSsoConfig': true, 'AuthProvider': true,
        'OauthCustomScope': true, 'MobileApplicationDetail': true,
        'TabDefinition': true
    };

    // Objects that do NOT have LastModifiedBy (relationship)
    var NO_LAST_MODIFIED_FIELD = {
        'Group': true, 'Queue': true, 'Role': true,
        'RecentlyViewed': true,
        'PermissionSetTabSetting': true,
        'PicklistValueInfo': true,
        'PermissionSetEventStore': true,
        'PplnInspListViewCalcClmn': true,
        'FSL__O2_Settings__mdt': true,
        'Auth_Settings__mdt': true,
        'ColorDefinition': true,
        'BriefcaseDefinition': true,
        'ConversationChannelDefinition': true,
        'EntityDefinition': true,
        'FieldDefinition': true,
        'IconDefinition': true,
        'MLPredictionDefinition': true,
        'MLRecommendationDefinition': true,
        'PermissionSetGroupComponent': true,
        'RelatedListColumnDefinition': true,
        'RelatedListDefinition': true,
        'SchedulingRule': true,
        'SearchLayout': true,
        'TabDefinition': true,
        'UiFormulaRule': true,
        'AuraDefinition': true
    };

    // Objects that are NOT queryable via SOQL at all (neither REST nor Tooling).
    // buildSpec returns a spec with queryForAll = null so no query is fired.
    var NOT_QUERYABLE = {
        'SamlSsoConfig':                 true,
        'OauthCustomScope':              true,
        'MobileApplicationDetail':       true,
        'SamlSsoConfig':                 true,
        'NetworkMemberGroup':            true,
        'PlatformEventChannel':          true,
        'PlatformEventChannelMember':    true,
        'PermissionSetTabSetting':       true,
        'PicklistValueInfo':             true,
        'PermissionSetEventStore':       true,
        'PplnInspListViewCalcClmn':      true,
        'ApexTypeImplementor':           true,
        'ApexCodeCoverageAggregate':     true,
        'ApexCodeCoverage':              true,
        'ApexOrgWideCoverage':           true,
        'ApexTestQueueItem':             true,
        'ApexTestResultAggregate':       true,
        'ApexTestResult':                true,
        'ApexTestSuite':                 true,
        'SchedulingWorkspaceTerritoryFeed': true,
        'SchedulingWorkspaceShare':      true,
        'OrgEmailAddressSecurity':       true,
        'PaymentGateway':                true,
        'OrgWideEmailAddress':           true,
        'WorkPlanSelectionRule':         true,
        'WorkPlanTemplate':              true,
        'WorkStepTemplate':              true,
        'AttributeDefinition':           true,
        'BriefcaseRule':                true,
        'ConvIntelligenceSignalRule':    true,
        'ConvIntelligenceSignalSubRule': true,
        'DashboardComponent':           true,
        'DuplicateRule':                true,
        'MailmergeTemplate':            true,
        'MaintenanceWorkRule':          true,
        'MatchingRule':                 true,
        'MessagingTemplate':            true,
        'MLModelFactorComponent':       true,
        'CaseTeamTemplate':             true,
        'PrivacyPolicyDefinition':      true,
        'ProcessDefinition':            true,
        'ProductEntitlementTemplate':   true,
        'PromotionLineItemRule':        true,
        'RecordsetFilterCriteriaRule':  true,
        'SearchPromotionRule':          true,
        'LiveChatSensitiveDataRule':    true,
        'ServiceReportLayout':          true,
        'ShiftTemplate':                true,
        'Task':                          false,
        'Event':                         false
    };

    function isUnsupportedForSoql(name) {
        if (!name) {
            return false;
        }
        if (NOT_QUERYABLE[name]) {
            return true;
        }
        // Learned from this org rather than assumed: the query engine records
        // every object the org itself refused, and that record outlives the
        // session. An entry that can only ever open an empty pane should not
        // be in the list at all.
        if (sfdc.isKnownUnqueryable && sfdc.isKnownUnqueryable(name)) {
            return true;
        }
        // Some internal platform objects are exposed in describe metadata but are
        // not supported in SOQL and fail with "sObject type ... is not supported".
        if (name.endsWith('Feed') || name.endsWith('History') || name.endsWith('Share') || name.endsWith('Tag') || name.endsWith('ChangeEvent') || name.endsWith('Assignment')) {
            return true;
        }
        return false;
    }

    // Fully custom SOQL SELECT fields per object (overrides auto-generation entirely).
    // Key = object API name, value = SELECT fields string after "SELECT ".
    var CUSTOM_SELECT_FIELDS = {
        'Profile':              'Id, Name',
        'AssignmentRule':       'Id, Name',
        'AutoResponseRule':     'Id, Name',
        'EscalationRule':       'Id, Name',
        'Group':                'Id, Name, Type',
        'Queue':                'Id, Name',
        'Role':                 'Id, Name',
        'PermissionSet':        'Id, Name, NamespacePrefix, IsOwnedByProfile, Label',
        'PermissionSetGroup':   'Id, DeveloperName, MasterLabel, NamespacePrefix',
        'CustomPermission':     'Id, DeveloperName, MasterLabel, NamespacePrefix',
        'ExternalDataSource':   'Id, DeveloperName, MasterLabel, NamespacePrefix',
        'NamedCredential':      'Id, DeveloperName, MasterLabel, NamespacePrefix',
        'CspTrustedSite':       'Id, DeveloperName, MasterLabel',
        'AuthProvider':         'Id, DeveloperName, FriendlyName',
        'Certificate':          'Id, DeveloperName, MasterLabel, NamespacePrefix',
        'ConnectedApp':         'Id, Name, NamespacePrefix',
        'CustomSite':           'Id, Name, MasterLabel, NamespacePrefix',
        'Document':             'Id, Name, FolderId',
        'Report':               'Id, Name, FolderName',
        'Dashboard':            'Id, Title, FolderName'
    };

    // Extra WHERE clause appended per object (in addition to user-filter)
    var EXTRA_WHERE = {
        // IsOwnedByProfile=false excludes all auto-provisioned/system permission sets
        // (profile-cloned sets show up as 'X00...' IDs and are not user-managed)
        'PermissionSet': 'IsOwnedByProfile = false'
    };

    // Standard icons mapping
    var ICON_MAP = {
        'ApexClass': chrome.runtime.getURL('/img/icons/classes.png'),
        'ApexPage': chrome.runtime.getURL('/img/icons/pages.png'),
        'ApexComponent': chrome.runtime.getURL('/img/icons/components.png'),
        'ApexTrigger': chrome.runtime.getURL('/img/icons/triggers.png'),
        'CustomObject': chrome.runtime.getURL('/img/icons/objects.png'),
        'CustomField': chrome.runtime.getURL('/img/icons/fields.png'),
        'CustomLabel': chrome.runtime.getURL('/img/icons/labels.png'),
        'WorkflowRule': chrome.runtime.getURL('/img/icons/workflows.png'),
        'Flow': chrome.runtime.getURL('/img/icons/flows.png'),
        'EmailTemplate': chrome.runtime.getURL('/img/icons/emailtemplates.png'),
        'StaticResource': chrome.runtime.getURL('/img/icons/staticresources.png'),
        'User': chrome.runtime.getURL('/img/icons/users.png'),
        'ApexLog': chrome.runtime.getURL('/img/icons/debuglogs.png'),
        'AuraDefinitionBundle': chrome.runtime.getURL('/img/icons/AuraDefinitionBundles.png'),
        'LightningComponentBundle': chrome.runtime.getURL('/img/icons/components.png'),
        'CustomMetadata': chrome.runtime.getURL('/img/icons/database.png'),
        'Account': chrome.runtime.getURL('/img/icons/objects.png'),
        'Contact': chrome.runtime.getURL('/img/icons/users.png'),
        'Opportunity': chrome.runtime.getURL('/img/icons/objects.png'),
        'Lead': chrome.runtime.getURL('/img/icons/users.png'),
        'Case': chrome.runtime.getURL('/img/icons/objects.png')
    };

    var DEFAULT_ICON = chrome.runtime.getURL('/img/icons/objects.png');

    // 1. Global Describe. SchemaService owns the fetch and the cache because it
    // also needs the Tooling catalogue to route queries; keeping a second copy
    // here meant the menu and the query engine could disagree about an org.
    this.getGlobalDescribeMap = function() {
        if (_sobjectDescribeMap) {
            return $q.when(_sobjectDescribeMap);
        }
        return SchemaService.globalDescribe().then(function(map) {
            _sobjectDescribeMap = map;
            return map;
        });
    };

    // 2. Query user's RecentlyViewed object types.
    // RecentlyViewed is a REST object; the engine corrects the endpoint on its
    // own, but asking for the right one saves a round trip.
    this.getUserRecentObjectTypes = function() {
        var soql = "SELECT Type FROM RecentlyViewed WHERE LastViewedDate != null ORDER BY LastViewedDate DESC";
        return sfdc.query(soql, ssQueryUrl(), 200).then(function(data) {
            var recentTypes = [];
            var seen = Object.create(null);
            if (data && data.records && data.records.length) {
                for (var i = 0; i < data.records.length; i++) {
                    var type = data.records[i] && data.records[i].Type;
                    if (type && !seen[type]) {
                        seen[type] = true;
                        recentTypes.push(type);
                    }
                }
            }
            return recentTypes;
        }, function() {
            return [];
        });
    };

    // Known deployable metadata types (code, components, metadata configuration)
    var DEPLOYABLE_METADATA_TYPES = {
        'ApexClass': true,
        'ApexPage': true,
        'ApexTrigger': true,
        'ApexComponent': true,
        'AuraDefinitionBundle': true,
        'LightningComponentBundle': true,
        'Flow': true,
        'FlowDefinition': true,
        'CustomObject': true,
        'CustomField': true,
        'CustomLabel': true,
        'StaticResource': true,
        'EmailTemplate': true,
        'WorkflowRule': true,
        'WorkflowFieldUpdate': true,
        'WorkflowAlert': true,
        'WorkflowTask': true,
        'WorkflowOutboundMessage': true,
        'ValidationRule': true,
        'AssignmentRule': true,
        'AutoResponseRule': true,
        'EscalationRule': true,
        'PermissionSet': true,
        'PermissionSetGroup': true,
        'Profile': true,
        'Role': true,
        'Group': true,
        'Queue': true,
        'CustomPermission': true,
        'SharingReason': true,
        'CustomTab': true,
        'CustomApplication': true,
        'Layout': true,
        'FlexiPage': true,
        'RecordType': true,
        'CompactLayout': true,
        'FieldSet': true,
        'ListView': true,
        'WebLink': true,
        'Letterhead': true,
        'Document': true,
        'NamedCredential': true,
        'ExternalDataSource': true,
        'CspTrustedSite': true,
        'RemoteProxy': true,
        'ConnectedApp': true,
        'SamlSsoConfig': true,
        'OmniScript__c': true,
        'VlocityUITemplate__c': true,
        'VlocityUILayout__c': true,
        'DRBundle__c': true,
        'VlocityAction__c': true,
        'DocumentTemplate__c': true,
        'CalculationMatrix__c': true
    };

    // Helper to test if an sObject/component type is deployable metadata or supports NamespacePrefix

    /*
     * The tables below are keyed by the name Salesforce shows a developer,
     * which is often not the name its API uses. A Custom Label is
     * ExternalString; a Lightning Page is FlexiPage. So an org's real
     * catalogue misses the entry meant for it - CustomLabel was listed as
     * both deployable metadata and an essential type, and ExternalString
     * matched neither, so custom labels were classed as data and buried
     * behind "Show All System Objects".
     *
     * The describe already carries the answer: ExternalString's label is
     * "Custom Label". Matching on either the API name or the org's own label
     * asks the org what a thing is instead of keeping a second table of
     * Salesforce's renamings - and it fixes every other renamed type at the
     * same time, without anyone having to notice them one by one.
     */
    function canonicalKey(text) {
        return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function indexByCanonicalKey(table) {
        var index = Object.create(null);
        Object.keys(table).forEach(function (key) {
            index[canonicalKey(key)] = true;
        });
        return index;
    }

    // Built once; the tables never change at runtime.
    var DEPLOYABLE_BY_KEY = null;
    var ESSENTIAL_BY_KEY = null;

    function listedIn(table, cache, name, label) {
        if (table[name]) { return true; }
        var index = cache();
        return !!index[canonicalKey(name)] || !!index[canonicalKey(label)];
    }

    function deployableIndex() {
        if (!DEPLOYABLE_BY_KEY) { DEPLOYABLE_BY_KEY = indexByCanonicalKey(DEPLOYABLE_METADATA_TYPES); }
        return DEPLOYABLE_BY_KEY;
    }

    function essentialIndex() {
        if (!ESSENTIAL_BY_KEY) { ESSENTIAL_BY_KEY = indexByCanonicalKey(ESSENTIAL_DEV_ADMIN_OBJECTS); }
        return ESSENTIAL_BY_KEY;
    }

    function isDeployableMetadataType(name, isCustom, isVlocity, label) {
        if (name.endsWith('__mdt')) {
            return true;
        }
        if (isCustom || name.endsWith('__c')) {
            return false;
        }
        if (listedIn(DEPLOYABLE_METADATA_TYPES, deployableIndex, name, label) || isVlocity) {
            return true;
        }
        if (name.endsWith('Definition') || name.endsWith('Bundle') || name.endsWith('Rule') || name.endsWith('Layout') || name.endsWith('Template') || name.endsWith('Component')) {
            return true;
        }
        return false;
    }

    // 3. Synthesize dynamic metadata spec object for any object name
    /*
     * A spec built from the org's describe, waiting for it if necessary.
     *
     * buildSpec reads the digest with digestSync, which only consults the
     * cache - so the first time an object is opened there is nothing there and
     * the query is assembled from defaults: Id, Name, NamespacePrefix,
     * LastModifiedBy.Name. That is a guess about an object nobody has looked
     * at, and it is wrong for whole families of them. AppDefinition and its
     * siblings are keyed by DurableId with no Name and no LastModifiedBy at
     * all; the tables above carry EntityDefinition and FieldDefinition only
     * because someone hit those two by hand.
     *
     * The query engine repairs a bad guess before sending, so the list still
     * loads - but repair can only remove fields, never add them. The columns
     * chosen from the describe were never in the SELECT to begin with, so a
     * first-opened object showed four guessed fields and none of its own.
     *
     * Waiting for the describe costs one request, once per object per day,
     * and only on the first open - after which digestSync answers and this
     * returns without waiting for anything.
     */
    this.specWithSchema = function(name, describeInfo) {
        if (!name) { return $q.when(null); }
        if (SchemaService.digestSync(name)) {
            return $q.when(self.buildSpec(name, describeInfo, false, true));
        }
        return $q.when(SchemaService.describe(name)).then(function() {
            // buildSpec re-derives rather than returning the cached guess: its
            // own check sees a digest now where there was none.
            return self.buildSpec(name, describeInfo, false, true);
        }, function() {
            // Describe refused. The guess is all there is, and the query
            // engine will still prune it against whatever it learns later.
            return self.buildSpec(name, describeInfo, false, true);
        });
    };

    this.buildSpec = function(name, describeInfo, isRecent, isNecessary) {
        var cached = _dynamicCache[name];
        // A spec built before the object's describe arrived carries guessed
        // column names. Once the query engine has fetched that describe, build
        // it again so the grid renders the columns the query really returns
        // instead of a blank one named after a field that does not exist.
        if (cached && (cached._schemaBacked || !SchemaService.digestSync(name))) {
            return cached;
        }

        // Objects that cannot be queried via any API — return a placeholder spec
        // so they appear in the menu but don't trigger a failing SOQL call.
        if (isUnsupportedForSoql(name)) {
            var nqSpec = {
                label: name, value: name, metadata: name,
                tooltipMessage: name + ' is not queryable via SOQL.',
                dataNotAvailableMessage: name + ' records cannot be queried directly.',
                isSearchable: false, formainmenu: false,
                visibleForMetadataMenu: true, visibleForMetadataIconMenu: false,
                eligibleForPackageXml: false,
                queryForAll: null, query: null, queryForAllWithWhere: null,
                url: ssQueryUrl(), listUrl: '/', midurl: '',
                imagesrc: DEFAULT_ICON,
                _schemaBacked: true
            };
            _dynamicCache[name] = nqSpec;
            return nqSpec;
        }

        if (isNecessary === undefined) {
            isNecessary = true;
        }

        describeInfo = describeInfo || (_sobjectDescribeMap && _sobjectDescribeMap[name]) || {};
        var rawLabel = describeInfo.label || name;
        var label = (rawLabel && rawLabel.indexOf('MISSING LABEL') === -1 && rawLabel.indexOf('__MISSING') === -1) ? rawLabel : name;
        var isCustom = describeInfo.custom || name.endsWith('__c');

        // The org's own describe outranks the tables above whenever we already
        // have it - it is the only source that is right for every object in
        // every org. The tables remain as a first guess for objects nobody has
        // opened yet; the query engine re-checks against the describe before it
        // sends anything, so a wrong guess here costs nothing.
        var digest = SchemaService.digestSync(name);
        var displayField = SchemaService.displayFieldOf(digest, DISPLAY_FIELDS[name] || 'Name');
        
        // Detect namespace / managed package & deployable metadata status
        var isVlocity = name.startsWith(readCookie('NamespacePrefix') || 'vlocity_') || name.toLowerCase().includes('vlocity');
        var isDeployableMetadata = isDeployableMetadataType(name, isCustom, isVlocity, describeInfo.label);

        // Categorize into Devs (Salesforce deployable metadata), Vlocity (Vlocity metadata), or Admin (Data records)
        var feature = isVlocity ? 'Vlocity' : (isDeployableMetadata ? 'Salesforce' : 'Admin');
        var icon = ICON_MAP[name] || DEFAULT_ICON;
        var keyPrefix = describeInfo.keyPrefix || '';

        // Build SELECT field list using per-object schema knowledge
        var selectFields;
        /*
         * A flow's manifest member is its API name, and the row does not carry
         * one.
         *
         * The Tooling Flow object is one row per *version*, labelled with
         * MasterLabel - the human label, which has spaces. It has no Name or
         * DeveloperName at all, so packageMemberName found nothing and the
         * flow was silently dropped from the manifest: the type appeared with
         * no members, which reads as "flows cannot be packaged".
         *
         * The API name lives on the FlowDefinition behind it, reachable as
         * Definition.DeveloperName. Asked for only when the org's describe says
         * the relationship exists, so an org that names it differently loses
         * the column rather than the whole query.
         */
        var MEMBER_NAME_RELATIONSHIPS = {
            'Flow': { relationship: 'Definition', field: 'Definition.DeveloperName' }
        };

        var memberNameField = '';
        var memberSpec = MEMBER_NAME_RELATIONSHIPS[name];
        if (memberSpec && SchemaService.hasRelationship(digest, memberSpec.relationship)) {
            memberNameField = ', ' + memberSpec.field;
        }

        /*
         * CUSTOM_SELECT_FIELDS stays, and is not a schema guess.
         *
         * Unlike the two tables below it, this one is a dependency list:
         * other parts of the panel read SobjectType, TableEnumOrId, LogLength,
         * Operation, IsOwnedByProfile and NumLinesCovered off these rows, and
         * an object whose describe happens not to surface one of them would
         * silently take that feature with it. So the curated fields are kept
         * whatever the describe says.
         *
         * The describe still reaches them: the column append below sits
         * outside this branch, so a curated base list and the object's own
         * columns are both selected. Profile keeps Id and Name and gains
         * UserType and PermissionsModifyAllData.
         */
        if (CUSTOM_SELECT_FIELDS[name]) {
            selectFields = CUSTOM_SELECT_FIELDS[name];
        } else {
            /*
             * The two "this object hasn't got one" tables are consulted only
             * when the org has not answered yet.
             *
             * They exist to predict what hasField and hasRelationship now know
             * for certain, and they were only ever right about the objects
             * someone happened to hit - NO_NAMESPACE_FIELD lists twenty-odd
             * names out of the hundreds an org exposes. Where a digest exists
             * it is both more accurate and complete, so the tables are demoted
             * to what they always were: a guess for the first moment, before
             * the describe lands.
             */
            var described = !!(digest && digest.fields);

            var wantsNs = isDeployableMetadata && (described || !NO_NAMESPACE_FIELD[name]);
            var nsField = (wantsNs && SchemaService.hasField(digest, 'NamespacePrefix'))
                        ? ', NamespacePrefix' : '';
            var lmField = ((described || !NO_LAST_MODIFIED_FIELD[name]) &&
                           SchemaService.hasRelationship(digest, 'LastModifiedBy'))
                        ? ', LastModifiedBy.Name' : '';
            // displayField is Id on objects with no label column at all, and
            // "SELECT Id, Id FROM x" is not a query worth sending.
            var namePart = (displayField && displayField !== 'Id')
                         ? (', ' + displayField) : '';
            /*
             * Even Id is asked for rather than assumed.
             *
             * The "Definition" objects - AppDefinition, EntityDefinition,
             * FieldDefinition and the rest - are keyed by DurableId and have
             * no Id at all, so every list against one selected a column that
             * does not exist. It was pruned before sending, which is why this
             * never surfaced as an error, but the row then arrived with no id
             * and everything keyed on one - selection, package.xml, the watch
             * list - had nothing to hold.
             *
             * hasField answers true when there is no digest, so this stays
             * exactly as it was for anything opened before its describe.
             */
            var idField = SchemaService.hasField(digest, 'Id') ? 'Id'
                        : (SchemaService.hasField(digest, 'DurableId') ? 'DurableId' : '');
            var head = idField || (displayField && displayField !== 'Id' ? '' : 'Id');

            selectFields = head + (head && namePart ? namePart : namePart.replace(/^,\s*/, ''))
                         + nsField + lmField + memberNameField;
        }

        /*
         * Columns the object actually carries, added to whatever the rules
         * above settled on.
         *
         * Every list used to end here, with the same four things selected for
         * every object - so a Flow row, a debug log and a custom object all
         * showed a name and a namespace, and none of them showed the thing
         * that distinguishes one row from the next. These come from the
         * describe, so a type nobody anticipated is covered too.
         *
         * Appended rather than replacing: the fields above are load-bearing
         * elsewhere - NamespacePrefix drives the namespace filter, the member
         * name builds package.xml - and dropping them to make room would break
         * those for a cosmetic gain.
         */
        /*
         * Guarded because this runs while the menu is being built, once per
         * object in the org. A throw here does not cost one row's columns - it
         * empties the whole menu, which is the failure mode this extension has
         * hit before and which looks nothing like its cause.
         */
        var extraColumns = (typeof SchemaService.columnsFor === 'function')
            ? SchemaService.columnsFor(digest, 3)
            : [];
        if (extraColumns.length) {
            var already = selectFields.split(',').map(function(f) { return f.trim(); });
            extraColumns = extraColumns.filter(function(col) {
                return already.indexOf(col.field) === -1;
            });
            if (extraColumns.length) {
                selectFields += ', ' + extraColumns.map(function(col) {
                    return col.field;
                }).join(', ');
            }
        }

        // Build WHERE clauses
        var extraWhere  = EXTRA_WHERE[name] ? ('(' + EXTRA_WHERE[name] + ') AND ') : '';
        var userFilter  = "(LastModifiedById='" + escapeSoqlLiteral(UserId.id) +
                          "' OR CreatedById='" + escapeSoqlLiteral(UserId.id) + "')";

        // Plenty of setup objects have no audit dates, where sorting by
        // LastModifiedDate is not a bad default but a hard error.
        var orderField = (digest && digest.orderField) || 'LastModifiedDate';
        var orderBy    = " ORDER BY " + orderField + " DESC";

        var spec = {
            label: label,
            tooltipMessage: (function(){
                var prefix = (name.indexOf('__') > 0 && !/^[A-Za-z0-9]+__(c|mdt|e|b|x)$/.test(name))
                    ? name.split('__')[0] : '';
                return (isCustom ? 'Custom' : 'Standard') + ' ' +
                       (isDeployableMetadata ? 'metadata' : 'object') +
                       (prefix ? ' from the ' + prefix + ' package' : ' in this org') +
                       (isDeployableMetadata
                           ? '. Can be selected for package.xml.'
                           : '. Data records - not part of a package.xml.');
            })(),
            value: name,
            metadata: name,
            technologyFeature: feature,
            isSystemNoise: !isNecessary,
            dataNotAvailableMessage: "You have not created/modified any " + label + ".",
            formainmenu: !!isRecent,
            isSearchable: true,
            visibleForMetadataMenu: true,
            visibleForMetadataIconMenu: !!isRecent,
            EligibleForAdvanceSearch: true,
            eligibleForPackageXml: isDeployableMetadata,
            columns: extraColumns,
            eligibleForDataDownload: feature === 'Admin' && !!selectFields,
            queryForAll: "SELECT " + selectFields + " FROM " + name + (extraWhere ? (' WHERE ' + extraWhere.replace(/ AND $/, '')) : '') + orderBy,
            queryForAllWithWhere: "SELECT " + selectFields + " FROM " + name + " WHERE " + extraWhere + displayField + " LIKE ",
            query: "SELECT " + selectFields + " FROM " + name + " WHERE " + extraWhere + userFilter + orderBy,
            type: "table",
            // The row template renders a handful of well-known label columns
            // by name; this tells it which column carries the label for every
            // object that is not one of them.
            displayField: displayField,
            headers: ["Edit", displayField],

            url: ssQueryUrl(),
            listUrl: keyPrefix ? "/" + keyPrefix + "/o" : "/",
            midurl: "",
            imagesrc: icon,
            placeholderText: "Search " + label + "...",
            // Routing hint only; the engine confirms it against the org.
            preferredEndpoint: digest ? digest.endpoint : null,
            _schemaBacked: !!digest
        };

        _dynamicCache[name] = spec;
        return spec;
    };

    var ESSENTIAL_DEV_ADMIN_OBJECTS = {
        'ApexClass': true, 'ApexTrigger': true, 'ApexPage': true, 'ApexComponent': true,
        'AuraDefinitionBundle': true, 'LightningComponentBundle': true, 'Flow': true, 'FlowDefinition': true,
        'CustomObject': true, 'CustomField': true, 'CustomLabel': true, 'StaticResource': true,
        'EmailTemplate': true, 'WorkflowRule': true, 'WorkflowFieldUpdate': true, 'WorkflowAlert': true,
        'WorkflowTask': true, 'WorkflowOutboundMessage': true, 'ValidationRule': true, 'AssignmentRule': true,
        'AutoResponseRule': true, 'EscalationRule': true, 'PermissionSet': true, 'PermissionSetGroup': true,
        'Profile': true, 'Role': true, 'CustomPermission': true, 'SharingReason': true,
        'CustomTab': true, 'CustomApplication': true, 'Layout': true, 'FlexiPage': true,
        'RecordType': true, 'CompactLayout': true, 'FieldSet': true, 'ListView': true, 'WebLink': true,
        'Letterhead': true, 'Document': true, 'NamedCredential': true, 'ExternalDataSource': true,
        'CspTrustedSite': true, 'RemoteProxy': true, 'ConnectedApp': true, 'SamlSsoConfig': true,
        'Account': true, 'Contact': true, 'Lead': true, 'Opportunity': true, 'Case': true,
        'Campaign': true, 'Contract': true, 'Order': true, 'Quote': true, 'Asset': true,
        'Product2': true, 'Pricebook2': true, 'User': true, 'Report': true, 'Dashboard': true,
        'Task': true, 'Event': true, 'Folder': true, 'Group': true, 'Queue': true
    };

    /*
     * Whether a type belongs in the menu, or behind "Show All System Objects".
     *
     * The order here is the whole rule, and it used to be wrong. The generic
     * noise heuristics - names beginning Api/App/AI, names ending Event, Feed,
     * Share - ran first and vetoed anything they matched before the code that
     * recognises real metadata ever got a look. ApprovalProcess begins "App",
     * so approval processes were filed as platform noise and hidden.
     *
     * Positive identification now comes first, and the heuristics only get to
     * rule on what nothing else has claimed. Deployable metadata is consulted
     * at all, which it was not: a type this extension can put in a package.xml
     * is by definition a type the user came here to see, so it can never be
     * system noise no matter what its name begins with.
     */
    function isNecessaryObject(name, label, isCustom, isRecent, isVlocity, fromTooling, info) {
        // Compiler and container plumbing - never useful, whatever else says.
        if (name.endsWith('__mdt') || name.startsWith('ApexCodeCoverage') || name.startsWith('ApexOrgWide') || name.startsWith('ApexTest') || name === 'ApexTypeImplementor' || name === 'ApexClassMember' || name === 'ApexTriggerMember' || name === 'ApexPageMember' || name === 'ApexComponentMember' || name === 'ApexExecutionOverlayMember' || name === 'MetadataContainer' || name === 'ContainerAsyncRequest') {
            return false;
        }
        // An object the org cannot even name is not one anybody can use.
        if (label && (label.indexOf('MISSING LABEL') >= 0 || label.indexOf('__MISSING') >= 0)) {
            return false;
        }

        /*
         * Ask the org first.
         *
         * The describe already answers both halves of this question, and its
         * answers are facts rather than inferences:
         *
         *   deprecatedAndHidden - Salesforce considers this internal
         *   associateEntityType - this is an auxiliary object it generated
         *                         beside a real one (History, Feed, Share,
         *                         ChangeEvent), and says which kind
         *
         * The name heuristics further down guess at exactly these two things
         * from spelling. They only hold while Salesforce keeps naming things
         * the way it does today, and they are why ApprovalProcess was filed
         * as noise for beginning with "App". Where the org has answered, its
         * answer wins and no guessing happens at all; where it has not - an
         * older API version, or the Tooling catalogue, which returns a
         * thinner describe - the heuristics still stand behind it.
         */
        if (info) {
            if (info.deprecatedAndHidden) { return false; }
            if (info.associateEntityType) { return false; }
        }

        /*
         * A real object, as the org describes one.
         *
         * This is the positive half, and it is what makes the decision a
         * runtime one rather than a lookup. ESSENTIAL_DEV_ADMIN_OBJECTS is
         * sixty names somebody typed out; the describe answers the same
         * question for every object in the org, including the ones added
         * after that list was written and the ones from managed packages
         * nobody here has heard of.
         *
         *   keyPrefix  - it is addressable; records of it have ids
         *   createable
         *   updateable - a user can make and change one
         *
         * Bookkeeping fails this and needs no name to be recognised:
         * LoginHistory and ApiEvent are not createable, share and history
         * objects are neither createable nor updateable. What survives is
         * what somebody actually works with.
         */
        if (info && info.keyPrefix && info.createable && info.updateable) {
            return true;
        }

        // Claimed: real metadata, the user's own objects, or a known type.
        if (isDeployableMetadataType(name, isCustom, isVlocity, label)) {
            return true;
        }
        if (isRecent || isCustom || isVlocity || name.endsWith('__c')) {
            return true;
        }
        if (listedIn(ESSENTIAL_DEV_ADMIN_OBJECTS, essentialIndex, name, label)) {
            return true;
        }

        /*
         * Unclaimed, and shaped like platform plumbing.
         *
         * The suffixes are reliable: anything ending Event, Feed, History,
         * Share, Tag or ChangeEvent is Salesforce's own bookkeeping whatever
         * catalogue it came from.
         *
         * The prefixes are not, and are only applied to REST objects. "App"
         * was meant for AppUsageAssignment and AppAnalyticsQueryRequest, but
         * it also matches ApprovalProcess - so approval processes were filed
         * as noise on the strength of three letters.
         */
        if (name.endsWith('Event') || name.endsWith('Feed') || name.endsWith('History') ||
            name.endsWith('Share') || name.endsWith('Tag') || name.endsWith('ChangeEvent') ||
            name.endsWith('Assignment')) {
            return false;
        }
        if (!fromTooling &&
            (name.startsWith('Api') || name.startsWith('App') || name.startsWith('AI') ||
             name.startsWith('EventLog'))) {
            return false;
        }

        /*
         * Left over, and the org put it in the Tooling catalogue.
         *
         * That catalogue is Salesforce's own answer to "what is setup and
         * metadata here", which is a better authority than any list kept in
         * this file - and it is the one that keeps up when Salesforce adds a
         * type nobody here has heard of yet.
         */
        return !!fromTooling;
    }

    // 4. Returns dynamic specs for all sObjects and metadata in current org
    this.getDynamicMetadataList = function() {
        return $q.all([
            self.getGlobalDescribeMap(),
            self.getUserRecentObjectTypes(),
            SchemaService.toolingDescribe()
        ]).then(function(results) {
            var describeMap = results[0] || {};
            var recentTypes = results[1] || [];
            var toolingMap  = results[2] || {};
            var list = [];
            var seen = Object.create(null);

            // 1. Add user's recent objects first
            for (var i = 0; i < recentTypes.length; i++) {
                var rType = recentTypes[i];
                if (!rType || !describeMap[rType] || !describeMap[rType].queryable || isUnsupportedForSoql(rType)) {
                    continue;
                }
                seen[rType] = true;
                list.push(self.buildSpec(rType, describeMap[rType], true, true));
            }

            // 2. Add all queryable sObjects and metadata available in the org from Global Describe
            var keys = Object.keys(describeMap);
            for (var j = 0; j < keys.length; j++) {
                var oName = keys[j];
                if (seen[oName]) continue;
                var info = describeMap[oName];
                if (!info || !info.queryable || info.customSetting || isUnsupportedForSoql(oName)) continue;

                var isCustom = info.custom || oName.endsWith('__c');
                var isVlocity = oName.startsWith(readCookie('NamespacePrefix') || 'vlocity_') || oName.toLowerCase().includes('vlocity');
                var isNecessary = isNecessaryObject(oName, info.label, isCustom, false, isVlocity, false, info);

                seen[oName] = true;
                list.push(self.buildSpec(oName, info, false, isNecessary));
            }

            /*
             * 3. Add the Tooling-only types.
             *
             * These never appear in /sobjects, so a menu built from the REST
             * catalogue alone silently omits most of what a developer opens
             * this extension for - LWC and Aura bundles, CustomField,
             * CustomObject, WorkflowRule, ValidationRule, Layout, FlexiPage.
             *
             * The Tooling catalogue also carries a lot of compiler and
             * container plumbing, so entries run through the same
             * isNecessaryObject filter as the REST ones: the recognised
             * developer types show, the rest are marked system noise and stay
             * hidden behind "Show All System Objects".
             */
            var toolingKeys = Object.keys(toolingMap);
            for (var k = 0; k < toolingKeys.length; k++) {
                var tName = toolingKeys[k];
                if (seen[tName]) continue;
                var tInfo = toolingMap[tName];
                if (!tInfo || !tInfo.queryable || isUnsupportedForSoql(tName)) continue;

                var tIsCustom = tInfo.custom || tName.endsWith('__c');
                var tIsVlocity = tName.startsWith(readCookie('NamespacePrefix') || 'vlocity_') || tName.toLowerCase().includes('vlocity');
                var tIsNecessary = isNecessaryObject(tName, tInfo.label, tIsCustom, false, tIsVlocity, true, tInfo);

                seen[tName] = true;
                list.push(self.buildSpec(tName, tInfo, false, tIsNecessary));
            }

            return list;
        });
    };

    this.getByValue = function(name) {
        if (_dynamicCache[name]) {
            return _dynamicCache[name];
        }
        var describeInfo = _sobjectDescribeMap && _sobjectDescribeMap[name];
        return self.buildSpec(name, describeInfo, false);
    };
}]);
