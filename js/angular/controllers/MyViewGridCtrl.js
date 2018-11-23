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
			$scope.loading = true;
			$("#debuglogGridModal").css({"display": "block"});
			$scope.querySFDC(MetaDataContainer.data[2].query, MetaDataContainer.data[2].url);
	}
	$scope.deleteMyLogs = function(){
		if($scope.dataList.length > 0) {
			$scope.loading = true;
			$scope.dataList.forEach(function(e) { deleteLogsFromSalesforce(e) });
			$scope.loading = false;
		}else {
			alert('There are no debug logs to delete');
		}
	}
	function deleteLogsFromSalesforce(e) {
		
		var completeurl = "https://"+window.location.host+"/services/data/v38.0/tooling/sobjects/apexlog/"+e.Id;
        var configObj = {
            url : completeurl,
            headers : {"Authorization": "Bearer "+ readCookie('sid')},
            contentType : "application/json",
            method : "DELETE"
            };
            $http(configObj).then(function mySuccess(response) {
            	$scope.querySFDC(MetaDataContainer.data[2].query, MetaDataContainer.data[2].url);
		    }, function myError(errorRes) {
		    	//console.log(errorRes);
		    	$scope.loading = false;
		    });       
	}
	$scope.querySFDC = function(query, url){
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
            }else{
            	$scope.dataList = [];
            	$scope.nodataavailable = true;
            	$scope.loading = false;
            }
    }, function myError(response) {
	
    });
    }
	/************************************************DEBUG LOGS END***************************************************/
	
	/************************************************CLASS START******************************************************/
	$scope.closeClassModal = function(){
		$("#classGridModal").css({"display": "none"});
	}
	$scope.openClassModal = function(){
			$scope.loading = true;
			$("#classGridModal").css({"display": "block"});
			$scope.querySFDC(MetaDataContainer.data[3].query, MetaDataContainer.data[3].url);
	}
	/************************************************CLASS END******************************************************/
});