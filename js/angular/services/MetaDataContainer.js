/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * MetaDataContainer - System Utility Registry & Dynamic Metadata Bridge.
 *
 * Holds system utility entries ("ChangeUser", "RecentlyViewed", "DebugLogs",
 * "PackageXml", "LauncherColor"). All standard, custom, and managed package
 * metadata specifications are dynamically resolved via DynamicMetadataService.
 */
var app = window.app || angular.module("SalesforceSimplifiedApp");
app.service('MetaDataContainer', ['DynamicMetadataService', function(DynamicMetadataService) {

    var DATA_QUERY    = ssQueryUrl();
    var TOOLING_QUERY = ssToolingQueryUrl();

    // System utility modules (retained for custom UI rendering and setup links)
    this.systemData = [
    {
        label: "View As",
        tooltipMessage: "Look at the org as another user sees it, without logging in as them",
        value: "ChangeUser",
        technologyFeature: "Settings",
        dataNotAvailableMessage: "Please click on view as to change user(No login required).",
        formainmenu: true,
        isSearchable: true,
        visibleForMetadataMenu: true,
        visibleForMetadataIconMenu: true,
        queryForAll: "select id, name, email, username from User where IsActive = true order by LastModifiedDate desc",
        queryForAllWithWhere: "select id, Name, username, email from User where IsActive = true and name like ",
        url: DATA_QUERY,
        imagesrc: chrome.runtime.getURL("/img/icons/viewas.png"),
        placeholderText: "Search user...",
        type: "table",
        listUrl: "/005",
        midurl: "",
        eligibleForPackageXml: false,
        fieldlevelactions: [{ name: "ChangeUser" }],
        objectlevelaction: [
            { name: "Setup", actionUrl: "/setup/forcecomHomepage.apexp?setupid=ForceCom" },
            { name: "Developer Console", actionUrl: "/_ui/common/apex/debug/ApexCSIPage" }
        ]
    }, {
        label: "Recently viewed",
        isSearchable: true,
        formainmenu: true,
        technologyFeature: "Settings",
        tooltipMessage: "Everything you have opened in this org lately, across every object",
        EligibleForAdvanceSearch: true,
        visibleForMetadataMenu: true,
        visibleForMetadataIconMenu: true,
        dataNotAvailableMessage: "You have not viewed any data in logged in org.",
        value: "RecentlyViewed",
        metadata: "RecentlyViewed",
        type: "table",
        listUrl: "/",
        menuname: "favourite",
        eligibleForPackageXml: false,
        query: "SELECT Id, Name, Type FROM RecentlyViewed WHERE Type IN ('User', 'ApexComponent', 'ApexPage', 'ApexTrigger', 'ApexClass', 'AssignmentRules', 'AuraDefinitionBundle', 'Bot', 'CustomApplication', 'CustomField', 'CustomLabel', 'CustomLabels', 'CustomObject', 'CustomPermission', 'CustomTab', 'Dashboard', 'Document', 'EmailTemplate', 'Flow', 'Group', 'HomePageComponent', 'Package', 'PermissionSet', 'Profile', 'Queue', 'RemoteSiteSetting', 'Report', 'Role', 'SharingRules', 'StaticResource', 'ValidationRule', 'WebLink', 'Workflow') ORDER BY LastViewedDate DESC",
        headers: ["Log Size(byte)", "Operation", "Start Time"],
        objectlevelaction: [
            { name: "Setup", actionUrl: "/setup/forcecomHomepage.apexp?setupid=ForceCom" },
            { name: "Developer Console", actionUrl: "/_ui/common/apex/debug/ApexCSIPage" }
        ],
        url: TOOLING_QUERY,
        fieldlevelactions: [{}],
        midurl: "",
        placeholderText: "Quick Search"
    }, {
        label: "Debug logs",
        isSearchable: true,
        formainmenu: true,
        technologyFeature: "Settings",
        tooltipMessage: "Recent debug logs with their size, opening straight into the log viewer",
        EligibleForAdvanceSearch: true,
        visibleForMetadataMenu: true,
        visibleForMetadataIconMenu: true,
        dataNotAvailableMessage: "Debug logs are not available for you, click on new to record debug logs.",
        value: "DebugLogs",
        metadata: "ApexLog",
        type: "table",
        eligibleForPackageXml: false,
        menuname: "favourite",
        queryForAll: "SELECT Id, LogUser.Name, LogLength, StartTime, Status, Operation, Location FROM ApexLog order by StartTime desc",
        queryForAllWithWhere: "SELECT Id, LogUser.Name, LogLength, StartTime, Status, Operation, Location FROM ApexLog where Operation like ",
        // {uid} is resolved at query time (ssResolveQueryUid) so "my logs"
        // follows whoever is logged in / "view as" rather than being pinned to
        // the user id that happened to exist when this service was created.
        query: "SELECT Id, LogUser.Name, LogUserId, LogLength, LastModifiedDate, Request, Operation, Application, Status, DurationMilliseconds, SystemModstamp, StartTime, Location FROM ApexLog where LogUserId='{uid}' order by StartTime desc",
        headers: ["Log Size(byte)", "Operation", "Start Time"],
        objectlevelaction: [
            { name: "New", actionUrl: ssOrgUrl("/udd/TraceFlag/editTraceFlag.apexp?logType=USER_DEBUG&retURL=%2Fsetup%2Fui%2FlistApexTraces.apexp") },
            { name: "Setup", actionUrl: "/setup/forcecomHomepage.apexp?setupid=ForceCom" },
            { name: "Developer Console", actionUrl: "/_ui/common/apex/debug/ApexCSIPage" }
        ],
        fieldlevelactions: [{}],
        url: DATA_QUERY,
        listUrl: "/setup/ui/listApexTraces.apexp",
        midurl: "",
        imagesrc: chrome.runtime.getURL("/img/icons/debuglogs.png"),
        placeholderText: "Search by size/operation/time/user..."
    }, {
        label: "Package.xml",
        value: "PackageXml",
        tooltipMessage: "The manifest built from everything you have ticked, ready to retrieve or deploy",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: DATA_QUERY,
        visibleForMetadataMenu: true,
        visibleForMetadataIconMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}],
        objectlevelaction: []
    }, {
        label: "Custom Metadata",
        value: "CustomMetadata",
        tooltipMessage: "Custom metadata types and their records (package.xml: they deploy as CustomObject, member ending __mdt)",
        technologyFeature: "Salesforce",
        dataNotAvailableMessage: "No Custom Metadata Types found in logged in org.",
        formainmenu: true,
        isSearchable: true,
        visibleForMetadataMenu: true,
        visibleForMetadataIconMenu: false,
        EligibleForAdvanceSearch: true,
        eligibleForPackageXml: true,
        queryForAll: "SELECT Id, QualifiedApiName, MasterLabel, DeveloperName, NamespacePrefix FROM EntityDefinition WHERE QualifiedApiName LIKE '%__mdt' ORDER BY MasterLabel ASC",
        queryForAllWithWhere: "SELECT Id, QualifiedApiName, MasterLabel, DeveloperName, NamespacePrefix FROM EntityDefinition WHERE QualifiedApiName LIKE '%__mdt' AND MasterLabel LIKE ",
        query: "SELECT Id, QualifiedApiName, MasterLabel, DeveloperName, NamespacePrefix FROM EntityDefinition WHERE QualifiedApiName LIKE '%__mdt' ORDER BY MasterLabel ASC",
        type: "table",
        headers: ["Edit", "MasterLabel"],
        fieldlevelactions: [{ name: "view" }, { name: "edit", actionUrl: "/e" }],
        url: DATA_QUERY,
        listUrl: "/lightning/setup/CustomMetadata/home",
        midurl: "",
        imagesrc: chrome.runtime.getURL("/img/icons/labels.png"),
        placeholderText: "Search Custom Metadata..."
    }, {
        label: "Custom Fields",
        value: "CustomField",
        tooltipMessage: "View custom fields across all objects (package.xml: ObjectName.FieldName)",
        technologyFeature: "Salesforce",
        dataNotAvailableMessage: "No custom fields found.",
        formainmenu: false,
        isSearchable: true,
        visibleForMetadataMenu: true,
        visibleForMetadataIconMenu: false,
        EligibleForAdvanceSearch: true,
        eligibleForPackageXml: true,
        queryForAll: "SELECT Id, DeveloperName, TableEnumOrId, EntityDefinition.QualifiedApiName, NamespacePrefix FROM CustomField ORDER BY DeveloperName ASC",
        queryForAllWithWhere: "SELECT Id, DeveloperName, TableEnumOrId, EntityDefinition.QualifiedApiName, NamespacePrefix FROM CustomField WHERE DeveloperName LIKE ",
        query: "SELECT Id, DeveloperName, TableEnumOrId, EntityDefinition.QualifiedApiName, NamespacePrefix FROM CustomField ORDER BY DeveloperName ASC",
        type: "table",
        headers: ["Object", "Field"],
        fieldlevelactions: [{ name: "view" }],
        url: TOOLING_QUERY,
        listUrl: "/lightning/setup/ObjectManager/home",
        midurl: "",
        imagesrc: chrome.runtime.getURL("/img/icons/fields.png"),
        placeholderText: "Search custom fields..."
    }, {
        label: "Layouts",
        value: "Layout",
        tooltipMessage: "View page layouts (package.xml: ObjectName-LayoutName)",
        technologyFeature: "Salesforce",
        dataNotAvailableMessage: "No layouts found.",
        formainmenu: false,
        isSearchable: true,
        visibleForMetadataMenu: true,
        visibleForMetadataIconMenu: false,
        EligibleForAdvanceSearch: true,
        eligibleForPackageXml: true,
        queryForAll: "SELECT Id, Name, TableEnumOrId, EntityDefinition.QualifiedApiName FROM Layout ORDER BY Name ASC",
        queryForAllWithWhere: "SELECT Id, Name, TableEnumOrId, EntityDefinition.QualifiedApiName FROM Layout WHERE Name LIKE ",
        query: "SELECT Id, Name, TableEnumOrId, EntityDefinition.QualifiedApiName FROM Layout ORDER BY Name ASC",
        type: "table",
        headers: ["Object", "Layout Name"],
        fieldlevelactions: [{ name: "view" }],
        url: TOOLING_QUERY,
        listUrl: "/lightning/setup/ObjectManager/home",
        midurl: "",
        imagesrc: chrome.runtime.getURL("/img/icons/objects.png"),
        placeholderText: "Search layouts..."
    }, {
        label: "Validation Rules",
        value: "ValidationRule",
        tooltipMessage: "View validation rules (package.xml: ObjectName.RuleName)",
        technologyFeature: "Salesforce",
        dataNotAvailableMessage: "No validation rules found.",
        formainmenu: false,
        isSearchable: true,
        visibleForMetadataMenu: true,
        visibleForMetadataIconMenu: false,
        EligibleForAdvanceSearch: true,
        eligibleForPackageXml: true,
        queryForAll: "SELECT Id, ValidationName, EntityDefinition.QualifiedApiName, Active FROM ValidationRule ORDER BY ValidationName ASC",
        queryForAllWithWhere: "SELECT Id, ValidationName, EntityDefinition.QualifiedApiName, Active FROM ValidationRule WHERE ValidationName LIKE ",
        query: "SELECT Id, ValidationName, EntityDefinition.QualifiedApiName, Active FROM ValidationRule ORDER BY ValidationName ASC",
        type: "table",
        headers: ["Object", "Rule Name"],
        fieldlevelactions: [{ name: "view" }],
        url: TOOLING_QUERY,
        listUrl: "/lightning/setup/ObjectManager/home",
        midurl: "",
        imagesrc: chrome.runtime.getURL("/img/icons/workflows.png"),
        placeholderText: "Search validation rules..."
    }, {
        label: "WebLinks / Buttons",
        value: "WebLink",
        tooltipMessage: "View custom buttons and links (package.xml: ObjectName.WebLinkName; home page links go out as CustomPageWebLink)",
        technologyFeature: "Salesforce",
        dataNotAvailableMessage: "No custom buttons/links found.",
        formainmenu: false,
        isSearchable: true,
        visibleForMetadataMenu: true,
        visibleForMetadataIconMenu: false,
        EligibleForAdvanceSearch: true,
        eligibleForPackageXml: true,
        queryForAll: "SELECT Id, Name, EntityDefinition.QualifiedApiName, LinkType, PageOrSobjectType FROM WebLink ORDER BY Name ASC",
        queryForAllWithWhere: "SELECT Id, Name, EntityDefinition.QualifiedApiName, LinkType, PageOrSobjectType FROM WebLink WHERE Name LIKE ",
        query: "SELECT Id, Name, EntityDefinition.QualifiedApiName, LinkType, PageOrSobjectType FROM WebLink ORDER BY Name ASC",
        type: "table",
        headers: ["Object", "Link Name"],
        fieldlevelactions: [{ name: "view" }],
        url: TOOLING_QUERY,
        listUrl: "/lightning/setup/ObjectManager/home",
        midurl: "",
        imagesrc: chrome.runtime.getURL("/img/icons/objects.png"),
        placeholderText: "Search buttons/links..."
    }, {
        label: "Record Types",
        value: "RecordType",
        tooltipMessage: "View record types (package.xml: ObjectName.RecordTypeName)",
        technologyFeature: "Salesforce",
        dataNotAvailableMessage: "No record types found.",
        formainmenu: false,
        isSearchable: true,
        visibleForMetadataMenu: true,
        visibleForMetadataIconMenu: false,
        EligibleForAdvanceSearch: true,
        eligibleForPackageXml: true,
        queryForAll: "SELECT Id, DeveloperName, Name, SobjectType, Description, IsActive FROM RecordType ORDER BY SobjectType, DeveloperName ASC",
        queryForAllWithWhere: "SELECT Id, DeveloperName, Name, SobjectType FROM RecordType WHERE Name LIKE ",
        query: "SELECT Id, DeveloperName, Name, SobjectType, Description, IsActive FROM RecordType ORDER BY SobjectType, DeveloperName ASC",
        type: "table",
        headers: ["Object", "Record Type"],
        fieldlevelactions: [{ name: "view" }],
        url: DATA_QUERY,
        listUrl: "/lightning/setup/ObjectManager/home",
        midurl: "",
        imagesrc: chrome.runtime.getURL("/img/icons/objects.png"),
        placeholderText: "Search record types..."
    }, {
        label: "Launcher Color",
        value: "LauncherColor",
        tooltipMessage: "Change the launcher icon, or stop it animating",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}],
        objectlevelaction: [
            { name: "Feedback", actionUrl: "https://chrome.google.com/webstore/detail/salesforce-simplified/hjeigbpcblpkaienmpihneipkempijob?hl=en" },
            { name: "Report Issue", actionUrl: "https://github.com/rajnikantroy/SalesforceSimplified/issues/new" },
            { name: "Blog", actionUrl: "https://salesforcsimplified.blogspot.com" }
        ]
    }, {
        // Sits with Launcher Color at the foot of the menu - a tool about the
        // extension rather than about the org's metadata.
        label: "Usage Analytics",
        value: "UsageAnalytics",
        tooltipMessage: "How you use Salesforce Simplified, and the org's API consumption",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        label: "News Timeline",
        value: "NewsTimeline",
        tooltipMessage: "Chronological timeline of broadcasted news and org activity",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        label: "API Monitor",
        value: "ApiMonitor",
        tooltipMessage: "Configure, listen, and monitor API integration health & daily reports",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        label: "Audit Trail",
        value: "AuditTrail",
        tooltipMessage: "Search, filter, and inspect setup audit trail & administrative changes",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        /*
         * The Event Graph Engine.
         *
         * Every other entry here answers one question about one kind of thing:
         * what classes exist, what changed in Setup, what the org's instance is
         * doing. None of them answers the question that costs the most time in
         * a real org - what happens when this record is saved - because the
         * answer is spread across triggers, flows, rules and the Apex those
         * call, and no single Setup page holds it.
         *
         * A graph, because the shape is the point: a list of automation on an
         * object says what exists, and says nothing about what fires what.
         *
         * The panel it opens is a shell for now - the entry exists so the rest
         * can be built behind it.
         */
        label: "Event Graph",
        value: "EventGraph",
        tooltipMessage: "A record and everything it is connected to - parents, children, and who changed what",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        /*
         * The watch list, in full.
         *
         * The right-hand card is a glance - what am I watching, what moved -
         * and it only appears where the rail does. This is the page for the
         * rest: the whole history, what each component was last seen at, and
         * the controls for pruning a list that outlives the release it was
         * made for.
         */
        label: "Watching List",
        value: "WatchingList",
        tooltipMessage: "Components you have starred, and every change since you started watching",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        // Penultimate utility row: live service health for this org's
        // instance, pulled from the public Salesforce Trust API.
        label: "Trust Status",
        value: "TrustStatus",
        tooltipMessage: "Live service health for this org's Salesforce instance",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        /*
         * The describe, as it actually comes back.
         *
         * Object Manager shows a curated view of a few of these properties;
         * the rest - controllerName, cascadeDelete, the compound field a
         * component is part of, whether a picklist is dependent - are only in
         * the describe, which otherwise means reading a few thousand lines of
         * JSON in a browser tab.
         */
        label: "Standard & Custom Objects",
        value: "ObjectDescribe",
        tooltipMessage: "Every object in this org, and its full describe",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        /*
         * Bulk jobs, which have no home in Setup.
         *
         * Setup's Bulk Data Load Jobs page lists v1 jobs only, and says almost
         * nothing about a v2 one - so the usual way to find out why an import
         * of forty thousand rows half-worked is a REST call somebody has to
         * know how to write.
         */
        /*
         * Moving components between two orgs you are already signed in to.
         *
         * The two halves of this already existed and never met: package.xml
         * says what to move and retrieve() fetches it, but what came back was
         * a zip in the downloads folder and the rest was somebody else's tool.
         * This is the other end of that - deploy into the paired org, and a
         * record of what happened that survives the browser being closed.
         *
         * Metadata only. Records are not portable by Id between orgs, so data
         * needs a matching key and an upsert: a different mechanism, not a
         * checkbox on this one.
         */
        label: "Org Sync & Jobs",
        value: "SyncJobs",
        tooltipMessage: "Send components to a paired org, and the history of every attempt",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        label: "Bulk API Job Status",
        value: "BulkJobs",
        tooltipMessage: "Recent Bulk API 2.0 jobs and what happened to them",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        /*
         * The API, by hand.
         *
         * Everything else here asks one fixed question. This asks whatever is
         * typed - which is what you want the moment a question is one the menu
         * does not have, and is otherwise a login to Workbench or a curl
         * command with a session id pasted into it.
         */
        label: "REST Explorer",
        value: "RestExplorer",
        tooltipMessage: "Send a REST call to this org and read the answer",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        // Directly above About Us: the last thing that is still a setting,
        // before the row that is not about the org at all.
        label: "Notifications",
        value: "NotificationSettings",
        tooltipMessage: "Choose which alerts this extension may send you",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }, {
        // Last entry in systemData so it is always the final row of the menu:
        // a page about the team behind the extension, not about the org.
        label: "About Us",
        value: "AboutUs",
        tooltipMessage: "Chrome extensions by the Salesforce Simplified team",
        isSearchable: false,
        eligibleForPackageXml: false,
        url: "",
        visibleForMetadataMenu: true,
        listUrl: "/",
        technologyFeature: "Settings",
        fieldlevelactions: [{}]
    }];

    // Expose systemData array for backward compatibility
    this.data = this.systemData;

    // Fast lookup for system items or dynamic objects
    this.byValue = function(value) {
        for (var i = 0; i < this.systemData.length; i++) {
            if (this.systemData[i] && this.systemData[i].value === value) {
                return this.systemData[i];
            }
        }
        return DynamicMetadataService.getByValue(value);
    };
}]);
