app.controller('MyViewGridCtrl', function($scope, MetaDataContainer, $http, UserId) {
	$scope.userLogs = [];
	$scope.loadingDebug = true;
	$scope.uname = "My";
	$scope.userFullName = "";
	if(readCookie('SFDCSimplified_uname') && readCookie('SFDCSimplified_uname').split(" ")[0]){
		$scope.uname = readCookie('SFDCSimplified_uname').split(" ")[0]+"'s";
		$scope.userFullName = readCookie('SFDCSimplified_uname');
	}
	$scope.DebugLogClose = function(){
		$(".debugmodal").css({"display": "none"});
		location.reload();
	}
	$scope.queryForDebugLogs = function(){
			$(".debugmodal").css({"display": "block"});
			$scope.querySFDC(MetaDataContainer.data[2].query, MetaDataContainer.data[2].url);
	}
	$scope.deleteMyLogs = function(){
		if($scope.userLogs.length > 0) {
			$scope.userLogs.forEach(function(e) { deleteLogsFromSalesforce(e) });
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
		    	console.log(errorRes);
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
            	$scope.userLogs = response.data.records;
            }else{
            	$scope.userLogs = [];
            }
    }, function myError(response) {
	
    });
    }
});