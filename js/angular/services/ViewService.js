/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
var app = window.app || angular.module("SalesforceSimplifiedApp");
app.service('viewservice', ['MetaDataContainer', function(MetaDataContainer, $scope) {

var editicon = chrome.runtime.getURL("/img/edit.png");
var downloadicon = chrome.runtime.getURL("/img/download.png");
var securityicon = chrome.runtime.getURL("/img/security.png");

var viewicon = chrome.runtime.getURL("/img/view.png");
var cloneicon = chrome.runtime.getURL("/img/clone.png");
var loadingcar = chrome.runtime.getURL("/img/loadingcar.gif");
var paypalicon = chrome.runtime.getURL("/img/paypal.png");
var upiicon = chrome.runtime.getURL("/img/upi.png");
var searchicon = chrome.runtime.getURL("/img/search.png");

var viewas = chrome.runtime.getURL("/img/icons/viewas.png");
var classes = chrome.runtime.getURL("/img/icons/classes.png");
var triggers = chrome.runtime.getURL("/img/icons/triggers.png");
var labels = chrome.runtime.getURL("/img/icons/labels.png");
var objects = chrome.runtime.getURL("/img/icons/objects.png");
var fields = chrome.runtime.getURL("/img/icons/fields.png");
var flows = chrome.runtime.getURL("/img/icons/flows.png");
var workflows = chrome.runtime.getURL("/img/icons/workflows.png");
var users = chrome.runtime.getURL("/img/icons/users.png");
var debuglogs = chrome.runtime.getURL("/img/icons/debuglogs.png");
var pages = chrome.runtime.getURL("/img/icons/pages.png");
var components = chrome.runtime.getURL("/img/icons/components.png");
var emailtemplates = chrome.runtime.getURL("/img/icons/emailtemplates.png");
var staticresources = chrome.runtime.getURL("/img/icons/staticresources.png");
var database = chrome.runtime.getURL("/img/icons/database.png");
var coverages = chrome.runtime.getURL("/img/icons/coverages.png");
var about = chrome.runtime.getURL("/img/icons/about.png");
var faqicon = chrome.runtime.getURL("/img/icons/faq.png");
var close = chrome.runtime.getURL("/img/icons/close.png");
var recentitems = chrome.runtime.getURL("/img/icons/recentitems.png");
var allitems = chrome.runtime.getURL("/img/icons/moreitems.png");
var AuraDefinitionBundles = chrome.runtime.getURL("/img/icons/AuraDefinitionBundles.png");

var red = chrome.runtime.getURL("/img/ss_icon_enable.png");
var blue = chrome.runtime.getURL("/img/ss_icon_enable_blue.png");
var pink = chrome.runtime.getURL("/img/ss_icon_enable_pink.png");
var purple = chrome.runtime.getURL("/img/ss_icon_enable_purple.png");
var yellow = chrome.runtime.getURL("/img/ss_icon_enable_yellow.png");

var faq = '<b>1. What is Salesforce Simplified?</b><br/>'+
'Salesforce Simplified is chrome extension by installing it, it enables you to see your recently created/modified components.<br/><br/>'+
'<b>2. Why should i use Salesforce Simplified?</b><br/>'+
'Salesforce Simplified is time saver machine, which will help you find your components by avoiding unnecessary clicks.<br/><br/>'+
'<b>3. Will it work on multiple org simultaneously?</b><br/>'+
'Yes! You can use this tool for multiple org simultaneously.<br/><br/>'+
'<b>4. Salesforce Simplified is unable to show my data, What should i do?</b><br/>'+
'Please go to change user, search by your name and select user to view recent items of that user.<br/><br/>'+
'<b>5. How frequently i can change users?</b><br/>'+
'You can change user and see their data as many times you want. There is no any limitations on that.<br/><br/>'+
'<b>6. On advance search, can i search components by user name, email or any other data?</b><br/>'+
'Yes! You can search components by username, email, date or components name.<br/><br/>'+
'<b>7. Can i see debug logs only for logged in users?</b><br/>'+
'Yes! You can see debug logs of only logged in user/changed user.<br/><br/>'+
'<b>8. Can i see debug logs of other users without changing users?</b><br/>'+
'Yes! You can see debug logs of other users from advance search functionality by selecting debug log metadata and search the name of user.<br/><br/>'+
'<b>9. Can i see others metadata of other users without changing users?</b><br/>'+
'Yes! You can see any metadata of other users from advance search functionality by selecting any metadata and search the name of user.<br/><br/>'+
'<b>10. Is there any shortcut to close Salesforce Simplified?</b><br/>'+
'Yes! You can use esc key to close.<br/><br/>';


var searchCode = ' <fieldset><legend>Select Metadata</legend><table class="searchCodeTable">'+
'   <tr><td><select ng-model="selectedMetaMenu" ng-change="searchMetadata(selectedMetaMenu)" ng-options="selectedMetaMenu.label for selectedMetaMenu in AdvanceSearchMenu | filter:selectedMetaMenu.EligibleForAdvanceSearch = true"><option value="">-- Select Metadata --</option></select></td></tr>'+
'   <tr><td><input type="text" ng-change="searchMetadataIfNothingTyped()" id="data" placeholder="Advance Search" ng-model="searchAllMetaData"/><img title="Search users" src="'+searchicon+'" width="18px" height="18px" Class="imgSearch" ng-click="searchMetadataRecordsOnChange()"/ alt="Search users"/></td></tr>'+
'   </table></fieldset><div ng-show="showAllData">'+
'   <table><tr ng-repeat="r in searchFilterItem = (AllMetaDataRecords | filter:searchAllMetaData) | limitTo:renderLimit track by $index">'+
'   <td ng-if="r.Name"><a href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.Name}}</a></td>'+
'   <td ng-if="r.DeveloperName"><a href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.DeveloperName}}</a></td>'+
'   <td ng-if="r.LogLength"><a class="trim-info1" title="View - {{r.Operation}}" target="_blank" href="{{baseUrl}}/p/setup/layout/ApexDebugLogDetailEdit/d?setupid=ApexDebugLogs&apex_log_id={{r.Id}}">{{r.Operation}}</a></td>'+
'   <td ng-if="r.LogLength"><a class="trim-info1" title="Download - {{r.Operation}}({{r.LogLength}} bytes)" target="_blank" href="{{baseUrl}}/servlet/servlet.FileDownload?file={{r.Id}}">{{r.LogLength}}</a></td>'+
'   <td ng-if="r.NumLinesCovered" title="NumLinesCovered - {{r.NumLinesCovered}} NumLinesUncovered - {{r.NumLinesUncovered}}, TotalLine - {{r.NumLinesCovered + r.NumLinesUncovered}}"><a>{{r.NumLinesCovered/(r.NumLinesCovered+r.NumLinesUncovered)*100 | number : 2}}%</a></td>'+
'   <td ng-if="r.NumLinesCovered"><a href="{{baseUrl}}/{{r.ApexClassorTriggerId}}" title="View - {{r.ApexClassOrTrigger.Name}}" target="_blank">{{r.ApexClassOrTrigger.Name}}</a></td>'+
'   </tr>'+'<tr ng-if="moreRows(searchFilterItem)"><td colspan="20" class="ss-more-rows">'+'Showing the first {{renderLimit}} rows - '+'<a href="#" ng-click="showAllRows($event)">show them all</a>'+'</td></tr>'+'</table> '+
'	</div>'+
'  <div ng-if="showloading && selectedMetadata1.type" class="loadingARILoading"><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/ alt=""/>'+
'<span class="loadingARI">Fetching {{selectedMetadata1.label}}...</span>'+
'</div>';
var aboutARI = '<table class="aboutARITable">'+
'   <tr><td colspan="2"><h3>Salesforce Simplified</h3></td></tr>'+
'   <tr><td colspan="2"><a href="https://github.com/rajnikantroy/SalesforceSimplified" target="_blank" title="See how you can use Salesforce Simplified.">How to use</a></td></tr>'+
'   <tr><td colspan="2"><a href="https://github.com/rajnikantroy/SalesforceSimplified/issues/new" target="_blank" title="If you getting any issue, please report on github." >Report Issue</a></td></tr>'+
'   <tr><td colspan="2"><a href="mailto:rajkant020@gmail.com?subject=Feedback/Suggestions of Salesforce Simplified" title="If you have any feedback/suggestions, please mailto rajkant020@gmail.com." target="_blank">Feedback and Suggestions</a></td></tr>'+
'   <tr><td colspan="2"><a href="https://t.me/salesforcevlocity" title="Connect with us on Telegram" target="_blank">Telegram</a></td></tr>'+
'   <tr><td colspan="2"><a href="https://www.fb.com/salesforcesimplified" title="Contribute via paypal/upi" target="_blank">Follow on facebook</a></td></tr>'+
'   <tr><td colspan="2"><a href="" title="Contribute via paypal/upi" ng-click="showpayment()" target="_blank">Donate</a></td></tr>'+
'   <tr title="Contribute via paypal/upi"><td style="vertical-align: inherit;" ng-show="showpaymentflag"><a href="https://www.paypal.me/rajnikantroy" target="_blank"><img title="Contribute via paypal" src="'+paypalicon+'"/ alt="Contribute via paypal"/></a></td><td ng-show="showpaymentflag"><img title="Contribute via BHIM/Tez/Any UPI app." src="'+upiicon+'" width="200px" height="200px"/ alt="Contribute via BHIM/Tez/Any UPI app."/></td></tr>'+
'   <tr title="Contribute via paypal/upi"><td style="vertical-align: inherit;" ng-show="showpaymentflag"><a href="https://www.paypal.me/rajnikantroy" target="_blank"><b>Donate via paypal</b></a></td><td ng-show="showpaymentflag"><b>Donate via UPI(Tez/BHIM etc.)</b></td></tr>'+
'   </table>';

var changeUser = '<fieldset><legend>Search User</legend><table class="searchUserTable">'+
'   <tr><td><span><input type="text" id="searchUserText" ng-model="searchUserModel" placeholder="Search user" placeholder="Search user"/><img title="Search users" src="'+searchicon+'" width="18px" height="18px" Class="imgSearch" ng-click="searchUser()"/ alt="Search users"/> </span></td></tr>'+
'   </table></fieldset>'+
'  <div ng-if="showloading" class="loadingARILoading"><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/ alt=""/>'+
'<span ng-if="showloading" class="loadingARI">Fetching Users...</span>'+
'</div>';

// No ng-if on formainmenu any more: MenuWithIcon is now itself the definition
// of what belongs on the rail, and gating it a second time on "recently
// viewed" was what could leave the strip empty.
this.functionalitiesMenu = '<table class="mainmenuTable"><tr ng-switch on="menu.value" ng-click="detailsPopupOpen(menu)" ng-repeat="menu in MenuWithIcon | filter:searchMenu track by $index">'+
'<td Class="tooltip-me" data-title="{{menu.label}}">'+
'<img ng-switch-when="ChangeUser" class="menuicon" src="'+viewas+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="RecentlyViewed" class="menuicon" src="'+recentitems+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="DebugLogs" class="menuicon" src="'+debuglogs+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="ApexClass" class="menuicon" src="'+classes+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Classes" class="menuicon" src="'+classes+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="ApexTrigger" class="menuicon" src="'+triggers+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Triggers" class="menuicon" src="'+triggers+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="ApexPage" class="menuicon" src="'+pages+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Pages" class="menuicon" src="'+pages+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="ApexComponent" class="menuicon" src="'+components+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Components" class="menuicon" src="'+components+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="AuraDefinitionBundle" class="menuicon" src="'+AuraDefinitionBundles+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="LightningComponentBundle" class="menuicon" src="'+components+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Flow" class="menuicon" src="'+flows+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Flows" class="menuicon" src="'+flows+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="CustomObject" class="menuicon" src="'+objects+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Objects" class="menuicon" src="'+objects+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="CustomField" class="menuicon" src="'+fields+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Fields" class="menuicon" src="'+fields+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="CustomLabel" class="menuicon" src="'+labels+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Labels" class="menuicon" src="'+labels+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="WorkflowRule" class="menuicon" src="'+workflows+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Workflows" class="menuicon" src="'+workflows+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="EmailTemplate" class="menuicon" src="'+emailtemplates+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="EmailTemplates" class="menuicon" src="'+emailtemplates+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="StaticResource" class="menuicon" src="'+staticresources+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="User" class="menuicon" src="'+users+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Users" class="menuicon" src="'+users+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="CustomMetadata" class="menuicon" src="'+database+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="ApexCodeCoverageAggregate" class="menuicon" src="'+coverages+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="About" class="menuicon" src="'+about+'"/ alt="{{menu.label}}"/>'+
'<img ng-switch-when="Faq" class="menuicon" src="'+faqicon+'"/ alt="{{menu.label}}"/>'+
'<span ng-switch-when="ApiMonitor" class="menuicon" style="font-size:20px; line-height:24px; display:inline-block; width:24px; height:24px; text-align:center;">📡</span>'+
'<span ng-switch-when="UsageAnalytics" class="menuicon" style="font-size:20px; line-height:24px; display:inline-block; width:24px; height:24px; text-align:center;">📊</span>'+
'<span ng-switch-when="AuditTrail" class="menuicon" style="font-size:20px; line-height:24px; display:inline-block; width:24px; height:24px; text-align:center;">📜</span>'+
'<img ng-switch-default class="menuicon" ng-src="{{menu.imagesrc || \''+objects+'\'}}"/ alt=""/>'+
'</td>'+
'</tr></table>';

this.articles = '  <div Class="searchCodeFieldset" ng-show="selectedMetadata.label == home">'+searchCode+'</div>'+
'  <div Class="searchCodeFieldset" ng-if="selectedMetadata.value == about">'+aboutARI+'</div>'+
'  <div Class="faqOfSalesforceSimplified" ng-show="selectedMetadata.label == faq">'+faq+'</div>';

this.usersrecords = '<div class="ss-record-header" ng-show="showmyview && !showErrorMessage && selectedMetadata.isSearchable && (visibleCount(\'my\') || showloading)"><div class="hrtitle ARITitleTitle"><p class="ss-record-title" ng-show="selectedMetadata.value != \'ChangeUser\'"><span class="ss-section-toggle" ng-class="{\'is-collapsed\': !sectionOpen.my}" ng-click="toggleSection(\'my\')" title="{{sectionOpen.my ? \'Collapse\' : \'Expand\'}}">{{sectionOpen.my ? \'\u25be\' : \'\u25b8\'}}</span><span>{{uname}} {{selectedMetadata.label}} ({{visibleCount(\'my\')}}<span ng-if="visibleCount(\'my\') !== total_records"> of {{total_records}}</span>)</span> <span class="ss-record-actions"><span class="ss-raw-action" ng-click="copyRawJson(\'my\')" title="Copy Raw JSON of My Records"><span ng-show="!myRawCopied">{ }</span><span class="ss-raw-copied" ng-show="myRawCopied">✓ Copied</span></span>'+
'<span class="ss-raw-action" ng-show="hasRequestJson(\'my\')" ng-click="copyRequestJson(\'my\')" title="Copy the SOQL request behind this list" style="font-size:12px; font-weight:bold;"><span ng-show="!myReqCopied">&#x21E1;</span><span ng-show="myReqCopied" style="color:#16a34a; font-size:11px;">&#x2713; Copied</span></span>'+
'<span class="ss-raw-action" ng-click="downloadRawJson(\'my\')" title="Download Raw JSON of My Records">&#x21E3;</span></span><span class="ss-selectall ss-watchall" ng-click="watchAllVisible(\'my\')" title="{{anyWatched(\'my\') ? \'Stop watching everything in this list\' : \'Watch every row below for changes\'}}"><span class="ss-bookmark-star" ng-class="{\'is-on\': anyWatched(\'my\')}">{{anyWatched(\'my\') ? \'\\u2605\' : \'\\u2606\'}}</span><label>{{anyWatched(\'my\') ? \'Unwatch all\' : \'Watch all\'}}</label><span class="ss-watch-count" ng-show="watchedCount(\'my\')" title="{{watchedCount(\'my\')}} of the rows below {{watchedCount(\'my\') === 1 ? \'is\' : \'are\'}} on your watch list">{{watchedCount(\'my\')}}</span></span><span class="ss-selectall" ng-if="selectedMetadata.eligibleForPackageXml" ng-click="selectAllForPackageXml(\'my\')" title="{{allSelectedForPackageXml(\'my\') ? \'Remove every row below from package.xml\' : \'Add every row below to package.xml\'}}"><input type="checkbox" class="regular-checkbox" style="pointer-events:none;" ng-checked="allSelectedForPackageXml(\'my\')"/><span>{{allSelectedForPackageXml(\'my\') ? \'Remove all from package.xml\' : \'Add all to package.xml\'}}</span></span><span class="ss-selectall" ng-if="selectedMetadata.eligibleForDataDownload" ng-click="selectAllForDataDownload(\'my\')" title="{{anySelectedForDataDownload(\'my\') ? \'Clear every row below from the JSON export\' : \'Select every row below for JSON export\'}}"><input type="checkbox" class="regular-checkbox" style="pointer-events:none;" ng-checked="anySelectedForDataDownload(\'my\')"/><span>{{anySelectedForDataDownload(\'my\') ? \'Clear all\' : \'Select all\'}}</span></span></p></div><div ng-show="unamewithoutastr && selectedMetadata.value != \'ChangeUser\' && (visibleCount(\'my\') || showloading)" class="recorddescription">These {{selectedMetadata.label}} are recently created/modified by {{unamewithoutastr}}</div><p ng-show="selectedMetadata.value == \'ChangeUser\'">Click on view as button</p></div>'+
'<div ng-if="showmyview && showloading && selectedMetadata.type" class="loadingARILoading"><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/ alt=""/>'+
'<span ng-if="showmyview && showloading && selectedMetadata.type" class="loadingARI">Fetching {{selectedMetadata.label}}...</span>'+
'</div>'+
'  <table class="Records" id="RecentRecords" ng-show="!showErrorMessage && showmyview && sectionOpen.my">'+
// A header, shown only once the object contributes columns of its own -
// with just a name column there is nothing to disambiguate.
'   <tr class="ss-grid-head" ng-if="selectedMetadata.columns.length && visibleCount(\'my\')">'+
'     <th colspan="{{gridLeadColumns(records)}}">{{selectedMetadata.label}}</th>'+
'     <th ng-repeat="col in selectedMetadata.columns track by $index">{{col.label}}</th>'+
'   </tr>'+
'   <tr ng-repeat="r in myFilterItem = (records | filter:namespaceFilter | filter:searchAllMetaData) | limitTo:renderLimit track by $index">'+
// The same star as the All list. A component is the same component whichever
// list it was found in, and both selection checkboxes already appear in both -
// so a star in only one reads as this row not being watchable.
'\t<td class="SimplifiedAction ss-bookmark-cell" ng-if="canBookmark(r)">'+
'<span class="ss-bookmark-star" ng-class="{\'is-on\': isBookmarked(r)}" ng-click="toggleBookmark(r)" '+
'title="{{isBookmarked(r) ? \'Stop watching this component\' : \'Watch this component for changes\'}}">'+
'{{isBookmarked(r) ? \'\\u2605\' : \'\\u2606\'}}</span></td>'+
'   <td class="SimplifiedAction" ng-if="faction.name && (faction.actionUrl || selectedMetadata.value == \'ChangeUser\')" ng-show="r.LogLength || r.Name || r.email || r.DeveloperName || r.MasterLabel || r.Type || r.CaseNumber || r.ContractNumber || r.OrderNumber || r._ssLabel" ng-repeat="faction in selectedMetadata.fieldlevelactions">'+
'       <a ng-if="faction.name == \'view\' && faction.actionUrl" target="_blank" href="{{baseUrl}}/{{faction.actionUrl}}{{r.Id}}">{{faction.name}}</a>'+
'       <a ng-if="selectedMetadata.value == \'ChangeUser\' && (faction.name == \'ChangeUser\' || faction.name == \'change\')" class="changeUser" ng-click="changeUser(r.Id)">View as</a>'+
'       <a ng-if="faction.name == vieweye" target="_blank" href="{{baseUrl}}/{{r.Id}}" data-title="View" Class="tooltip-me"><img src="'+viewicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == edit && selectedMetadata.value != AssignmentRule" target="_blank" href="{{baseUrl}}/{{r.Id}}{{faction.actionUrl}}" data-title="Edit" Class="tooltip-me"><img src="'+editicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == edit && selectedMetadata.value == AssignmentRule" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}" data-title="Edit" Class="tooltip-me"><img src="'+editicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == download" target="_blank" href="{{baseUrl}}/{{faction.actionUrl}}{{r.Id}}" Class="tooltip-me" data-title="Download"><img src="'+downloadicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == security" target="_blank" href="{{baseUrl}}{{securityPreUrl}}{{r.Id}}{{faction.actionUrl}}{{r.Name}}" Class="tooltip-me" data-title="Security"><img src="'+securityicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == clsSecurity" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}&apex_name={{r.Name}}" Class="tooltip-me" data-title="Security"><img src="'+securityicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == clone" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}" Class="tooltip-me" data-title="Clone"><img  src="'+cloneicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == cloneWF" target="_blank" href="{{baseUrl}}/{{r.Id}}{{faction.actionUrl}}" Class="tooltip-me" data-title="Clone"><img  src="'+cloneicon+'" width="20px" height="20px"/ alt=""/></a>'+
'   </td>'+
'\t<td ng-if="selectedMetadata.eligibleForPackageXml" class="SimplifiedAction"><input class="regular-checkbox" id="user_{{r.Id}}" ng-click="SelectMetadataForManagedPackage(metaKey(r), !isMetaSelected(r))" type="checkbox" ng-checked="isMetaSelected(r)" /></td>'+'\t<td ng-if="selectedMetadata.eligibleForDataDownload" class="SimplifiedAction"><input class="regular-checkbox" id="data_user_{{r.Id}}" ng-click="toggleDataSelection(r.Id, !isDataSelected(r))" type="checkbox" ng-checked="isDataSelected(r)" /></td>'+ '   <td ng-if="r.LogLength" class="tooltip-me" data-title="View - {{r.Operation}}({{r.LogLength}} bytes)"><a class="trim-info" target="_blank" href="{{baseUrl}}/p/setup/layout/ApexDebugLogDetailEdit/d?setupid=ApexDebugLogs&apex_log_id={{r.Id}}">{{r.LogLength}}</a></td>'+
'   <td ng-if="r.LogLength" class="tooltip-me" data-title="View - {{r.Operation}}({{r.LogLength}} bytes)"><a class="trim-info" target="_blank" href="{{baseUrl}}/p/setup/layout/ApexDebugLogDetailEdit/d?setupid=ApexDebugLogs&apex_log_id={{r.Id}}">{{r.Operation}}</a></td>'+
'   <td class="RecentTime" ng-if="r.LogLength">{{r.StartTime | date:"MM/dd hh:mm:ss Z"}}</td>'+
'   <td ng-if="r.Name" Class="tooltip-me" data-title="{{r.Name}}" ng-class="{\'ss-truncated\': r.Name.length > 30}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.Name | limitTo:30}}{{r.Name.length > 30 ? \'\u2026\' : \'\'}} <span ng-if="r.IsActive || r.vlocity_cmt__IsActive__c || r.vlocity_ins__IsActive__c || r.vlocity_cmt__Active__c || r.vlocity_ins__Active__c" class="ss-active-status-dot" title="Active"></span></a></td>'+
'   <td ng-if="r.MasterLabel && !r.Name" Class="tooltip-me" data-title="{{r.MasterLabel}}" ng-class="{\'ss-truncated\': r.MasterLabel.length > 30}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.MasterLabel | limitTo:30}}{{r.MasterLabel.length > 30 ? \'\u2026\' : \'\'}}</a></td>'+
'   <td ng-if="r.CaseNumber" Class="tooltip-me" data-title="{{r.CaseNumber}}" ng-class="{\'ss-truncated\': r.CaseNumber.length > 30}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.CaseNumber | limitTo:30}}{{r.CaseNumber.length > 30 ? \'\u2026\' : \'\'}} </a></td>'+
'   <td ng-if="r.ContractNumber" Class="tooltip-me" data-title="{{r.ContractNumber}}" ng-class="{\'ss-truncated\': r.ContractNumber.length > 30}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.ContractNumber | limitTo:30}}{{r.ContractNumber.length > 30 ? \'\u2026\' : \'\'}} </a></td>'+
'   <td ng-if="r.OrderNumber" Class="tooltip-me" data-title="{{r.OrderNumber}}" ng-class="{\'ss-truncated\': r.OrderNumber.length > 30}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.OrderNumber | limitTo:30}}{{r.OrderNumber.length > 30 ? \'\u2026\' : \'\'}} </a></td>'+
'   <td ng-if="r.email" Class="tooltip-me" data-title="{{r.username}}"><a Class="trim-info-content" target="_blank">{{r.username}}</a></td>'+
'   <td ng-if="r.DeveloperName && !r.Name && !r.MasterLabel" data-title="{{r.DeveloperName}}" ng-class="{\'ss-truncated\': r.DeveloperName.length > 30}" class="tooltip-me"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.DeveloperName | limitTo:30}}{{r.DeveloperName.length > 30 ? \'\u2026\' : \'\'}}</a></td>'+
'   <td ng-if="r._ssLabel && !r.Name && !r.MasterLabel && !r.DeveloperName" data-title="{{r._ssLabel}}" ng-class="{\'ss-truncated\': (r.Name || r.MasterLabel || r._ssLabel).length > 30}" class="tooltip-me"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{(r.Name || r.MasterLabel || r._ssLabel) | limitTo:30}}{{(r.Name || r.MasterLabel || r._ssLabel).length > 30 ? \'\u2026\' : \'\'}}</a></td>'+
// Columns the org's describe says this object actually carries. The values
// are precomputed per fetch, so this is a plain array read per row.
'\t<td class="ss-extra-col" ng-repeat="v in r._ssCols track by $index" title="{{selectedMetadata.columns[$index].label}}">{{v}}</td>'+
'   </tr>'+'<tr ng-if="moreRows(myFilterItem)"><td colspan="20" class="ss-more-rows">'+'Showing the first {{renderLimit}} rows - '+'<a href="#" ng-click="showAllRows($event)">show them all</a>'+'</td></tr>'+''+
'</table> '+
/*
 * The empty state, which was a bare <span> and a stray </br>.
 *
 * With no class it took the browser's defaults - full-size black body text,
 * no spacing - so "Debug logs are not available for you" landed heavier and
 * larger than the heading it sat under, reading as an error rather than as
 * the ordinary answer "there are none of these yet". It is a note, and now
 * looks like the panel's other notes.
 */
// isSearchable is what marks a record list. Without it this div renders on
// every utility page - it always did, but it was invisible while its only
// content was an undefined message, and the reason line gave it text.
'<div class="ss-empty-state" ng-if="selectedMetadata.isSearchable && showmyview && !visibleCount(\'my\') && !showloading">'+
'{{selectedMetadata.dataNotAvailableMessage}}'+
'<span class="ss-empty-why" ng-show="emptyListReason(\'my\')">{{emptyListReason(\'my\')}}</span>'+
'</div>';

this.allrecords = '<div class="ss-record-header" ng-show="selectedMetadata.isSearchable && !showErrorMessage && (visibleCount(\'all\') || showallloading)" ng-if="AllMetaDataRecords.length>0"><div class="hrtitle ARITitleTitle"><p class="ss-record-title" ng-show="selectedMetadata.value != \'ChangeUser\'"><span class="ss-section-toggle" ng-class="{\'is-collapsed\': !sectionOpen.all}" ng-click="toggleSection(\'all\')" title="{{sectionOpen.all ? \'Collapse\' : \'Expand\'}}">{{sectionOpen.all ? \'\u25be\' : \'\u25b8\'}}</span><span>All {{selectedMetadata.label}} ({{visibleCount(\'all\')}}<span ng-if="visibleCount(\'all\') !== totalSize_AllMetaDataRecords"> of {{totalSize_AllMetaDataRecords}}</span><span ng-if="orgTotalRecords > totalSize_AllMetaDataRecords"> \u00b7 org has {{orgTotalRecords}}</span>)</span> <span class="ss-record-actions"><span class="ss-raw-action" ng-click="copyRawJson(\'all\')" title="Copy Raw JSON of All Records"><span ng-show="!allRawCopied">{ }</span><span class="ss-raw-copied" ng-show="allRawCopied">✓ Copied</span></span>'+
'<span class="ss-raw-action" ng-show="hasRequestJson(\'all\')" ng-click="copyRequestJson(\'all\')" title="Copy the SOQL request behind this list" style="font-size:12px; font-weight:bold;"><span ng-show="!allReqCopied">&#x21E1;</span><span ng-show="allReqCopied" style="color:#16a34a; font-size:11px;">&#x2713; Copied</span></span>'+
'<span class="ss-raw-action" ng-click="downloadRawJson(\'all\')" title="Download Raw JSON of All Records">&#x21E3;</span></span><span class="ss-selectall ss-watchall" ng-click="watchAllVisible(\'all\')" title="{{anyWatched(\'all\') ? \'Stop watching everything in this list\' : \'Watch every row below for changes\'}}"><span class="ss-bookmark-star" ng-class="{\'is-on\': anyWatched(\'all\')}">{{anyWatched(\'all\') ? \'\\u2605\' : \'\\u2606\'}}</span><label>{{anyWatched(\'all\') ? \'Unwatch all\' : \'Watch all\'}}</label><span class="ss-watch-count" ng-show="watchedCount(\'all\')" title="{{watchedCount(\'all\')}} of the rows below {{watchedCount(\'all\') === 1 ? \'is\' : \'are\'}} on your watch list">{{watchedCount(\'all\')}}</span></span><span class="ss-selectall" ng-if="selectedMetadata.eligibleForPackageXml" ng-click="selectAllForPackageXml(\'all\')" title="{{allSelectedForPackageXml(\'all\') ? \'Remove every row below from package.xml\' : \'Add every row below to package.xml\'}}"><input type="checkbox" class="regular-checkbox" style="pointer-events:none;" ng-checked="allSelectedForPackageXml(\'all\')"/><span>{{allSelectedForPackageXml(\'all\') ? \'Remove all from package.xml\' : \'Add all to package.xml\'}}</span></span><span class="ss-selectall" ng-if="selectedMetadata.eligibleForDataDownload" ng-click="selectAllForDataDownload(\'all\')" title="{{anySelectedForDataDownload(\'all\') ? \'Clear every row below from the JSON export\' : \'Select every row below for JSON export\'}}"><input type="checkbox" class="regular-checkbox" style="pointer-events:none;" ng-checked="anySelectedForDataDownload(\'all\')"/><span>{{anySelectedForDataDownload(\'all\') ? \'Clear all\' : \'Select all\'}}</span></span></p></div><div ng-show="unamewithoutastr && selectedMetadata.value != \'ChangeUser\'" class="recorddescription">These {{selectedMetadata.label}} are recently created/modified by all developers in org.</div><p ng-show="selectedMetadata.value == \'ChangeUser\'">View as different user</p></div>'+
'<div ng-if="showallloading && selectedMetadata.type" class="loadingARILoading"><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/ alt=""/>'+
'<span ng-if="showallloading && selectedMetadata.type" class="loadingARI">Fetching all {{selectedMetadata.label}}...</span>'+
'</div>'+
'<div class="ss-empty-state" ng-if="selectedMetadata.isSearchable && !visibleCount(\'all\') && !showallloading && !showErrorMessage">'+
'No {{selectedMetadata.label}} to show for the whole org.'+
'<span class="ss-empty-why" ng-show="emptyListReason(\'all\')">{{emptyListReason(\'all\')}}</span>'+
'</div>'+
'  <table class="Records" id="AllRecords" ng-if="AllMetaDataRecords" ng-show="!showErrorMessage && sectionOpen.all">'+
// A header, shown only once the object contributes columns of its own -
// with just a name column there is nothing to disambiguate.
'   <tr class="ss-grid-head" ng-if="selectedMetadata.columns.length && visibleCount(\'all\')">'+
'     <th colspan="{{gridLeadColumns(AllMetaDataRecords)}}">{{selectedMetadata.label}}</th>'+
'     <th ng-repeat="col in selectedMetadata.columns track by $index">{{col.label}}</th>'+
'   </tr>'+
'   <tr ng-repeat="r in allFilterItem = (AllMetaDataRecords | filter:namespaceFilter | filter:searchAllMetaData) | limitTo:renderLimit track by $index">'+
// Watch this component. Hidden rather than disabled for rows with no Id -
// EntityDefinition and friends are addressed by name and cannot be queried
// back later, so offering a star there would promise a check that never runs.
'\t<td class="SimplifiedAction ss-bookmark-cell" ng-if="canBookmark(r)">'+
'<span class="ss-bookmark-star" ng-class="{\'is-on\': isBookmarked(r)}" ng-click="toggleBookmark(r)" '+
'title="{{isBookmarked(r) ? \'Stop watching this component\' : \'Watch this component for changes\'}}">'+
'{{isBookmarked(r) ? \'\\u2605\' : \'\\u2606\'}}</span></td>'+
'   <td class="SimplifiedAction" ng-if="faction.name && (faction.actionUrl || selectedMetadata.value == \'ChangeUser\')" ng-show="r.LogLength || r.Name || r.DeveloperName || r.MasterLabel || r.CaseNumber || r.ContractNumber || r.OrderNumber || r._ssLabel" ng-repeat="faction in selectedMetadata.fieldlevelactions">'+
'       <a ng-if="faction.name == \'view\' && faction.actionUrl" target="_blank" href="{{baseUrl}}/{{faction.actionUrl}}{{r.Id}}">{{faction.name}}</a>'+
'       <a ng-if="selectedMetadata.value == \'ChangeUser\' && (faction.name == \'ChangeUser\' || faction.name == \'change\')" class="changeUser" ng-click="changeUser(r.Id)">View as</a>'+
'       <a ng-if="faction.name == vieweye" target="_blank" href="{{baseUrl}}/{{r.Id}}" data-title="View" Class="tooltip-me"><img src="'+viewicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == edit && selectedMetadata.value != AssignmentRule" target="_blank" href="{{baseUrl}}/{{r.Id}}{{faction.actionUrl}}" data-title="Edit" Class="tooltip-me"><img src="'+editicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == edit && selectedMetadata.value == AssignmentRule" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}" data-title="Edit" Class="tooltip-me"><img src="'+editicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == download" target="_blank" href="{{baseUrl}}/{{faction.actionUrl}}{{r.Id}}" Class="tooltip-me" data-title="Download"><img src="'+downloadicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == security" target="_blank" href="{{baseUrl}}{{securityPreUrl}}{{r.Id}}{{faction.actionUrl}}{{r.Name}}" Class="tooltip-me" data-title="Security"><img src="'+securityicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == clsSecurity" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}&apex_name={{r.Name}}" Class="tooltip-me" data-title="Security"><img src="'+securityicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == clone" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}" Class="tooltip-me" data-title="Clone"><img  src="'+cloneicon+'" width="20px" height="20px"/ alt=""/></a>'+
'       <a ng-if="faction.name == cloneWF" target="_blank" href="{{baseUrl}}/{{r.Id}}{{faction.actionUrl}}" Class="tooltip-me" data-title="Clone"><img  src="'+cloneicon+'" width="20px" height="20px"/ alt=""/></a>'+
'   </td>'+
'\t<td ng-if="selectedMetadata.eligibleForPackageXml" class="SimplifiedAction"><input class="regular-checkbox" id="allData_{{r.Id}}" ng-click="SelectMetadataForManagedPackage(metaKey(r), !isMetaSelected(r))" type="checkbox" ng-checked="isMetaSelected(r)" /></td>'+'\t<td ng-if="selectedMetadata.eligibleForDataDownload" class="SimplifiedAction"><input class="regular-checkbox" id="allDataDownload_{{r.Id}}" ng-click="toggleDataSelection(r.Id, !isDataSelected(r))" type="checkbox" ng-checked="isDataSelected(r)" /></td>'+ '   <td ng-if="r.LogLength" class="tooltip-me" data-title="View - {{r.Operation}}({{r.LogLength}} bytes)" ><a class="trim-info" target="_blank" href="{{baseUrl}}/p/setup/layout/ApexDebugLogDetailEdit/d?setupid=ApexDebugLogs&apex_log_id={{r.Id}}">{{r.LogLength}}</a></td>'+
'   <td ng-if="r.LogLength" class="tooltip-me" data-title="View - {{r.Operation}}({{r.LogLength}} bytes)"><a class="trim-info" target="_blank" href="{{baseUrl}}/p/setup/layout/ApexDebugLogDetailEdit/d?setupid=ApexDebugLogs&apex_log_id={{r.Id}}">{{r.Operation}}</a></td>'+
'   <td class="RecentTime" ng-if="r.LogLength">{{r.StartTime | date:"MM/dd hh:mm:ss Z"}}</td>'+
'   <td ng-if="r.Name" Class="tooltip-me" data-title="{{r.Name}}" ng-class="{\'ss-truncated\': r.Name.length > 30}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.Name | limitTo:30}}{{r.Name.length > 30 ? \'\u2026\' : \'\'}} <span ng-if="r.IsActive || r.vlocity_cmt__IsActive__c || r.vlocity_ins__IsActive__c || r.vlocity_cmt__Active__c || r.vlocity_ins__Active__c" class="ss-active-status-dot" title="Active"></span></a></td>'+
'   <td ng-if="r.MasterLabel && !r.Name" Class="tooltip-me" data-title="{{r.MasterLabel}}" ng-class="{\'ss-truncated\': r.MasterLabel.length > 30}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.MasterLabel | limitTo:30}}{{r.MasterLabel.length > 30 ? \'\u2026\' : \'\'}}</a></td>'+
'   <td ng-if="r.CaseNumber" Class="tooltip-me" data-title="{{r.CaseNumber}}" ng-class="{\'ss-truncated\': r.CaseNumber.length > 30}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.CaseNumber | limitTo:30}}{{r.CaseNumber.length > 30 ? \'\u2026\' : \'\'}} </a></td>'+
'   <td ng-if="r.ContractNumber" Class="tooltip-me" data-title="{{r.ContractNumber}}" ng-class="{\'ss-truncated\': r.ContractNumber.length > 30}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.ContractNumber | limitTo:30}}{{r.ContractNumber.length > 30 ? \'\u2026\' : \'\'}} </a></td>'+
'   <td ng-if="r.OrderNumber" Class="tooltip-me" data-title="{{r.OrderNumber}}" ng-class="{\'ss-truncated\': r.OrderNumber.length > 30}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.OrderNumber | limitTo:30}}{{r.OrderNumber.length > 30 ? \'\u2026\' : \'\'}} </a></td>'+
'   <td ng-if="r.email" Class="tooltip-me" data-title="{{r.username}}"><a Class="trim-info-content" target="_blank">{{r.username}}</a></td>'+
'   <td ng-if="r.DeveloperName && !r.Name && !r.MasterLabel" data-title="{{r.DeveloperName}}" ng-class="{\'ss-truncated\': r.DeveloperName.length > 30}" class="tooltip-me"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.DeveloperName | limitTo:30}}{{r.DeveloperName.length > 30 ? \'\u2026\' : \'\'}}</a></td>'+
'   <td ng-if="r._ssLabel && !r.Name && !r.MasterLabel && !r.DeveloperName" data-title="{{r._ssLabel}}" ng-class="{\'ss-truncated\': (r.Name || r.MasterLabel || r._ssLabel).length > 30}" class="tooltip-me"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{(r.Name || r.MasterLabel || r._ssLabel) | limitTo:30}}{{(r.Name || r.MasterLabel || r._ssLabel).length > 30 ? \'\u2026\' : \'\'}}</a></td>'+
// Columns the org's describe says this object actually carries. The values
// are precomputed per fetch, so this is a plain array read per row.
'\t<td class="ss-extra-col" ng-repeat="v in r._ssCols track by $index" title="{{selectedMetadata.columns[$index].label}}">{{v}}</td>'+
'   </tr>'+'<tr ng-if="moreRows(allFilterItem)"><td colspan="20" class="ss-more-rows">'+'Showing the first {{renderLimit}} rows - '+'<a href="#" ng-click="showAllRows($event)">show them all</a>'+'</td></tr>'+'</table> ';

this.objectlevelaction = '<div class="ss-header-title-container">'+
'<h2 class="ss-header-title-text tooltip-me" data-title="{{selectedMetadata.tooltipMessage}}">{{selectedMetadata.label}}</h2>'+
'<p class="ss-header-desc" ng-show="selectedMetadata.tooltipMessage">{{selectedMetadata.tooltipMessage}}</p>'+
/*
 * Why there is no tick column here - said by the line above, not by a
 * second one.
 *
 * This was a separate note, added when a list that could not be packaged
 * simply had no checkbox column and nothing said why. The type description
 * beside it came later and says the same thing for every list where the
 * question arises: "Standard metadata in this org. Can be selected for
 * package.xml", or "Data records - not part of a package.xml".
 *
 * So on a metadata list it was said twice, and on the three utility pages
 * that are neither - View As, Recently viewed, Debug logs - it was said at
 * all, under a heading about looking at the org as another user. Nobody
 * arrives at a list of users wondering why they cannot deploy them.
 */
'</div>'+
'  <table class="ARITitleTable">'+
'<tr ng-if="!selectedMetadata.listUrl"><td class="ARITitleData" ng-repeat="action in selectedMetadata.objectlevelaction">'+
'<a target="_blank" Class="tooltip-me" data-title="action.name" ng-href="{{orgActionUrl(action.actionUrl)}}">{{action.name}}</a>'+
'<td/></tr>'+
'<tr ng-if="selectedMetadata.listUrl"><td class="ARITitleData" ng-repeat="action in selectedMetadata.objectlevelaction">'+
'<a target="_blank" Class="tooltip-me" data-title="{{action.name}}" ng-href="{{orgActionUrl(action.actionUrl)}}">{{action.name}}</a>'+
'<td/></tr></table>';

/*
 * Title and Quick Find sit outside the scrolling region rather than being the
 * first two rows of the scrolling table, so they stay put while the metadata
 * list moves under them. Sticky positioning was the other option, but the list
 * table is display:block, which makes a sticky <th> land in an anonymous table
 * box and behave inconsistently - a flex column is predictable.
 *
 * The panel keeps the mainmenuSidebar class: the controller shows and hides it
 * by that name, and the row styling in styles.css is written against it.
 */
this.metadatamainmenu = '<div class="mainmenuSidebar">'+
'<div class="ss-metadata-title" style="display:flex; align-items:center; justify-content:space-between;">'+
'<b>Metadata</b>'+
'<div class="ss-sidebar-width-controls">'+
'<button ng-click="adjustSidebarWidth(-20)" title="Shrink sidebar width" class="ss-width-btn">-</button>'+
'<span class="ss-width-label">{{sidebarWidth || 240}}px</span>'+
'<button ng-click="adjustSidebarWidth(20)" title="Widen sidebar width" class="ss-width-btn">+</button>'+
'<button ng-click="resetSidebarWidth()" title="Reset sidebar width" class="ss-width-btn ss-reset-btn">↺</button>'+
'</div>'+
'</div>'+
'<div class="ss-sidebar-resizer" ng-mousedown="startSidebarResize($event)" title="Drag to resize sidebar width"></div>'+
'<div class="ss-metadata-find"><input class="MetadataSearchClass" placeholder="Quick Find..." type="text" ng-model="searchMetadataMenu" /></div>'+
'<div class="ss-metadata-list">'+
'<table class="ss-metadata-table" style="margin:0; padding:0; width:100%; border-collapse:collapse;">'+
'<tr ng-click="detailsPopupOpen(menu)" ng-repeat="menu in metadataMenu | filter : searchMetadataMenu" ng-class="{activeMenuItem: selectedMetadata.value === menu.value, hasPackageXmlItems: hasPackageXmlSelected(menu)}">'+
'<td Class="menusidebarText" data-title="{{menu.menuLabel || menu.label}}" style="padding:7px 12px; font-size:12.5px; cursor:pointer;"><span>{{menu.menuLabel || menu.label}}</span><span ng-if="hasPackageXmlSelected(menu)" class="ss-package-badge" style="float:right; background:var(--ss-blue-dark); color:#ffffff; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:10px; line-height:1.2;">{{getPackageXmlSelectedCount(menu)}}</span></td></tr></table>'+
'</div>'+
/*
 * The system utilities, pinned to the foot of the bar - and deliberately not
 * filtered by Quick Find.
 *
 * Quick Find searches the metadata list; these are a fixed set of tools in
 * their own section, indexed separately. Filtering them too made the pinned
 * block resize on every keystroke and disappear entirely for most searches,
 * so the one part of the bar that is supposed to stay put was the part that
 * moved most.
 */
'<div class="ss-system-accordion-header" ng-click="toggleSystemAccordion()" title="Click to toggle system apps">'+
'<span class="ss-system-accordion-title">⚙️ System Apps</span>'+
'<span class="ss-system-accordion-icon"><span ng-show="showSystemAccordion">&#9650;</span><span ng-show="!showSystemAccordion">&#9660;</span></span>'+
'</div>'+
'<div class="ss-metadata-system" ng-show="showSystemAccordion">'+
'<table class="ss-metadata-table" style="margin:0; padding:0; width:100%; border-collapse:collapse;">'+
'<tr ng-click="detailsPopupOpen(menu)" ng-repeat="menu in systemMenu" ng-class="{activeMenuItem: selectedMetadata.value === menu.value}">'+
'<td Class="menusidebarText" data-title="{{menu.label}}" style="padding:7px 12px; font-size:12.5px; cursor:pointer;">{{menu.label}}</td></tr></table>'+
'</div>'+
'</div>';

/*
 * Footer ticker. One headline, replaced on a timer by the controller. Plain
 * text by request - no icon, no badge - and clickable only when the headline
 * actually points somewhere, so nothing looks like a link that does nothing.
 */
/*
 * One headline, short.
 *
 * It ran as many as the bar held, which was right when the headline was the
 * bar. It is not any more: the footer carries the watch-list and manifest
 * counts, and those have a fixed place on the right that a long run of news
 * would otherwise push around.
 *
 * Capped at 100 characters rather than left to the width, so the cut is the
 * same on every screen and the buttons never move.
 */
this.ssnews = '<div class="ss-news">'+
'<span class="ss-news-item" ng-if="visibleNews.length" '+
'ng-class="{\'ss-news-link\': newsTargetLabelFor(visibleNews[0]), \'ss-news-in\': newsAnimating}" '+
'ng-click="openNewsTarget(visibleNews[0])" '+
'data-title="{{visibleNews[0].text}}">'+
'{{visibleNews[0].text | limitTo:100}}{{visibleNews[0].text.length > 100 ? \'\u2026\' : \'\'}}'+
'</span>'+
'<span class="ss-news-item" ng-if="!visibleNews.length">Salesforce Simplified active &amp; monitoring org activity</span>'+
'</div>';

this.developeranalysis =' <div class="userlist ss-right-card" ng-show="userFrequencyList.length && userFrequencyList.length>0 && selectedMetadata.isSearchable && showUserFrequency">'+
'<div class="ss-right-card-header"><b>Navigate by Users</b></div>'+
'<p class="toptendevelopersDescription">Top modifiers of recent {{totalSize_AllMetaDataRecords}} {{selectedMetadata.label}}</p>'+
'<table class="ss-users-table"><tr ng-repeat="userFrequency in userFrequencyList track by $index" class="ss-user-row" ng-click="searchForUser(userFrequency.username)">'+
'<td class="username-trim" title="{{userFrequency.username}}">{{userFrequency.username}}</td>'+
'<td class="td2"><span class="ss-freq-badge">{{userFrequency.frequency}}</span></td>'+
'</tr></table>'+
'</div>'+
'<div ng-if="showallloading && selectedMetadata.type" class="loadingARILoading"><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/ alt=""/>'+
'<span ng-if="showallloading && selectedMetadata.type" class="loadingARI">Analyzing top 10 Users for {{selectedMetadata.label}}...</span>'+
'</div>';

this.activeuserstoday = '<div class="userlist ss-right-card" ng-show="isAuditTrailPage()">'+
/* The count in the heading, so the size of today is readable without
 * counting rows - and only once there is a list, or it reads "(0)" for as
 * long as the query takes. */
'<div class="ss-right-card-header"><b>In the org today'+
'<span ng-show="activeUsersToday.length"> ({{activeUsersToday.length}})</span>'+
'</b></div>'+
'<div ng-if="isLoadingActiveUsersToday" class="ss-active-users-note">Checking today\'s logins...</div>'+
'<p class="ss-active-users-note ss-active-users-warn" ng-show="activeUsersTodayError">{{activeUsersTodayError}}</p>'+
'<p class="ss-active-users-note" ng-show="!isLoadingActiveUsersToday && !activeUsersTodayError && !activeUsersToday.length">'+
'No logins recorded in this org today.</p>'+
'<table class="ss-users-table" ng-show="activeUsersToday.length">'+
/*
 * Clicking a person filters the trail to them, by putting their name in
 * Quick Find - the same box, so it is visible what the list is filtered by
 * and obvious how to undo it.
 *
 * Only when the name is known: without it there is nothing Quick Find could
 * match, and a row that responds to a click by appearing to find nothing is
 * worse than one that does not respond.
 */
'<tr ng-repeat="person in activeUsersToday track by person.userId" class="ss-user-row" '+
'ng-class="{\'is-filtering\': auditFilters.search && auditFilters.search === person.name, '+
'\'is-inert\': !canFindAuditUser(person)}" '+
'ng-click="findAuditUser(person)" '+
'title="{{canFindAuditUser(person) ? '+
'(auditFilters.search === person.name ? \'Clear this filter\' : \'Filter the audit trail to \' + person.name) '+
': (person.username || person.userId)}}'+
'{{person.failures ? \' - \' + person.failures + \' failed sign-in(s)\' : \'\'}}">'+
'<td class="username-trim">{{person.label}}'+
'<span class="ss-active-users-fail" ng-show="person.failures"> {{person.failures}} failed</span></td>'+
'<td class="td2"><span class="ss-freq-badge">{{person.logins}}</span></td>'+
'</tr></table>'+
// Counted, so the number is not mistaken for the whole org.
'<p class="ss-active-users-note" ng-show="activeUsersToday.length">'+
'{{activeUsersToday.length}} signed in today, by login count. Setup changes are listed on the left.</p>'+
'</div>';

/*
 * What this org advertises over REST.
 *
 * Read from the version root rather than listed here: an org with half of
 * these switched off should not be shown the other half, and a list written
 * into this file drifts a little further from every org with each release.
 *
 * The rail beside the REST Explorer, in the shape the other cards use - a
 * heading with a count, rows that do one thing when clicked.
 */
this.restresources = '<div class="userlist ss-right-card" ng-show="isRestExplorerPage()">'+
'<div class="ss-right-card-header"><b>This org&rsquo;s REST'+
'<span ng-show="restResources.list.length"> ({{restResources.list.length}})</span>'+
'</b></div>'+

'<div ng-if="restResources.loading" class="ss-active-users-note">Asking the org\u2026</div>'+
/* A note, not a replacement. The list below it is the baseline, so the card
 * still has something to click - the message says why it is the shorter one. */
'<p class="ss-active-users-note ss-active-users-warn" ng-show="restResources.error">'+
'{{restResources.error}}</p>'+

'<table class="ss-users-table" ng-show="restResources.list.length">'+
/*
 * The path is the row's title rather than a second line: they share a long
 * prefix, so shown in full they are a column of /services/data/v67.0/ with
 * the useful word cut off the right-hand edge.
 */
'<tr ng-repeat="resource in restResources.list track by resource.name" class="ss-user-row" '+
'ng-class="{\'is-filtering\': rest.path === resource.path}" '+
'ng-click="useRestResource(resource)" '+
'title="{{resource.path}}">'+
'<td class="username-trim">{{resource.name}}</td>'+
'</tr></table>'+

'<p class="ss-active-users-note" ng-show="restResources.list.length">'+
'Click one to put it in the path box.'+
'<span ng-show="restResources.fromOrg"> Read from this org, so it includes '+
'whatever this org has switched on.</span>'+
'<span ng-show="!restResources.fromOrg"> These are the endpoints every org '+
'has; this org&rsquo;s own list could not be read.</span></p>'+

'<p class="ss-active-users-note" '+
'ng-show="!restResources.loading && !restResources.list.length">'+
'Nothing listed yet.</p>'+
'</div>';

this.searchdata = '<div class="theme-lightning-search-group" style="margin: 14px 0 20px 0; display: flex; align-items: stretch; width: 100%; clear: both;">'+
'<select Class="limit tooltip-me" data-title="Select record limit to query" ng-model="selectedlength" ng-change="detailsPopupOpenByOption(selectedMenu, selectedlength)" ng-options="len for len in lengthList">'+
'<option value="" selected>200</option> </select>'+
'<input type="text" ng-change="searchMetadataIfNothingTyped()" class="SearchData ss_input_searchaddData" placeholder="{{selectedMetadata.placeholderText}}" ng-model="searchAllMetaData"/>'+
'<button Class="SearchAll" title="Query and fetch all matching records from org" ng-click="searchMetadataRecordsOnChange()">Fetch All</button>'+
'</div>';

this.userdetails = '<div class="userdetails ss-right-card" ng-show="hasRightSidebar(selectedMetadata)">'+
'<div class="ss-right-card-header"><b>Viewing as</b></div>'+
'<div class="ss-right-user-info"><div id="userfullname" class="ss-user-fullname"></div><div id="username" class="ss-user-name trim-info"></div></div>'+
'<button class="viewasdifferentuser" ng-click="detailsPopupOpen(getChangeUserObj())">View as different user</button>'+
'</div>';

/*
 * Query problems, in their own card.
 *
 * This used to sit inside "Viewing as", between the user's name and the
 * button for changing it - so "Cannot access ForecastingObjectListSettings in
 * this organization" read as a statement about that user's permissions, or
 * about the identity being wrong, when it is neither: it is the object the
 * user happens to be looking at not being available in the org. Its own card
 * says what it is about, and can be dismissed once read.
 */
this.querynotice = '<div class="ss-right-card ss-notice-card" ng-show="ErrorMsg">'+
'<div class="ss-right-card-header"><b>{{selectedMetadata.label || \'This object\'}}</b>'+
'<button class="ss-notice-close" ng-click="dismissQueryNotice()" title="Dismiss" aria-label="Dismiss">&times;</button>'+
'</div>'+
'<p class="ss-user-error">{{ErrorMsg}}</p>'+
// The refusal may be stale - it is remembered across sessions, and
// permissions change - so there is a way to ask again.
'<button class="ss-pkg-btn" ng-show="showErrorMessage" ng-click="retryUnsupported()">Try again</button>'+
'</div>';

this.technologylist = '<div class="showhidemydata ss-right-card" ng-show="hasRightSidebar(selectedMetadata)">'+
'<div class="ss-right-card-header"><b>Features</b></div>'+
'<div class="ss-features-group">'+
'<label class="ss-checkbox-label"><input type="checkbox" ng-true-value="true" ng-false-value="false" ng-model="Developer" name="Developer" value="Developer" ng-click="extendMenu()"><span>Metadata</span></label>'+
'<label class="ss-checkbox-label"><input ng-true-value="true" ng-false-value="false" ng-model="Admin" type="checkbox" ng-click="extendMenu()" name="Admin" value="Admin"><span>Data</span></label>'+
'<label class="ss-checkbox-label" ng-show="isVlocityAvailable"><input type="checkbox" ng-true-value="true" ng-false-value="false" ng-model="Vlocity" ng-click="extendMenu()" name="Vlocity" value="Vlocity"><span>Vlocity</span></label>'+
'</div>'+
// Only alongside Data. System objects are data objects, so with Data
// unticked this offered to reveal more of a list that is not being shown -
// a control whose effect is invisible reads as one that does not work.
'<div class="ss-sys-objects-row" ng-show="Admin">'+
'<label class="ss-checkbox-label"><input type="checkbox" ng-model="showAllSystemObjects" ng-click="extendMenu()" name="showAllSystemObjects" value="showAllSystemObjects"><span>Show All System Objects</span></label>'+
'</div>'+
'<div class="ss-mydata-toggle-box">'+
'<span class="ss-mydata-label">Show/Hide My Data</span>'+
'<label class="switchMyRecord"><input ng-model="showmyview" type="checkbox" name="showmyview" value="showmyview" checked><span class="sliderMyRecord round"></span></label>'+
'</div>'+

/*
 * Its own section, because it is the only setting here that is not about
 * this panel.
 *
 * Everything above changes what the panel shows. This one changes
 * Salesforce's own record pages - it is drawn by record-fields.js, in their
 * markup, whether or not the panel is open. Sitting it in the same list as
 * "Metadata" and "Data" made it read as one more filter for the lists here,
 * which is the one thing it is not.
 */
/*
 * "Salesforce pages", not "record pages".
 *
 * The heading named one surface while the section is about two: All Fields is
 * on a record, Export is on a list view. Each row says which, since that is
 * the thing somebody needs to know to find what they have just switched on.
 */
'<div class="ss-settings-section">'+
'<div class="ss-settings-section-head">On Salesforce pages</div>'+

'<label class="ss-checkbox-label">'+
'<input type="checkbox" ng-model="showAllFieldsTab" ng-change="toggleAllFieldsTab()" name="showAllFieldsTab"/>'+
'<span>All Fields button <em class="ss-settings-where">record pages</em></span></label>'+
'<p class="ss-settings-hint">Adds a button beside the record actions listing every '+
'field on the record with its value, editable where your access allows.</p>'+

'<label class="ss-checkbox-label ss-settings-next">'+
'<input type="checkbox" ng-model="showListExport" ng-change="toggleListExport()" name="showListExport"/>'+
'<span>Export button <em class="ss-settings-where">list views</em></span></label>'+
'<p class="ss-settings-hint">Adds an Export button beside New and Import, with an '+
'editable query and JSON, CSV or Excel output.</p>'+
'</div>'+
'</div>'+
'<div class="showhidemydata ss-right-card" ng-show="hasRightSidebar(selectedMetadata) && availableNamespaces && availableNamespaces.length > 0">'+
'<div class="ss-right-card-header"><b>Namespaces</b></div>'+
'<div class="ss-namespaces-list"><div ng-repeat="ns in availableNamespaces" class="ss-ns-item">'+
'<label class="ss-checkbox-label"><input type="checkbox" ng-model="selectedNamespaces[ns.key]"/><span>{{ns.label}}</span><span class="ss-ns-count">({{ns.count}})</span></label>'+
'</div></div>'+
'</div>';

/*
 * The Data JSON export card is gone.
 *
 * Everything it did now lives where the selection is visible from every
 * page: the count and the download are the footer chip, clearing is the
 * cross beside it, what the file contains is the chip's tooltip, and a
 * failure is a toast rather than a line on a card that only appears where
 * downloading happens to be possible.
 */

/*
 * package.xml, and the package itself.
 *
 * The manifest names what you want; the Retrieve button goes and gets it.
 * The zip is built by the org, so the folder structure and the -meta.xml
 * files are Salesforce's own and the download deploys as it stands.
 *
 * The editor stays editable and is what gets retrieved, so trimming a member
 * out of the textarea leaves it out of the package too.
 */
this.packagexmleditor = '<div Class="searchCodeFieldset" ng-show="selectedMetadata.value == packagexml">'+

'<div class="ss-pkg-bar">'+
'<div class="ss-pkg-summary">'+
'<b ng-show="packageIsReady()">{{selectedMetaForPackageXml.size}} component<span ng-show="selectedMetaForPackageXml.size !== 1">s</span> across {{packageMetaDataFrequency.length}} type<span ng-show="packageMetaDataFrequency.length !== 1">s</span></b>'+
'<b ng-hide="packageIsReady()">Nothing selected yet</b>'+
'<div class="ss-pkg-hint" ng-hide="packageIsReady()">Tick components in any metadata list to build a package.</div>'+
'<div class="ss-pkg-hint" ng-show="packageIsReady()">Retrieved as a zip the org builds - ready to deploy or commit as it is.</div>'+
/*
 * Start again.
 *
 * This lived on the sidebar card, and the card is gone - so without it here
 * the only way out of a wrong selection is one click per component, including
 * the dependencies the scan added that were never ticked by hand.
 */
'<a href="#" class="ss-pkg-clear-all" ng-show="packageIsReady()" '+
'ng-click="clearAllFromPackage(); $event.preventDefault()">\u2715 Remove all</a>'+
/*
 * Actions, not standing preferences.
 *
 * These were tick-boxes, which said "always do this" - and a tick-box that
 * silently re-runs a scan every time the selection changes is a promise the
 * user did not ask for. As buttons they do the thing once, when asked, and
 * say what they added. Pressed again they scan again, which is what someone
 * who has just ticked more components wants.
 *
 * They stay separate because they answer different questions at different
 * cost: one is a handful of indexed lookups, the other a Beta dependency
 * graph that cannot see dynamic references.
 */
/*
 * Managed package components, flagged before the retrieve rather than after.
 * The Metadata API does not refuse them - it returns a zip with the component
 * missing - so this is the last honest moment to say so.
 */
'<div class="ss-pkg-managed" ng-show="managedSummary.count">'+
'<b>{{managedSummary.count}} component<span ng-show="managedSummary.count !== 1">s</span> '+
'from managed package<span ng-show="managedSummary.namespaces.length !== 1">s</span> '+
'({{managedNamespaceList()}})</b>'+
'<em>Components installed from a managed package usually cannot be retrieved. '+
'The retrieve will still run, but the zip may come back without them.</em>'+
'<button class="ss-pkg-btn ss-pkg-btn-sm" ng-click="removeManagedComponents()">'+
'Remove them from the package</button>'+
'</div>'+
/*
 * Shown once they are out, because an exclusion that is silently in force is
 * its own kind of surprise - a later scan finding nothing new needs to be
 * explainable.
 */
'<div class="ss-pkg-excluded" ng-show="packageExcludeManaged && !managedSummary.count">'+
'<span>Managed package components are being left out of this package.</span>'+
'<button class="ss-pkg-linkbtn" ng-click="includeManagedComponents()">Include them again</button>'+
'</div>'+

'<div class="ss-pkg-adders" ng-show="packageIsReady()">'+

'<button class="ss-pkg-btn" ng-click="addRelatedComponents()" ng-disabled="packageDepsState.running">'+
'<span ng-hide="packageDepsState.running && packageDepsState.kind === \'related\'">Add related components</span>'+
'<span ng-show="packageDepsState.running && packageDepsState.kind === \'related\'">Checking...</span>'+
'</button>'+
'<span class="ss-pkg-adder-hint">An object brings its fields, layouts, record types, validation rules and list views. '+
'A permission set, group or profile brings everything it grants.</span>'+

'<button class="ss-pkg-btn" ng-click="addReferencedComponents()" ng-disabled="packageDepsState.running">'+
'<span ng-hide="packageDepsState.running && packageDepsState.kind === \'referenced\'">Add what these reference</span>'+
'<span ng-show="packageDepsState.running && packageDepsState.kind === \'referenced\'">Checking...</span>'+
'</button>'+
'<span class="ss-pkg-adder-hint">The fields, objects and classes an Apex class, Lightning bundle or Flow uses. '+
'Salesforce answers this from a Beta API that cannot see dynamic references, so it makes a package more '+
'complete, not provably complete.</span>'+

// Only offered once something has been added, because that is the only time
// there is anything to take away.
'<button class="ss-pkg-btn" ng-show="packageDepsState.added" ng-click="removeAddedComponents()" '+
'ng-disabled="packageDepsState.running">Remove what was added</button>'+

'</div>'+
'<div class="ss-pkg-deps-state" ng-show="packageIncludeDependencies || packageIncludeReferences">'+
'<span ng-show="packageDepsState.running">Checking the org for related components... {{packageDepsState.done}} of {{packageDepsState.total}}</span>'+
'<span ng-show="!packageDepsState.running && packageDepsState.added">Added {{packageDepsState.added}} related component<span ng-show="packageDepsState.added !== 1">s</span>.</span>'+
'<span ng-show="!packageDepsState.running && packageDepsState.scanned && !packageDepsState.added">Nothing further needed.</span>'+
'</div>'+
'</div>'+
'<div class="ss-pkg-actions">'+
'<button class="ss-pkg-btn ss-pkg-btn-primary" ng-click="retrievePackage()" ng-disabled="!packageIsReady() || retrieveState.running">'+
'<span ng-hide="retrieveState.running">Retrieve package (.zip)</span>'+
'<span ng-show="retrieveState.running">{{retrieveState.stage || \'Working\'}}...</span>'+
'</button>'+
'<button class="ss-pkg-btn" ng-click="downloadPackageXml()" ng-disabled="!packageIsReady()">package.xml only</button>'+
/*
 * The third thing that can be done with a selection: send it to another org
 * rather than to the downloads folder.
 *
 * ng-show rather than ng-disabled, unlike the two beside it. Those are
 * always the point of this page and read as unavailable when nothing is
 * ticked; this one is a route to a different screen, and a permanently
 * greyed button to somewhere else is just a question the page keeps asking.
 */
'<button class="ss-pkg-btn" ng-show="packageIsReady()" ng-click="openSyncJobs()">'+
'Send to another org…</button>'+
/*
 * Rebuild from the ticks.
 *
 * Every change to the selection rebuilds already; this is for when the two
 * have gone out of step anyway. Always available, because the moment it is
 * wanted is the moment nobody can tell whether it is needed.
 */
'<button class="ss-pkg-btn" ng-if="!packageRefreshAsking" ng-click="refreshPackageXml()">'+
'Refresh package.xml</button>'+
'<span class="ss-pkg-refresh-ask" ng-if="packageRefreshAsking">'+
'Rebuild from what is ticked? Your edits to the manifest are replaced. '+
'<button class="ss-pkg-linkbtn" ng-click="refreshPackageXml()">Rebuild</button>'+
'<button class="ss-pkg-linkbtn" ng-click="cancelPackageRefresh()">Cancel</button></span>'+
'</div>'+
'</div>'+

'<p class="ss-pkg-error" ng-show="retrieveState.error">{{retrieveState.error}}</p>'+

// Said plainly rather than left to be discovered. The manifest is assembled
// from what was ticked, and the platform has more naming rules than any
// generator gets right first time - so the honest instruction is to read it.
/*
 * The ticks the manifest cannot name.
 *
 * Said where the manifest is, because that is where the disagreement shows:
 * a sidebar counting two types over a package holding one member, with
 * nothing on screen admitting the difference.
 */
'<div class="ss-pkg-warn" ng-if="packageOrphans">'+
'<b>{{packageOrphans}} ticked component<span ng-if="packageOrphans !== 1">s</span> '+
'<span ng-if="packageOrphans === 1">is</span>'+
'<span ng-if="packageOrphans !== 1">are</span> not in this manifest.</b>'+
'The package is what the org is asked for, so '+
'<span ng-if="packageOrphans === 1">it</span>'+
'<span ng-if="packageOrphans !== 1">they</span> will not be retrieved. '+
'<button class="ss-pkg-linkbtn" ng-click="refreshPackageXml()">Refresh package.xml</button>'+
'<button class="ss-pkg-linkbtn" ng-click="dropUnplacedComponents()">'+
'Untick <span ng-if="packageOrphans === 1">it</span>'+
'<span ng-if="packageOrphans !== 1">them</span></button>'+
'</div>'+

'<div class="ss-pkg-note" ng-show="packageIsReady()">'+
'<b>Check this before you retrieve.</b> It is generated from what you selected, and it can be wrong - '+
'some component types name their members differently, and others need a companion component to deploy. '+
'Edit it below and your version is what gets retrieved and downloaded.'+
'</div>'+

'<div class="ss-pkg-edited" ng-show="packageXmlEdited">'+
'<span><b>Edited.</b> Your version is in use - selecting more metadata will not overwrite it.</span>'+
'<button class="ss-pkg-btn" ng-click="regeneratePackageXml()">Regenerate from selection</button>'+
'</div>'+

'<div class="ss-pkg-done" ng-show="retrieveState.result">'+
'<b>Downloaded {{retrieveState.result.filename}}</b> - {{retrieveState.result.members}} member<span ng-show="retrieveState.result.members !== 1">s</span> at API v{{retrieveState.result.version}}.'+
// Salesforce reports per-component problems while still returning a zip, so
// a package can arrive complete-looking with pieces quietly missing.
'<div class="ss-pkg-problems" ng-show="retrieveState.result.problems.length">'+
'<div>The org could not include these:</div>'+
'<div ng-repeat="problem in retrieveState.result.problems">{{problem}}</div>'+
'</div>'+
'</div>'+

/*
 * What is in the package, before you read the XML for it.
 *
 * The bar above says "42 components across 7 types", which is the headline and
 * not the answer to the question people actually have at this point: which
 * seven, and how many of each. That breakdown existed only as a narrow table
 * in the right sidebar, where it competes with everything else and is cut off
 * whenever the sidebar is dragged narrow. Here it sits with the manifest it
 * describes.
 */
'<div class="ss-pkg-stats" ng-show="packageIsReady()">'+

'<div class="ss-pkg-tiles">'+
'<div class="ss-pkg-tile">'+
'<span class="ss-pkg-tile-n">{{selectedMetaForPackageXml.size}}</span>'+
'<span class="ss-pkg-tile-l">component<span ng-show="selectedMetaForPackageXml.size !== 1">s</span></span>'+
'</div>'+
'<div class="ss-pkg-tile">'+
'<span class="ss-pkg-tile-n">{{packageMetaDataFrequency.length}}</span>'+
'<span class="ss-pkg-tile-l">type<span ng-show="packageMetaDataFrequency.length !== 1">s</span></span>'+
'</div>'+
// Only when the scan has run - a zero here otherwise would read as "nothing
// was needed" rather than "nothing was asked".
'<div class="ss-pkg-tile" ng-show="packageDepsState.scanned">'+
'<span class="ss-pkg-tile-n">{{packageDepsState.added}}</span>'+
'<span class="ss-pkg-tile-l">related</span>'+
'</div>'+
// Only when there are any, since this one is a warning rather than a fact.
'<div class="ss-pkg-tile ss-pkg-tile-warn" ng-show="managedSummary.count">'+
'<span class="ss-pkg-tile-n">{{managedSummary.count}}</span>'+
'<span class="ss-pkg-tile-l">managed</span>'+
'</div>'+
'</div>'+

'<div class="ss-pkg-breakdown">'+
'<div class="ss-pkg-breakdown-head">By type</div>'+
'<table class="ss-pkg-breakdown-table">'+
'<tr ng-repeat="metaFrequency in packageMetaDataFrequency | orderBy:\'-Frequency\' track by $index">'+
'<td class="ss-pkg-type">{{metaFrequency.Type}}</td>'+
// A bar as well as a number: seven types with counts of 41, 1, 1, 1 is a very
// different package from four of 11 each, and the numbers alone do not say so
// at a glance.
'<td class="ss-pkg-bar-cell">'+
'<span class="ss-pkg-bar-fill" ng-style="{width: packageTypeShare(metaFrequency) + \'%\'}"></span>'+
'</td>'+
'<td class="ss-pkg-count">{{metaFrequency.Frequency}}</td>'+
// Regretting is usually per type rather than per component - most often
// after a scan has brought in eighty of something nobody asked for.
'<td class="ss-pkg-type-remove">'+
'<button class="ss-notice-close" ng-click="removeTypeFromPackage(metaFrequency.Type)" '+
'title="Remove all {{metaFrequency.Frequency}} {{metaFrequency.Type}} from the package" '+
'aria-label="Remove all {{metaFrequency.Type}}">&times;</button>'+
'</td>'+
'</tr>'+
'</table>'+
'</div>'+

'</div>'+

'<textarea class="ss-xml-editor" ng-model="str" ng-change="onPackageXmlEdited()" rows="22" spellcheck="false"></textarea>'+
'</div>';


/*
 * Launcher settings: one panel, one order.
 *
 * These arrived one at a time and ended up as a colour table with opacity,
 * shape and finish bolted on beneath it under a legend that only mentioned
 * colour, each divided from the last by its own hand-written border. Grouped
 * here as four sections of the same shape - appearance first (colour, shape,
 * finish), then behaviour (opacity and the weekly review that moves it).
 *
 * The preview at the top is the point of putting them together: the four
 * settings compose, and none of the individual swatches shows the result.
 *
 * The colour list is the same LAUNCHER_COLORS map index.js picks the live
 * icon from, rather than eight hand-written cells - which is why the radios
 * never used to show which colour was actually in use, there being nothing
 * bound to say so.
 *
 * The Rate/Report links that used to sit under this in their own fieldset
 * are gone - they are on the About page with the rest of the help links,
 * and they were never launcher settings.
 */
this.launchercolor = '<div class="launcherColor" ng-show="selectedMetadata.value==launchercolor">'+
'<fieldset style="width:100%; box-sizing:border-box;"><legend>Launcher</legend>'+

'<div class="ss-launcher-preview">'+
'<img class="ss-launcher-preview-icon {{launcherPreviewClass(launcherShape, launcherFinish)}}" ng-src="{{launcherIconSrc}}" ng-style="{\'opacity\': launcherOpacity / 100}"/ alt=""/>'+
'<div class="ss-launcher-preview-text">'+
'<b>{{launcherColorName}} &middot; {{launcherShape}} &middot; {{launcherFinish}} &middot; {{launcherOpacity}}%</b><br/>'+
'This is your launcher as it appears on the page. Everything below changes it straight away.'+
'</div>'+
'</div>'+

'<div class="ss-set">'+
'<div class="ss-launcher-heading">Colour</div>'+
'<div class="ss-color-grid">'+
'<label class="ss-color-cell" ng-repeat="swatch in launcherColorSwatches" ng-class="{ssSelected: launcherColorName === swatch.name}" ng-click="setColorInCookie(swatch.name)">'+
'<img ng-src="{{swatch.src}}" class="ss-color-preview {{launcherPreviewClass(launcherShape, launcherFinish)}}"/ alt=""/>'+
'<span><input type="radio" name="color" ng-checked="launcherColorName === swatch.name"/> {{swatch.name}}</span>'+
'</label>'+
'</div>'+
'</div>'+

'<div class="ss-set">'+
'<div class="ss-launcher-heading">Shape</div>'+
'<div class="ss-launcher-options">'+
'<label class="ss-launcher-option" ng-repeat="shape in launcherShapes" ng-class="{ssSelected: launcherShape === shape}" ng-click="setLauncherShape(shape)">'+
'<img ng-src="{{launcherIconSrc}}" class="ss-launcher-swatch {{launcherPreviewClass(shape, launcherFinish)}}"/ alt=""/>'+
'<span>{{shape}}</span></label>'+
'</div>'+
'</div>'+

'<div class="ss-set">'+
'<div class="ss-launcher-heading">Finish</div>'+
// Shown across every colour: a finish is a filter, so what it does to
// yellow is not what it does to dark blue, and one swatch would only
// answer for one colour.
'<div class="ss-finish-rows">'+
'<div class="ss-finish-row" ng-repeat="finish in launcherFinishes" ng-class="{ssSelected: launcherFinish === finish}" ng-click="setLauncherFinish(finish)">'+
'<span class="ss-finish-name">{{finish}}</span>'+
'<span class="ss-finish-strip">'+
'<img ng-repeat="swatch in launcherColorSwatches" ng-src="{{swatch.src}}" title="{{swatch.name}}" '+
'class="ss-finish-chip {{launcherPreviewClass(launcherShape, finish)}}"/ alt="{{swatch.name}}"/>'+
'</span>'+
'</div>'+
'</div>'+
'<p class="ss-usage-note">Subtle drains the colour so the launcher reads as furniture. Shiny saturates it and adds a halo. Both stack with the opacity below, and apply to whichever colour you pick.</p>'+
'</div>'+

'<div class="ss-set">'+
'<div class="ss-launcher-heading">Keyboard shortcut</div>'+
'<p class="ss-usage-note" style="margin-top:0;">'+
'<b>Alt + Shift + S</b> opens this panel on Apex Classes, showing yours and the whole org\'s. '+
'To change it or turn it off, open <span class="ssRedirect" style="display:inline-block; margin:0 0 0 2px; padding:2px 6px;">chrome://extensions/shortcuts</span> '+
'in a new tab - Chrome owns the binding, so it cannot be set from here. '+
'Chrome will not accept Ctrl+Alt for any shortcut: on Windows that combination is how AltGr is typed.'+
'</p>'+
'</div>'+

'<div class="ss-set">'+
'<div class="ss-launcher-heading">Opacity</div>'+
'<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">'+
'<div style="width:44px; height:44px; border-radius:8px; background-image:linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size:10px 10px; background-position:0 0, 0 5px, 5px -5px, -5px 0px; display:flex; align-items:center; justify-content:center; border:1px solid #e2e8f0; flex-shrink:0;">'+
'<img id="ss_opacity_preview" ng-src="{{launcherIconSrc}}" class="{{launcherPreviewClass(launcherShape, launcherFinish)}}" style="width:32px; height:32px; transition:opacity 0.15s ease;" ng-style="{\'opacity\': launcherOpacity / 100}"/ alt=""/>'+
'</div>'+
'<div style="flex:1; min-width:120px;">'+
'<input type="range" min="10" max="100" step="5" ng-model="launcherOpacity" ng-change="setLauncherOpacity()" style="width:100%; accent-color:var(--ss-blue); cursor:pointer;"/>'+
'</div>'+
'<span style="background:#f1f5f9; border:1px solid #e2e8f0; border-radius:6px; padding:3px 8px; font-size:12px; font-weight:700; color:#0f172a; font-family:monospace; min-width:40px; text-align:center;">{{launcherOpacity}}%</span>'+
'</div>'+
'<div style="display:flex; gap:4px; margin-top:6px;">'+
'<button class="w3-button w3-tiny w3-round" style="font-size:9px; padding:1px 8px; background:#f1f5f9; border:1px solid #e2e8f0; color:#334155;" ng-click="setLauncherOpacityPreset(10)">10%</button>'+
'<button class="w3-button w3-tiny w3-round" style="font-size:9px; padding:1px 8px; background:#f1f5f9; border:1px solid #e2e8f0; color:#334155;" ng-click="setLauncherOpacityPreset(25)">25%</button>'+
'<button class="w3-button w3-tiny w3-round" style="font-size:9px; padding:1px 8px; background:#f1f5f9; border:1px solid #e2e8f0; color:#334155;" ng-click="setLauncherOpacityPreset(50)">50%</button>'+
'<button class="w3-button w3-tiny w3-round" style="font-size:9px; padding:1px 8px; background:#f1f5f9; border:1px solid #e2e8f0; color:#334155;" ng-click="setLauncherOpacityPreset(75)">75%</button>'+
'<button class="w3-button w3-tiny w3-round" style="font-size:9px; padding:1px 8px; background:var(--ss-blue); color:#fff;" ng-click="setLauncherOpacityPreset(100)">100%</button>'+
'</div>'+

// Why the number moves on its own. Everything here comes from the same
// review that actually changed it, so the page cannot describe one rule
// while the launcher follows another.
'<div class="ss-adapt">'+
'<div class="ss-adapt-head">This adjusts itself weekly'+
'<span class="ss-adapt-tag" ng-class="{ssDown: opacityReview.direction===\'down\', ssUp: opacityReview.direction===\'up\'}">'+
'{{opacityReview.direction===\'down\' ? \'fading\' : (opacityReview.direction===\'up\' ? \'brightening\' : \'steady\')}}</span>'+
'</div>'+
'<p class="ss-adapt-why">Once a week the launcher fades by {{opacityReview.step}}% if you have been using it, and brightens by {{opacityReview.step}}% for each week you have not. '+
'Someone who opens it every day knows where it is and does not need it competing with the org\'s own screen; someone who has forgotten it is installed does. '+
'It stays between {{opacityReview.min}}% and {{opacityReview.max}}%, so it never disappears and never takes over.</p>'+
'<table class="ss-usage-table ss-about-facts">'+
'<tr><td>Right now</td><td class="ss-about-value">{{launcherOpacity}}%</td></tr>'+
'<tr><td>Actions this week</td><td class="ss-about-value">{{opacityReview.actions}} of {{opacityReview.threshold}} needed to count as in use</td></tr>'+
'<tr><td>Last review</td><td class="ss-about-value">{{opacityReview.reviewedAt | date:\'d MMM yyyy\'}}</td></tr>'+
'<tr><td>Next review</td><td class="ss-about-value">{{opacityReview.nextReviewAt | date:\'d MMM yyyy\'}}</td></tr>'+
'<tr><td>Next change</td><td class="ss-about-value">{{opacityReview.actions >= opacityReview.threshold ? \'down to \' + (launcherOpacity - opacityReview.step < opacityReview.min ? opacityReview.min : launcherOpacity - opacityReview.step) + \'%\' : \'up to \' + (launcherOpacity + opacityReview.step > opacityReview.max ? opacityReview.max : launcherOpacity + opacityReview.step) + \'%\'}}</td></tr>'+
'</table>'+
'<p class="ss-usage-note">Moving the slider yourself overrides the current value and starts the week again from it.</p>'+
'</div>'+
'</div>'+

'</fieldset></div>';

/*
 * Usage analytics. Counted locally and never transmitted, which the view says
 * outright - a panel that reports on the user should be candid about where the
 * numbers live. The feature table is ordered most-used first, so the answer to
 * "what is this actually used for" is the first row.
 */
this.usageanalytics = '<div class="ss-usage" ng-show="selectedMetadata.value == usageanalytics">'+

/*
 * What this extension has been used for.
 *
 * First, because it is the only section on this page that is about the user
 * rather than about the org - and because it is the answer to "is this thing
 * earning its place", which is why anyone opens a usage page at all.
 *
 * Counted locally and kept locally. Nothing here is sent anywhere.
 */
'<div class="ss-feature-use">'+
'<h4>Salesforce Simplified</h4>'+
'<p class="ss-usage-lead">What you have done with the extension. Counted on this '+
'browser and kept here - none of it is sent anywhere.</p>'+

'<p class="ss-usage-lead" ng-show="!featureUseAny">Nothing counted yet. '+
'Open a record\'s All Fields, export a list, or build a package.xml and this '+
'fills in.</p>'+

/*
 * Bound to an array, not to a function.
 *
 * A function here returns a new array of new objects on every digest, and
 * ngRepeat's collection watcher compares elements by identity - so the digest
 * never settles and Angular stops with $rootScope:infdig after ten passes.
 * The list is built once, when the counts arrive.
 */
'<div class="ss-feature-tiles" ng-show="featureUseAny">'+
'<div class="ss-feature-tile" ng-repeat="tile in featureUseList track by tile.key">'+
'<span class="ss-feature-n">{{tile.value}}</span>'+
'<span class="ss-feature-l">{{tile.label}}</span>'+
'</div>'+
'</div>'+
'</div>'+

'<div class="ss-usage-cards">'+
'<div class="ss-usage-card"><div class="ss-usage-figure">{{usage.timeSaved}}</div><div class="ss-usage-caption">Estimated time saved</div></div>'+
'<div class="ss-usage-card"><div class="ss-usage-figure">{{usage.totalActions}}</div><div class="ss-usage-caption">Actions in this org</div></div>'+
'<div class="ss-usage-card"><div class="ss-usage-figure">{{usage.activeDays}}</div><div class="ss-usage-caption">Days used</div></div>'+
'<div class="ss-usage-card"><div class="ss-usage-figure">{{usage.dailyAverage}}</div><div class="ss-usage-caption">Actions per active day</div></div>'+
'</div>'+

'<p class="ss-usage-lead" ng-show="usage.mostUsed">Most used feature: <b>{{usage.mostUsed.label}}</b> '+
'({{usage.mostUsed.count}} times, {{usage.mostUsed.share}}% of everything you do here).</p>'+
'<p class="ss-usage-lead" ng-hide="usage.mostUsed">No usage recorded in this org yet.</p>'+

'<div class="ss-usage-table-card" ng-show="usage.features.length">'+
'<table class="ss-usage-table">'+
'<thead><tr><th style="width: 45%;">FEATURE</th><th class="ss-usage-col-center" style="width: 25%;">TIMES USED</th><th class="ss-usage-col-right" style="width: 30%;">SHARE</th></tr></thead>'+
'<tbody><tr ng-repeat="f in usage.features track by f.key">'+
'<td class="ss-usage-feature-name">{{f.label}}</td>'+
'<td class="ss-usage-col-center"><strong>{{f.count}}</strong></td>'+
'<td class="ss-usage-col-right"><span class="ss-usage-track"><span class="ss-usage-bar" style="width: {{f.share}}%"></span></span><span class="ss-usage-pct">{{f.share}}%</span></td>'+
'</tr></tbody></table></div>'+

// Org-side usage. Each figure appears only when it has a value: LoginHistory
// needs setup access, and rendering "0 users signed in" to someone who simply
// cannot read the object would be a lie rather than a measurement.
'<div class="ss-usage-api" ng-show="orgUsage.logins || orgUsage.activeUsers || orgUsage.totalUsers || orgUsage.failedLogins || orgUsage.debugLogs">'+
'<h4>Salesforce usage today</h4>'+
'<div class="ss-usage-cards">'+
'<div class="ss-usage-card" ng-show="orgUsage.activeUsers"><div class="ss-usage-figure">{{orgUsage.activeUsers}}</div><div class="ss-usage-caption">Users signed in</div></div>'+
'<div class="ss-usage-card" ng-show="orgUsage.logins"><div class="ss-usage-figure">{{orgUsage.logins}}</div><div class="ss-usage-caption">Total logins</div></div>'+
'<div class="ss-usage-card" ng-show="orgUsage.adoption >= 0"><div class="ss-usage-figure">{{orgUsage.adoption}}%</div><div class="ss-usage-caption">Of {{orgUsage.totalUsers}} active users</div></div>'+
'<div class="ss-usage-card" ng-show="orgUsage.failedLogins"><div class="ss-usage-figure">{{orgUsage.failedLogins}}</div><div class="ss-usage-caption">Failed sign-ins</div></div>'+
'<div class="ss-usage-card" ng-show="orgUsage.debugLogs"><div class="ss-usage-figure">{{orgUsage.debugLogs}}</div><div class="ss-usage-caption">Debug logs captured</div></div>'+
'</div>'+
'<p class="ss-usage-note">Login figures need setup-level read access, so they are left out rather than shown as zero when unavailable.</p>'+
'</div>'+

'<div class="ss-usage-api" ng-show="apiUsage">'+
'<h4>Org API consumption today</h4>'+
'<p>{{apiUsage.used}} of {{apiUsage.max}} daily API calls used ({{apiUsage.percent}}%), {{apiUsage.remaining}} remaining.</p>'+
'<p class="ss-usage-note">This is the whole org\'s consumption across every integration - Salesforce does not attribute API calls to individual callers, so it is not a measure of this extension alone.</p>'+
'</div>'+

// Everything else /limits already told us. One request answers all of these;
// only the API row was being read.
'<div class="ss-usage-table-card">'+
'<div class="ss-usage-section-title">Platform limits</div>'+
'<div class="ss-limit-row" ng-repeat="lim in platformLimits track by lim.label">'+
'  <div class="ss-limit-head"><span class="ss-limit-label">{{lim.label}}</span>'+
'  <span class="ss-limit-figure">{{lim.used | number}} / {{lim.max | number}} <b>{{lim.percent}}%</b></span></div>'+
'  <div class="ss-limit-track"><div class="ss-limit-fill" ng-class="usageSeverity(lim.percent)" '+
'ng-style="{width: (lim.percent > 100 ? 100 : lim.percent) + \'%\'}"></div></div>'+
'</div>'+
'<p class="ss-usage-note" ng-show="!platformLimits.length">No platform limits could be read for this org.</p>'+
'<p class="ss-usage-note">Every limit this org reports, the closest to its ceiling first. '+
'These are org-wide and not attributable to any one integration.</p>'+
'</div>'+

'<div class="ss-usage-table-card">'+
'<div class="ss-usage-section-title">Licences</div>'+
'<div class="ss-limit-row" ng-repeat="lim in licenseUsage track by lim.label">'+
'  <div class="ss-limit-head"><span class="ss-limit-label">{{lim.label}}</span>'+
'  <span class="ss-limit-figure">{{lim.used | number}} / {{lim.max | number}} <b>{{lim.percent}}%</b></span></div>'+
'  <div class="ss-limit-track"><div class="ss-limit-fill" ng-class="usageSeverity(lim.percent)" '+
'ng-style="{width: (lim.percent > 100 ? 100 : lim.percent) + \'%\'}"></div></div>'+
'</div>'+
'<p class="ss-usage-note" ng-show="!licenseUsage.length">Licence counts need the &quot;View Setup and Configuration&quot; permission.</p>'+
'<p class="ss-usage-note">An org runs out of these long before it runs out of API calls, '+
'and the symptom is somebody unable to log in.</p>'+
'</div>'+

'<p class="ss-usage-note">Counts are stored only in this browser and are never sent anywhere. Time saved is an estimate: each feature is weighted by roughly how long the same task takes through Setup navigation.</p>'+
'</div>';

/*
 * About Us. A page about the team behind the extension rather than the org,
 * so it sits with the other Settings utilities at the foot of the menu.
 * Every app links out to its Chrome Web Store listing.
 */
/*
 * About. What this is, what it is running against, and where to go next.
 *
 * The build-and-org block is the part that earns its place: it is exactly
 * what a bug report needs and exactly what nobody can find when asked for
 * it, so it is on screen and copyable in one go.
 */
this.aboutus = '<div class="ss-usage" ng-show="selectedMetadata.value == aboutus">'+

'<div class="ss-about-hero">'+
'<div class="ss-about-name">Salesforce Simplified</div>'+
// Reachable again after install, so the introduction is not a one-time thing
// you can only lose.
'<div style="margin-top:6px;"><a href="#" ng-click="openWelcomePage($event)" '+
'style="font-size:12px;">What this extension does &rarr;</a></div>'+
'<div class="ss-about-version" ng-show="about.version">Version {{about.version}} &middot; Classic and Lightning</div>'+
'<p class="ss-about-tagline">Recent metadata, records and org health, without the Setup menu. '+
'Runs in Salesforce Classic, Lightning, Setup and Visualforce pages of your org. '+
'Everything the extension knows it asks your org for directly - there is no server in between.</p>'+
'</div>'+

/*
 * What this tool does that the org's own tooling does not.
 *
 * Every claim here is about Setup, Object Manager, Data Loader or the layout
 * editor - things that can be checked - and not about other extensions, which
 * cannot be checked from in here and change without notice. A row that stops
 * being true is a row that has to go: tests/about_features.test.js holds each
 * one to the feature that backs it.
 */
'<div class="ss-usage-api">'+
'<h4>What you can do here</h4>'+
'<p class="ss-usage-lead">The parts that are not in Setup at all - and the ones '+
'that are, but behind Data Loader, Workbench, or an edit to the page layout.</p>'+
'<table class="ss-usage-table">'+

'<tr><td><span class="ss-usage-feature-name">package.xml, built while you browse</span>'+
'<div class="ss-about-sub">Tick components in any list and the manifest writes itself, '+
'then retrieve the deployment zip in one click. Setup has no manifest builder.</div></td></tr>'+

'<tr><td><span class="ss-usage-feature-name">A watch list for components</span>'+
'<div class="ss-about-sub">Choose the components you care about and be told when one of '+
'them changes, with who changed it and when.</div></td></tr>'+

'<tr><td><span class="ss-usage-feature-name">What you touched, before what exists</span>'+
'<div class="ss-about-sub">Every list opens on your own recent work across all component '+
'types at once, so this morning\'s class is not something you have to search for.</div></td></tr>'+

'<tr><td><span class="ss-usage-feature-name">Every field on a record, editable</span>'+
'<div class="ss-about-sub">Including the fields nobody put on the layout. The alternative '+
'is editing the layout or calling the API by hand.</div></td></tr>'+

'<tr><td><span class="ss-usage-feature-name">A list view out as a file</span>'+
'<div class="ss-about-sub">The list\'s own query, editable before it runs, out as JSON, '+
'CSV or Excel - without Data Loader and without building a report.</div></td></tr>'+

'<tr><td><span class="ss-usage-feature-name">REST and Tooling calls in the same tab</span>'+
'<div class="ss-about-sub">Any endpoint, any method, with a body editor and the response '+
'pretty-printed.</div></td></tr>'+

'<tr><td><span class="ss-usage-feature-name">Bulk API 2.0 job status</span>'+
'<div class="ss-about-sub">The ingest and query jobs that Setup\'s Bulk Data Load Jobs '+
'page does not list, with their processed and failed counts.</div></td></tr>'+

'<tr><td><span class="ss-usage-feature-name">A describe, as a tree</span>'+
'<div class="ss-about-sub">Child relationships, record types and field attributes that '+
'Object Manager does not put on screen.</div></td></tr>'+

'<tr><td><span class="ss-usage-feature-name">Several orgs, one workspace</span>'+
'<div class="ss-about-sub">Move between orgs without signing in to each one again, with '+
'every org\'s session and data kept to itself.</div></td></tr>'+

'</table>'+
'<p class="ss-usage-note">The two that appear on Salesforce\'s own pages - All Fields and '+
'Export - each have a switch under Features, if you would rather the page stayed as '+
'Salesforce ships it.</p>'+
'</div>'+

'<div class="ss-usage-api">'+
'<h4>This build, and this org</h4>'+
'<p class="ss-usage-lead">Include these when reporting a problem - they are the difference between a report someone can act on and one they cannot.</p>'+
'<table class="ss-usage-table ss-about-facts">'+
'<tr><td>Extension version</td><td class="ss-about-value">{{about.version || \'-\'}}</td></tr>'+
'<tr><td>Salesforce API</td><td class="ss-about-value">{{about.apiVersion ? \'v\' + about.apiVersion : \'resolving...\'}}</td></tr>'+
'<tr><td>Org host</td><td class="ss-about-value">{{about.orgHost}}</td></tr>'+
'<tr><td>Instance</td><td class="ss-about-value">{{about.instance || \'resolving...\'}}</td></tr>'+
'<tr><td>Session</td><td class="ss-about-value">{{about.sessionMode}}</td></tr>'+
'</table>'+
'<button class="ss-about-copy" ng-click="copyDiagnostics()">{{about.copied ? \'Copied\' : \'Copy for a bug report\'}}</button>'+
'</div>'+

'<div class="ss-usage-api">'+
'<h4>Help and feedback</h4>'+
'<table class="ss-usage-table">'+
/*
 * The error reference first, and before Report an issue on purpose:
 * most of what gets reported has an entry here with the fix in it, and
 * this is the only place the page can be found when nothing is
 * currently going wrong - the links beside a message exist only while
 * that message is on screen.
 */
'<tr><td><a class="ss-about-link" ng-href="{{errorReferenceUrl()}}" target="_blank" '+
'rel="noopener noreferrer">Error reference</a>'+
'<div class="ss-about-sub">Every error this extension reports, what causes it, '+
'and the steps to resolve it</div></td></tr>'+
'<tr><td><a class="ss-about-link" href="https://github.com/rajnikantroy/SalesforceSimplified/issues/new" target="_blank" rel="noopener noreferrer">Report an issue</a>'+
'<div class="ss-about-sub">Something broken or missing - GitHub issues</div></td></tr>'+
'<tr><td><a class="ss-about-link" href="https://chrome.google.com/webstore/detail/salesforce-simplified/hjeigbpcblpkaienmpihneipkempijob?hl=en" target="_blank" rel="noopener noreferrer">Rate it on the Chrome Web Store</a>'+
'<div class="ss-about-sub">Reviews are how other admins and developers find it</div></td></tr>'+
'<tr><td><a class="ss-about-link" href="https://buymeacoffee.com/rkroy" target="_blank" rel="noopener noreferrer">Buy the team a coffee</a>'+
'<div class="ss-about-sub">Free and MIT licensed - support is optional and appreciated</div></td></tr>'+
'</table>'+
'</div>'+

'<div class="ss-usage-api">'+
'<h4>More from this team</h4>'+
'<table class="ss-usage-table">'+
'<tr><td><a class="ss-about-link" href="https://chromewebstore.google.com/detail/salesforce-prism/aagiojdphcbpafnpcniokdjcpfdphjgk?authuser=0&hl=en" target="_blank" rel="noopener noreferrer">Salesforce Prism</a>'+
'<div class="ss-about-sub">A different lens on your org\'s data and metadata</div></td></tr>'+
'<tr><td><a class="ss-about-link" href="https://chromewebstore.google.com/detail/sentinel-%E2%80%94-traffic-privac/iodoahnciemefkffpmhegnlcdjljaglp?authuser=0&hl=en" target="_blank" rel="noopener noreferrer">Sentinel — Traffic &amp; Privacy Guard</a>'+
'<div class="ss-about-sub">Watches what the pages you visit are sending, and to whom</div></td></tr>'+
'<tr><td><a class="ss-about-link" href="https://chromewebstore.google.com/detail/managers-companion/noielgdhlkohbbgghaolikioghpecfag?authuser=0&hl=en" target="_blank" rel="noopener noreferrer">Manager\'s Companion</a>'+
'<div class="ss-about-sub">For the part of the job that is not code</div></td></tr>'+
'<tr><td><a class="ss-about-link" href="https://chromewebstore.google.com/detail/auto-skip-reels-shorts/jopgdlfocjopfokadekkaiplklamdale?authuser=0&hl=en" target="_blank" rel="noopener noreferrer">Auto Skip Reels &amp; Shorts</a>'+
'<div class="ss-about-sub">Skips short-form video feeds so you do not have to</div></td></tr>'+
'</table>'+
'</div>'+

// Only claims that hold: usage counts are localStorage-only (UsageService),
// queries go to the org, and the one non-org host is Salesforce's own public
// status API used by the Trust Status page.
'<div class="ss-usage-api">'+
'<h4>Your data</h4>'+
'<p class="ss-usage-note">Queries go to your org and nowhere else. The usage counts behind Usage Analytics are kept in this browser, separately per org, and are never transmitted. '+
'The only address outside your org that this extension contacts is Salesforce\'s public status API, for the Trust Status page. '+
'There is no analytics service, no account, and no server belonging to this extension.</p>'+
'</div>'+

'</div>';

/*
 * Trust Status. Live service health for this org's instance, straight from
 * the public Trust API. The three sections each appear only when they have
 * something to show; a healthy instance is a green pill and nothing else.
 */
/*
 * Standard & custom objects - the describe, as a tree.
 *
 * Two levels of folder and then the properties, which is as deep as a describe
 * goes: the object, its lists, and what is in them.
 */
this.objectdescribe = '<div class="ss-usage" ng-show="selectedMetadata.value == \'ObjectDescribe\'">'+
'<div class="ss-usage-api">'+
'<h4>Standard &amp; Custom Objects</h4>'+
'<p class="ss-usage-lead">Choose an object to describe. Everything the API '+
'reports about it, including the parts Object Manager does not show.</p>'+

'<div class="ss-desc-bar">'+
'<select class="ss-desc-picker" ng-model="describeState.chosen" '+
'ng-change="describeChosen()" ng-click="loadDescribeObjects()" '+
'ng-focus="loadDescribeObjects()" '+
'ng-options="o.name as (o.label + \' (\' + o.name + \')\') for o in describeState.objects">'+
'<option value="">Choose an object\u2026</option></select>'+

'<button class="ss-desc-link" ng-click="expandDescribeAll(true)" '+
'ng-show="describeState.groups.length">Expand all</button>'+
'<button class="ss-desc-link" ng-click="expandDescribeAll(false)" '+
'ng-show="describeState.groups.length">Collapse all</button>'+
'</div>'+

'<p class="ss-usage-lead" ng-show="describeState.loading">Reading the describe\u2026</p>'+
'<p class="ss-rest-error" ng-show="describeState.error">{{describeState.error}}</p>'+

'<div class="ss-desc-legend" ng-show="describeState.groups.length">'+
'<b>Legend:</b>'+
'<span class="ss-desc-key is-true">True</span>'+
'<span class="ss-desc-key is-false">False</span>'+
'<span class="ss-desc-key is-custom">Custom field</span>'+
'<span class="ss-desc-key is-system">System field</span>'+
'</div>'+

'<div class="ss-desc-tree">'+
'<div class="ss-desc-group" ng-repeat="group in describeState.groups track by group.key">'+

'<div class="ss-desc-folder" ng-click="toggleDescribeNode(group.key)">'+
'<span class="ss-desc-caret">{{describeState.open[group.key] ? \'\u25be\' : \'\u25b8\'}}</span>'+
'{{group.label}}<em ng-show="group.count">({{group.count}})</em>'+
'</div>'+

'<div class="ss-desc-body" ng-show="describeState.open[group.key]">'+

// The object's own facts: no second level to open, so they are shown outright.
'<div class="ss-desc-row" ng-repeat="entry in group.entries track by entry.key">'+
'<span class="ss-desc-name">{{entry.key}}</span>'+
'<span class="ss-desc-value" ng-class="describeValueClass(entry.value)">{{entry.value}}</span>'+
'</div>'+

// Everything in a list opens on its own - a hundred fields expanded at once
// is the JSON again, which is what this exists to avoid.
'<div class="ss-desc-item" ng-repeat="item in group.items track by $index">'+
'<div class="ss-desc-folder is-item" ng-click="toggleDescribeNode(group.key + \':\' + $index)">'+
'<span class="ss-desc-caret">'+
'{{describeState.open[group.key + \':\' + $index] ? \'\u25be\' : \'\u25b8\'}}</span>'+
'<span ng-class="{\'is-custom\': item.custom, \'is-system\': item.system}">{{item.label}}</span>'+
'</div>'+
'<div class="ss-desc-body" ng-show="describeState.open[group.key + \':\' + $index]">'+
'<div class="ss-desc-row" ng-repeat="entry in item.entries track by entry.key">'+
'<span class="ss-desc-name">{{entry.key}}</span>'+
'<span class="ss-desc-value" ng-class="describeValueClass(entry.value)">{{entry.value}}</span>'+
'</div>'+
'</div>'+
'</div>'+

'</div>'+
'</div>'+
'</div>'+

'</div>'+
'</div>';

/*
 * Bulk API job status.
 *
 * A list on the left and the chosen job on the right. The list is what Setup
 * does not have for v2 jobs; the detail is why anyone opened it.
 */
/*
 * Org sync: pipelines, and the history of every job either of them produced.
 *
 * Three parts, in the order somebody needs them: the pipelines (which two
 * orgs, which way), what is waiting on a decision, and what happened to
 * everything else. Succeeded and failed are separate lists because they are
 * read for different reasons - one to confirm, one to fix.
 *
 * ng-if rather than ng-show on the job lists: an empty list still renders its
 * heading under ng-show, which is the mistake that put "nothing to show" over
 * a full table on the metadata screens.
 */
this.syncjobs = '<div class="ss-usage" ng-show="selectedMetadata.value == \'SyncJobs\'">'+

/*
 * What the org is doing, while it does it.
 *
 * A deploy takes minutes and the panel used to show nothing at all until it
 * ended - so this is one focused surface: the job, the stage, how far
 * through, the components the org has finished with, and at the end the
 * outcome in the same place rather than somewhere else on the page.
 *
 * It cannot be dismissed while the job is running. Not to trap anybody - the
 * job carries on regardless - but because closing it loses the only view of
 * something that is happening right now, and the list behind it cannot show
 * it until it stops.
 */
/*
 * The jobs waiting on a decision, in front of the user.
 *
 * The same surface the run uses, because it is the same conversation: this
 * one asks, that one reports. It is dismissible - the jobs stay staged and
 * stay in the section below - and it does not come back for a job already
 * turned down.
 */
'<div class="ss-run-backdrop" ng-if="syncReview.open && !syncRun.open">'+
'<div class="ss-run is-review">'+

'<div class="ss-run-head">'+
'<b>{{syncReview.jobs.length}} job<span ng-if="syncReview.jobs.length !== 1">s</span> '+
'waiting on you</b></div>'+

/*
 * Head, scrolling body, fixed footer.
 *
 * The list is as long as the job is big - a 42-component deploy filled the
 * box and pushed Apply and Discard off the bottom of it, leaving a modal
 * asking a question with only "Later" reachable. The decision has to stay on
 * screen however much there is to read above it.
 */
'<div class="ss-run-body">'+
'<p class="ss-run-stage">Nothing has been sent yet. Each one deploys only when you '+
'apply it.</p>'+

'<ul class="ss-review-list">'+
'<li ng-repeat="job in syncReview.jobs">'+
/* The subject only. The line directly below is source -> target, so the
 * combined title named the target org twice in two lines. */
'<div class="ss-review-what">{{syncJobSubject(job)}}</div>'+
'<div class="ss-review-where">{{job.source.label}} &rarr; {{job.target.label}}'+
'<span ng-if="job.checkOnly"> &middot; validation only</span>'+
'<span ng-if="job.kind === \'data\'"> &middot; {{job.objectApiName}}</span></div>'+
/*
 * And what is actually in it.
 *
 * This modal asks "apply or discard" over a line that said "2
 * components -> org" - which names the shape of the job and not one
 * thing in it. Approving a deploy you have not been shown is not a
 * review, so the same block the detail row uses is rendered here.
 */
/*
 * With more than one job staged, each carries its own pair - and they sit
 * above the list of what is in it, not below it, so they are not buried
 * under however many components that job happens to have.
 *
 * With exactly one they are in the footer instead, where they cannot be
 * scrolled away from at all. Not both: two Apply buttons for one job is a
 * question about which of them is the real one.
 */
'<div class="ss-review-do" ng-if="syncReview.jobs.length > 1">'+
'<button class="ss-sync-act is-send" ng-disabled="sync.busyJob === job.id" '+
'ng-click="syncApply(job)">{{syncApplyLabel(job)}}</button>'+
'<button class="ss-sync-act is-quiet" ng-click="syncDiscard(job)">Discard</button>'+
'</div>'+
'<syncjobcarries></syncjobcarries>'+
'</li>'+
'</ul>'+
'</div>'+

'<div class="ss-run-actions is-review-foot">'+
/* Later first and pushed left: it is the way out, not the answer. */
'<button class="ss-desc-link ss-run-later" ng-click="syncDismissReview()">Later</button>'+
'<button class="ss-sync-act is-quiet" ng-if="syncSoleReviewJob()" '+
'ng-click="syncDiscard(syncSoleReviewJob())">Discard</button>'+
'<button class="ss-sync-act is-send" ng-if="syncSoleReviewJob()" '+
'ng-disabled="sync.busyJob === syncSoleReviewJob().id" '+
'ng-click="syncApply(syncSoleReviewJob())">'+
'{{sync.busyJob === syncSoleReviewJob().id ? syncApplyingLabel(syncSoleReviewJob()) '+
': syncApplyLabel(syncSoleReviewJob())}}</button>'+
'</div>'+

'</div></div>'+

'<div class="ss-run-backdrop" ng-if="syncRun.open">'+
'<div class="ss-run">'+

'<div class="ss-run-head">'+
'<b>{{syncJobTitle(syncRun.job)}}</b>'+
'<span class="ss-run-close" ng-if="syncRun.outcome" ng-click="syncCloseRun()">&times;</span>'+
'</div>'+

/* Running. */
'<div ng-if="!syncRun.outcome">'+
'<p class="ss-run-stage">{{syncRunStage()}}</p>'+
'<div class="ss-run-bar" ng-if="syncRun.job.progress.total">'+
'<span ng-style="{width: syncRunPercent() + \'%\'}"></span></div>'+
'<p class="ss-run-count" ng-if="syncRun.job.progress.total">'+
'{{syncRun.job.progress.done || 0}} of {{syncRun.job.progress.total}}</p>'+
'<ul class="ss-run-items" ng-if="syncRun.job.progress.recent.length">'+
'<li ng-repeat="c in syncRun.job.progress.recent">{{c}}</li></ul>'+
'<p class="ss-run-note">This keeps running if you close the panel. The org is '+
'doing the work; this is only watching.</p>'+
'</div>'+

/* Finished. */
'<div ng-if="syncRun.outcome === \'succeeded\'" class="ss-run-done is-good">'+
'<b>Done.</b>'+
'<p ng-if="syncRun.job.kind !== \'data\'">'+
'{{syncRun.job.result.deployed}} of {{syncRun.job.result.total}} components'+
'<span ng-if="syncRun.job.result.checkOnly"> validated, not deployed</span>.</p>'+
'<p ng-if="syncRun.job.kind === \'data\'">'+
'{{syncRun.job.result.matched}} updated, {{syncRun.job.result.created}} created.</p>'+
'</div>'+

'<div ng-if="syncRun.outcome === \'failed\'" class="ss-run-done is-bad">'+
'<b>Nothing was written.</b>'+
'<p>{{syncRun.job.error.message || syncRun.error}}</p>'+
'<ul class="ss-run-items" ng-if="syncRun.job.error.failures.length">'+
'<li ng-repeat="f in syncRun.job.error.failures | limitTo:8">'+
'{{f.type}} {{f.name}}: {{f.problem}}</li></ul>'+
'<ul class="ss-run-items" ng-if="syncRun.job.error.records.length">'+
'<li ng-repeat="r in syncRun.job.error.records | limitTo:8">'+
'{{r.key || \'row \' + (r.index + 1)}}: {{r.message}}</li></ul>'+
'</div>'+

'<div ng-if="syncRun.outcome === \'blocked\'" class="ss-run-done is-wait">'+
'<b>Needs signing in.</b><p>{{syncRun.job.error.message}}</p></div>'+

/*
 * The worker stopped answering. It says nothing about the org, which is
 * still doing whatever it was doing - so this says that rather than guessing
 * at an outcome.
 */
'<div ng-if="syncRun.outcome === \'unknown\'" class="ss-run-done is-wait">'+
'<b>Lost contact with the extension.</b>'+
'<p>{{syncRun.error}} The org may still be working - reopen this page in a '+
'minute and the list will say.</p></div>'+

'<div class="ss-run-actions" ng-if="syncRun.outcome">'+
'<button class="ss-about-copy" ng-click="syncCloseRun()">Close</button></div>'+

'</div></div>'+

/*
 * Status, not preamble.
 *
 * This was a card headed "Org Sync" over a sentence restating the page
 * subtitle directly above it - two boxes of throat-clearing before anything
 * on the page could be seen. What it actually carries is the error, the
 * notice and the stuck-in-the-panel block, none of which is present most of
 * the time, so it now has no chrome of its own and collapses when it is
 * empty. The guarantee that was worth keeping moved down to the pipelines,
 * next to the buttons it is about.
 */
'<div class="ss-sync-status" '+
'ng-show="sync.error || sync.notice || sync.loading || syncNeedsFullPage()">'+
/*
 * The message, and the code that explains it.
 *
 * The code is a link rather than decoration: the commonest error on this
 * page is the worker waking up, and "press it again" is a sentence
 * nobody should have to guess. The title comes from the same catalogue
 * the page does, so the two cannot disagree.
 */
'<div class="ss-rest-error" ng-show="sync.error">'+
'<span>{{sync.error}}</span>'+
'<span class="ss-error-code" ng-if="sync.errorCode">'+
'<a ng-href="{{syncErrorHelpUrl()}}" target="_blank" rel="noopener noreferrer" '+
'title="{{syncErrorTitle()}}">{{sync.errorCode}} &#8599;</a></span>'+
'</div>'+
'<p class="ss-sync-notice" ng-show="sync.notice">{{sync.notice}}</p>'+
/*
 * Stuck in the panel, when the page can do it.
 *
 * The panel is whichever org's page it was opened on and cannot be pointed
 * anywhere else, so with no pipeline able to send from here there is nothing
 * to do on this surface at all. Above the pipelines rather than beside them:
 * every row would otherwise repeat it, and the answer is the same for all of
 * them. syncNeedsFullPage keeps it off the page whenever a pipeline can run.
 */
'<div class="ss-sync-fullpage" ng-if="syncNeedsFullPage()">'+
'<p class="ss-sync-fullpage-head">Open Simplified as its own page to use this</p>'+
'<p>This panel acts as the org whose page it is on'+
'<span ng-if="syncHereLabel()"> &mdash; {{syncHereLabel()}}</span>, and that is not one '+
'end of any pipeline, so nothing can be sent from here. Signing in to an org from this '+
'panel does not change that.</p>'+
'<p>Simplified\'s own page has an org picker: open it, choose the org you want to send '+
'from, and the pipelines below become usable.</p>'+
/* Straight to this page, not wherever the standalone tab was left. Being
 * told to open another surface and then landing somewhere else on it is
 * barely better than not being told. */
'<button class="ss-about-copy" ng-click="openInNewTab(\'SyncJobs\')">'+
'Open the full page on Org Sync &amp; Jobs</button>'+
'</div>'+

'<p class="ss-usage-lead" ng-show="sync.loading">Reading jobs…</p>'+
'</div>'+

/* ------------------------------- orgs ---------------------------------- */
/*
 * Every org this browser remembers, and whether it is still signed in.
 *
 * Above the pipelines because it is the thing a pipeline depends on: a
 * pipeline whose second org signed out looks exactly like a working one
 * until it is run. The list is kept whether or not the session survived -
 * an org you used last week is still an org you work in, and "sign in
 * again" is a more useful thing to say about it than nothing.
 */
'<div class="ss-usage-api" ng-if="orgSessions.list.length">'+
'<div class="ss-sync-head">'+
'<h4>Orgs in this browser ({{orgSessions.list.length}})</h4>'+
'<span class="ss-sync-clear">'+
'<button class="ss-desc-link" ng-click="loadOrgSessions()" '+
'ng-disabled="orgSessions.loading">'+
'{{orgSessions.loading ? \'Checking…\' : \'Re-check\'}}</button></span>'+
'</div>'+

'<p class="ss-rest-error" ng-show="orgSessions.error">{{orgSessions.error}}</p>'+

'<div class="ss-org-list">'+
'<div class="ss-org-row" ng-repeat="knownOrg in orgSessions.list" '+
'ng-class="{\'is-expired\': !knownOrg.live}">'+
'<span class="ss-org-state" ng-class="knownOrg.live ? \'is-live\' : \'is-expired\'">'+
'{{knownOrg.live ? \'Signed in\' : \'Expired\'}}</span>'+
'<span class="ss-org-name">{{knownOrg.label}}</span>'+
/*
 * Only the ones that need it. A live org with a "sign in" button beside it
 * invites a click that does nothing anybody wanted.
 */
'<button class="ss-sync-act is-send" ng-if="!knownOrg.live" '+
'ng-click="signInToOrg(knownOrg)">Sign in &#8599;</button>'+
'</div>'+
'</div>'+

'<p class="ss-usage-note" ng-if="expiredOrgCount()">'+
'{{expiredOrgCount()}} of these have no session in this browser any more. '+
'Signing in opens the org in a tab - Salesforce takes your credentials, not '+
'this extension, which never sees or stores them.</p>'+
'</div>'+

/* ------------------------------ pipelines ------------------------------ */
'<div class="ss-usage-api">'+
'<h4>Pipelines</h4>'+

'<p class="ss-usage-note" ng-if="!sync.pipelines.length && !sync.draft">'+
'No pipeline yet. A pipeline is a pair of orgs and a direction; both have to be orgs '+
'this browser has a session for.</p>'+

/*
 * The mapping, read from where the user is standing.
 *
 * "sandbox1 ↔ sandbox2" is true and does not answer the question somebody has
 * before deploying, which is: which of these is me, and which one am I about
 * to write into. So when the current org is one end of the pipeline the row
 * is drawn as source → target with this org marked, and the flat two-org line
 * is kept only for pipelines this org is no part of.
 */
'<div class="ss-sync-cards" ng-if="sync.pipelines.length">'+
/*
 * repeat-start/repeat-end, because the records form below is a second row of
 * the same iteration.
 *
 * It was written as a plain sibling after the repeat, where p does not exist
 * - so p.id was undefined, the row's condition could never be true, and
 * "Send records" set the state and appeared to do nothing at all. A repeat's
 * variable is only defined on the elements the repeat covers.
 */
/*
 * The mapping gets the whole width, and the actions get their own band
 * below it.
 *
 * They were a right-hand cell, which is fine for two controls and wrong
 * for five: the cell took enough width that the org names wrapped, and
 * the buttons then wrapped too - right-aligned, so each line ended in a
 * different place and Edit and Remove came to rest beside Send records
 * as though they belonged with it. Two rows of one column each, held
 * together by the rail and by having no rule drawn between them, so the
 * pair still reads as one pipeline.
 */
/*
 * One card per pipeline, and one repeat to make it.
 *
 * This was three <tr>s held together by a suppressed border and a rail
 * drawn down both of them - a card described the long way round. A
 * pipeline is a configured thing with its own actions and its own
 * settings form, and nothing is compared across them, so the grid a
 * table buys was paying for nothing.
 *
 * It also retires the repeat-start/repeat-end pair. That construct has
 * produced the same bug on this page four times: an element written
 * after the repeat instead of inside it, where the alias is undefined
 * and every binding on it silently evaluates to nothing. A single
 * element repeat cannot be got wrong that way.
 */
'<div class="ss-sync-card" ng-repeat="p in sync.pipelines" '+
'ng-class="{\'is-here\': p.here.canSend}">'+
'<div class="ss-sync-card-head">'+

'<span class="ss-sync-map" ng-if="p.here.canSend">'+
'<span class="ss-sync-org is-source">{{p.here.source.label}}'+
'<em class="ss-sync-badge">this org</em></span>'+
/*
 * Arrow and target as one unit. Org labels are full hostnames and the row
 * wraps on a narrow panel; left as siblings the arrow ends up stranded at
 * the end of the first line, pointing at nothing.
 */
'<span class="ss-sync-to">'+
'<span class="ss-sync-arrow">&rarr;</span>'+
'<span class="ss-sync-org is-target">{{p.here.target.label}}</span>'+
'</span>'+
'</span>'+

'<span class="ss-usage-feature-name" ng-if="!p.here.canSend">{{syncPipelineLine(p)}}</span>'+

/*
 * Why this row cannot send, when it cannot. Two different reasons, and the
 * difference matters: a pipeline this org is no part of needs a different
 * org opened, while a one-way pipeline pointed the other way needs nothing
 * opened at all - it is simply not the direction that was set up.
 */
'<div class="ss-about-sub" ng-if="!p.here.canSend">{{p.here.reason}}'+
/*
 * Where it can be done instead. A one-way pipeline has exactly one org that
 * may send down it, and telling somebody which is more use than telling them
 * this is not it.
 */
'<span ng-if="p.here.sender"> Open <a ng-href="{{p.here.sender.origin}}" target="_blank" '+
'rel="noopener noreferrer">{{p.here.sender.label}}</a> and tick what you want to send '+
'there.</span></div>'+
'<div class="ss-about-sub" ng-if="p.enabled === false">Switched off.</div>'+
/*
 * How much this pipeline has actually carried, and when it last did.
 *
 * Counted on the pipeline rather than from the job list below, which is
 * capped and can be emptied - so this keeps counting past a Clear all, and
 * says so where somebody might otherwise read the two as the same number.
 */
'<div class="ss-about-sub ss-sync-usage" ng-if="syncUsageLine(p)" '+
'ng-class="{\'is-allfailed\': syncAllFailed(p)}">'+
'{{syncUsageLine(p)}}'+
'<span ng-if="p.usage.lastRunAt"> &middot; last used '+
'{{p.usage.lastRunAt | date:\'d MMM HH:mm\'}}</span></div>'+
'<div class="ss-about-sub" ng-if="!syncUsageLine(p)">Not used yet.</div>'+
'</div>'+
/* The card's footer. Same band, now held by the card rather than by
 * the absence of a rule between two rows. */
'<div class="ss-sync-actions is-band">'+
/*
 * Offered on every pipeline, whichever org this is - and only once there is
 * something to send.
 *
 * The gate is the selection, not the org. Both of these act on the ticked
 * components, so with nothing ticked they have no subject and can only
 * refuse; but which org you are standing in is what the tag above is for,
 * and hiding a working control to restate the tag took away function to
 * make a point that was already made.
 */
/*
 * Two gates, and both are needed.
 *
 * The selection, because these act on the ticked components and have no
 * subject without them. And the route, because a pipeline that only runs the
 * other way cannot be sent down from here at all - offering it produced a
 * button whose only possible outcome was the refusal in red at the top of
 * the page.
 */
/*
 * The count is in the label, not only in the note below the table.
 *
 * These three send different things - ticked components for two of them,
 * ticked records for the third - and the number is the difference between
 * pressing one and wondering what it is about to carry.
 */
'<button class="ss-sync-act is-send" ng-if="sync.selected && p.here.canSend" '+
'ng-click="syncStage(p, false)">Send selection ({{sync.selected}})</button>'+
'<button class="ss-sync-act is-check" ng-if="sync.selected && p.here.canSend" '+
'ng-click="syncStage(p, true)">Validate only ({{sync.selected}})</button>'+
/*
 * Gated on the record basket, the way Send selection is gated on the
 * metadata one. With nothing ticked there are no records to send, and the
 * form would open asking which object to carry from an empty basket.
 */
'<button class="ss-sync-act is-send" ng-if="sync.selectedRecords && p.here.canSend" '+
'ng-click="syncOpenData(p)">Send records ({{sync.selectedRecords}})…</button>'+
'<button class="ss-sync-act is-quiet" ng-click="syncEditPipeline(p)">Edit</button>'+
'<button class="ss-sync-act is-danger" ng-click="syncDeletePipeline(p)">Remove</button>'+
'</div>'+

/*
 * Records, which need something metadata does not: a key.
 *
 * A component is matched by name and the name is the same in both orgs. A
 * record has no such thing - its Id is different in every org - so the user
 * nominates a field that means the same row in both. Salesforce will only
 * match on an External Id, so the list comes from the target org rather than
 * from a text box that could name a field it will not accept.
 */
'<div ng-if="syncData.open && syncData.pipeline === p.id">'+
'<div class="ss-sync-draft">'+

'<p class="ss-usage-note">Sending the {{sync.selectedRecords}} record'+
'<span ng-if="sync.selectedRecords !== 1">s</span> ticked in the metadata lists.</p>'+

/*
 * One object per job, because a query names one. A basket holding two is a
 * real question rather than something to guess at - guessing would send the
 * wrong rows into another org - so it is asked, once, and only then.
 */
'<label class="ss-sync-field" ng-if="syncData.types.length > 1"><span>Which object</span>'+
'<select ng-model="syncData.objectApiName" ng-change="syncLoadKeys()" '+
'ng-options="t as t for t in syncData.types">'+
'<option value="">Choose one…</option></select></label>'+
'<p class="ss-usage-note" ng-if="syncData.types.length > 1">'+
'The ticked records span more than one object, and a job carries one. The rest stay '+
'ticked for a second job.</p>'+

'<div class="ss-sync-field" ng-if="syncData.types.length === 1"><span>Object</span>'+
'<div class="ss-sync-fixed">{{syncData.objectApiName}}</div></div>'+

'<p class="ss-rest-error" ng-if="!syncData.types.length">'+
'Nothing is ticked any more - the basket was cleared while this was open.</p>'+

'<button class="ss-desc-link" ng-if="syncData.objectApiName && !syncData.keys.length" '+
'ng-click="syncLoadKeys()" ng-disabled="syncData.loadingKeys">'+
'{{syncData.loadingKeys ? \'Asking the org…\' : \'Find matching keys\'}}</button>'+

'<p class="ss-rest-error" ng-show="syncData.keyError && !syncData.keyAuth">'+
'{{syncData.keyError}}</p>'+

/*
 * A session problem, said as the sign-in it is.
 *
 * The org that refused is the far end of the pipeline, not the one being
 * looked at - so the panel's own sign-in card cannot fix it, and offering
 * that would send somebody to sign in to the org they are already in. The
 * honest action is a way to open the org that actually refused.
 */
'<div class="ss-sync-signin" ng-if="syncData.keyAuth">'+
'<b>{{syncData.keyAuth.label}} needs signing in again.</b>'+
'<p>Its session has expired or was refused, so it cannot say which fields can '+
'match records. Open it, sign in, then look again - nothing has been sent.</p>'+
'<a class="ss-about-link" ng-href="{{syncData.keyAuth.origin}}" target="_blank" '+
'rel="noopener noreferrer">Open {{syncData.keyAuth.label}} &#8599;</a>'+
'<button class="ss-desc-link" ng-click="syncLoadKeys()" '+
'ng-disabled="syncData.loadingKeys">'+
'{{syncData.loadingKeys ? \'Looking…\' : \'Look again\'}}</button>'+
'</div>'+

'<label class="ss-sync-field" ng-if="syncData.keys.length"><span>Match records on</span>'+
'<select ng-model="syncData.keyField" ng-change="syncSuggestQuery()" '+
'ng-options="k.name as syncKeyLabel(k) for k in syncData.keys">'+
'<option value="">Choose a key…</option></select></label>'+

/*
 * Which of the two ways this key will be honoured, and what that costs.
 *
 * Said once the key is chosen rather than as a wall of text beforehand: the
 * difference only matters after there is something to apply it to, and the
 * lookup mode's failure - a key that turns out to identify several records -
 * is the one worth warning about before pressing Apply.
 */
'<p class="ss-usage-note" ng-if="syncChosenKey().mode === \'upsert\'">'+
'{{syncData.keyField}} is an External Id, so {{p.here.target.label || \'the target org\'}} '+
'does the matching itself, in one write.</p>'+

/*
 * The one choice that cannot update anything.
 *
 * Every other option here either finds the record or creates it. This one
 * creates unconditionally, so a record the target already has becomes a
 * second copy - which is right when the target is empty and wrong almost
 * everywhere else. Said as a warning, not a description.
 */
'<p class="ss-sync-warn" ng-if="syncChosenKey().mode === \'insert\'">'+
'<b>Nothing is matched.</b> Every record in the query is created in '+
'{{p.here.target.label || \'the target org\'}}, including any it already has - those '+
'become second copies. Use this when the target is empty, or when duplicates are what '+
'you want.</p>'+

'<p class="ss-usage-note" ng-if="syncChosenKey().mode === \'lookup\'">'+
'Nothing on this object is marked as an External Id, so the records are found by looking '+
'{{syncData.keyField}} up in {{p.here.target.label || \'the target org\'}} - matches are '+
'updated, the rest are created. If a value matches more than one record there, the job '+
'stops and writes nothing rather than guess.'+
'<span ng-if="!syncChosenKey().unique"> This field is not unique, so that is possible.'+
'</span></p>'+

'<p class="ss-usage-note" ng-if="syncData.keys.length">'+
'Id is never offered: the same record has a different Id in every org, which is why a '+
'key is needed at all.</p>'+

'<label class="ss-sync-field" ng-if="syncData.keyField"><span>Records to send</span>'+
'<textarea rows="3" ng-model="syncData.query"></textarea></label>'+

'<p class="ss-usage-note" ng-if="syncData.keyField">'+
'One job carries at most {{sync.dataLimit}} records and writes them all or none. '+
'A record with no counterpart in the target is created, with every field it has - which '+
'is what FIELDS(ALL) is for. So is one with nothing in the key field: it cannot be '+
'matched, which is another way of saying the target does not have it. Lookup fields are '+
'the exception: they hold Ids belonging to this org, which mean nothing in the other '+
'one.</p>'+

'<div class="ss-sync-draft-actions">'+
'<button class="ss-about-copy" ng-if="syncData.keyField" ng-click="syncStageData()">'+
'Stage these records</button>'+
'<button class="ss-desc-link" ng-click="syncOpenData(p)">Cancel</button>'+
'</div>'+
'</div>'+
'</div>'+
'</div>'+
'</div>'+

/*
 * Why the two buttons are missing, when they are.
 *
 * A control that vanishes without explanation reads as a bug. This is the
 * same sentence either way - what gets sent, and how much of it there is -
 * so the page says what to do rather than only what is absent.
 */
'<p class="ss-usage-note" ng-if="sync.pipelines.length && sync.selected">'+
'&#8220;Send selection&#8221; stages the components ticked in the metadata lists - the same '+
'selection package.xml is built from. {{sync.selected}} ticked right now.</p>'+

/*
 * The guarantee, moved down from the preamble it used to sit in.
 *
 * It is about what the buttons directly above do, and it was being read
 * - if at all - two cards away from them.
 */
'<p class="ss-usage-note ss-sync-guarantee" ng-if="sync.pipelines.length">'+
'Nothing here deploys on its own. Every button stages a job, and a staged job waits '+
'under &#8220;Waiting on you&#8221; until you apply it.</p>'+

'<p class="ss-usage-note" ng-if="sync.pipelines.length && !sync.selected">'+
'Nothing is ticked, so there is nothing to send yet. Tick components in any metadata list - '+
'the same selection package.xml is built from - and Send selection appears here.</p>'+

'<button class="ss-about-copy" ng-click="syncNewPipeline()" ng-if="!sync.draft">Add a pipeline</button>'+

/* the editor */
'<div class="ss-sync-draft" ng-if="sync.draft">'+
'<label class="ss-sync-field"><span>First org</span>'+
'<select ng-model="sync.draft.a.origin" ng-change="syncPickOrg(\'a\')" '+
'ng-options="o.origin as o.label for o in sync.orgs">'+
'<option value="">Choose an org…</option></select></label>'+

'<label class="ss-sync-field"><span>Second org</span>'+
'<select ng-model="sync.draft.b.origin" ng-change="syncPickOrg(\'b\')" '+
'ng-options="o.origin as o.label for o in sync.orgs">'+
'<option value="">Choose an org…</option></select></label>'+

'<label class="ss-sync-field"><span>Direction</span>'+
'<select ng-model="sync.draft.direction" '+
'ng-options="d.value as d.label for d in syncDirections"></select></label>'+

/*
 * Which tests the org runs, chosen here because it has to be chosen before
 * validating rather than after. A validation that ran no tests cannot later
 * stand in for a deploy where tests are required - so somebody aiming a
 * quick deploy at production has to have set this first.
 */
'<label class="ss-sync-field"><span>Tests</span>'+
'<select ng-model="sync.draft.testLevel" '+
'ng-options="t.value as t.label for t in syncTestLevels"></select></label>'+
'<p class="ss-usage-note">Running local tests makes a validation slower and makes it '+
'usable as a quick deploy where tests are required. Sandboxes usually need neither.</p>'+

'<label class="ss-checkbox-label">'+
'<input type="checkbox" ng-model="sync.draft.enabled"/><span>Enabled</span></label>'+

'<div class="ss-sync-draft-actions">'+
'<button class="ss-about-copy" ng-click="syncSavePipeline()">Save pipeline</button>'+
'<button class="ss-desc-link" ng-click="syncCancelPipeline()">Cancel</button>'+
'</div>'+

'<p class="ss-usage-note">Only orgs this browser already has a session for can be used. '+
'A job for an org that has since signed out waits as &#8220;Needs sign in&#8221; rather '+
'than failing.</p>'+
'</div>'+
'</div>'+

/* ------------------------------- waiting ------------------------------- */
/*
 * The one section here that is asking for something.
 *
 * Everything else on this page is a record of what already happened, and it
 * appears whether or not anyone needs to do anything. This appears only when
 * there is a job that has not been decided, so it is marked - a section that
 * looks like the two below it gets read at the same speed as them, which is
 * to say skimmed.
 */
'<div class="ss-usage-api ss-sync-waiting" ng-if="sync.groups.active.length">'+
'<h4>Waiting on you ({{sync.groups.active.length}})</h4>'+
'<div class="ss-job-tiles">'+
'<div class="ss-job-tile" ng-repeat="job in sync.pages.active.items" '+
'ng-class="{\'is-open\': syncIsOpen(job)}">'+
/*
 * The row's own title, as a disclosure rather than a link.
 *
 * It was an <a href="">, which browsers colour as visited after the first
 * click - so a history list turned progressively purple, reading as though
 * the rows had been somewhere rather than opened. It also goes nowhere: the
 * click expands the detail below it. The caret says which it is, and the
 * state pill leads the line because "did this work" is the question the list
 * is scanned for, and it was previously answered at the far right margin.
 */
'<button class="ss-sync-job" ng-click="syncToggleJob(job)" '+
'ng-class="{\'is-open\': syncIsOpen(job)}">'+
'<span class="ss-sync-caret" aria-hidden="true">&#9656;</span>'+
'<span ng-class="syncStateClass(job)">{{syncStateLabel(job)}}</span>'+
'<span class="ss-sync-job-name">{{syncJobSubject(job)}}</span>'+
'<span class="ss-sync-job-to">&rarr; {{syncJobTarget(job)}}</span>'+
'</button>'+
'<div class="ss-about-sub">{{job.source.label}} &rarr; {{job.target.label}}'+
'<span ng-if="job.checkOnly"> &middot; validation only</span></div>'+
'<div class="ss-sync-actions is-foot">'+
/* Apply is the one thing this section exists to ask for, so it is drawn
 * as the act it is; Discard sits beside it as the quiet alternative. */
'<button class="ss-sync-act is-send" ng-if="syncApplyable(job)" ng-disabled="sync.busyJob === job.id" '+
'ng-click="syncApply(job)">{{sync.busyJob === job.id ? syncApplyingLabel(job) '+
': syncApplyLabel(job)}}</button>'+
'<button class="ss-sync-act is-quiet" ng-if="syncApplyable(job)" ng-click="syncDiscard(job)">Discard</button>'+
'</div>'+
/* The detail, inside the tile it belongs to. It spans the whole grid
 * when open - at one column's width the component chips and the query
 * are unreadable, and it is the one thing here worth reading in full. */
'<div class="ss-job-tile-detail" ng-if="syncIsOpen(job)">'+
'<syncjobdetail></syncjobdetail></div>'+
'</div>'+
'</div>'+
'<div class="ss-sync-pager" ng-if="sync.pages.active.pages > 1">'+
'<span>{{sync.pages.active.from}}&ndash;{{sync.pages.active.to}} of {{sync.pages.active.total}}</span>'+
'<button class="ss-desc-link" ng-disabled="!sync.pages.active.hasPrevious" ng-click="syncPage(\'active\', -1)">Previous</button>'+
'<button class="ss-desc-link" ng-disabled="!sync.pages.active.hasNext" ng-click="syncPage(\'active\', 1)">Next</button>'+
'</div>'+
'</div>'+

/* ------------------------------- failed -------------------------------- */


/* ------------------------------ succeeded ------------------------------ */
'<div class="ss-usage-api" ng-if="sync.groups.succeeded.length">'+
'<div class="ss-sync-head">'+
'<h4>Succeeded ({{sync.groups.succeeded.length}})</h4>'+
'<span class="ss-sync-clear" ng-if="sync.clearing !== \'succeeded\'">'+
'<button class="ss-desc-link" ng-click="syncConfirmClear(\'succeeded\')">Clear all</button></span>'+
'<span class="ss-sync-clear is-asking" ng-if="sync.clearing === \'succeeded\'">'+
'<span>Clear all {{sync.groups.succeeded.length}}? The org is not affected.</span>'+
'<button class="ss-desc-link" ng-click="syncClear(\'succeeded\')">Yes, clear</button>'+
'<button class="ss-desc-link" ng-click="syncConfirmClear(\'succeeded\')">Cancel</button></span>'+
'</div>'+
'<div class="ss-job-tiles">'+
'<div class="ss-job-tile" ng-repeat="job in sync.pages.succeeded.items" '+
'ng-class="{\'is-open\': syncIsOpen(job)}">'+
/*
 * The row's own title, as a disclosure rather than a link.
 *
 * It was an <a href="">, which browsers colour as visited after the first
 * click - so a history list turned progressively purple, reading as though
 * the rows had been somewhere rather than opened. It also goes nowhere: the
 * click expands the detail below it. The caret says which it is, and the
 * state pill leads the line because "did this work" is the question the list
 * is scanned for, and it was previously answered at the far right margin.
 */
'<button class="ss-sync-job" ng-click="syncToggleJob(job)" '+
'ng-class="{\'is-open\': syncIsOpen(job)}">'+
'<span class="ss-sync-caret" aria-hidden="true">&#9656;</span>'+
'<span ng-class="syncStateClass(job)">{{syncStateLabel(job)}}</span>'+
'<span class="ss-sync-job-name">{{syncJobSubject(job)}}</span>'+
'<span class="ss-sync-job-to">&rarr; {{syncJobTarget(job)}}</span>'+
'</button>'+
'<div class="ss-about-sub" ng-if="job.kind !== \'data\'">'+
'{{job.result.deployed}} of {{job.result.total}} components'+
'<span ng-if="job.result.checkOnly"> &middot; validated, not deployed</span></div>'+
'<div class="ss-about-sub" ng-if="job.kind === \'data\'">'+
'{{job.result.matched}} updated, {{job.result.created}} created'+
'<span ng-if="job.keyField && job.keyField !== \'__ss_create_all__\'"> on {{job.keyField}}</span>'+
'<span ng-if="job.result.keyless"> &middot; {{job.result.keyless}} had no key, so they '+
'were created</span></div>'+

/*
 * A validation that can still be deployed says so, and says for how long.
 * The alternative is somebody discovering the ten-day expiry by pressing a
 * button on day eleven.
 */
'<div class="ss-about-sub" ng-if="syncQuickDeployable(job)">'+
'The org still holds this validation - {{syncValidationDaysLeft(job)}} day'+
'<span ng-if="syncValidationDaysLeft(job) !== 1">s</span> left to deploy it without '+
'validating again.</div>'+
/*
 * And when it is not offered, why. A missing button explains nothing, and
 * the commonest reason has a fix nobody would guess from silence.
 */
'<div class="ss-about-sub ss-sync-whynot" ng-if="syncQuickWhyNot(job)">'+
'{{syncQuickWhyNot(job)}}</div>'+

'<div class="ss-sync-actions is-foot">'+
/*
 * Deploy what the org has already verified: no retrieve, no recompile, and
 * the tests it ran are not run again. Offered only while the org still holds
 * it - past that the id is gone, and a button that can only fail is worse
 * than no button.
 */
'<button class="ss-sync-act is-check ss-sync-quick" ng-if="syncQuickDeployable(job)" '+
'ng-disabled="sync.busyJob === job.id" ng-click="syncQuickDeploy(job)">'+
'{{sync.busyJob === job.id ? \'Deploying…\' : \'Quick deploy\'}}</button>'+
'<button class="ss-sync-act is-quiet" ng-click="syncDiscard(job)">Discard</button>'+
'</div>'+
/* The detail, inside the tile it belongs to. It spans the whole grid
 * when open - at one column's width the component chips and the query
 * are unreadable, and it is the one thing here worth reading in full. */
'<div class="ss-job-tile-detail" ng-if="syncIsOpen(job)">'+
'<syncjobdetail></syncjobdetail></div>'+
'</div>'+
'</div>'+
'<div class="ss-sync-pager" ng-if="sync.pages.succeeded.pages > 1">'+
'<span>{{sync.pages.succeeded.from}}&ndash;{{sync.pages.succeeded.to}} of {{sync.pages.succeeded.total}}</span>'+
'<button class="ss-desc-link" ng-disabled="!sync.pages.succeeded.hasPrevious" ng-click="syncPage(\'succeeded\', -1)">Previous</button>'+
'<button class="ss-desc-link" ng-disabled="!sync.pages.succeeded.hasNext" ng-click="syncPage(\'succeeded\', 1)">Next</button>'+
'</div>'+
'</div>'+

'<div class="ss-usage-api" ng-if="sync.groups.failed.length">'+
/*
 * Clear all, in two steps.
 *
 * The confirmation is the same control in a different state rather than a
 * dialog: it costs one more click and nothing else. Worth that much because
 * this is the only button here that throws away more than one thing, and
 * what it throws away is the record of what was deployed where.
 */
'<div class="ss-sync-head">'+
'<h4>Failed ({{sync.groups.failed.length}})</h4>'+
'<span class="ss-sync-clear" ng-if="sync.clearing !== \'failed\'">'+
'<button class="ss-desc-link" ng-click="syncConfirmClear(\'failed\')">Clear all</button></span>'+
'<span class="ss-sync-clear is-asking" ng-if="sync.clearing === \'failed\'">'+
'<span>Clear all {{sync.groups.failed.length}}? The org is not affected.</span>'+
'<button class="ss-desc-link" ng-click="syncClear(\'failed\')">Yes, clear</button>'+
'<button class="ss-desc-link" ng-click="syncConfirmClear(\'failed\')">Cancel</button></span>'+
'</div>'+
'<div class="ss-job-tiles">'+
'<div class="ss-job-tile" ng-repeat="job in sync.pages.failed.items" '+
'ng-class="{\'is-open\': syncIsOpen(job)}">'+
/*
 * The row's own title, as a disclosure rather than a link.
 *
 * It was an <a href="">, which browsers colour as visited after the first
 * click - so a history list turned progressively purple, reading as though
 * the rows had been somewhere rather than opened. It also goes nowhere: the
 * click expands the detail below it. The caret says which it is, and the
 * state pill leads the line because "did this work" is the question the list
 * is scanned for, and it was previously answered at the far right margin.
 */
'<button class="ss-sync-job" ng-click="syncToggleJob(job)" '+
'ng-class="{\'is-open\': syncIsOpen(job)}">'+
'<span class="ss-sync-caret" aria-hidden="true">&#9656;</span>'+
'<span ng-class="syncStateClass(job)">{{syncStateLabel(job)}}</span>'+
'<span class="ss-sync-job-name">{{syncJobSubject(job)}}</span>'+
'<span class="ss-sync-job-to">&rarr; {{syncJobTarget(job)}}</span>'+
'</button>'+
'<div class="ss-about-sub">{{job.error.message}}'+
/* The code, when the failure has one. Same link as the banner above. */
'<span class="ss-error-code" ng-if="syncJobErrorCode(job)">'+
'<a ng-href="{{syncJobHelpUrl(job)}}" target="_blank" rel="noopener noreferrer">'+
'{{syncJobErrorCode(job)}} &#8599;</a></span></div>'+
'<div class="ss-sync-actions is-foot">'+
'<button class="ss-desc-link" ng-if="syncNeedsAuth(job) && syncSignInHere(job)" '+
'ng-click="syncSignIn(job)">Sign in</button>'+
/* The far end of a pipeline cannot be signed in to from this org, so the
 * offer is a way to open it rather than a button that cannot work. */
'<a class="ss-desc-link" ng-if="syncNeedsAuth(job) && job.error.origin && !syncSignInHere(job)" '+
'ng-href="{{job.error.origin}}" target="_blank" rel="noopener noreferrer">'+
'Open {{syncBlockedOrg(job)}} &#8599;</a>'+
'<button class="ss-desc-link" ng-if="syncRetryable(job)" ng-disabled="sync.busyJob === job.id" '+
'ng-click="syncRetry(job)">{{sync.busyJob === job.id ? \'Working…\' : \'Retry\'}}</button>'+
'<button class="ss-sync-act is-quiet" ng-click="syncDiscard(job)">Discard</button>'+
'</div>'+
/* The detail, inside the tile it belongs to. It spans the whole grid
 * when open - at one column's width the component chips and the query
 * are unreadable, and it is the one thing here worth reading in full. */
'<div class="ss-job-tile-detail" ng-if="syncIsOpen(job)">'+
'<syncjobdetail></syncjobdetail></div>'+
'</div>'+
'</div>'+
'<div class="ss-sync-pager" ng-if="sync.pages.failed.pages > 1">'+
'<span>{{sync.pages.failed.from}}&ndash;{{sync.pages.failed.to}} of {{sync.pages.failed.total}}</span>'+
'<button class="ss-desc-link" ng-disabled="!sync.pages.failed.hasPrevious" ng-click="syncPage(\'failed\', -1)">Previous</button>'+
'<button class="ss-desc-link" ng-disabled="!sync.pages.failed.hasNext" ng-click="syncPage(\'failed\', 1)">Next</button>'+
'</div>'+
'</div>'+

'<div class="ss-usage-api" ng-if="!sync.loading && !sync.jobs.length">'+
'<p class="ss-usage-note">No jobs yet. Tick components in the metadata lists, then use '+
'&#8220;Send selection&#8221; on a pipeline above.</p>'+
'</div>'+

'<div class="ss-usage-api">'+
'<h4>What this does not do</h4>'+
/*
 * Rewritten. This said "Metadata only. Record data is not synced" long
 * after records could be, which is the worst kind of stale: not vague,
 * but confidently wrong about a feature two cards above it.
 */
'<p class="ss-usage-note">Nothing is deployed on its own - every button here '+
'stages a job that waits for you. Lookup fields are not carried between orgs: '+
'they hold Ids belonging to the source. Deploys run with rollback on error, so a '+
'package that fails part-way leaves the target org as it was, and records are '+
'written all or none, up to 200 a job.</p>'+
'</div>'+

'</div>';

/* The expanded row under a job: what is in it, and what the org said. */
/*
 * What a job carries: the components, or the records and the query.
 *
 * Its own template because two places need exactly this and must not be
 * allowed to drift: the detail row under a job in the history, and the
 * review modal that asks whether to apply a staged one. That modal said
 * "2 components -> org" and nothing else, which is not enough to answer the
 * question it was asking - approving a deploy without being shown what is
 * in it is not a review.
 */
this.syncjobcarries = '<div class="ss-sync-carries">'+
/* A data job: what is being written, and the thing that decides which row
 * gets overwritten. The query is shown in full - it is the definition of
 * what will be read, and it was editable right up until staging. */
'<div ng-if="job.kind === \'data\'">'+
'<div class="ss-sync-detail-head">Records</div>'+
'<table class="ss-usage-table">'+
'<tr><td>Object</td><td class="ss-about-value">{{job.objectApiName}}</td></tr>'+
'<tr ng-if="job.keyField !== \'__ss_create_all__\'"><td>Matched on</td>'+
'<td class="ss-about-value">{{job.keyField}}</td></tr>'+
'<tr ng-if="job.keyField === \'__ss_create_all__\'"><td>Matching</td>'+
'<td class="ss-about-value">none - every record created</td></tr>'+
'</table>'+
'<div class="ss-sync-detail-head">Query</div>'+
'<pre class="ss-sync-query">{{job.query}}</pre>'+
'<p class="ss-usage-note">Written all or none. Records with no counterpart in the target '+
'are created rather than skipped. Lookup fields are not carried across: they hold Ids '+
'belonging to the source org.</p>'+
'</div>'+

'<div ng-if="job.kind !== \'data\'">'+
'<div class="ss-sync-detail-head">Components ({{job.components.length}})</div>'+
'<div class="ss-sync-chips">'+
'<span class="ss-sync-chip" ng-repeat="c in job.components | limitTo:60">'+
'{{c.type}} {{c.name}}</span>'+
'</div>'+
'<p class="ss-about-sub" ng-if="job.components.length > 60">'+
'and {{job.components.length - 60}} more.</p>'+
'</div>'+

'</div>';

this.syncjobdetail = '<div class="ss-sync-detail">'+

/* The same block the review modal shows, rendered from one template so the
 * two cannot come to disagree about what a job carries. */
'<syncjobcarries></syncjobcarries>'+

/* Per-record refusals, which read the same way component failures do: what
 * the org said, against the row it said it about. */
'<div class="ss-sync-detail-head" ng-if="job.error.records.length">'+
'What the org refused</div>'+
'<p class="ss-about-sub" ng-if="job.error.detail">{{job.error.detail}}</p>'+
'<table class="ss-usage-table" ng-if="job.error.records.length">'+
'<tr ng-repeat="r in job.error.records | limitTo:50">'+
'<td><span class="ss-usage-feature-name">{{r.key || \'row \' + (r.index + 1)}}</span>'+
'<div class="ss-about-sub">{{r.message}}<span ng-if="r.fields"> ({{r.fields}})</span></div>'+
'</td></tr>'+
'</table>'+

'<div class="ss-sync-detail-head" ng-if="job.error.failures.length">'+
'What the org refused</div>'+
'<table class="ss-usage-table" ng-if="job.error.failures.length">'+
'<tr ng-repeat="f in job.error.failures | limitTo:50">'+
'<td><span class="ss-usage-feature-name">{{f.type}} {{f.name}}</span>'+
'<div class="ss-about-sub">{{f.problem}}<span ng-if="f.line"> (line {{f.line}})</span></div>'+
'</td></tr>'+
'</table>'+

'<div class="ss-sync-detail-head">History</div>'+
/*
 * Grouped by attempt, because a job retried twice keeps every line of all
 * three runs and flat they read as the same sentences repeated with no seam.
 * Records written before attempts were stamped come back as one unlabelled
 * group and render exactly as they always did.
 */
'<div ng-repeat="g in job.historyGroups">'+
'<div class="ss-sync-attempt" ng-if="g.label">{{g.label}}</div>'+
'<table class="ss-usage-table">'+
'<tr ng-repeat="h in g.entries">'+
'<td>{{h.note}}</td>'+
'<td class="ss-usage-col-right ss-about-sub">{{h.at | date:\'d MMM HH:mm\'}}</td>'+
'</tr>'+
'</table>'+
'</div>'+
'</div>';

this.bulkjobs = '<div class="ss-usage" ng-show="selectedMetadata.value == \'BulkJobs\'">'+
'<div class="ss-usage-api">'+
'<h4>Bulk API Job Status</h4>'+
'<p class="ss-usage-lead">Recent Bulk API 2.0 jobs - loads and extracts together. '+
'Pick one to see what happened to it.</p>'+

'<div class="ss-bulk-bar">'+
'<button class="viewasdifferentuser ss-btn-sm" ng-click="loadBulkJobs()" '+
'ng-disabled="bulk.loading">{{bulk.loading ? \'Reading\u2026\' : \'Refresh\'}}</button>'+

// The list is the recent ones. An id from a log or a ticket is usually older
// than that, and without this the only way to look at it is a REST call.
'<span class="ss-bulk-or">or</span>'+
'<input class="ss-bulk-lookup" type="text" ng-model="bulk.lookupId" spellcheck="false" '+
'placeholder="Paste a job id" ng-keydown="$event.keyCode === 13 && lookupBulkJob()"/>'+
'<button class="ss-desc-link" ng-click="lookupBulkJob()">Look up</button>'+
'</div>'+

'<p class="ss-bulk-hint" ng-show="bulk.lookupError">{{bulk.lookupError}}</p>'+

'<p class="ss-rest-error" ng-show="bulk.error">{{bulk.error}}</p>'+

'<p class="ss-usage-lead" ng-show="!bulk.loading && !bulk.jobs.length && !bulk.error">'+
'No Bulk API 2.0 jobs in this org yet. Data Loader in bulk mode and most ETL '+
'tools create them; the Setup page lists the older v1 jobs instead.</p>'+

// Shown for a looked-up id too, which has no row in the list behind it.
'<div class="ss-bulk" ng-show="bulk.jobs.length || bulk.selected || bulk.detailError">'+

'<table class="ss-integrator-table ss-bulk-list" ng-show="bulk.jobs.length">'+
'<tr><th>Job</th><th>Object</th><th>Operation</th><th>State</th><th>Created</th></tr>'+
'<tr ng-repeat="job in bulk.jobs track by job.id" ng-click="selectBulkJob(job)" '+
'ng-class="{\'is-picked\': bulk.selected.id === job.id}" title="{{job.id}}">'+
// The id is what identifies a job everywhere else - in a log, in a ticket, in
// a colleague's message - so it is the first column rather than a tooltip.
'<td class="ss-bulk-id">{{job.id}}<em>{{job.kind}}</em></td>'+
'<td>{{job.object}}</td>'+
'<td>{{job.operation}}</td>'+
'<td><span class="ss-bulk-state" ng-class="bulkStateClass(job.state)">{{job.state}}</span></td>'+
'<td class="ss-watch-dim">{{job.createdDate | date:\'MMM d, y h:mm a\'}}</td>'+
'</tr>'+
'</table>'+

'<div class="ss-bulk-detail" ng-show="bulk.selected || bulk.detailError">'+
'<div class="ss-bulk-detail-head" ng-show="bulk.selected"><b>{{bulk.selected.id}}</b>'+
'<span class="ss-bulk-kind" ng-show="bulk.selected.kind">{{bulk.selected.kind}}</span>'+
'<span class="ss-bulk-state" ng-class="bulkStateClass(bulk.detail.state)" '+
'ng-show="bulk.detail">{{bulk.detail.state}}</span></div>'+

'<p class="ss-usage-lead" ng-show="bulk.detailLoading">Reading the job\u2026</p>'+
'<p class="ss-rest-error" ng-show="bulk.detailError">{{bulk.detailError}}</p>'+

'<div ng-show="bulk.detail && !bulk.detailLoading">'+
// The three numbers people came for, before the rest of the record.
'<div class="ss-bulk-tiles">'+
'<div class="ss-pkg-tile"><span class="ss-pkg-tile-n">{{bulkSucceeded(bulk.detail)}}</span>'+
'<span class="ss-pkg-tile-l">succeeded</span></div>'+
'<div class="ss-pkg-tile" ng-class="{\'ss-pkg-tile-warn\': bulk.detail.numberRecordsFailed}">'+
'<span class="ss-pkg-tile-n">{{bulk.detail.numberRecordsFailed || 0}}</span>'+
'<span class="ss-pkg-tile-l">failed</span></div>'+
'<div class="ss-pkg-tile"><span class="ss-pkg-tile-n">{{bulk.detail.numberRecordsProcessed || 0}}</span>'+
'<span class="ss-pkg-tile-l">processed</span></div>'+
'</div>'+

'<p class="ss-rest-error" ng-show="bulk.detail.errorMessage">{{bulk.detail.errorMessage}}</p>'+

'<table class="ss-integrator-table ss-bulk-facts">'+
'<tr><td>Object</td><td>{{bulk.detail.object}}</td></tr>'+
'<tr><td>Operation</td><td>{{bulk.detail.operation}}</td></tr>'+
'<tr ng-show="bulk.detail.externalIdFieldName"><td>External id field</td>'+
'<td>{{bulk.detail.externalIdFieldName}}</td></tr>'+
'<tr><td>Created</td><td>{{bulk.detail.createdDate | date:\'MMM d, y h:mm:ss a\'}}</td></tr>'+
'<tr><td>Last change</td><td>{{bulk.detail.systemModstamp | date:\'MMM d, y h:mm:ss a\'}}</td></tr>'+
'<tr ng-show="bulk.detail.totalProcessingTime"><td>Processing time</td>'+
'<td>{{bulk.detail.totalProcessingTime}} ms</td></tr>'+
'<tr ng-show="bulk.detail.apexProcessingTime"><td>Apex time</td>'+
'<td>{{bulk.detail.apexProcessingTime}} ms</td></tr>'+
'<tr><td>API version</td><td>{{bulk.detail.apiVersion}}</td></tr>'+
'<tr ng-show="bulk.detail.retries"><td>Retries</td><td>{{bulk.detail.retries}}</td></tr>'+
'</table>'+
'</div>'+
'</div>'+

'</div>'+
'</div>'+
'</div>';

/*
 * REST Explorer.
 *
 * A method, a path and a body. The path is a path and not a URL on purpose -
 * see restUrl: a box that took a URL would send this org's session wherever
 * it was pointed, and the first mistyped host would be a credential leak
 * rather than a 404.
 */
/*
 * The Trace Explorer.
 *
 * Graph, timeline and replay over one event graph. The three are views of the
 * same thing and share one selection: clicking a node in the graph highlights
 * its bar in the timeline and opens it in the inspector, because they are the
 * same event and treating them as three separate lists is how this kind of
 * screen becomes unusable.
 *
 * Nodes are absolutely-positioned HTML and edges are one SVG layer beneath
 * them. Both could be SVG, and that would be the obvious choice - but Angular
 * 1's jqLite clones ng-repeat templates without reliably preserving the SVG
 * namespace, and a namespace-less <g> renders as nothing at all, silently. The
 * edges are a single ng-repeat over pre-computed path strings, which is the
 * one shape of that problem that does work, and the node bodies get HTML
 * layout and text wrapping for free.
 *
 * ng-show rather than ng-if, matching every other panel in the body: these are
 * plain templates on the one controller, so there is no nested controller here
 * to be constructed early - which is what ng-if guards against in
 * panel_compiles.
 */
this.eventgraph = '<div class="ss-eg" ng-show="selectedMetadata.value == \'EventGraph\'">'+

/* ---- What to trace ------------------------------------------------- */
'<div class="ss-usage-api">'+
'<h4>Event Graph</h4>'+
'<p class="ss-usage-lead">What actually happened - reconstructed from what this org '+
'and this browser can be asked, with every link showing how far it can be trusted.</p>'+

'<div class="ss-eg-roots">'+
'<button class="ss-eg-root" ng-repeat="option in egRootOptions track by $index" '+
'ng-click="egTrace(option)" ng-class="{\'is-active\': eg.root.kind === option.kind && eg.root.id === option.id}" '+
'title="{{option.detail}}">'+
'<span class="ss-eg-root-label">{{option.label}}</span>'+
'<span class="ss-eg-root-detail">{{option.detail}}</span>'+
'</button>'+
'</div>'+

'<div class="ss-eg-manual">'+
'<select ng-model="eg.manualKind" ng-options="k.value as k.label for k in egRootKinds"></select>'+
'<input type="text" ng-model="eg.manualId" spellcheck="false" '+
'placeholder="Id, name or trace id" ng-keydown="$event.keyCode === 13 && egTraceManual()"/>'+
'<button class="viewasdifferentuser ss-btn-sm" ng-click="egTraceManual()" '+
'ng-disabled="eg.loading">{{eg.loading ? \'Collecting…\' : \'Trace\'}}</button>'+
'</div>'+

/* How far to walk. Only meaningful for a record, which is the only root that
 * has relationships to walk. */
'<div class="ss-eg-manual" ng-show="eg.manualKind === \'record\' || eg.root.kind === \'record\'">'+
'<label class="ss-eg-depth-label">Follow</label>'+
'<select ng-model="eg.depth" ng-change="egSetDepth()" '+
'ng-options="d.value as d.label for d in egDepths"></select>'+
'<label class="ss-checkbox-label"><input type="checkbox" ng-model="eg.includeHistory" '+
'ng-change="egSetDepth()"><span>Field history where tracked</span></label>'+
'</div>'+

'<p class="ss-eg-collected" ng-show="eg.collected.records">'+
'Walked <b>{{eg.collected.records}}</b> record(s) and found <b>{{eg.collected.links}}</b> '+
'lookup link(s). Every link below that came from a lookup field is confirmed - '+
'the org holds it, so nothing about it is guessed.</p>'+

/* ---- What is in here, and what to leave out ------------------------ */
/*
 * The objects found, with counts, each one togglable. Built from what the
 * walk actually reached rather than from a list of objects assumed to be
 * noisy: which object floods a graph is a fact about the org, and an org
 * that runs on Tasks needs the ones another org would exclude first.
 */
'<div class="ss-eg-objects" ng-show="eg.inventory.length">'+
'<div class="ss-eg-objects-head">'+
'<span>Objects in this graph - click one to leave it out</span>'+
'<button class="ss-eg-mini" ng-click="egClearExclusions()" '+
'ng-show="eg.excluded.length">Include all</button>'+
'</div>'+
'<div class="ss-eg-object-list">'+
'<button class="ss-eg-object" ng-repeat="item in eg.inventory track by item.name" '+
'ng-click="egToggleObject(item.name)" ng-class="{\'is-excluded\': item.excluded}" '+
'title="{{item.excluded ? \'Excluded - click to include again\' : item.count + \' record(s), \' + item.events + \' event(s). Click to leave this object out.\'}}">'+
'<span class="ss-eg-object-name">{{item.name}}</span>'+
'<span class="ss-eg-object-count">{{item.count}}</span>'+
'</button>'+
'</div>'+

/*
 * Hiding is instant; not fetching needs the walk run again. Said plainly,
 * because the difference is the whole point on a large org - one saves the
 * screen, the other saves the queries.
 */
'<p class="ss-eg-objects-note" ng-show="eg.excludedStale">'+
'Hidden from the drawing. They are still being fetched - '+
'<button class="ss-eg-link-btn" ng-click="egRewalk()">walk again</button> '+
'to stop querying them, which is what makes a large org quick.</p>'+

/*
 * What was not followed, folded away.
 *
 * On a wide object this is the longest thing on the panel and the least
 * urgent: it is mostly relationships the user excluded on purpose, listed
 * back at them. It stays reachable because the other half - relationships
 * dropped because the budget ran out - is the explanation for a graph that
 * looks smaller than expected, and a graph that is quietly partial is worse
 * than one that says so. So the count is always visible and the list is one
 * click away.
 */
'<div class="ss-eg-objects-note" ng-show="eg.skipped.length">'+
'<button class="ss-eg-link-btn" ng-click="egToggleSkipped()">'+
'{{eg.showSkipped ? \'▾\' : \'▸\'}} '+
'{{eg.skipped.length}} relationship(s) not followed</button>'+

'<div class="ss-eg-skipped-list" ng-show="eg.showSkipped">'+
'<p class="ss-eg-skipped-lead">Click one to follow it anyway. A standard object '+
'carries around a hundred relationships and only the first '+
'{{eg.budget < 0 ? \'few\' : eg.budget}} are followed, so what you want may be '+
'further down the list than the limit reaches.</p>'+

'<button class="ss-eg-unfollowed" ng-repeat="skip in eg.skipped track by skip.objectName" '+
'ng-click="egIncludeObject(skip.objectName)" ng-disabled="skip.reason === \'excluded\'" '+
'ng-class="{\'is-excluded\': skip.reason === \'excluded\'}" '+
'title="{{skip.reason === \'excluded\' ? \'You excluded this - include it from the object list above\' : \'Follow this relationship as well\'}}">'+
'<span class="ss-eg-unfollowed-name">{{skip.objectName}}</span>'+
'<em>{{skip.reason === \'excluded\' ? \'excluded\' : \'+ follow\'}}</em>'+
'</button>'+

/* Pinned objects, so an exemption can be taken back. Kept beside the list it
 * was granted from rather than in the object chips above, where it would read
 * as an ordinary object rather than as an override. */
'<div class="ss-eg-pinned" ng-show="eg.included.length">'+
'<b>Always followed:</b> '+
'<button class="ss-eg-unfollowed is-pinned" ng-repeat="name in eg.included track by name" '+
'ng-click="egIncludeObject(name)" title="Stop always following {{name}}">'+
'<span class="ss-eg-unfollowed-name">{{name}}</span><em>&times;</em></button>'+
'</div>'+

/* The wholesale answer, next to the per-object one. Labelled by cost: each
 * relationship is a query per record at that hop, so raising this is the most
 * expensive control on the panel. */
'<div class="ss-eg-budget">'+
'<label class="ss-eg-depth-label">Relationships followed</label>'+
'<select ng-model="eg.budget" ng-change="egSetBudget()" '+
'ng-options="b.value as b.label for b in egBudgets"></select>'+
'</div>'+

'</div>'+
'</div>'+
'</div>'+

'<p class="ss-eg-error" ng-show="eg.error">{{eg.error}}</p>'+
'</div>'+

/* ---- Everything below appears only once there is a trace ----------- */
'<div ng-show="eg.built">'+

/* Summary strip */
'<div class="ss-eg-summary">'+
'<span class="ss-eg-chip"><b>{{eg.stats.shown}}</b> shown<em ng-show="eg.stats.reached > eg.stats.shown"> of {{eg.stats.reached}}</em></span>'+
'<span class="ss-eg-chip" ng-show="eg.stats.groups"><b>{{eg.stats.groups}}</b> grouped</span>'+
'<span class="ss-eg-chip is-bad" ng-show="eg.stats.failures"><b>{{eg.stats.failures}}</b> failed</span>'+
'<span class="ss-eg-chip" ng-repeat="band in egConfidenceBands track by band.key" '+
'ng-class="\'is-\' + band.key" title="{{band.hint}}"><b>{{band.count}}</b> {{band.label}}</span>'+
'<span class="ss-eg-chip is-quiet" ng-show="eg.elapsed">{{eg.elapsed}}</span>'+
'</div>'+

/* Views - projections of the one graph, never separate queries */
'<div class="ss-eg-views">'+
'<button class="ss-eg-view" ng-repeat="view in egViews track by view.key" '+
'ng-click="egSetView(view.key)" ng-class="{\'is-active\': eg.view === view.key}" '+
'title="{{view.hint}}">{{view.label}}</button>'+
'<span class="ss-eg-view-note" ng-show="eg.stats.hiddenByView">'+
'{{eg.stats.hiddenByView}} step(s) hidden by this view - the links across them are '+
'drawn dashed and marked as spanning what is not shown.</span>'+
'</div>'+

/* Filters */
'<div class="ss-eg-filters">'+
'<input class="ss-eg-search" type="text" ng-model="eg.filter.text" ng-change="egRefresh()" '+
'placeholder="Search this trace..." spellcheck="false"/>'+
'<label class="ss-checkbox-label"><input type="checkbox" ng-model="eg.filter.failuresOnly" '+
'ng-change="egRefresh()"><span>Failures only</span></label>'+
'<label class="ss-checkbox-label"><input type="checkbox" ng-model="eg.filter.slowOnly" '+
'ng-change="egRefresh()"><span>Slow (&gt;500ms)</span></label>'+
'<label class="ss-checkbox-label"><input type="checkbox" ng-model="eg.grouping" '+
'ng-change="egRefresh()"><span>Group repeats</span></label>'+
'<select ng-model="eg.filter.minConfidence" ng-change="egRefresh()" '+
'title="Hide links weaker than this">'+
'<option value="UNKNOWN">Any confidence</option>'+
'<option value="INFERRED">Inferred and better</option>'+
'<option value="LIKELY">Likely and better</option>'+
'<option value="CONFIRMED">Confirmed only</option>'+
'</select>'+
'<button class="ss-eg-mini" ng-click="egClearFilters()">Clear</button>'+

/*
 * Export. The picture is redrawn rather than screenshotted, so what comes out
 * carries no panel styling - see ss-export.js. JSON is listed first on
 * purpose: it is the only one that carries the evidence and the gaps, and so
 * the only one somebody can check a conclusion against.
 */
'<span class="ss-eg-export">'+
'<span class="ss-eg-export-label">Export</span>'+
'<button class="ss-eg-mini" ng-click="egExportJson()" '+
'title="The whole graph - every event, every relationship with its evidence, and the gaps">JSON</button>'+
'<button class="ss-eg-mini" ng-click="egExportSvg()" '+
'title="Vector image, opens anywhere">SVG</button>'+
'<button class="ss-eg-mini" ng-click="egExportPng()" '+
'title="Image at 2x, for pasting into a document">PNG</button>'+
'<button class="ss-eg-mini" ng-click="egExportPdf()" '+
'title="Vector PDF with selectable text">PDF</button>'+
'</span>'+
'</div>'+
'<p class="ss-eg-error" ng-show="eg.exportError">{{eg.exportError}}</p>'+

/* ---- Replay -------------------------------------------------------- */
'<div class="ss-eg-replay">'+
'<button class="ss-eg-play" ng-click="egTogglePlay()" '+
'title="{{eg.playing ? \'Pause\' : \'Play the recorded journey\'}}">'+
'{{eg.playing ? \'❚❚\' : \'▶\'}}</button>'+
'<button class="ss-eg-mini" ng-click="egStepBack()" title="Previous moment">◀❘</button>'+
'<button class="ss-eg-mini" ng-click="egStepForward()" title="Next moment">❘▶</button>'+
'<input class="ss-eg-scrub" type="range" min="0" max="1000" ng-model="eg.scrub" '+
'ng-change="egScrub()" title="Scrub the journey"/>'+
'<span class="ss-eg-clock">{{eg.clock}}</span>'+
'<select class="ss-eg-speed" ng-model="eg.speed" ng-change="egSetSpeed()" '+
'ng-options="s as (s + \'×\') for s in egSpeeds"></select>'+
'<button class="ss-eg-mini" ng-click="egJumpToFailure()" ng-show="eg.stats.failures" '+
'title="Jump to the first failure">First failure</button>'+
'<button class="ss-eg-mini" ng-click="egStopReplay()" ng-show="eg.replaying" '+
'title="Leave replay and show the whole journey again">Show all</button>'+
'<span class="ss-eg-parallel" ng-show="eg.parallel">{{eg.activeCount}} in flight</span>'+
'</div>'+
'<p class="ss-eg-replay-note">Replays the recording only. Nothing is re-executed: no '+
'callout is made, no record is written.'+
'<em ng-show="eg.compressed"> Long waits are compressed - marked on the timeline.</em></p>'+

/* ---- Graph and inspector ------------------------------------------- */
'<div class="ss-eg-stage">'+

'<div class="ss-eg-canvas" ng-class="{\'is-narrow\': eg.selected}">'+
'<div class="ss-eg-scroll">'+
'<div class="ss-eg-plane" ng-style="{width: eg.layout.width + \'px\', height: eg.layout.height + \'px\'}">'+

/* Edges beneath, one SVG layer. */
'<svg class="ss-eg-edges" ng-attr-width="{{eg.layout.width}}" ng-attr-height="{{eg.layout.height}}">'+
'<path ng-repeat="edge in eg.edgePaths track by edge.id" ng-attr-d="{{edge.d}}" '+
'class="ss-eg-edge" ng-class="[\'is-\' + edge.confidence, \'state-\' + edge.state, '+
'edge.bridged ? \'is-bridged\' : \'\', eg.selectedEdgeId === edge.id ? \'is-selected\' : \'\']" '+
'ng-click="egSelectEdge(edge)"></path>'+
'</svg>'+

/* Nodes above. */
'<div class="ss-eg-node" ng-repeat="item in eg.positions track by item.eventId" '+
'ng-style="{left: item.x + \'px\', top: item.y + \'px\'}" '+
'ng-class="[egNodeClass(item.node), \'phase-\' + eg.nodeStates[item.eventId], '+
'eg.selectedId === item.eventId ? \'is-selected\' : \'\']" '+
'ng-click="egSelect(item.node)" title="{{egNodeTitle(item.node)}}">'+
'<span class="ss-eg-node-kind">{{egNodeKind(item.node)}}</span>'+
'<span class="ss-eg-node-label">{{egNodeLabel(item.node)}}</span>'+
'<span class="ss-eg-node-meta">'+
'<em ng-show="item.node.duration">{{egMs(item.node.duration)}}</em>'+
'<em class="ss-eg-node-via" ng-show="egReachedVia(item.node)">{{egReachedVia(item.node)}}</em>'+
'<em class="ss-eg-node-count" ng-show="item.node.isGroup" '+
'ng-click="egExpandGroup(item.node); $event.stopPropagation()">expand</em>'+
'</span>'+
'<span class="ss-eg-node-flag" ng-show="item.node.state === \'inferred\'" '+
'title="This event was not observed - it is reconstructed">inferred</span>'+
'</div>'+

'</div>'+
'</div>'+
/* Two different emptinesses, and telling them apart matters: a view with
 * nothing of its kind in the trace is a fact about the trace, while an empty
 * filtered result is something the user just did to themselves. */
'<p class="ss-eg-empty" ng-show="!eg.positions.length">'+
'{{eg.emptyReason || \'Nothing matches these filters.\'}}</p>'+
'</div>'+

/* Inspector */
'<div class="ss-eg-inspector" ng-show="eg.selected">'+
'<div class="ss-eg-inspector-head">'+
'<b>{{eg.selected.action || eg.selected.typeLabel}}</b>'+
'<button class="ss-eg-mini" ng-click="egCloseInspector()">Close</button>'+
'</div>'+

'<table class="ss-eg-facts">'+
'<tr><td>Type</td><td>{{eg.selected.eventType}}</td></tr>'+
'<tr ng-show="eg.selected.actor"><td>Actor</td>'+
'<td>{{eg.selected.actor.name}} <em class="ss-eg-quiet">{{eg.selected.actor.kind}}</em>'+
'<em class="ss-eg-quiet" ng-show="eg.selected.actor.onBehalfOf"> for {{eg.selected.actor.onBehalfOf}}</em></td></tr>'+
'<tr><td>When</td><td>{{eg.selected.timestampIso}}</td></tr>'+
'<tr ng-show="eg.selected.duration"><td>Duration</td><td>{{egMs(eg.selected.duration)}}</td></tr>'+
'<tr ng-show="eg.selected.component"><td>Component</td>'+
'<td>{{eg.selected.component.name}} <em class="ss-eg-quiet">{{eg.selected.component.kind}}</em></td></tr>'+
'<tr ng-show="eg.selected.entity"><td>Record</td>'+
'<td><a ng-show="eg.selected.entity.id" ng-href="{{egRecordUrl(eg.selected)}}" target="_blank">'+
'{{eg.selected.entity.name || eg.selected.entity.id}}</a>'+
'<span ng-show="!eg.selected.entity.id">{{eg.selected.entity.type}}</span></td></tr>'+
'<tr><td>Status</td><td><span class="ss-eg-status" ng-class="\'is-\' + eg.selected.status">'+
'{{eg.selected.status}}</span></td></tr>'+

/* Provenance, stated plainly - the field that decides how much of the rest to believe. */
'<tr><td>Source</td><td><span class="ss-eg-prov" ng-class="\'is-\' + eg.selected.source.kind">'+
'{{egProvenance(eg.selected.source.kind)}}</span>'+
'<em class="ss-eg-quiet" ng-show="eg.selected.source.system"> · {{eg.selected.source.system}}</em>'+
'<em class="ss-eg-quiet" ng-show="eg.selected.corroboratedBy.length"> · also seen by '+
'{{eg.selected.corroboratedBy.join(\', \')}}</em></td></tr>'+
'<tr><td>State</td><td>{{eg.selected.state}}</td></tr>'+
'</table>'+

'<div class="ss-eg-error-box" ng-show="eg.selected.error">'+
'<b>{{eg.selected.error.code}}</b> {{eg.selected.error.message}}</div>'+

'<div class="ss-eg-payload" ng-show="eg.selectedInput">'+
'<div class="ss-eg-payload-head">Request</div>'+
'<pre>{{eg.selectedInput}}</pre></div>'+
'<div class="ss-eg-payload" ng-show="eg.selectedOutput">'+
'<div class="ss-eg-payload-head">Response</div>'+
'<pre>{{eg.selectedOutput}}</pre></div>'+

/* What was taken out, and why - an inspector showing "[redacted]" with no
 * account of what was there is indistinguishable from an empty payload. */
'<div class="ss-eg-redactions" ng-show="eg.selected.privacy.redactions.length">'+
'<b>{{eg.selected.privacy.redactions.length}} field(s) redacted before storage:</b> '+
'<span ng-repeat="cut in eg.selected.privacy.redactions track by $index">'+
'{{cut.path}} <em>({{cut.classification}})</em><span ng-show="!$last">, </span></span>'+
'</div>'+

/* Group members */
'<div class="ss-eg-members" ng-show="eg.selected.isGroup">'+
'<div class="ss-eg-payload-head">{{eg.selected.count}} events in this group</div>'+
'<table class="ss-eg-member-table">'+
'<tr ng-repeat="member in eg.selected.members track by member.eventId" '+
'ng-click="egSelect(member)" ng-class="{\'is-bad\': member.status === \'failure\'}">'+
'<td>{{member.action || member.typeLabel}}</td>'+
'<td>{{member.metadata.statusCode || member.status}}</td>'+
'<td>{{egMs(member.duration)}}</td></tr>'+
'</table></div>'+

/* Why this node is here at all */
'<div class="ss-eg-why" ng-show="eg.selectedEvidence.length">'+
'<div class="ss-eg-payload-head">How this connects</div>'+
'<div class="ss-eg-why-row" ng-repeat="link in eg.selectedEvidence track by $index">'+
'<span class="ss-eg-conf" ng-class="\'is-\' + link.confidence">{{link.confidenceLabel}}</span>'+
'<span class="ss-eg-why-what"><b>{{link.type}}</b> {{link.direction}} {{link.other}}</span>'+
'<ul class="ss-eg-why-evidence"><li ng-repeat="item in link.evidence track by $index">'+
'{{item.detail}}</li></ul>'+
'</div></div>'+

'<div class="ss-eg-actions">'+
'<button class="ss-eg-mini" ng-click="egAsk(\'whyFailed\', eg.selected.eventId)" '+
'ng-show="eg.selected.status === \'failure\'">Why did this fail?</button>'+
'<button class="ss-eg-mini" ng-click="egAsk(\'whatTriggered\', eg.selected.eventId)">What triggered this?</button>'+
'<button class="ss-eg-mini" ng-show="eg.selected.entity.id" '+
'ng-click="egFollowRecord(eg.selected)">Follow this record</button>'+
'<button class="ss-eg-mini" ng-click="egFocus(eg.selected)">Focus this branch</button>'+
'</div>'+

'</div>'+
'</div>'+

/* ---- Timeline ------------------------------------------------------ */
'<div class="ss-eg-timeline">'+
'<div class="ss-eg-payload-head">Timeline</div>'+
'<div class="ss-eg-timeline-plane" ng-style="{height: (eg.timeline.lanes * 22 + 12) + \'px\'}">'+
'<div class="ss-eg-gap-mark" ng-repeat="skip in eg.timeline.skips track by $index" '+
'ng-style="{left: skip.left + \'px\'}" '+
'title="{{egMs(skip.realMs)}} of waiting, compressed">✂</div>'+
'<div class="ss-eg-bar" ng-repeat="row in eg.timeline.rows track by row.eventId" '+
'ng-style="{left: row.left + \'px\', width: row.width + \'px\', top: (row.lane * 22) + \'px\'}" '+
'ng-class="[egNodeClass(row.node), \'phase-\' + eg.nodeStates[row.eventId], '+
'eg.selectedId === row.eventId ? \'is-selected\' : \'\']" '+
'ng-click="egSelect(row.node)" title="{{egNodeTitle(row.node)}}">'+
'<span>{{egNodeLabel(row.node)}}</span></div>'+
'<div class="ss-eg-playhead" ng-style="{left: eg.playheadPx + \'px\'}"></div>'+
'</div>'+
'</div>'+

/* ---- Answers ------------------------------------------------------- */
'<div class="ss-eg-answer" ng-show="eg.answer">'+
'<div class="ss-eg-payload-head">{{eg.answer.question}}</div>'+
'<p class="ss-eg-answer-text">{{eg.answer.answer}}</p>'+
'<div class="ss-eg-answer-cites" ng-show="eg.answer.citations.length">'+
'<b>Derived from {{eg.answer.citations.length}} event(s):</b> '+
'<button class="ss-eg-cite" ng-repeat="cite in eg.answer.citations track by cite.eventId" '+
'ng-click="egSelectById(cite.eventId)" title="{{cite.at}} · {{cite.source}}">'+
'{{cite.what}}</button></div>'+
'<ul class="ss-eg-answer-gaps" ng-show="eg.answer.gaps.length">'+
'<li ng-repeat="gap in eg.answer.gaps track by $index">{{gap}}</li></ul>'+
'</div>'+

'<div class="ss-eg-questions">'+
'<button class="ss-eg-mini" ng-click="egAsk(\'summarize\')">Summarise this journey</button>'+
'<button class="ss-eg-mini" ng-click="egAsk(\'slowest\')">What caused the latency?</button>'+
'<button class="ss-eg-mini" ng-show="eg.root.kind === \'record\'" '+
'ng-click="egAsk(\'whoChanged\', eg.root.id)">Who changed this record?</button>'+
'</div>'+

/* ---- Following a business entity ----------------------------------- */
'<div class="ss-eg-chain" ng-show="eg.chain.length">'+
'<div class="ss-eg-payload-head">Followed across records</div>'+
'<div class="ss-eg-chain-row">'+
'<span class="ss-eg-chain-link" ng-repeat="link in eg.chain track by $index" '+
'ng-class="{\'is-bad\': link.failed}" ng-click="egSelectById(link.events[0].eventId)">'+
'<b>{{link.entity.type || \'Record\'}}</b>'+
'<em>{{link.entity.name || link.entity.id}}</em>'+
'<span class="ss-eg-conf" ng-class="\'is-\' + link.confidence">{{link.confidence}}</span>'+
'</span></div></div>'+

/* ---- What nothing could see ---------------------------------------- */
'<div class="ss-eg-gaps" ng-show="eg.gaps.length">'+
'<div class="ss-eg-payload-head">What this trace cannot show</div>'+
'<p class="ss-eg-gaps-lead">These sources were not available, so anything that would '+
'only appear in them is missing rather than absent.</p>'+
'<div class="ss-eg-gap" ng-repeat="gap in eg.gaps track by gap.id">'+
'<b>{{gap.label}}</b><span>{{gap.missing}}</span></div>'+
'</div>'+

'<div class="ss-eg-problems" ng-show="eg.problems.length">'+
'<div class="ss-eg-payload-head">Sources that could not be read</div>'+
'<div class="ss-eg-problem" ng-repeat="problem in eg.problems track by $index">'+
'<b>{{problem.source}}</b> {{problem.message}}</div>'+
'</div>'+

'</div>'+

/* ---- External telemetry -------------------------------------------- */
'<div class="ss-usage-api">'+
'<h4>Bring in external telemetry</h4>'+
'<p class="ss-usage-lead">Anything outside Salesforce - a payment gateway, an ERP, an '+
'agent run - can be added to this graph by submitting events with a shared '+
'<code>traceId</code>. Submitted events are always marked as external.</p>'+
'<textarea class="ss-eg-ingest" ng-model="eg.ingestText" spellcheck="false" '+
'placeholder=\'{"events":[{"traceId":"txn-9001","eventType":"PAYMENT_COMPLETED",'+
'"timestamp":"2026-08-17T10:42:03Z","source":"Stripe","status":"success"}]}\'></textarea>'+
'<div class="ss-eg-ingest-row">'+
'<button class="viewasdifferentuser ss-btn-sm" ng-click="egIngest()">Add to graph</button>'+
'<span class="ss-eg-ingest-result" ng-show="eg.ingestResult">{{eg.ingestResult}}</span>'+
'</div>'+
'</div>'+

'</div>';

this.restexplorer = '<div class="ss-usage" ng-show="selectedMetadata.value == \'RestExplorer\'">'+
'<div class="ss-usage-api">'+
'<h4>REST Explorer</h4>'+
'<p class="ss-usage-lead">Send a call to this org and read the answer. '+
'Paths only - it always goes to the org you are signed in to.</p>'+

'<div class="ss-rest-bar">'+
'<select class="ss-rest-method" ng-model="rest.method" '+
'ng-options="m as m for m in restMethods"></select>'+
'<input class="ss-rest-path" type="text" ng-model="rest.path" spellcheck="false" '+
'placeholder="/services/data/v{{apiVersion}}/limits" '+
'ng-keydown="$event.keyCode === 13 && sendRest()"/>'+
'<button class="viewasdifferentuser ss-btn-sm ss-rest-send" ng-click="sendRest()" '+
'ng-disabled="rest.running">{{rest.running ? \'Sending\u2026\' : \'Send\'}}</button>'+
'</div>'+

// Only where it means something. A body on a GET is not sent, so a box for
// one would be a promise the request does not keep.
'<textarea class="ss-rest-body" ng-show="restTakesBody()" ng-model="rest.body" '+
'spellcheck="false" placeholder=\'{ "Name": "Acme" }\'></textarea>'+

'<div class="ss-rest-samples">'+
'<span class="ss-rest-samples-label">Try:</span>'+
'<button class="ss-rest-sample" ng-repeat="sample in restSamples track by sample.label" '+
'ng-click="useRestSample(sample)" title="{{sample.method}} {{sample.path}}">'+
'{{sample.label}}</button>'+
'</div>'+

'<p class="ss-rest-error" ng-show="rest.error">{{rest.error}}</p>'+

'<div class="ss-rest-answer" ng-show="rest.status">'+
'<div class="ss-rest-status">'+
// The code first: it is the part that says whether to read the rest.
'<b ng-class="{\'is-bad\': rest.status >= 400}">{{rest.status}}</b>'+
'<span>{{rest.statusText}}</span>'+
'<span class="ss-rest-ms">{{rest.ms}} ms</span>'+
'<button class="ss-rest-copy" ng-click="copyRestResponse()">'+
'{{restCopied ? \'\u2713 Copied\' : \'\u29c9 Copy\'}}</button>'+
'</div>'+
'<pre class="ss-rest-response">{{rest.response}}</pre>'+
/*
 * The paths this answer mentions, as somewhere to go next.
 *
 * Under the response rather than inside it: a resource index has a
 * handful of links and would read well either way, but /sobjects names
 * every object in the org with a url apiece - and a thousand clickable
 * spans inside the body is a wall between the reader and the response,
 * not a convenience. Here they are a bounded row that can be ignored.
 */
'<div class="ss-rest-links" ng-show="rest.links.length">'+
'<span class="ss-rest-samples-label">Follow:</span>'+

/*
 * A filter, but only when there is more than fits.
 *
 * An answer with three links needs no box in front of it; one with four
 * hundred needs nothing else, because scanning a row of four hundred chips
 * is not how anybody finds the one they want.
 */
'<input class="ss-rest-link-filter" type="text" ng-model="rest.linkFilter" '+
'ng-show="rest.links.length > restLinkShown" spellcheck="false" '+
'placeholder="Filter {{rest.links.length}} paths\u2026"/>'+

/*
 * Filtered on the whole path, not the label: two children of different
 * parents can share a last segment, and the prefix is what tells them apart.
 * limitTo caps what renders; the count below says what that cap hid.
 */
'<button class="ss-rest-sample" '+
'ng-repeat="link in rest.links | filter:{path: rest.linkFilter} | limitTo:restLinkShown '+
'track by link.path" '+
'ng-click="followRestLink(link)" title="{{link.path}}">{{link.label}}</button>'+

/*
 * What is not on screen. Truncating quietly is the version of this that
 * looks tidy and lies - somebody scanning for a path that is genuinely
 * there would conclude the answer does not mention it.
 */
'<span class="ss-rest-link-more" ng-show="restLinksOverflow()">'+
'+{{restLinksMatching() - restLinkShown}} more'+
'<span ng-show="!rest.linkFilter"> \u2013 type to narrow</span></span>'+

'<span class="ss-rest-link-more" ng-show="rest.linkFilter && !restLinksMatching()">'+
'nothing matches</span>'+

'<span class="ss-rest-link-more" ng-show="rest.links.truncated">'+
'first {{rest.links.length}} only</span>'+
'</div>'+
'</div>'+

'</div>'+
'</div>';

this.truststatus = '<div class="ss-usage" ng-show="selectedMetadata.value == truststatus">'+
'<div class="ss-usage-api">'+
'<h4>Salesforce Trust Status</h4>'+
'<p class="ss-usage-lead" ng-show="trustStatus.key">Live service health for instance <b>{{trustStatus.key}}</b> <span ng-show="trustStatus.location">({{trustStatus.location}})</span>.</p>'+
'<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">'+
'<span ng-show="!trustStatus.loading && trustStatus.loaded" class="ss-trust-pill ss-trust-{{trustStatus.statusClass}}">{{trustStatus.statusLabel}}</span>'+
'<span ng-show="!trustStatus.loading && trustStatus.loaded" style="font-size:11px; color:#64748b;">Updated from <a class="ss-about-link" href="https://status.salesforce.com/instances/{{trustStatus.key}}" target="_blank" rel="noopener noreferrer">status.salesforce.com</a></span>'+
'<button ng-click="refreshTrustStatus()" ng-disabled="trustStatus.loading" class="viewasdifferentuser ss-btn-sm">'+
'<span ng-show="!trustStatus.loading">&#x21bb; Refresh</span>'+
'<span ng-show="trustStatus.loading">&#x23f3; Fetching...</span>'+
'</button>'+
'</div>'+
'<div ng-if="trustStatus.loading" class="loadingARILoading" style="margin:6px 0;"><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/ alt=""/><span class="loadingARI">Fetching {{trustStatus.key || "this org"}} service status...</span></div>'+
'<p ng-if="trustStatus.error" class="ss-trust-error">{{trustStatus.error}}</p>'+
'</div>'+

'<div class="ss-usage-api" ng-show="trustStatus.loaded && !trustStatus.incidents.length && !trustStatus.messages.length && !trustStatus.maintenances.length">'+
'<h4>No active events</h4>'+
'<p class="ss-usage-note" style="margin:0;">Nothing is reported for this instance: no incidents, no general messages, and no planned maintenance.</p>'+
'</div>'+

'<div class="ss-usage-api" ng-show="trustStatus.loaded && trustStatus.incidents.length">'+
'<h4>Incidents <span class="ss-trust-count">{{trustStatus.incidents.length}}</span></h4>'+
'<table class="ss-usage-table">'+
'<tr ng-repeat="incident in trustStatus.incidents">'+
'<td style="width:92px; vertical-align:top;"><span class="ss-trust-badge ss-trust-sev-{{incident.severity}}">{{incident.severity}}</span></td>'+
// The whole message, inline. It used to be truncated with the rest behind
// a hover tooltip - a black box over the panel that has to be aimed at to
// read, on the one page where the text is the point. The panel scrolls;
// there is no reason to hide it.
'<td><span class="ss-trust-message">{{incident.fullMessage}}</span>'+
'<div style="font-size:11px; color:#64748b; margin-top:3px;"><span ng-repeat="svc in incident.serviceKeys track by $index">{{svc}}{{$last ? "" : ", "}}</span>'+
'<span ng-show="incident.createdAt"> &middot; {{incident.createdAt | date:"MMM d, h:mm a"}}</span></div></td>'+
'</tr></table>'+
'</div>'+

'<div class="ss-usage-api" ng-show="trustStatus.loaded && trustStatus.messages.length">'+
'<h4>General Messages <span class="ss-trust-count">{{trustStatus.messages.length}}</span></h4>'+
'<table class="ss-usage-table">'+
'<tr ng-repeat="message in trustStatus.messages">'+
'<td style="width:92px; vertical-align:top;"><span class="ss-trust-badge ss-trust-sev-info">news</span></td>'+
'<td><b>{{message.subject}}</b><div style="font-size:12px; color:#334155; margin-top:2px;">{{message.body}}</div>'+
'<div style="font-size:11px; color:#64748b; margin-top:3px;">{{message.startDate | date:"MMM d, yyyy"}}<span ng-show="message.endDate"> &ndash; {{message.endDate | date:"MMM d, yyyy"}}</span></div></td>'+
'</tr></table>'+
'</div>'+

'<div class="ss-usage-api" ng-show="trustStatus.loaded && trustStatus.maintenances.length">'+
'<h4>Maintenances <span class="ss-trust-count">{{trustStatus.maintenances.length}}</span></h4>'+
'<table class="ss-usage-table">'+
'<tr ng-repeat="maintenance in trustStatus.maintenances">'+
'<td style="width:92px; vertical-align:top;"><span class="ss-trust-badge ss-trust-sev-maint">{{maintenance.type}}</span></td>'+
'<td><b>{{maintenance.name}}</b>'+
'<div style="font-size:11px; color:#64748b; margin-top:3px;">{{maintenance.plannedStartTime | date:"MMM d, h:mm a"}} &ndash; {{maintenance.plannedEndTime | date:"MMM d, h:mm a"}}<span ng-show="maintenance.status"> &middot; {{maintenance.status}}</span></div></td>'+
'</tr></table>'+
'</div>'+

'<p class="ss-usage-note" ng-show="trustStatus.maintenanceWindow">Scheduled maintenance window: {{trustStatus.maintenanceWindow}}.</p>'+
'</div>';

this.packagexmlfrequency ='<table ng-show="selectedMetadata.value == packagexml" Class="userlist"><tr><td colspan="2"><b>Selection Summary</b></td></tr><tr ng-repeat="metaFrequency in packageMetaDataFrequency track by $index">'+
' <td Class="tooltip-me td1" data-title="You have selected {{metaFrequency.Frequency}} {{metaFrequency.Type}} for package.xml">{{metaFrequency.Type}}</td><td class="td2">{{metaFrequency.Frequency}}</td>'+
'</tr></table>';

// Shown over the popup whenever there is no usable session. Orgs that lock
// sessions to the domain, or set HttpOnly on the session cookie, hide sid
// from document.cookie - the extension cannot read it and every query fails.
// Signing in through a Connected App gives an equivalent bearer token.
/*
 * Sign-in overlay, with the way out of a dead end.
 *
 * The shipped Connected App has to be reachable from the org signing in, and
 * plenty of orgs will not have it - Salesforce answers "External client app
 * is not installed in this org". The answer is to point the extension at a
 * Connected App the org does have, which the code could always do and the
 * overlay never offered: it rendered the button and the error and nothing
 * else, so an org in that position had no next step at all.
 */
/*
 * The overlay is dismissible.
 *
 * It used to be the only thing on screen with no session and no way past it,
 * so a user whose org will not give the extension a session - and who cannot
 * create a Connected App, which is most people who are not admins - had the
 * panel permanently sealed behind a form they could not complete. Closing it
 * hands the panel back; signedoutnotice then says what still works.
 */
this.signinoverlay = '<div class="ssSignInOverlay" ng-if="(!hasSession || signInRequested) && !signInDismissed">'+
'<div class="ssSignInCard" ng-class="{ssWide: showClientIdInput}">'+
'<button class="ssSignInClose" ng-click="dismissSignIn()" aria-label="Close" '+
'title="Close and carry on without signing in">&times;</button>'+
// Named, when there is a name. The standalone page opens on whichever org
// was used last, so with several known orgs the one it picked is often not
// the one in mind - and "Sign in to continue" gives no way to notice that.
/*
 * The org is named once, under "This org", where it is the answer to a
 * question the buttons ask. It was also in the title and twice more in the
 * paragraph below - four times on a card whose whole job is one decision, and
 * a my-domain host is long enough to wrap the title onto three lines.
 */
'<h3 ng-show="signInReason === \'add\'">Add another org</h3>'+
'<h3 ng-show="signInReason !== \'add\'">Sign in to continue</h3>'+
'<p class="ssSignInWhy" ng-show="signInReason === \'add\'">'+
'Sign in to the org you want to add. It joins the Org list, and you can switch '+
'between them from there - the one you are in now stays signed in.</p>'+
// The org this page chose is in the Org list above and under "This org"
// below; naming it again here would be the third time on one card.
'<p class="ssSignInWhy" ng-show="signInReason !== \'add\' && hasOrgLoginTarget() && isStandalonePage">'+
'Your browser is not signed in to the org this page is showing. Sign in below, '+
'or pick a different one from the Org list above.</p>'+
// Where the sign-in starts. Defaults to this org; the rest are for the
// cases the guess cannot cover - a sandbox whose host does not say so, or
// signing in to an org other than the one being browsed.
'<div class="ssLoginTargets">'+
'<button class="ssLoginTarget" ng-repeat="target in loginTargets" ng-class="{ssSelected: loginTarget === target.key}" ng-click="setLoginTarget(target.key)">{{target.label}}</button>'+
'</div>'+
'<p class="ssLoginHint" ng-show="loginTarget === \'org\' && hasOrgLoginTarget()">{{orgLoginOrigin()}}</p>'+
// No org to sign in to is a state, not a blank line: on the standalone page
// before one has been picked there is nothing for "This org" to mean.
'<p class="ssLoginHint" ng-show="loginTarget === \'org\' && !hasOrgLoginTarget()">No Salesforce org detected here - choose Production, Sandbox or Custom URL.</p>'+
'<input class="ssClientIdInput ssLoginCustom" ng-show="loginTarget === \'custom\'" type="text" ng-model="customLoginUrl" placeholder="https://your-domain.my.salesforce.com" spellcheck="false"/>'+

'<button class="ssSignInBtn" ng-click="signIn()" ng-disabled="signingIn">{{signingIn ? \'Opening Salesforce...\' : \'Sign in with Salesforce\'}}</button>'+
'<p class="ssSignInError" ng-show="signInError">{{signInError}}</p>'+

'<button class="ssSignInLink" ng-hide="showClientIdInput" ng-click="useOwnApp()">Use your org\'s own Connected App</button>'+

/*
 * The way in that needs no Setup access at all.
 *
 * A Connected App needs permissions plenty of users do not have, and the sid
 * readable on a Lightning host is not a valid API session - so for some orgs
 * this is the only door. The URL field is not a convenience: a session id is
 * a bearer credential, and where it gets sent is the whole security
 * boundary, which is why it is checked against Salesforce hosts before
 * anything is sent anywhere.
 */
/*
 * Kept visible while the own-app panel is open. An org refusing the shipped
 * app is precisely the case where the session id is the easiest way in - it
 * needs no Setup access at all - so hiding it behind the longer instructions
 * for making a Connected App had it disappear exactly when it was wanted.
 */
'<button class="ssSignInLink" ng-hide="showSessionIdInput" ng-click="useSessionId()">Sign in with a session id instead</button>'+

'<div class="ssSessionId" ng-show="showSessionIdInput">'+
'<p class="ssOwnAppLead">Use this when you cannot create a Connected App.</p>'+
/*
 * The old instruction pointed at Setup > Session Management, which lists
 * sessions but never shows their ids - so it sent people somewhere the value
 * could not be found. These two places actually have it.
 *
 * The Lightning warning is the one that matters: the sid on a
 * lightning.force.com domain is a UI session and is refused by the API, so
 * the obvious thing to copy is the thing that does not work.
 */
'<p class="ssOwnAppLead">Two ways to get one:<br/>'+
'<b>1.</b> Developer Console &rarr; Debug &rarr; Open Execute Anonymous, run '+
'<code>System.debug(UserInfo.getSessionId());</code> and read it from the log.<br/>'+
'<b>2.</b> Open your org on its <b>my.salesforce.com</b> address, then DevTools &rarr; '+
'Application &rarr; Cookies, and copy <code>sid</code>.</p>'+
'<p class="ssSessionIdNote"><b>Not</b> the sid from a <b>lightning.force.com</b> page - that one is a '+
'browser session and the API refuses it, which is the usual reason this does not work.</p>'+
'<label class="ssFieldLabel" for="ssSidUrl">Your org URL</label>'+
'<input class="ssClientIdInput" id="ssSidUrl" type="text" ng-model="sessionIdUrl" '+
'placeholder="https://your-domain.my.salesforce.com" spellcheck="false" autocomplete="off"/>'+
'<label class="ssFieldLabel" for="ssSidValue">Session id</label>'+
// type=password so it is not left legible on a shared or recorded screen.
'<input class="ssClientIdInput" id="ssSidValue" type="password" ng-model="sessionIdValue" '+
'placeholder="00D..." spellcheck="false" autocomplete="off"/>'+
'<p class="ssSessionIdNote">Kept in memory for this browser session only - never written to disk, '+
'and only ever sent to the org URL above.</p>'+
'<button class="ssSignInBtn" ng-click="signInWithSessionId()" ng-disabled="signingIn">'+
'{{signingIn ? \'Checking...\' : \'Sign in with session id\'}}</button>'+
'</div>'+

'<div class="ssOwnApp" ng-show="showClientIdInput">'+
'<p class="ssOwnAppLead">This org does not allow the app this extension ships with, which is normal for orgs that only permit their own.</p>'+

// The quick way, when the app has been packaged. Shown only if a package id
// is configured, so it can never be a link to nothing.
'<div class="ssInstallApp" ng-show="appInstallUrl()">'+
'<b>If you can install packages here</b>, this is one click: '+
'<a ng-href="{{appInstallUrl()}}" target="_blank" rel="noopener noreferrer">install the app in this org</a>, '+
'then come back and press Sign in. Nothing below is needed.'+
'</div>'+

'<p class="ssOwnAppLead">Otherwise, make one in Setup - it takes a minute - and paste its Consumer Key here.</p>'+
/*
 * Written against External Client Apps, which is what Setup offers now.
 *
 * Connected Apps are still there and still work, so the older path is named
 * in the same step rather than in a footnote - an org that has not been
 * switched over has no External Client App Manager to find, and a step that
 * names only the thing they cannot see is a dead end. The labels are the ones
 * Salesforce uses today; where it has renamed a setting, the reason it
 * matters is given too, so the step survives the next rename.
 */
'<ol class="ssOwnAppSteps">'+
'<li><a ng-href="{{setupUrl()}}" target="_blank" rel="noopener noreferrer">Open Setup</a> and find <b>External Client App Manager</b>, then <b>New External Client App</b>. Older orgs: <b>App Manager</b> &rarr; <b>New Connected App</b>.</li>'+
'<li>Name it, then open <b>API (Enable OAuth Settings)</b> and tick <b>Enable OAuth</b>.</li>'+
'<li>Set the <b>Callback URL</b> to exactly this:'+
'<span class="ssRedirect">{{redirectUrl}}</span>'+
'<button class="ssSignInLink" ng-click="copyRedirectUrl()">{{redirectCopied ? \'Copied\' : \'Copy\'}}</button>'+
'</li>'+
'<li>Add the <b>api</b> and <b>refresh_token</b> scopes.</li>'+
'<li>Under <b>Security</b>, leave <b>Require Proof Key for Code Exchange (PKCE)</b> on and turn <b>Require secret for Web Server Flow</b> off - a browser extension has nowhere safe to keep a secret, so it signs in with PKCE instead.</li>'+
'<li>Save, then open <b>Settings &rarr; OAuth Settings &rarr; Consumer Key and Secret</b> and copy the <b>Consumer Key</b> into the box below. Salesforce can take a few minutes to make a new app usable.</li>'+
'</ol>'+
'<input class="ssClientIdInput" type="text" ng-model="clientIdInput" placeholder="Paste your org\'s Consumer Key" spellcheck="false"/>'+
'<button class="ssSignInBtn" ng-click="signIn()" ng-disabled="signingIn || !clientIdInput">{{signingIn ? \'Opening Salesforce...\' : \'Save and sign in\'}}</button>'+
'</div>'+

// Spelt out as well as offered as the X, because the X alone reads as
// "close the extension" rather than "carry on without signing in".
'<button class="ssSignInLink ssSignInSkip" ng-click="dismissSignIn()">Carry on without signing in</button>'+

'</div>'+
'</div>';

/*
 * What is left once the sign-in overlay has been closed.
 *
 * Every metadata panel queries the org, so with no session they all come back
 * empty - and an empty panel with no explanation reads as a broken extension.
 * Trust Status is the exception worth sending people to: it reads the public
 * Salesforce Trust API, which needs no session, and resolves this org by its
 * My Domain when it cannot ask the org for its instance key - see the note on
 * TrustService.loadStatus. Signed out, it is the one panel that still answers
 * a question anybody actually has, which is whether the org is up.
 *
 * Hidden on the panel itself - once they are there the notice has done its
 * job and would only be repeating itself above the thing it sent them to.
 */
this.signedoutnotice = '<div class="ssSignedOutNotice" ng-if="!hasSession && signInDismissed && selectedMetadata.value !== truststatus">'+
'<div class="ssSignedOutHead">Not signed in</div>'+
'<p class="ssSignedOutBody">Without a Salesforce session this extension cannot query the org, so the metadata panels will come back empty.</p>'+
'<p class="ssSignedOutBody"><b>Trust Status</b> is the exception - it reads Salesforce\'s public status service rather than the org, so it still works. It will tell you whether this instance is healthy, and what maintenance is coming.</p>'+
'<div class="ssSignedOutActions">'+
'<button class="ssSignInBtn ssSignedOutGo" ng-click="openTrustStatus()">See Trust Status</button>'+
'<button class="ssSignInLink" ng-click="resumeSignIn()">Back to sign in</button>'+
'</div>'+
'</div>';

/*
 * The in-page alert, shaped like a Salesforce toast.
 *
 * Salesforce puts its own notices in a coloured bar at the top of the content
 * area with an icon, a message and a close button, and it goes away on its
 * own. Matching that is not decoration: an alert that looks like the platform
 * it is talking about is read as part of the page rather than as something
 * that has been injected into it.
 *
 * Lives outside the modal on purpose - it has to be visible whether or not
 * the panel is open, since most of the time it will not be.
 */
this.sstoast = '<div class="ss-toast" ng-class="\'ss-toast-\' + (toast.variant || \'info\')" ng-if="toast.visible" role="status" aria-live="polite">'+
'<span class="ss-toast-icon" aria-hidden="true">{{toast.icon}}</span>'+
'<div class="ss-toast-body">'+
'<div class="ss-toast-title">{{toast.title}}</div>'+
'<div class="ss-toast-text" ng-repeat="line in toast.lines track by $index">{{line}}</div>'+
'</div>'+
'<button class="ss-toast-open" ng-show="toast.actionable" ng-click="openFromToast()">View</button>'+
'<button class="ss-toast-close" ng-click="hideToast()" title="Close" aria-label="Close">&times;</button>'+
'</div>';

/*
 * Which alerts this extension may send, and a way to see one.
 *
 * The test button exists because there is no other way to find out: every
 * real alert is on a timer, behind quiet hours and a rate limit, so without
 * this the only way to check the setting works is to wait until the evening
 * and hope. It sends the real thing through the real path.
 */
this.notificationsettings = '<div class="ss-usage" ng-show="selectedMetadata.value == notificationsettings">'+
'<div class="ss-usage-api">'+
'<h4>Notification Preferences & Schedule</h4>'+
'<div class="ss-notify-org-banner" style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:10px 14px; margin-bottom:16px; font-size:12.5px; color:#1e40af; display:flex; align-items:center; gap:8px;">'+
'<span style="font-size:16px;">🏢</span>'+
'<span><b>Org-Specific Settings:</b> Notification preferences and schedules are saved specifically for this org <code>({{currentOrgId || "Logged-in Org"}})</code>.</span>'+
'</div>'+

'<div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">'+
'<label class="ss-notify-master">'+
'<input class="regular-checkbox" type="checkbox" ng-model="notifyPrefs.enabled" ng-change="saveNotifyPrefs()"/>'+
'<span><b>Send me notifications for this org</b></span>'+
'</label>'+
'</div>'+

'<div class="ss-notify-schedule-box" ng-show="notifyPrefs.enabled" style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:14px; margin-bottom:16px;">'+
'<div style="font-weight:600; font-size:13px; color:#334155; margin-bottom:8px;">⏰ Notification Schedule (Everyday Window)</div>'+
'<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">'+
'<label style="font-size:12px; color:#475569; display:inline-flex; align-items:center; gap:6px;">'+
'<span>Schedule Mode:</span>'+
'<select ng-model="notifyPrefs.scheduleType" ng-change="saveNotifyPrefs()" style="padding:4px 8px; font-size:12px; border:1px solid #cbd5e1; border-radius:4px; background:#fff;">'+
'<option value="all_day">All Day (24 Hours - Default)</option>'+
'<option value="custom_hours">Custom Daily Window</option>'+
'</select>'+
'</label>'+
'<div ng-show="notifyPrefs.scheduleType == \'custom_hours\'" style="display:inline-flex; align-items:center; gap:8px; font-size:12px; color:#475569;">'+
'<span>From:</span>'+
'<input type="text" placeholder="09:00" ng-model="notifyPrefs.startTime" ng-change="saveNotifyPrefs()" style="padding:4px 8px; font-size:12px; width:70px; border:1px solid #cbd5e1; border-radius:4px; text-align:center;"/>'+
'<span>To:</span>'+
'<input type="text" placeholder="18:00" ng-model="notifyPrefs.endTime" ng-change="saveNotifyPrefs()" style="padding:4px 8px; font-size:12px; width:70px; border:1px solid #cbd5e1; border-radius:4px; text-align:center;"/>'+
'</div>'+
'</div>'+
'<div style="font-size:11px; color:#64748b; margin-top:8px;">'+
'<span ng-show="notifyPrefs.scheduleType == \'all_day\'">Notifications are active 24 hours a day for this org.</span>'+
'<span ng-show="notifyPrefs.scheduleType == \'custom_hours\'">Notifications for this org will only be active everyday between <b>{{notifyPrefs.startTime || \'09:00\'}}</b> and <b>{{notifyPrefs.endTime || \'18:00\'}}</b>.</span>'+
'</div>'+
'</div>'+

'<div class="ss-notify-kinds" ng-class="{ssNotifyOff: !notifyPrefs.enabled}">'+
'<label class="ss-notify-kind" ng-repeat="kind in notifyKinds">'+
'<input class="regular-checkbox" type="checkbox" ng-model="notifyPrefs[kind.key]" ng-change="saveNotifyPrefs()" ng-disabled="!notifyPrefs.enabled"/>'+
'<span class="ss-notify-kind-text"><b>{{kind.label}}</b><em>{{kind.hint}}</em></span>'+
'</label>'+
'</div>'+

'<div class="ss-notify-actions">'+
'<button class="w3-button w3-blue w3-round" ng-click="sendTestNotification()" ng-disabled="!notifyPrefs.enabled">Send a test notification</button>'+
'<span class="ss-notify-result" ng-show="notifyTestResult">{{notifyTestResult}}</span>'+
'</div>'+
'<p class="ss-usage-note" ng-show="!notifyPrefs.enabled" style="margin-top:10px;">Notifications are off, so nothing will be sent and the test will not fire.</p>'+
'</div>'+
'</div>';

this.newstimeline = '<div class="ss-timeline-container" ng-show="selectedMetadata.value == newstimeline">'+
'<div class="ss-timeline-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; padding-bottom:10px; border-bottom:1px solid #e0e5ee;">'+
'  <div>'+
'    <h3 style="margin:0; font-size:16px; font-weight:600; color:var(--ss-blue-dark);">Broadcasted News Timeline</h3>'+
'    <span style="font-size:12px; color:#54698d;">Historical record of org activity and news updates</span>'+
'  </div>'+
'  <div style="display:flex; align-items:center; gap:10px;">'+
'    <label style="font-size:12px; color:#54698d; margin:0;">Retention:</label>'+
'    <select class="form-control" style="font-size:12px; height:28px; padding:2px 8px; width:auto; display:inline-block;" ng-model="newsRetentionDays" ng-options="opt.value as opt.label for opt in retentionOptions" ng-change="updateNewsRetention(newsRetentionDays)"></select>'+
'    <button class="btn btn-default" style="font-size:12px; padding:4px 10px; border-radius:4px;" ng-click="clearTimelineNews()" ng-disabled="!timelineItems.length">Clear History</button>'+
'  </div>'+
'</div>'+

'<div class="ss-timeline-empty" ng-show="!timelineItems.length" style="padding:40px 20px; text-align:center; color:#706e6b;">'+
'  <p style="font-size:14px; margin-bottom:5px;">No recorded news activity yet.</p>'+
'  <span style="font-size:12px;">News broadcasted in the footer ticker will automatically appear here.</span>'+
'</div>'+

'<div class="ss-timeline-list" ng-show="timelineItems.length">'+
'  <div class="ss-timeline-item" ng-repeat="item in timelineItems" style="display:flex; margin-bottom:12px; position:relative;">'+
'    <div class="ss-timeline-badge" style="width:32px; height:32px; border-radius:50%; background:#eef4fe; color:var(--ss-blue); display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:14px; flex-shrink:0; margin-right:12px;">&#x1F4F0;</div>'+
'    <div class="ss-timeline-content" style="background:#f3f5f8; border-radius:6px; padding:10px 14px; flex-grow:1; border:1px solid #e0e5ee;">'+
'      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">'+
'        <span style="font-size:11px; font-weight:600; color:var(--ss-blue); text-transform:uppercase;">{{item.target || "Broadcast"}}</span>'+
'        <span style="font-size:11px; color:#706e6b;">{{item.dateStr}} at {{item.timeStr}}</span>'+
'      </div>'+
'      <div style="font-size:13px; color:var(--ss-blue-dark); font-weight:500;">{{item.text}}</div>'+
'    </div>'+
'  </div>'+
'</div>'+
'</div>';

this.apimonitor = '<div ng-if="selectedMetadata.value==\'ApiMonitor\' || selectedMetadata.value==\'Integrator\'" style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">'+
'  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid #e2e8f0; padding-bottom:10px;">'+
'    <div>'+
'      <h2 style="margin:0; font-size:17px; font-weight:700; color:#1e293b;">🔌 API Monitor</h2>'+
'      <p style="margin:2px 0 0 0; font-size:11px; color:#64748b;">What this org calls out to, and what calls in</p>'+
'    </div>'+
'    <div style="display:flex; gap:8px;">'+
'      <button class="w3-button w3-blue w3-round" style="font-size:11px; font-weight:600; padding:5px 10px;" ng-click="runIntegratorHealthCheck()" ng-disabled="isCheckingHealth">'+
'        <span ng-show="!isCheckingHealth">⚡ Health Check</span>'+
'        <span ng-show="isCheckingHealth">⏳ Testing...</span>'+
'      </button>'+
'      <button class="w3-button w3-light-grey w3-round" style="font-size:11px; font-weight:600; padding:5px 10px;" ng-click="toggleAddEndpointForm()">'+
'        ➕ Add Endpoint'+
'      </button>'+
'    </div>'+
'  </div>'+
'  <div ng-show="showAddEndpoint" style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:10px; margin-bottom:14px;">'+
'    <div style="font-size:12px; font-weight:600; color:#334155; margin-bottom:6px;">Add Custom API Endpoint & Health Configuration</div>'+
'    <div style="display:flex; gap:6px; margin-bottom:6px;">'+
'      <select ng-model="newEndpoint.method" class="w3-select w3-border w3-round" style="font-size:11px; padding:4px 6px; width:90px; background:#fff;">'+
'        <option value="GET">GET</option>'+
'        <option value="POST">POST</option>'+
'        <option value="HEAD">HEAD</option>'+
'        <option value="PUT">PUT</option>'+
'      </select>'+
'      <input type="text" ng-model="newEndpoint.name" placeholder="Name (e.g. Payment Gateway)" class="w3-input w3-border w3-round" style="font-size:11px; padding:4px 8px; flex:1;" />'+
'      <input type="text" ng-model="newEndpoint.endpoint" placeholder="Endpoint URL (https://api.example.com/health)" class="w3-input w3-border w3-round" style="font-size:11px; padding:4px 8px; flex:2;" />'+
'    </div>'+
'    <div style="display:flex; gap:6px; margin-bottom:6px;">'+
'      <input type="text" ng-model="newEndpoint.headers" placeholder=\'Headers JSON (e.g. {"Authorization":"Bearer xyz"})\' class="w3-input w3-border w3-round" style="font-size:11px; padding:4px 8px; flex:1;" />'+
'      <input type="text" ng-model="newEndpoint.body" placeholder=\'Request Body Payload (for POST/PUT)\' class="w3-input w3-border w3-round" style="font-size:11px; padding:4px 8px; flex:1;" ng-show="newEndpoint.method===\'POST\' || newEndpoint.method===\'PUT\'" />'+
'    </div>'+
'    <div style="display:flex; gap:6px;">'+
'      <button class="w3-button w3-green w3-round" style="font-size:10px; padding:3px 8px;" ng-click="saveCustomEndpoint()">Save Integration</button>'+
'      <button class="w3-button w3-grey w3-round" style="font-size:10px; padding:3px 8px;" ng-click="showAddEndpoint = false">Cancel</button>'+
'    </div>'+
'  </div>'+
'  <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-bottom:14px;">'+
'    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:10px; text-align:center;">'+
'      <div style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Integrations</div>'+
'      <div style="font-size:20px; font-weight:700; color:#0f172a; margin-top:2px;">{{integrationsList.length || 0}}</div>'+
'    </div>'+
'    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:10px; text-align:center;">'+
'      <div style="font-size:10px; color:#166534; font-weight:600; text-transform:uppercase;">Daily Uptime</div>'+
'      <div style="font-size:20px; font-weight:700; color:#15803d; margin-top:2px;">{{integratorReport.uptimePercent || 100}}%</div>'+
'    </div>'+
'    <div style="background:#fefce8; border:1px solid #fef08a; border-radius:6px; padding:10px; text-align:center;">'+
'      <div style="font-size:10px; color:#854d0e; font-weight:600; text-transform:uppercase;">Avg Latency</div>'+
'      <div style="font-size:20px; font-weight:700; color:#a16207; margin-top:2px;">{{integratorReport.avgLatencyMs || 0}} ms</div>'+
'    </div>'+
'    <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:10px; text-align:center;">'+
'      <div style="font-size:10px; color:#991b1b; font-weight:600; text-transform:uppercase;">Offline Alerts</div>'+
'      <div style="font-size:20px; font-weight:700; color:#dc2626; margin-top:2px;">{{integratorReport.offlineCount || 0}}</div>'+
'    </div>'+
'  </div>'+

'  <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:14px;">'+
'    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:12px;">'+
'      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">'+
'        <span style="font-size:12px; font-weight:700; color:#0f172a;">⬇️ Inbound API Calls (Outside ➔ SFDC)</span>'+
'        <span style="font-size:10px; background:var(--ss-blue-tint); color:var(--ss-blue); padding:2px 8px; border-radius:10px; font-weight:600;">{{apiTraffic.inboundTotal || 0}} Calls Today</span>'+
'      </div>'+
'      <div style="display:flex; gap:8px; margin-top:6px;">'+
'        <div style="flex:1; background:#f8fafc; border:1px solid #f1f5f9; border-radius:6px; padding:6px; text-align:center;">'+
'          <div style="font-size:9px; color:#64748b; font-weight:600; text-transform:uppercase;">Daily Limit</div>'+
'          <div style="font-size:13px; font-weight:700; color:#334155; margin-top:2px;">{{apiTraffic.inboundLimitMax || "N/A"}}</div>'+
'        </div>'+
'        <div style="flex:1; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:6px; text-align:center;">'+
'          <div style="font-size:9px; color:#166534; font-weight:600; text-transform:uppercase;">Remaining</div>'+
'          <div style="font-size:13px; font-weight:700; color:#15803d; margin-top:2px;">{{apiTraffic.inboundRemaining || "N/A"}}</div>'+
'        </div>'+
'      </div>'+
'    </div>'+
'    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:12px;">'+
'      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">'+
'        <span style="font-size:12px; font-weight:700; color:#0f172a;">⬆️ Outbound API Calls (SFDC ➔ Outside)</span>'+
'        <span style="font-size:10px; background:#fcf2ff; color:#86198f; padding:2px 8px; border-radius:10px; font-weight:600;">{{apiTraffic.outboundTotal || 0}} Callouts Today</span>'+
'      </div>'+
'      <div style="display:flex; gap:8px; margin-top:6px;">'+
'        <div style="flex:1; background:#f8fafc; border:1px solid #f1f5f9; border-radius:6px; padding:6px; text-align:center;">'+
'          <div style="font-size:9px; color:#64748b; font-weight:600; text-transform:uppercase;">Apex Callouts</div>'+
'          <div style="font-size:13px; font-weight:700; color:#334155; margin-top:2px;">{{apiTraffic.breakdown.outboundCallouts || 0}}</div>'+
'        </div>'+
'        <div style="flex:1; background:#fefce8; border:1px solid #fef08a; border-radius:6px; padding:6px; text-align:center;">'+
'          <div style="font-size:9px; color:#854d0e; font-weight:600; text-transform:uppercase;">Monitored APIs</div>'+
'          <div style="font-size:13px; font-weight:700; color:#a16207; margin-top:2px;">{{integrationsList.length || 0}}</div>'+
'        </div>'+
'      </div>'+
'    </div>'+
'  </div>'+

/*
 * Direction, stated rather than implied.
 *
 * Everything below is an allow-list for Salesforce calling out - a Named
 * Credential or Remote Site is permission to leave, not evidence anyone
 * arrived. Inbound is a different question with a different source, so it
 * gets its own section instead of being mixed into a list that cannot answer
 * it.
 */
'  <div style="display:flex; align-items:center; gap:8px; margin:16px 0 6px;">'+
'    <h3 style="margin:0; font-size:13px; font-weight:700; color:#334155;">&#8592; Inbound</h3>'+
'    <span style="font-size:11px; color:#64748b;">applications calling into this org</span>'+
'    <span style="margin-left:auto; display:inline-flex; gap:4px;">'+
'      <button class="ss-pkg-btn" ng-class="{ssSelected: inboundDays === 7}" ng-click="setInboundWindow(7)">7 days</button>'+
'      <button class="ss-pkg-btn" ng-class="{ssSelected: inboundDays === 30}" ng-click="setInboundWindow(30)">30 days</button>'+
'      <button class="ss-pkg-btn" ng-class="{ssSelected: inboundDays === 90}" ng-click="setInboundWindow(90)">90 days</button>'+
'    </span>'+
'  </div>'+
'  <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; margin-bottom:16px;">'+
'    <table style="width:100%; border-collapse:collapse; font-size:11px;">'+
'      <thead><tr style="background:#f8fafc; text-align:left; border-bottom:1px solid #e2e8f0;">'+
'        <th style="padding:6px 10px;">Application</th>'+
'        <th style="padding:6px 10px;">API</th>'+
'        <th style="padding:6px 10px; text-align:right;">Logins</th>'+
'        <th style="padding:6px 10px; text-align:right;">Failed</th>'+
'        <th style="padding:6px 10px; text-align:right;">Addresses</th>'+
'        <th style="padding:6px 10px;">Last seen</th>'+
'      </tr></thead>'+
'      <tbody>'+
'        <tr ng-repeat="caller in inboundCallers track by $index" style="border-bottom:1px solid #f1f5f9;">'+
'          <td style="padding:6px 10px; font-weight:600;">{{caller.name}}</td>'+
'          <td style="padding:6px 10px; color:#475569;">{{caller.apiType}}<span ng-show="caller.apiVersion"> v{{caller.apiVersion}}</span></td>'+
'          <td style="padding:6px 10px; text-align:right;">{{caller.logins}}</td>'+
// A caller that cannot authenticate is an integration already broken, which
// is the thing on this screen most worth noticing.
'          <td style="padding:6px 10px; text-align:right;" ng-style="{color: caller.failures ? \'#b91c1c\' : \'#94a3b8\', fontWeight: caller.failures ? 700 : 400}">{{caller.failures}}</td>'+
'          <td style="padding:6px 10px; text-align:right; color:#475569;">{{caller.addressCount}}</td>'+
'          <td style="padding:6px 10px; color:#64748b;">{{caller.lastSeen | date:\'d MMM HH:mm\'}}</td>'+
'        </tr>'+
'      </tbody>'+
'    </table>'+
'    <div ng-show="inboundLoaded && !inboundCallers.length" style="padding:10px; font-size:11px; color:#64748b;">'+
'      No API logins in this window. Either nothing is integrating with this org, or reading login history '+
'      needs a permission this user does not have.'+
'    </div>'+
'  </div>'+
/*
 * Logins, not calls - said on screen rather than left to be assumed. Per-call
 * counts live in EventLogFile, which needs Event Monitoring; this works in
 * every org.
 */
'  <p style="margin:-10px 0 16px 0; font-size:10.5px; color:#94a3b8;">Counted from login history, so these are '+
'authentications rather than individual calls. Per-call detail needs Event Monitoring.</p>'+
// A capped total presented as a count is the silent understatement paging was
// added to avoid, so it is said rather than left to be assumed.
'  <p ng-show="inboundCallers.truncated" style="margin:-12px 0 16px 0; font-size:10.5px; color:#b45309; font-weight:600;">'+
'    There were more logins than this could read in one go - the numbers above are a floor, not a total. '+
'    Try a shorter window.</p>'+

'  <div style="display:flex; align-items:center; gap:8px; margin:0 0 6px;">'+
'    <h3 style="margin:0; font-size:13px; font-weight:700; color:#334155;">&#8594; Outbound</h3>'+
'    <span style="font-size:11px; color:#64748b;">endpoints this org is configured to call</span>'+
'  </div>'+
'  <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; margin-bottom:14px;">'+
'    <div style="padding:10px 14px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:600; color:#334155; display:flex; justify-content:space-between; align-items:center;">'+
'      <span>Configured & Discovered Integrations</span>'+
'      <span style="font-size:10px; color:#64748b; font-weight:normal;">Auto-synced from Org Schema</span>'+
'    </div>'+
'    <div class="ss-integrator-scroll">'+
'      <table class="ss-integrator-table" style="width:100%; border-collapse:collapse; font-size:11px;">'+
'        <thead>'+
'          <tr style="background:#f1f5f9; color:#475569; text-align:left; border-bottom:1px solid #e2e8f0;">'+
'            <th style="padding:6px 10px;">Name</th>'+
'            <th style="padding:6px 10px;">Type</th>'+
'            <th style="padding:6px 10px;">Endpoint</th>'+
'            <th style="padding:6px 10px;">Status</th>'+
'            <th style="padding:6px 10px; text-align:right;">Action</th>'+
'          </tr>'+
'        </thead>'+
'        <tbody>'+
'          <tr ng-repeat="item in integrationsList track by $index" style="border-bottom:1px solid #f1f5f9;">'+
'            <td style="padding:6px 10px; font-weight:600; color:#1e293b;">{{item.name}}</td>'+
'            <td style="padding:6px 10px; color:#64748b;">{{item.type}}</td>'+
'            <td style="padding:6px 10px; color:#475569; font-family:monospace; font-size:10px;">{{item.endpoint | limitTo:35}}<span ng-if="item.endpoint.length>35">...</span></td>'+
'            <td style="padding:6px 10px;">'+
'              <span ng-if="item.lastStatus===\'Healthy\'" style="background:#dcfce7; color:#15803d; padding:2px 6px; border-radius:10px; font-size:10px; font-weight:600;">✓ Healthy ({{item.lastLatency || 0}}ms)</span>'+
'              <span ng-if="item.lastStatus===\'Offline\'" style="background:#fee2e2; color:#dc2626; padding:2px 6px; border-radius:10px; font-size:10px; font-weight:600;">⚠️ Offline</span>'+
'              <span ng-if="!item.lastStatus" style="background:#f1f5f9; color:#64748b; padding:2px 6px; border-radius:10px; font-size:10px;">Pending</span>'+
'            </td>'+
'            <td style="padding:6px 10px; text-align:right;">'+
'              <button class="w3-button w3-tiny w3-white w3-border w3-round" style="font-size:10px; padding:1px 6px;" ng-click="pingSingleIntegration(item)">Ping</button>'+
'            </td>'+
'          </tr>'+
'          <tr ng-if="integrationsList.length===0">'+
'            <td colspan="5" style="padding:12px; text-align:center; color:#94a3b8;">No Named Credentials or Remote Sites configured.</td>'+
'          </tr>'+
'        </tbody>'+
'      </table>'+
'    </div>'+
'  </div>'+

'  <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden;">'+
'    <div style="padding:10px 14px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:600; color:#334155; display:flex; justify-content:space-between; align-items:center;">'+
'      <span>📊 Daily Health Log & History</span>'+
'      <button class="w3-button w3-tiny w3-text-red" style="font-size:10px; padding:0;" ng-click="clearIntegratorHistory()" ng-show="integratorLogs.length>0">Clear History</button>'+
'    </div>'+
'    <div class="ss-integrator-log">'+
'      <table class="ss-integrator-table" style="width:100%; border-collapse:collapse; font-size:11px;">'+
'        <thead>'+
'          <tr style="background:#f1f5f9; color:#475569; text-align:left; border-bottom:1px solid #e2e8f0;">'+
'            <th style="padding:5px 10px;">Time</th>'+
'            <th style="padding:5px 10px;">Integration</th>'+
'            <th style="padding:5px 10px;">Status</th>'+
'            <th style="padding:5px 10px;">Latency</th>'+
'            <th style="padding:5px 10px;">HTTP Code</th>'+
'          </tr>'+
'        </thead>'+
'        <tbody>'+
'          <tr ng-repeat="log in integratorLogs track by $index" style="border-bottom:1px solid #f8fafc;">'+
'            <td style="padding:5px 10px; color:#64748b;">{{log.dateStr}} {{log.timeStr}}</td>'+
'            <td style="padding:5px 10px; font-weight:600; color:#1e293b;">{{log.name}}</td>'+
'            <td style="padding:5px 10px;">'+
'              <span ng-if="log.status===\'Healthy\'" style="color:#16a34a; font-weight:bold;">✓ Healthy</span>'+
'              <span ng-if="log.status===\'Offline\'" style="color:#dc2626; font-weight:bold;">❌ Offline</span>'+
'            </td>'+
'            <td style="padding:5px 10px; color:#475569;">{{log.latencyMs}} ms</td>'+
'            <td style="padding:5px 10px; color:#64748b; font-family:monospace;">{{log.statusCode}}</td>'+
'          </tr>'+
'          <tr ng-if="integratorLogs.length===0">'+
'            <td colspan="5" style="padding:12px; text-align:center; color:#94a3b8;">No health check runs logged yet. Click "Health Check" to start.</td>'+
'          </tr>'+
'        </tbody>'+
'      </table>'+
'    </div>'+
'  </div>'+
'</div>';



/*
 * The watch list in full.
 *
 * The sidebar card is the glance; this is the page. Two things it has room for
 * that the card does not: what each component was last seen at, which is what
 * tells you whether a quiet entry is genuinely quiet or was never checked, and
 * the whole history rather than the most recent few.
 */
this.watchinglist = '<div ng-if="selectedMetadata.value==\'WatchingList\'" style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">'+
'  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid #e2e8f0; padding-bottom:10px;">'+
'    <div></div>'+
'    <div style="display:flex; gap:8px;">'+
'      <label class="ss-auto-refresh" title="Re-check the watch list on a timer while this panel is open">'+
'        <span>Auto-refresh</span>'+
'        <select ng-model="autoRefreshMinutes" ng-change="setAutoRefresh(autoRefreshMinutes)" '+
'ng-options="m as (m ? m + \' min\' : \'Off\') for m in autoRefreshChoices"></select>'+
'      </label>'+
'      <button class="ss-notify-btn" ng-class="{\'is-off\': !notifyOnWatchChange}" '+
'ng-click="toggleWatchNotifications()" '+
'title="{{notifyOnWatchChange ? \'Stop showing a notice when a watched component changes\' : \'Show a notice when a watched component changes\'}}">'+
'        <span ng-if="notifyOnWatchChange">\u25cf Notify on change</span>'+
'        <span ng-if="!notifyOnWatchChange">\u25cb Notifications off</span>'+
'      </button>'+
'      <button class="w3-button w3-blue w3-round" style="font-size:11px; font-weight:600; padding:5px 10px;" ng-click="checkBookmarks(true)" ng-disabled="isCheckingBookmarks || !bookmarks.length">'+
'        <span ng-show="!isCheckingBookmarks">🔄 Check for changes</span>'+
'        <span ng-show="isCheckingBookmarks">⏳ Checking...</span>'+
'      </button>'+
'    </div>'+
'  </div>'+

'  <p class="ss-watch-warn" ng-show="bookmarkNotice">{{bookmarkNotice}}</p>'+
'  <p class="ss-watch-note" ng-show="bookmarks.length">'+
'<span ng-if="lastBookmarkCheck">Last checked {{lastBookmarkCheck | date:\'MMM d, h:mm a\'}}.</span>'+
'<span ng-if="!lastBookmarkCheck">Not checked yet.</span>'+
'<span ng-if="autoRefreshMinutes"> Re-checking every {{autoRefreshMinutes}} minutes while this panel is open.</span>'+
'<span ng-if="!autoRefreshMinutes"> Auto-refresh is off.</span></p>'+

// Empty state that says how to start, since there is no other way in - the
// star lives on the record lists, not here.
'  <div ng-if="!bookmarks.length && !bookmarkEvents.length" class="ss-watch-empty">'+
'    <p style="font-size:13px; font-weight:600; color:#1e293b; margin:0 0 4px;">Nothing is being watched yet.</p>'+
'    <p style="font-size:11.5px; color:#64748b; margin:0;">Open any metadata list and click the ☆ beside a row. '+
'    This page then records every edit and deletion to it.</p>'+
'  </div>'+

'  <div ng-if="bookmarks.length">'+
'    <div class="ss-watch-section">Watching ({{bookmarks.length}} of {{maxBookmarks}})'+
'      <a href="#" class="ss-watch-clear-all" ng-click="clearAllBookmarks(); $event.preventDefault()">\u2715 Stop watching everything</a>'+
'    </div>'+
/*
 * The same summary the manifest gets.
 *
 * This was a row of chips - type and count, and nothing to compare them
 * against. "Watching 42" answers how many; the question people actually
 * have here is the same one the package.xml page answers: which types,
 * how many of each, and how lopsided is it. Forty-one Profiles and one
 * Apex class is a different watch list from a dozen of each, and the
 * numbers alone do not say so at a glance.
 *
 * Deliberately the package summary's own classes rather than a parallel
 * set: it is the same block doing the same job over a different list, and
 * two stylesheets for one appearance drift apart.
 */
'    <div class="ss-pkg-stats ss-watch-stats" ng-show="bookmarks.length">'+
'      <div class="ss-pkg-tiles">'+
'        <div class="ss-pkg-tile">'+
'          <span class="ss-pkg-tile-n">{{bookmarks.length}}</span>'+
'          <span class="ss-pkg-tile-l">component<span ng-show="bookmarks.length !== 1">s</span></span>'+
'        </div>'+
'        <div class="ss-pkg-tile">'+
'          <span class="ss-pkg-tile-n">{{watchedTypes.length}}</span>'+
'          <span class="ss-pkg-tile-l">type<span ng-show="watchedTypes.length !== 1">s</span></span>'+
'        </div>'+
// Both of these are warnings rather than facts, so they appear only when
// there is something to warn about - a zero would read as reassurance
// nobody asked for.
'        <div class="ss-pkg-tile" ng-show="bookmarkUnseen">'+
'          <span class="ss-pkg-tile-n">{{bookmarkUnseen}}</span>'+
'          <span class="ss-pkg-tile-l">changed</span>'+
'        </div>'+
'        <div class="ss-pkg-tile ss-pkg-tile-warn" ng-show="watchGoneCount()">'+
'          <span class="ss-pkg-tile-n">{{watchGoneCount()}}</span>'+
'          <span class="ss-pkg-tile-l">gone</span>'+
'        </div>'+
'      </div>'+

'      <div class="ss-pkg-breakdown">'+
'        <div class="ss-pkg-breakdown-head">By type</div>'+
'        <table class="ss-pkg-breakdown-table">'+
'          <tr ng-repeat="group in watchedTypes track by group.type">'+
'            <td class="ss-pkg-type">{{group.label}}</td>'+
'            <td class="ss-pkg-bar-cell">'+
'<span class="ss-pkg-bar-fill" ng-style="{width: watchTypeShare(group) + \'%\'}"></span></td>'+
'            <td class="ss-pkg-count">{{group.count}}</td>'+
'            <td class="ss-pkg-type-remove">'+
'<button class="ss-notice-close" ng-click="removeWatchedType(group.type)" '+
'title="Stop watching all {{group.count}} {{group.label}}" '+
'aria-label="Stop watching all {{group.label}}">&times;</button></td>'+
'          </tr>'+
'        </table>'+
'      </div>'+
'    </div>'+
'    <table class="ss-integrator-table ss-watch-table" style="margin-bottom:18px;">'+
'      <tr><th>Component</th><th>Type</th><th>Last seen changed</th><th></th></tr>'+
'      <tr ng-repeat="item in bookmarks track by (item.type + item.id)">'+
'        <td class="ss-watch-name">'+
'<a ng-if="!item.missingSince && baseUrl" target="_blank" href="{{baseUrl}}/{{item.id}}" '+
'title="Open {{item.name}} in Salesforce">{{item.name}}</a>'+
'<span ng-if="item.missingSince || !baseUrl" title="{{item.missingSince ? \'No longer in this org\' : item.id}}">{{item.name}}'+
'<span class="ss-watch-gone" ng-if="item.missingSince"> (gone)</span></span></td>'+
'        <td class="ss-watch-dim">{{item.typeLabel}}</td>'+
'        <td class="ss-watch-dim">{{item.lastModifiedDate ? (item.lastModifiedDate | date:\'MMM d, y h:mm a\') : \'not recorded yet\'}}</td>'+
'        <td><span class="ss-bookmark-remove" ng-click="removeBookmark(item)" title="Stop watching">&times;</span></td>'+
'      </tr>'+
'    </table>'+
'  </div>'+

'  <div ng-if="bookmarks.length || bookmarkEvents.length">'+
'  <div class="ss-watch-section">Timeline'+
'    <span class="ss-bookmark-unseen" ng-show="bookmarkUnseen">{{bookmarkUnseen}} new</span>'+
'    <button class="ss-history-btn" ng-class="{\'is-on\': showBookmarkHistory}" '+
'ng-click="toggleBookmarkHistory()" ng-disabled="isLoadingHistory" '+
'title="Look for earlier changes to these components in this org\u2019s setup audit trail">'+
'      <span ng-if="isLoadingHistory">Reading audit trail\u2026</span>'+
'      <span ng-if="!isLoadingHistory && !showBookmarkHistory">\u21ba Show earlier history</span>'+
'      <span ng-if="!isLoadingHistory && showBookmarkHistory">\u2713 Earlier history shown</span>'+
'    </button>'+
'  </div>'+
'  <p class="ss-watch-note ss-watch-warn" ng-show="historyNotice">{{historyNotice}}</p>'+
'  <table class="ss-integrator-table ss-watch-feed" style="width:100%; border-collapse:collapse; font-size:11px;">'+
'    <tr ng-repeat="event in bookmarkTimeline track by event._key" '+
'ng-class="{\'is-unseen\': !event.seen}" style="border-bottom:1px solid #f1f5f9;">'+
'      <td style="padding:8px 10px; color:#64748b; font-size:10px; white-space:nowrap;">'+
'{{event.at | date:\'yyyy-MM-dd HH:mm:ss\'}}'+
'<span class="ss-watch-noticed" ng-if="event.atIsDetection" title="This is when the change was found, not when it was made">noticed</span></td>'+
'      <td style="padding:8px 10px; font-weight:600; color:#1e293b;">{{event.byName || \'Unknown user\'}}</td>'+
'      <td style="padding:8px 10px;"><span class="ss-watch-badge" ng-class="{\'is-deleted\': event.kind === \'deleted\', \'is-history\': event.source === \'audit\'}">'+
'{{event.kind === \'deleted\' ? \'deleted\' : (event.source === \'audit\' ? event.section || \'audit trail\' : \'edited\')}}</span></td>'+
'      <td style="padding:8px 10px; color:#334155; font-size:11px; line-height:1.4;">'+
'<span ng-if="event.source !== \'audit\'">'+
'<a ng-if="event.kind !== \'deleted\' && baseUrl" target="_blank" href="{{baseUrl}}/{{event.id}}" '+
'title="Open {{event.name}} in Salesforce">{{event.name}}</a>'+
'<span ng-if="event.kind === \'deleted\' || !baseUrl">{{event.name}}</span>'+
' <span class="ss-watch-dim">({{event.typeLabel}})</span> '+
'was {{event.kind === \'deleted\' ? \'deleted\' : \'edited\'}}<span ng-show="event.byName"> by {{event.byName}}</span>.</span>'+
'<span ng-if="event.source === \'audit\'">{{event.display}}'+
'<span class="ss-history-tag" title="Matched by name in the audit trail entry, not by component id">'+
'matched to '+
'<a ng-if="baseUrl" target="_blank" href="{{baseUrl}}/{{event.id}}">{{event.name}}</a>'+
'<span ng-if="!baseUrl">{{event.name}}</span></span></span></td>'+
'    </tr>'+
// Gated on the timeline, which is what the rows above render - not on
// bookmarkEvents, which is only the observed half. Turning on earlier
// history filled the table and left "No changes recorded yet" sitting
// underneath the rows it had just found.
'    <tr ng-if="!bookmarkTimeline.length">'+
'      <td colspan="4" style="padding:16px; text-align:center; color:#94a3b8;">'+
'      No changes recorded yet. Anything that happens to a watched component appears here'+
'<span ng-show="!showBookmarkHistory">, and \u201cShow earlier history\u201d above looks for past ones in the setup audit trail</span>.'+
'<span ng-show="showBookmarkHistory && !isLoadingHistory"> The setup audit trail has no entries naming these components either. It does not record everything \u2013 saving an Apex class, for one, leaves no entry.</span></td>'+
'    </tr>'+
'  </table>'+
'  <div class="ss-bookmark-actions" ng-show="bookmarkEvents.length">'+
'    <a href="#" ng-click="markBookmarksSeen(); $event.preventDefault()" ng-show="bookmarkUnseen">\u2713 Mark all seen</a>'+
'    <a href="#" ng-click="clearBookmarkTimeline(); $event.preventDefault()">\u2715 Clear timeline</a>'+
'  </div>'+
'  </div>'+
'  <p class="ss-watch-note" style="margin-top:14px; border-top:1px solid #e2e8f0; padding-top:10px;">'+
'  Checked when you open this panel and whenever you press Check for changes - not continuously in the background. '+
'  Stored in this browser only, for this org.</p>'+
'</div>';

this.audittrail = '<div ng-if="selectedMetadata.value==\'AuditTrail\'" style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">'+
'  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid #e2e8f0; padding-bottom:10px;">'+
'    <div>'+
'      <h2 style="margin:0; font-size:17px; font-weight:700; color:#1e293b;">📜 Setup Audit Trail</h2>'+
'      <p style="margin:2px 0 0 0; font-size:11px; color:#64748b;">Track, search, and inspect admin & setup changes in this org</p>'+
'    </div>'+
'    <div style="display:flex; gap:8px;">'+
'      <button class="w3-button w3-blue w3-round" style="font-size:11px; font-weight:600; padding:5px 10px;" ng-click="loadAuditTrail()" ng-disabled="isLoadingAuditTrail">'+
'        <span ng-show="!isLoadingAuditTrail">🔄 Refresh Logs</span>'+
'        <span ng-show="isLoadingAuditTrail">⏳ Fetching...</span>'+
'      </button>'+
'    </div>'+
'  </div>'+

'  <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; margin-bottom:14px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">'+
'    <div style="flex:2; min-width:200px;">'+
'      <input type="text" ng-model="auditFilters.search" ng-change="applyAuditFilters()" placeholder="🔍 Quick Find by action, display details, section, or user..." class="w3-input w3-border w3-round" style="font-size:11px; padding:5px 10px; width:100%; background:#fff;" />'+
'    </div>'+
'    <div style="flex:1; min-width:130px;">'+
'      <select ng-model="auditFilters.section" ng-change="applyAuditFilters()" class="w3-select w3-border w3-round" style="font-size:11px; padding:5px 6px; width:100%; background:#fff;">'+
'        <option value="">All Sections</option>'+
'        <option ng-repeat="sec in auditSectionsList" value="{{sec}}">{{sec}}</option>'+
'      </select>'+
'    </div>'+
'    <div style="flex:1; min-width:130px;">'+
'      <select ng-model="auditFilters.user" ng-change="applyAuditFilters()" class="w3-select w3-border w3-round" style="font-size:11px; padding:5px 6px; width:100%; background:#fff;">'+
'        <option value="">All Users</option>'+
'        <option ng-repeat="usr in auditUsersList" value="{{usr}}">{{usr}}</option>'+
'      </select>'+
'    </div>'+
'  </div>'+

'  <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin-bottom:14px;">'+
'    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:10px; text-align:center;">'+
'      <div style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Logs Loaded</div>'+
'      <div style="font-size:18px; font-weight:700; color:#0f172a; margin-top:2px;">{{auditTrailRecords.length || 0}} / {{auditTrailRawRecords.length || 0}}</div>'+
'    </div>'+
'    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:10px; text-align:center;">'+
'      <div style="font-size:10px; color:#166534; font-weight:600; text-transform:uppercase;">Active Sections</div>'+
'      <div style="font-size:18px; font-weight:700; color:#15803d; margin-top:2px;">{{auditSectionsList.length || 0}}</div>'+
'    </div>'+
'    <div style="background:var(--ss-blue-tint); border:1px solid var(--ss-blue-border); border-radius:6px; padding:10px; text-align:center;">'+
'      <div style="font-size:10px; color:var(--ss-blue); font-weight:600; text-transform:uppercase;">Active Admins</div>'+
'      <div style="font-size:18px; font-weight:700; color:var(--ss-blue); margin-top:2px;">{{auditUsersList.length || 0}}</div>'+
'    </div>'+
'  </div>'+

'  <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden;">'+
'    <div style="padding:10px 14px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:600; color:#334155; display:flex; justify-content:space-between; align-items:center;">'+
'      <span>Setup Audit Trail History</span>'+
'      <span style="font-size:10px; color:#64748b; font-weight:normal;">Showing top {{auditTrailRecords.length || 0}} recent changes</span>'+
'    </div>'+
'    <div class="ss-audit-scroll">'+
'      <table class="ss-integrator-table" style="width:100%; border-collapse:collapse; font-size:11px;">'+
'        <thead>'+
'          <tr style="background:#f1f5f9; color:#475569; text-align:left; border-bottom:1px solid #e2e8f0;">'+
'            <th style="padding:8px 10px; width:130px;">Date & Time</th>'+
'            <th style="padding:8px 10px; width:130px;">User</th>'+
'            <th style="padding:8px 10px; width:120px;">Section</th>'+
'            <th style="padding:8px 10px;">Display Details</th>'+
'          </tr>'+
'        </thead>'+
'        <tbody>'+
'          <tr ng-repeat="item in auditTrailRecords track by $index" style="border-bottom:1px solid #f1f5f9;">'+
'            <td style="padding:8px 10px; color:#64748b; font-size:10px;">{{item.CreatedDate | date:\'yyyy-MM-dd HH:mm:ss\'}}</td>'+
'            <td style="padding:8px 10px; font-weight:600; color:#1e293b;">{{item.CreatedBy.Name || item.CreatedById}}</td>'+
'            <td style="padding:8px 10px;"><span style="background:var(--ss-blue-tint); color:var(--ss-blue); padding:2px 6px; border-radius:10px; font-size:10px; font-weight:600;">{{item.Section || \'Setup\'}}</span></td>'+
'            <td style="padding:8px 10px; color:#334155; font-size:11px; line-height:1.4;">{{item.Display}}</td>'+
'          </tr>'+
'          <tr ng-if="auditTrailError && !isLoadingAuditTrail">'+
'            <td colspan="4" style="padding:16px; text-align:center; color:#b91c1c;">{{auditTrailError}}</td>'+
'          </tr>'+
'          <tr ng-if="!auditTrailError && auditTrailRecords.length===0 && !isLoadingAuditTrail">'+
'            <td colspan="4" style="padding:16px; text-align:center; color:#94a3b8;">No audit trail records found matching filters.</td>'+
'          </tr>'+
'          <tr ng-if="isLoadingAuditTrail">'+
'            <td colspan="4" style="padding:16px; text-align:center; color:#64748b;">⏳ Querying SetupAuditTrail...</td>'+
'          </tr>'+
'        </tbody>'+
'      </table>'+
'    </div>'+
'  </div>'+
'</div>';

var SS_PANEL_BODY = '<div class="ss-modal-body">'+
'<table class="ss-modal-grid" width="100%" height="100%">'+
'<tr>'+
'<td class="ss-modal-nav" ng-style="{width: (sidebarWidth || 240) + \'px\', minWidth: (sidebarWidth || 240) + \'px\', maxWidth: (sidebarWidth || 240) + \'px\'}">'+
'<metadatamainmenu></metadatamainmenu>'+
'</td>'+
'<td class="ss-modal-main">'+
'<div class="ss-modal-scroll" ss-on-scroll="handleMainScroll($event)">'+
'<signedoutnotice></signedoutnotice>'+
'<table width="100%">'+
'<tr>'+
'<td style="vertical-align: top;">'+
'<div class="ss-sticky-header-container" ng-show="selectedMetadata" ng-class="{\'is-scrolled\': isMainScrolled && selectedMetadata.isSearchable, \'ss-header-non-searchable\': !selectedMetadata.isSearchable}"><objectlevelaction></objectlevelaction><searchdata ng-show="selectedMetadata.isSearchable"></searchdata></div>'+
'<usersrecords></usersrecords>'+
'<allrecords></allrecords>'+
'<articles></articles>'+
'<packagexmleditor></packagexmleditor>'+
'<launchercolor></launchercolor>'+'<notificationsettings></notificationsettings>'+'<usageanalytics></usageanalytics>'+'<newstimeline></newstimeline>'+'<apimonitor></apimonitor>'+'<audittrail></audittrail>'+'<watchinglist></watchinglist>'+'<objectdescribe></objectdescribe>'+'<eventgraph></eventgraph>'+'<syncjobs></syncjobs>'+'<bulkjobs></bulkjobs>'+'<restexplorer></restexplorer>'+'<truststatus></truststatus>'+'<aboutus></aboutus>'+
'</td>'+
// Audit Trail is a Settings page, so hasRightSidebar excludes it - but it is
// the one such page with a card of its own. Still gated on having a session:
// signed out there is nothing to show in either column.
'<td class="ss-right-sidebar-col" ng-style="{width: (rightSidebarWidth || 260) + \'px\', minWidth: (rightSidebarWidth || 260) + \'px\', maxWidth: (rightSidebarWidth || 260) + \'px\'}" style="vertical-align: top; padding-left: 12px; position: relative;" ng-show="hasRightSidebar(selectedMetadata) || ((isAuditTrailPage() || isRestExplorerPage()) && hasSession)">'+
'<div class="ss-right-sidebar-resizer" ng-mousedown="startRightSidebarResize($event)" title="Drag to resize right panel width"></div>'+
'<div class="ss-right-sidebar-sticky">'+
'<div class="ss-right-sidebar-controls" style="display:flex; justify-content:flex-end; align-items:center; gap:4px; margin-bottom:8px; padding:0 2px;">'+
'<button ng-click="adjustRightSidebarWidth(-20)" title="Shrink right panel width" class="ss-width-btn">-</button>'+
'<span class="ss-width-label">{{rightSidebarWidth || 260}}px</span>'+
'<button ng-click="adjustRightSidebarWidth(20)" title="Widen right panel width" class="ss-width-btn">+</button>'+
'<button ng-click="resetRightSidebarWidth()" title="Reset right panel width" class="ss-width-btn ss-reset-btn">↺</button>'+
'</div>'+
'<querynotice></querynotice>'+
'<userdetails></userdetails>'+
'<technologylist></technologylist>'+
// packagexml and bookmarkwatch used to sit here. Both were a card for a
// number, and both numbers are in the footer now - one click from the page
// that carries everything else about them.
'<activeuserstoday></activeuserstoday>'+'<restresources></restresources>'+'<developeranalysis></developeranalysis>'+
'<packagexmlfrequency></packagexmlfrequency>'+
'</div>'+
'</td>'+
'</tr>'+
'</table>'+
'</div>'+
'</td>'+
'</tr>'+
'</table>'+
'</div>';

var SS_PANEL_FOOTER = '<footer class="w3-container modalfooter" style="display:flex; align-items:center; gap:8px; padding:5px 12px; background:#f8fafc; border-top:1px solid #e2e8f0; font-family:-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">'+
/*
 * The headline, and what is in hand.
 *
 * It ran the full width, which was right when it was the only thing here.
 * The watch list and the manifest were a pair of cards in the right rail
 * instead - a lot of page for two numbers, when the numbers are the part
 * worth seeing at a glance and everything else about them already has a page
 * of its own.
 *
 * So the headline keeps the left corner and gives up the rest of the bar. It
 * is capped rather than centred: a ticker that starts in a different place
 * depending on how long today's headline is reads as a layout that moved.
 */
'<div class="ss-foot-news">'+
'<ssnews></ssnews>'+
'</div>'+

/*
 * Counts, not cards. Each opens the page that holds everything else about it,
 * so nothing is reachable only from here - the chip is a way in and a number,
 * not a control of its own.
 */
'<div class="ss-foot-actions">'+
'<button class="ss-foot-chip" ng-show="bookmarks.length" ng-click="openWatchingList()" '+
'title="{{bookmarks.length}} watched - open the watching list">'+
'<span class="ss-foot-icon">\u2605</span>{{bookmarks.length}}<span class="ss-foot-word">Watching</span>'+
// The unseen count is the only part that is news rather than status, so it
// is the only part with a colour of its own.
'<em class="ss-foot-flag" ng-show="bookmarkUnseen">{{bookmarkUnseen}}</em>'+
'</button>'+
'<button class="ss-foot-chip" ng-show="selectedMetaForPackageXml.size" ng-click="openPackageXml()" '+
'title="{{selectedMetaForPackageXml.size}} selected for package.xml - open the manifest">'+
'<span class="ss-foot-icon">\u2913</span>{{selectedMetaForPackageXml.size}}'+
'<span class="ss-foot-word">package.xml</span>'+
'</button>'+

/*
 * The record basket, which had no count anywhere except a card that only
 * appears on pages where downloading is possible - so a selection made on one
 * object was invisible from everywhere else, which is exactly when somebody
 * forgets it is there.
 *
 * Downloads on click rather than opening something, because downloading is
 * the only thing that card does.
 */
'<button class="ss-foot-chip" ng-show="selectedDataForDownload.size" '+
'ng-click="downloadSelectedDataAsJson()" ng-disabled="downloadState.running" '+
'title="{{dataExportTitle()}}">'+
'<span class="ss-foot-icon">{ }</span>{{selectedDataForDownload.size}}'+
'<span class="ss-foot-word">{{downloadState.running ? \'Fetching\u2026\' : \'Data JSON\'}}</span>'+
'</button>'+
/*
 * Emptying the basket, which the card used to carry.
 *
 * It has to live somewhere reachable from every page: a selection can span
 * objects, so clearing it from the list of one of them is not enough.
 */
'<button class="ss-foot-chip ss-foot-clear" ng-show="selectedDataForDownload.size" '+
'ng-click="clearSelectedData()" title="Clear the record selection">&times;</button>'+

/*
 * Sending what is in hand, from wherever you are.
 *
 * The chips beside these are counts - a number and a way in. These are acts,
 * so they are drawn as acts. Each appears only when it has a subject:
 * Deploy carries the ticked components, Migrate carries the ticked records,
 * and a button offering to send an empty selection can only refuse.
 *
 * They open Org Sync & Jobs rather than staging on the spot. Staging needs a
 * pipeline, there may be several, and a footer button that quietly picked
 * one would be choosing which org to write into on the user's behalf - the
 * one decision on that page worth making deliberately.
 */
'<button class="ss-foot-act" ng-show="selectedMetaForPackageXml.size" '+
'ng-click="openSyncJobs()" '+
'title="Send the {{selectedMetaForPackageXml.size}} selected component'+
'{{selectedMetaForPackageXml.size === 1 ? \'\' : \'s\'}} to another org - opens Org Sync &amp; Jobs">'+
'<span class="ss-foot-icon">&#8599;</span>Deploy ({{selectedMetaForPackageXml.size}})'+
'</button>'+

'<button class="ss-foot-act" ng-show="selectedDataForDownload.size" '+
'ng-click="openSyncJobs()" '+
'title="Send the {{selectedDataForDownload.size}} selected record'+
'{{selectedDataForDownload.size === 1 ? \'\' : \'s\'}} to another org - opens Org Sync &amp; Jobs">'+
'<span class="ss-foot-icon">&#8599;</span>Migrate ({{selectedDataForDownload.size}})'+
'</button>'+
'</div>'+
'<div class="ss-foot-right">'+
'<span class="ss-stat-tab" style="background:var(--ss-blue-tint); color:var(--ss-blue); border:1px solid var(--ss-blue-border);" title="Login origin countries">'+
'🌍 {{userStats.countriesCount || 1}} Location <span class="ss-stat-arrow-up">▲</span>'+
'</span>'+
'<a class="ss-coffee" href="https://buymeacoffee.com/rkroy" target="_blank" rel="noopener noreferrer" title="Buy me a coffee" style="font-size:16px; text-decoration:none; margin-left:4px;">☕</a>'+
'</div>'+
'</footer>';

this.content = '<sstoast></sstoast>'+
'<div ng-mouseleave="closeModel()" id="mySidenav" class="sidenav">'+
'<functionalitiesmenu></functionalitiesmenu>'+
'<div class="w3-container pageBlock">'+
'<div id="SimplifiedMainModal" class="w3-modal w3-animate-opacity" ng-class="{ssFullScreen: fullScreen}">'+
// Locked only while the overlay is actually up - once it is dismissed the
// panel is meant to be usable.
'<div class="w3-modal-content" ng-class="{ssLocked: !hasSession && !signInDismissed}">'+
'<signinoverlay></signinoverlay>'+
'<header class="w3-container modalheader">'+
'<h2>Salesforce Simplified</h2>'+
'<span id="ssOpenNewTabBtn" ng-click="openInNewTab()" class="w3-button w3-display-topright" title="Open in new tab">&#x2197;</span>'+
'<span id="ssFullScreenBtn" ng-click="toggleFullScreen()" class="w3-button w3-display-topright" '+
'title="{{fullScreen ? \'Exit full screen\' : \'Full screen\'}}">{{fullScreen ? \'⤡\' : \'⤢\'}}</span>'+
'<span id="SimplifiedMainModalCloseBtn" style="height: 14px; box-sizing: content-box;" ng-click="SimplifiedMainModalClose()" class="w3-button w3-display-topright">X</span>'+
'</header>'+
SS_PANEL_BODY+
SS_PANEL_FOOTER+

'</div>'+
'</div>'+
'</div>'+
'</div>';

/*
 * simplified.html: the same application, in a tab.
 *
 * The body and footer are SS_PANEL_BODY and SS_PANEL_FOOTER - literally the
 * panel's, not a copy - so the grid, the resizable rails, the sticky search
 * header and the stat tabs are the same markup reaching the same CSS. The
 * page looks and behaves like the panel because it *is* the panel.
 *
 * What differs is only the frame. Gone: .w3-modal and its backdrop, the
 * modal content box, the close button, the full screen toggle. Kept:
 * .modalheader, so the blue bar is the same bar, and w3-animate-opacity, so
 * it arrives the same way.
 *
 * The org selector stands where the close button did. A panel knows its org
 * because it was injected into it; a page has to be told.
 */
this.page = '<sstoast></sstoast>'+
'<div class="ss-page w3-animate-opacity" ng-class="{ssLocked: !hasSession && !signInDismissed}">'+
'<signinoverlay></signinoverlay>'+
'<header class="w3-container modalheader">'+
'<h2>Salesforce Simplified</h2>'+
'<div class="ss-page-org w3-display-topright">'+
'<label for="ssOrgPicker">Org</label>'+
// Shown even with nothing in it, because it is no longer only a list: the
// last entry is how another org gets added, and hiding the control until an
// org exists hid the only way to get one.
'<select id="ssOrgPicker" ng-model="currentOrigin" ng-change="switchOrg()" '+
'ng-options="org.origin as org.label for org in orgOptions"></select>'+
'<span class="ss-page-org-empty" ng-show="!knownOrgs.length">'+
'Or open the panel on a Salesforce tab once, and that org appears here.</span>'+
'</div>'+
'</header>'+
SS_PANEL_BODY+
SS_PANEL_FOOTER+
'</div>';


}]);