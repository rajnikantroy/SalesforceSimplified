app.controller('MyViewGridCtrl', function($scope, MetaDataContainer, $http, UserId) {
	/************************************************DEBUG LOGS START***************************************************/
	$scope.dataList = [];
	
	$scope.clsSecurity = 'clsSecurity';
	$scope.edit = 'Edit';
	
	$scope.download = 'Download';
	$scope.baseUrl = 'https://'+window.location.host;
	$scope.classactions = MetaDataContainer.data[3].fieldlevelactions;
	
	$scope.loadingDebug = true;
	$scope.uname = "My";
	$scope.userFullName = "";
	$scope.loading = false;
	$scope.nodataavailable = false;
	if(readCookie('SFDCSimplified_uname') && readCookie('SFDCSimplified_uname').split(" ")[0]){
		$scope.uname = readCookie('SFDCSimplified_uname').split(" ")[0]+"'s";
		$scope.userFullName = readCookie('SFDCSimplified_uname');
	}
	$scope.DebugLogClose = function(){
		$("#debuglogGridModal").css({"display": "none"});
		location.reload();
	}
	$scope.queryForDebugLogs = function(){
		try{
			$scope.loading = true;
			$("#debuglogGridModal").css({"display": "block"});
			$scope.querySFDC(MetaDataContainer.data[2].query, MetaDataContainer.data[2].url);
		}catch(error){
			console.log(error);
		}
	}
	$scope.deleteBtn = 'Delete My Logs';
	$scope.deleteMyLogs = function(){
		try{
		if($scope.dataList.length > 0) {
			$scope.loading = true;
			$scope.dataList.forEach(function(e) { deleteLogsFromSalesforce(e) });
			$scope.loading = false;
		}else {
			alert('There are no debug logs to delete');
		}
		}catch(error){
			console.log(error);
		}
	}
	function deleteLogsFromSalesforce(e) {
		try {
			var completeurl = "https://"+window.location.host+"/services/data/v38.0/tooling/sobjects/apexlog/"+e.Id;
			var configObj = {
				url : completeurl,
				headers : {"Authorization": "Bearer "+ readCookie('sid')},
				contentType : "application/json",
				method : "DELETE"
				};
				$http(configObj).then(function mySuccess(response) {
					$scope.querySFDC(MetaDataContainer.data[2].query, MetaDataContainer.data[2].url);
					$scope.dataLength = $scope.dataLength - 1;
				}, function myError(errorRes) {
					//console.log(errorRes);
					$scope.loading = false;
				});
		}catch(error){
			console.log(error);
		}
	}
	$scope.querySFDC = function(query, url){
		try{
			var completeurl = url+''+query;
			var configObj = {
				url : completeurl,
				headers : {"Authorization": "Bearer "+ readCookie('sid')},
				contentType : "application/json"
				};
				$http(configObj).then(function mySuccess(response) {
				if(response.data.records && response.data.records.length){
					$scope.dataList = response.data.records;
					$scope.loading = false;
					$scope.nodataavailable = false;
					$scope.dataLength = response.data.records.length;
				}else{
					$scope.dataList = [];
					$scope.nodataavailable = true;
					$scope.loading = false;
				}
		}, function myError(response) {
		
		});
		}catch(error){
			console.log(error);
		}
    }
	
	$scope.objectNameRowTemplateMap = new Map();
	$scope.objectPrefixRowTemplateMap = new Map();
	$scope.objectPrefixRowTemplate = null;
	
	$scope.recordCompareMap = new Map();
	$scope.recordCompareList = [];

	function copyText (textToCopy) {
	  this.copied = false
	  
	  // Create textarea element
	  const textarea = document.createElement('textarea')
	  
	  // Set the value of the text
	  textarea.value = textToCopy
	  
	  // Make sure we cant change the text of the textarea
	  textarea.setAttribute('readonly', '');
	  
	  // Hide the textarea off the screnn
	  textarea.style.position = 'absolute';
	  textarea.style.left = '-9999px';
	  
	  // Add the textarea to the page
	  document.body.appendChild(textarea);

	  // Copy the textarea
	  textarea.select()

	  try {
		var successful = document.execCommand('copy');
		this.copied = true
		//alert('Copied...');
		if (window.confirm('Copied...'))
		{
			document.location.reload(true)
		}
		
	  } catch(err) {
		this.copied = false
	  }

	  textarea.remove()
	}

	$scope.compareObject = function(url) {
		//debugger;
		$scope.recordCompareList = [];
		var completeurl = "https://"+window.location.host+""+url;
        var configObj = {
            url : completeurl,
            headers : {"Authorization": "Bearer "+ readCookie('sid')},
            contentType : "application/json",
            method : "GET"
            };
            $http(configObj).then(function mySuccess(result) {
				//debugger;
				if(result && result.data){
					//debugger;
					console.log(result.data);
					for (const [key, value] of Object.entries(result.data)) {
					  $scope.recordCompareMap.set(key, value);
					  var obj = {};
					  obj.fieldName = key;
					  obj.record1Value = value;
					  $scope.recordCompareList.push(obj);
					}
					$scope.loading = false;
				}
		    }, function myError(errorRes) {
		    	$scope.loading = false;
		    });  
	}
	$scope.copyObject = function(url) {
		//debugger;
		try{
		var completeurl = "https://"+window.location.host+""+url;
        var configObj = {
            url : completeurl,
            headers : {"Authorization": "Bearer "+ readCookie('sid')},
            contentType : "application/json",
            method : "GET"
            };
            $http(configObj).then(function mySuccess(result) {
				//debugger;
				if(result && result.data){
					//debugger;
					var jsonPretty = JSON.stringify(result.data,null,2);  
					copyText(jsonPretty);
					$scope.copyBtn = 'Copied';					
					$scope.copyBtn = 'Copy';					
				}
		    }, function myError(errorRes) {
		    	//console.log(errorRes);
		    	$scope.loading = false;
		    });   
		}catch(error){
			console.log(error);
		}    
	}
	
	$scope.loadAllObjectForCompareRecord = function(prefix) {
		//debugger;
		try{
		var completeurl = "https://"+window.location.host+"/services/data/v32.0/sobjects";
        var configObj = {
            url : completeurl,
            headers : {"Authorization": "Bearer "+ readCookie('sid')},
            contentType : "application/json",
            method : "GET"
            };
            $http(configObj).then(function mySuccess(result) {
				if(result && result.data.sobjects && result.data.sobjects.length>0){
					for (var i = 0; i < result.data.sobjects.length; i++) {
						if(result.data.sobjects[i] && result.data.sobjects[i].keyPrefix && result.data.sobjects[i].keyPrefix === prefix ){
							$scope.objectPrefixRowTemplateForRecordComparison = result.data.sobjects[i].urls.rowTemplate;
							//$scope.dataList.push(result.data.sobjects[i]);
						}
					}
				}
		    }, function myError(errorRes) {
		    	//console.log(errorRes);
		    	$scope.loading = false;
		    }); 
		}catch(error){
			console.log(error);
		}
	}
	$scope.loadAllObject = function(prefix) {
		try{
		var completeurl = "https://"+window.location.host+"/services/data/v32.0/sobjects";
        var configObj = {
            url : completeurl,
            headers : {"Authorization": "Bearer "+ readCookie('sid')},
            contentType : "application/json",
            method : "GET"
            };
            $http(configObj).then(function mySuccess(result) {
				if(result && result.data.sobjects && result.data.sobjects.length>0){
					for (var i = 0; i < result.data.sobjects.length; i++) {
						if(result.data.sobjects[i] && result.data.sobjects[i].keyPrefix && result.data.sobjects[i].keyPrefix === prefix ){
							$scope.objectPrefixRowTemplate = result.data.sobjects[i].urls.rowTemplate;
						}
					}
				}
		    }, function myError(errorRes) {
		    	$scope.loading = false;
		    });    
		}catch(error){
			console.log(error);
		}   
	}
	
	$scope.$watch('objectPrefixRowTemplateForRecordComparison', function(value) {
		//debugger;
		if(value && $scope.recordId1){
			var value1 = value.replace('{ID}', $scope.recordId1);
			$scope.compareObject(value1);
		}
	  });
	
	$scope.$watch('objectPrefixRowTemplate', function(value) {
		if(value && $scope.recordId){
			var value1 = value.replace('{ID}', $scope.recordId);
			$scope.copyObject(value1);
		}
	  });
	
	//getRecordId
	function getRecordId(href) {
	  let url = new URL(href);
	  // Find record ID from URL
	  let searchParams = new URLSearchParams(url.search.substring(1));
	  // Salesforce Classic and Console
	  if (url.hostname.endsWith(".salesforce.com")) {
		let match = url.pathname.match(/\/([a-zA-Z0-9]{3}|[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})(?:\/|$)/);
		if (match) {
		  let res = match[1];
		  if (res.includes("0000") || res.length == 3) {
			return match[1];
		  }
		}
	  }

	  // Lightning Experience and Salesforce1
	  if (url.hostname.endsWith(".lightning.force.com")) {
		let match;

		if (url.pathname == "/one/one.app") {
		  // Pre URL change: https://docs.releasenotes.salesforce.com/en-us/spring18/release-notes/rn_general_enhanced_urls_cruc.htm
		  match = url.hash.match(/\/sObject\/([a-zA-Z0-9]+)(?:\/|$)/);
		} else {
		  match = url.pathname.match(/\/lightning\/[r|o]\/[a-zA-Z0-9_]+\/([a-zA-Z0-9]+)/);
		}
		if (match) {
		  return match[1];
		}
	  }
	  // Visualforce
	  {
		let idParam = searchParams.get("id");
		if (idParam) {
		  return idParam;
		}
	  }
	  // Visualforce page that does not follow standard Visualforce naming
	  for (let [, p] of searchParams) {
		if (p.match(/^([a-zA-Z0-9]{3}|[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/) && p.includes("0000")) {
		  return p;
		}
	  }
	  return null;
	}
	
	/************************************************DEBUG LOGS END***************************************************/
	
	/************************************************CLASS START******************************************************/
	$scope.closeClassModal = function(){
		$("#classGridModal").css({"display": "none"});
	}
	$scope.openClassModal = function(){
			$scope.loading = true;
			$("#classGridModal").css({"display": "block"});
			$scope.querySFDC(MetaDataContainer.data[25].query, MetaDataContainer.data[25].url);
	}
	/************************************************CLASS END******************************************************/
	
	/************************************************COPY START******************************************************/
	$scope.copyBtn = 'Copy';
	$scope.CopyModal = function(){
			$scope.loading = true;
			$scope.copyBtn = 'Copying...';
			$("#classGridModal").css({"display": "block"});
			$scope.recordId = getRecordId(window.location.href);
			var prefix = $scope.recordId.slice(0, 3);
			$scope.loadAllObject(prefix);
			
			//alert(getRecordId(window.location.href));
			//$scope.querySFDC(MetaDataContainer.data[25].query, MetaDataContainer.data[25].url);
	}
	/************************************************COPY END******************************************************/
	/************************************************COMPARE START******************************************************/
	$scope.CompareModal = function(){
			$scope.loading = true;
			$("#compareModal").css({"display": "block"});
			$scope.recordId1 = getRecordId(window.location.href);
			var prefix = $scope.recordId1.slice(0, 3);
			$scope.loadAllObjectForCompareRecord(prefix);
			//$scope.querySFDC(MetaDataContainer.data[2].query, MetaDataContainer.data[2].url);
	}
	$scope.CompareClose = function(){
		$("#compareModal").css({"display": "none"});
		//location.reload();
	}
	/************************************************COMPARE END******************************************************/
});