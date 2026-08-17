/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Mounts the Salesforce Simplified UI into the host page.
 *
 * Shared helpers (cookies, org URLs, API version, SOQL escaping) live in
 * js/ss-core.js. Angular bootstrapping happens in js/bootstrap.js, which must
 * run last - see the comment there.
 */

var app;
try{
	app = window.app = angular.module("SalesforceSimplifiedApp", []);
}catch(e){
	app = window.app = angular.module("SalesforceSimplifiedApp");
}

/*
 * Every icon this extension ships is served from a chrome-extension:// URL,
 * which is not in AngularJS's default img whitelist:
 *
 *     /^\s*((https?|ftp|file|blob):|data:image\/)/
 *
 * Anything outside it is rewritten to "unsafe:chrome-extension://..." and the
 * browser then fails to load it - a broken-image placeholder in place of the
 * icon. Only ng-src is affected, which is why the menu entries with a literal
 * src= render and the ng-switch-default ones do not.
 *
 * The added scheme only ever resolves to files inside this extension, so it
 * widens nothing an attacker could reach.
 */
app.config(['$compileProvider', function($compileProvider){
	$compileProvider.imgSrcSanitizationWhitelist(
		/^\s*((https?|ftp|file|blob|chrome-extension):|data:image\/)/);

	/*
	 * And the same for links, for the same reason and with the same effect.
	 *
	 * Angular's default href whitelist is
	 *
	 *     /^\s*(https?|ftp|mailto|tel|file):/
	 *
	 * so an ng-href to one of this extension's own pages is rewritten to
	 * "unsafe:chrome-extension://..." - which the browser then refuses to
	 * open. It is not a blocked navigation anybody sees a reason for: the
	 * link simply does nothing, with the word "unsafe" sitting in the
	 * address to explain why.
	 *
	 * The scheme only ever resolves to files inside this extension, listed
	 * in web_accessible_resources, so it widens nothing an attacker could
	 * reach - the same argument as the image rule above.
	 *
	 * Guarded because the method was renamed in Angular 1.8; this ships
	 * 1.6.4, and a version bump should not silently take the links out.
	 */
	var allowed = /^\s*(https?|ftp|mailto|tel|file|chrome-extension):/;
	if (typeof $compileProvider.aHrefSanitizationWhitelist === 'function') {
		$compileProvider.aHrefSanitizationWhitelist(allowed);
	} else if (typeof $compileProvider.aHrefSanitizationTrustedUrlList === 'function') {
		$compileProvider.aHrefSanitizationTrustedUrlList(allowed);
	}
}]);

// Named separately from the rest of LAUNCHER_COLORS below only because
// DEFAULT_LAUNCHER_COLOR falls back to `red`.
//
// They used to carry a warning that the launchercolor template read them as
// globals and they must not be made local. That template now renders from
// launcherIconSrc on the controller's scope and refers to none of them, so
// the warning described a coupling that no longer exists - and a comment
// telling the next person not to touch something, for a reason that has gone
// away, is worse than no comment.
var red = chrome.runtime.getURL("/img/ss_icon_enable.png");
var blue = chrome.runtime.getURL("/img/ss_icon_enable_blue.png");
var pink = chrome.runtime.getURL("/img/ss_icon_enable_pink.png");
var purple = chrome.runtime.getURL("/img/ss_icon_enable_purple.png");

// Built once at load instead of on every call to load().
//
// Declared before DEFAULT_LAUNCHER_COLOR, which is derived from it. `var`
// hoists the name but not the value, so with these the other way round the
// default read an undefined map and threw on the first line of the file -
// taking the whole content script, and with it the launcher, down with it.
var LAUNCHER_COLORS = {
	'Red': red,
	'Blue': blue,
	'Pink': pink,
	'Purple': purple,
	'Amazon': chrome.runtime.getURL("/img/ss_icon_enable_amazon.png"),
	'Dark Blue': chrome.runtime.getURL("/img/ss_icon_enable_darkblue.png"),
	'Bronze': chrome.runtime.getURL("/img/ss_icon_enable_bronze.png"),
	'Yellow': chrome.runtime.getURL("/img/ss_icon_enable_yellow.png")
};

// The shipped default. The name lives in ss-core's SS_LAUNCHER_DEFAULTS so
// the settings panel and the launcher itself cannot disagree about it; this
// resolves it to the icon file, and falls back to red if the name ever names
// a colour that is not in the map.
var DEFAULT_LAUNCHER_COLOR = LAUNCHER_COLORS[SS_LAUNCHER_DEFAULTS.color] || red;
var selectedLauncherColor = DEFAULT_LAUNCHER_COLOR;

load();

function load(){
	selectedLauncherColor = LAUNCHER_COLORS[ssLauncherColorName()] || DEFAULT_LAUNCHER_COLOR;

	var backColor = readCookie('simplified_background_color');
	if(backColor && document.body){
		document.body.style.backgroundColor = backColor;
	}

	namespacePrefix();
	fetchLatestApiVersion();
}

/* ------------------------------------------------------------------ */
/* Mount points                                                        */
/* ------------------------------------------------------------------ */

// Each entry: where to look, what to inject, and where to put it. Previously
// four near-identical if-blocks with the markup inlined in each.
function gridRoot(inner){
	var themeClass = 'theme-lightning';
	return '<span id="SalesforceSimplified2" class="' + themeClass + '"><span ng-controller="MyViewGridCtrl">' + inner + '</span></span>';
}

// Sized in CSS rather than inline: these sit in a row of Salesforce's own
// buttons, and the inline style could not be adjusted without editing every
// call site. See .ss-inline-btn.
function ssButton(label, action){
	return '<input class="btn ss-inline-btn" value="' + label + '" title="By Salesforce Simplified" '
		+ 'ng-click="' + action + '" type="button" ng-strict-di/>';
}

function appendRecentItems() {
    if (document.getElementById("SalesforceSimplified")) {
        return;
    }
    var themeClass = 'theme-lightning';
    const recentItemsHTML = `
        <div id="SalesforceSimplified" class="${themeClass}">
            <div ng-controller="MenuAndDetailsCtrl">
                <img src="${selectedLauncherColor}" id="ss_icon" ng-mouseover="callModel()" ng-strict-di/>
                <menu></menu>
            </div>
        </div>`;
    
    let footer = document.querySelector(".bPageFooter") || document.body;
    if (footer) {
        footer.insertAdjacentHTML('beforeend', recentItemsHTML);
        animateIcon();
    }
}

function animateIcon() {
    const icon = document.getElementById("ss_icon");
    if (icon) {
        /*
         * Shape, finish and opacity applied here rather than waiting for the
         * Angular controller. The controller only runs once the menu markup
         * is compiled, so leaving it to that meant the launcher appeared as a
         * plain opaque square and then changed shape a moment later.
         */
        try {
            icon.style.opacity = (ssLauncherOpacity() / 100).toString();
            ssApplyLauncherStyle(ssLauncherShape(), ssLauncherFinish());
        } catch(e) {}

        /*
         * The wave is an introduction, so it stops once the introduction is
         * over - see ssWithinIntroPeriod. Asked asynchronously and applied
         * late on purpose: the shape, finish and opacity above must land
         * immediately or the launcher visibly changes under the user, but the
         * animation is decorative and a few milliseconds of delay before it
         * starts costs nothing.
         */
        ssWithinIntroPeriod(function (isNewUser) {
            if (!isNewUser) {
                return;
            }
            try {
                icon.animate([
                    { transform: 'translateX(30px)' },
                    { transform: 'translateX(0px)' },
                    { transform: 'translateX(30px)' },
                    { transform: 'translateX(0px)' }
                ], { duration: 2000, iterations: 1 });
            } catch(e) {}
        });
    }
}

$(document).ready(() => {
    // Classic and Lightning only. appendRecentItems falls back to document.body
    // when there is no .bPageFooter, so without this a marketing or docs page
    // on the same domain would get the launcher pinned to it.
    if (!ssIsOrgPage()) {
        return;
    }
    // Being on the org's host is not the same as being inside the org: the
    // login, logout and OAuth pages are served from it too. Nothing the
    // launcher opens works before the user is in, so it should not be there
    // to be clicked - and load() below would spend a network round trip on
    // an API version it cannot fetch without a session either.
    if (ssIsAuthPage()) {
        return;
    }
    load();
    appendRecentItems();
});

$(document).on('mouseenter', '#ss_icon, #mySidenav', function() {
    var scope = angular.element($('#SalesforceSimplified')[0] || this).scope();
    if (scope && scope.callModel) {
        if (!scope.$$phase) {
            scope.$apply(function() { scope.callModel(); });
        } else {
            scope.callModel();
        }
    } else {
        ssOpenMenu();
    }
});

	if(ssIsOrgPage()){

	var TRACE_TABLE = "#Apex_Trace_List\\:traceForm\\:traceTable";
	if($(TRACE_TABLE).length){
		var themeClass = 'theme-lightning';
		var logs = '<span id="SalesforceSimplified1" class="' + themeClass + '"><span ng-controller="MyViewGridCtrl">'
			+ ssButton('My Logs', 'queryForDebugLogs()')
			+ '<debugloggrid></debugloggrid></span></span>';
		$(TRACE_TABLE).find("input[id$=deleteAll]").after(logs);
	}

	var classesMarkup = gridRoot(ssButton('My Classes', 'openClassModal()') + '<classgrid></classgrid>');
	[
		{ container: "#all_classes_page\\:theTemplate\\:theForm",                anchor: "input[id$=scheduleBatchApexButton]" },
		{ container: "#ApexClassViewPage\\:theTemplate\\:theForm\\:thePageBlock", anchor: "input[id$=showDependenciesButton]" }
	].forEach(function(spot){
		var container = $(spot.container);
		if(container.length){
			container.find(spot.anchor).after(classesMarkup);
		}
	});

	var editButton = $('input[name="edit"]');
	if(editButton.length){
		$(gridRoot(ssButton('{{copyBtn}}', 'CopyModal()'))).insertBefore(editButton);
	}

	} // end ssIsOrgPage()

/* ------------------------------------------------------------------ */
/* Bootstrap helpers (invoked from js/bootstrap.js)                     */
/* ------------------------------------------------------------------ */

// ng-app auto-bootstrap is deliberately not used: it has the same ordering
// exposure and only ever picks up the *first* ng-app element, leaving the
// #SalesforceSimplified1 and #SalesforceSimplified2 roots uncompiled.
function bootstrapAllRoots(){
	var roots = document.querySelectorAll("#SalesforceSimplified, #SalesforceSimplified1, [id='SalesforceSimplified2']");
	for(var i = 0; i < roots.length; i++){
		bootstrapRoot(roots[i]);
	}
}

function bootstrapRoot(element){
	try{
		// Already bootstrapped (duplicate id, re-entry) - skip.
		if(angular.element(element).injector()){
			return;
		}
		angular.bootstrap(element, ['SalesforceSimplifiedApp']);
	}catch(e){
		console.error('Salesforce Simplified: failed to bootstrap', element, e);
	}
}

/* ------------------------------------------------------------------ */
/* Session / user                                                      */
/* ------------------------------------------------------------------ */

function __getUserId(){
	try{
		var selectedUid = readCookie('ss_selected_uid') || (function(){ try { return localStorage.getItem('ss_selected_uid'); }catch(e){ return null; } })();
		var uid = selectedUid || readCookie('uid');
		if(selectedUid){
			setCookie('uid', selectedUid, 365);
		}
		if(!uid && typeof UserContext !== 'undefined' && UserContext.userId){
			uid = UserContext.userId;
			setCookie('uid', uid, 365);
		}
		if(!uid && window.SFDCSessionVars && SFDCSessionVars.userId){
			uid = SFDCSessionVars.userId;
			setCookie('uid', uid, 365);
		}
		$('#ss_icon').attr('src', selectedLauncherColor || DEFAULT_LAUNCHER_COLOR);
		if(uid){
			return verifyUser();
		}
		var disco = readCookie('disco');
		var cookieData = disco ? disco.split(':') : [];
		for(var i = 0; i < cookieData.length; i++){
			if(cookieData[i].startsWith('005')){
				setCookie('uid', cookieData[i], 365);
				return verifyUser();
			}
		}
		/*
		 * Nothing here knew, which on a first login is the normal case and not
		 * an error: the two branches above that read UserContext and
		 * SFDCSessionVars are reading page globals from an isolated content
		 * script and can never answer, and disco is not written yet. Ask the
		 * org. ssUserReady writes the same uid cookie this function reads, so
		 * verifyUser then behaves as if it had been there all along.
		 */
		if(typeof ssUserReady === 'function'){
			ssUserReady().then(function(id){
				if(id){ verifyUser(); }
				else { markUserLookupFailed(); }
			});
		}
		return false;
	}catch(e){
		$('#ss_icon').attr('src', selectedLauncherColor || DEFAULT_LAUNCHER_COLOR);
		return false;
	}
}

function __changeUser(cuid){
	if(cuid){
		setCookie('uid', cuid, 365);
		setCookie('ss_selected_uid', cuid, 365);
		try { localStorage.setItem('ss_selected_uid', cuid); } catch(e){}
	}
	return verifyUser();
}

function __resetToSelf(){
	setCookie('ss_selected_uid', '', -1);
	try { localStorage.removeItem('ss_selected_uid'); } catch(e){}
	setCookie('uid', '', -1);
	return __getUserId();
}

function namespacePrefix(){
	// A negative result used to leave isNamespacePrefixAvailable unset, so orgs
	// without the vlocity package re-ran this query on every single page load.
	// Cache both outcomes.
	if(readCookie('isNamespacePrefixAvailable') != null){
		return readCookie('isNamespacePrefixAvailable') === 'true';
	}
	if(!ssSessionId()){
		return false;
	}
	var soql = "SELECT Id, NamespacePrefix FROM PackageLicense where NamespacePrefix in ('vlocity_')";
	$.ajax({
		url: ssQueryUrl() + soql,
		type: "GET",
		beforeSend: ssAuthorize,
		success: function(result) {
			if(result && result.records && result.records.length > 0){
				setCookie('NamespacePrefix', result.records[0].NamespacePrefix+'__', 365);
				setCookie('isNamespacePrefixAvailable', true, 365);
			}else{
				setCookie('isNamespacePrefixAvailable', false, 365);
			}
		}
	});
}

function verifyUser(){
	if(!ssSessionId()){
		return false;
	}
	var soql = "SELECT Id, Username, Name, Email FROM user where id='"+escapeSoqlLiteral(readCookie('uid'))+"'";
	$.ajax({
		url: ssQueryUrl() + soql,
		type: "GET",
		beforeSend: ssAuthorize,
		success: function(result) {
			if(result && result.records && result.records.length > 0){
				var user = result.records[0];
				setCookie('uid', user.Id, 365);
				setCookie('SFDCSimplified_uname', user.Name, 365);
				$("#username").text(user.Username);
				$("#userfullname").text(user.Name);
				$("#useremail").text(user.Email);
				return;
			}
			markUserLookupFailed();
		},
		error: markUserLookupFailed
	});
}

function markUserLookupFailed(){
	$("#username").text('Please change user.');
	$("#userdetails").addClass('userdetailsError');
	$(".userdetails").addClass('userdetailsError');
}
