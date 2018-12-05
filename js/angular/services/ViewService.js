app.service('viewservice', ['MetaDataContainer', function(MetaDataContainer, $scope) {

var editicon = chrome.extension.getURL("/img/edit.png");
var downloadicon = chrome.extension.getURL("/img/download.png");
var securityicon = chrome.extension.getURL("/img/security.png");

var viewicon = chrome.extension.getURL("/img/view.png");
var changeicon = chrome.extension.getURL("/img/change.png");
var cloneicon = chrome.extension.getURL("/img/clone.png");
var loadingcar = chrome.extension.getURL("/img/loadingcar.gif");
var paypalicon = chrome.extension.getURL("/img/paypal.png");
var upiicon = chrome.extension.getURL("/img/upi.png");
var searchicon = chrome.extension.getURL("/img/search.png");

//Salesforce Simplified - V2
var ss_dis = chrome.extension.getURL("/img/ss_icon_disable.png");
var ss_ena = chrome.extension.getURL("/img/ss_icon_enable.png");

var viewas = chrome.extension.getURL("/img/icons/viewas.png");
var classes = chrome.extension.getURL("/img/icons/classes.png");
var triggers = chrome.extension.getURL("/img/icons/triggers.png");
var labels = chrome.extension.getURL("/img/icons/labels.png");
var objects = chrome.extension.getURL("/img/icons/objects.png");
var fields = chrome.extension.getURL("/img/icons/fields.png");
var flows = chrome.extension.getURL("/img/icons/flows.png");
var workflows = chrome.extension.getURL("/img/icons/workflows.png");
var users = chrome.extension.getURL("/img/icons/users.png");
var debuglogs = chrome.extension.getURL("/img/icons/debuglogs.png");
var pages = chrome.extension.getURL("/img/icons/pages.png");
var components = chrome.extension.getURL("/img/icons/components.png");
var emailtemplates = chrome.extension.getURL("/img/icons/emailtemplates.png");
var staticresources = chrome.extension.getURL("/img/icons/staticresources.png");
var coverages = chrome.extension.getURL("/img/icons/coverages.png");
var about = chrome.extension.getURL("/img/icons/about.png");
var faqicon = chrome.extension.getURL("/img/icons/faq.png");
var close = chrome.extension.getURL("/img/icons/close.png");
var recentitems = chrome.extension.getURL("/img/icons/recentitems.png");
var allitems = chrome.extension.getURL("/img/icons/moreitems.png");
var AuraDefinitionBundles = chrome.extension.getURL("/img/icons/AuraDefinitionBundles.png");

var red = chrome.extension.getURL("/img/ss_icon_enable.png");
var blue = chrome.extension.getURL("/img/ss_icon_enable_blue.png");
var pink = chrome.extension.getURL("/img/ss_icon_enable_pink.png");
var purple = chrome.extension.getURL("/img/ss_icon_enable_purple.png");
var darkblue = chrome.extension.getURL("/img/ss_icon_enable_darkblue.png");
var amazon = chrome.extension.getURL("/img/ss_icon_enable_amazon.png");
var yellow = chrome.extension.getURL("/img/ss_icon_enable_yellow.png");
var bronze = chrome.extension.getURL("/img/ss_icon_enable_bronze.png");

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

var allitemsContent = '<table class="allitems"><tr>'+
'<td Class="tooltip-me innermenuicon" ng-switch on="menu.value" ng-click="detailsPopupOpen(menu)" ng-repeat="menu in allMenu | filter:searchMenu" data-title="{{menu.label}}">'+
'<img ng-switch-when="ChangeUser" src="'+viewas+'"/>'+
'<img ng-switch-when="DebugLogs" class="menuicon" src="'+debuglogs+'"/>'+
'<img ng-switch-when="RecentlyViewed" class="menuicon" src="'+recentitems+'"/>'+
'<img ng-switch-when="Classes" class="menuicon" src="'+classes+'"/>'+
'<img ng-switch-when="Triggers" class="menuicon" src="'+triggers+'"/>'+
'<img ng-switch-when="Pages" class="menuicon" src="'+pages+'"/>'+
'<img ng-switch-when="Objects" class="menuicon" src="'+objects+'"/>'+
'<img ng-switch-when="Fields" class="menuicon" src="'+fields+'"/>'+
'<img ng-switch-when="AuraDefinitionBundle" class="menuicon" src="'+AuraDefinitionBundles+'"/>'+
'<img ng-switch-when="Components" class="menuicon" src="'+components+'"/>'+
'<img ng-switch-when="Labels" class="menuicon" src="'+labels+'"/>'+
'<img ng-switch-when="Workflows" class="menuicon" src="'+workflows+'"/>'+
'<img ng-switch-when="Flows" class="menuicon" src="'+flows+'"/>'+
'<img ng-switch-when="EmailTemplates" class="menuicon" src="'+emailtemplates+'"/>'+
'<img ng-switch-when="Users" class="menuicon" src="'+users+'"/>'+
'<img ng-switch-when="StaticResource" class="menuicon" src="'+staticresources+'"/>'+
'<img ng-switch-when="ApexCodeCoverageAggregate" class="menuicon" src="'+coverages+'"/>'+
'<img ng-switch-when="About" class="menuicon" src="'+about+'"/>'+
'<img ng-switch-when="Faq" class="menuicon" src="'+faqicon+'"/>'+
'</td>'+
'</tr></table>';

var searchCode = ' <fieldset><legend>Select Metadata</legend><table class="searchCodeTable">'+
'   <tr><td><select ng-model="selectedMetaMenu" ng-change="searchMetadata(selectedMetaMenu)" ng-options="selectedMetaMenu.label for selectedMetaMenu in AdvanceSearchMenu | filter:selectedMetaMenu.EligibleForAdvanceSearch = true"><option value="">-- Select Metadata --</option></select></td></tr>'+
'   <tr><td><input type="text" ng-change="searchMetadataIfNothingTyped()" id="data" placeholder="Advance Search" ng-model="searchAllMetaData"/><img title="Search users" src="'+searchicon+'" width="18px" height="18px" Class="imgSearch" ng-click="searchMetadataRecordsOnChange()"/></td></tr>'+
'   </table></fieldset><div ng-show="showAllData">'+
'   <table><tr ng-repeat="r in filterItem = (AllMetaDataRecords | filter:searchAllMetaData) track by $index">'+
'   <td ng-if="r.Name"><a href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.Name}}</a></td>'+
'   <td ng-if="r.DeveloperName"><a href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.DeveloperName}}</a></td>'+
'   <td ng-if="r.LogLength"><a class="trim-info1" title="View - {{r.Operation}}" target="_blank" href="{{baseUrl}}/p/setup/layout/ApexDebugLogDetailEdit/d?setupid=ApexDebugLogs&apex_log_id={{r.Id}}">{{r.Operation}}</a></td>'+
'   <td ng-if="r.LogLength"><a class="trim-info1" title="Download - {{r.Operation}}({{r.LogLength}} bytes)" target="_blank" href="{{baseUrl}}/servlet/servlet.FileDownload?file={{r.Id}}">{{r.LogLength}}</a></td>'+
'   <td ng-if="r.NumLinesCovered" title="NumLinesCovered - {{r.NumLinesCovered}} NumLinesUncovered - {{r.NumLinesUncovered}}, TotalLine - {{r.NumLinesCovered + r.NumLinesUncovered}}"><a>{{r.NumLinesCovered/(r.NumLinesCovered+r.NumLinesUncovered)*100 | number : 2}}%</a></td>'+
'   <td ng-if="r.NumLinesCovered"><a href="{{baseUrl}}/{{r.ApexClassorTriggerId}}" title="View - {{r.ApexClassOrTrigger.Name}}" target="_blank">{{r.ApexClassOrTrigger.Name}}</a></td>'+
'   </tr></table> '+
'	</div>'+
//'  <div ng-if="showErrorMessage && selectedMetadata1.isSearchable" class="ErrorMessage">{{ErrorMsg}}</div>'+
'  <div ng-if="showloading && selectedMetadata1.type" class="loadingARILoading"><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/>'+
'<span class="loadingARI">Fetching {{selectedMetadata1.label}}...</span>'+
'</div>';
var aboutARI = '<table class="aboutARITable">'+
'   <tr><td colspan="2"><h3>Salesforce Simpified</h3></td></tr>'+
'   <tr><td colspan="2"><a href="https://github.com/rajnikantroy/Salesforce-Simplified" target="_blank" title="See how you can use Salesforce Simpified.">How to use</a></td></tr>'+
'   <tr><td colspan="2"><a href="https://github.com/rajnikantroy/Salesforce-Simplified/issues/new" target="_blank" title="If you getting any issue, please report on github." >Report Issue</a></td></tr>'+
'   <tr><td colspan="2"><a href="mailto:rajkant020@gmail.com?subject=Feedback/Suggestions of Salesforce Simpified" title="If you have any feedback/suggestions, please mailto rajkant020@gmail.com." target="_blank">Feedback and Suggestions</a></td></tr>'+
'   <tr><td colspan="2"><a href="https://www.linkedin.com/in/rajnikantroy" title="Connect with Rajni Kant Roy on linkedin" target="_blank">Connect with developer</a></td></tr>'+
'   <tr><td colspan="2"><a href="https://www.fb.com/salesforcesimplified" title="Contribute via paypal/upi" target="_blank">Follow on facebook</a></td></tr>'+
'   <tr><td colspan="2"><a href="" title="Contribute via paypal/upi" ng-click="showpayment()" target="_blank">Donate</a></td></tr>'+
'   <tr title="Contribute via paypal/upi"><td style="vertical-align: inherit;" ng-show="showpaymentflag"><a href="https://www.paypal.me/rajnikantroy" target="_blank"><img title="Contribute via paypal" src="'+paypalicon+'"/></a></td><td ng-show="showpaymentflag"><img title="Contribute via BHIM/Tez/Any UPI app." src="'+upiicon+'" width="200px" height="200px"/></td></tr>'+
'   <tr title="Contribute via paypal/upi"><td style="vertical-align: inherit;" ng-show="showpaymentflag"><a href="https://www.paypal.me/rajnikantroy" target="_blank"><b>Donate via paypal</b></a></td><td ng-show="showpaymentflag"><b>Donate via UPI(Tez/BHIM etc.)</b></td></tr>'+
'   </table>';

var changeUser = '<fieldset><legend>Search User</legend><table class="searchUserTable">'+
'   <tr><td><span><input type="text" id="searchUserText" ng-model="searchUserModel" placeholder="Search user" placeholder="Search user"/><img title="Search users" src="'+searchicon+'" width="18px" height="18px" Class="imgSearch" ng-click="searchUser()"/> </span></td></tr>'+
'   </table></fieldset>'+
'  <div ng-if="showloading" class="loadingARILoading"><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/>'+
//'<span ng-if="showloading && selectedMetadata.type" class="loadingARI">Fetching {{selectedMetadata.label}}...</span>'+
'<span ng-if="showloading" class="loadingARI">Fetching Users...</span>'+
'</div>';

this.functionalitiesMenu = '<table class="mainmenuTable"><tr ng-switch on="menu.value" ng-if="menu.formainmenu" ng-click="detailsPopupOpen(menu)" ng-repeat="menu in allMenu | filter:searchMenu">'+
'<td Class="tooltip-me" data-title="{{menu.label}}">'+
'<img ng-switch-when="ChangeUser" class="menuicon" src="'+viewas+'"/>'+
'<img ng-switch-when="RecentlyViewed" class="menuicon" src="'+recentitems+'"/>'+
'<img ng-switch-when="DebugLogs" class="menuicon" src="'+debuglogs+'"/>'+
'<img ng-switch-when="Classes" class="menuicon" src="'+classes+'"/>'+
'<img ng-switch-when="Triggers" class="menuicon" src="'+triggers+'"/>'+
'<img ng-switch-when="Pages" class="menuicon" src="'+pages+'"/>'+
'<img ng-switch-when="Objects" class="menuicon" src="'+objects+'"/>'+
//'<img ng-switch-when="Fields" class="menuicon" src="'+fields+'"/>'+
'<img ng-switch-when="AuraDefinitionBundle" class="menuicon" src="'+AuraDefinitionBundles+'"/>'+
'<img ng-switch-when="Labels" class="menuicon" src="'+labels+'"/>'+
//'<img ng-switch-when="StaticResource" class="menuicon" src="'+staticresources+'"/>'+
//'<img ng-switch-when="Components" class="menuicon" src="'+components+'"/>'+
//'<img ng-switch-when="Workflows" class="menuicon" src="'+workflows+'"/>'+
//'<img ng-switch-when="Flows" class="menuicon" src="'+flows+'"/>'+
//'<img ng-switch-when="EmailTemplates" class="menuicon" src="'+emailtemplates+'"/>'+
//'<img ng-switch-when="Users" class="menuicon" src="'+users+'"/>'+
//'<img ng-switch-when="ApexCodeCoverageAggregate" class="menuicon" src="'+coverages+'"/>'+
'<img ng-switch-when="About" class="menuicon" src="'+about+'"/>'+
//'<img ng-switch-when="Faq" class="menuicon" src="'+faqicon+'"/>'+
//'<img ng-switch-when="allitems" class="menuicon" src="'+allitems+'"/>'+
'</td>'+
'</tr></table>';
/*
this.functionalitiesMenu = '<table class="mainmenuTable">'+
'<tr><td Class="tooltip-me" ng-click="detailsPopupOpenFromMainMenu()" data-title="Salesforce Metadata"><img class="menuicon" src="'+recentitems+'"/></td></tr>'+
'<tr><td Class="tooltip-me" ng-click="packageXmlSidenavOpen()" data-title="Package.xml"><img class="menuicon" src="'+objects+'"/></td></tr>'+
'<tr><td Class="tooltip-me" ng-click="createPackageXml()" data-title="Mini Workbench"><img class="menuicon" src="'+workflows+'"/></td></tr>'+
'<tr><td Class="tooltip-me" ng-click="createPackageXml()" data-title="about"><img class="menuicon" src="'+about+'"/></td></tr>'+
//'<img ng-switch-when="Faq" class="menuicon" src="'+faqicon+'"/>'+
//'<img ng-switch-when="allitems" class="menuicon" src="'+allitems+'"/>'+
//'</td>'+
'</table>';
*/

this.articles = '  <div Class="searchCodeFieldset" ng-show="selectedMetadata.label == home">'+searchCode+'</div>'+
'  <div Class="searchCodeFieldset" ng-if="selectedMetadata.value == about">'+aboutARI+'</div>'+
'  <div Class="faqOfSalesforceSimplified" ng-show="selectedMetadata.label == faq">'+faq+'</div>';

this.usersrecords = '<span class="hrtitle ARITitleTitle" ng-show="!showErrorMessage && selectedMetadata.isSearchable"><p ng-show="selectedMetadata.value != change">{{uname}} {{selectedMetadata.label}} ({{total_records}})</p><br/><p ng-show="unamewithoutastr && selectedMetadata.value != change" class="recorddescription">These {{selectedMetadata.label}} are recently created/modified by {{unamewithoutastr}}</p><br ng-show="selectedMetadata.value == fields"><p ng-show="selectedMetadata.value == change">Click on view as button</p><hr class="sshr"/></span>'+

'<div ng-if="showloading && selectedMetadata.type" class="loadingARILoading"><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/>'+
'<span ng-if="showloading && selectedMetadata.type" class="loadingARI">Fetching {{selectedMetadata.label}}...</span>'+
'</div>'+
'  <table class="Records" id="RecentRecords" ng-if="records" ng-show="!showErrorMessage">'+
'   <tr ng-repeat="r in records | filter:searchAllMetaData">'+
'   <td class="action" ng-show="r.LogLength || r.Name || r.email || r.DeveloperName || r.Type" ng-repeat="faction in selectedMetadata.fieldlevelactions">'+
'       <a ng-if="faction.name == view" target="_blank" href="{{baseUrl}}/{{faction.actionUrl}}{{r.Id}}">{{faction.name}}</a>'+
'       <a ng-show="faction.name == change" ng-click="changeUser(r.Id)" title="Click to change user">View as <img src="'+changeicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == edit && selectedMetadata.value != AssignmentRule" target="_blank" href="{{baseUrl}}/{{r.Id}}{{faction.actionUrl}}" data-title="Edit" Class="tooltip-me"><img src="'+editicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == edit && selectedMetadata.value == AssignmentRule" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}" data-title="Edit" Class="tooltip-me"><img src="'+editicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == download" target="_blank" href="{{baseUrl}}/{{faction.actionUrl}}{{r.Id}}"data-title="Download" Class="tooltip-me"><img src="'+downloadicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == security" target="_blank" href="{{baseUrl}}{{securityPreUrl}}{{r.Id}}{{faction.actionUrl}}{{r.Name}}" data-title="Security" Class="tooltip-me"><img src="'+securityicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == clsSecurity" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}&apex_name={{r.Name}}" data-title="Security" Class="tooltip-me"><img src="'+securityicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == clone" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}" Class="tooltip-me" data-title="Clone"><img  src="'+cloneicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == cloneWF" target="_blank" href="{{baseUrl}}/{{r.Id}}{{faction.actionUrl}}" Class="tooltip-me" data-title="Clone"><img  src="'+cloneicon+'" width="20px" height="20px"/></a>'+
'   </td>'+
'	<td ng-if="selectedMetadata.eligibleForPackageXml" class="action"><input class="regular-checkbox" id="userData_{{r.Id}}" ng-click="SelectMetadataForManagedPackage(r.Id, r.selected)" type="checkbox" ng-model="r.selected" /></td>'+
'   <td ng-if="r.LogLength" class="tooltip-me" data-title="View - {{r.Operation}}({{r.LogLength}} bytes)"><a class="trim-info" target="_blank" href="{{baseUrl}}/p/setup/layout/ApexDebugLogDetailEdit/d?setupid=ApexDebugLogs&apex_log_id={{r.Id}}">{{r.LogLength}}</a></td>'+
'   <td ng-if="r.LogLength" class="tooltip-me" data-title="View - {{r.Operation}}({{r.LogLength}} bytes)"><a class="trim-info" target="_blank" href="{{baseUrl}}/p/setup/layout/ApexDebugLogDetailEdit/d?setupid=ApexDebugLogs&apex_log_id={{r.Id}}">{{r.Operation}}</a></td>'+
'   <td class="RecentTime" ng-if="r.LogLength">{{r.StartTime | date:"MM/dd hh:mm:ss Z"}}</td>'+
//'   <td ng-if="r.Name && !selectedMetadata.midurl" Class="tooltip-me" data-title="{{r.Name}}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.Name}}</a></td>'+
'   <td ng-if="r.Name" Class="tooltip-me" data-title="{{r.Name}}"><a Class="trim-info-content" href="{{baseUrl}}/{{selectedMetadata.midurl}}{{r.Id}}" target="_blank">{{r.Name}}</a></td>'+

'   <td ng-if="r.email" Class="tooltip-me" data-title="{{r.username}}"><a Class="trim-info-content" target="_blank">{{r.username}}</a></td>'+
'   <td ng-if="r.DeveloperName" data-title="{{r.DeveloperName}}" class="tooltip-me"><a Class="trim-info-content" href="{{baseUrl}}/{{selectedMetadata.midurl}}{{r.Id}}" target="_blank">{{r.DeveloperName}}</a></td>'+
//'   <td ng-if="r.DeveloperName && !selectedMetadata.midurl" data-title="{{r.DeveloperName}}" class="tooltip-me"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.DeveloperName}}</a></td>'+
'   <td ng-if="r.Type" Class="trim-info-type">{{r.Type}}</td>'+
'   </tr>'+
'</table> '+
' <span ng-if="records.length==0 && !showloading">{{selectedMetadata.dataNotAvailableMessage}}</span> </br>';

this.allrecords = '<span ng-show="selectedMetadata.isSearchable" class="hrtitle ARITitleTitle" ng-if="AllMetaDataRecords.length>0" ng-show="!showErrorMessage"><p ng-show="selectedMetadata.value != change">All {{selectedMetadata.label}} ({{totalSize_AllMetaDataRecords}})</p><br/><p ng-show="unamewithoutastr && selectedMetadata.value != change" class="recorddescription">These {{selectedMetadata.label}} are recently created/modified by all developers in org.</p><p ng-show="selectedMetadata.value == change">View as different user</p><hr class="sshr"/></span>'+

'<div ng-if="showallloading && selectedMetadata.type" class="loadingARILoading"><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/>'+
'<span ng-if="showallloading && selectedMetadata.type" class="loadingARI">Fetching all {{selectedMetadata.label}}...</span>'+
'</div>'+

'  <table class="Records" id="AllRecords" ng-if="AllMetaDataRecords" ng-show="!showErrorMessage">'+
'   <tr ng-repeat="r in filterItem = (AllMetaDataRecords | filter:searchAllMetaData) track by $index">'+
'   <td class="action" ng-show="r.LogLength || r.Name || r.DeveloperName" ng-repeat="faction in selectedMetadata.fieldlevelactions">'+
'       <a ng-if="faction.name == view" target="_blank" href="{{baseUrl}}/{{faction.actionUrl}}{{r.Id}}">{{faction.name}}</a>'+
'       <a ng-show="faction.name == change" Class="changeUser" ng-click="changeUser(r.Id)" ng-click="changeUser(r.Id)">View as</a>'+
'       <a ng-if="faction.name == edit && selectedMetadata.value != AssignmentRule" target="_blank" href="{{baseUrl}}/{{r.Id}}{{faction.actionUrl}}" data-title="Edit" Class="tooltip-me"><img src="'+editicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == edit && selectedMetadata.value == AssignmentRule" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}" data-title="Edit" Class="tooltip-me"><img src="'+editicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == download" target="_blank" href="{{baseUrl}}/{{faction.actionUrl}}{{r.Id}}" Class="tooltip-me" data-title="Download"><img src="'+downloadicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == security" target="_blank" href="{{baseUrl}}{{securityPreUrl}}{{r.Id}}{{faction.actionUrl}}{{r.Name}}" Class="tooltip-me" data-title="Security"><img src="'+securityicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == clsSecurity" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}&apex_name={{r.Name}}" Class="tooltip-me" data-title="Security"><img src="'+securityicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == clone" target="_blank" href="{{baseUrl}}{{faction.actionUrl}}{{r.Id}}" Class="tooltip-me" data-title="Clone"><img  src="'+cloneicon+'" width="20px" height="20px"/></a>'+
'       <a ng-if="faction.name == cloneWF" target="_blank" href="{{baseUrl}}/{{r.Id}}{{faction.actionUrl}}" Class="tooltip-me" data-title="Clone"><img  src="'+cloneicon+'" width="20px" height="20px"/></a>'+
'   </td>'+
'	<td ng-if="selectedMetadata.eligibleForPackageXml" class="action"><input class="regular-checkbox" id="allData_{{r.Id}}" ng-click="SelectMetadataForManagedPackage(r.Id, r.selected)" type="checkbox" ng-model="r.selected" /></td>'+
'   <td ng-if="r.LogLength" class="tooltip-me" data-title="View - {{r.Operation}}({{r.LogLength}} bytes)" ><a class="trim-info" target="_blank" href="{{baseUrl}}/p/setup/layout/ApexDebugLogDetailEdit/d?setupid=ApexDebugLogs&apex_log_id={{r.Id}}">{{r.LogLength}}</a></td>'+
'   <td ng-if="r.LogLength" class="tooltip-me" data-title="View - {{r.Operation}}({{r.LogLength}} bytes)"><a class="trim-info" target="_blank" href="{{baseUrl}}/p/setup/layout/ApexDebugLogDetailEdit/d?setupid=ApexDebugLogs&apex_log_id={{r.Id}}">{{r.Operation}}</a></td>'+
'   <td class="RecentTime" ng-if="r.LogLength">{{r.StartTime | date:"MM/dd hh:mm:ss Z"}}</td>'+
//'   <td ng-if="r.Name" data-title="{{r.Name}}" class="tooltip-me"><a class="trim-info-content" href="{{baseUrl}}/{{r.Id}}"  target="_blank">{{r.Name}}</a></td>'+
//'   <td ng-if="r.Name && !selectedMetadata.midurl" Class="tooltip-me" data-title="{{r.Name}}"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.Name}}</a></td>'+
'   <td ng-if="r.Name" Class="tooltip-me" data-title="{{r.Name}}"><a Class="trim-info-content" href="{{baseUrl}}/{{selectedMetadata.midurl}}{{r.Id}}" target="_blank">{{r.Name}}</a></td>'+

'   <td ng-if="r.DeveloperName" data-title="{{r.DeveloperName}}" class="tooltip-me"><a Class="trim-info-content" href="{{baseUrl}}/{{selectedMetadata.midurl}}{{r.Id}}" target="_blank">{{r.DeveloperName}}</a></td>'+
//'   <td ng-if="r.DeveloperName && !selectedMetadata.midurl" data-title="{{r.DeveloperName}}" class="tooltip-me"><a Class="trim-info-content" href="{{baseUrl}}/{{r.Id}}" target="_blank">{{r.DeveloperName}}</a></td>'+

//'   <td ng-if="r.DeveloperName" data-title="{{r.DeveloperName}}" class="tooltip-me"><a class="{trim-info-content: AllMetaDataRecords.value != AuraDefinitionBundle }" href="{{baseUrl}}/{{r.Id}}"  target="_blank">{{r.DeveloperName}}</a></td>'+
'   </tr></table> ';

this.objectlevelaction = '<span class="hrtitle ARITitleTitle" ng-click="openObjectList()"><p style="margin-top: 0px;" class="tooltip-me" data-title="{{selectedMetadata.tooltipMessage}}">{{selectedMetadata.label}}</p><hr class="sshr"/></span>'+
'  <table class="ARITitleTable">'+
//'   <tr ng-if="!selectedMetadata.listUrl"><td class="ARITitleTitleWithoutCursor">{{selectedMetadata.label}}</td></tr>'+
'<tr ng-if="!selectedMetadata.listUrl"><td class="ARITitleData" ng-repeat="action in selectedMetadata.objectlevelaction">'+
'<a target="_blank" Class="tooltip-me" data-title="action.name" href="{{action.actionUrl}}">{{action.name}}</a>'+
'<td/></tr>'+
//'   <tr ng-if="selectedMetadata.listUrl"><td class="ARITitleTitle" ng-click="openObjectList()">{{selectedMetadata.label}}</td></tr>'+
'<tr ng-if="selectedMetadata.listUrl"><td class="ARITitleData" ng-repeat="action in selectedMetadata.objectlevelaction">'+
'<a target="_blank" Class="tooltip-me" data-title="{{action.name}}" href="{{action.actionUrl}}">{{action.name}}</a>'+
'<td/></tr></table>';

this.metadatamainmenu = '<table class="mainmenuSidebar">'+
'<tr><th><center><b>Metadata</b><center></th></tr>'+
'<tr ng-click="detailsPopupOpen(menu)" ng-repeat="menu in allMenu">'+
'<td Class="menusidebarText" data-title="{{menu.label}}">{{menu.label}}</td></tr></table>';

this.developeranalysis = ' <table Class="userlist" ng-show="userFrequencyList.length && userFrequencyList.length>0 && selectedMetadata.isSearchable && showUserFrequency"><tr><td colspan="2"><b>Navigate by developers</b><br/><p class="toptendevelopersDescription">Top modifiers of recent {{totalSize_AllMetaDataRecords}} {{selectedMetadata.label}}</p></td></tr><tr ng-repeat="userFrequency in userFrequencyList track by $index | limitTo:quantity">'+
' <td class="username-trim" title="{{userFrequency.username}}" ng-click="searchForUser(userFrequency.username)" >{{userFrequency.username}}</td><td ng-click="searchForUser(userFrequency.username)" class="td2">{{userFrequency.frequency}}</td>'+
'</tr></table>'+
'<div ng-if="showallloading && selectedMetadata.type" class="loadingARILoading"><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/>'+
'<span ng-if="showallloading && selectedMetadata.type" class="loadingARI">Analyzing top 10 developers for {{selectedMetadata.label}}...</span>'+
'</div>';

this.searchdata = '<select Class="limit tooltip-me" data-title="Select record limit to query" ng-model="selectedlength" ng-change="detailsPopupOpenByOption(selectedMenu, selectedlength)" ng-options="len for len in lengthList">'+
'<option value="" selected>200</option> </select>'+
'<input type"text" ng-change="searchMetadataIfNothingTyped()" class="SearchData ss_input_searchaddData" placeholder="{{selectedMetadata.placeholderText}}" ng-model="searchAllMetaData"/>'+
'<button Class="SearchAll" title="Force search" ng-click="searchMetadataRecordsOnChange()">Search All</button></span>';

//this.userdetails = '<span id="recentItemOf"><p id="username" ng-click="detailsPopupOpen(allMenu[0])" Class="trim-info viewasdifferentuser tooltip-me" data-title="View as different user"></p></span>';
this.userdetails = '<div class="userdetails"><b>Viewing as</b></br><span id="userfullname"></span></br> <span id="username" class="trim-info"></span></br><p ng-show="ErrorMsg">{{ErrorMsg}}</p><button class="viewasdifferentuser" ng-click="detailsPopupOpen(allMenu[0])" href=""> View as different user</button></div>';

this.packagexml = '<div ng-show="selectedMetaForPackageXml.size" class="userdetails"><b>Create package.xml</b><span id="userfullname"></span><p id="numberOfMetaDataInPackageXml">{{selectedMetaForPackageXml.size}}</p><button ng-click="VerifyPackage()" class="viewasdifferentuser" href=""> Verify package.xml</button></br><tr><td colspan="2"><button ng-show="selectedMetadata.value == packagexml" ng-click="downloadPackageXml()" class="viewasdifferentuser" style="background: rgb(48, 100, 133);"> Download package.xml</button></td></tr></div>';

this.packagexmleditor = '<div Class="searchCodeFieldset" ng-show="selectedMetadata.value == packagexml"><textarea ng-model="str" rows="37" style="margin-top: -23px; width: 150%;" cols="50"></textarea></div>';

this.packagexmlaction = '';

this.launchercolor = '<div class="launcherColor" ng-show="selectedMetadata.value==launchercolor"> <table> <tr> <td><img src="'+blue+'"/></br><input type="radio" name="color" ng-click="setColorInCookie(\'Blue\')" value="Blue"> Blue</td><td><img src="'+pink+'"/></br><input type="radio" name="color" ng-click="setColorInCookie(\'Pink\')" value="Pink"> Pink</td><td><img src="'+red+'"/></br><input type="radio" name="color" ng-click="setColorInCookie(\'Red\')" value="Red"> Red<td><img src="'+purple+'"/></br><input type="radio" name="color" ng-click="setColorInCookie(\'Purple\')" value="Purple"> Purple</td></tr><tr></td><td><img src="'+yellow+'"/></br><input type="radio" name="color" ng-click="setColorInCookie(\'Yellow\')" value="Yellow"> Yellow</td><td><img src="'+amazon+'"/></br><input type="radio" name="color" ng-click="setColorInCookie(\'Amazon\')" value="Amazon"> Amazon</td><td><img src="'+bronze+'"/></br><input type="radio" name="color" ng-click="setColorInCookie(\'Bronze\')" value="Bronze"> Bronze</td><td><img src="'+darkblue+'"/></br><input type="radio" name="color" ng-click="setColorInCookie(\'Dark Blue\')" value="Dark Blue"> Dark Blue</td></tr>';

this.packagexmlfrequency = '<table ng-show="selectedMetadata.value == packagexml" Class="userlist"><tr><td colspan="2"><b>Selection Summary</b></td></tr><tr ng-repeat="metaFrequency in packageMetaDataFrequency track by $index">'+
' <td Class="tooltip-me td1" data-title="You have selected {{metaFrequency.Frequency}} {{metaFrequency.Type}} for package.xml">{{metaFrequency.Type}}</td><td class="td2">{{metaFrequency.Frequency}}</td>'+
'</tr></table>';

this.content = '<div ng-mouseleave="closeModel()" id="mySidenav" class="sidenav">'+
'<functionalitiesmenu></functionalitiesmenu>'+
'<div class="w3-container pageBlock">'+
'<div id="SimplifiedMainModal" class="w3-modal  w3-animate-opacity">'+
'<div class="w3-modal-content">'+
'<header class="w3-container modalheader"> '+
'<h2>Salesforce Simplified</h2>'+
  '<span id="SimplifiedMainModalCloseBtn" style="height: 14px;     box-sizing: content-box;" ng-click="SimplifiedMainModalClose()" class="w3-button w3-display-topright">X</span>'+
'</header>'+
  '<div class="w3-container" style="height:475px; overflow-y: scroll;">'+
  '<table width="100%" syle="top:0; position: fixed;">'+
  '<tr>'+
  '<td style="position: fixed;overflow: auto;">'+
  '<metadatamainmenu></metadatamainmenu>'+
  '</td>'+
  '<td colspan=2""><table width="100%" style="margin-left: -20px;"><tr><td><objectlevelaction></objectlevelaction></td></tr><tr><td><searchdata ng-show="selectedMetadata.isSearchable"></searchdata></td></tr></table></td></tr>'+
  '<tr>'+	
  '<td>'+
  
  '</td>'+
    '<td width="60%">'+
	'<table style="margin-left: -20px;">'+
	'<tr><td><usersrecords></usersrecords></td></tr>'+
	'<tr><td><allrecords></allrecords></td></tr>'+
	'<tr><td><articles></articles></td></tr>'+
	'<tr><td><packagexmleditor></packagexmleditor></td></tr>'+
	'<tr><td><launchercolor></launchercolor></td></tr>'+
	'</table>'+
    
  '</td>'+
    '<td width="20%" style="vertical-align: text-top;">'+
    '<table>'+
	'<tr><td><userdetails></userdetails></td></tr>'+
	'<tr><td><packagexml></packagexml></td></tr>'+
	'<tr><td><developeranalysis></developeranalysis></td></tr>'+
	'<tr><td><packagexmlfrequency></packagexmlfrequency></td></tr>'+
	'</table>'+
	
  '</td>'+
  '</tr>'+

  '</table>'+
  
  '</div>'+
  '<footer class="w3-container modalfooter">'+
  '<table width="100%"><tr>'+
  '<td class="bold"><a target="_blank" href="https://chrome.google.com/webstore/detail/salesforce-simplified/hjeigbpcblpkaienmpihneipkempijob?hl=en">Rate Us on chrome</a></td>'+
  '<td class="bold"><a target="_blank" href="https://fb.com/salesforcesimplified">Facebook Page</a></td>'+
  '<td class="bold"><a target="_blank" href="https://github.com/rajnikantroy/SalesforceSimplified/issues">Report Issue</a></td>'+
  '<td class="bold"><a target="_blank" href="https://salesforcesimplify.blogspot.com">Salesforce Simplified</a></td>'+
'</tr></table>'+
'</footer>'+
'</div>'+
'</div>'+
'</div>'+

'</div>';


this.content1 = '<div ng-mouseleave="closeModel()" id="mySidenav" class="sidenav">'+
'<functionalitiesmenu></functionalitiesmenu>'+

//Simplified Recent Items
'<div id="fullDataSidenav" ng-keypress="changed($event)" class="detailsidenav">'+
//'<div class="ARISearch salesforcesimplifiedHeader">'+
//'<span class="salesforcesimplifiedTitle">Salesforce Simpified (We are open source now)</span>'+
//'</div>'+
//'  <a href="javascript:void(0)" id="aboutusSidenav_closebtn" ng-click="loadDataClosebtn()" class="closebtn">&times;</a>'+
'<table class="sfdcSimplifiedContent">'+
'<tr>'+
'<td style="width:250px">'+
'<metadatamainmenu></metadatamainmenu>'+
'</td>'+
'<td>'+

'<table class="sfdcSimplifiedContentData">'+
'<tr>'+
'<td colspan="2">'+
'<objectlevelaction></objectlevelaction>'+
'</td>'+
'</tr>'+

'<tr>'+
'<td colspan="2" style="padding-top: 10px;">'+
'<searchdata ng-show="selectedMetadata.isSearchable"></searchdata>'+
'</td>'+
'</tr>'+

'<tr>'+
'<td class="td1">'+
'<usersrecords></usersrecords>'+
'<allrecords></allrecords>'+
'<articles></articles>'+
'<packagexmleditor></packagexmleditor>'+
'</td>'+
'<td class="td2">'+
'<userdetails></userdetails>'+
'<packagexml></packagexml>'+
'<developeranalysis></developeranalysis>'+
'<packagexmlfrequency></packagexmlfrequency>'+
'</td>'+
'</tr>'+
'</table>'+

'</td>'+
'</tr>'+
'</table>'+
'</div>';

}]);
