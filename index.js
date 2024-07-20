try{
	var app = angular.module("SalesforceSimplifiedApp", []);
}catch(e){
	
}

var red = chrome.runtime.getURL("/img/ss_icon_enable.png");
var blue = chrome.runtime.getURL("/img/ss_icon_enable_blue.png");
var pink = chrome.runtime.getURL("/img/ss_icon_enable_pink.png");
var purple = chrome.runtime.getURL("/img/ss_icon_enable_purple.png");
var selectedLauncherColor = chrome.runtime.getURL("/img/ss_icon_enable.png");
load();

function load(){
	var colorMap = new Map();
	colorMap.set('Red', chrome.runtime.getURL("/img/ss_icon_enable.png"));
	colorMap.set('Blue', chrome.runtime.getURL("/img/ss_icon_enable_blue.png"));
	colorMap.set('Pink', chrome.runtime.getURL("/img/ss_icon_enable_pink.png"));
	colorMap.set('Purple', chrome.runtime.getURL("/img/ss_icon_enable_purple.png"));
	colorMap.set('Amazon', chrome.runtime.getURL("/img/ss_icon_enable_amazon.png"));
	colorMap.set('Dark Blue', chrome.runtime.getURL("/img/ss_icon_enable_darkblue.png"));
	colorMap.set('Bronze', chrome.runtime.getURL("/img/ss_icon_enable_bronze.png"));
	colorMap.set('Yellow', chrome.runtime.getURL("/img/ss_icon_enable_yellow.png"));
	namespacePrefix();
	if(readCookie('simplifiediconcolor')){
		selectedLauncherColor = colorMap.get(readCookie('simplifiediconcolor'));
	}else{
		selectedLauncherColor = chrome.runtime.getURL("/img/ss_icon_enable.png");
	}
	if(readCookie('simplified_background_color')){
		var BackColor = readCookie('simplified_background_color');
		$("body").css("background-color", BackColor);
	}else{
	}
}

function recentItems() {
    var v = '<div ng-app="SalesforceSimplifiedApp" id="SalesforceSimplified"><div ng-controller="MenuAndDetailsCtrl"><img src="'+selectedLauncherColor+'" id="ss_icon" ng-mouseover="callModel()" ng-strict-di/><menu></menu></div></div>';
       $(".bPageFooter").append(v).fadeIn(3000);
	   $("#ss_icon").animate({left: '0px'});
	   $("#ss_icon").animate({left: '-30px'});
	   $("#ss_icon").animate({left: '0px'});
	   $("#ss_icon").animate({left: '-30px'});
}

var debugLogContent = "";
function viewMyLogs() {
	var v = '<span ng-app="SalesforceSimplifiedApp" id="SalesforceSimplified1"><span ng-controller="MyViewGridCtrl"><span><input class="btn" value="My Logs" style="background: #1796bf; color: white;" ng-click="queryForDebugLogs()" type="button" ng-strict-di/></span><span><debugloggrid></debugloggrid></span></span></span>';
    $("#Apex_Trace_List\\:traceForm\\:traceTable").find("input[id$=deleteAll]").after(v);
}
function recentItems1() {
      var v = '<div ng-app="SalesforceSimplifiedApp" id="SalesforceSimplified"><div ng-controller="MenuAndDetailsCtrl"><img src="'+chrome.runtime.getURL("/img/ss_icon_disable.png")+'" id="ss_icon" ng-mouseover="callModel()" ng-strict-di/><menu></menu></div></div>'; 
       $("body").append(v);
	   $("#ss_icon").animate({left: '0px'});
	   $("#ss_icon").animate({left: '-30px'});
	   $("#ss_icon").animate({left: '0px'});
	   $("#ss_icon").animate({left: '-30px'});
}

angular.element(document).ready(function(){
     angular.bootstrap(document.getElementById("SalesforceSimplified"), ['SalesforceSimplifiedApp']);
     angular.bootstrap(document.getElementById("SalesforceSimplified1"), ['SalesforceSimplifiedApp']);
     namespacePrefix();
});

if($(".bPageFooter").length){
    recentItems();
    if($("#Apex_Trace_List\\:traceForm\\:traceTable").length > 0) {
    	viewMyLogs();
	}
    if($("#all_classes_page\\:theTemplate\\:theForm").length > 0){
       var v = '<span ng-app="SalesforceSimplifiedApp" id="SalesforceSimplified2"><span ng-controller="MyViewGridCtrl"><span><input class="btn" value="My Classes" title="By Salesforce Simplified" style="background: #1796bf; color: white;" ng-click="openClassModal()" type="button" ng-strict-di/></span><span><classgrid></classgrid></span></span></span>';
       $("#all_classes_page\\:theTemplate\\:theForm").find("input[id$=scheduleBatchApexButton]").after(v);
    }
    if($("#ApexClassViewPage\\:theTemplate\\:theForm\\:thePageBlock").length > 0){
    	var v = '<span ng-app="SalesforceSimplifiedApp" id="SalesforceSimplified2"><span ng-controller="MyViewGridCtrl"><span><input class="btn" value="My Classes" title="By Salesforce Simplified" style="background: #1796bf; color: white;" ng-click="openClassModal()" type="button" ng-strict-di/></span><span><classgrid></classgrid></span></span></span>';
        $("#ApexClassViewPage\\:theTemplate\\:theForm\\:thePageBlock").find("input[id$=showDependenciesButton]").after(v);
    }
	if($('input[name="edit"]').length){
		var v = '<span ng-app="SalesforceSimplifiedApp" id="SalesforceSimplified2"><span ng-controller="MyViewGridCtrl"><span><input class="btn" value="{{copyBtn}}" title="By Salesforce Simplified" style="background: #1796bf; color: white;" ng-click="CopyModal()" type="button" ng-strict-di/>   <!--input class="btn" value="Add to compare" title="By Salesforce Simplified" style="background: #1796bf; color: white;" ng-click="CompareModal()" type="button" ng-strict-di/-->   </span><!--span><compare></compare></span--></span></span>';
		$(v).insertBefore($('input[name="edit"]'));
	}
}
	

function __getUserId(){
	try{
	var uid = readCookie('uid');
	if (typeof uid === 'undefined' || uid){
		setCookie('uid', uid, 365);
		$('#ss_icon').attr('src',selectedLauncherColor);
		return verifyUser();
	}
	else{
		var cookieData = readCookie("disco").split(':');
		for(var i=0; cookieData && cookieData.length && i<cookieData.length; i++){
			if(cookieData[i].startsWith('005')){
				 setCookie('uid', cookieData[i], 365);
				 $('#ss_icon').attr('src',selectedLauncherColor);
				 return verifyUser();
			}
		}
	}
	}catch(e){
		$('#ss_icon').attr('src',chrome.runtime.getURL("/img/ss_icon_disable.png"));
	}
}

function __changeUser(cuid){
	setCookie('uid', cuid, 365);
	return verifyUser();
}

function namespacePrefix(){
	var id = readCookie('uid');
	var concatUrl = "/services/data/v32.0/query/?q=SELECT Id, NamespacePrefix FROM PackageLicense where NamespacePrefix in ('vlocity_cmt', 'vlocity_ins')";
  	if(readCookie('isNamespacePrefixAvailable') == null){
	  	try{
		$.ajax({
	         url: concatUrl,
	         type: "GET",
	         beforeSend: function(xhr){xhr.setRequestHeader('Authorization', 'Bearer '+readCookie("sid"));},
	         success: function(result) {
	          if(result && result.records && result.records.length>0){
		          setCookie('NamespacePrefix', result.records[0].NamespacePrefix+'__', 365);
		          setCookie('isNamespacePrefixAvailable', true, 365);
		          return true;
	      	}else{
	      		return false;
	      	 }
	      	}
	      });
		}
		catch(e){
		  	return false;
		}
	}else{
		return readCookie('isNamespacePrefixAvailable');
	}
}

function verifyUser(){
	var id = readCookie('uid');
	var concatUrl = "/services/data/v32.0/query/?q=SELECT Id, Username, Name, Email FROM user where id='"+id+"'";
  	try{
	$.ajax({
         url: concatUrl,
         type: "GET",
         beforeSend: function(xhr){xhr.setRequestHeader('Authorization', 'Bearer '+readCookie("sid"));},
         success: function(result) {
          if(result && result.records && result.records.length>0){
	          setCookie('uid', result.records[0].Id, 365);
	          setCookie('SFDCSimplified_uname', result.records[0].Name, 365);
	          $("#username").text(result.records[0].Username);
	          $("#userfullname").text(result.records[0].Name);
	          $("#useremail").text(result.records[0].Email);
	          return true;
      	}else if(result.statuscode > 400){
		    $("#username").text('Please change user.');
		    $(".userdetails").addClass('userdetailsError');
      		return false;
		}else{
      		$("#username").text('Please change user.');
      		$("#userdetails").addClass('userdetailsError');
      		$(".userdetails").addClass('userdetailsError');
      		return false;
      	 }
      	}
      });
	}
	catch(e){
		$("#username").text('Please change user.');
		$("#userdetails").addClass('userdetailsError');
		$(".userdetails").addClass('userdetailsError');
		return false;
	}
}

function setCookie(cname, cvalue, exdays) {
    var d = new Date();
    d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
    var expires = "expires="+d.toUTCString();
    document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function readCookie(name) {
    var nameEQ = name + "=";
    var ca = document.cookie.split(';');
    for(var i=0;i < ca.length;i++) {
        var c = ca[i];
        while (c.charAt(0)==' ') c = c.substring(1,c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
    }
    return null;
}