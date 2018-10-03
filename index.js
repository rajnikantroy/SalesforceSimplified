try{
var app = angular.module("SalesforceSimplifiedApp", []);
}catch(e){}

function recentItems() {
    var v = '<script src="/soap/ajax/28.0/connection.js" type="text/javascript"></script><script src="/soap/ajax/28.0/apex.js" type="text/javascript"></script><div ng-app="SalesforceSimplifiedApp" id="SalesforceSimplified"><div ng-controller="MenuAndDetailsCtrl"><img src="'+chrome.extension.getURL("/img/ss_icon_enable.png")+'" id="ss_icon" ng-mouseover="callModel()" ng-strict-di/><menu></menu></div></div>';
       $(".bPageFooter").append(v).fadeIn(3000);
	   $("#ss_icon").animate({left: '0px'});
	   $("#ss_icon").animate({left: '-30px'});
	   $("#ss_icon").animate({left: '0px'});
	   $("#ss_icon").animate({left: '-30px'});
}

function recentItems1() {
      var v = '<div ng-app="SalesforceSimplifiedApp" id="SalesforceSimplified"><div ng-controller="MenuAndDetailsCtrl"><img src="'+chrome.extension.getURL("/img/ss_icon_disable.png")+'" id="ss_icon" ng-mouseover="callModel()" ng-strict-di/><menu></menu></div></div>'; 
       $("body").append(v);
	   $("#ss_icon").animate({left: '0px'});
	   $("#ss_icon").animate({left: '-30px'});
	   $("#ss_icon").animate({left: '0px'});
	   $("#ss_icon").animate({left: '-30px'});

}

angular.element(document).ready(function(){
     angular.bootstrap(document.getElementById("SalesforceSimplified"), ['SalesforceSimplifiedApp']);
});

if($(".bPageFooter").length){
    recentItems();

    }else{
		//recentItems1();
	}

function __getUserId(){
	try{
	var uid = readCookie('uid');///, uidBool = verifyUser();
	if (typeof uid === 'undefined' || uid){
		setCookie('uid', uid, 2);
		$('#ss_icon').attr('src',chrome.extension.getURL("/img/ss_icon_enable.png"));
		return verifyUser();
	}
	else{
		var cookieData = readCookie("disco").split(':');
		for(var i=0; cookieData && cookieData.length && i<cookieData.length; i++){
			if(cookieData[i].startsWith('005')){
				 setCookie('uid', cookieData[i], 2);
				 $('#ss_icon').attr('src',chrome.extension.getURL("/img/ss_icon_enable.png"));
				 return verifyUser();
			}
		}
	}
	}catch(e){
		$('#ss_icon').attr('src',chrome.extension.getURL("/img/ss_icon_disable.png"));
	}
}

function __changeUser(cuid){
	setCookie('uid', cuid, 2);
	return verifyUser();
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
	          setCookie('uid', result.records[0].Id, 2);
	          setCookie('SFDCSimplified_uname', result.records[0].Name, 2);
	          $("#username").text(result.records[0].Username);
	          $("#userfullname").text(result.records[0].Name);
	          $("#useremail").text(result.records[0].Email);
	          return true;
      	}else if(result.statuscode > 400){
		    $("#username").text('Please change user.');
		    $(".userdetails").addClass('userdetailsError');
			$("#recentItemOf").css("background-color", "#ff000082");
      		return false;
		}else{
      		$("#username").text('Please change user.');
      		$("#userdetails").addClass('userdetailsError');
      		$(".userdetails").addClass('userdetailsError');
			$("#recentItemOf").css("background-color", "#ff000082");
      		return false;
      	 }
      	}
      });
}
catch(e){
	$("#username").text('Please change user.');
	$("#userdetails").addClass('userdetailsError');
	$(".userdetails").addClass('userdetailsError');
	$("#recentItemOf").css("background-color", "#ff000082");
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