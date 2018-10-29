app.service('mygridviewservices', ['MetaDataContainer', function(MetaDataContainer, $scope, UserId) {
	var loadingcar = chrome.extension.getURL("/img/loadingcar.gif");
	this.debugloggrid ='<div class="w3-container pageBlock">'+
	  '<div id="debuglogGridModal" class="w3-modal  w3-animate-opacity">'+
	    '<div class="w3-modal-content modal-back modalcustomstyle">'+
	    '<header class="w3-container modalheader"> '+
	    '<h2>{{uname}} Debug Logs</h2>'+
	      '<span id="debuglogGridCloseBtn" ng-click="DebugLogClose()" class="w3-button w3-display-topright">X</span>'+
	    '</header>'+
	    '<div class="w3-container">'+
	    '<table class="list" ng-show="dataList.length">'+
        '<tr class="headerRow">'+
	        '<td width="25%"><input type="button" ng-click="deleteMyLogs()" value="Delete My Logs" class="btn" style="background: #1796bf; color: white;"/></td>'+
			'<td width="50%"><input style="width: -webkit-fill-available;" placeholder="Search in logs" type="text" ng-model="search"/></td>'+
		'</tr>'+
		'</table>'+
	    '</div>'+
	    '<center><b ng-show="nodataavailable">Sorry {{userFullName}}, No debug logs for you.</b></center>'+
	    
	    '<div ng-show="loading"><center><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/> Loading please wait...</center></div>'+
	    
	      '<div class="w3-container" style="background:white; min-height:200px; max-height:400px; overflow-y: scroll;">'+
	        '<table class="list" ng-show="dataList.length">'+
	        '<tr class="headerRow">'+
			'<th class="headerRow"></th>'+
			'<th class="headerRow">User</th>'+
			'<th class="headerRow">Request Type</th>'+
			'<th class="headerRow">Application</th>'+
			'<th class="headerRow">Operation</th>'+
			'<th class="headerRow">Status</th>'+
			'<th class="headerRow">Duration (ms)</th>'+
			'<th class="headerRow">Log Size (bytes)</th>'+
			'<th class="headerRow">Start Time</th>'+
		'</tr>'+
			'<tr ng-repeat="log in dataList | filter:search">'+
			'<td><a style="font-weight:bold" href="/p/setup/layout/ApexDebugLogDetailEdit/d?apex_log_id={{log.Id}}" target="_blank">View</a></td>'+
				'<td><a href="/{{log.LogUserId}}" target="_blank">{{log.LogUser.Name}}</a></td>'+
				'<td>{{log.Request}}</td>'+
				'<td>{{log.Application}}</td>'+
				'<td class="trim-info">{{log.Operation}}</td>'+
				'<td>{{log.Status}}</td>'+
				'<td>{{log.DurationMilliseconds}}</td>'+
				'<td>{{log.LogLength | number}}</td>'+
				'<td>{{log.StartTime | date:"MM/dd hh:mm:ss Z"}}</td>'+
			'</tr>'+ 
		'</table>'+
	      '</div>'+
	      '<footer class="w3-container modalfooter">'+
	      '<table><tr>'+
		      '<td class="bold"><a target="_blank" href="https://chrome.google.com/webstore/detail/salesforce-simplified/hjeigbpcblpkaienmpihneipkempijob?hl=en">Rate Us on chrome</a></td>'+
		      '<td class="bold"><a target="_blank" href="https://fb.com/salesforcesimplified">Facebook Page</a></td>'+
		      '<td class="bold"><a target="_blank" href="https://github.com/rajnikantroy/SalesforceSimplified/issues/new">Report Issue</a></td>'+
		      '<td class="bold"><a target="_blank" href="https://salesforcesimplify.blogspot.com">Salesforce Simplified</a></td>'+
	      '</tr></table>'+
	    '</footer>'+
	    '</div>'+
	  '</div>'+
	'</div>';
	
	this.classgrid ='<div class="w3-container pageBlock">'+
	  '<div id="classGridModal" class="w3-modal  w3-animate-opacity">'+
	    '<div class="w3-modal-content modal-back modalcustomstyle">'+
	    '<header class="w3-container modalheader"> '+
	    '<h2>{{uname}} Classes</h2>'+
	      '<span id="debuglogGridCloseBtn" ng-click="closeClassModal()" class="w3-button w3-display-topright">X</span>'+
	    '</header>'+
	    '<div class="w3-container">'+
	    '<table class="list" ng-show="dataList.length">'+
      '<tr class="headerRow">'+
			'<td width="50%"><input style="width: -webkit-fill-available;" placeholder="Search in logs" type="text" ng-model="search"/></td>'+
		'</tr>'+
		'</table>'+
	    '</div>'+
	    '<center><b ng-show="nodataavailable">Sorry {{userFullName}}, No debug logs for you.</b></center>'+
	    
	    '<div ng-show="loading"><center><img title="Patience is not simply the ability to wait - its how we behave while we are waiting." width="30px" height="30px" src="'+loadingcar+'"/> Loading please wait...</center></div>'+
	    
	      '<div class="w3-container" style="background:white; min-height:200px; max-height:400px; overflow-y: scroll;">'+
	        '<table class="list" ng-show="dataList.length">'+
	        '<tr class="headerRow">'+
			'<th class="headerRow"></th>'+
			'<th class="headerRow">Name</th>'+
			'<th class="headerRow">Namespace</th>'+
			'<th class="headerRow">Api Version</th>'+
			'<th class="headerRow">Last Modified By</th>'+
			'<th class="headerRow">Has Trace Flags</th>'+
		'</tr>'+
			'<tr ng-repeat="class in dataList | filter:search">'+
			'<td><a style="font-weight:bold" href="/{{class.Id}}" target="_blank">View</a></td>'+
				'<td><a class="trim-info" href="/{{class.Id}}" target="_blank">{{class.Name}}</a></td>'+
				'<td>{{class.NamespacePrefix}}</td>'+
				'<td>{{class.ApiVersion}}</td>'+
				'<td><a class="username-trim" target="_blank" href="/{{class.LastModifiedBy.Id}}">{{class.LastModifiedBy.Name}}</a> {{class.LastModifiedDate | date:"MM/dd/yyyy hh:mm a"}}</td>'+
				'<td><input type="checkbox" ng-model="class.IsValid" ng-Disabled="true"></td>'+
			'</tr>'+ 
		'</table>'+
	      '</div>'+
	      '<footer class="w3-container modalfooter">'+
	      '<table><tr>'+
		      '<td class="bold"><a target="_blank" href="https://chrome.google.com/webstore/detail/salesforce-simplified/hjeigbpcblpkaienmpihneipkempijob?hl=en">Rate Us on chrome</a></td>'+
		      '<td class="bold"><a target="_blank" href="https://fb.com/salesforcesimplified">Facebook Page</a></td>'+
		      '<td class="bold"><a target="_blank" href="https://github.com/rajnikantroy/SalesforceSimplified/issues/new">Report Issue</a></td>'+
		      '<td class="bold"><a target="_blank" href="https://salesforcesimplify.blogspot.com">Salesforce Simplified</a></td>'+
	      '</tr></table>'+
	    '</footer>'+
	    '</div>'+
	  '</div>'+
	'</div>';
	
}]);