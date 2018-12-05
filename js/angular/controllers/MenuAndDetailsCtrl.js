app.controller('MenuAndDetailsCtrl', function($scope, MetaDataContainer, $http, UserId) {
    $scope.edit = 'Edit';
    $scope.recently_viewed = 'RecentlyViewed';
    $scope.change = 'ChangeUser';
    $scope.update = 'Updates';
    $scope.download = 'Download';
    $scope.faq = 'FAQ';
    $scope.fields = 'Fields';
    $scope.clone = 'Clone';
    $scope.allitems = 'allitems';
    $scope.packagexml = 'PackageXml';
    $scope.AssignmentRule = 'AssignmentRule';
    $scope.launchercolor ='LauncherColor';
    
    $scope.AuraDefinitionBundle = 'AuraDefinitionBundle';
    
    $scope.lengthList = [500, 1000, 2000];
    $scope.limitLength = 200;

    $scope.view = 'View';
    $scope.home = 'Advance Search';
    $scope.about = 'About';
    $scope.security = 'Security';
    $scope.clsSecurity = 'clsSecurity';
    $scope.cloneWF = 'cloneWF';
    $scope.securityPreUrl = '/_ui/perms/ui/profile/ApexPageProfilePermissionEdit/e?apex_id=';
    $("#mySidenav").css({"width": "0"});
    //$("#fullDataSidenav").css({"width": "0"});
    
    //$("#recentItemOf").css({"width": "0"});
    $scope.fieldlevelactionlength = 0;
    //$scope.showloading = true;
    $scope.showErrorMessage = false;
    $scope.showAllData = false;
    $scope.isDataAvailable = true;
    $scope.editLogo = chrome.extension.getURL("img/edit.png");
    $scope.downloadLogo = chrome.extension.getURL("img/download.png");
    $scope.showpaymentflag = false;
    $scope.selectedMetaForPackageXml = new Map();
    $scope.packageMetaTypeAndName = new Map();
    $scope.entityIdMap = new Map();
    
    $scope.packageMetaDataFrequency = [];
    $scope.objectEntityIdNameMap = new Map();
   
    $scope.setColorInCookie = function(color){
    	 var d = new Date();
    	 d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
    	 var expires = "expires="+d.toUTCString();
    	 document.cookie = "simplifiediconcolor=" + color+ ";" + expires + ";path=/";
    }
    
    $scope.getObjectNameForPackageXml = function(){
    	var str = '';
    	var j = 0;
    	for (let [k, v] of $scope.entityIdMap) {
    		if(k.startsWith("01I")){
    			if(j < $scope.entityIdMap.size - 1){
        			str += '\''+k+'\',';
        		}else if(j == $scope.entityIdMap.size - 1){
        			str += '\''+k+'\'';
        		}
    		}else{
    			$scope.objectEntityIdNameMap.set(k, k);
    		}
    		
    		j = j+1;
    	}
    	var query = 'select id, DeveloperName from CustomObject where id in ('+str+')';
    	query = query.replace(',)', ')');
        var completeurl = $scope.selectedMetadata.url+''+query;
        $scope.ErrorMsg = '';
        var configObj = {
            url : completeurl,
            headers : {"Authorization": "Bearer "+ readCookie('sid')},
            contentType : "application/json"
            };
            $http(configObj).then(function mySuccess(response) {
            var AllMetaDataRecords = [];
            AllMetaDataRecords = response.data.records;
            if(AllMetaDataRecords && AllMetaDataRecords.length){
                for (var i = 0; i < AllMetaDataRecords.length; i++) {
                    $scope.objectEntityIdNameMap.set(AllMetaDataRecords[i].Id, AllMetaDataRecords[i].DeveloperName+'__c');
                    $scope.createpkgXmlString();
                }
            }
	    }, function myError(response) {
	
	    }); 
    	//queryForObjectNameFromFieldId(str);
    }
    $scope.createpkgXmlString = function(){
    	$scope.packageMetaDataFrequency = [];
    	$scope.xmlStr = '<?xml version="1.0" encoding="UTF-8"?>'+
    	'<Package xmlns="http://soap.sforce.com/2006/04/metadata"></Package>';
    	
    	for (let [k, v] of $scope.packageMetaTypeAndName) {
    		if(v.size > 0){
    			var data = {};
          		data.Type =  k;
          		data.Frequency =  v.size;
          		$scope.packageMetaDataFrequency.push(data);
    		}	
    	}
    	
    	$scope.str = '<?xml version="1.0" encoding="UTF-8"?>\n';
    	$scope.str +='<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';
    	for (let [outkey, outvalue] of $scope.packageMetaTypeAndName) {
    		if(outvalue.size>0){
	    		$scope.str += '\t<types>\n';
	    		var i=0;
	    		for (let [innerKey, innerValue] of outvalue) {
	          		i=i+1;
	          		var connector = '.';
	          		var v = [];
	          		if(innerValue.split(".").length == 2){
	          			v = innerValue.split(".");
	          			connector = '.';
	          		}
	          		if(innerValue.split("-").length == 2){
	          			v = innerValue.split("-");
	          			connector = '-';
	          		}
	          		//var v = innerValue.split(".").length == 2 ? innerValue.split(".") : innerValue.split("-");
	          		
	          		if(v && v.length && $scope.objectEntityIdNameMap.get(v[0])){
	          			var val = $scope.objectEntityIdNameMap.get(v[0])+connector+v[1];
	          			$scope.str += '\t\t<members>'+val+'</members>\n';
	          		}else{
	          			$scope.str += '\t\t<members>'+innerValue+'</members>\n';
	          		}
	          		if(i == outvalue.size){
	    				$scope.str += '\t\t<name>'+outkey+'</name>\n';
	    			}
	    		}
	    		$scope.str += '\t</types>\n';
    		}
		}
    	$scope.str +='<version>43.0</version>\n';
    	$scope.str +='</Package>\n';
    	
    }
    $scope.downloadPackageXml = function(){
    	$scope.downloadDoc('Package.xml', $scope.str);
    }
    $scope.downloadDoc = function(filename, text) {
    	  var element = document.createElement('a');
    	  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    	  element.setAttribute('download', filename);

    	  element.style.display = 'none';
    	  document.body.appendChild(element);

    	  element.click();

    	  document.body.removeChild(element);
    	}
    $scope.VerifyPackage = function(){
    	if($scope.entityIdMap && $scope.entityIdMap.size > 0){
    		$scope.getObjectNameForPackageXml();
    	}
    	var data = MetaDataContainer.data[18];
        $scope.records = [];
        $scope.selectedMenu = data;
        $scope.searchAllMetaData = '';
        $scope.showUserFrequency = false;
        
        $scope.totalSize_AllMetaDataRecords = 0;
        $scope.total_records = 0;
        $scope.uname = $("#userfullname") ? $("#userfullname").text().split(" ")[0]+"'s" : "Your";
        $scope.unamewithoutastr = $("#userfullname").text().split(" ")[0];

        $scope.AllMetaDataRecords= [];
        //$("#packageXmlSidenav").css({"width": "0"});
       // $("#fullDataSidenav").css({"width": "70%"});
        
        //$(".ARISearch").css({"display":"block"});
        //$(".packageARISearch").css({"display":"none"});
        
        $(".mainmenuSidebar").css({"display":"block"});
        //$("#recentItemOf").css({"width": "350"});
         
         $scope.selectedMetadata = data;
        if(data.type == 'table' && data.query){
            $scope.showloading = true;
            $scope.showallloading = true;
            $scope.rcd = $scope.querySFDC(data.query, data.url);
            $scope.RecordHeaders = data.headers;

            //SFDC Simplified v2
            $scope.searchMetadata(data);
        }else{
            //$scope.showloading = false;
            $scope.showallloading = true;
            $scope.searchMetadata(data);
        }
        
        $scope.createpkgXmlString();
    }

    $scope.baseUrl = 'https://'+window.location.host;

    var KEYCODE_ESC = 27;

   /* $(document).keyup(function(e) {
      if (e.keyCode === KEYCODE_ESC) {
        if($("#fullDataSidenav").css("width").startsWith("70%")){
            $scope.loadDataClosebtn();
        }else if($("#mySidenav").css("width").startsWith("150")){
            $scope.closeModel();
        }
        }else if(e.ctrlKey && e.keyCode === 32){
            //$scope.callModel();
        }
    });*/
    
    
    //str = str.replaceLast('one', 'finish');
    $scope.SelectMetadataForManagedPackage = function (id, flag) {
    	//$scope.packageMetaTypeAndName = new Map();
    	var packageMetaDataNameMap = new Map();
    	if($scope.selectedMetaForPackageXml && $scope.selectedMetaForPackageXml.get(id)){
    		for (var i = 0; i < $scope.records.length; i++) {
                if ($scope.records[i].Id == id && $scope.records[i].selected) {
                	$scope.records[i].selected = false;
                }
                
                //Delete unselected metadata from package xml
                if($scope.records && $scope.records[i] && $scope.records[i].attributes && $scope.records[i].attributes.type && $scope.packageMetaTypeAndName.get($scope.records[i].attributes.type)){
	        		$scope.packageMetaTypeAndName.get($scope.records[i].attributes.type).delete($scope.records[i].Id);
	        	}
            }
    		for (var i = 0; i < $scope.AllMetaDataRecords.length; i++) {
	            if ($scope.AllMetaDataRecords[i].Id == id && $scope.AllMetaDataRecords[i].selected) {
	            	$scope.AllMetaDataRecords[i].selected = false;
	            }
	            
	            //Delete unselected metadata from package xml
	            if($scope.AllMetaDataRecords && $scope.AllMetaDataRecords[i] && $scope.AllMetaDataRecords[i].attributes && $scope.AllMetaDataRecords[i].attributes.type && $scope.packageMetaTypeAndName.get($scope.AllMetaDataRecords[i].attributes.type)){
	        		$scope.packageMetaTypeAndName.get($scope.AllMetaDataRecords[i].attributes.type).delete($scope.AllMetaDataRecords[i].Id);
	        	}
	        }
    		$scope.selectedMetaForPackageXml.delete(id);
    	}
    	
        if($scope.records && $scope.records.length>0){
        	for (var i = 0; i < $scope.records.length; i++) {
                if ($scope.records[i].selected) {
                	$scope.selectedMetaForPackageXml.set($scope.records[i].Id, $scope.records[i]);
                	var name = $scope.records[i].Name ? $scope.records[i].Name : $scope.records[i].DeveloperName;
                	
                	var TableEnumOrId = $scope.records[i].TableEnumOrId;
                	
                	var NamespacePrefix = $scope.records[i].NamespacePrefix;
                	var SobjectType = $scope.records[i].SobjectType;
                	
                	name = name.split(".").length>1 ? name.split(".")[1] : name;
                	
	            	if(NamespacePrefix && NamespacePrefix!='null'){
	            		name = NamespacePrefix+'__'+name;
	            	}
	            	
	            	if(SobjectType){
                		name = SobjectType+'.'+name;
                	}
	            	if(TableEnumOrId && $scope.selectedMetadata.value === 'Layout'){
	            		name = TableEnumOrId+'-'+name;
	            		$scope.entityIdMap.set(TableEnumOrId, TableEnumOrId);
	            	}
	            	if(TableEnumOrId && $scope.selectedMetadata.value != 'Layout'){
	            		name = TableEnumOrId+'.'+name;
	            		$scope.entityIdMap.set(TableEnumOrId, TableEnumOrId);
	            	}
	            	if($scope.records && $scope.records[i] && $scope.records[i].attributes && $scope.records[i].attributes.type && $scope.records[i].attributes.type === 'CustomObject'){
	            		name = name+'__c';
	            	}
	            	if($scope.records && $scope.records[i] && $scope.records[i].attributes && $scope.records[i].attributes.type && $scope.records[i].attributes.type === 'CustomField'){
	            		name = name+'__c';
	            	}
	            	
                	if($scope.records && $scope.records[i] && $scope.records[i].attributes && $scope.records[i].attributes.type && $scope.packageMetaTypeAndName.get($scope.records[i].attributes.type)){
                		$scope.packageMetaTypeAndName.get($scope.records[i].attributes.type).set($scope.records[i].Id, name);
                	}else{
                		packageMetaDataNameMap.set($scope.records[i].Id, name);
                		var type = $scope.records[i].attributes.type ? $scope.records[i].attributes.type === "ExternalString" ? "CustomLabels":$scope.records[i].attributes.type : "";
                		
                		$scope.packageMetaTypeAndName.set(type, packageMetaDataNameMap);
                	}
                }
                if ($scope.records && $scope.records[i] && $scope.records[i].Id && flag == true && $scope.records[i].Id == id) {
                	$scope.records[i].selected = true;
                }
            }
        }
        if($scope.AllMetaDataRecords && $scope.AllMetaDataRecords.length>0){
	        for (var i = 0; i < $scope.AllMetaDataRecords.length; i++) {
	            if ($scope.AllMetaDataRecords[i].selected) {
	            	$scope.selectedMetaForPackageXml.set($scope.AllMetaDataRecords[i].Id, $scope.AllMetaDataRecords[i]);
	            	
	            	var name = $scope.AllMetaDataRecords[i].Name ? $scope.AllMetaDataRecords[i].Name : $scope.AllMetaDataRecords[i].DeveloperName;
	            	var NamespacePrefix = $scope.AllMetaDataRecords[i].NamespacePrefix;
	            	var SobjectType = $scope.AllMetaDataRecords[i].SobjectType;
	            	//$scope.AllMetaDataRecords[i].attributes.type;
	            	
	            	var TableEnumOrId = $scope.AllMetaDataRecords[i].TableEnumOrId;
	            	name = name.split(".").length>1 ? name.split(".")[1] : name;
	            	
	            	if(NamespacePrefix && NamespacePrefix!='null'){
	            		name = NamespacePrefix+'__'+name;
	            	}
	            	if(SobjectType){
                		name = SobjectType+'.'+name;
                	}
	            	if(TableEnumOrId && $scope.selectedMetadata.value === 'Layout'){
	            		name = TableEnumOrId+'-'+name;
	            		$scope.entityIdMap.set(TableEnumOrId, TableEnumOrId);
	            	}
	            	if(TableEnumOrId && $scope.selectedMetadata.value != 'Layout'){
	            		name = TableEnumOrId+'.'+name;
	            		$scope.entityIdMap.set(TableEnumOrId, TableEnumOrId);
	            	}
	            	if($scope.AllMetaDataRecords[i] && $scope.AllMetaDataRecords[i].attributes && $scope.AllMetaDataRecords[i].attributes.type && $scope.AllMetaDataRecords[i].attributes.type === 'CustomObject'){
	            		name = name+'__c';
	            	}
	            	if($scope.AllMetaDataRecords[i] && $scope.AllMetaDataRecords[i].attributes && $scope.AllMetaDataRecords[i].attributes.type && $scope.AllMetaDataRecords[i].attributes.type === 'CustomField'){
	            		name = name+'__c';
	            	}
	            	
	            	if($scope.AllMetaDataRecords && $scope.AllMetaDataRecords[i] && $scope.AllMetaDataRecords[i].attributes && $scope.AllMetaDataRecords[i].attributes.type && $scope.packageMetaTypeAndName.get($scope.AllMetaDataRecords[i].attributes.type)){
                		$scope.packageMetaTypeAndName.get($scope.AllMetaDataRecords[i].attributes.type).set($scope.AllMetaDataRecords[i].Id, name);
                	}else{
                		packageMetaDataNameMap.set($scope.AllMetaDataRecords[i].Id, name);
                		var type = $scope.AllMetaDataRecords[i].attributes.type ? $scope.AllMetaDataRecords[i].attributes.type === "ExternalString" ? "CustomLabels":$scope.AllMetaDataRecords[i].attributes.type : "";
                		$scope.packageMetaTypeAndName.set(type, packageMetaDataNameMap);
                	}
	            }
	            if ($scope.AllMetaDataRecords && $scope.AllMetaDataRecords[i] && $scope.AllMetaDataRecords[i].Id && flag == true && $scope.AllMetaDataRecords[i].Id == id) {
	            	$scope.AllMetaDataRecords[i].selected = true;
	            }
	        }
        }
    }
    

    $scope.changeUser = function(id){
		
		if(String(id).startsWith('005')){
            __changeUser(id);
            setTimeout(function(){
                if(String(id) == readCookie('uid')){
                    if (confirm("user changed! Click ok to refresh and apply.")) {
                        window.location.reload();
                    } 
                }else{
                    alert('Unable to change this user, please try again.');
                }
            }, 1000);
		}else{
			alert('Invalid User :'+id);
		}
    }
    //Change index if menu order got changed MetaDataContainer.data[0]
    $scope.searchUser = function(){
        $scope.showloading = true;
        var que = MetaDataContainer.data[0].query+" and name like '%25"+$scope.searchUserModel+"%25'";
        $scope.querySFDC(que, MetaDataContainer.data[1].url);
    }
    $scope.showpayment = function(){
        if($scope.showpaymentflag)
            $scope.showpaymentflag = false;
        else
            $scope.showpaymentflag = true;
    }

    $scope.callModel = function(){
        $("#mySidenav").css({"width": "150"});
        $scope.showloading = true;
        $scope.showErrorMessage = false;
        $scope.showAllData = false;
        $scope.isDataAvailable = true;
        $scope.favouriteMenu = [];
        
        $scope.allMenu = [];
        for (var i = 0; i < MetaDataContainer.data.length; i++) {
            if(MetaDataContainer.data[i].visibleForMetadataMenu){
                $scope.allMenu.push(MetaDataContainer.data[i]);
            }
        }

        $scope.AdvanceSearchMenu = [];

        for (var i = 0; i < MetaDataContainer.data.length; i++) {
            if(MetaDataContainer.data[i].EligibleForAdvanceSearch){
                $scope.AdvanceSearchMenu.push(MetaDataContainer.data[i]);
            }
        }
        
        for (var i = 0; i < MetaDataContainer.data.length; i++) {
            var data = MetaDataContainer.data[i];
            if(data.formainmenu){
                $scope.favouriteMenu.push(MetaDataContainer.data[i]);
            }
        }
    }

    $scope.closeModel = function(){
		//if($("#fullDataSidenav").css("width").startsWith("0")){
			$("#mySidenav").css({"width": "0"});
		//}
        $scope.showloading = false;
        $scope.showErrorMessage = false;
        $scope.isDataAvailable = true;
        $scope.searchMenu = "";
        $scope.showAllData = false;
    }
    $scope.loadData = function(){
       // $("#fullDataSidenav").css({"width": "70%"});
        //$("#recentItemOf").css({"width": "350"});
    }
    
    $scope.SimplifiedMainModalClose = function(){
    	$("#SimplifiedMainModal").css({"display": "none"});
    }
    
    $scope.detailsPopupOpen = function(data){
        $scope.records = [];
        $scope.selectedMenu = data;
       
        $scope.searchAllMetaData = '';
        $scope.showUserFrequency = false;
        $scope.totalSize_AllMetaDataRecords = 0;
        $scope.total_records = 0;
        $scope.uname = $("#userfullname") ? $("#userfullname").text().split(" ")[0]+"'s" : "";
        $scope.unamewithoutastr = $("#userfullname").text().split(" ")[0];

        $scope.AllMetaDataRecords= [];
        $("#SimplifiedMainModal").css({"display": "block"});
        //$("#fullDataSidenav").css({"width": "70%"});
        //$(".ARISearch").css({"display":"block"});
        
        $(".mainmenuSidebar").css({"display":"block"});
        //$("#recentItemOf").css({"width": "350"});

         var selectedDT = JSON.stringify( data, function( key, value ) {
                if( key === "$$hashKey" ) {
                    return undefined;
                }

                return value;
            });
         $scope.selectedMetadata = JSON.parse(selectedDT);


        if(data.type == 'table' && data.query){
            $scope.showloading = true;
            $scope.showallloading = true;
            $scope.rcd = $scope.querySFDC(data.query, data.url);
            $scope.RecordHeaders = data.headers;

            //SFDC Simplified v2
            $scope.searchMetadata(data);
        }else{
            //$scope.showloading = false;
            $scope.showallloading = true;
            $scope.searchMetadata(data);
        }
}
    $scope.detailsPopupOpenFromMainMenu = function(){
    	var data = MetaDataContainer.data[3];
        $scope.records = [];
        $scope.selectedMenu = data;
        $scope.searchAllMetaData = '';
        $scope.showUserFrequency = false;
        
        $scope.totalSize_AllMetaDataRecords = 0;
        $scope.total_records = 0;
        $scope.uname = $("#userfullname") ? $("#userfullname").text().split(" ")[0]+"'s" : "";
        $scope.unamewithoutastr = $("#userfullname").text().split(" ")[0];

        $scope.AllMetaDataRecords= [];
        //$("#packageXmlSidenav").css({"width": "0"});
        $("#fullDataSidenav").css({"width": "70%"});
        
        //$(".ARISearch").css({"display":"block"});
        //$(".packageARISearch").css({"display":"none"});
        
        $(".mainmenuSidebar").css({"display":"block"});
        $("#recentItemOf").css({"width": "350"});
         
         $scope.selectedMetadata = data;


        if(data.type == 'table' && data.query){
            $scope.showloading = true;
            $scope.showallloading = true;
            $scope.rcd = $scope.querySFDC(data.query, data.url);
            $scope.RecordHeaders = data.headers;

            //SFDC Simplified v2
            $scope.searchMetadata(data);
        }else{
            //$scope.showloading = false;
            $scope.showallloading = true;
            $scope.searchMetadata(data);
        }
}
    $scope.createPackageXml =  function(){
    	
    }

$scope.detailsPopupOpenByOption = function(data, len){
        $scope.records = [];

        if(len){
            $scope.limitLength = len;
        }else{
            $scope.limitLength = 200;
        }
        
        $scope.selectedMenu = data;
        $scope.searchAllMetaData = '';
        $scope.showUserFrequency = false;

        $scope.AllMetaDataRecords= [];
        $("#fullDataSidenav").css({"width": "70%"});
        //$("#recentItemOf").css({"width": "350"});
        
         var selectedDT = JSON.stringify( data, function( key, value ) {
                if( key === "$$hashKey" ) {
                    return undefined;
                }

                return value;
            });
         $scope.selectedMetadata = JSON.parse(selectedDT);


        if(data.type == 'table' && data.query){
            $scope.showloading = true;
            $scope.showallloading = true;
            $scope.rcd = $scope.querySFDC(data.query, data.url);
            $scope.RecordHeaders = data.headers;

            //SFDC Simplified v2
            $scope.searchMetadata(data);
        }else{
            //$scope.showloading = false;
            $scope.showallloading = true;
            $scope.searchMetadata(data);
        }
}

    $scope.loadDataClosebtn = function(){
        //$(".ARISearch").css({"display":"none"});
        //$(".packageARISearch").css({"display":"none"});
        $(".mainmenuSidebar").css({"display":"none"});
        $("#mySidenav").css({"width": "150"});
        //$("#fullDataSidenav").css({"width": "0"});
        //$("#packageXmlSidenav").css({"width": "0"});
        //$("#recentItemOf").css({"width": "0"});
        $scope.showAllData = false;
        $scope.records = [];
        $scope.searchText = '';
        $scope.searchAllMetaData = '';
        $scope.showloading = false;
        $scope.showErrorMessage = false;
        $scope.isDataAvailable = true;
        $scope.selectedMetaMenu = [];
        $scope.showpaymentflag = false;

    }
    $scope.openObjectList = function(){
        //alert(baseUrl+''+listUrl);
        var url = $scope.baseUrl+''+$scope.selectedMetadata.listUrl;
        window.open(url, '_blank');
    }
    function fun(id){
    	if($scope.selectedMetaForPackageXml.get(id)){
    		return true;
    	}else{
    		return false;
    	}
    }
    
    function getMetaFullName(){
    	
    }
    
    $scope.querySFDC = function(query, url){
        var completeurl = url+''+query+' limit '+$scope.limitLength;
        var configObj = {
            url : completeurl,
            headers : {"Authorization": "Bearer "+ readCookie('sid')},
            contentType : "application/json"
            };
            $http(configObj).then(function mySuccess(response) {
            $(".userdetails").removeClass('userdetailsError');
            
            $scope.total_records = response.data.totalSize;
            $scope.records = response.data.records;
            if($scope.selectedMetadata.eligibleForPackageXml && $scope.selectedMetaForPackageXml.size == 0){
            	$scope.records.forEach(function(e) { e.selected = false });
            }
            if($scope.selectedMetadata.eligibleForPackageXml && $scope.selectedMetaForPackageXml.size > 0){
            	$scope.records.forEach(function(e) { e.selected = fun(e.Id) });
            }
            if($scope.selectedMetadata.isSobjectType && $scope.records.length && 
            		$scope.records[0] && $scope.records[0].DeveloperName){
            	$scope.records.forEach(function(e) { e.DeveloperName = e.SobjectType ? e.SobjectType+'.'+e.DeveloperName : e.DeveloperName });
            }
            if($scope.selectedMetadata.isSobjectType && $scope.records.length 
            		&& $scope.records[0] && $scope.records[0].Name){
            	$scope.records.forEach(function(e) { e.Name = e.SobjectType ? e.SobjectType +'.'+e.Name : e.Name });
            }
            
            if($scope.records && $scope.records.length){
                $scope.isDataAvailable = true;
            }else{
                $scope.isDataAvailable = false;
            }
            $scope.showloading = false;
            
    }, function myError(response) {
		$scope.records=[];
        $scope.Name = response.statusText;
        $scope.showloading = false;
        $scope.showErrorMessage = true;
        $scope.records = response.statusText;
		var cookieTester = readCookie("disco");
		//$("#recentItemOf").css("background-color", "#ff000082");
		if(cookieTester && cookieTester.split(":").length){			
			$("#userdetails").addClass('userdetailsError');
            $scope.ErrorMsg = 'Please change user.';			
		}else{
			$scope.ErrorMsg = 'From this page of salesforce we cannot query your data. Salesforce Simplified cannot query if you are inside any manage package or your url is different than your home page.';
		}        
    });
    }
$scope.searchMetadata = function(selectMenu){
    $scope.showAllData = false;
    //$scope.showloading = true;
    $scope.showallloading = true;
         var selectedDT = JSON.stringify( selectMenu, function( key, value ) {
                if( key === "$$hashKey" ) {
                    return undefined;
                }
                return value;
            });
         $scope.selectedMetadata1 = JSON.parse(selectedDT);
         if($scope.selectedMetadata1.queryForAll){
            $scope.queryOnAllData($scope.selectedMetadata1.queryForAll, $scope.selectedMetadata1.url);
         }else{
            $scope.showallloading = false;
         }
    }
    $scope.searchForUser = function(txt){
        $scope.searchAllMetaData = txt;
    }
    //var userList = [];
    $scope.createCloudTagData = function(){
        $scope.userFrequencyList = [];
        $scope.showUserFrequency = false;
        var userList = [];
        for (var i = 0; i < $scope.AllMetaDataRecords.length; i++) {
            if($scope.AllMetaDataRecords[i] && $scope.AllMetaDataRecords[i].LastModifiedBy && $scope.AllMetaDataRecords[i].LastModifiedBy.Name){
                userList.push($scope.AllMetaDataRecords[i].LastModifiedBy.Name);
            }
            if($scope.AllMetaDataRecords[i] && $scope.AllMetaDataRecords[i].LogUser && $scope.AllMetaDataRecords[i].LogUser.Name){
                userList.push($scope.AllMetaDataRecords[i].LogUser.Name);
            }
            
        }
        if(userList && userList.length>0){
            var result = userAnalysis(userList);
            var unames = result[0];
            var ucounts = result[1];
            
            var userFrequencyList = [];
            
            for (var i = 0; i < unames.length; i++) {
                var user = {};
                for (var j = 0; j < ucounts.length; j++) {
                    user.username = unames[i];
                    user.frequency = ucounts[i];
                }
                userFrequencyList.push(user);
            }
            
            if(userFrequencyList.length && userFrequencyList.length>0){
                userFrequencyList = userFrequencyList.sort(function(a, b){
                    return b.frequency-a.frequency;
                });
            }
            for (var i = 0; i < 10 && userFrequencyList.length>0; i++) {
                $scope.userFrequencyList.push(userFrequencyList[i]);
            }
            $scope.showUserFrequency = true;
        }
    }

    function userAnalysis(arr) {
        var a = [], b = [], prev;
        arr.sort();
        for ( var i = 0; i < arr.length; i++ ) {
            if ( arr[i] !== prev ) {
                a.push(arr[i]);
                b.push(1);
            } else {
                b[b.length-1]++;
            }
            prev = arr[i];
        }
        return [a, b];
    }

    $scope.queryOnAllData = function(query, url){
        var completeurl = url+''+query+' limit '+$scope.limitLength;
        var configObj = {
            url : completeurl,
            headers : {"Authorization": "Bearer "+ readCookie('sid')},
            contentType : "application/json"
            };
            $http(configObj).then(function mySuccess(response) {
            $(".userdetails").removeClass('userdetailsError');

            $scope.AllMetaDataRecords = response.data.records;
            
            if($scope.selectedMetadata.eligibleForPackageXml && $scope.selectedMetaForPackageXml.size == 0){
            	$scope.AllMetaDataRecords.forEach(function(e) { e.selected = false });
            }
            if($scope.selectedMetadata.eligibleForPackageXml && $scope.selectedMetaForPackageXml.size > 0){
            	$scope.AllMetaDataRecords.forEach(function(e) { e.selected = fun(e.Id) });
            }
            if($scope.selectedMetadata.isSobjectType && $scope.AllMetaDataRecords.length && 
            		$scope.AllMetaDataRecords[0] && $scope.AllMetaDataRecords[0].DeveloperName){
            	$scope.AllMetaDataRecords.forEach(function(e) { e.DeveloperName = e.SobjectType ? e.SobjectType+'.'+e.DeveloperName : e.DeveloperName });
            }
            if($scope.selectedMetadata.isSobjectType && $scope.AllMetaDataRecords.length 
            		&& $scope.AllMetaDataRecords[0] && $scope.AllMetaDataRecords[0].Name){
            	$scope.AllMetaDataRecords.forEach(function(e) { e.Name = e.SobjectType ? e.SobjectType+'.'+e.Name : e.Name });
            }
            
            $scope.totalSize_AllMetaDataRecords = response.data.totalSize;
            if($scope.AllMetaDataRecords && $scope.AllMetaDataRecords.length){
                $scope.isAllMetaDataRecords = true;
                $scope.showAllData = true;

                $scope.createCloudTagData();
            }else{
                $scope.isAllMetaDataRecords = false;
                $scope.showAllData = false;
            }
            $scope.showloading = false;
            $scope.showallloading = false;
    }, function myError(response) {
        $scope.Name = response.statusText;
        $scope.showloading = false;   
        $scope.showallloading = false;     
        $scope.showErrorMessage = true;
        $scope.records = response.statusText;
        $scope.showAllData = false;
		var cookieTester = readCookie("disco");
		//$("#recentItemOf").css("background-color", "#ff000082");
		if(cookieTester && cookieTester.split(":").length){			
			$scope.ErrorMsg = 'Please refresh your page.';			
		}else{
			$scope.ErrorMsg = 'From this page of salesforce we cannot query your data. Salesforce Simplified cannot query if you are inside any manage package or your url is different than your home page.';
		}
    });
    }
    
    $scope.searchMetadataRecordsOnChange = function(){
        if($scope.searchAllMetaData.length){
            var que='';
            if($scope.selectedMetadata1.queryForAllWithWhere){
                $scope.showloading = true;
                que = $scope.selectedMetadata1.queryForAllWithWhere+" '%25"+$scope.searchAllMetaData+"%25'";
                $scope.queryOnAllDataFilterText(que, $scope.selectedMetadata1.url);
            }
        }else{
            $scope.searchMetadata($scope.selectedMetadata1);
        }
    }
    $scope.searchMetadataIfNothingTyped = function(){
        if(!$scope.searchAllMetaData.length){
            $scope.searchMetadata($scope.selectedMetadata1);
        }
    }

    $scope.queryOnAllDataFilterText = function(query, url){
        var completeurl = url+''+query+' limit '+$scope.limitLength;
        $scope.ErrorMsg = '';
        var configObj = {
            url : completeurl,
            headers : {"Authorization": "Bearer "+ readCookie('sid')},
            contentType : "application/json"
            };
            $http(configObj).then(function mySuccess(response) {
            $(".userdetails").removeClass('userdetailsError');
            $scope.AllMetaDataRecords = response.data.records;
            if($scope.AllMetaDataRecords && $scope.AllMetaDataRecords.length){
                $scope.isAllMetaDataRecords = true;
                $scope.showAllData = true;
                
                if($scope.selectedMetadata.eligibleForPackageXml && $scope.selectedMetaForPackageXml.size == 0){
                	$scope.AllMetaDataRecords.forEach(function(e) { e.selected = false });
                }
                if($scope.selectedMetadata.eligibleForPackageXml && $scope.selectedMetaForPackageXml.size > 0){
                	$scope.AllMetaDataRecords.forEach(function(e) { e.selected = fun(e.Id) });
                }
                if($scope.selectedMetadata.isSobjectType && $scope.AllMetaDataRecords.length && 
                		$scope.AllMetaDataRecords[0] && $scope.AllMetaDataRecords[0].DeveloperName){
                	$scope.AllMetaDataRecords.forEach(function(e) { e.DeveloperName = e.SobjectType ? e.SobjectType+'.'+e.DeveloperName : e.DeveloperName });
                }
                if($scope.selectedMetadata.isSobjectType && $scope.AllMetaDataRecords.length 
                		&& $scope.AllMetaDataRecords[0] && $scope.AllMetaDataRecords[0].Name){
                	$scope.AllMetaDataRecords.forEach(function(e) { e.Name = e.SobjectType ? e.SobjectType+'.'+e.Name : e.Name });
                }
                
            }else{
                $scope.isAllMetaDataRecords = false;
                $scope.showAllData = false;
            }
            $scope.showloading = false;
            
    }, function myError(response) {
        $scope.Name = response.statusText;
        $scope.showloading = false;
        $scope.showErrorMessage = true;
        $scope.records = response.statusText;
        $scope.showAllData = false;
        var cookieTester = readCookie("disco");
		//$("#recentItemOf").css("background-color", "#ff000082");
		if(cookieTester && cookieTester.split(":").length){			
			$scope.ErrorMsg = 'Please refresh your page.';			
		}else{
			$scope.ErrorMsg = 'From this page of salesforce we cannot query your data. Salesforce Simplified cannot query if you are inside any manage package or your url is different than your home page.';
		}
    });
    }
});