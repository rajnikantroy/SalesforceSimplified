/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
var app = window.app || angular.module("SalesforceSimplifiedApp");
app.controller('MenuAndDetailsCtrl', function($scope, MetaDataContainer, DynamicMetadataService, sfdc, $q, $timeout, $interval, UserId, NewsService, UsageService, IntegrationService, TrustService, MetadataApiService, PackageDependencyService, BookmarkService, SchemaService, PipelineService, EventGraphService) {
    var closeTimer = null;

    /*
     * Which open a list response belongs to. See openMetadata, where it is
     * bumped, and the three query handlers, which drop anything older.
     */
    var listGeneration = 0;
    function listResponseStillWanted(generation){
        return generation === listGeneration;
    }

    $scope.edit = 'Edit';
	$scope.vieweye = 'ViewEye';
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
    $scope.usageanalytics = 'UsageAnalytics';
    $scope.newstimeline = 'NewsTimeline';
    $scope.apimonitor = 'ApiMonitor';
    $scope.audittrail = 'AuditTrail';
    $scope.aboutus = 'AboutUs';
    $scope.truststatus = 'TrustStatus';
    $scope.notificationsettings = 'NotificationSettings';
    
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
    $("#mySidenav").css({"width": "0px", "display": "none"});
    $scope.fieldlevelactionlength = 0;
    $scope.showErrorMessage = false;
    $scope.showAllData = false;
    $scope.isDataAvailable = true;
    $scope.editLogo = chrome.runtime.getURL("img/edit.png");
    $scope.downloadLogo = chrome.runtime.getURL("img/download.png");
    $scope.showpaymentflag = false;
    $scope.selectedMetaForPackageXml = new Map();
    $scope.selectedDataForDownload = new Map();
    $scope.packageMetaTypeAndName = new Map();
    $scope.entityIdMap = new Map();
    
    $scope.packageMetaDataFrequency = [];
    $scope.objectEntityIdNameMap = new Map();
   
    /* ----------------------------------------------------------------- */
    /* Session state / Connected App sign-in                               */
    /* ----------------------------------------------------------------- */

    // Assume a session until proven otherwise, so the sign-in overlay does not
    // flash on every popup while chrome.storage is still being read.
    $scope.hasSession = true;
    $scope.signingIn = false;
    $scope.signInError = '';
    $scope.clientId = '';
    $scope.clientIdInput = '';
    $scope.showClientIdInput = false;
    $scope.redirectUrl = '';

    /*
     * Whether the user has closed the sign-in overlay.
     *
     * Not remembered between page loads on purpose. Signing in is still the
     * thing we want them to do, and a session can appear at any time - a
     * different tab, an admin installing the Connected App - so the offer
     * comes back next time rather than being permanently opted out of on the
     * strength of one dismissal.
     */
    $scope.signInDismissed = false;

    /*
     * The card asked for, rather than forced.
     *
     * It shows itself when there is no session, which is the only way in it
     * ever needed - until "Add another org" in the picker. Someone already
     * signed in to one org has a session, so that gate held the card shut on
     * the one action whose whole purpose is to open it.
     *
     * Kept as a separate flag rather than by loosening the gate: the two are
     * different states. No session means nothing works until this is dealt
     * with, and the page is locked behind it. Asking to add an org is an
     * errand - the page underneath is fine, and closing the card leaves the
     * user exactly where they were.
     */
    $scope.signInRequested = false;

    /*
     * Why the card was asked for.
     *
     * Two things raise it and they are not the same errand. "Add another org"
     * is chosen from the org picker by someone who already has a session; the
     * All Fields and Export buttons raise it because there is no session at
     * all. Both used to arrive as one flag, so a signed-out user clicking
     * Export was told they were adding another org.
     */
    $scope.signInReason = '';

    $scope.requestSignIn = function(reason){
        $scope.signInRequested = true;
        $scope.signInReason = reason || 'session';
        $scope.signInDismissed = false;
        $scope.signInError = '';
    };

    $scope.dismissSignIn = function(){
        $scope.signInDismissed = true;
        $scope.signInRequested = false;
        $scope.signInReason = '';
    };

    $scope.resumeSignIn = function(){
        $scope.signInDismissed = false;
        $scope.signInError = '';
    };

    // The one panel that reads without a session - see signedoutnotice.
    $scope.openTrustStatus = function(){
        var spec = MetaDataContainer.byValue($scope.truststatus);
        if(spec){
            $scope.detailsPopupOpen(spec);
        }
    };

    function refreshSessionState(){
        $scope.hasSession = ssHasSession();
        $scope.usingOAuth = ssUsingOAuth();
    }

    /*
     * Startup, and what happens when it cannot finish.
     *
     * hasSession starts true so the sign-in overlay does not flash while
     * storage is being read - a good default only for as long as something
     * is still going to correct it. refreshSessionState() below is the only
     * thing that ever does, so if this never runs the panel sits believing
     * in a session it has not got: no overlay, no error, nothing.
     *
     * That is exactly what a first-time user saw: open the panel, touch
     * nothing, and get neither a sign-in nor a reason.
     *
     * So this runs on both outcomes, and needs no separate handling for the
     * failed one - refreshSessionState below reads the session afresh
     * either way, and with nothing to read it turns hasSession off and the
     * overlay appears. Presetting it here would only be overwritten two
     * lines later, which is worse than not writing it: it reads as a
     * safeguard and is not one.
     */
    function beginPanel(){
        $scope.clientId = SS_AUTH.clientId || '';
        /*
         * The box only ever shows a key the user chose.
         *
         * SS_AUTH.clientId falls back to the Connected App this extension
         * ships with, and that was being written into the field labelled
         * "Consumer Key from your Connected App" - so the extension's own key
         * looked like the org's, the form arrived apparently already filled
         * in, and the one thing the user was being asked to do looked done.
         * Worse, the org reading that form is by definition an org where that
         * particular key does not work: it is why the section opened.
         *
         * A key the user saved earlier is still shown, so they can see and
         * correct what is in use.
         */
        $scope.clientIdInput = ($scope.clientId === SS_CONNECTED_APP_CLIENT_ID)
            ? ''
            : $scope.clientId;
        refreshSessionState();

        /*
         * Check the watch list once the session is settled.
         *
         * Here rather than at controller construction because the check is a
         * query: run any earlier and it fires before there is anything to
         * authenticate with, fails, and reports "could not be checked" on
         * every single open.
         */
        if($scope.hasSession){ checkBookmarks(true); }

        /*
         * Again, now the org is settled.
         *
         * The basket is keyed by org, and on simplified.html SS_ORIGIN is the
         * extension until a org is adopted - so the restore at construction
         * looked under the wrong key there and found nothing. Restoring is
         * keyed by component, so running it twice costs a read and changes
         * nothing when the first one already worked.
         */
        restorePackageSelection();
        // The record basket is keyed by org in exactly the same way, and was
        // looking under the same wrong key on simplified.html.
        restoreDataSelection();
    }

    /*
     * Both outcomes, deliberately. ssAuthReady is written never to reject,
     * and this is the second lock on that door: a chain that fails anyway
     * must still start the panel, in the state that offers a sign-in.
     */
    $q.when(ssAuthReady()).then(beginPanel, beginPanel);

    // Shown so the user knows what to register as the Connected App callback.
    try{
        chrome.runtime.sendMessage({type: 'SS_OAUTH_REDIRECT_URL'}, function(response){
            void chrome.runtime.lastError;
            if(response && response.redirectUrl){
                $scope.$applyAsync(function(){ $scope.redirectUrl = response.redirectUrl; });
            }
        });
    }catch(e){
        // Not an extension context (test harness).
    }

    /*
     * When the shipped Connected App is not usable in this org.
     *
     * The default Consumer Key belongs to an app that has to be reachable
     * from the org signing in. Plenty of orgs will not have it - it is not
     * installed, an admin has blocked uninstalled apps, or the org only
     * permits apps of its own. Salesforce says so in its own words
     * ("External client app is not installed in this org"), which is
     * accurate and tells the user nothing about what to do next.
     *
     * The way out has always existed in the code - ssSaveClientId, and a
     * clientIdInput on this scope - but the overlay never rendered any of
     * it, so there was no way to reach it and the sign-in was simply a dead
     * end. These errors now open that section instead.
     */
    /*
     * Also matches the "authorization page could not be loaded" failure: that
     * is what a rejected launchWebAuthFlow looks like, and an org refusing
     * the app is by far its commonest cause. Missing it left the user at a
     * long error with the fix hidden behind a link they had no reason to
     * click.
     */
    var OWN_APP_NEEDED = /not installed|not available|no.?such.?client|invalid_client|invalid client|client identifier|OAUTH_APP_BLOCKED|blocked|will not accept|authorization page could not be loaded/i;

    /*
     * Which login host to start from.
     *
     * Defaults to this org, which is what it always did. The other three
     * exist for the cases the guess cannot cover: an org whose host does not
     * say it is a sandbox, and signing in to an org other than the one being
     * browsed.
     */
    $scope.loginTargets = [
        { key: 'org',        label: 'This org' },
        { key: 'production', label: 'Production' },
        { key: 'sandbox',    label: 'Sandbox' },
        { key: 'custom',     label: 'Custom URL' }
    ];
    $scope.loginTarget = 'org';
    $scope.customLoginUrl = '';

    $scope.setLoginTarget = function(key){
        $scope.loginTarget = key;
        $scope.signInError = '';
    };

    /*
     * Where "This org" actually points.
     *
     * ssSoapOrigin derives the org from the page's own hostname, which on
     * simplified.html is the extension - so it fell back to SS_ORIGIN and the
     * overlay offered to sign in to "chrome-extension://hjeig...". That is not
     * an org, and signing in to it sent the flow to login.salesforce.com by
     * default rather than to the org the user is actually looking at.
     *
     * On that page the org is chosen rather than browsed, so ask what it
     * chose. Returns '' when there is genuinely no org yet, which is a real
     * state the overlay has to be able to show.
     */
    $scope.orgLoginOrigin = function(){
        var browsed = ssSoapOrigin();
        if (/^https:\/\//i.test(browsed)) { return browsed; }

        if ($scope.currentOrigin) { return $scope.currentOrigin; }
        if ($scope.knownOrgs && $scope.knownOrgs.length) {
            return $scope.knownOrgs[0].origin || '';
        }
        return '';
    };

    // "This org" is only a choice when there is one.
    $scope.hasOrgLoginTarget = function(){
        return !!$scope.orgLoginOrigin();
    };


    $scope.useOwnApp = function(){
        $scope.showClientIdInput = true;
    };

    /* ----------------------------------------------------------------- */
    /* Signing in with a session id                                        */
    /*                                                                     */
    /* The door that needs no Setup access. A Connected App needs           */
    /* permissions plenty of users do not have, and the sid readable on a   */
    /* Lightning host is not a valid API session - so for some orgs this is */
    /* the only way in. Workbench and the SFDX access-token flow work the   */
    /* same way.                                                            */
    /* ----------------------------------------------------------------- */

    $scope.showSessionIdInput = false;
    $scope.sessionIdUrl = '';
    $scope.sessionIdValue = '';

    $scope.useSessionId = function(){
        $scope.showSessionIdInput = true;
        // Somewhere to start that is right most of the time, and visibly
        // wrong when it is not - better than an empty box next to a warning
        // about where the credential gets sent.
        if(!$scope.sessionIdUrl){
            $scope.sessionIdUrl = ssSoapOrigin();
        }
    };

    $scope.signInWithSessionId = function(){
        $scope.signingIn = true;
        $scope.signInError = '';

        ssSignInWithSessionId($scope.sessionIdValue, $scope.sessionIdUrl)
            .then(function(){
                /*
                 * Proved against the org before the overlay comes down.
                 * Accepting a session id on sight would replace "sign in" with
                 * a UI that looks signed in and 401s on every panel - and the
                 * commonest mistakes here (a Lightning sid, an expired one,
                 * a user without API Enabled) all look exactly like a valid
                 * one until something is asked of it.
                 */
                /*
                 * A raw REST call, not sfdc.query.
                 *
                 * query() goes through the schema engine - it waits on
                 * SchemaService, decides which API can serve the object, and
                 * rewrites the SOQL. With a session that has never been used
                 * there is no cached catalogue, so a failure there says
                 * nothing about whether the session is any good, and a
                 * success can come back empty for the same reason.
                 *
                 * /services/oauth2/userinfo answers for any valid session,
                 * needs no permission beyond being logged in, and touches
                 * nothing else - so what it returns is a fact about the
                 * session and only that.
                 */
                return sfdc.get(ssApiOrigin() + '/services/oauth2/userinfo');
            })
            .then(function(info){
                /*
                 * Register the org before reloading.
                 *
                 * The org picker is built from the stored briefs, and those are
                 * written by Trust, News and Usage - none of which have run for
                 * an org signed into this way. So the reload rebuilt the list
                 * from a store that had never heard of it, and the org was
                 * missing until something else happened to record it and the
                 * page was reloaded a second time.
                 *
                 * userinfo has just answered, so the username it returned is
                 * the cheapest true thing to record alongside it.
                 */
                return ssUpdateBrief({
                    alias: (info && (info.username || info.preferred_username)) || null,
                    signedInWith: 'sessionId'
                });
            })
            .then(function(){
                window.location.reload();
            })
            .catch(function(error){
                // Nothing usable was established, so nothing is kept.
                ssForgetSessionId();
                $scope.$applyAsync(function(){
                    $scope.signingIn = false;
                    $scope.signInError = (error && error.message) ||
                        'That session id was not accepted by the org. Check that it came ' +
                        'from your my.salesforce.com address and has not expired.';
                });
            });
    };

    /*
     * A one-click install of the packaged Connected App, when there is one.
     *
     * This is as close as the extension can get to "install it while I am
     * logging in": it cannot create the app - that needs a session it does
     * not have yet - but it can take an admin straight to installing one
     * that is already built. Empty unless a package id is configured, in
     * which case the offer is not shown at all.
     */
    $scope.appInstallUrl = function(){
        return ssAppInstallUrl();
    };

    $scope.copyRedirectUrl = function(){
        if(!navigator.clipboard || !navigator.clipboard.writeText){ return; }
        navigator.clipboard.writeText($scope.redirectUrl).then(function(){
            $scope.$applyAsync(function(){
                $scope.redirectCopied = true;
                $timeout(function(){ $scope.redirectCopied = false; }, 2500);
            });
        }, function(){
            $scope.$applyAsync(function(){ $scope.redirectCopied = false; });
        });
    };

    // Setup home rather than a deep link: the App Manager path differs
    // between Classic and Lightning and has moved before, and a 404 in the
    // middle of a sign-in problem helps nobody.
    $scope.setupUrl = function(){
        return ssOrgUrl('/lightning/setup/SetupOneHome/home');
    };

    $scope.signIn = function(){
        $scope.signingIn = true;
        $scope.signInError = '';
        var clientId = ($scope.clientIdInput || SS_CONNECTED_APP_CLIENT_ID || SS_AUTH.clientId || '').trim();
        if(!clientId){
            $scope.signingIn = false;
            $scope.signInError = 'Please provide a valid Connected App Consumer Key.';
            $scope.showClientIdInput = true;
            return;
        }
        /*
         * For "This org" the resolved origin above is the authority - passing
         * the target through ssLoginOrigin would re-derive it from the
         * hostname and land back on the extension's own origin.
         */
        var target = ($scope.loginTarget === 'org' && $scope.hasOrgLoginTarget())
            ? { origin: $scope.orgLoginOrigin() }
            : ssLoginOrigin($scope.loginTarget, $scope.customLoginUrl);
        if(target.error){
            $scope.signingIn = false;
            $scope.signInError = target.error;
            return;
        }

        ssSaveClientId(clientId)
            .then(function(){ return ssSignIn(clientId, target.origin); })
            .then(function(){
                /*
                 * Record the org before reloading, exactly as the session-id
                 * path does and for the same reason: the picker is built from
                 * the stored briefs, which are written by Trust, News and
                 * Usage - none of which have run for an org just signed into.
                 * Without this, "Add another org" signed in successfully and
                 * the org still was not in the list afterwards.
                 *
                 * ssSignIn has already set SS_AUTH, so ssApiOrigin - and the
                 * key ssUpdateBrief derives from it - is the new org's.
                 */
                return ssUpdateBrief({ signedInWith: 'oauth' });
            })
            .then(function(){
                window.location.reload();
            })
            .catch(function(error){
                $scope.$applyAsync(function(){
                    $scope.signingIn = false;
                    $scope.signInError = (error && error.message) || 'Sign-in failed.';
                    // An org that cannot use the shipped app needs its own,
                    // so put that in front of the user rather than leaving
                    // them at an error with no next step.
                    if(OWN_APP_NEEDED.test($scope.signInError)){
                        $scope.showClientIdInput = true;
                    }
                });
            });
    }

    $scope.signOut = function(){
        ssSignOut().then(function(){
            window.location.reload();
        });
    }

    // All three of these open-coded the same expiry maths as setCookie().
    var PREFERENCE_DAYS = 365;

    $scope.setSimplifiedCookie = function(key, value){
    	setCookie(key, value, PREFERENCE_DAYS);
    }

    /*
     * The All Fields button on record pages, drawn by record-fields.js
     * rather than by anything here - so this writes the preference and that
     * module reads it on its next placement.
     *
     * On unless turned off. Anything other than 'false' is on, so a cookie
     * that was cleared or never written behaves the same as one that says yes.
     */
    $scope.showAllFieldsTab = readCookie('Simplified_AllFieldsTab') !== 'false';

    $scope.toggleAllFieldsTab = function(){
        $scope.setSimplifiedCookie('Simplified_AllFieldsTab', !!$scope.showAllFieldsTab);
    };

    /*
     * The Export button on list views, drawn by list-export.js.
     *
     * Same shape as the one above and for the same reason: written here, read
     * by a module that has no Angular of its own. On unless turned off, and
     * anything other than 'false' is on - so a cookie that was cleared or
     * never written behaves the same as one that says yes.
     */
    $scope.showListExport = readCookie('Simplified_ListExport') !== 'false';

    $scope.toggleListExport = function(){
        $scope.setSimplifiedCookie('Simplified_ListExport', !!$scope.showListExport);
    };

    /*
     * Picking a colour used to write the cookie and stop there, so nothing
     * changed until the page was reloaded - the launcher kept its old colour
     * and so did every preview on this page, which reads the icon's src.
     * Apply it to all three now: the cookie for next time, the live icon, and
     * the value the previews are drawn from.
     */
    $scope.launcherColorName = ssLauncherColorName();

    $scope.setColorInCookie = function(color){
    	setCookie('simplifiediconcolor', color, PREFERENCE_DAYS);
    	$scope.launcherColorName = color;

    	var src;
    	try{
    		src = LAUNCHER_COLORS[color];
    	}catch(e){
    		src = null;
    	}
    	if(!src){ return; }

    	// index.js re-reads this whenever it re-attaches the launcher.
    	try{ selectedLauncherColor = src; }catch(e){}

    	var icon = document.getElementById('ss_icon');
    	if(icon){ icon.setAttribute('src', src); }
    	$scope.launcherIconSrc = src;
    }

    $scope.changeBackgroundColor = function(){
    	$("body").css("background-color", $scope.backgroundcolor);
    	$scope.setSimplifiedCookie('simplified_background_color', $scope.backgroundcolor);
    }

    $scope.setSimplifiedBackColor = function(color){
    	$scope.backgroundcolor = color;
    	$scope.changeBackgroundColor();
    }

    // ------------------------------------------------------------------
    // Full screen vs the smaller panel
    //
    // Full screen is the default: the panel has a lot to show and the old
    // 540px box left most of the screen unused. Remembered like the other
    // display preferences, and the test is against 'false' rather than
    // 'true' so that only an explicit opt-out turns it off - an absent
    // cookie is a new user, who should get the default.
    // ------------------------------------------------------------------
    $scope.fullScreen = readCookie('simplified_full_screen') !== 'false';

    $scope.toggleFullScreen = function(){
        $scope.fullScreen = !$scope.fullScreen;
        setCookie('simplified_full_screen', $scope.fullScreen, PREFERENCE_DAYS);
    };

    /*
     * The extension's own page, optionally on a particular one of its pages.
     *
     * openOn is a MetaDataContainer value - the same thing ?type= carries on
     * that page. Passed on rather than acted on here: only the worker can see
     * whether a standalone tab is already open, and landing somebody on the
     * page they asked for means moving that tab, not just focusing it.
     *
     * The plain header button passes nothing and keeps its old behaviour,
     * which is to open the page wherever it was left.
     */
    $scope.openInNewTab = function(openOn){
        // The click handler is also bound with no argument in places where
        // Angular passes the event; only a string is a page.
        var page = typeof openOn === 'string' ? openOn : null;

        function fallback(){
            var tabUrl = 'simplified.html';
            try{
                if(chrome.runtime.getURL){ tabUrl = chrome.runtime.getURL('simplified.html'); }
            }catch(e){}
            if(page){ tabUrl += '?type=' + encodeURIComponent(page); }
            window.open(tabUrl, '_blank');
        }

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: 'SS_OPEN_STANDALONE_PAGE', openOn: page },
                function(response) {
                    if (chrome.runtime.lastError || (response && response.error)) {
                        fallback();
                    }
                });
        } else {
            fallback();
        }
    };

    // ------------------------------------------------------------------
    // Launcher Opacity (10% – 100%)
    // ------------------------------------------------------------------
    $scope.launcherOpacity = ssLauncherOpacity();

    /*
     * The weekly review, before the value is put on screen so the launcher
     * shows what it settled on rather than last week's number.
     *
     * UsageService owns the decision; the controller only carries the result
     * into the cookie and the icon. The report it returns is what the
     * launcher page explains itself with, so the explanation cannot drift
     * away from the arithmetic that produced it.
     */
    $scope.opacityReview = UsageService.reviewOpacity($scope.launcherOpacity);
    if ($scope.opacityReview.changed) {
        $scope.launcherOpacity = $scope.opacityReview.opacity;
        setCookie('simplified_launcher_opacity', $scope.launcherOpacity, PREFERENCE_DAYS);
    }

    // Apply on load and grab the icon src for the in-page live preview
    (function applyInitialOpacity() {
        var icon = document.getElementById('ss_icon');
        var defaultSrc = (typeof LAUNCHER_COLORS !== 'undefined' && LAUNCHER_COLORS[$scope.launcherColorName]) ? LAUNCHER_COLORS[$scope.launcherColorName] : chrome.runtime.getURL('/img/simplify.png');
        if (icon) {
            icon.style.opacity = ($scope.launcherOpacity / 100).toString();
            $scope.launcherIconSrc = icon.getAttribute('src') || defaultSrc;
        } else {
            $scope.launcherIconSrc = defaultSrc;
        }
    })();

    $scope.setLauncherOpacity = function() {
        var val = parseInt($scope.launcherOpacity, 10);
        if (isNaN(val) || val < 10) { val = 10; }
        if (val > 100) { val = 100; }
        $scope.launcherOpacity = val;
        setCookie('simplified_launcher_opacity', val, PREFERENCE_DAYS);
        // Setting it by hand restarts the week, so a review that was already
        // due does not immediately walk over the value just chosen.
        UsageService.noteOpacitySetManually();
        $scope.opacityReview = UsageService.reviewOpacity(val);
        var icon = document.getElementById('ss_icon');
        if (icon) {
            icon.style.opacity = (val / 100).toString();
        }
    };

    $scope.setLauncherOpacityPreset = function(preset) {
        $scope.launcherOpacity = preset;
        $scope.setLauncherOpacity();
    };

    // ------------------------------------------------------------------
    // Launcher shape and finish
    //
    // Both are applied as classes on the live icon rather than by swapping
    // in different artwork, so they compose with the eight colours and the
    // opacity above instead of multiplying against them.
    // ------------------------------------------------------------------
    $scope.launcherShapes = ['Square', 'Circle', 'Triangle', 'Diamond', 'Hexagon'];
    $scope.launcherFinishes = ['Normal', 'Subtle', 'Shiny'];

    /*
     * Every colour, for the finish previews.
     *
     * A finish is a filter over whatever icon is there, so it reads quite
     * differently on yellow than on dark blue - showing it on one colour
     * only says what it does to that colour. LAUNCHER_COLORS is the same map
     * index.js picks the live icon from, so these are the real files rather
     * than a second list to keep in step.
     */
    $scope.launcherColorSwatches = (function(){
        try{
            return Object.keys(LAUNCHER_COLORS).map(function(name){
                return { name: name, src: LAUNCHER_COLORS[name] };
            });
        }catch(e){
            return [];
        }
    })();

    $scope.launcherShape = ssLauncherShape();
    $scope.launcherFinish = ssLauncherFinish();

    // Each swatch previews its own option against the other one currently
    // chosen, so the pair is visible before it is committed. The class
    // building lives in ss-core, shared with index.js, which applies the same
    // pair to the icon at mount.
    $scope.launcherPreviewClass = function(shape, finish){
        return ssLauncherStyleClasses(shape, finish).join(' ');
    };

    function applyLauncherStyle(){
        ssApplyLauncherStyle($scope.launcherShape, $scope.launcherFinish);
    }

    $scope.setLauncherShape = function(shape){
        $scope.launcherShape = shape;
        setCookie('simplified_launcher_shape', shape, PREFERENCE_DAYS);
        applyLauncherStyle();
    };

    $scope.setLauncherFinish = function(finish){
        $scope.launcherFinish = finish;
        setCookie('simplified_launcher_finish', finish, PREFERENCE_DAYS);
        applyLauncherStyle();
    };

    applyLauncherStyle();
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
        $("div.userdetails > p").removeClass('userdetailsError');
        $scope.ErrorMsg = '';
        return sfdc.query(query, $scope.selectedMetadata.url).then(function(data){
            var records = data.records;
            if(records && records.length){
                for (var i = 0; i < records.length; i++) {
                    $scope.objectEntityIdNameMap.set(records[i].Id, records[i].DeveloperName+'__c');
                }
                // Was inside the loop, rebuilding the whole document once per
                // resolved object name.
                $scope.createpkgXmlString();
            }
        }, function(rejection){
            if (rejection && rejection.cancelled) { return; }
            $scope.ErrorMsg = sfdc.errorMessage(rejection);
        });
    }
    
    // The generated package.xml used to hardcode <version>43.0</version>, so
    // every deployment it fed was pinned to a 2018 API. Resolve the org's
    // newest supported version instead; the value is cached for a week, so
    // this is normally a synchronous-feeling no-op.
    $scope.apiVersion = SS_API_VERSION;
    function withApiVersion(){
        return $q.when(fetchLatestApiVersion()).then(function(version){
            $scope.apiVersion = version || SS_API_VERSION;
            return $scope.apiVersion;
        }, function(){
            return $scope.apiVersion;
        });
    }

    // Returns a promise so callers can wait for $scope.str to be final; the
    // package.xml textarea is bound to it either way.
    /*
     * The textarea is the manifest.
     *
     * Everything generated here is a best guess from what was ticked, and
     * the guesses that go wrong - a type that names its members differently,
     * a component that needs a sibling to deploy - are exactly the ones a
     * person spots and fixes by hand. So an edited manifest is never
     * regenerated over: the selection keeps updating the summary beside it,
     * and Regenerate is there for going back to the generated version
     * deliberately rather than by surprise.
     */
    $scope.packageXmlEdited = false;

    $scope.onPackageXmlEdited = function(){
        $scope.packageXmlEdited = true;
    };

    /*
     * Empty the manifest.
     *
     * There was no way to do this: components came off one tick or one type at
     * a time, so starting again after a wrong selection meant clicking through
     * everything that had been added - including the dependencies the scan put
     * there, which the user never ticked and cannot see individually.
     *
     * packageXmlEdited is cleared too. A hand-edited manifest survives a
     * changed selection on purpose, but "remove all" is not a change of
     * selection - it is asking for nothing, and leaving the edited text behind
     * would empty the ticks while the file still listed components.
     */
    $scope.clearAllFromPackage = function(){
        clearDependencyMembers();
        $scope.selectedMetaForPackageXml.clear();
        $scope.packageMetaTypeAndName.clear();
        packageSourceMenu.clear();
        $scope.packageXmlEdited = false;
        $scope.retrieveState.error = '';
        $scope.packageDepsState = { running: false, scanned: false, added: 0, done: 0, total: 0 };
        // Persists the now-empty selection and rebuilds the manifest.
        return settleDependencyScan();
    };

    $scope.regeneratePackageXml = function(){
        $scope.packageXmlEdited = false;
        $scope.retrieveState.error = '';
        return $scope.createpkgXmlString();
    };

    /* ----------------------------------------------------------------- */
    /* Related components                                                  */
    /*                                                                     */
    /* A manifest that names a permission set without the objects and      */
    /* fields it grants fails the whole deployment on the first one the    */
    /* target org has not got; an object without its fields retrieves as   */
    /* an empty shell. This offers to bring them, and only when asked -    */
    /* see the note on the checkbox in the template.                       */
    /* ----------------------------------------------------------------- */

    $scope.packageIncludeDependencies = false;
    /*
     * Deliberately a second switch, not part of the first.
     *
     * "Related components" asks what belongs to a thing; this asks what a
     * thing points at. Different question, different cost - one is a handful
     * of indexed lookups, the other is a Beta dependency graph - and folding
     * them into one tick would make that tick mean two things nobody could
     * separate when it went wrong.
     */
    $scope.packageIncludeReferences = false;
    $scope.packageDepsState = { running: false, scanned: false, added: 0 };

    // Members resolved from the org, kept apart from the ticked records so
    // that unticking the parent can take them away again without guessing
    // which of the user's own ticks came from where.
    var packageDependencyMembers = new Map();

    function dependencyKey(type, name){ return type + '|' + name; }

    function addDependencyMember(type, name){
        var key = dependencyKey(type, name);
        if(packageDependencyMembers.has(key)){ return false; }
        packageDependencyMembers.set(key, { type: type, name: name });

        if(!$scope.packageMetaTypeAndName.get(type)){
            $scope.packageMetaTypeAndName.set(type, new Map());
        }
        // Keyed by the member string: a dependency has no record id of its
        // own, and two selections asking for the same member must collapse
        // to one entry rather than appear twice in the manifest.
        $scope.packageMetaTypeAndName.get(type).set('dep:' + key, name);
        return true;
    }

    function clearDependencyMembers(){
        packageDependencyMembers.forEach(function(_, key){
            var type = key.split('|')[0];
            var bucket = $scope.packageMetaTypeAndName.get(type);
            if(bucket){
                bucket.delete('dep:' + key);
                if(!bucket.size){ $scope.packageMetaTypeAndName.delete(type); }
            }
        });
        packageDependencyMembers.clear();
    }

    /*
     * Re-resolves from scratch rather than diffing.
     *
     * The selection changes by ticking and unticking, and a dependency can be
     * owed by two selections at once - unpicking that incrementally means
     * tracking who asked for what. Rebuilding is a handful of queries the org
     * answers quickly, and it cannot drift out of step with the ticks.
     */
    /* ----------------------------------------------------------------- */
    /* Managed package components                                          */
    /*                                                                     */
    /* A component installed from a managed package is not the user's to    */
    /* retrieve. The Metadata API does not refuse - it returns a zip with   */
    /* the component missing or stubbed - so this is the failure that looks */
    /* most like success, and the only useful moment to say so is before    */
    /* the retrieve rather than after.                                      */
    /* ----------------------------------------------------------------- */

    $scope.managedSummary = { count: 0, namespaces: [] };

    // Everything the manifest names, ticked or pulled in as a dependency, in
    // the one shape summariseManaged reads.
    function manifestComponents(){
        var items = [];
        $scope.selectedMetaForPackageXml.forEach(function(record){
            items.push({
                name: packageMemberName(record),
                NamespacePrefix: record.NamespacePrefix
            });
        });
        packageDependencyMembers.forEach(function(dep){ items.push(dep); });
        return items;
    }

    // Kept from the last summary so the paths that cannot wait for a promise
    // still know whose namespace is whose.
    var knownOrgNamespace = null;

    function isFromAnotherPackage(item, orgNamespace){
        var ns = PackageDependencyService.namespaceOf(item);
        return !!ns && ns !== orgNamespace;
    }

    function refreshManagedSummary(){
        return PackageDependencyService.summariseManaged(manifestComponents())
            .then(function(summary){
                knownOrgNamespace = summary.orgNamespace;
                $scope.managedSummary = summary;
                return summary;
            }, function(){
                // Not knowing is not the same as knowing there are none, but
                // a warning we cannot substantiate is worse than silence.
                $scope.managedSummary = { count: 0, namespaces: [] };
                return $scope.managedSummary;
            });
    }

    // Read by the template, which cannot call .join on an Angular expression.
    $scope.managedNamespaceList = function(){
        var list = ($scope.managedSummary && $scope.managedSummary.namespaces) || [];
        if(list.length <= 3){ return list.join(', '); }
        return list.slice(0, 3).join(', ') + ' and ' + (list.length - 3) + ' more';
    };

    /* ----------------------------------------------------------------- */
    /* Taking them out again                                               */
    /*                                                                     */
    /* Knowing a manifest cannot be retrieved is only half of it. Removing  */
    /* the parts that will not come back leaves a package.xml that does     */
    /* what it says, which is the whole point of showing the warning.       */
    /*                                                                     */
    /* The exclusion sticks, because a one-off removal would not survive    */
    /* the next tick: a local permission set granting access to a managed   */
    /* package's fields pulls them straight back in on the following scan,  */
    /* and components reappearing after being removed is worse than never   */
    /* having offered to remove them.                                       */
    /*                                                                     */
    /* It applies to what the scan brings in, not to what the user ticks.   */
    /* Someone who deliberately ticks a managed component means it - they   */
    /* may be retrieving from the packaging org, where it works.            */
    /* ----------------------------------------------------------------- */

    $scope.packageExcludeManaged = false;

    function dropEmptyTypes(){
        var empty = [];
        $scope.packageMetaTypeAndName.forEach(function(bucket, type){
            if(!bucket || !bucket.size){ empty.push(type); }
        });
        empty.forEach(function(type){ $scope.packageMetaTypeAndName.delete(type); });
    }

    $scope.removeManagedComponents = function(){
        return PackageDependencyService.orgNamespace().then(function(own){
            knownOrgNamespace = own;
            $scope.packageExcludeManaged = true;

            // Ticked records first: untick them, so the lists agree with the
            // manifest rather than showing components it no longer names.
            var doomed = [];
            $scope.selectedMetaForPackageXml.forEach(function(record, id){
                var candidate = {
                    name: packageMemberName(record),
                    NamespacePrefix: record.NamespacePrefix
                };
                if(isFromAnotherPackage(candidate, own)){ doomed.push(id); }
            });

            // Removing from the map is the whole of it: the row checkboxes
            // read the map, so they clear with it.
            doomed.forEach(removeMetaFromPackage);

            // Then anything the scan brought in.
            var gone = [];
            packageDependencyMembers.forEach(function(dep, key){
                if(isFromAnotherPackage(dep, own)){ gone.push(key); }
            });
            gone.forEach(function(key){
                var bucket = $scope.packageMetaTypeAndName.get(key.split('|')[0]);
                if(bucket){ bucket.delete('dep:' + key); }
                packageDependencyMembers.delete(key);
            });

            dropEmptyTypes();
            return settleDependencyScan();
        });
    };

    $scope.includeManagedComponents = function(){
        $scope.packageExcludeManaged = false;
        // Only a rescan can bring back what the scan found; the ticks the user
        // removed were theirs to remove and are not restored behind their back.
        return $scope.packageIncludeDependencies
            ? $scope.rescanPackageDependencies()
            : settleDependencyScan();
    };

    /*
     * The checkbox, as opposed to a selection change.
     *
     * Turning it on is the one moment the user is explicitly asking the org,
     * so it is also the moment to drop remembered answers - that makes
     * off-and-on-again a way to pick up metadata added since, without
     * reloading the page.
     */
    /*
     * Three actions rather than two standing preferences.
     *
     * The flags survive the click because the manifest has to stay consistent
     * afterwards: unticking a component whose fields were pulled in should
     * take those fields with it, and that only happens if a later selection
     * change rescans. So the button decides *whether* this kind of component
     * is included, and the existing debounced rescan keeps it true.
     *
     * The cache is dropped on each press: pressing the button is the gesture
     * that means "ask the org", so it should reach the org rather than repeat
     * an answer from earlier in the session.
     */
    function runAdder(kind){
        PackageDependencyService.clearCache();
        $scope.packageDepsState.kind = kind;
        return $scope.rescanPackageDependencies();
    }

    $scope.addRelatedComponents = function(){
        $scope.packageIncludeDependencies = true;
        return runAdder('related');
    };

    $scope.addReferencedComponents = function(){
        $scope.packageIncludeReferences = true;
        return runAdder('referenced');
    };

    $scope.removeAddedComponents = function(){
        $scope.packageIncludeDependencies = false;
        $scope.packageIncludeReferences = false;
        // Rescanning with both off is what clears them: the scan drops
        // everything it previously added before deciding what to add now.
        return $scope.rescanPackageDependencies();
    };

    /*
     * Ticking rows fires one of these per row. Coalescing them means a user
     * working down a list pays for one scan when they stop, not one per tick,
     * and "select all" does not queue a scan behind every row it sets.
     */
    var pendingScan = null;
    function queuePackageDependencyScan(){
        if(pendingScan){ $timeout.cancel(pendingScan); }
        pendingScan = $timeout(function(){
            pendingScan = null;
            $scope.rescanPackageDependencies();
        }, 250);
    }

    /*
     * Everything a finished scan has to bring up to date.
     *
     * The manifest text is the part that is easy to forget: a selection
     * change rebuilds it on the way out of SelectMetadataForManagedPackage,
     * but the scan settles a quarter of a second later and used to refresh
     * only the summary beside it - so the components had been added, the
     * count said so, and the textarea still showed the manifest from before.
     *
     * createpkgXmlString respects a hand-edited manifest on its own: it
     * refreshes the summary and leaves the user's text alone, which is the
     * same bargain every other selection change makes.
     */
    function settleDependencyScan(){
        refreshManagedSummary();
        return $scope.createpkgXmlString();
    }

    $scope.rescanPackageDependencies = function(){
        clearDependencyMembers();
        $scope.packageDepsState = { running: false, scanned: false, added: 0, done: 0, total: 0 };

        if(!$scope.packageIncludeDependencies && !$scope.packageIncludeReferences){
            settleDependencyScan();
            return $q.when(0);
        }

        var selections = [];
        var referenceIds = [];
        $scope.selectedMetaForPackageXml.forEach(function(record, id){
            /*
             * Every selected component can be asked what it references; only
             * some have parts that belong to them.
             *
             * The map key rather than record.Id: the map is keyed by id by
             * construction, so the key is always there even when the record
             * behind it came from a list that did not carry one.
             */
            if(id){ referenceIds.push(id); }

            var type = packageMetadataType(record);
            if(!PackageDependencyService.hasDependencies(type)){ return; }

            /*
             * packageMemberName already worked out the API name - it is the
             * one being written into the manifest, __c suffix and namespace
             * included. Handing the service a record whose Name is the raw
             * "Invoice" would have it ask the org about an object that is
             * actually called Invoice__c, and get nothing back.
             */
            var asked = Object.create(record);
            asked.QualifiedApiName = packageMemberName(record);
            selections.push({ type: type, record: asked });
        });

        var wantReferences = $scope.packageIncludeReferences && referenceIds.length;
        if(!selections.length && !wantReferences){
            $scope.packageDepsState = { running: false, scanned: true, added: 0, done: 0, total: 0 };
            settleDependencyScan();
            return $q.when(0);
        }

        $scope.packageDepsState = {
            running: true, scanned: false, added: 0, done: 0, total: selections.length
        };

        // The scan is bounded and can take a while, so it reports how far it
        // has got rather than spinning silently - see resolveAll.
        var owned = $scope.packageIncludeDependencies
            ? PackageDependencyService.resolveAll(selections, function(done, total){
                  $scope.$applyAsync(function(){
                      $scope.packageDepsState.done = done;
                      $scope.packageDepsState.total = total;
                  });
              })
            : $q.when([]);

        // What the selection points at, asked once for the whole selection
        // rather than per component - one query per 200 ids.
        var referenced = wantReferences
            ? PackageDependencyService.forReferences(referenceIds)
            : $q.when([]);

        return $q.all([owned, referenced]).then(function(both){
            return [].concat(both[0] || [], both[1] || []);
        }).then(function(members){
            /*
             * The namespace is resolved before anything is added, not read
             * from the last summary: on a first scan there may not have been
             * one yet, and treating the org's own namespace as foreign would
             * drop exactly the components a packaging org came here for.
             */
            return PackageDependencyService.orgNamespace().then(function(own){
                knownOrgNamespace = own;
                return { members: members, orgNamespace: own };
            });
        }).then(function(result){
            var members = result.members;
            var added = 0;
            (members || []).forEach(function(dep){
                if($scope.packageExcludeManaged &&
                   isFromAnotherPackage(dep, result.orgNamespace)){ return; }
                if(addDependencyMember(dep.type, dep.name)){ added++; }
            });
            $scope.packageDepsState = {
                running: false, scanned: true, added: added,
                done: selections.length, total: selections.length
            };
            settleDependencyScan();
            return added;
        }, function(){
            // Nothing in the service rejects, but a manifest that quietly
            // lost its dependencies would be worse than one that says so.
            $scope.packageDepsState = {
                running: false, scanned: true, added: 0,
                done: 0, total: selections.length
            };
            settleDependencyScan();
            return 0;
        });
    };

    /*
     * The rebuild itself, without counting it as a use.
     *
     * Some rebuilds are the user doing something - ticking a component,
     * pressing Refresh - and some are the panel keeping itself honest, like
     * restoring a selection when the page loads. Only the first kind is
     * somebody using package.xml, and counting the second turned every panel
     * load into a manifest build in Usage Analytics.
     */
    function rebuildPackageXml(){
        // Every path that changes the selection ends here, so this is the one
        // place that reliably sees the final state - including the ones that
        // bypass settleMetaSelection, like removing a whole type.
        persistPackageSelection();
        return withApiVersion().then(function(apiVersion){
            if($scope.packageXmlEdited){
                // Their version stands; only the summary follows the ticks.
                buildPackageFrequency();
                return $scope.str;
            }
            return buildPkgXmlString(apiVersion);
        });
    }

    $scope.createpkgXmlString = function(){
        UsageService.record('packageXml');
        return rebuildPackageXml();
    }

    /*
     * What the retrieve and the download actually send.
     *
     * Not createpkgXmlString: that regenerates, which on an edited manifest
     * threw the edit away and then retrieved the generated version instead -
     * the one case where the user had said in as many words what they wanted.
     * An untouched manifest is still rebuilt first, so it carries the
     * resolved API version.
     */
    function currentPackageXml(){
        return $scope.packageXmlEdited ? $q.when($scope.str) : $scope.createpkgXmlString();
    }

    // The selection summary, which reflects what is ticked regardless of what
    // the manifest text says - the two can legitimately differ once the user
    // has edited it by hand.
    function buildPackageFrequency(){
    	$scope.packageMetaDataFrequency = [];

    	for (let [k, v] of $scope.packageMetaTypeAndName) {
    		if(v.size > 0){
    			var data = {};
          		data.Type =  k;
          		data.Frequency =  v.size;
          		$scope.packageMetaDataFrequency.push(data);
    		}	
    	}

        /*
         * What is ticked, against what the manifest can actually name.
         *
         * The selection lives in two maps: one of ticked ids, and one of
         * type -> members which is what the manifest is written from. A
         * component in the first with no place in the second is ticked,
         * counted in the sidebar, and absent from the package - which is how
         * "2 components, 1 type" came to sit above a manifest holding one.
         *
         * Counted here because this runs on every rebuild, and held rather
         * than computed in a binding: it walks the maps, and a binding walks
         * them on every digest.
         */
        var placed = 0;
        $scope.packageMetaTypeAndName.forEach(function(members){ placed += members.size; });
        $scope.packageInManifest = placed;
        $scope.packageOrphans = Math.max(0,
            ($scope.selectedMetaForPackageXml ? $scope.selectedMetaForPackageXml.size : 0) - placed);
    }

    /*
     * A member name is text, and text goes through an escape.
     *
     * API names are alphanumeric, but the names hanging off an object are not:
     * a layout may legally be called "Sales & Service <Primary>", and written
     * raw that produces a document the retrieve cannot parse. It re-reads this
     * very string with DOMParser, so the failure surfaced as "this is not
     * valid XML ... check for a stray character in the editor below" - the
     * extension generating a broken manifest and then blaming the user for it.
     */
    function escapeXmlText(value){
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /*
     * The id an entity is stored under, swapped for the name it deploys as.
     *
     * Object-scoped members arrive as owner + separator + name, where the
     * owner half can still be the 01I id the list reported. Only the owner
     * half is looked up, and only when the whole thing splits cleanly in two -
     * a layout called "Sales-EMEA" would otherwise be taken apart at the
     * wrong hyphen.
     */
    function resolveMemberName(member){
        var separators = ['.', '-'];
        for(var i = 0; i < separators.length; i++){
            var parts = member.split(separators[i]);
            if(parts.length !== 2){ continue; }
            var owner = $scope.objectEntityIdNameMap.get(parts[0]);
            if(owner){ return owner + separators[i] + parts[1]; }
        }
        return member;
    }

    /*
     * What the manifest does not contain, said in the manifest.
     *
     * Everything the panel knows about the limits of a selection was stated
     * on the screen where it was true - the list header says "200 of 3,512",
     * the sidebar warns about managed components - and none of it survived
     * into the file. A package.xml built from the first two hundred of three
     * thousand classes looks complete in a text editor, in a pull request,
     * and in whatever it is deployed with a week later.
     *
     * An XML comment travels with the artifact and is ignored by every tool
     * that reads it, so it costs nothing but is there when someone asks why
     * a component is missing.
     */
    function manifestProvenance(){
        var lines = [];

        var loaded = $scope.totalSize_AllMetaDataRecords;
        var orgTotal = $scope.orgTotalRecords;
        if(typeof orgTotal === 'number' && typeof loaded === 'number' && orgTotal > loaded){
            lines.push('Selected from the ' + loaded + ' ' +
                       (($scope.selectedMetadata && $scope.selectedMetadata.label) || 'records') +
                       ' on screen; the org has ' + orgTotal + '.');
        }

        var managed = $scope.managedSummary || {};
        if(managed.count){
            var spaces = (managed.namespaces || []).join(', ');
            var one = managed.count === 1;
            lines.push(managed.count + ' managed-package component' + (one ? '' : 's') +
                       (spaces ? ' (' + spaces + ')' : '') +
                       (one ? ' cannot be retrieved and is not included.'
                            : ' cannot be retrieved and are not included.'));
        }

        return lines;
    }

    function buildPkgXmlString(apiVersion){
    	buildPackageFrequency();

    	$scope.str = '<?xml version="1.0" encoding="UTF-8"?>\n';
    	// Between the declaration and the root, where a comment is legal and
    	// every parser skips it.
    	manifestProvenance().forEach(function(line){
    		$scope.str += '<!-- ' + line.replace(/--+/g, '-') + ' -->\n';
    	});
    	$scope.str +='<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';

    	for (let [outkey, outvalue] of $scope.packageMetaTypeAndName) {
    		if(!outvalue.size){ continue; }

    		/*
    		 * Deduplicated, because the same component can reach the manifest
    		 * twice - ticked by hand and again as something else's dependency,
    		 * held under different keys. Sorted so that a manifest committed
    		 * to a repository does not rewrite itself into a noisy diff every
    		 * time the selection is rebuilt in a different order.
    		 */
    		var members = [];
    		var seen = Object.create(null);
    		for (let [innerKey, innerValue] of outvalue) {
    			var resolved = resolveMemberName(innerValue);
    			if(!resolved || seen[resolved]){ continue; }
    			seen[resolved] = true;
    			members.push(resolved);
    		}
    		if(!members.length){ continue; }
    		members.sort();

    		$scope.str += '\t<types>\n';
    		for (var m = 0; m < members.length; m++) {
    			$scope.str += '\t\t<members>'+escapeXmlText(members[m])+'</members>\n';
    		}
    		$scope.str += '\t\t<name>'+escapeXmlText(outkey)+'</name>\n';
    		$scope.str += '\t</types>\n';
    	}

    	// One release behind the org - see ssPackageApiVersion. The retrieve
    	// reads this file, so it uses the same version the user is shown.
    	$scope.str +='\t<version>'+ssPackageApiVersion(apiVersion)+'</version>\n';
    	$scope.str +='</Package>\n';
    	return $scope.str;
    }
    $scope.downloadPackageXml = function(){
        if(typeof ssCountUse === 'function'){ ssCountUse('manifests', 1); }
    	// Whatever is in the box, which for an untouched manifest means a
    	// rebuild first so the file carries the resolved API version.
    	currentPackageXml().then(function(xml){
    		$scope.downloadDoc('Package.xml', xml);
    	});
    }

    /* ----------------------------------------------------------------- */
    /* Retrieve the deployable package                                     */
    /*                                                                     */
    /* package.xml on its own is a shopping list; this fetches what it     */
    /* asks for. The org builds the zip, so the folder layout and the      */
    /* -meta.xml files are Salesforce's own rather than this extension's   */
    /* guess at them, and what lands deploys as it is.                     */
    /* ----------------------------------------------------------------- */

    $scope.retrieveState = { running: false, stage: '', error: '', result: null };

    // The button is only worth offering once the manifest actually asks for
    // something - "ready" is components selected, not a file that parses.
    /*
     * How much of the package one type accounts for, as a percentage of the
     * largest type rather than of the total - so the biggest bar is always
     * full and the rest are read against it. Against the total, a package of
     * thirty types would render thirty slivers that all look the same.
     */
    /*
     * Drop a whole type out of the manifest.
     *
     * Ticking is per component but regretting is usually per type: "not the
     * layouts", "not the list views" - most often after a related-components
     * scan has brought in eighty of something nobody asked for. Doing that by
     * hand means unticking eighty rows across two lists.
     *
     * Everything of that type goes, whether it was ticked by hand or added by
     * a scan. They are held under one bucket precisely because they are the
     * same thing in the manifest.
     */
    $scope.removeTypeFromPackage = function(type){
        var bucket = $scope.packageMetaTypeAndName.get(type);
        if(!bucket){ return $q.when(null); }

        // Copied before iterating: removeMetaFromPackage deletes from this
        // very map, and mutating a Map while walking it skips entries.
        var keys = [];
        bucket.forEach(function(_, key){ keys.push(key); });

        keys.forEach(function(key){
            removeMetaFromPackage(key);
            // Scan-added members live under a dep: key and are remembered
            // separately, or a later rescan would put them straight back.
            packageDependencyMembers.delete(String(key).replace(/^dep:/, ''));
        });

        $scope.packageMetaTypeAndName.delete(type);
        dropEmptyTypes();
        return settleDependencyScan();
    };

    $scope.packageTypeShare = function(entry){
        if(!entry || !entry.Frequency){ return 0; }
        var largest = 0;
        ($scope.packageMetaDataFrequency || []).forEach(function(row){
            if(row && row.Frequency > largest){ largest = row.Frequency; }
        });
        if(!largest){ return 0; }
        // A floor, so a count of one is still a visible mark rather than a
        // bar that rounds away to nothing beside a type with four hundred.
        return Math.max(4, Math.round((entry.Frequency / largest) * 100));
    };

    /*
     * The same proportion bar as the manifest breakdown, over the watch list.
     *
     * Kept separate from packageTypeShare rather than generalised: the two read
     * different collections with different field names (Frequency against
     * count), and a shared version would take both plus a key and be longer
     * than either. What is shared is the rule - scale against the largest, with
     * a floor so a count of one is still a mark rather than a bar that rounds
     * away beside a type with four hundred.
     */
    $scope.watchTypeShare = function(entry){
        if(!entry || !entry.count){ return 0; }
        var largest = 0;
        ($scope.watchedTypes || []).forEach(function(row){
            if(row && row.count > largest){ largest = row.count; }
        });
        if(!largest){ return 0; }
        return Math.max(4, Math.round((entry.count / largest) * 100));
    };

    // How many watched components the org no longer has. A fact worth a tile:
    // it is the one number here that means something needs doing.
    $scope.watchGoneCount = function(){
        return ($scope.bookmarks || []).filter(function(item){
            return item && item.missingSince;
        }).length;
    };

    /*
     * Rebuild the manifest from what is ticked, now.
     *
     * Everything that changes the selection rebuilds already, so this is for
     * when they have gone out of step anyway - a restore that only half
     * happened, a tick that did not reach the type map. It is cheap, it is
     * always available, and it is the one action on this page that cannot
     * make things worse.
     *
     * A hand-edited manifest is asked about first, because rebuilding
     * replaces it and that is the user's work.
     */
    $scope.packageRefreshAsking = false;

    $scope.refreshPackageXml = function(){
        if($scope.packageXmlEdited && !$scope.packageRefreshAsking){
            $scope.packageRefreshAsking = true;
            return;
        }
        $scope.packageRefreshAsking = false;
        $scope.packageXmlEdited = false;
        return $scope.createpkgXmlString();
    };

    $scope.cancelPackageRefresh = function(){
        $scope.packageRefreshAsking = false;
    };

    /*
     * Drop the ticks the manifest cannot place.
     *
     * They cannot be retrieved - the manifest is what the org is asked for,
     * and they are not in it - so a selection that keeps counting them is
     * counting something that will not happen.
     */
    $scope.dropUnplacedComponents = function(){
        var placed = new Map();
        $scope.packageMetaTypeAndName.forEach(function(members){
            members.forEach(function(name, key){ placed.set(key, true); });
        });

        var dropped = 0;
        Array.from($scope.selectedMetaForPackageXml.keys()).forEach(function(key){
            if(!placed.has(key)){
                $scope.selectedMetaForPackageXml.delete(key);
                dropped += 1;
            }
        });
        if(dropped){ $scope.refreshPackageXml(); }
    };

    $scope.packageIsReady = function(){
        return !!($scope.packageMetaDataFrequency && $scope.packageMetaDataFrequency.length);
    };

    $scope.retrievePackage = function(){
        if($scope.retrieveState.running){ return; }

        $scope.retrieveState = { running: true, stage: 'Preparing', error: '', result: null };

        currentPackageXml().then(function(xml){
            return MetadataApiService.retrieve(xml, function(stage){
                $scope.$applyAsync(function(){
                    $scope.retrieveState.stage = stage;
                });
            });
        }).then(function(result){
            $scope.retrieveState.running = false;
            $scope.retrieveState.stage = '';
            $scope.retrieveState.result = result;
            $scope.downloadBlob(result.filename, result.blob);
            UsageService.record('packageXml');
        }, function(error){
            $scope.retrieveState.running = false;
            $scope.retrieveState.stage = '';
            $scope.retrieveState.error = (error && error.message) ||
                'The package could not be retrieved.';
        });
    };

    /*
     * Binary sibling of downloadDoc.
     *
     * downloadDoc builds a data: URL, which cannot carry a zip of any size -
     * the URL length limit truncates it and the browser saves a corrupt file.
     * An object URL hands the blob over by reference instead.
     */
    $scope.downloadBlob = function(filename, blob){
        var url = URL.createObjectURL(blob);
        var element = document.createElement('a');
        element.setAttribute('href', url);
        element.setAttribute('download', filename);
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
        // Released on the next tick: revoking synchronously can beat the
        // browser to starting the download.
        $timeout(function(){ URL.revokeObjectURL(url); }, 60000);
    };
	
    $scope.downloadDoc = function(filename, text, mimeType) {
    	  mimeType = mimeType || 'text/plain;charset=utf-8';
    	  var element = document.createElement('a');
    	  element.setAttribute('href', 'data:' + mimeType + ',' + encodeURIComponent(text));
    	  element.setAttribute('download', filename);

    	  element.style.display = 'none';
    	  document.body.appendChild(element);

    	  element.click();

    	  document.body.removeChild(element);
    	}

    $scope.dataSelectionNotice = '';

    $scope.toggleDataSelection = function(id, selected) {
    	if (!id) {
    		return;
    	}
    var value = selected === true || selected === undefined ? true : false;
    	var currentRecord = null;
    	var allSources = [($scope.records || []), ($scope.AllMetaDataRecords || [])];
    	for (var i = 0; i < allSources.length; i++) {
    		for (var j = 0; j < allSources[i].length; j++) {
    			if (allSources[i][j] && allSources[i][j].Id === id) {
    				currentRecord = allSources[i][j];
    				break;
    			}
    		}
    		if (currentRecord) {
    			break;
    		}
    	}
    	if (!currentRecord) {
    		return;
    	}
    if (value) {
    		/*
    		 * Refused at the tick rather than dropped later.
    		 *
    		 * The export asks the org for every field with FIELDS(ALL), which
    		 * Salesforce caps at 200 rows - so a 201st tick would either be
    		 * missing from the file or cost another round trip per record.
    		 * Saying no here is the only version of this the user can see.
    		 */
    		if (!$scope.selectedDataForDownload.has(id) &&
    		    $scope.selectedDataForDownload.size >= MAX_DATA_SELECTION) {
    			/* A toast, for the same reason the export warning is one: the
    			 * card this used to appear on no longer exists, and a refusal
    			 * nobody sees looks like a checkbox that stopped working. */
    			$scope.showToast({
    				variant: 'warning',
    				icon: '!',
    				title: 'That is as many as one export can hold',
    				lines: ['Up to ' + MAX_DATA_SELECTION + ' records at a time - that is ' +
    				        'the limit on a query that returns every field.'],
    				actionable: false
    			});
    			return;
    		}
    		$scope.selectedDataForDownload.set(id, currentRecord);
    	} else {
    		$scope.selectedDataForDownload.delete(id);
    	}

    	persistDataSelection();
    }

    /* ----------------------------------------------------------------- */
    /* The record selection, kept across a refresh                        */
    /*                                                                    */
    /* Same treatment package.xml's selection gets, and for the same      */
    /* reason: ticking a hundred rows and losing them to a reload is the  */
    /* kind of loss that makes people stop using a basket at all.         */
    /* ----------------------------------------------------------------- */

    /* Set while a bulk change is in progress; see selectAllForDataDownload. */
    var suspendDataPersist = false;

    function dataSelectionKey(){
        var org = null;
        try{ org = ssOrgKey(new URL(SS_ORIGIN).hostname); }catch(e){}
        return 'ss_data_selection_' + (org || SS_ORIGIN);
    }

    /*
     * Two strings per record, not the record.
     *
     * A queried row carries every field the list asked for, and two hundred
     * of those is a quota failure rather than a saved selection. Everything
     * that reads this map wants the Id and the object name - the download
     * re-queries by Id for the fields, and the summary counts by type - so
     * that is what is kept.
     */
    function persistDataSelection(){
        if(suspendDataPersist){ return; }
        try{
            var rows = [];
            $scope.selectedDataForDownload.forEach(function(record, id){
                rows.push({
                    i: id,
                    t: (record && record.attributes && record.attributes.type) || null
                });
            });
            if(!rows.length){
                window.localStorage.removeItem(dataSelectionKey());
                return;
            }
            window.localStorage.setItem(dataSelectionKey(), JSON.stringify(rows));
        }catch(e){
            // Quota or storage disabled. The selection still works this
            // session; it simply will not be there next time.
        }
    }

    function restoreDataSelection(){
        var rows;
        try{
            var raw = window.localStorage.getItem(dataSelectionKey());
            rows = raw ? JSON.parse(raw) : null;
        }catch(e){ return; }
        if(!Array.isArray(rows) || !rows.length){ return; }

        rows.forEach(function(row){
            if(!row || !row.i){ return; }
            /*
             * A stub, not the original row. Only the Id and the object name
             * are read back - the same shape restorePackageSelection puts
             * back for components - so re-querying every object to rebuild
             * rows nobody looks at would be a lot of work for nothing.
             */
            $scope.selectedDataForDownload.set(row.i, {
                Id: row.i,
                attributes: { type: row.t || null },
                _ssRestored: true
            });
        });
    }

    /*
     * Whether a row is selected, asked of the map rather than of the row.
     *
     * dataSelected used to live on the record object, which made two ordinary
     * situations look like Select all: a list where several rows carry the
     * same Id, and a record that appears in both "mine" and "all" as one
     * shared object. In either case setting the flag ticked every row that
     * shared it. Reading from the map instead means a tick belongs to a
     * record id and to nothing else, and the checkbox and the count can no
     * longer disagree.
     */
    $scope.isDataSelected = function(record){
        return !!(record && record.Id && $scope.selectedDataForDownload.has(record.Id));
    };

    /* ----------------------------------------------------------------- */
    /* Exporting the selected records                                      */
    /*                                                                     */
    /* The rows on screen carry only the handful of columns the list query  */
    /* asked for - an id, a name, a namespace, a last-modified-by. Exporting*/
    /* those was exporting the grid, not the records, and a JSON file that  */
    /* looks like data but has four fields in it is worse than none.        */
    /*                                                                     */
    /* So the export re-asks the org for everything, with FIELDS(ALL). That */
    /* is why the selection is capped: Salesforce requires an explicit LIMIT*/
    /* of at most 200 on a FIELDS(ALL) query, so 200 is not a number chosen */
    /* for tidiness - it is the shape of the query that makes the export    */
    /* complete.                                                            */
    /* ----------------------------------------------------------------- */

    var MAX_DATA_SELECTION = 200;
    $scope.maxDataSelection = MAX_DATA_SELECTION;

    $scope.dataSelectionFull = function(){
        return $scope.selectedDataForDownload.size >= MAX_DATA_SELECTION;
    };

    /*
     * What is in the selection, when it is not all one object.
     *
     * A selection is kept while moving between objects, so the count on the
     * card can be larger than the number of ticked rows in view - the rest
     * belong to objects that are no longer on screen. Naming them is the
     * difference between that reading as a bug and reading as the basket it is.
     */
    $scope.dataSelectionSummary = function(){
        var counts = new Map();
        $scope.selectedDataForDownload.forEach(function(record){
            var type = (record && record.attributes && record.attributes.type) || 'Record';
            counts.set(type, (counts.get(type) || 0) + 1);
        });
        if (counts.size < 2) { return ''; }
        var parts = [];
        counts.forEach(function(count, type){ parts.push(count + ' ' + type); });
        return parts.sort().join(', ');
    };

    /*
     * Sent raw rather than through sfdc.query.
     *
     * smartQuery rewrites what it is given - it appends its own LIMIT and
     * drops fields an org has rejected before - and FIELDS(ALL) survives
     * neither. sfdc.get sends exactly what it is handed.
     */
    function fetchAllFields(sobjectType, ids){
        var list = ids.map(function(id){
            return "'" + escapeSoqlLiteral(id) + "'";
        }).join(',');

        var soql = 'SELECT FIELDS(ALL) FROM ' + sobjectType +
                   ' WHERE Id IN (' + list + ') LIMIT ' + MAX_DATA_SELECTION;

        return $q.when(sfdc.get(ssQueryUrl() + encodeURIComponent(soql)))
            .then(function(data){
                return (data && data.records) ? data.records : [];
            }, function(){
                /*
                 * FIELDS(ALL) needs API 51 and read access to every field on
                 * the object; an org can refuse it for either. Falling back to
                 * the rows already on screen means a thinner file rather than
                 * no file, and the panel says which happened.
                 */
                return null;
            });
    }

    $scope.downloadState = { running: false, message: '' };

    $scope.downloadSelectedDataAsJson = function(){
        var selected = Array.from($scope.selectedDataForDownload.values());
        if (!selected.length) { return $q.when(null); }

        // Grouped by object, because FIELDS(ALL) names one.
        var byType = Object.create(null);
        selected.forEach(function(record){
            var type = (record && record.attributes && record.attributes.type) ||
                       ($scope.selectedMetadata && $scope.selectedMetadata.value) || '';
            if(!type || !record.Id){ return; }
            (byType[type] = byType[type] || []).push(record.Id);
        });

        var types = Object.keys(byType);
        if(!types.length){
            // Nothing identifiable to re-query - export what is on screen.
            return $q.when(writeExport(selected, false));
        }

        $scope.downloadState = { running: true, message: 'Fetching all fields...' };

        return $q.all(types.map(function(type){
            return fetchAllFields(type, byType[type]);
        })).then(function(results){
            var full = [];
            var complete = true;
            results.forEach(function(records, i){
                if(records === null){
                    complete = false;
                    // Keep this object's on-screen rows rather than losing it.
                    var wanted = byType[types[i]];
                    selected.forEach(function(record){
                        if(wanted.indexOf(record.Id) !== -1){ full.push(record); }
                    });
                    return;
                }
                full = full.concat(records);
            });

            /*
             * Said as a toast, because the card that used to carry it is
             * gone - and a partial export that says nothing is one somebody
             * opens later believing it holds every field.
             */
            $scope.downloadState = { running: false, message: '' };
            if(!complete){
                $scope.showToast({
                    variant: 'warning',
                    icon: '!',
                    title: 'Exported with some fields missing',
                    lines: ['Some fields could not be read, so part of this export has ' +
                            'only the columns shown.'],
                    actionable: false
                });
            }
            return writeExport(full.length ? full : selected, complete);
        }, function(){
            $scope.downloadState = { running: false, message: '' };
            return writeExport(selected, false);
        });
    };

    /*
     * Named after what is in the file, not after the screen it was started
     * from. A selection survives moving between objects, so an export can hold
     * Contacts and Accounts together - and naming that Account.json, because
     * Account happened to be open, misnames the file for every object but one.
     */
    function exportBaseName(records){
        var types = [];
        (records || []).forEach(function(record){
            var type = record && record.attributes && record.attributes.type;
            if (type && types.indexOf(type) === -1) { types.push(type); }
        });
        if (!types.length) {
            return ($scope.selectedMetadata && $scope.selectedMetadata.label) || 'data';
        }
        types.sort();
        // Beyond a few, the joined name is longer than it is useful.
        if (types.length > 3) { return 'salesforce-data-' + types.length + '-objects'; }
        return types.join('-');
    }

    function writeExport(records, complete){
        var base = exportBaseName(records);
        var json = ssBuildJsonDownloadPayload(records);
        $scope.downloadDoc(base + '.json', json, 'application/json;charset=utf-8');
        return { count: records.length, complete: complete };
    }


    // Kept as the name the old sidebar button used. It now means what the
    // header control means - the rows on screen, not every row loaded.
    $scope.selectAllVisibleData = function(){
    	$scope.selectAllForDataDownload('all');
    	$scope.selectAllForDataDownload('my');
    }

    /*
     * What the card used to say, in the one place the count now lives.
     *
     * The summary matters when the basket spans objects - the rows for the
     * others are not on screen to be counted - and the limit matters before
     * somebody discovers it by hitting it.
     */
    $scope.dataExportTitle = function(){
        var lines = [$scope.selectedDataForDownload.size +
            ' record' + ($scope.selectedDataForDownload.size === 1 ? '' : 's') +
            ' selected - download them as JSON'];
        var spread = $scope.dataSelectionSummary();
        if(spread){ lines.push(spread); }
        lines.push('Exports every field, not just the columns shown. Up to ' +
            MAX_DATA_SELECTION + ' records at a time, across all objects.');
        return lines.join('\n');
    };

    $scope.clearSelectedData = function(){
    	// The map is the whole of the selection now, so emptying it is all
    	// there is to do - the checkboxes read from it.
    	$scope.selectedDataForDownload.clear();
    	// And the stored copy with it, or the next reload brings back a
    	// selection the user has just cleared.
    	persistDataSelection();
    }

    $scope.VerifyPackage = function(){
    	if($scope.entityIdMap && $scope.entityIdMap.size > 0){
    		$scope.getObjectNameForPackageXml();
    	}
        openMetadata(MetaDataContainer.byValue('PackageXml'), { unameFallback: 'Your' });
        $scope.createpkgXmlString();
    }

    /*
     * Where a record link points.
     *
     * Read again after ssAuthReady on the standalone page - see the block
     * further down. On an org page SS_ORIGIN is correct the moment this file
     * runs, but simplified.html chooses its org asynchronously, and this
     * controller is constructed at bootstrap, before that choice is made. So
     * on the page this captured chrome-extension://<id>, and every record
     * link pointed back at the extension instead of the org.
     */
    $scope.baseUrl = SS_ORIGIN;

    /*
     * Object-level actions - New, Setup, Developer Console - resolved against
     * the org.
     *
     * They are declared as bare paths, which on an org page resolve correctly
     * against the page's own origin. simplified.html is not an org page: it is
     * served from chrome-extension://, so the same path produced a URL inside
     * the extension that does not exist, and the links went nowhere.
     *
     * Prefixing here rather than where the actions are declared means it
     * happens at render time, once the org has actually been chosen -
     * MetaDataContainer is built at bootstrap, before that is known, so an
     * action that baked in an origin then would bake in the wrong one.
     */
    // The notice is about the object being looked at, so it clears itself on
    // the next query anyway - this is for getting it off screen now.
    $scope.dismissQueryNotice = function(){
        $scope.ErrorMsg = '';
    };

    /*
     * Opened through the worker, not window.open.
     *
     * A content script's window is the page's window, so navigating it to a
     * chrome-extension:// URL is a web page reaching an extension resource -
     * which the browser blocks, leaving a blank tab. The worker has no such
     * restriction and already does this for the standalone page.
     */
    $scope.openWelcomePage = function(event){
        if(event && event.preventDefault){ event.preventDefault(); }
        try {
            chrome.runtime.sendMessage({ type: 'SS_OPEN_WELCOME_PAGE' }, function(){
                void chrome.runtime.lastError;
            });
        } catch(e) { /* nothing else to fall back to */ }
    };

    $scope.orgActionUrl = function(url){
        var path = String(url || '');
        if (!path) { return ''; }
        // Already absolute: the external links - Feedback, Blog, Report Issue -
        // and any action already built with ssOrgUrl.
        if (/^[a-z][a-z0-9+.-]*:/i.test(path)) { return path; }
        return ($scope.baseUrl || '') + path;
    };


    /*
     * Whether a panel gets the right-hand rail - Viewing as, Features,
     * Namespaces, Navigate by Users.
     *
     * The rail describes a list of records: who you are viewing as, which
     * namespaces are in play, who last touched them. So the question is not
     * "is this a setting", which is what this used to ask, but "does this
     * panel list records at all".
     *
     * technologyFeature cannot answer it. It marks View As, Recently viewed
     * and Debug logs as 'Settings' alongside Trust Status and About Us - yet
     * the first three are record lists and the last two are pages about the
     * extension. All five lost the rail; the first three needed it.
     * isSearchable separates them exactly: a panel you can search is a panel
     * with rows in it.
     */
    $scope.hasRightSidebar = function(item){
        if(!item){ return false; }
        /*
         * And not at all without a session.
         *
         * Every card in the rail is an answer about the org: who you are
         * viewing as, which namespaces are present, who last touched these
         * records. Signed out there are no answers - it rendered "Viewing as
         * / Please change user" next to a Features box that filters nothing,
         * beside a notice explaining that nothing can be read. Dropping it
         * gives that notice the full width of the page, which is the only
         * thing on screen with anything to say.
         */
        if(!$scope.hasSession){ return false; }
        return !!item.isSearchable || item.technologyFeature !== 'Settings';
    };

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
    /* ----------------------------------------------------------------- */
    /* Naming a component for package.xml                                  */
    /*                                                                     */
    /* Metadata that lives under an object has to be named for the object  */
    /* that owns it - Account.Rating__c, Account.Rule_Name, and Layout's   */
    /* odd Account-Account Layout. A bare member name is a component the   */
    /* Metadata API cannot find, so the retrieve silently comes back       */
    /* without it.                                                         */
    /*                                                                     */
    /* Driven by the type rather than by an if-chain that knew about       */
    /* Layout and nothing else: validation rules, buttons, record types    */
    /* and the rest all need the same treatment, and adding one should be  */
    /* an entry here rather than another branch.                           */
    /* ----------------------------------------------------------------- */

    var OBJECT_SCOPED_SEPARATOR = {
        // Layout is the exception the platform itself makes.
        'Layout':          '-',
        'CustomField':     '.',
        'ValidationRule':  '.',
        'WebLink':         '.',
        'RecordType':      '.',
        'ListView':        '.',
        'FieldSet':        '.',
        'CompactLayout':   '.',
        'BusinessProcess': '.',
        'SharingReason':   '.',
        'Index':           '.'
    };

    /*
     * Which object a component belongs to.
     *
     * EntityDefinition.QualifiedApiName is the object's API name already -
     * "Account", "Invoice__c" - so it needs no resolving and no guessing at
     * a __c suffix. The queries for fields, layouts, validation rules and
     * buttons all select it; it was simply never read, which is why those
     * members went out unprefixed.
     *
     * TableEnumOrId is the fallback and is either a standard object name or
     * an 01I id. The id form is left as-is on purpose: buildPkgXmlString
     * substitutes it later, once the id-to-name query has answered.
     */
    function owningObject(record){
        var entity = record.EntityDefinition && record.EntityDefinition.QualifiedApiName;
        if(entity){ return entity; }
        if(record.SobjectType){ return record.SobjectType; }
        if(record.TableEnumOrId){
            $scope.entityIdMap.set(record.TableEnumOrId, record.TableEnumOrId);
            return record.TableEnumOrId;
        }
        return null;
    }

    /*
     * The metadata type a record belongs to, which is not always the object
     * it was queried from.
     *
     * WebLink is the awkward one: the same object holds buttons and links
     * that sit on an sObject - retrieved as WebLink, named Account.Foo - and
     * the custom links that sit on the home page, which are a different
     * metadata type altogether (CustomPageWebLink) and carry no object at
     * all. Filed as WebLink with a bare name, a home page link is a
     * component the Metadata API cannot find, so it is quietly left out of
     * the package - the same silent failure as a missing object prefix,
     * arriving from the other direction.
     */
    function isHomePageLink(record){
        if(record.PageOrSobjectType){
            return record.PageOrSobjectType === 'HomePage';
        }
        // Older query shape, or an org that would not return the column: no
        // owning object is the next best evidence that it is not on one.
        return !(record.EntityDefinition && record.EntityDefinition.QualifiedApiName);
    }

    function packageMetadataType(record){
        if (!record) return '';
        var type = (record.attributes && record.attributes.type) || record.Type || '';
        if(!type && $scope.selectedMetadata){
            type = $scope.selectedMetadata.metadata || $scope.selectedMetadata.value || '';
        }
        if(type === 'ExternalString'){ return 'CustomLabel'; }
        if(type === 'WebLink' && isHomePageLink(record)){ return 'CustomPageWebLink'; }

        /*
         * EntityDefinition is how the org reports an object, not how one
         * deploys. There is no EntityDefinition metadata type, so a manifest
         * naming it fails outright - which is what "cannot create the xml"
         * was: the Custom Metadata list queries EntityDefinition, so every
         * ticked row produced <name>EntityDefinition</name>.
         *
         * A custom metadata *type* deploys as a CustomObject whose member ends
         * __mdt, exactly as a custom object deploys as one ending __c.
         */
        if(type === 'EntityDefinition'){ return 'CustomObject'; }

        return type;
    }

    function packageMemberName(record){
        var type = packageMetadataType(record);

        /*
         * A flow names itself through its definition.
         *
         * The Tooling Flow row is a version: it carries MasterLabel - the
         * human label, with spaces - and no Name or DeveloperName, so the
         * fallback below found nothing and the member came out empty. An empty
         * member is dropped, which is why the manifest showed no flows at all
         * rather than showing wrong ones.
         */
        var definitionName = record.Definition && record.Definition.DeveloperName;

        /*
         * The API name as the org reports it, when it does.
         *
         * QualifiedApiName already carries the suffix - Invoice__mdt,
         * Widget__c - so it is the member exactly as written, and the __c
         * appended below must not be added to it a second time.
         */
        var qualified = record.QualifiedApiName || '';

        var name = qualified || definitionName || record.Name || record.DeveloperName ||
                   record.ValidationName || '';

        // A name that already carries a prefix is re-prefixed below, so take
        // the member half only.
        name = name.split('.').length > 1 ? name.split('.')[1] : name;

        if(record.NamespacePrefix && record.NamespacePrefix != 'null'){
            name = record.NamespacePrefix + '__' + name;
        }
        /*
         * Only when the name does not already say what it is. A custom
         * metadata type is Invoice__mdt and a custom object queried by
         * QualifiedApiName is already Widget__c; appending again produced
         * Invoice__mdt__c, which resolves to nothing.
         */
        if((type === 'CustomObject' || type === 'CustomField') &&
           !/__(c|mdt|e|b|x)$/i.test(name)){
            name = name + '__c';
        }

        var separator = OBJECT_SCOPED_SEPARATOR[type] ||
                        OBJECT_SCOPED_SEPARATOR[$scope.selectedMetadata && $scope.selectedMetadata.value];
        if(separator){
            var owner = owningObject(record);
            if(owner){
                name = owner + separator + name;
            }
        }
        return name;
    }

    /* ----------------------------------------------------------------- */
    /* What is in the package                                              */
    /*                                                                     */
    /* selectedMetaForPackageXml is the selection; packageMetaTypeAndName   */
    /* is the manifest shape derived from it. Nothing else holds it.        */
    /*                                                                     */
    /* It used to be a `selected` flag on each row, with both lists scanned */
    /* for flagged rows on every click. That breaks in two ordinary cases:  */
    /* a list where several rows carry the same Id, and a record that       */
    /* appears in both "mine" and "all" as one shared object - in either,   */
    /* setting the flag ticked every row that shared it, so one click read  */
    /* as Select all. The same fault was reported in the data export, and   */
    /* it costs more here: a manifest that names components nobody chose is */
    /* a deployment of the wrong things.                                    */
    /* ----------------------------------------------------------------- */

    /*
     * What identifies a row for selection.
     *
     * Id, when there is one - which is almost always. EntityDefinition is the
     * exception that showed the problem: the Custom Metadata list queries it,
     * and it does not carry an ordinary Id. Every row then shared the same
     * absent key, so ticking one reported all of them as ticked.
     *
     * QualifiedApiName is unique per row wherever Id is missing, and is the
     * same string the manifest names, so a row that can be selected is a row
     * that can be packaged.
     */
    function recordKey(record){
        if(!record){ return null; }
        return record.Id || record.QualifiedApiName || record.DeveloperName || null;
    }

    // The template needs the same key the maps are built on.
    $scope.metaKey = recordKey;

    $scope.isMetaSelected = function(record){
        var key = recordKey(record);
        return !!(key && $scope.selectedMetaForPackageXml.has(key));
    };

    /*
     * Which list each component was ticked in.
     *
     * The sidebar badge used to translate a menu name into a manifest type
     * through a hand-written table, which was wrong in both directions: it
     * still named EntityDefinition for Custom Metadata after that started
     * deploying as CustomObject, so the badge showed nothing - and because
     * Objects also maps to CustomObject, the two menus would have counted
     * each other's components.
     *
     * The list a component was ticked in is a fact known at the moment of
     * ticking, so it is recorded then. No table, and nothing to fall out of
     * step when a type mapping changes.
     */
    var packageSourceMenu = new Map();

    function addMetaToPackage(record){
        var key = recordKey(record);
        if(!key){ return; }
        $scope.selectedMetaForPackageXml.set(key, record);

        var from = $scope.selectedMetadata &&
                   ($scope.selectedMetadata.value || $scope.selectedMetadata.metadata);
        if(from){ packageSourceMenu.set(key, from); }

        var type = packageMetadataType(record);
        if(!$scope.packageMetaTypeAndName.get(type)){
            $scope.packageMetaTypeAndName.set(type, new Map());
        }
        $scope.packageMetaTypeAndName.get(type).set(key, packageMemberName(record));
    }

    function removeMetaFromPackage(id){
        if(!id){ return; }
        $scope.selectedMetaForPackageXml.delete(id);
        packageSourceMenu.delete(id);
        $scope.packageMetaTypeAndName.forEach(function(typeMap){
            if(typeMap && typeMap.delete){ typeMap.delete(id); }
        });
    }

    // The record behind an id, from whichever list is holding it.
    function recordById(id){
        var sources = [($scope.records || []), ($scope.AllMetaDataRecords || [])];
        for(var i = 0; i < sources.length; i++){
            for(var j = 0; j < sources[i].length; j++){
                if(sources[i][j] && recordKey(sources[i][j]) === id){ return sources[i][j]; }
            }
        }
        return null;
    }

    // Everything the selection changing has to bring up to date.
    /* ----------------------------------------------------------------- */
    /* The package.xml selection, kept between visits                     */
    /*                                                                    */
    /* Ticking fifty components is minutes of work and it lived in a Map  */
    /* on the scope, so a refresh, a navigation, or closing the panel      */
    /* threw it away with no warning. The watch list already survives -    */
    /* it is in localStorage - and this now does too.                      */
    /*                                                                    */
    /* Keyed by org, so switching org is an empty basket rather than the   */
    /* last org's components offered against a manifest they do not        */
    /* belong to.                                                          */
    /* ----------------------------------------------------------------- */
    function packageSelectionKey(){
        var org = null;
        try{ org = ssOrgKey(new URL(SS_ORIGIN).hostname); }catch(e){}
        return 'ss_package_selection_' + (org || SS_ORIGIN);
    }

    /*
     * Stored flat, not as the records themselves.
     *
     * A record carries everything the query returned - bodies, relationships,
     * the lot - and a few hundred of those is a quota failure rather than a
     * saved selection. Everything the manifest and the ticks actually need is
     * four strings per component.
     */
    function persistPackageSelection(){
        try{
            var rows = [];
            $scope.packageMetaTypeAndName.forEach(function(members, type){
                members.forEach(function(member, key){
                    rows.push({ k: key, t: type, m: member,
                                s: packageSourceMenu.get(key) || null });
                });
            });
            if(!rows.length){
                window.localStorage.removeItem(packageSelectionKey());
                return;
            }
            window.localStorage.setItem(packageSelectionKey(), JSON.stringify(rows));
        }catch(e){
            // Quota or storage disabled. The selection still works this
            // session; it simply will not be there next time.
        }
    }

    function restorePackageSelection(){
        var rows;
        try{
            var raw = window.localStorage.getItem(packageSelectionKey());
            rows = raw ? JSON.parse(raw) : null;
        }catch(e){ return; }
        if(!Array.isArray(rows) || !rows.length){ return; }

        rows.forEach(function(row){
            if(!row || !row.k || !row.t){ return; }
            /*
             * A stub, not the original record. Only the key is read back -
             * isMetaSelected compares keys, and the manifest is built from the
             * type and member stored beside it - so re-querying every object
             * to rebuild rows nobody looks at would be a lot of work for
             * nothing.
             */
            $scope.selectedMetaForPackageXml.set(row.k, { Id: row.k, _ssRestored: true });
            if(row.s){ packageSourceMenu.set(row.k, row.s); }
            if(!$scope.packageMetaTypeAndName.get(row.t)){
                $scope.packageMetaTypeAndName.set(row.t, new Map());
            }
            $scope.packageMetaTypeAndName.get(row.t).set(row.k, row.m);
        });

        /*
         * Rebuild what the ticks feed, or the page says nothing is selected.
         *
         * The selection lives in two maps and is summarised in a third thing
         * - packageMetaDataFrequency - which packageIsReady() reads and the
         * manifest is built from. Only the ticking path produced it, so after
         * a reload the maps were full, the sidebar badge and the footer chip
         * counted them, and the package.xml page said "Nothing selected yet"
         * over an empty manifest.
         *
         * The summary is rebuilt first and synchronously: it is what the page
         * reads, and it needs nothing from the org. The manifest text follows
         * because it has to wait for the resolved API version.
         *
         * Safe to rebuild here because packageXmlEdited is not persisted - a
         * hand-edited manifest cannot be what is on screen immediately after
         * a reload.
         */
        if(!$scope.packageMetaTypeAndName.size){ return; }
        buildPackageFrequency();
        rebuildPackageXml();
    }

    function settleMetaSelection(){
        if($scope.packageIncludeDependencies){
            queuePackageDependencyScan();
        }
        refreshManagedSummary();
        persistPackageSelection();
    }

    $scope.SelectMetadataForManagedPackage = function (id, flag) {
        if(!id){ return; }

        if(flag === false){
            removeMetaFromPackage(id);
        }else{
            addMetaToPackage(recordById(id));
        }

        settleMetaSelection();
    }

    /* ----------------------------------------------------------------- */
    /* Select all, for package.xml                                         */
    /*                                                                     */
    /* Ticking 200 rows one at a time to build a package is the job this   */
    /* extension exists to avoid. Whole list in, whole list out.           */
    /* ----------------------------------------------------------------- */

    /*
     * The rows a header control acts on: this list, after the namespace filter
     * and the search box.
     *
     * Memoised, and that is not premature. This is called from ng-checked on
     * four header controls in two tables, so it runs eight times per digest -
     * and a digest happens on every keystroke in the search box. At 2,000
     * records each call filtered the whole array and scanned every field of
     * every row, measured at 0.27ms, so the eight together cost more than 2ms
     * of every keystroke and allocated eight arrays to be thrown away.
     *
     * The cache is keyed on everything that can change the answer: which list,
     * the search text, and the namespace tick-boxes. Anything else - a
     * selection changing, a panel opening - cannot alter which rows are
     * visible, so recomputing for it was pure waste.
     */
    /* ----------------------------------------------------------------- */
    /* How many rows are actually put in the page                          */
    /*                                                                     */
    /* A query can come back with two thousand rows, and every row carries  */
    /* about a hundred bindings - so the whole list is roughly two hundred  */
    /* thousand watchers, re-evaluated on every digest, and as many DOM     */
    /* nodes for the browser to lay out. Nobody reads two thousand rows;    */
    /* they search.                                                         */
    /*                                                                     */
    /* So the DOM is capped and the data is not: the counts, the tag cloud, */
    /* Select all and the exports all still see every row that came back.   */
    /* Only what is painted is limited, and the table says so with a way to */
    /* show the rest.                                                       */
    /* ----------------------------------------------------------------- */

    var DEFAULT_RENDER_LIMIT = 200;
    $scope.renderLimit = DEFAULT_RENDER_LIMIT;

    $scope.moreRows = function(shown){
        // The filters run before limitTo, so this compares against what the
        // filters left rather than the raw list - otherwise a search matching
        // three rows would still claim rows were hidden.
        var total = (shown && shown.length) || 0;
        return total > $scope.renderLimit;
    };

    $scope.showAllRows = function(event){
        if(event && event.preventDefault){ event.preventDefault(); }
        // No ceiling: the user asked. The cap exists to keep the first paint
        // fast, not to refuse.
        $scope.renderLimit = Number.MAX_SAFE_INTEGER;
    };

    var listCache = Object.create(null);

    function namespaceSignature(){
        var selected = $scope.selectedNamespaces;
        if(!selected){ return ''; }
        var parts = [];
        for(var key in selected){
            if(Object.prototype.hasOwnProperty.call(selected, key) && selected[key]){
                parts.push(key);
            }
        }
        // Sorted, so the same selection made in a different order is the same
        // key rather than a cache miss.
        return parts.sort().join(',');
    }

    function packageListFor(context){
        var rawList = (context === 'all' ? $scope.AllMetaDataRecords : $scope.records) || [];
        var search = ($scope.searchAllMetaData && typeof $scope.searchAllMetaData === 'string')
                   ? $scope.searchAllMetaData.trim().toLowerCase() : '';
        var namespaces = namespaceSignature();

        var cached = listCache[context];
        /*
         * The array identity is part of the key. Records are replaced wholesale
         * on every fetch rather than mutated, so a new array means new data -
         * and reusing a stale result would show the previous object's rows.
         */
        if(cached && cached.source === rawList &&
           cached.search === search && cached.namespaces === namespaces){
            return cached.result;
        }

        var result = rawList.filter(function(record){
            if (!record) return false;
            if ($scope.namespaceFilter && !$scope.namespaceFilter(record)) return false;
            if (search) {
                var matches = false;
                for (var key in record) {
                    if (record.hasOwnProperty(key) && record[key] && typeof record[key] === 'string') {
                        if (record[key].toLowerCase().indexOf(search) !== -1) {
                            matches = true;
                            break;
                        }
                    }
                }
                if (!matches) return false;
            }
            return true;
        });

        listCache[context] = {
            source: rawList, search: search, namespaces: namespaces, result: result
        };
        return result;
    }


    // Drives the header checkbox: on only when there is something to select
    // and every row of that list is in the package.
    /* ----------------------------------------------------------------- */
    /* Selecting data, the way metadata is selected                        */
    /*                                                                     */
    /* Same list, same filters, same header control. Data selection used   */
    /* to differ in two ways that showed: Select all lived in the sidebar  */
    /* card rather than above the rows it acted on, and it took every row  */
    /* loaded rather than the rows the user could actually see - so with a */
    /* search or a namespace filter applied it quietly selected records    */
    /* that were not on screen.                                            */
    /* ----------------------------------------------------------------- */

    $scope.allSelectedForDataDownload = function(context){
        var list = packageListFor(context);
        if(!list.length){ return false; }
        for(var i = 0; i < list.length; i++){
            if(list[i] && !$scope.isDataSelected(list[i])){ return false; }
        }
        return true;
    };

    /*
     * Anything selected in this list, which is what the control turns off.
     *
     * The same fault the watch list had: the toggle asked whether *every*
     * visible row was selected, and on a list longer than the two hundred a
     * download allows, that is never true - so a second press tried to select
     * again, the cap refused it, and there was no way to clear a Select all.
     * It looked like the button had stopped working, and only on the objects
     * with enough rows to pass the cap.
     */
    $scope.anySelectedForDataDownload = function(context){
        var list = packageListFor(context);
        for(var i = 0; i < list.length; i++){
            if(list[i] && $scope.isDataSelected(list[i])){ return true; }
        }
        return false;
    };

    $scope.selectAllForDataDownload = function(context){
        var list = packageListFor(context);
        if(!list.length){ return; }

        /*
         * Anything selected means the click clears. Only "all of them"
         * cannot be reached on a list past the cap, and a control that can
         * be switched on but not off is worse than one that does nothing.
         */
        var select = !$scope.anySelectedForDataDownload(context);

        /*
         * Written to storage once at the end rather than per row. Every tick
         * goes through toggleDataSelection, which saves - and two hundred
         * serialisations of the same growing array for one click is work
         * nobody asked for.
         */
        suspendDataPersist = true;
        try{
            list.forEach(function(record){
                if(!record || !record.Id){ return; }
                // toggleDataSelection enforces the cap; stopping early here spares
                // a long list thousands of calls that would each be refused.
                if(select && $scope.dataSelectionFull() &&
                   !$scope.selectedDataForDownload.has(record.Id)){ return; }
                $scope.toggleDataSelection(record.Id, select);
            });
        } finally {
            suspendDataPersist = false;
        }
        persistDataSelection();
    };

    $scope.allSelectedForPackageXml = function(context){
        var list = packageListFor(context);
        if(!list.length){ return false; }
        for(var i = 0; i < list.length; i++){
            if(list[i] && !$scope.isMetaSelected(list[i])){ return false; }
        }
        return true;
    };

    $scope.selectAllForPackageXml = function(context){
        var list = packageListFor(context);
        if(!list.length){ return; }

        // Toggle: a second click on a full list clears it, which is the only
        // sane behaviour for a checkbox that reports the same state.
        var select = !$scope.allSelectedForPackageXml(context);

        list.forEach(function(record){
            if(!record || !record.Id){ return; }
            if(select){ addMetaToPackage(record); }
            else { removeMetaFromPackage(record.Id); }
        });
        settleMetaSelection();

        // Keep the manifest and the selection summary in step with the list.
        $scope.createpkgXmlString();
    };

    $scope.getPackageXmlSelectedCount = function(menu) {
        if (!menu || !packageSourceMenu.size) { return 0; }
        var value = menu.value || menu.metadata || '';
        if (!value) { return 0; }

        /*
         * Counted from where each component was ticked, not from a mapping of
         * menu names to manifest types. Components a scan added are
         * deliberately not counted: the badge says how many you picked in that
         * list, and attributing eighty scan-added fields to the Fields menu
         * would report a choice nobody made.
         */
        var count = 0;
        packageSourceMenu.forEach(function(from){
            if (from === value) { count++; }
        });
        return count;
    };


    $scope.hasPackageXmlSelected = function(menu) {
        return $scope.getPackageXmlSelectedCount(menu) > 0;
    };



    $scope.changeUser = function(id){
		if(String(id).startsWith('005')){
            __changeUser(id);
            UserId.id = id;
            $timeout(function(){
                var currentUid = readCookie('uid');
                if(String(id) == currentUid){
                    var newUname = readCookie('SFDCSimplified_uname');
                    if (newUname) {
                        $scope.unamewithoutastr = newUname;
                        $scope.uname = newUname;
                    }
                    if ($scope.selectedMenu && $scope.selectedMenu.value) {
                        $scope.detailsPopupOpenByOption($scope.selectedMenu, $scope.selectedlength);
                    }
                    $scope.extendMenu();
                    if (confirm("User changed to " + (newUname || id) + "! Click OK to refresh and apply.")) {
                        window.location.reload();
                    } 
                }else{
                    alert('Unable to change this user, please try again.');
                }
            }, 800);
		}else{
			alert('Invalid User :'+id);
		}
    };

    $scope.searchUser = function(){
        // The ChangeUser entry has no `query`, only `queryForAllWithWhere`,
        // so the old `ChangeUserObject.query + " and name like ..."` could
        // never have produced valid SOQL.
        var ChangeUserObject = MetaDataContainer.byValue('ChangeUser');
        if(!ChangeUserObject || !ChangeUserObject.queryForAllWithWhere){
            return;
        }
        $scope.showloading = true;
        var que = ChangeUserObject.queryForAllWithWhere+" '%25"+escapeSoqlLiteral($scope.searchUserModel)+"%25'";
        try{
            $scope.querySFDC(que, ChangeUserObject.url);
        }catch(error){
            console.log(error);
        }
    }


    $scope.showpayment = function(){
        if($scope.showpaymentflag)
            $scope.showpaymentflag = false;
        else
            $scope.showpaymentflag = true;
    }
	$scope.Developer = false;
	$scope.Vlocity = false;
	$scope.Admin = false;
	/*
	 * My data is the default view - but only once there is a "my" to show.
	 *
	 * On a first login the uid is not known yet (see ssUserReady), so this
	 * used to open on "'s Apex Classes (0)": a heading with no name in it and
	 * an empty table, beside a full org-wide list. Nothing about that says
	 * "we don't know who you are yet" - it says the org is empty.
	 *
	 * Starting on the org-wide list is the honest default for an unknown
	 * user, and it is also the more useful one: everything is in it.
	 */
	$scope.userKnown = !!(readCookie('ss_selected_uid') || readCookie('uid'));
	$scope.showmyview = $scope.userKnown;

	/*
	 * ...and switch to it when the org answers, so the toggle is not left off
	 * for a user who does have records. Guarded on userKnown so this cannot
	 * undo a deliberate flick of the Show/Hide My Data switch: it only ever
	 * runs on the transition from unknown to known, which happens once.
	 */
	if(typeof ssUserReady === 'function'){
		$q.when(ssUserReady()).then(function(id){
			if(!id || $scope.userKnown){ return; }
			$scope.userKnown = true;
			$scope.showmyview = true;
			UserId.id = readCookie('ss_selected_uid') || readCookie('uid');
			var name = readCookie('SFDCSimplified_uname');
			if(name){
				$scope.unamewithoutastr = name;
				$scope.uname = name + "'s";
			}
			// A list opened before the answer arrived has an empty my-half.
			if($scope.selectedMenu && $scope.selectedMenu.value){
				$scope.detailsPopupOpenByOption($scope.selectedMenu, $scope.selectedlength);
			}
		});
	}

	function isVlocityInstalled(){
		return readCookie('isNamespacePrefixAvailable') === 'true';
	}

	$scope.getMetadataByName = function(name) {
		if (!name) return null;
		return MetaDataContainer.byValue(name);
	};

	$scope.getChangeUserObj = function() {
		return MetaDataContainer.byValue('ChangeUser');
	};

	var PRIORITY_RANK = {
		'ChangeUser': 1,
		'RecentlyViewed': 2,
		'DebugLogs': 3,
		'ApexClass': 10,
		'ApexTrigger': 11,
		'AuraDefinitionBundle': 12,
		'LightningComponentBundle': 13,
		'Flow': 14,
		'CustomObject': 15,
		'CustomField': 16,
		'CustomLabel': 17,
		'CustomMetadata': 18,
		'StaticResource': 19,
		'EmailTemplate': 20,
		'WorkflowRule': 20,
		'ValidationRule': 21,
		'PermissionSet': 22,
		'Profile': 23,
		'Account': 30,
		'Contact': 31,
		'Lead': 32,
		'Opportunity': 33,
		'Case': 34,
		'User': 35
	};

	/*
	 * The utility bar, in the order it is used.
	 *
	 * It was in the order the entries happen to sit in systemData, which is the
	 * order they were added over time - so the colour picker sat above the
	 * manifest and the news ticker above the audit trail. Ranked here instead,
	 * because the array is a hundred lines of hand-written literals and moving
	 * them about is a diff nobody can check.
	 *
	 * The shape of the order: what you came to do, then what you came to find
	 * out, then what the extension has to say for itself. Trust, News, the API
	 * monitor and the colour picker are all real, but none of them is why the
	 * panel was opened - and About Us is not about the org at all.
	 *
	 * Both spellings of each value share a rank: the entries are matched by
	 * value and the two casings are the same entry.
	 */
	var BOTTOM_UTILITY_KEYS = {
		// What you came to do.
		'packagexml': 1,
		'PackageXml': 1,
		'watchinglist': 2,
		'WatchingList': 2,
		// Next to package.xml because it is the other end of it: the manifest
		// says what to move, this moves it.
		'syncjobs': 3,
		'SyncJobs': 3,
		'audittrail': 4,
		'AuditTrail': 4,

		// What you came to find out. Event Graph leads it: the others describe
		// one kind of thing each, and this one is about how they fit together,
		// which is the question people arrive with.
		'eventgraph': 5,
		'EventGraph': 5,
		'objectdescribe': 6,
		'ObjectDescribe': 6,
		'restexplorer': 7,
		'RestExplorer': 7,
		'bulkjobs': 8,
		'BulkJobs': 8,
		'integrator': 9,
		'Integrator': 9,
		'usageanalytics': 10,
		'UsageAnalytics': 10,

		// True, and not why anyone opened the panel.
		'apimonitor': 11,
		'ApiMonitor': 11,
		'truststatus': 12,
		'TrustStatus': 12,
		'newstimeline': 13,
		'NewsTimeline': 13,

		// The extension itself.
		'notificationsettings': 14,
		'NotificationSettings': 14,
		'launchercolor': 15,
		'LauncherColor': 15,
		'aboutus': 16,
		'AboutUs': 16
	};

	/*
	 * The icon rail.
	 *
	 * It is a shortcut strip, not a directory, and two things had made it
	 * unusable. It was built from every recently-viewed object, so it grew
	 * without bound; and every object without a dedicated icon falls back to
	 * the same generic cube, so most of the strip was a column of identical
	 * squares carrying no information.
	 *
	 * So it is now a ranked pick of the metadata developers actually reach for,
	 * capped short enough to stay scannable. The rail template has a distinct
	 * ng-switch-when for each of these; anything else would land on the cube.
	 */
	/*
	 * Ranked by what a developer builds with today. Deliberately absent:
	 *
	 *   WorkflowRule, FlowDefinition  - retired; Salesforce moved this to Flow
	 *   ApexPage, ApexComponent       - Visualforce, superseded by LWC
	 *   User, Report, Dashboard       - not metadata; they were only ever here
	 *                                   to pad the rail to its full length
	 *
	 * They are all still reachable from the full metadata list, which stays a
	 * complete directory - an org that still runs workflow rules or Visualforce
	 * needs to find them. This is the shortcut strip, so it carries what is
	 * current. AuraDefinitionBundle stays: superseded by LWC, but far too
	 * common in real orgs to drop.
	 */
	var ICON_RAIL_TYPES = [
		'ApexClass', 'ApexTrigger', 'LightningComponentBundle', 'Flow',
		'CustomObject', 'CustomField', 'CustomMetadata',
		'ApiMonitor', 'UsageAnalytics', 'AuditTrail'
	];
	var ICON_RAIL_LIMIT = 10;

	/*
	 * Retired or superseded types, kept off the rail even when the top-up pass
	 * below is looking for anything to fill it with. Without this an org with
	 * few modern types would quietly get Visualforce and workflow rules back.
	 */
	var ICON_RAIL_EXCLUDED = {
		'WorkflowRule': true, 'WorkflowFieldUpdate': true, 'WorkflowAlert': true,
		'WorkflowTask': true, 'WorkflowOutboundMessage': true,
		'FlowDefinition': true, 'ProcessDefinition': true,
		'ApexPage': true, 'ApexComponent': true, 'Scontrol': true,
		'Letterhead': true, 'MailmergeTemplate': true, 'Document': true
	};

	function buildIconRail(candidates) {
		var rail = [];
		var usedIcons = Object.create(null);

		function tryAdd(item) {
			if (!item || rail.length >= ICON_RAIL_LIMIT) {
				return;
			}
			if (ICON_RAIL_EXCLUDED[item.value]) {
				return;
			}
			// An icon already on the rail disqualifies a later entry, so no
			// symbol repeats whatever a given org contains - the property the
			// old rail lacked. Items with no icon of their own key on their
			// own name, so one of them cannot crowd out all the others.
			var key = item.imagesrc || item.value;
			if (usedIcons[key]) {
				return;
			}
			usedIcons[key] = true;
			rail.push(item);
		}

		for (var i = 0; i < ICON_RAIL_TYPES.length; i++) {
			tryAdd(candidates[ICON_RAIL_TYPES[i]]);
		}

		// Not every org exposes every preferred type - the menu is built from
		// the REST catalogue, which omits the Tooling-only ones - so top the
		// rail up from whatever other deployable metadata this org does have.
		// De-duplication still applies, so the strip stays distinct and simply
		// ends up shorter in an org without enough different icons to fill it.
		if (rail.length < ICON_RAIL_LIMIT) {
			var names = Object.keys(candidates).sort();
			for (var j = 0; j < names.length && rail.length < ICON_RAIL_LIMIT; j++) {
				var candidate = candidates[names[j]];
				if (candidate && candidate.technologyFeature === 'Salesforce') {
					tryAdd(candidate);
				}
			}
		}
		return rail;
	}

	function populateMenus(allList) {
		var iconRailCandidates = Object.create(null);
		var advanceSearchMenu = [];
		var favouriteMenu = [];
		var topList = [];
		var middleList = [];
		var bottomList = [];
		var isVlocity = isVlocityInstalled();
		var seenValues = {}; // deduplicate: first entry wins (MetaDataContainer before dynamic)
		var seenLabels = {};

		/*
		 * Labels are not unique, and the menu shows nothing else.
		 *
		 * An org's describe can hand back the same label for several distinct
		 * objects - a menu of two dozen rows all reading "Entity", each a
		 * different API name, with no way to tell which is which or to know
		 * that clicking one is different from clicking the next.
		 *
		 * So a label used more than once stops being the whole story: those
		 * entries carry their API name as well. Only the colliding ones -
		 * every other row keeps the clean label the org gave it. Counting
		 * first, because the second entry is where a clash becomes visible
		 * and by then the first has already been rendered.
		 */
		var labelCounts = Object.create(null);
		for (var c = 0; c < allList.length; c++) {
			var seenLabel = allList[c] && (allList[c].label || allList[c].value);
			if (!seenLabel) { continue; }
			labelCounts[seenLabel] = (labelCounts[seenLabel] || 0) + 1;
		}

		function menuLabel(entry){
			var text = entry.label || entry.value;
			if (!text || labelCounts[text] <= 1 || text === entry.value) { return text; }
			return text + ' (' + entry.value + ')';
		}

		for (var i = 0; i < allList.length; i++) {
			var item = allList[i];
			if (item.value === 'PackageXml' || item.value === 'packagexml') {
				continue;
			}
			// Skip duplicate menu entries — MetaDataContainer entries come first
			// and take priority over dynamically-discovered specs for the same object.
			if (seenValues[item.value]) {
				continue;
			}
			seenValues[item.value] = true;

			var displayLabel = item.label || item.value;
			if (seenLabels[displayLabel] && (item.value.includes('Member') || item.value.includes('Container'))) {
				continue;
			}
			seenLabels[displayLabel] = true;

			// What the sidebar renders. Left on the item so every list built
			// below - the icon rail, advanced search, favourites - shows the
			// same text for the same thing.
			item.menuLabel = menuLabel(item);

			if (item.isSystemNoise && !$scope.showAllSystemObjects) {
				continue;
			}
			if (item.technologyFeature === 'Vlocity' && !isVlocity) {
				continue;
			}
			// Every item is a candidate, not just recently-viewed ones: the
			// rail is a fixed set of shortcuts that should be present whether
			// or not the user happened to open one lately. ICON_RAIL_TYPES
			// decides what actually makes it on.
			iconRailCandidates[item.value] = item;
			if (item.EligibleForAdvanceSearch) {
				advanceSearchMenu.push(item);
			}
			if (item.formainmenu) {
				favouriteMenu.push(item);
			}
			var feature = item.technologyFeature;
			if (item.visibleForMetadataMenu) {
				if (feature === 'Settings' || feature === 'Standard' || feature === 'Custom'
					|| (feature === 'Salesforce' && $scope.Developer)
					|| (feature === 'Vlocity' && $scope.Vlocity)
					|| (feature === 'Admin' && $scope.Admin)) {
					
					var val = item.value;
					item.orgScore = ($scope.orgUsageScores && ($scope.orgUsageScores[val] || $scope.orgUsageScores[item.metadata])) || 0;
					if (BOTTOM_UTILITY_KEYS[val]) {
						bottomList.push(item);
					} else if (PRIORITY_RANK[val] !== undefined) {
						topList.push(item);
					} else {
						middleList.push(item);
					}
				}
			}
		}

		topList.sort(function(a, b) {
			var rA = PRIORITY_RANK[a.value] || 999;
			var rB = PRIORITY_RANK[b.value] || 999;
			if (rA <= 3 && rB <= 3) {
				return rA - rB;
			}
			if (rA <= 3) return -1;
			if (rB <= 3) return 1;

			var scoreA = a.orgScore || 0;
			var scoreB = b.orgScore || 0;
			if (scoreA !== scoreB) {
				return scoreB - scoreA;
			}
			return rA - rB;
		});

		middleList.sort(function(a, b) {
			var scoreA = a.orgScore || 0;
			var scoreB = b.orgScore || 0;
			if (scoreA !== scoreB) {
				return scoreB - scoreA;
			}
			return (a.label || a.value).localeCompare(b.label || b.value);
		});

		$scope.MenuWithIcon = buildIconRail(iconRailCandidates);
		$scope.AdvanceSearchMenu = advanceSearchMenu;
		$scope.favouriteMenu = favouriteMenu;

		/*
		 * The sidebar shows these as two blocks: the metadata entries scroll,
		 * the system utilities stay pinned to the foot of the bar. They used
		 * to be one list, so the utilities sat below however many metadata
		 * entries the org happened to have and were reached only by scrolling
		 * to the very bottom.
		 *
		 * allMenu stays the whole thing, in the same order: the icon rail
		 * repeats over it.
		 */
		/*
		 * Sorted by rank rather than left in the order the entries were
		 * declared. A stable tie-break on the existing position keeps any
		 * entry that has no rank - one added and not ranked - where it was
		 * instead of jumping to the front.
		 */
		bottomList.forEach(function(item, index){ item._barIndex = index; });
		bottomList.sort(function(a, b){
			var rankA = BOTTOM_UTILITY_KEYS[a.value] || 99;
			var rankB = BOTTOM_UTILITY_KEYS[b.value] || 99;
			return rankA - rankB || a._barIndex - b._barIndex;
		});

		$scope.metadataMenu = topList.concat(middleList);
		$scope.systemMenu = bottomList;
		$scope.allMenu = $scope.metadataMenu.concat(bottomList);
	}

	$scope.extendMenu = function(){
		/*
		 * System objects are data objects, so the switch for them belongs with
		 * Data and is hidden without it. Hiding a ticked box would leave it
		 * filtering the menu with nothing on screen saying so - and it would
		 * come back ticked the next time Data was turned on, from a decision
		 * the user could no longer remember making.
		 */
		if(!$scope.Admin){ $scope.showAllSystemObjects = false; }

		$scope.setSimplifiedCookie('Simplified_Developer', !!$scope.Developer);
		$scope.setSimplifiedCookie('Simplified_Vlocity', !!$scope.Vlocity);
		$scope.setSimplifiedCookie('Simplified_Admin', !!$scope.Admin);
		$scope.setSimplifiedCookie('Simplified_ShowAllSystemObjects', !!$scope.showAllSystemObjects);
		if ($scope.allMetadataList) {
			populateMenus($scope.allMetadataList);
		}
	}

    $scope.showSystemAccordion = false;
    $scope.toggleSystemAccordion = function() {
        $scope.showSystemAccordion = !$scope.showSystemAccordion;
    };

    var DEFAULT_SIDEBAR_WIDTH = 240;
    var savedWidth = parseInt(readCookie('simplified_sidebar_width'), 10);
    $scope.sidebarWidth = (!isNaN(savedWidth) && savedWidth >= 160 && savedWidth <= 450) ? savedWidth : DEFAULT_SIDEBAR_WIDTH;

    $scope.adjustSidebarWidth = function(delta) {
        var current = $scope.sidebarWidth || DEFAULT_SIDEBAR_WIDTH;
        var newWidth = Math.max(160, Math.min(450, current + delta));
        $scope.sidebarWidth = newWidth;
        $scope.setSimplifiedCookie('simplified_sidebar_width', newWidth);
    };

    $scope.resetSidebarWidth = function() {
        $scope.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
        $scope.setSimplifiedCookie('simplified_sidebar_width', DEFAULT_SIDEBAR_WIDTH);
    };

    $scope.startSidebarResize = function(e) {
        if (!e) return;
        e.preventDefault();
        var startX = e.clientX;
        var startWidth = $scope.sidebarWidth || DEFAULT_SIDEBAR_WIDTH;

        function onMouseMove(moveEvent) {
            var diff = moveEvent.clientX - startX;
            var newWidth = Math.max(160, Math.min(450, startWidth + diff));
            $scope.$apply(function() {
                $scope.sidebarWidth = newWidth;
                $scope.setSimplifiedCookie('simplified_sidebar_width', newWidth);
            });
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    var DEFAULT_RIGHT_SIDEBAR_WIDTH = 260;
    var savedRightWidth = parseInt(readCookie('simplified_right_sidebar_width'), 10);
    $scope.rightSidebarWidth = (!isNaN(savedRightWidth) && savedRightWidth >= 180 && savedRightWidth <= 500) ? savedRightWidth : DEFAULT_RIGHT_SIDEBAR_WIDTH;

    $scope.adjustRightSidebarWidth = function(delta) {
        var current = $scope.rightSidebarWidth || DEFAULT_RIGHT_SIDEBAR_WIDTH;
        var newWidth = Math.max(180, Math.min(500, current + delta));
        $scope.rightSidebarWidth = newWidth;
        $scope.setSimplifiedCookie('simplified_right_sidebar_width', newWidth);
    };

    $scope.resetRightSidebarWidth = function() {
        $scope.rightSidebarWidth = DEFAULT_RIGHT_SIDEBAR_WIDTH;
        $scope.setSimplifiedCookie('simplified_right_sidebar_width', DEFAULT_RIGHT_SIDEBAR_WIDTH);
    };

    $scope.startRightSidebarResize = function(e) {
        if (!e) return;
        e.preventDefault();
        var startX = e.clientX;
        var startWidth = $scope.rightSidebarWidth || DEFAULT_RIGHT_SIDEBAR_WIDTH;

        function onMouseMove(moveEvent) {
            var diff = startX - moveEvent.clientX;
            var newWidth = Math.max(180, Math.min(500, startWidth + diff));
            $scope.$apply(function() {
                $scope.rightSidebarWidth = newWidth;
                $scope.setSimplifiedCookie('simplified_right_sidebar_width', newWidth);
            });
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    /* ----------------------------------------------------------------- */
    /* The shrinking header                                                */
    /*                                                                     */
    /* Shrinking hides the title and action rows, so the header loses real  */
    /* height - and that height comes out of the very scroll that caused    */
    /* the shrink. On a page with only a little more content than fits, the */
    /* sequence was: scroll past the threshold, header shrinks, the content */
    /* no longer overflows, the browser clamps scrollTop back to zero, the  */
    /* header expands, the content overflows again. Several times a second, */
    /* which is the flicker.                                               */
    /*                                                                     */
    /* Two things are needed, and neither is enough alone. Hysteresis stops */
    /* a single pixel either side of one threshold flipping the state; and  */
    /* refusing to shrink at all unless the overflow can survive it stops   */
    /* the loop that hysteresis cannot, because there the shrink removes    */
    /* the scroll entirely.                                                */
    /* ----------------------------------------------------------------- */

    var SHRINK_AT = 15;
    // Lower than SHRINK_AT on purpose: the gap between them is the hysteresis.
    var EXPAND_BELOW = 5;
    // Until the header has been seen in both states, assume a shrink worth
    // about this much. Deliberately generous - refusing to shrink costs a
    // little space, and flickering costs the page.
    var ASSUMED_SHRINK = 90;

    /*
     * Long enough for the 200ms max-height transition in the stylesheet to
     * finish, with a frame or two spare. A height read before then is a true
     * reading of an element still moving, and it understates the shrink.
     */
    var SHRINK_SETTLE_MS = 260;

    var expandedHeight = 0;
    var shrunkHeight = 0;
    /* When the header last entered the shrunk state, so a reading can be held
     * back until the animation that follows has had time to finish. */
    var shrunkSince = 0;

    $scope.isMainScrolled = false;

    function headerElement(pane){
        try {
            return (pane && pane.querySelector)
                ? pane.querySelector('.ss-sticky-header-container')
                : document.querySelector('.ss-sticky-header-container');
        } catch (e) { return null; }
    }

    /*
     * Whether the header is shrunk *now*, read off the element.
     *
     * Not $scope.isMainScrolled, which answers a different question twice
     * over. The class is applied when isMainScrolled AND the list is
     * searchable, so on a non-searchable page the flag is true while the
     * header is at full height; and it is set through $applyAsync, so even
     * on a searchable one the class lands a digest after the flag does.
     * Either way a full-height measurement gets filed as the shrunk height,
     * and the learned delta collapses.
     */
    function headerIsShrunk(header){
        try {
            return !!(header && header.classList &&
                      header.classList.contains('is-scrolled'));
        } catch (e) { return false; }
    }

    /*
     * How much height the header gives up, learned from the header itself
     * rather than kept as a number here that the stylesheet can silently
     * contradict.
     *
     * Both extremes, not the latest reading. The shrink is a 200ms
     * transition on max-height, and scroll events arrive throughout it - so
     * most samples are mid-animation and land between the two real heights.
     * Taken as-is they make the learned delta far too small, which is the
     * one direction that matters: the caller shrinks only when the overflow
     * exceeds the delta, so an understated delta lets it shrink when there
     * is not enough scroll to survive it. That is the oscillation the guard
     * exists to prevent, produced by the guard's own measurement.
     *
     * Keeping the largest expanded and the smallest shrunk height makes the
     * estimate err upward, and erring upward means refusing to shrink - a
     * little wasted space, which the comment above already prefers to a
     * flickering page.
     */
    function shrinkDelta(pane){
        /*
         * A header that cannot shrink gives up nothing, so there is no loop
         * to guard against - and measuring it would file a full-height
         * reading under whichever slot the state happened to name.
         */
        if (!($scope.selectedMetadata && $scope.selectedMetadata.isSearchable)) {
            return 0;
        }

        var header = headerElement(pane);
        if (header) {
            var height = header.offsetHeight;
            if (height) {
                if (headerIsShrunk(header)) {
                    /*
                     * Wait for the transition before believing this.
                     *
                     * Math.min alone converges on the right answer but only
                     * after the animation ends, and the readings before that
                     * are the ones that matter: the first sample after the
                     * class lands is a nearly-full-height header, giving a
                     * delta of a few pixels at exactly the moment the guard
                     * is being asked whether shrinking is safe. The whole
                     * flicker fits inside those 200ms.
                     */
                    if (!shrunkSince) { shrunkSince = Date.now(); }
                    if (Date.now() - shrunkSince >= SHRINK_SETTLE_MS) {
                        /*
                         * The latest settled reading, not the smallest ever
                         * seen. Keeping the minimum was tried and dropped: it
                         * cannot be told apart from this by any sequence the
                         * transition actually produces, and where it does
                         * differ it is wrong - a shrunk header that grows,
                         * because the search box wrapped on a narrow window,
                         * would go on being measured at its old height.
                         */
                        shrunkHeight = height;
                    }
                } else {
                    /*
                     * Expanding is a transition too, but understating the
                     * expanded height errs the same way understating the
                     * shrink does - so the largest reading wins and no clock
                     * is needed.
                     */
                    shrunkSince = 0;
                    expandedHeight = Math.max(expandedHeight, height);
                }
            }
        }
        /*
         * Both states, or neither. With the shrunk height still unseen this
         * subtracted zero and returned the whole header as the delta, so the
         * assumption below never applied however long it stayed unmeasured -
         * a number that happens to be safe, arrived at by accident, and
         * quietly larger than the shrink it stands for.
         */
        var learned = (expandedHeight && shrunkHeight)
            ? expandedHeight - shrunkHeight : 0;
        return (learned > 0) ? learned : ASSUMED_SHRINK;
    }

    $scope.handleMainScroll = function(e) {
        var pane = e && e.target ? e.target : null;
        var scrollTop = pane ? pane.scrollTop : (e && e.scrollTop) || 0;

        var overflow = pane ? (pane.scrollHeight - pane.clientHeight) : 0;
        var delta = shrinkDelta(pane);

        var scrolled;
        if ($scope.isMainScrolled) {
            // Stay shrunk until genuinely back at the top.
            scrolled = scrollTop >= EXPAND_BELOW;
        } else {
            /*
             * Only shrink when what is left to scroll is more than the shrink
             * would remove. Otherwise the shrink undoes its own trigger, and
             * the header oscillates rather than settling.
             */
            scrolled = scrollTop > SHRINK_AT && overflow > (delta + 8);
        }

        if ($scope.isMainScrolled !== scrolled) {
            $scope.$applyAsync(function() {
                $scope.isMainScrolled = scrolled;
            });
        }
    };

    $scope.callModel = function(){
        if (typeof closeTimer !== 'undefined' && closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
        refreshSessionState();
        ssOpenMenu();
        UsageService.record('menuOpen');
        // NewsService caches for ten minutes, so this is a no-op on reopen.
        startNewsTicker();
        $scope.showloading = true;
        $scope.showErrorMessage = false;
        $scope.showAllData = false;
        $scope.isDataAvailable = true;

		$scope.isVlocityAvailable = isVlocityInstalled();

		$scope.Developer = readCookie('Simplified_Developer') !== "false";
		$scope.Admin = readCookie('Simplified_Admin') === "true";
		$scope.Vlocity = readCookie('Simplified_Vlocity') === "true";
		/*
		 * Written by extendMenu since it was added and never read back, so the
		 * box came up unticked every session however it had been left. Restored
		 * here with the rest, and only meaningful when Data is on - which is
		 * also the only time it is on screen.
		 */
		$scope.showAllSystemObjects = $scope.Admin &&
			readCookie('Simplified_ShowAllSystemObjects') === "true";

		// Render initial system items synchronously so side menu expands instantly.
		// The icon rail (MenuWithIcon) is intentionally NOT built here — it will be
		// populated once below when the dynamic metadata arrives, preventing the
		// visual "4 icons → 10 icons" jump on first hover.
		var systemItems = MetaDataContainer.systemData || [];
		populateMenus(systemItems);
		// Snapshot the icon rail that came from system-only items; we will
		// replace it once we have the full catalogue.
		var systemOnlyRail = $scope.MenuWithIcon || [];

		// Load dynamic metadata items asynchronously & apply weekly org usage intelligence
		DynamicMetadataService.getDynamicMetadataList().then(function(dynamicList) {
			var combined = systemItems.concat(dynamicList || []);
			$scope.allMetadataList = combined;
			/*
			 * populateMenus runs on three paths here - usage scores arrived,
			 * they did not, or they were never asked for - and the standalone
			 * page has to land on something after every one of them. Funnelled
			 * so a fourth path cannot be added that quietly skips it.
			 */
			function finishMenus() {
				populateMenus(combined);
				if ($scope._pendingFavourite) {
					$scope._pendingFavourite = false;
					openInitialMetadata();
				}
			}

			if (UsageService && typeof UsageService.getWeeklyOrgMenuUsage === 'function') {
				UsageService.getWeeklyOrgMenuUsage().then(function(usageData) {
					if (usageData && usageData.scores) {
						$scope.orgUsageScores = usageData.scores;
					}
					finishMenus();
				}, finishMenus);
			} else {
				finishMenus();
			}
		});

		// If the dynamic list was cached the promise resolved synchronously and
		// MenuWithIcon is already the full rail. Otherwise, keep the system rail
		// visible until it arrives (no blank gap).
		if (!$scope.MenuWithIcon || !$scope.MenuWithIcon.length) {
			$scope.MenuWithIcon = systemOnlyRail;
		}
    }

    /*
     * Width and the decoration class move together. Setting the width alone
     * leaves a zero-width pane still painting its shadow down the page, so
     * every open and close goes through here rather than touching css()
     * directly.
     */
    function setDetailPaneOpen(open){
        var pane = $("#fullDataSidenav");
        if(!pane.length){
            return;
        }
        pane.css({"width": open ? "70%" : "0"});
        pane.toggleClass('ss-pane-open', !!open);
    }

    /* ----------------------------------------------------------------- */
    /* Usage analytics                                                     */
    /*                                                                     */
    /* Counters are local to this browser. They are read when the panel is  */
    /* opened rather than watched, since nothing else on screen depends on  */
    /* them and they only change as a side effect of the user's own clicks. */
    /* ----------------------------------------------------------------- */

    $scope.usage = { features: [], totalActions: 0, activeDays: 0, dailyAverage: 0, timeSaved: '0 seconds' };
    $scope.streak = { current: 0, longest: 0, activeToday: false, milestone: 0, next: 3, toNext: 3, strip: [] };
    $scope.apiUsage = null;
    $scope.orgUsage = {};

    /*
     * The tiles, in one place.
     *
     * Built from a table rather than written out in the template so that the
     * wording, the order and the zero-handling are one thing to change - and
     * so a counter that has never been incremented does not need a special
     * case in the markup.
     */
    $scope.featureUse = {};

    /*
     * Built once, when the counts arrive - not on every digest.
     *
     * This was a function bound straight into ng-repeat, and it returned a
     * fresh array of fresh objects each call. ngRepeat watches its collection
     * with $watchCollection, which compares the elements by identity: new
     * objects every digest means the collection is always "changed", the
     * digest never settles, and Angular gives up after ten passes with
     * $rootScope:infdig.
     *
     * track by does not help. It decides which DOM node belongs to which item;
     * the watcher has already fired by then.
     */
    $scope.featureUseList = [];
    $scope.featureUseAny = false;

    function buildFeatureUse(counts){
        $scope.featureUse = counts || {};
        $scope.featureUseList = featureUseTiles().filter(function(tile){
            // Only the ones with a number in them: eleven tiles of zero says
            // less than four tiles of something.
            return tile.value > 0;
        });
        $scope.featureUseAny = $scope.featureUseList.length > 0;
    }

    function featureUseTiles(){
        var counts = $scope.featureUse || {};
        return [
            { key: 'orgs',              label: 'Orgs used' },
            { key: 'allFieldsOpened',   label: 'All Fields opened' },
            { key: 'recordsEdited',     label: 'Records edited' },
            { key: 'fieldsEdited',      label: 'Fields changed' },
            { key: 'exports',           label: 'Exports run' },
            { key: 'recordsExported',   label: 'Records exported' },
            { key: 'manifests',         label: 'Manifests built' },
            { key: 'componentsWatched', label: 'Components watched' },
            { key: 'objectsDescribed',  label: 'Objects described' },
            { key: 'restCalls',         label: 'REST calls' },
            { key: 'bulkJobsChecked',   label: 'Bulk jobs checked' },

            /*
             * Moving things between orgs.
             *
             * Both halves are counted: what was asked for, and what actually
             * landed. A page showing only "12 jobs applied" cannot tell a
             * dozen deploys of one class from a dozen of a hundred, and the
             * second number is the one that says how much work this did.
             */
            { key: 'syncStaged',        label: 'Metadata jobs staged' },
            { key: 'syncDataStaged',    label: 'Record jobs staged' },
            { key: 'syncApplied',       label: 'Jobs applied' },
            { key: 'syncRetried',       label: 'Jobs retried' },
            { key: 'syncQuickDeployed', label: 'Quick deploys' },
            { key: 'componentsDeployed', label: 'Components deployed' },
            { key: 'recordsWritten',    label: 'Records written to another org' }
        ].map(function(tile){
            return { key: tile.key, label: tile.label, value: Number(counts[tile.key]) || 0 };
        });
    };

    // Exposed for the test that checks the wording and the zero handling; the
    // template binds to the array above, never to this.
    $scope.featureUseTiles = featureUseTiles;

    function refreshUsage(){
        // Local counters are synchronous; the org figures are not, and each
        // arrives independently so a slow one never holds up the rest.
        $scope.usage = UsageService.getUsage();
        $scope.streak = UsageService.getStreak();
        UsageService.getApiUsage().then(function(api){
            $scope.apiUsage = api;
        });
        UsageService.getOrgUsage().then(function(org){
            $scope.orgUsage = org || {};
        });
        // Same discipline as the two above: each section fills in when its
        // answer arrives, and a refusal leaves that section empty rather than
        // holding up the page.
        UsageService.getPlatformLimits().then(function(limits){
            $scope.platformLimits = limits || [];
        });
        /*
         * What this extension has been used for, as opposed to what the org
         * has. Local, and the only figures on this page that are not the
         * org's own.
         */
        if(typeof ssUsageCounts === 'function'){
            $q.when(ssUsageCounts()).then(function(counts){
                buildFeatureUse(counts);
            });
        }

        UsageService.getLicenseUsage().then(function(licenses){
            $scope.licenseUsage = licenses || [];
        });
    }

    $scope.platformLimits = [];
    $scope.licenseUsage = [];

    /*
     * Where a bar turns from information into a warning. Chosen so the two
     * that matter - an org at 94% of its data storage, a licence pool with
     * three seats left - look different from the dozen sitting at zero.
     */
    $scope.usageSeverity = function(percent){
        if(percent >= 90){ return 'is-critical'; }
        if(percent >= 75){ return 'is-warning'; }
        return '';
    };

    $scope.timelineItems = [];
    $scope.retentionOptions = [
        { value: 7, label: '1 Week (Default)' },
        { value: 30, label: '1 Month' }
    ];
    $scope.newsRetentionDays = NewsService.getRetention();

    $scope.loadNewsTimeline = function() {
        NewsService.pruneTimeline();
        $scope.newsRetentionDays = NewsService.getRetention();
        $scope.timelineItems = NewsService.getTimeline();
    };

    $scope.clearTimelineNews = function() {
        NewsService.clearTimeline();
        $scope.timelineItems = [];
    };

    $scope.updateNewsRetention = function(days) {
        NewsService.setRetention(days);
        $scope.newsRetentionDays = NewsService.getRetention();
        $scope.timelineItems = NewsService.getTimeline();
    };

    /* ----------------------------------------------------------------- */
    /* Footer news ticker                                                  */
    /*                                                                     */
    /* One headline at a time, replaced every 10 seconds. Headlines come    */
    /* from NewsService, which decides what this user is allowed to find    */
    /* interesting; this end only rotates them and handles the click.       */
    /* ----------------------------------------------------------------- */

    var NEWS_INTERVAL_MS = 10000;
    var newsIndex = 0;
    var newsTimer = null;

    $scope.newsHeadlines = [];
    $scope.currentNews = null;
    $scope.newsAnimating = false;

    /*
     * The next headline that actually has something to say, wrapping around.
     * A headline whose query failed contributes nothing rather than a blank
     * slot, so the ticker steps over it instead of showing an empty bar for
     * ten seconds. Returns -1 when none of them are usable.
     */
    function nextUsableNews(from){
        var total = $scope.newsHeadlines.length;
        for(var step = 1; step <= total; step++){
            var candidate = (from + step) % total;
            var item = $scope.newsHeadlines[candidate];
            if(item && item.text){
                return candidate;
            }
        }
        return -1;
    }

    /* ----------------------------------------------------------------- */
    /* How much of the ticker the bar can actually hold                     */
    /*                                                                     */
    /* Each headline is short by construction - "3 Apex classes changed in  */
    /* the last 7 days" - so on a wide panel one of them left most of the   */
    /* footer empty. The bar now carries as many as fit, which on a         */
    /* full-screen window is several and on a narrow popup is still one.    */
    /*                                                                     */
    /* Measured with the canvas text metrics rather than estimated from a   */
    /* character count: the footer font is proportional, so "3 flows        */
    /* changed" and "18 Lightning web components changed" differ by far     */
    /* more than their length suggests.                                     */
    /* ----------------------------------------------------------------- */

    var NEWS_SEPARATOR = '  ·  ';
    var newsMeasureContext = null;

    function measureNewsText(text){
        if(!newsMeasureContext){
            try {
                newsMeasureContext = document.createElement('canvas').getContext('2d');
                // Matches .ss-news-item: 12px, weight 500, the panel's stack.
                newsMeasureContext.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            } catch(e) {
                newsMeasureContext = null;
            }
        }
        if(!newsMeasureContext){
            // No canvas: fall back to a conservative average character width,
            // which errs towards showing fewer rather than clipping one.
            return String(text || '').length * 7;
        }
        return newsMeasureContext.measureText(String(text || '')).width;
    }

    function newsBarWidth(){
        try {
            var bar = document.querySelector('.modalfooter .ss-news');
            if(bar && bar.clientWidth){ return bar.clientWidth; }
        } catch(e) {}
        return 0;
    }

    /*
     * The headlines that fit, starting at the one currently up.
     *
     * Always at least one: a bar too narrow for even a single headline shows
     * it clipped with an ellipsis, which is what it did before and is better
     * than showing nothing.
     */
    function buildVisibleNews(startIndex){
        var usable = [];
        var total = $scope.newsHeadlines.length;
        for(var step = 0; step < total; step++){
            var item = $scope.newsHeadlines[(startIndex + step) % total];
            if(item && item.text && usable.indexOf(item) === -1){ usable.push(item); }
        }
        if(!usable.length){ return []; }

        var available = newsBarWidth();
        if(!available){ return [usable[0]]; }

        var shown = [usable[0]];
        var used = measureNewsText(usable[0].text);
        var separator = measureNewsText(NEWS_SEPARATOR);

        for(var i = 1; i < usable.length; i++){
            var next = used + separator + measureNewsText(usable[i].text);
            // A margin, so the last headline is not left flush against the
            // location chip with no air between them.
            if(next > available - 12){ break; }
            used = next;
            shown.push(usable[i]);
        }
        return shown;
    }

    $scope.visibleNews = [];
    $scope.newsSeparator = NEWS_SEPARATOR;

    function refreshVisibleNews(){
        $scope.visibleNews = buildVisibleNews(newsIndex);
    }

    /*
     * Re-measured when the window changes, and when the panel's own resizers
     * move - the footer follows the panel, not the window, on an org page.
     */
    var newsResizeTimer = null;
    function onNewsResize(){
        if(newsResizeTimer){ $timeout.cancel(newsResizeTimer); }
        newsResizeTimer = $timeout(function(){
            newsResizeTimer = null;
            refreshVisibleNews();
        }, 120);
    }
    window.addEventListener('resize', onNewsResize);
    $scope.$on('$destroy', function(){
        window.removeEventListener('resize', onNewsResize);
        if(newsResizeTimer){ $timeout.cancel(newsResizeTimer); }
    });

    function showNews(index){
        var item = $scope.newsHeadlines[index];
        if(!item || !item.text){
            index = nextUsableNews(index);
            if(index === -1){
                $scope.currentNews = null;
                return;
            }
            item = $scope.newsHeadlines[index];
        }
        newsIndex = index;
        $scope.currentNews = item;
        // "Open Trust Status", not "Open TrustStatus" - the tooltip names the
        // view the way the menu does. Resolved here rather than in the
        // template so it is not looked up again on every digest.
        $scope.currentNewsTargetLabel = newsTargetLabel(item);
        // The bar shows this headline and however many after it fit.
        refreshVisibleNews();
        // Drop the class and re-add it next tick, or the animation only ever
        // plays for the first headline - same restart problem as the menu.
        $scope.newsAnimating = false;
        $timeout(function(){ $scope.newsAnimating = true; }, 20);
    }

    function scheduleNextNews(){
        if(newsTimer){
            $timeout.cancel(newsTimer);
            newsTimer = null;
        }
        // A single headline is not a ticker; leave it up and stop timing.
        if($scope.newsHeadlines.length < 2){
            return;
        }
        newsTimer = $timeout(function(){
            var next = nextUsableNews(newsIndex);
            if(next === -1){
                $scope.currentNews = null;
                return;
            }
            showNews(next);
            scheduleNextNews();
        }, NEWS_INTERVAL_MS);
    }

    function startNewsTicker(){
        NewsService.getHeadlines().then(function(list){
            $scope.newsHeadlines = (list && list.length) ? list : [
                { text: "Salesforce Simplified active & monitoring org activity", target: null },
                { text: "Use quick search to inspect Apex, Flows, and objects", target: null }
            ];
            newsIndex = 0;
            showNews(0);
            scheduleNextNews();
        }, function() {
            $scope.newsHeadlines = [
                { text: "Salesforce Simplified active & monitoring org activity", target: null }
            ];
            newsIndex = 0;
            showNews(0);
        });
    }

    // A headline's target is a metadata `value`; this is the menu entry it
    // opens, or null when the headline is a read-only fact.
    function newsTargetSpec(item){
        var target = item && item.target;
        if(!target){
            return null;
        }
        // byValue already falls through to DynamicMetadataService.
        return MetaDataContainer.byValue(target) || null;
    }

    function newsTargetLabel(item){
        var spec = newsTargetSpec(item);
        return (spec && spec.label) || '';
    }

    // Only some headlines point somewhere; the rest are read-only facts.
    // Each headline in the bar points at its own list, so the one clicked is
    // the one that opens - not whichever happened to be first.
    $scope.openNewsTarget = function(item){
        var spec = newsTargetSpec(item || $scope.currentNews);
        if(spec){
            $scope.detailsPopupOpen(spec);
        }
    };

    $scope.newsTargetLabelFor = function(item){
        return newsTargetLabel(item);
    };

    $scope.$on('$destroy', function(){
        if(newsTimer){
            $timeout.cancel(newsTimer);
            newsTimer = null;
        }
    });

    $scope.closeModel = function(){
        if (typeof closeTimer !== 'undefined' && closeTimer) {
            clearTimeout(closeTimer);
        }
        closeTimer = setTimeout(function(){
            $scope.$applyAsync(function(){
                $("#mySidenav").css({"width": "0px"});
                setDetailPaneOpen(false);
                $scope.showloading = false;
                $scope.showErrorMessage = false;
                $scope.isDataAvailable = true;
                $scope.searchMenu = "";
                $scope.showAllData = false;
                $scope.selectedDataForDownload.clear();
                persistDataSelection();
            });
        }, 300);
    }
    $scope.loadData = function(){
       // $("#fullDataSidenav").css({"width": "70%"});
        //$("#recentItemOf").css({"width": "350"});
    }
    
    $scope.SimplifiedMainModalClose = function(){
    	$("#SimplifiedMainModal").css({"display": "none"});
    }

    /* ----------------------------------------------------------------- */
    /* Standalone page                                                     */
    /*                                                                     */
    /* simplified.html runs this same controller, so the differences are   */
    /* stated here rather than forked into a second one: there is no panel */
    /* to open or close, no full screen to toggle, and the org is chosen   */
    /* rather than inferred from the address bar.                          */
    /* ----------------------------------------------------------------- */

    $scope.isStandalonePage = ssIsStandalonePage();
    $scope.knownOrgs = [];
    $scope.currentOrigin = null;

    if($scope.isStandalonePage){
        // The menu is the page, so it is always open. callModel() is what
        // loads the menu's state on an org page; here it runs once at start
        // instead of on hover.
        $q.when(ssAuthReady()).then(function(){
            var context = SS_PAGE_CONTEXT || {};
            $scope.knownOrgs = (context.orgs || []).map(function(org){
                return {
                    origin: org.origin,
                    // The host is what a user recognises; the instance key is
                    // the same org said in Salesforce's words.
                    label: org.origin.replace(/^https?:\/\//, '') +
                           (org.instanceKey ? ' (' + org.instanceKey + ')' : '')
                };
            });
            $scope.currentOrigin = context.origin || null;
            // What the select goes back to when "Add another org" is picked.
            chosenOrigin = $scope.currentOrigin;

            /*
             * The picker's own list: the known orgs, plus a way to add one.
             * Kept apart from knownOrgs, which is the answer to "which orgs
             * does this browser know" and is read elsewhere for exactly that -
             * orgLoginOrigin falls back to its first entry, and an action
             * sitting in there would eventually be treated as an org.
             */
            $scope.orgOptions = $scope.knownOrgs.concat([{
                origin: $scope.addOrgOption,
                label: $scope.knownOrgs.length ? '+ Add another org\u2026' : '+ Add an org\u2026'
            }]);

            // SS_ORIGIN now points at the chosen org rather than at
            // chrome-extension://, so every record link has to be rebased -
            // see the note where baseUrl is first assigned.
            $scope.baseUrl = SS_ORIGIN;

            /*
             * UserId is constructed when Angular first injects it, which is at
             * bootstrap - before the org has been chosen and before the uid is
             * known. It reads the cookie once and keeps it, so on this page it
             * captured null. Re-read it here, now that ssAuthReady has
             * resolved and ssResolveUserFromIdentity has written it.
             *
             * Without this every user-scoped query runs as
             * `WHERE LastModifiedById = ''` and quietly returns nothing, next
             * to org-wide lists that are full - which reads as "you have
             * created nothing" rather than as a bug.
             */
            UserId.id = readCookie('uid');

            // Fills the "Viewing as" card. On an org page index.js does this
            // from its own ready handler, which does not run here.
            if(UserId.id && typeof verifyUser === 'function'){
                try{ verifyUser(); }catch(e){}
            }

            $scope._pendingFavourite = true;
            $scope.callModel();
        });
    }

    /* ----------------------------------------------------------------- */
    /* What to open on, on the standalone page                             */
    /*                                                                     */
    /* A panel opens on nothing because the user just summoned it and is   */
    /* about to say what they want. A page opened from the toolbar has no  */
    /* such moment, and an empty pane is a worse first impression than a   */
    /* guess - so it guesses, from what the org has actually been worked   */
    /* on lately.                                                          */
    /*                                                                     */
    /* SetupAuditTrail is the evidence, and the Audit Trail panel already  */
    /* reads it, so this is the same engine asked a different question:    */
    /* not "what changed" but "what kind of thing keeps changing".         */
    /* ----------------------------------------------------------------- */

    /*
     * Words, not characters.
     *
     * Both vocabularies name the same things in different shapes - "Apex
     * Class", "ApexClass", "changedApexClass" - so the comparison has to see
     * past spacing and camel case. The obvious way is to strip everything to
     * one lowercase blob and use indexOf, and it is wrong: "flow" is a
     * substring of "workflow", so every workflow rule change would read as a
     * flow change, and a length threshold to dodge that only trades the bug
     * for a different one - it throws away "Flow" itself.
     *
     * Splitting on camel-case boundaries and punctuation gives real words,
     * and "flow" is simply not one of the words in "changedWorkflowRule".
     */
    function tokenizeForMatch(text){
        return String(text || '')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(function(part){ return !!part; });
    }

    /*
     * Scores menu entries against audit trail rows.
     *
     * Deliberately no table mapping Salesforce's Section names to this
     * extension's menu values. The menu already carries both a label and an
     * API-ish value for every type it knows, and the audit trail says things
     * like Section "Apex Class" with Action "changedApexClass" - so the two
     * vocabularies already agree, once punctuation and case stop getting in
     * the way. A metadata type added to the menu later is matched by this
     * without anyone remembering to teach it the name.
     *
     * Short needles are skipped: "flow" appears inside "workflow", and a
     * three-letter value would match almost anything.
     */
    function scoreMetadataAgainstAudit(records, candidates){
        var rows = (records || []).map(function(r){
            var words = tokenizeForMatch((r.Section || '') + ' ' + (r.Action || '') + ' ' + (r.Display || ''));
            var present = Object.create(null);
            words.forEach(function(word){ present[word] = true; });
            return { present: present, words: words };
        });

        /*
         * A word counts as present if the row says it, or says a recognisable
         * abbreviation of it.
         *
         * Salesforce shortens words in Action names - "changedPermSet" for a
         * permission set - so PermissionSet's [permission, set] found "set"
         * and never "permission", and lost to Profile, which Salesforce
         * happens to spell out in full. A table of Salesforce's abbreviations
         * would fix that and need feeding forever.
         *
         * A prefix test does it without one: "perm" begins "permission". It
         * also keeps the distinction that matters - "flow" does not begin
         * "workflow", so a workflow change is still not a flow change. Four
         * characters minimum, or "set" would begin "setup".
         */
        var MIN_ABBREVIATION = 4;

        /*
         * Two different ways the same word gets written, kept apart because
         * they need different rules.
         *
         * Salesforce pluralises in Section names - "Validation Rules",
         * "Permission Sets" - against menu values that are singular. That is
         * a suffix, and treating it as a loose prefix instead would mean
         * accepting three-letter stems, at which point "set" reaches "setup"
         * and every setup change looks like a permission set change.
         */
        function samePlural(a, b){
            var shorter = a.length <= b.length ? a : b;
            var longer  = a.length <= b.length ? b : a;
            return longer === shorter + 's' || longer === shorter + 'es';
        }

        /*
         * And it abbreviates in Action names - "changedPermSet" - which is a
         * prefix, and needs a floor: four characters, so a stem is a real
         * stem. "flow" is not a prefix of "workflow" in either direction, so
         * the distinction that matters survives both rules.
         */
        function abbreviates(a, b){
            var shorter = a.length <= b.length ? a : b;
            var longer  = a.length <= b.length ? b : a;
            return shorter.length >= MIN_ABBREVIATION && longer.indexOf(shorter) === 0;
        }

        function says(word, present, rowWords){
            if(present[word]){ return true; }
            for(var i = 0; i < rowWords.length; i++){
                var said = rowWords[i];
                if(samePlural(word, said) || abbreviates(word, said)){ return true; }
            }
            return false;
        }

        function named(words, present, rowWords){
            if(!words.length){ return false; }
            for(var i = 0; i < words.length; i++){
                if(!says(words[i], present, rowWords)){ return false; }
            }
            return true;
        }

        var scores = [];
        (candidates || []).forEach(function(item){
            var byValue = tokenizeForMatch(item.value);
            var byLabel = tokenizeForMatch(item.label);
            if(!byValue.length && !byLabel.length){ return; }

            var hits = 0;
            rows.forEach(function(row){
                if(named(byValue, row.present, row.words) ||
                   named(byLabel, row.present, row.words)){ hits++; }
            });
            if(hits){
                // More words matched is a more specific claim on the row, so
                // LightningComponentBundle outranks anything vaguer that also
                // happened to fit.
                scores.push({ item: item, hits: hits,
                              words: Math.max(byValue.length, byLabel.length) });
            }
        });

        scores.sort(function(a, b){
            return (b.hits - a.hits) || (b.words - a.words);
        });
        return scores.length ? scores[0].item : null;
    }

    // Exposed for the same reason the scoring is a function at all: it is the
    // one part of this worth checking without an org in front of it.
    $scope.scoreMetadataAgainstAudit = scoreMetadataAgainstAudit;

    /*
     * Metadata or data - decided by who the user is, then by what they do.
     *
     * Someone with Modify All Data or Author Apex opened this for the setup:
     * that is what those permissions are for, and the metadata lists are the
     * reason such a person installs it at all. Everyone else is far more
     * likely to want records, but "likely" is not "certain", so it is only
     * acted on where their own history says so. A user who has touched no
     * records is not helped by being dropped into one.
     *
     * Pure and separated from the queries so the rule can be read, argued
     * with, and checked without an org.
     */
    function decideDefaultSelection(audience, metadataHits, dataHits){
        if(audience && (audience.isAdmin || audience.isBuilder)){
            return 'metadata';
        }
        if(dataHits > metadataHits && dataHits > 0){
            return 'data';
        }
        return 'metadata';
    }
    $scope.decideDefaultSelection = decideDefaultSelection;

    /*
     * The object this user actually opens, from their own recently viewed.
     *
     * Counted rather than de-duplicated: the question is which object they
     * spend their time in, and forty Cases beats one Account.
     */
    function scoreDataAgainstRecent(types, candidates){
        var byValue = Object.create(null);
        (candidates || []).forEach(function(item){
            if(item && item.value){ byValue[item.value] = item; }
        });
        var counts = Object.create(null);
        (types || []).forEach(function(type){
            if(type && byValue[type]){ counts[type] = (counts[type] || 0) + 1; }
        });
        var best = null;
        Object.keys(counts).forEach(function(type){
            if(!best || counts[type] > counts[best]){ best = type; }
        });
        return best ? { item: byValue[best], hits: counts[best] } : null;
    }
    $scope.scoreDataAgainstRecent = scoreDataAgainstRecent;

    /*
     * The entry the menu already ranks first.
     *
     * populateMenus sorts by orgScore - the weekly per-org usage UsageService
     * keeps - so the top of the list is, by construction, what this user
     * works on most. Recommending anything else means the page opens on one
     * thing while the menu beside it says another is the favourite.
     *
     * This replaced a second, independent reading of the audit trail, and
     * they disagreed: Salesforce abbreviates in Action names, so
     * "changedPermSet" gives the words [changed, perm, set] and never matches
     * PermissionSet's [permission, set], while "changedProfile" matches
     * Profile exactly. Permission Set sat top of the menu on usage and the
     * page opened on Profile. One ranking, used everywhere, cannot disagree
     * with itself - and needs no table of Salesforce's abbreviations.
     */
    /*
     * What this user is working on *now*, which is a question about recency,
     * not volume.
     *
     * Counting rows answers "what do they touch most", and those are
     * different questions with different answers: an org with hundreds of
     * historical Profile edits opens on Profile forever, however long ago
     * that was and whatever the person has been doing since. The audit trail
     * arrives newest-first, so the first row that names something in the menu
     * is the thing they last had their hands on.
     */
    function mostRecentMetadataFromAudit(auditRows, candidates){
        for(var i = 0; i < (auditRows || []).length; i++){
            var hit = scoreMetadataAgainstAudit([auditRows[i]], candidates);
            if(hit){ return hit; }
        }
        return null;
    }
    $scope.mostRecentMetadataFromAudit = mostRecentMetadataFromAudit;

    /*
     * Failing that, whatever they opened here last time.
     *
     * SetupAuditTrail needs "View Setup and Configuration", so for plenty of
     * users the question above cannot be asked at all. Their own last choice
     * is the next best evidence, and it is the one piece this extension can
     * always see because it is the one it wrote itself.
     */
    var LAST_METADATA_COOKIE = 'simplified_last_metadata';

    /*
     * The selection this tab is currently on, so a refresh comes back to it.
     *
     * sessionStorage rather than a cookie or chrome.storage, because its
     * lifetime is exactly the behaviour wanted: it survives a reload and dies
     * with the tab. A refresh therefore restores, and opening the page fresh
     * from the toolbar recommends - without having to ask the browser how it
     * was navigated to, or guess from timestamps.
     *
     * Keyed by org so switching org - which reloads the page with a new ?org
     * - is a first open for that org rather than a restore of the last one's
     * selection.
     */
    function sessionSelectionKeyFor(origin){
        var org = null;
        try{ org = ssOrgKey(new URL(origin).hostname); }catch(e){}
        return 'ss_selected_metadata_' + (org || origin);
    }

    function sessionSelectionKey(){
        return sessionSelectionKeyFor(SS_ORIGIN);
    }

    function rememberSessionSelection(value){
        if(!value){ return; }
        try{ window.sessionStorage.setItem(sessionSelectionKey(), value); }catch(e){}
    }

    function sessionSelection(){
        try{ return window.sessionStorage.getItem(sessionSelectionKey()); }catch(e){ return null; }
    }

    /* ----------------------------------------------------------------- */
    /* The address bar as the record of where you are                     */
    /*                                                                    */
    /* Only on simplified.html. On an org page the URL belongs to          */
    /* Salesforce's own router - pushing entries into it there would fight */
    /* Lightning's navigation and leave the user with back buttons that do */
    /* something other than what they say.                                 */
    /*                                                                    */
    /* On the standalone page the precedent is already set: ?org= travels  */
    /* in the URL so that switching org is a navigation. ?type= is the     */
    /* same idea one level down, and it buys three things at once - back   */
    /* and forward work, a reload lands where you were, and a link to a    */
    /* particular metadata list can be shared.                             */
    /* ----------------------------------------------------------------- */
    var urlNavigating = false;   // set while restoring, so popstate cannot re-push

    function urlSelection(){
        if(!$scope.isStandalonePage){ return null; }
        try{
            return new URLSearchParams(window.location.search).get('type');
        }catch(e){ return null; }
    }

    function syncUrlForMetadata(value){
        if(!$scope.isStandalonePage || !value || urlNavigating){ return; }
        try{
            var params = new URLSearchParams(window.location.search);
            if(params.get('type') === value){ return; }   // already there: no entry
            params.set('type', value);
            // ?org= is preserved by construction - it is read from the same
            // params object rather than rebuilt, so switching type never
            // silently moves the page to a different org.
            window.history.pushState({ ssType: value }, '',
                window.location.pathname + '?' + params.toString());
        }catch(e){
            // No history API, or a URL the browser will not accept. The panel
            // still works; it just stops being addressable.
        }
    }

    function rememberLastMetadata(value){
        if(!value){ return; }
        rememberSessionSelection(value);
        try{ setCookie(LAST_METADATA_COOKIE, value, PREFERENCE_DAYS); }catch(e){}
    }

    function lastOpenedMetadata(candidates){
        var last = readCookie(LAST_METADATA_COOKIE);
        if(!last){ return null; }
        var found = null;
        (candidates || []).forEach(function(item){
            if(!found && item && item.value === last){ found = item; }
        });
        return found;
    }

    function topByUsage(candidates){
        var best = null;
        (candidates || []).forEach(function(item){
            var score = (item && item.orgScore) || 0;
            if(score > 0 && (!best || score > (best.orgScore || 0))){
                best = item;
            }
        });
        return best;
    }
    $scope.topByUsage = topByUsage;

    // Never let one unreadable source take the whole decision down with it.
    function settled(promise, fallback){
        return $q.when(promise).then(function(value){ return value; },
                                     function(){ return fallback; });
    }

    /*
     * What the standalone page opens on.
     *
     * A refresh is not a new visit. Someone reloading the page is in the
     * middle of something and expects to come back to it - re-running the
     * recommendation there would take the page away from them, and the more
     * accurate the recommendation the more annoying that is. So the session's
     * own selection wins whenever there is one, and the recommendation is
     * only consulted on a genuine first open.
     */
    /*
     * Back and forward.
     *
     * urlNavigating stops the open from pushing a fresh entry for the state we
     * were just handed - without it, going back would push the old page on top
     * of the stack and the button would never get anywhere.
     */
    if(ssIsStandalonePage() && typeof window !== 'undefined' && window.addEventListener){
        window.addEventListener('popstate', function(){
            var wanted = urlSelection();
            if(!wanted){ return; }
            var spec = MetaDataContainer.byValue(wanted);
            if(!spec){ return; }
            urlNavigating = true;
            try{
                $scope.$applyAsync(function(){
                    $scope.detailsPopupOpen(spec);
                    urlNavigating = false;
                });
            }catch(e){
                urlNavigating = false;
            }
        });
    }

    function openInitialMetadata(){
        /*
         * An explicit ?type= outranks the restored session. It is the only
         * one of the three that the user could have typed, bookmarked or
         * arrived at with the back button, so it is the only one that is a
         * statement rather than an inference.
         */
        var fromUrl = urlSelection();
        if(fromUrl){
            var wanted = MetaDataContainer.byValue(fromUrl);
            if(wanted){
                $scope.detailsPopupOpen(wanted);
                return;
            }
        }

        var restored = restoreSessionSelection();
        if(restored){
            $scope.detailsPopupOpen(restored);
            return;
        }
        openFavouriteMetadata();
    }

    /*
     * Finds the selection this tab was on, wherever it lives.
     *
     * Searched across everything, not just the queryable types: someone who
     * refreshes while reading Trust Status or the package.xml editor means to
     * come back to that too.
     */
    function restoreSessionSelection(){
        var value = sessionSelection();
        if(!value){ return null; }

        var found = null;
        ($scope.allMetadataList || []).forEach(function(item){
            if(!found && item && item.value === value){ found = item; }
        });
        if(!found){
            try{ found = MetaDataContainer.byValue(value) || null; }catch(e){ found = null; }
        }
        if(!found){ return null; }

        /*
         * A restored entry has to be in the menu to be selected in it. The
         * feature switches hide whole families - data objects behind Data,
         * deployable metadata behind Metadata - and the user may have turned
         * one on last time.
         */
        var feature = found.technologyFeature;
        if(feature === 'Admin' && !$scope.Admin){
            $scope.Admin = true;
            $scope.setSimplifiedCookie('Simplified_Admin', true);
            if($scope.allMetadataList){ populateMenus($scope.allMetadataList); }
        }else if(feature === 'Salesforce' && !$scope.Developer){
            $scope.Developer = true;
            $scope.setSimplifiedCookie('Simplified_Developer', true);
            if($scope.allMetadataList){ populateMenus($scope.allMetadataList); }
        }
        return found;
    }

    function openFavouriteMetadata(){
        /*
         * Candidates come from the full catalogue, not the rendered menu.
         *
         * Data objects carry technologyFeature 'Admin' and are hidden unless
         * the Data switch is on - which for a non-admin it is not, by
         * default. Reading the rendered menu would therefore find no data
         * objects to recommend precisely for the users this rule exists to
         * serve.
         */
        var everything = ($scope.allMetadataList || []).filter(function(item){
            return item && item.type === 'table';
        });
        if(!everything.length){ return; }

        var metadataCandidates = everything.filter(function(item){
            return item.technologyFeature === 'Salesforce';
        });
        var dataCandidates = everything.filter(function(item){
            return item.technologyFeature === 'Admin';
        });

        var uid = readCookie('uid');
        // Their own setup changes first; an org's history is not a person's.
        var auditSoql = "SELECT Section, Action, Display FROM SetupAuditTrail" +
                        (uid ? " WHERE CreatedById = '" + escapeSoqlLiteral(uid) + "'" : "") +
                        " ORDER BY CreatedDate DESC LIMIT 300";
        var recentSoql = "SELECT Type FROM RecentlyViewed WHERE LastViewedDate != null " +
                         "ORDER BY LastViewedDate DESC LIMIT 200";

        $q.all([
            settled(NewsService.getAudience(), { isAdmin: false, isBuilder: false }),
            settled(sfdc.query(auditSoql), null),
            settled(sfdc.query(recentSoql), null)
        ]).then(function(results){
            var audience = results[0] || {};
            var auditRows = (results[1] && results[1].records) || [];
            var recentTypes = (((results[2] && results[2].records) || [])
                .map(function(r){ return r && r.Type; }));

            /*
             * In order of how directly each answers "what is this person
             * working on": the last thing they actually changed, then the
             * last thing they opened here, then whatever they use most.
             * Volume is the weakest of the three and comes last, because a
             * long history outvotes this morning otherwise.
             */
            /*
             * Frequency first, because that is what the metadata section is
             * built on: orgScore is the weekly per-org audit-trail tally, and
             * it is what orders the menu. Taking the top of that ranking is
             * the same answer the sidebar is already showing, so the page
             * cannot open on one thing while the menu says another is the
             * favourite.
             *
             * The rest are fallbacks for when it cannot be computed - their
             * own audit rows when the org tally is missing, then the last
             * thing they opened here, then the last thing they changed, which
             * is the only one that answers "right now" rather than "usually".
             */
            var metadataPick = topByUsage(metadataCandidates) ||
                               scoreMetadataAgainstAudit(auditRows, metadataCandidates) ||
                               lastOpenedMetadata(metadataCandidates) ||
                               mostRecentMetadataFromAudit(auditRows, metadataCandidates);
            var dataPick = scoreDataAgainstRecent(recentTypes, dataCandidates);

            // Comparable units on both sides: how many of this user's own
            // rows the winning candidate actually accounts for.
            var metadataHits = metadataPick ? auditRowsMatching(auditRows, metadataPick) : 0;
            var dataHits = dataPick ? dataPick.hits : 0;

            var choice = decideDefaultSelection(audience, metadataHits, dataHits);

            if(choice === 'data' && dataPick){
                /*
                 * Data objects are hidden behind the Data switch, so choosing
                 * one means turning it on - otherwise the entry being opened
                 * is not in the menu the user is looking at. Persisted like
                 * any other preference, because this is now what they want.
                 */
                if(!$scope.Admin){
                    $scope.Admin = true;
                    $scope.setSimplifiedCookie('Simplified_Admin', true);
                    if($scope.allMetadataList){ populateMenus($scope.allMetadataList); }
                }
                $scope.detailsPopupOpen(dataPick.item);
                return;
            }
            if(metadataPick){
                $scope.detailsPopupOpen(metadataPick);
            }else if(dataPick){
                // Nothing in setup to go on: better their busiest object than
                // an empty pane.
                if(!$scope.Admin){
                    $scope.Admin = true;
                    $scope.setSimplifiedCookie('Simplified_Admin', true);
                    if($scope.allMetadataList){ populateMenus($scope.allMetadataList); }
                }
                $scope.detailsPopupOpen(dataPick.item);
            }
        });
    }

    // How many audit rows one candidate accounts for - the weight behind a
    // metadata pick, in the same units as a data pick's row count.
    function auditRowsMatching(auditRows, item){
        var hits = 0;
        (auditRows || []).forEach(function(row){
            if(scoreMetadataAgainstAudit([row], [item])){ hits++; }
        });
        return hits;
    }
    $scope.auditRowsMatching = auditRowsMatching;

    /*
     * Switching org re-enters the page rather than mutating it in place.
     *
     * Every service here caches against the org it started on - the schema
     * catalogue, the news, the usage counters, the resolved instance key -
     * and unpicking that safely means knowing every cache in the app. A
     * reload is one line, cannot be half-done, and is what the user means by
     * "show me the other org" anyway.
     */
    /*
     * Not an org - a way to get one.
     *
     * The picker lists orgs this browser has already been in, and there was no
     * way to reach one it had not: the sign-in card only appears when there is
     * no session at all, so anyone already signed in to one org could not add
     * a second without going and opening it in a tab first.
     */
    var ADD_ORG = '__ss_add_org__';
    $scope.addOrgOption = ADD_ORG;
    var chosenOrigin = null;

    $scope.switchOrg = function(){
        if($scope.currentOrigin === ADD_ORG){
            // Put the select back before opening the card: this entry is an
            // action, and leaving it selected would show "Add another org" as
            // though it were the org on screen.
            $scope.currentOrigin = chosenOrigin;
            /*
             * Production rather than "This org". "This org" resolves to the
             * one already on screen, which is the one thing this cannot mean -
             * and Sandbox and Custom URL are still one click away.
             */
            $scope.setLoginTarget('production');
            $scope.requestSignIn('add');
            return;
        }

        if(!$scope.currentOrigin){ return; }
        chosenOrigin = $scope.currentOrigin;

        /*
         * Changing org opens that org's favourite, not whatever was last
         * looked at there.
         *
         * The selection is remembered per org, so switching to an org for the
         * first time already landed on the favourite - but switching back to
         * one visited earlier in the session restored its last selection
         * instead. Those are the same act to the user and should behave the
         * same way: arriving at an org is a fresh look at it, and the
         * audit-trail favourite is the best guess at what they came for.
         *
         * Only the target org's memory is dropped. An ordinary refresh - F5,
         * no switch - does not come through here and still restores exactly
         * what was on screen, which is the behaviour that already exists.
         */
        try{
            window.sessionStorage.removeItem(sessionSelectionKeyFor($scope.currentOrigin));
        }catch(e){}

        try{
            var url = new URL(window.location.href);
            url.searchParams.set('org', $scope.currentOrigin);
            window.location.href = url.toString();
        }catch(e){
            window.location.reload();
        }
    };

    /* ----------------------------------------------------------------- */
    /* Standard & custom objects - the describe, as a tree                 */
    /* ----------------------------------------------------------------- */

    $scope.describeState = {
        objects: [], chosen: '', loading: false, error: '', raw: null, groups: [], open: {}
    };

    /*
     * The picker, from what the catalogue already knows.
     *
     * Both catalogues, because the Tooling objects are the ones whose describe
     * is hardest to come by any other way - and a list that silently omitted
     * them would look like the org does not have them.
     */
    $scope.loadDescribeObjects = function(){
        if($scope.describeState.objects.length){ return $q.when($scope.describeState.objects); }

        return $q.all([SchemaService.globalDescribe(), SchemaService.toolingDescribe()])
            .then(function(both){
                var seen = Object.create(null);
                var list = [];
                [both[0], both[1]].forEach(function(map){
                    Object.keys(map || {}).forEach(function(name){
                        if(seen[name]){ return; }
                        seen[name] = true;
                        var info = map[name] || {};
                        list.push({
                            name: name,
                            label: info.label || name,
                            custom: !!info.custom
                        });
                    });
                });
                list.sort(function(a, b){ return a.name.localeCompare(b.name); });
                $scope.describeState.objects = list;
                return list;
            });
    };

    $scope.describeChosen = function(){
        var name = $scope.describeState.chosen;
        if(!name){ return; }

        $scope.describeState.loading = true;
        $scope.describeState.error = '';
        $scope.describeState.raw = null;
        $scope.describeState.groups = [];
        $scope.describeState.open = {};

        return fetchDescribe('/sobjects/' + name + '/describe')
            .then(null, function(){
                // Tooling objects have no describe on the data API. Asked for
                // second rather than first, because most objects are not one.
                return fetchDescribe('/tooling/sobjects/' + name + '/describe');
            })
            .then(function(raw){
                $scope.describeState.loading = false;
                $scope.describeState.raw = raw;
                $scope.describeState.groups = describeGroups(raw);
                if(typeof ssCountUse === 'function'){ ssCountUse('objectsDescribed', 1); }
            }, function(failure){
                $scope.describeState.loading = false;
                $scope.describeState.error = (failure && failure.message) ||
                    ('The describe for ' + name + ' could not be read.');
            });
    };

    function fetchDescribe(path){
        return $q.when(ssRestCall({
            url: ssApiOrigin() + '/services/data/v' + SS_API_VERSION + path
        })).then(function(answer){
            if(!answer.ok){
                return $q.reject(new Error('The org refused that describe (HTTP ' +
                                           answer.status + ').'));
            }
            try{
                return JSON.parse(answer.text);
            }catch(e){
                return $q.reject(new Error('The org\'s answer could not be read.'));
            }
        });
    }

    /*
     * The describe, split the way it reads.
     *
     * Everything scalar at the top level is one group - those are the facts
     * about the object itself. Every array becomes its own group with a count,
     * because those are the lists somebody came to count: 113 child
     * relationships, 66 fields.
     *
     * Derived from the response rather than from a list of known keys: a
     * release that adds an array gets a group for it without anything here
     * being changed, and one that removes it does not leave an empty heading.
     */
    function describeGroups(raw){
        if(!raw || typeof raw !== 'object'){ return []; }

        var attributes = [];
        var groups = [];

        Object.keys(raw).forEach(function(key){
            var value = raw[key];
            if(Array.isArray(value)){
                groups.push({
                    key: key,
                    label: humaniseKey(key),
                    count: value.length,
                    items: value.map(function(item, index){
                        return {
                            label: itemLabel(item, index),
                            custom: !!(item && item.custom),
                            system: isSystemField(item),
                            entries: describeEntries(item)
                        };
                    })
                });
                return;
            }
            attributes.push({ key: key, value: value });
        });

        groups.sort(function(a, b){ return a.label.localeCompare(b.label); });

        // Attributes first: they are about the object, and the lists are
        // about its parts.
        if(attributes.length){
            groups.unshift({
                key: '__attributes__',
                label: 'Attributes',
                count: 0,
                entries: attributes
            });
        }
        return groups;
    }
    $scope.describeGroups = describeGroups;

    /* childRelationships -> Child Relationships */
    function humaniseKey(key){
        var spaced = String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }
    $scope.humaniseKey = humaniseKey;

    /*
     * What to call a row before it is opened.
     *
     * Each array holds a different shape - fields have names, child
     * relationships have a child object and a relationship name, scopes are
     * bare strings - so the first of these that is there wins rather than
     * every list needing its own case.
     */
    function itemLabel(item, index){
        if(item === null || item === undefined){ return '(' + index + ')'; }
        if(typeof item !== 'object'){ return String(item); }
        return item.name || item.relationshipName || item.childSObject ||
               item.label || item.value || item.urls || ('(' + index + ')');
    }
    $scope.itemLabel = itemLabel;

    /*
     * A field the org maintains, not one anybody fills in.
     *
     * Neither creatable nor updateable is what that actually means -
     * CreatedDate, SystemModstamp, Id, the rollups. Guessing from the name
     * would miss every formula and catch every custom field ending in Id.
     */
    function isSystemField(item){
        return !!(item && typeof item === 'object' &&
                  item.name && !item.custom &&
                  item.createable === false && item.updateable === false);
    }
    $scope.isSystemField = isSystemField;

    /*
     * One row per property, with the nested ones flattened to something
     * readable rather than dropped - picklistValues and referenceTo are often
     * the reason the describe was opened.
     */
    function describeEntries(item){
        if(item === null || item === undefined){ return []; }
        if(typeof item !== 'object'){ return [{ key: 'value', value: item }]; }

        return Object.keys(item).map(function(key){
            var value = item[key];
            if(Array.isArray(value)){
                return { key: key, value: value.length ? JSON.stringify(value) : '[]' };
            }
            if(value && typeof value === 'object'){
                return { key: key, value: JSON.stringify(value) };
            }
            return { key: key, value: value };
        });
    }
    $scope.describeEntries = describeEntries;

    /* Colour by what the value is, so true and false read at a glance. */
    $scope.describeValueClass = function(value){
        if(value === true){ return 'is-true'; }
        if(value === false){ return 'is-false'; }
        return '';
    };

    $scope.toggleDescribeNode = function(key){
        $scope.describeState.open[key] = !$scope.describeState.open[key];
    };

    $scope.expandDescribeAll = function(open){
        var state = {};
        if(open){
            $scope.describeState.groups.forEach(function(group){
                state[group.key] = true;
            });
        }
        $scope.describeState.open = state;
    };

    /* ----------------------------------------------------------------- */
    /* Bulk API job status                                                 */
    /*                                                                     */
    /* Two lists, because Salesforce keeps them apart: /jobs/ingest is the  */
    /* loads and /jobs/query is the extracts, and neither knows about the   */
    /* other. Merged here because "which of my bulk jobs failed" does not   */
    /* distinguish them.                                                    */
    /* ----------------------------------------------------------------- */

    $scope.bulk = {
        loading: false, error: '', jobs: [],
        selected: null, detail: null, detailLoading: false, detailError: '',
        lookupId: '', lookupError: ''
    };

    /*
     * A job id somebody has but the list does not.
     *
     * The list is the recent ones. An id from a log, a ticket or a colleague
     * is usually older than that, and without this the only way to look at it
     * is a REST call - which is the thing this page exists to save.
     */
    function normaliseJobId(text){
        var id = String(text || '').trim();
        if(!id){ return { error: 'Enter a job id, such as 750xx0000000001AAA.' }; }
        if(!/^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(id)){
            return { error: 'A Salesforce id is 15 or 18 characters. That one is ' +
                            id.length + '.' };
        }
        /*
         * Warned about rather than refused. 750 is the Bulk job prefix, but an
         * id that is not one is a mistake worth naming without deciding on the
         * user's behalf that it cannot be tried.
         */
        return { id: id, unexpected: id.slice(0, 3) !== '750' };
    }
    $scope.normaliseJobId = normaliseJobId;

    $scope.lookupBulkJob = function(){
        var parsed = normaliseJobId($scope.bulk.lookupId);
        if(parsed.error){
            $scope.bulk.lookupError = parsed.error;
            return;
        }

        $scope.bulk.lookupError = parsed.unexpected
            ? 'That does not look like a Bulk job id - those begin 750 - but it ' +
              'was looked up anyway.'
            : '';
        $scope.bulk.selected = { id: parsed.id, kind: '' };
        $scope.bulk.detail = null;
        $scope.bulk.detailError = '';
        $scope.bulk.detailLoading = true;

        /*
         * Both kinds, because an id does not say which it is. Ingest first:
         * loads outnumber extracts, and the second call only happens when the
         * first has already said no.
         */
        return jobDetail('ingest', parsed.id).then(function(found){
            if(found){ return found; }
            return jobDetail('query', parsed.id);
        }).then(function(found){
            $scope.bulk.detailLoading = false;
            if(!found){
                $scope.bulk.detailError = 'No Bulk API 2.0 job in this org has that id. ' +
                    'Jobs from the older v1 API are not visible here - those are in ' +
                    'Setup under Bulk Data Load Jobs.';
                $scope.bulk.selected = null;
                return;
            }
            $scope.bulk.selected = { id: parsed.id, kind: found.kind };
            $scope.bulk.detail = found.detail;
        }, function(failure){
            $scope.bulk.detailLoading = false;
            $scope.bulk.selected = null;
            $scope.bulk.detailError = (failure && failure.message) ||
                'That job could not be looked up.';
        });
    };

    /*
     * One kind, answered as found or not found.
     *
     * A 404 here is an answer - the job is not of this kind - so it resolves
     * rather than rejecting; only a request that could not be made at all is a
     * failure, and that must not be mistaken for "try the other one".
     */
    function jobDetail(kind, id){
        return $q.when(ssRestCall({
            url: ssApiOrigin() + '/services/data/v' + SS_API_VERSION +
                 '/jobs/' + kind + '/' + id
        })).then(function(answer){
            if(!answer.ok){ return null; }
            try{
                return { kind: kind, detail: JSON.parse(answer.text) };
            }catch(e){
                return null;
            }
        });
    }

    /*
     * One list, newest first, each row saying which kind it is.
     *
     * Sorted on createdDate rather than left in the order the two responses
     * arrived, or the ingest jobs would all sit above the query jobs whatever
     * their dates - which reads as "nothing has run since" for whichever kind
     * came second.
     */
    function bulkJobRows(ingest, query) {
        var rows = [];
        (ingest || []).forEach(function(job){
            if(job && job.id){ rows.push(withKind(job, 'ingest')); }
        });
        (query || []).forEach(function(job){
            if(job && job.id){ rows.push(withKind(job, 'query')); }
        });
        rows.sort(function(a, b){
            return (Date.parse(b.createdDate) || 0) - (Date.parse(a.createdDate) || 0);
        });
        return rows;
    }
    $scope.bulkJobRows = bulkJobRows;

    function withKind(job, kind) {
        return {
            id: job.id,
            kind: kind,
            object: job.object || '',
            operation: job.operation || '',
            state: job.state || '',
            createdDate: job.createdDate || '',
            createdById: job.createdById || ''
        };
    }

    /*
     * Whether a state is worth noticing.
     *
     * Failed and Aborted are the ones somebody came here about; JobComplete is
     * the answer they were hoping for; everything else is still happening and
     * says so without a colour of its own.
     */
    $scope.bulkStateClass = function(state){
        if(state === 'Failed' || state === 'Aborted'){ return 'is-bad'; }
        if(state === 'JobComplete'){ return 'is-good'; }
        return '';
    };

    function bulkList(kind) {
        return $q.when(ssRestCall({
            url: ssApiOrigin() + '/services/data/v' + SS_API_VERSION + '/jobs/' + kind
        })).then(function(answer){
            if(!answer.ok){ return { refused: kind, records: [] }; }
            var data = null;
            try{ data = JSON.parse(answer.text); }catch(e){ data = null; }
            return { records: (data && data.records) || [] };
        }, function(){
            // One kind being unavailable is not a reason to show neither.
            return { refused: kind, records: [] };
        });
    }

    /* ----------------------------------------------------------------- */
    /* Org sync: pipelines, staged jobs, and what happened to them        */
    /*                                                                    */
    /* Nothing here talks to an org. Every call goes to the service       */
    /* worker, which is the only place that can hold a session for two    */
    /* orgs at once - see js/sync-engine.js. This screen stages work and  */
    /* reads back what the worker made of it.                             */
    /* ----------------------------------------------------------------- */

    $scope.sync = {
        loading: false,
        error: '',
        notice: '',
        pipelines: [],
        orgs: [],
        jobs: [],
        counts: { staged: 0, running: 0, succeeded: 0, failed: 0, blocked: 0 },
        // Held rather than computed in the template. A function returning
        // fresh arrays into an ng-repeat is re-evaluated every digest and
        // never compares equal to its last answer, which is an infinite
        // digest rather than a slow one.
        groups: { active: [], succeeded: [], failed: [] },
        /*
         * Which page of each list is showing, and the page itself.
         *
         * The slices are held rather than computed in the binding: an
         * ng-repeat whose source is a function call gets a fresh array every
         * digest and never settles.
         */
        page: { active: 0, succeeded: 0, failed: 0 },
        pages: { active: null, succeeded: null, failed: null },
        draft: null,
        openJob: null,
        busyJob: null,
        // Which list is asking "are you sure" - null when neither is.
        clearing: null,
        here: null,
        selected: 0,
        // Replaced by the engine's own values on the first load; these are
        // only what the page says before it has been told.
        dataLimit: 200,
        validationTtl: 10 * 24 * 60 * 60 * 1000
    };

    $scope.syncTestLevels = [
        { value: 'NoTestRun',     label: 'None - fastest, fine for a sandbox' },
        { value: 'RunLocalTests', label: 'Local tests - needed for a production quick deploy' }
    ];

    /*
     * Which way a pipeline may be used.
     *
     * "Both ways" is a permission, not automation: it means either org may be
     * the source, and which one it is gets decided by the org you are in when
     * you press the button. Nothing runs on its own either way - see
     * ssSyncRoute, where the direction is only ever two refusals.
     *
     * It saves keeping two pipelines for a pair worked in both directions.
     * The cost is that such a row has no fixed source until you know where
     * you are standing, which is what the per-org mapping above is for.
     */
    var SYNC_DIRECTIONS = [
        { value: 'both',   label: 'Both ways' },
        { value: 'a-to-b', label: 'First org to second only' },
        { value: 'b-to-a', label: 'Second org to first only' }
    ];

    /* Held, not computed in the binding: ng-options watches the collection,
     * and a fresh array every digest never compares equal to the last. */
    $scope.syncDirections = SYNC_DIRECTIONS.slice();

    function shapeSync(answer){
        $scope.sync.pipelines = (answer && answer.pipelines) || [];
        $scope.sync.orgs = (answer && answer.orgs) || [];
        $scope.sync.jobs = (answer && answer.jobs) || [];
        /*
         * The history, grouped once per load and held on the job.
         *
         * The detail template repeats over these, and an ng-repeat whose
         * source is a function call gets a fresh array every digest - which
         * never compares equal to the last one and never settles. That has
         * already crashed this panel once, from featureUseTiles().
         */
        $scope.sync.jobs.forEach(function(job){
            job.historyGroups = PipelineService.historyGroups(job);
        });
        $scope.sync.counts = (answer && answer.counts) ||
            { staged: 0, running: 0, succeeded: 0, failed: 0, blocked: 0 };
        // The engine's cap, not a second copy of it - see the note where it
        // is sent. Used in the suggested query and in what the page says
        // about how much one job carries.
        $scope.sync.dataLimit = (answer && answer.dataLimit) || $scope.sync.dataLimit;
        $scope.sync.validationTtl = (answer && answer.validationTtlMs) || $scope.sync.validationTtl;
        $scope.sync.groups = PipelineService.group($scope.sync.jobs);
        syncRepaginate();
        syncOfferReview();
    }

    /*
     * Re-cut every list into pages.
     *
     * The clamped page is written back, so discarding the last job on page
     * five leaves the section showing the new last page rather than an empty
     * one with a Previous button.
     */
    function syncRepaginate(){
        ['active', 'succeeded', 'failed'].forEach(function(group){
            var slice = PipelineService.paginate(
                $scope.sync.groups[group], $scope.sync.page[group]);
            $scope.sync.pages[group] = slice;
            $scope.sync.page[group] = slice.page;
        });
    }

    /* Moving a page. The recut clamps, so the ends need no special case. */
    $scope.syncPage = function(group, step){
        $scope.sync.page[group] = ($scope.sync.page[group] || 0) + step;
        syncRepaginate();
    };

    /*
     * Whether to put the staged jobs in front of the user.
     *
     * Held as an array rather than filtered in the template: the modal
     * repeats over it, and a repeat whose source is a function call gets a
     * fresh array every digest and never settles.
     */
    function syncOfferReview(){
        var staged = ($scope.sync.groups.active || []).filter(function(job){
            return job && job.state === 'staged';
        });
        $scope.syncReview.jobs = staged;

        if(!staged.length){
            $scope.syncReview.open = false;
            return;
        }
        /* Only for something not already turned down. */
        var unseen = staged.some(function(job){ return !$scope.syncReview.seen[job.id]; });
        if(unseen){ $scope.syncReview.open = true; }
    }

    /*
     * The one job under review, when there is exactly one.
     *
     * The modal's footer acts on it directly. With several staged jobs a
     * single pair of buttons cannot say which one it means, so the footer
     * offers nothing and each job carries its own pair instead.
     *
     * Returns the job itself rather than a count, so the footer can be
     * disabled while that job is running and bound to it without reaching
     * into the array twice.
     */
    $scope.syncSoleReviewJob = function(){
        var jobs = ($scope.syncReview && $scope.syncReview.jobs) || [];
        return jobs.length === 1 ? jobs[0] : null;
    };

    /* Turned down for now: the jobs stay staged and stay in the section. */
    $scope.syncDismissReview = function(){
        ($scope.syncReview.jobs || []).forEach(function(job){
            $scope.syncReview.seen[job.id] = true;
        });
        $scope.syncReview.open = false;
    };

    /*
     * An error on this page, and the code that explains it.
     *
     * Held apart from the sentence rather than appended to it: the panel
     * shows the code as a link to error.html, which the sentence cannot be
     * made to do, and a code baked into prose cannot be looked up by anything
     * but a human reading it.
     */
    function syncFailed(problem, fallback){
        $scope.sync.error = (problem && (problem.message || problem.error)) || fallback;
        $scope.sync.errorCode = (problem && problem.code) || null;
    }

    /* What that code means, in the words the catalogue uses. Shown beside the
     * message so the commonest ones need no lookup at all. */
    /* A job's own code, for the row that reports it. Same catalogue, same
     * link - a failure in a list is looked up exactly as one at the top of
     * the page is. */
    $scope.syncJobErrorCode = function(job){
        return (job && job.error && job.error.code) || null;
    };

    $scope.syncJobHelpUrl = function(job){
        return (typeof ssErrorPageUrl === 'function')
            ? ssErrorPageUrl($scope.syncJobErrorCode(job)) : 'error.html';
    };

    /*
     * The reference page, with no code in particular.
     *
     * The per-error links only exist while there is an error, which makes the
     * page unfindable at exactly the times somebody wants to read it through -
     * before something goes wrong, or after they have closed the message.
     */
    $scope.errorReferenceUrl = function(){
        return (typeof ssErrorPageUrl === 'function') ? ssErrorPageUrl(null) : 'error.html';
    };

    $scope.syncErrorTitle = function(){
        var info = (typeof ssErrorInfo === 'function')
            ? ssErrorInfo($scope.sync && $scope.sync.errorCode) : null;
        return info ? info.title : '';
    };

    $scope.syncErrorHelpUrl = function(){
        return (typeof ssErrorPageUrl === 'function')
            ? ssErrorPageUrl($scope.sync && $scope.sync.errorCode) : 'error.html';
    };

    /*
     * The orgs this browser remembers, live and expired alike.
     *
     * Kept and shown rather than quietly dropped when the session goes: an
     * org you signed into last week is still an org you work in, and the
     * useful thing to say about it is "sign in again", not nothing at all.
     */
    $scope.orgSessions = { loading: false, list: [], error: '' };

    $scope.loadOrgSessions = function(){
        $scope.orgSessions.loading = true;
        $scope.orgSessions.error = '';
        return PipelineService.orgs().then(function(answer){
            $scope.orgSessions.loading = false;
            if(!answer || !answer.ok){
                $scope.orgSessions.error = (answer && answer.error) || 'Could not read the org list.';
                return;
            }
            /* Signed-out ones last, then most recently used first: the list
             * is read top-down and the usable orgs are what it is for. */
            $scope.orgSessions.list = (answer.orgs || []).slice().sort(function(a, b){
                if(a.live !== b.live){ return a.live ? -1 : 1; }
                return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
            });
        }, function(problem){
            $scope.orgSessions.loading = false;
            $scope.orgSessions.error = (problem && problem.message) || 'Could not read the org list.';
        });
    };

    $scope.expiredOrgCount = function(){
        return ($scope.orgSessions.list || []).filter(function(org){
            return org && !org.live;
        }).length;
    };

    /*
     * Signing in again is the browser's job.
     *
     * Opening the org is the whole of it: Salesforce takes the credentials,
     * the browser keeps the cookie, and this extension learns the session is
     * back the next time it looks. It has no password and wants none - a
     * form here that asked for one would be the single worst thing in it.
     */
    $scope.signInToOrg = function(org){
        if(!org || !org.origin){ return; }
        try{ window.open(org.origin, '_blank', 'noopener'); }catch(e){}
    };

    $scope.loadSync = function(){
        $scope.sync.loading = true;
        $scope.sync.error = '';
        $scope.sync.errorCode = null;
        /*
         * syncFromOrigin is a function declaration below this one, so it is
         * hoisted and callable here. The org goes with the request because
         * every pipeline comes back described from where the user is
         * standing - which end is the source is the thing worth knowing
         * before pressing a button that deploys one org over another.
         */
        $scope.sync.here = syncFromOrigin();
        /* Read alongside the pipelines: a session that went between one visit
         * and the next is the thing this list exists to show. */
        $scope.loadOrgSessions();
        /*
         * How much is ticked, read once here rather than from the template.
         *
         * Send selection and Validate only are offered on the strength of
         * this, and the buttons are per pipeline - so a function in the
         * binding would walk the whole selection once per row per digest.
         * The selection cannot change while this page is open: the metadata
         * lists are not on screen, and opening this page runs loadSync.
         */
        $scope.sync.selected = syncSelectedComponents().length;
        /*
         * The record basket, read the same way and for the same reason: Send
         * records is offered on the strength of it, per pipeline row.
         */
        $scope.sync.selectedRecords = $scope.selectedDataForDownload.size;
        return PipelineService.state($scope.sync.here).then(function(answer){
            $scope.sync.loading = false;
            if(!answer || !answer.ok){
                syncFailed(answer, 'Sync is unavailable.');
                return;
            }
            shapeSync(answer);
        }, function(problem){
            $scope.sync.loading = false;
            syncFailed(problem, 'Sync is unavailable.');
        });
    };

    /* ---------------------------- pipelines --------------------------- */

    $scope.syncNewPipeline = function(){
        $scope.sync.notice = '';
        $scope.sync.draft = {
            id: null,
            a: { origin: '', label: '' },
            b: { origin: '', label: '' },
            direction: 'both',
            testLevel: 'NoTestRun',
            enabled: true
        };
    };

    $scope.syncEditPipeline = function(pipeline){
        $scope.sync.notice = '';
        $scope.sync.draft = angular.copy(pipeline);
    };

    $scope.syncCancelPipeline = function(){
        $scope.sync.draft = null;
    };

    /*
     * The label is taken from the picked org rather than typed, so that the
     * two ends of a pipeline are named the same way everywhere they appear -
     * in the pipeline row, in a job, and in the failure that mentions one of
     * them by name.
     */
    $scope.syncPickOrg = function(end){
        var draft = $scope.sync.draft;
        if(!draft || !draft[end]){ return; }
        var chosen = $scope.sync.orgs.filter(function(org){
            return org.origin === draft[end].origin;
        })[0];
        draft[end].label = chosen ? chosen.label : '';
    };

    $scope.syncSavePipeline = function(){
        var draft = $scope.sync.draft;
        if(!draft){ return; }
        $scope.sync.error = '';
        $scope.sync.errorCode = null;
        return PipelineService.savePipeline(draft).then(function(answer){
            if(!answer || !answer.ok){
                $scope.sync.error = (answer && answer.error) || 'That pipeline could not be saved.';
                return;
            }
            $scope.sync.draft = null;
            $scope.sync.notice = 'Pipeline saved.';
            /*
             * Reloaded rather than taking the list the save handed back: that
             * list is the stored one, and what this screen shows is each
             * pipeline described from the current org. Assigning it directly
             * drops the highlighting until something else refreshes.
             */
            return $scope.loadSync();
        }, function(problem){
            $scope.sync.error = (problem && problem.message) || 'That pipeline could not be saved.';
        });
    };

    $scope.syncDeletePipeline = function(pipeline){
        if(!pipeline || !pipeline.id){ return; }
        return PipelineService.deletePipeline(pipeline.id).then(function(answer){
            if(answer && answer.ok){
                $scope.sync.notice = 'Pipeline removed. Its jobs are still in the history.';
                return $scope.loadSync();
            }
        });
    };

    /*
     * How often this pipeline has carried something.
     *
     * Read from the pipeline's own tally rather than counted from the job
     * list: that list is capped at a hundred and either Clear all empties
     * half of it, so a count taken from it would fall every time somebody
     * tidied up. Blank until it has been used, because "0 runs" on a new
     * pipeline is noise.
     */
    $scope.syncUsageLine = function(pipeline){
        var usage = (pipeline && pipeline.usage) || {};
        if(!usage.runs){ return ''; }

        var parts = [usage.runs + ' run' + (usage.runs === 1 ? '' : 's')];
        if(usage.succeeded){ parts.push(usage.succeeded + ' succeeded'); }
        if(usage.failed){ parts.push(usage.failed + ' failed'); }
        return parts.join(', ');
    };

    /*
     * A pipeline that has run and has never once succeeded.
     *
     * "13 runs, 13 failed" set in the same grey as "57 runs, 27 succeeded"
     * reads as ordinary usage at a glance, and it is the opposite: a pipeline
     * where every attempt failed is usually one wrong setting rather than
     * thirteen unrelated accidents, and it is worth noticing before the
     * fourteenth.
     *
     * Strict on purpose. Runs counts more than succeeded and failed together
     * - a job can still be staged - so this asks that every run be accounted
     * for by a failure, not merely that failures outnumber successes.
     */
    $scope.syncAllFailed = function(pipeline){
        var usage = (pipeline && pipeline.usage) || {};
        return !!usage.runs && !usage.succeeded && usage.failed === usage.runs;
    };

    $scope.syncPipelineLine = function(pipeline){
        if(!pipeline){ return ''; }
        var arrow = pipeline.direction === 'both' ? ' ↔ '
                  : pipeline.direction === 'b-to-a' ? ' ← ' : ' → ';
        return ((pipeline.a && pipeline.a.label) || '?') + arrow +
               ((pipeline.b && pipeline.b.label) || '?');
    };

    /* The org this panel is acting as, without the scheme - the same shape
     * the pipeline labels are in, so the two can be compared by eye. */
    $scope.syncHereLabel = function(){
        return String(($scope.sync && $scope.sync.here) || '')
            .replace(/^https?:\/\//, '');
    };

    /*
     * When this surface cannot send anything, and the full page could.
     *
     * The injected panel has no org picker: it acts as the org whose page it
     * is sitting on, and nothing else. So an org signed in through the
     * overlay can be a pipeline's sender and still be unreachable from here,
     * and a pipeline built against my.salesforce.com is no more reachable
     * from that org's own Lightning page - ssSyncRoute matches the origin
     * exactly, and those are two different origins.
     *
     * simplified.html does have the picker, which is the whole of the fix:
     * it can be pointed at either end of any pipeline. Saying so is worth
     * more than the row-by-row "that org is not part of this pipeline",
     * which explains the refusal without offering anywhere to go.
     *
     * Only when no pipeline can send from here. A panel that can do the job
     * says nothing - this is an answer to being stuck, not an advert.
     */
    $scope.syncNeedsFullPage = function(){
        if($scope.isStandalonePage){ return false; }
        var pipelines = ($scope.sync && $scope.sync.pipelines) || [];
        if(!pipelines.length){ return false; }
        for(var i = 0; i < pipelines.length; i++){
            if(pipelines[i] && pipelines[i].here && pipelines[i].here.canSend){
                return false;
            }
        }
        return true;
    };

    /* ------------------------------ staging --------------------------- */

    /*
     * What is ticked, as components.
     *
     * This is the same selection package.xml is built from - one place where
     * the user has already said which components they mean, rather than a
     * second list to keep in step with the first.
     */
    function syncSelectedComponents(){
        var components = [];
        if(!$scope.packageMetaTypeAndName){ return components; }
        $scope.packageMetaTypeAndName.forEach(function(members, type){
            members.forEach(function(member){
                if(member){ components.push({ type: type, name: member }); }
            });
        });
        return components;
    }

    /*
     * There is deliberately no syncSelectionCount() on the scope.
     *
     * The count the page shows and the condition the buttons appear under are
     * one number, held as sync.selected and read once per load. Two ways to
     * ask the same question is how a heading came to disagree with the rows
     * underneath it on the metadata screens.
     */

    /*
     * The org this selection came from.
     *
     * On an org page that is the page's own org. On simplified.html it is
     * whichever org was chosen in the picker, which is what SS_ORIGIN points
     * at there - so both surfaces answer the same way.
     */
    function syncFromOrigin(){
        try{ return new URL(SS_ORIGIN).origin; }catch(e){ return SS_ORIGIN; }
    }

    $scope.syncStage = function(pipeline, checkOnly){
        if(!pipeline){ return; }
        $scope.sync.error = '';
        $scope.sync.errorCode = null;
        $scope.sync.notice = '';

        var components = syncSelectedComponents();
        if(!components.length){
            $scope.sync.error = 'Nothing is ticked. Choose components in the metadata lists ' +
                                'first - this sends the same selection package.xml is built from.';
            return;
        }

        return PipelineService.stage({
            pipelineId: pipeline.id,
            fromOrigin: syncFromOrigin(),
            components: components,
            apiVersion: (typeof SS_API_VERSION !== 'undefined') ? SS_API_VERSION : null,
            checkOnly: !!checkOnly
        }).then(function(answer){
            if(!answer || !answer.ok){
                $scope.sync.error = (answer && answer.error) || 'That could not be staged.';
                return;
            }
            $scope.sync.notice = checkOnly
                ? 'Staged as a validation. Nothing will be written until you run it.'
                : 'Staged. Review it below, then Apply to deploy.';
            if(typeof ssCountUse === 'function'){ ssCountUse('syncStaged', 1); }
            return $scope.loadSync();
        }, function(problem){
            $scope.sync.error = (problem && problem.message) || 'That could not be staged.';
        });
    };

    /* --------------------------- records ------------------------------ */

    /*
     * Sending records rather than components.
     *
     * The whole difference is the key. Metadata is matched by name and the
     * name is the same in both orgs; a record has no such thing, so the user
     * nominates a field that means the same row in both - and Salesforce will
     * only match on an External Id, so the choices come from the target org's
     * describe rather than from a text box.
     */
    $scope.syncData = {
        open: false,
        objectApiName: '',
        keyField: '',
        query: '',
        keys: [],
        types: [],
        keyAuth: null,
        loadingKeys: false,
        keyError: '',
        pipeline: null
    };

    /*
     * The ticked records, grouped by object.
     *
     * A basket is kept across objects, so it can hold Accounts and Invoices
     * at once. A job carries one object, so the form asks which - and when
     * there is only one in the basket, it does not need to ask.
     */
    function syncSelectedRecordsByType(){
        var byType = Object.create(null);
        $scope.selectedDataForDownload.forEach(function(record, id){
            var type = (record && record.attributes && record.attributes.type) || null;
            if(!type || !id){ return; }
            (byType[type] = byType[type] || []).push(id);
        });
        return byType;
    }

    $scope.syncRecordTypes = function(){
        return Object.keys(syncSelectedRecordsByType());
    };

    $scope.syncOpenData = function(pipeline){
        $scope.sync.error = '';
        $scope.sync.errorCode = null;
        $scope.sync.notice = '';
        if($scope.syncData.open && $scope.syncData.pipeline === pipeline.id){
            $scope.syncData.open = false;
            return;
        }
        $scope.syncData.open = true;
        $scope.syncData.pipeline = pipeline.id;
        $scope.syncData.keys = [];
        $scope.syncData.keyField = '';
        $scope.syncData.keyError = '';

        /*
         * Opened from a basket, so the object it holds is the object being
         * sent. Only when the basket is all one object - otherwise which one
         * is a real question, and guessing it would send the wrong rows.
         */
        var types = $scope.syncRecordTypes();
        $scope.syncData.types = types;
        if(types.length === 1){
            $scope.syncData.objectApiName = types[0];
            $scope.syncLoadKeys();
        }
    };

    /*
     * Ask the target org what it can match on. Nothing is offered until it
     * answers: a key this org does not accept is a job that can only fail,
     * and finding that out at write time is the whole problem being avoided.
     */
    $scope.syncLoadKeys = function(){
        var form = $scope.syncData;
        if(!form.objectApiName || !form.pipeline){ return; }

        form.loadingKeys = true;
        form.keyError = '';
        form.keyAuth = null;
        form.keys = [];

        return PipelineService.keyChoices({
            pipelineId: form.pipeline,
            fromOrigin: syncFromOrigin(),
            objectApiName: form.objectApiName,
            apiVersion: (typeof SS_API_VERSION !== 'undefined') ? SS_API_VERSION : null
        }).then(function(answer){
            form.loadingKeys = false;
            if(!answer || !answer.ok){
                form.keyError = (answer && answer.error) || 'That object could not be described.';
                /*
                 * A session problem is a sign-in, and the org that needs it is
                 * not the one on screen - so the org is held here and the
                 * panel offers a way back to it, rather than showing a red
                 * line with nothing to do about it.
                 */
                form.keyAuth = (answer && answer.needsAuth && answer.org) || null;
                return;
            }
            form.keyAuth = null;
            form.keys = answer.keys || [];
            form.keyField = answer.remembered ||
                (form.keys.length === 1 ? form.keys[0].name : '');
            if(!form.keys.length){
                form.keyError = 'No field on ' + form.objectApiName + ' can identify a ' +
                    'record in ' + ((answer.target && answer.target.label) || 'the target org') +
                    ' - there is nothing on it that can be filtered on.';
                return;
            }
            if(!form.query){ $scope.syncSuggestQuery(); }
        }, function(problem){
            form.loadingKeys = false;
            form.keyError = (problem && problem.message) || 'That object could not be described.';
        });
    };

    /*
     * A starting query, not a finished one. It selects the key and nothing
     * else, because which fields to carry is the user's decision and a
     * generated SELECT of everything writable would be a long line nobody
     * reads before pressing a button that writes to another org.
     */
    /*
     * A starting query, not a finished one.
     *
     * Restricted to the ticked records by Id, because those are the records
     * the user chose - a query that quietly widened to every row of the
     * object would send far more than was asked for, into another org.
     * Editable afterwards, like every other query on this screen.
     */
    $scope.syncSuggestQuery = function(){
        var form = $scope.syncData;
        if(!form.objectApiName || !form.keyField){ return; }

        var ids = syncSelectedRecordsByType()[form.objectApiName] || [];
        var where = ids.length
            ? "Id IN ('" + ids.join("','") + "')"
            : form.keyField + ' != null';

        /*
         * FIELDS(ALL), not a field list.
         *
         * A record that has no counterpart in the target is created, and a
         * query that selected only the key created it empty - a row with an
         * External Id and nothing else in it. Asking for everything is the
         * only way to carry a record without knowing in advance what is on
         * it, and ssSyncDataPayload drops whatever cannot be written.
         *
         * The org caps FIELDS(ALL) at 200 rows, which happens to be the same
         * 200 a job carries - so the limit is not an extra restriction here,
         * it is the same one said once.
         */
        form.query = 'SELECT FIELDS(ALL)' +
            ' FROM ' + form.objectApiName +
            ' WHERE ' + where +
            ' LIMIT ' + ($scope.sync.dataLimit || 200);
    };

    /*
     * How a chosen key will be honoured, said in the list rather than left to
     * be discovered. The two modes behave differently enough that which one
     * is in play is part of the choice: an upsert is one atomic call the org
     * performs, a lookup is a query followed by a write, and it can refuse
     * the whole job if the key turns out not to identify records.
     */
    $scope.syncKeyLabel = function(key){
        if(!key){ return ''; }
        if(key.mode === 'insert'){ return key.label; }
        var how = key.mode === 'upsert'
            ? 'External Id - the org matches'
            : (key.unique ? 'unique - looked up in the target'
                          : 'looked up in the target');
        return key.label + ' (' + key.name + ') - ' + how;
    };

    $scope.syncChosenKey = function(){
        var form = $scope.syncData;
        return (form.keys || []).filter(function(k){ return k.name === form.keyField; })[0] || null;
    };

    $scope.syncStageData = function(){
        var form = $scope.syncData;
        $scope.sync.error = '';
        $scope.sync.errorCode = null;
        $scope.sync.notice = '';

        return PipelineService.stageData({
            pipelineId: form.pipeline,
            fromOrigin: syncFromOrigin(),
            objectApiName: form.objectApiName,
            keyField: form.keyField,
            query: form.query,
            apiVersion: (typeof SS_API_VERSION !== 'undefined') ? SS_API_VERSION : null
        }).then(function(answer){
            if(!answer || !answer.ok){
                $scope.sync.error = (answer && answer.error) || 'That could not be staged.';
                return;
            }
            $scope.syncData.open = false;
            $scope.sync.notice = 'Staged. Review it below, then Apply to write the records.';
            if(typeof ssCountUse === 'function'){ ssCountUse('syncDataStaged', 1); }
            return $scope.loadSync();
        }, function(problem){
            $scope.sync.error = (problem && problem.message) || 'That could not be staged.';
        });
    };

    /* ------------------------------- jobs ----------------------------- */

    $scope.syncToggleJob = function(job){
        if(!job){ return; }
        $scope.sync.openJob = ($scope.sync.openJob === job.id) ? null : job.id;
    };

    /*
     * What a run actually put into the other org.
     *
     * Counted from the finished job rather than from the press, because the
     * press says only that somebody tried. A deploy that failed moved
     * nothing, and a job that moved four hundred records is not the same
     * event as one that moved one.
     */
    function syncCountOutcome(answer){
        var done = answer && answer.job;
        if(!done || done.state !== 'succeeded'){ return; }
        var result = done.result || {};

        if(done.kind === 'data'){
            if(typeof ssCountUse === 'function'){
                ssCountUse('recordsWritten', Number(result.upserted) || 0);
            }
            return;
        }
        /* A validation deployed nothing - it only proved it could. */
        if(result.checkOnly){ return; }
        if(typeof ssCountUse === 'function'){
            ssCountUse('componentsDeployed', Number(result.deployed) || 0);
        }
    }

    /* ----------------------------------------------------------------- */
    /* Watching a job run                                                 */
    /*                                                                    */
    /* The run happens in the service worker and the call the panel is    */
    /* waiting on does not come back until the end - so progress is read  */
    /* from the job record, which the worker updates as it goes. That     */
    /* also means a worker killed mid-deploy does not stop the view: the  */
    /* alarm resumes the poll and keeps writing to the same place.        */
    /* ----------------------------------------------------------------- */

    $scope.syncRun = { open: false, job: null, outcome: null, error: '' };

    /*
     * Staged jobs, put in front of the user rather than left in a section.
     *
     * A job waiting for review is the one thing on this page that stops
     * unless somebody acts, and a section can be scrolled past - which is
     * how a staged deploy sits there for a week.
     *
     * Dismissing is remembered per job for the life of the panel, so the
     * modal appears when there is something new to decide and not every time
     * the page is opened. The section stays exactly as it is: this is a
     * second way to reach those jobs, not the only one.
     */
    $scope.syncReview = { open: false, jobs: [], seen: {} };
    var syncWatch = null;

    function syncStopWatching(){
        if(syncWatch){ $interval.cancel(syncWatch); syncWatch = null; }
    }

    function syncStartWatching(jobId){
        syncStopWatching();
        /*
         * Two seconds: fast enough to look live, slow enough that a deploy
         * lasting twenty minutes is not six hundred reads of the same record.
         */
        syncWatch = $interval(function(){
            PipelineService.state($scope.sync.here).then(function(answer){
                if(!answer || !answer.ok){ return; }
                var fresh = (answer.jobs || []).filter(function(entry){
                    return entry && entry.id === jobId;
                })[0];
                if(fresh){ $scope.syncRun.job = fresh; }
            });
        }, 2000);
    }

    $scope.syncCloseRun = function(){
        syncStopWatching();
        $scope.syncRun.open = false;
        $scope.syncRun.job = null;
        $scope.syncRun.outcome = null;
        $scope.syncRun.error = '';
    };

    /* Nothing left running when the panel goes away. */
    $scope.$on('$destroy', syncStopWatching);

    /*
     * One line saying what the org is doing, from whichever stage wrote it.
     */
    $scope.syncRunStage = function(){
        var job = $scope.syncRun.job;
        var progress = (job && job.progress) || null;
        if($scope.syncRun.outcome){ return null; }
        if(!progress){ return 'Starting…'; }
        if(progress.note){ return progress.note; }
        if(progress.stage === 'deploy'){
            return 'Deploying to ' + ((job.target && job.target.label) || 'the target org') + '.';
        }
        return 'Working…';
    };

    /* How far through, as a percentage, when the org has said. */
    $scope.syncRunPercent = function(){
        var progress = ($scope.syncRun.job && $scope.syncRun.job.progress) || null;
        if(!progress || !progress.total){ return 0; }
        return Math.min(100, Math.round((progress.done || 0) / progress.total * 100));
    };

    function runJob(job, how, label){
        if(!job){ return; }
        $scope.sync.error = '';
        $scope.sync.errorCode = null;
        $scope.sync.notice = '';
        $scope.sync.busyJob = job.id;

        /* One modal at a time: the run takes the place of the review. */
        $scope.syncReview.open = false;
        $scope.syncRun = { open: true, job: job, outcome: null, error: '' };
        syncStartWatching(job.id);

        return how(job.id).then(function(answer){
            $scope.sync.busyJob = null;
            syncStopWatching();
            $scope.syncRun.job = (answer && answer.job) || $scope.syncRun.job;
            $scope.syncRun.outcome = (answer && answer.state) || 'failed';
            $scope.syncRun.error = (answer && !answer.ok && answer.error) || '';
            if(answer && answer.error && !answer.ok && !answer.job){
                $scope.sync.error = answer.error;
            }
            if(typeof ssCountUse === 'function'){ ssCountUse(label, 1); }
            syncCountOutcome(answer);
            return $scope.loadSync();
        }, function(problem){
            $scope.sync.busyJob = null;
            syncStopWatching();
            $scope.syncRun.outcome = 'unknown';
            $scope.syncRun.error = (problem && problem.message) || '';
            /*
             * The worker not answering does not mean the deploy did not
             * happen - it is running in the org either way, and the sweep
             * will report it. Saying "failed" here would be a guess.
             */
            $scope.sync.error = (problem && problem.message) ||
                'Lost contact with the background worker. The job may still be running - ' +
                'reopen this page in a minute.';
            return $scope.loadSync();
        });
    }

    $scope.syncApply = function(job){
        return runJob(job, PipelineService.apply, 'syncApplied');
    };

    $scope.syncRetry = function(job){
        return runJob(job, PipelineService.retry, 'syncRetried');
    };

    /*
     * Deploy a validation the org has already done.
     *
     * Runs on the press rather than staging first. What would be reviewed has
     * been: these are the components of a job that was staged, reviewed, and
     * then verified against the very org that is about to receive them - and
     * the whole value of a quick deploy is that it happens now, inside a
     * window somebody is watching.
     */
    $scope.syncQuickDeploy = function(job){
        return runJob(job, PipelineService.quickDeploy, 'syncQuickDeployed');
    };

    /*
     * Whether a validation is still one the org will accept. Kept here rather
     * than recomputed in the template: it is a comparison against the clock,
     * and a binding that reads the clock never settles.
     */
    $scope.syncQuickDeployable = function(job){
        return $scope.syncQuickBlocker(job) === null;
    };

    /*
     * Why a validation is not offered a quick deploy.
     *
     * The reason rather than a bare no: the commonest case is a validation
     * that ran no tests, which the org will not deploy and which has a fix
     * nobody would guess. Offering the button anyway - which it did - meant
     * pressing it produced a refusal that read as the feature being broken.
     *
     * The same rules the engine applies, restated here because the panel
     * decides what to draw before the worker is asked anything. The engine
     * remains the authority: it checks again before it runs.
     */
    $scope.syncQuickBlocker = function(job){
        if(!job || job.kind === 'data' || job.state !== 'succeeded'){ return 'not applicable'; }
        var result = job.result || {};
        if(!result.checkOnly){ return 'not applicable'; }
        if(!result.deployId){
            return 'The org\'s id for this validation was not kept, so there is nothing to ' +
                   'deploy from. Validate again.';
        }
        if(!result.testLevel || result.testLevel === 'NoTestRun'){
            return 'Validated without running tests, and the org will only quick deploy a ' +
                   'validation that ran them. Set Tests to local tests on the pipeline and ' +
                   'validate again.';
        }
        if((Date.now() - (job.updatedAt || 0)) >= $scope.sync.validationTtl){
            return 'The org only keeps a validation for ten days, and this one has expired. ' +
                   'Validate again.';
        }
        return null;
    };

    /* Only the reasons worth showing - "not applicable" means this row is not
     * a validation at all, and has nothing to explain. */
    $scope.syncQuickWhyNot = function(job){
        var why = $scope.syncQuickBlocker(job);
        return why === 'not applicable' ? null : why;
    };

    $scope.syncValidationDaysLeft = function(job){
        var gone = Date.now() - ((job && job.updatedAt) || 0);
        return Math.max(0, Math.ceil(($scope.sync.validationTtl - gone) / 86400000));
    };

    $scope.syncDiscard = function(job){
        if(!job){ return; }
        return PipelineService.discard(job.id).then(function(answer){
            if(answer && !answer.ok){ $scope.sync.error = answer.error; }
            return $scope.loadSync();
        });
    };

    /*
     * Empty a whole list.
     *
     * Two-step rather than one click: this is the only control here that
     * throws away more than one thing at a time, and the list it empties is
     * the record of what was deployed where. The confirmation is the same
     * button in a different state, so it costs a second click and no dialog.
     *
     * Nothing in either org is touched - these are local records of deploys
     * that already finished.
     */
    $scope.syncConfirmClear = function(group){
        $scope.sync.error = '';
        $scope.sync.errorCode = null;
        $scope.sync.notice = '';
        $scope.sync.clearing = ($scope.sync.clearing === group) ? null : group;
    };

    $scope.syncClear = function(group){
        $scope.sync.clearing = null;
        return PipelineService.clear(group).then(function(answer){
            if(!answer || !answer.ok){
                $scope.sync.error = (answer && answer.error) || 'That list could not be cleared.';
                return;
            }
            $scope.sync.notice = answer.removed === 1
                ? 'One job cleared from the history.'
                : answer.removed + ' jobs cleared from the history.';
            return $scope.loadSync();
        }, function(problem){
            $scope.sync.error = (problem && problem.message) || 'That list could not be cleared.';
        });
    };

    /*
     * A blocked job needs a session, and the panel already knows how to ask
     * for one. Reusing that card rather than growing a second sign-in means
     * there is one place where signing in is explained.
     */
    /*
     * Signing in to the org that actually refused.
     *
     * The panel's own card signs in to the org this page is on, which is only
     * the right answer when that is the org the job is stuck on. A pipeline's
     * other end cannot be signed in to from here at all - so that case gets a
     * link to the org instead of a button that would quietly do nothing
     * useful.
     */
    $scope.syncSignInHere = function(job){
        var origin = job && job.error && job.error.origin;
        /*
         * No origin, no offer.
         *
         * Older records - written before failures carried the org that
         * refused - do not say which end expired. Defaulting to "this org"
         * put the panel's own sign-in card on a job that was stuck on the
         * other one, which is a button that cannot help. Retry is still
         * there, and it will produce a record that does name the org.
         */
        if(!origin){ return false; }
        return origin === $scope.sync.here;
    };

    $scope.syncBlockedOrg = function(job){
        var error = (job && job.error) || {};
        if(error.label){ return error.label; }
        var end = [job && job.source, job && job.target].filter(function(side){
            return side && side.origin === error.origin;
        })[0];
        return (end && end.label) || 'the other org';
    };

    $scope.syncSignIn = function(job){
        if($scope.syncSignInHere(job)){ $scope.requestSignIn('session'); }
    };

    $scope.syncJobTitle = function(job){ return PipelineService.jobTitle(job); };
    /* Rendered as two pieces: the subject leads the row, the org it is
     * going to trails it quietly, because in a list of one pipeline's
     * history that half is identical on every line. */
    $scope.syncJobSubject = function(job){ return PipelineService.jobSubject(job); };
    $scope.syncJobTarget = function(job){ return PipelineService.jobTarget(job); };
    $scope.syncStateLabel = function(job){ return PipelineService.stateLabel(job); };
    /* Deploy, Validate or Migrate - what applying this job does, rather
     * than the machinery's word for applying it. */
    $scope.syncApplyLabel = function(job){ return PipelineService.applyLabel(job); };
    $scope.syncApplyingLabel = function(job){ return PipelineService.applyingLabel(job); };
    $scope.syncStateClass = function(job){ return PipelineService.stateClass(job); };
    $scope.syncNeedsAuth = function(job){ return PipelineService.needsAuth(job); };
    $scope.syncApplyable = function(job){ return !!job && job.state === 'staged'; };
    $scope.syncRetryable = function(job){
        return !!job && (job.state === 'failed' || job.state === 'blocked');
    };
    $scope.syncIsOpen = function(job){ return !!job && $scope.sync.openJob === job.id; };

    $scope.loadBulkJobs = function(){
        $scope.bulk.loading = true;
        $scope.bulk.error = '';
        $scope.bulk.selected = null;
        $scope.bulk.detail = null;

        return $q.all([bulkList('ingest'), bulkList('query')]).then(function(answers){
            $scope.bulk.loading = false;
            $scope.bulk.jobs = bulkJobRows(answers[0].records, answers[1].records);

            var refused = answers.filter(function(a){ return a.refused; })
                                 .map(function(a){ return a.refused; });
            if(refused.length === 2){
                $scope.bulk.error = 'Bulk jobs could not be read. This needs the ' +
                    '"Manage Data Integrations" or API Enabled permission.';
            }else if(refused.length === 1){
                // Said, because an empty half looks like an empty org.
                $scope.bulk.error = 'The ' + refused[0] + ' jobs could not be read - ' +
                    'showing the others.';
            }
        });
    };

    $scope.selectBulkJob = function(job){
        if(!job || !job.id){ return; }
        $scope.bulk.selected = job;
        $scope.bulk.detail = null;
        $scope.bulk.detailError = '';
        $scope.bulk.detailLoading = true;

        return $q.when(ssRestCall({
            url: ssApiOrigin() + '/services/data/v' + SS_API_VERSION +
                 '/jobs/' + job.kind + '/' + job.id
        })).then(function(answer){
            $scope.bulk.detailLoading = false;
            if(!answer.ok){
                $scope.bulk.detailError = 'That job could not be read (HTTP ' +
                                          answer.status + ').';
                return;
            }
            try{
                $scope.bulk.detail = JSON.parse(answer.text);
                if(typeof ssCountUse === 'function'){ ssCountUse('bulkJobsChecked', 1); }
            }catch(e){
                $scope.bulk.detailError = 'The org\'s answer could not be read.';
            }
        }, function(failure){
            $scope.bulk.detailLoading = false;
            $scope.bulk.detailError = (failure && failure.message) ||
                'That job could not be read.';
        });
    };

    /*
     * How many of the rows went in.
     *
     * Salesforce reports processed and failed separately, and processed
     * includes the failures - so the number people actually want, how many
     * landed, is not in the response and has to be worked out.
     */
    $scope.bulkSucceeded = function(detail){
        if(!detail){ return 0; }
        var processed = Number(detail.numberRecordsProcessed) || 0;
        var failed = Number(detail.numberRecordsFailed) || 0;
        return Math.max(0, processed - failed);
    };

    /* ----------------------------------------------------------------- */
    /* REST Explorer                                                       */
    /*                                                                     */
    /* A path and a method, sent to this org. Not a URL: a box that took    */
    /* one would send the session wherever it was pointed, and the first    */
    /* mistyped host would be a credential leak rather than a 404.          */
    /* ----------------------------------------------------------------- */

    $scope.restMethods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

    $scope.rest = {
        method: 'GET',
        path: '/services/data/v' + SS_API_VERSION + '/limits',
        body: '',
        running: false,
        status: 0,
        statusText: '',
        response: '',
        /* The followable paths in the last answer, worked out when it
         * arrives - see restLinksIn. */
        links: [],
        /* Narrows the row when an answer mentions more paths than fit. */
        linkFilter: '',
        error: '',
        ms: 0
    };

    /*
     * A few starting points, because an empty box needs you to already know
     * the shape of the answer to ask for it.
     */
    $scope.restSamples = [
        { label: 'Org limits', method: 'GET', path: '/services/data/v{v}/limits' },
        { label: 'All objects', method: 'GET', path: '/services/data/v{v}/sobjects' },
        { label: 'Describe Account', method: 'GET', path: '/services/data/v{v}/sobjects/Account/describe' },
        { label: 'API versions', method: 'GET', path: '/services/data' },
        { label: 'Who am I', method: 'GET', path: '/services/oauth2/userinfo' },
        { label: 'Recent items', method: 'GET', path: '/services/data/v{v}/recent' }
    ];

    /* ----------------------------------------------------------------- */
    /* The org's own REST surface                                          */
    /*                                                                     */
    /* Asked of the org rather than written down here. GET on the version   */
    /* root returns the resources this org actually advertises, which is    */
    /* the honest answer to "what can I call" - a list in this file would   */
    /* be this extension's idea of Salesforce, drifting a little further    */
    /* from the org with every release, and identical on an org that has    */
    /* half of them switched off.                                           */
    /* ----------------------------------------------------------------- */

    /*
     * The endpoints every Salesforce org has, whatever the version root says.
     *
     * The org's own list is better - it names what this org actually offers,
     * including whatever is switched on that this extension has never heard
     * of - but it needs a session and a reachable API host, and when it
     * cannot be had the useful thing is still a list rather than a sentence
     * explaining that there is not one. These are the resources that exist on
     * every org and are worth a click.
     *
     * Paths are relative to the version root and resolved against it, so this
     * does not carry an API version that would go stale.
     */
    var REST_BASELINE = [
        { name: 'sobjects',   suffix: '/sobjects' },
        { name: 'query',      suffix: '/query/?q=SELECT+Id+FROM+Account+LIMIT+5' },
        { name: 'queryAll',   suffix: '/queryAll/?q=SELECT+Id+FROM+Account+LIMIT+5' },
        { name: 'search',     suffix: '/search/?q=FIND+%7BAcme%7D' },
        { name: 'limits',     suffix: '/limits' },
        { name: 'recent',     suffix: '/recent' },
        { name: 'composite',  suffix: '/composite' },
        { name: 'tooling',    suffix: '/tooling/sobjects' },
        { name: 'jobs/ingest', suffix: '/jobs/ingest' }
    ];

    $scope.restResources = { loading: false, error: '', list: [], fromOrg: false };

    /*
     * The literal, not a $scope alias. There is no $scope.restexplorer -
     * audittrail has one and this does not - so comparing against it is
     * comparing against undefined, which matches any page whose value is
     * also undefined. The template gates on the same literal.
     */
    function baselineResources(){
        var base = '/services/data/v' + SS_API_VERSION;
        return REST_BASELINE.map(function(item){
            return { name: item.name, path: base + item.suffix };
        });
    }

    $scope.isRestExplorerPage = function(){
        return !!($scope.selectedMetadata &&
                  $scope.selectedMetadata.value === 'RestExplorer');
    };

    $scope.loadRestResources = function(force){
        var state = $scope.restResources;
        /* Once per session unless asked again: the version root does not
         * change while the panel is open, and it is one more call against
         * the org's API limit every time this page is opened. */
        if(state.loading || (state.list.length && !force)){ return; }

        state.loading = true;
        state.error = '';

        /*
         * Absolute, via ssRestBase.
         *
         * A relative path here resolved against the page's own origin, which
         * on a Lightning page is lightning.force.com and not the API host -
         * so the request went somewhere with no such resource and the card
         * reported that the org would not list them. It answered fine; it was
         * never asked. ssRestBase is what every other call in this extension
         * builds on, and it also follows a typed-in session to the org it
         * came from.
         */
        return $q.when(sfdc.get(ssRestBase() + '/'))
            .then(function(answer){
                state.loading = false;
                var found = [];
                Object.keys(answer || {}).forEach(function(name){
                    var path = answer[name];
                    /* Only the string entries are paths. Some versions carry
                     * nested objects, and a path of "[object Object]" in the
                     * box is worse than the row not being offered. */
                    if(typeof path === 'string' && path.charAt(0) === '/'){
                        found.push({ name: name, path: path });
                    }
                });
                /*
                 * The org's list, plus anything in the baseline it did not
                 * mention. The version root does not advertise every callable
                 * resource - Bulk ingest and the tooling sobjects are two it
                 * omits on most orgs - so a list built only from it is
                 * shorter than what the org will actually answer.
                 */
                var seen = Object.create(null);
                found.forEach(function(item){ seen[item.name] = true; });
                baselineResources().forEach(function(item){
                    if(!seen[item.name]){ found.push(item); }
                });

                found.sort(function(a, b){ return a.name.localeCompare(b.name); });
                state.list = found;
                state.fromOrg = true;
            }, function(err){
                state.loading = false;
                /*
                 * Still a list. The org's own is better and this is what
                 * there is without it - a card explaining that nothing could
                 * be read is a card with nothing to click, on a page whose
                 * whole purpose is having something to click.
                 */
                state.list = baselineResources();
                state.fromOrg = false;
                state.error = sfdc.errorMessage(err, 'REST resources') ||
                              'Could not read this org\'s own list - showing the ' +
                              'endpoints every org has.';
            });
    };

    /*
     * Put a resource in the path box.
     *
     * GET, and no body: every one of these is a collection or a description,
     * and carrying over the method and payload from whatever was tried last
     * would post the previous call's data to this one's endpoint. The same
     * reasoning the sample chips already use.
     */
    $scope.useRestResource = function(resource){
        if(!resource || !resource.path){ return; }
        $scope.rest.method = 'GET';
        $scope.rest.path = resource.path;
        $scope.rest.body = '';
    };

    $scope.useRestSample = function(sample){
        if(!sample){ return; }
        $scope.rest.method = sample.method;
        $scope.rest.path = sample.path.replace('{v}', SS_API_VERSION);
        // The body belongs to the sample that had one; leaving it would post
        // the previous sample's payload to this one's endpoint.
        $scope.rest.body = sample.body || '';
    };

    /*
     * A path, made absolute against this org and nothing else.
     *
     * Anything with a scheme is refused rather than corrected: "https://..."
     * in this box means the user meant another host, and quietly rewriting it
     * to this one would answer a question they did not ask.
     */
    function restUrl(path){
        var typed = String(path || '').trim();
        if(!typed){ return { error: 'Enter a path, such as /services/data/v' + SS_API_VERSION + '/limits' }; }
        if(/^[a-z][a-z0-9+.-]*:/i.test(typed)){
            return { error: 'Paths only - this always goes to the org you are signed in to. ' +
                            'Drop the https://host part and keep what follows it.' };
        }
        return { url: ssApiOrigin() + (typed.charAt(0) === '/' ? typed : '/' + typed) };
    }
    $scope.restUrl = restUrl;

    // GET and DELETE have no body, and sending one is how a 400 arrives with
    // a message about JSON rather than about the request.
    $scope.restTakesBody = function(){
        return $scope.rest.method !== 'GET' && $scope.rest.method !== 'DELETE';
    };

    /* ----------------------------------------------------------------- */
    /* Following what came back                                            */
    /*                                                                     */
    /* Most REST answers here are indexes: a resource root returns paths to */
    /* its children, and reading one only to retype part of it into the box */
    /* above is the whole loop this page exists to remove.                  */
    /* ----------------------------------------------------------------- */

    /*
     * Two ceilings, for two different problems.
     *
     * /sobjects names every object in the org with a url apiece, so an answer
     * can mention hundreds. Rendering them all is a wall between the reader
     * and the response underneath; collecting none of them past the first
     * few is worse, because then the one you want is simply not there and
     * nothing says so.
     *
     * So: collect up to MAX and show SHOWN of them, with a filter to reach
     * the rest and a count that admits what is not on screen. Truncating
     * silently at forty was the version of this that looked tidy and lied.
     */
    var REST_LINK_MAX = 500;
    $scope.restLinkShown = 40;

    /*
     * The paths in a response body.
     *
     * Read off the text rather than the parsed object on purpose: a refusal
     * is shown here too and is not always JSON, and a body that failed to
     * parse is exactly when a path in it is worth being able to click.
     *
     * Deduplicated, because an index that lists the same root under two names
     * is common and the same chip twice is noise.
     */
    function restLinksIn(text){
        var found = [];
        var seen = Object.create(null);
        if(!text){ return found; }

        var pattern = /"(\/services\/[A-Za-z0-9_\-.\/]*)"/g;
        var match;
        while((match = pattern.exec(text)) !== null){
            var path = match[1];
            /* The path just requested is not somewhere to go next. */
            if(path === $scope.rest.path || seen[path]){ continue; }
            seen[path] = true;
            found.push({ path: path, label: restLinkLabel(path) });
            if(found.length >= REST_LINK_MAX){
                /* Said, not swallowed. A body with more paths than this is
                 * rare and the reader should know the row is a sample of it
                 * rather than the whole. */
                found.truncated = true;
                break;
            }
        }
        return found;
    }

    /*
     * The last meaningful segment, which is what tells one apart from
     * another. Whole paths share a long prefix, so a row of them is a row of
     * /services/data/v67.0/ with the useful word cut off the right edge.
     */
    function restLinkLabel(path){
        var parts = String(path).split('/').filter(Boolean);
        if(!parts.length){ return path; }
        var last = parts[parts.length - 1];
        /* A trailing version is not a name - keep the segment before it. */
        if(/^v?\d+\.\d+$/.test(last) && parts.length > 1){
            last = parts[parts.length - 2] + '/' + last;
        }
        return last;
    }

    /*
     * Follow one. GET and no body, for the reason the sample chips and the
     * rail already use: this is a link, and carrying the last call's method
     * and payload over would post it to somewhere that was only mentioned.
     */
    /*
     * How many of them match what is typed, so the row can say what it is not
     * showing. Counted here rather than in a binding: the same array filtered
     * twice per digest is the cost this page does not need.
     */
    $scope.restLinksMatching = function(){
        var links = ($scope.rest && $scope.rest.links) || [];
        var wanted = String(($scope.rest && $scope.rest.linkFilter) || '')
            .toLowerCase().trim();
        if(!wanted){ return links.length; }

        var count = 0;
        for(var i = 0; i < links.length; i++){
            if(String(links[i].path).toLowerCase().indexOf(wanted) !== -1){ count++; }
        }
        return count;
    };

    /* Whether there is more than the row is showing - the only reason to put
     * a filter box in front of somebody. */
    $scope.restLinksOverflow = function(){
        return $scope.restLinksMatching() > $scope.restLinkShown;
    };

    $scope.followRestLink = function(link){
        if(!link || !link.path){ return; }
        $scope.rest.method = 'GET';
        $scope.rest.path = link.path;
        $scope.rest.body = '';
    };

    $scope.sendRest = function(){
        var target = restUrl($scope.rest.path);
        if(target.error){
            $scope.rest.error = target.error;
            $scope.rest.response = '';
            $scope.rest.links = [];
            $scope.rest.status = 0;
            return;
        }

        var payload = null;
        if($scope.restTakesBody() && $scope.rest.body.trim()){
            try{
                payload = JSON.parse($scope.rest.body);
            }catch(e){
                // Caught here rather than sent: the org would refuse it with a
                // parser error about its own copy, which says less.
                $scope.rest.error = 'The body is not valid JSON: ' + e.message;
                $scope.rest.response = '';
                $scope.rest.links = [];
                $scope.rest.status = 0;
                return;
            }
        }

        $scope.rest.running = true;
        $scope.rest.error = '';
        $scope.rest.response = '';
        $scope.rest.links = [];
        var started = Date.now();

        return $q.when(ssRestCall({
            url: target.url,
            method: $scope.rest.method,
            body: payload
        })).then(function(answer){
            $scope.rest.running = false;
            $scope.rest.ms = Date.now() - started;
            $scope.rest.status = answer.status;
            $scope.rest.statusText = answer.ok ? 'OK' : 'Refused';
            $scope.rest.response = formatRest(answer.text);
            /*
             * Worked out once, here, rather than in the binding: a function
             * in an ng-repeat returns a fresh array every digest and never
             * settles, which is the infinite-digest this codebase has hit
             * more than once.
             */
            $scope.rest.links = restLinksIn($scope.rest.response);
            /* A filter left over from the last answer would hide paths in
             * this one, with the box scrolled out of sight above. */
            $scope.rest.linkFilter = '';
            if(typeof ssCountUse === 'function'){ ssCountUse('restCalls', 1); }
            // A refusal is an answer, not a failure - it is shown in the body
            // where its own message is, rather than replaced by ours.
            $scope.rest.error = '';
        }, function(failure){
            $scope.rest.running = false;
            $scope.rest.ms = Date.now() - started;
            $scope.rest.status = 0;
            $scope.rest.statusText = '';
            $scope.rest.response = '';
            $scope.rest.error = (failure && failure.message) ||
                'The request could not be sent.';
        });
    };

    /*
     * Pretty when it parses, verbatim when it does not.
     *
     * An HTML error page or an empty 204 is still what the org said, and
     * replacing it with "could not parse" throws away the only evidence.
     */
    function formatRest(text){
        if(!text){ return '(no content)'; }
        try{
            return JSON.stringify(JSON.parse(text), null, 2);
        }catch(e){
            return String(text);
        }
    }
    $scope.formatRest = formatRest;

    $scope.copyRestResponse = function(){
        if(!$scope.rest.response){ return; }
        $scope.restCopied = true;
        $timeout(function(){ $scope.restCopied = false; }, 1600);
        try{
            navigator.clipboard.writeText($scope.rest.response);
        }catch(e){ /* the response is on screen either way */ }
    };

    /* ----------------------------------------------------------------- */
    /* In-page alert                                                       */
    /*                                                                     */
    /* Shaped like a Salesforce toast and, like one, it goes away on its    */
    /* own. Auto-dismiss matters more here than it does for Salesforce's:   */
    /* this is somebody else's software putting a bar on the page, and one  */
    /* that sat there until dismissed would be an imposition rather than a  */
    /* notice.                                                             */
    /* ----------------------------------------------------------------- */

    var TOAST_MS = 9000;
    var toastTimer = null;

    $scope.toast = { visible: false };

    $scope.showToast = function(spec){
        if(!spec){ return; }
        if(toastTimer){ $timeout.cancel(toastTimer); }
        $scope.toast = {
            visible: true,
            variant: spec.variant || 'info',
            icon: spec.icon || 'ℹ',
            title: spec.title || 'Salesforce Simplified',
            lines: spec.lines || [],
            actionable: spec.actionable !== false,
            // Optional: what "View" should do. Without one it falls back to
            // the news timeline, which is where every toast used to lead.
            action: (typeof spec.action === 'function') ? spec.action : null
        };
        toastTimer = $timeout(function(){
            $scope.toast.visible = false;
            toastTimer = null;
        }, TOAST_MS);
    };

    $scope.hideToast = function(){
        if(toastTimer){ $timeout.cancel(toastTimer); toastTimer = null; }
        $scope.toast.visible = false;
    };

    // The toast is about org news, so "View" lands on the timeline - the same
    // promise the desktop notification makes when it is clicked.
    /*
     * Where "View" goes.
     *
     * This used to open the News Timeline unconditionally, because news was
     * the only thing that raised a toast. It is not any more - the watch list
     * raises one too, and it was landing people on the news page to read about
     * a component that had changed. So the destination travels with the toast,
     * and the news timeline is the fallback for anything that does not say.
     */
    $scope.openFromToast = function(){
        var action = $scope.toast && $scope.toast.action;
        $scope.hideToast();

        if(typeof action === 'function'){ action(); return; }

        $scope.callModel();
        $("#SimplifiedMainModal").css({"display": "block"});
        var spec = MetaDataContainer.byValue($scope.newstimeline);
        if(spec){ $scope.detailsPopupOpen(spec); }
    };

    /* ----------------------------------------------------------------- */
    /* Which alerts the user wants                                         */
    /* ----------------------------------------------------------------- */

    $scope.currentOrgId = (typeof readCookie === 'function' && readCookie('OrgId')) || '';
    $scope.notifyKinds = SS_NOTIFY_KINDS;
    $scope.notifyPrefs = ssDefaultNotifyPrefs();
    $scope.notifyTestResult = '';

    ssGetNotifyPrefs(function(prefs){
        $scope.$applyAsync(function(){
            $scope.notifyPrefs = prefs;
            $scope.currentOrgId = (typeof readCookie === 'function' && readCookie('OrgId')) || '';
            /*
             * There is deliberately no toast here.
             *
             * A notice fired on load saying "Connected to Salesforce Org" and
             * restating the schedule the user had just configured. It
             * announced only that the extension was working, which is already
             * visible, and it did so on every page load and every refresh. A
             * notification is for something the user could not otherwise
             * know; this was not one.
             */
        });
    });

    $scope.saveNotifyPrefs = function(){
        ssSaveNotifyPrefs($scope.notifyPrefs);
        $scope.notifyTestResult = '';
    };

    /*
     * The test goes through the service worker rather than being faked here,
     * so what it proves is that the real path works: preferences honoured,
     * permission granted, notification drawn. A locally drawn toast would
     * prove only that this function runs.
     */
    $scope.sendTestNotification = function(){
        $scope.notifyTestResult = 'Sending...';
        $scope.showToast({
            variant: 'info',
            icon: '🔔',
            title: 'Test notification',
            lines: ['This is what an alert looks like in the page.'],
            actionable: false
        });
        try{
            chrome.runtime.sendMessage({ type: 'SS_TEST_NOTIFICATION' }, function(response){
                void chrome.runtime.lastError;
                $scope.$applyAsync(function(){
                    if(response && response.ok){
                        $scope.notifyTestResult = 'Sent - check your desktop notifications.';
                    }else{
                        $scope.notifyTestResult = (response && response.error) ||
                            'Could not send. Check that notifications are allowed for Chrome.';
                    }
                });
            });
        }catch(e){
            $scope.notifyTestResult = 'Not available outside the extension.';
        }
    };

    /* ----------------------------------------------------------------- */
    /* Escape closes the popup                                             */
    /*                                                                     */
    /* Full screen is the default, so the panel covers the whole window    */
    /* and the X in the corner is the only way out of it - Escape is what  */
    /* people reach for first, and it did nothing.                         */
    /*                                                                     */
    /* Bound on the capture phase because Salesforce binds its own Escape  */
    /* handlers on the page and Lightning stops the event on the way up;   */
    /* capture gets there first. The event is only swallowed when the      */
    /* popup is actually open, so when it is not, Escape reaches the page  */
    /* exactly as it did before.                                           */
    /* ----------------------------------------------------------------- */
    function mainModalIsOpen(){
        var modal = document.getElementById('SimplifiedMainModal');
        return !!modal && modal.style.display === 'block';
    }

    function onEscapeKeydown(event){
        if(event.key !== 'Escape' && event.keyCode !== 27){ return; }
        // Nothing to close on the standalone page: the panel IS the page, and
        // Escape there belongs to whatever the user is typing in.
        if(ssIsStandalonePage()){ return; }
        if(!mainModalIsOpen()){ return; }
        event.preventDefault();
        event.stopPropagation();
        $scope.$applyAsync(function(){
            $scope.SimplifiedMainModalClose();
        });
    }

    document.addEventListener('keydown', onEscapeKeydown, true);
    $scope.$on('$destroy', function(){
        document.removeEventListener('keydown', onEscapeKeydown, true);
    });


    /* ----------------------------------------------------------------- */
    /* Opening a metadata view                                             */
    /*                                                                     */
    /* detailsPopupOpen / ...FromMainMenu / ...ByOption and VerifyPackage  */
    /* were four copies of the same ~30 lines, differing only in which     */
    /* container they reveal and whether they strip Angular's $$hashKey.   */
    /* ----------------------------------------------------------------- */

    // ng-repeat stamps $$hashKey onto the shared MetaDataContainer entries;
    // it must not travel into selectedMetadata or the package.xml payload.
    function withoutHashKey(data){
        return JSON.parse(JSON.stringify(data, function(key, value){
            return key === '$$hashKey' ? undefined : value;
        }));
    }

    function currentUserFirstName(){
        return $("#userfullname").text().split(" ")[0];
    }

    // options: { modal, fullPane, recentItemOf, clone, showMainMenu, unameFallback }
    /*
     * Run the list against the object's real schema.
     *
     * The spec that arrives here was built from whatever was cached, which on
     * a first open is nothing - so its SELECT is the generic guess. Asking for
     * the describe first lets the spec be rebuilt from the org's own answer,
     * which is the only thing that knows this object has no Name, or no
     * LastModifiedBy, or a dozen columns worth showing.
     *
     * The rebuilt spec is copied onto selectedMetadata, not just used for the
     * query: decorateRecords reads `columns` from there, so a query that
     * fetched them and a scope that does not know about them would render the
     * same four cells as before while paying for more.
     */
    function runListForSchema(data, queryToRun){
        var generation = listGeneration;

        return $q.when(DynamicMetadataService.specWithSchema(data.value, null))
            .then(function(spec){
                // The user moved on while the describe was in flight.
                if(!listResponseStillWanted(generation)){ return; }

                /*
                 * An authored query is never replaced.
                 *
                 * A handful of entries carry queries written by hand in
                 * MetaDataContainer, and they select things the generic
                 * builder has no way to know about - CustomField, Layout,
                 * ValidationRule and WebLink all pull
                 * EntityDefinition.QualifiedApiName, which is the only reason
                 * their rows show which object they belong to. Overwriting
                 * those with a schema-built SELECT dropped the relationship
                 * and the prefix went with it.
                 *
                 * The describe still contributes its columns; it just does not
                 * get to rewrite a query somebody wrote on purpose.
                 */
                var authored = (MetaDataContainer.systemData || []).some(function(entry){
                    return entry && entry.value === data.value &&
                           (entry.query || entry.queryForAll);
                });

                if(spec && authored){
                    [$scope.selectedMetadata, data].forEach(function(target){
                        if(target && target.value === data.value){ target.columns = spec.columns; }
                    });
                    var authoredRun = $scope.querySFDC(queryToRun, data.url);
                    $scope.searchMetadata(data);
                    return authoredRun;
                }

                if(spec && (spec.query || spec.queryForAll)){
                    /*
                     * Both objects, not just the scope one.
                     *
                     * selectedMetadata is a clone of `data` whenever the menu
                     * opened with options.clone, so writing to one leaves the
                     * other holding the guessed query - and `data` is what is
                     * handed to searchMetadata below.
                     */
                    [$scope.selectedMetadata, data].forEach(function(target){
                        if(!target || target.value !== data.value){ return; }
                        target.columns      = spec.columns;
                        target.displayField = spec.displayField;
                        target.query        = spec.query;
                        target.queryForAll  = spec.queryForAll;
                    });
                    queryToRun = spec.query || spec.queryForAll || queryToRun;
                }
                var running = $scope.querySFDC(queryToRun, data.url);
                /*
                 * The whole-org list is started here rather than by the caller.
                 *
                 * searchMetadata takes a JSON snapshot of the spec the moment
                 * it is called, and openMetadata called it synchronously - so
                 * it captured queryForAll before the describe had come back and
                 * ran the guessed query. The "my records" list was fixed and
                 * "all records" was not, from one object, in the same open.
                 */
                $scope.searchMetadata(data);
                return running;
            }, function(){
                // Nothing learned; run what we came with rather than nothing.
                if(!listResponseStillWanted(generation)){ return; }
                var running = $scope.querySFDC(queryToRun, data.url);
                $scope.searchMetadata(data);
                return running;
            });
    }

    function openMetadata(data, options){
        options = options || {};
        if(!data){
            return;
        }

        // Cancel any in-flight request immediately so the previous result
        // doesn't arrive after the user has already navigated to a new item.
        sfdc.cancelPending();

        /*
         * And a generation, because cancelling is not enough on its own.
         *
         * cancelPending aborts what is in flight at this instant, but a query
         * does not become cancellable the moment it is asked for: smartQuery
         * waits on SchemaService.ready() before it issues anything, so a
         * request asked for during that wait is not yet registered and this
         * call cannot see it. It goes out afterwards, answers whenever it
         * answers, and the handler writes the result to the scope with no
         * check that anyone is still waiting for it.
         *
         * That is the list appearing and then vanishing: the response the user
         * wanted arrives and renders, the superseded one lands a moment later
         * and replaces it with its own - usually empty - answer. Nothing
         * errors, so it reads as the list simply not loading.
         *
         * Each open takes a number, every response carries the number it was
         * asked under, and a response from an earlier generation is dropped.
         * That holds however the request was scheduled and whether or not the
         * abort reached it.
         */
        listGeneration++;

        // Reset all loading and result state up-front so the UI clears instantly.
        $scope.records = [];
        $scope.AllMetaDataRecords = [];
        $scope.renderLimit = DEFAULT_RENDER_LIMIT;
        $scope.showAllData = false;
        $scope.showloading = false;
        $scope.showallloading = false;
        $scope.showErrorMessage = false;
        $scope.ErrorMsg = '';
        $scope.selectedMenu = data;
        $scope.searchAllMetaData = '';
        $scope.showUserFrequency = false;
        $scope.totalSize_AllMetaDataRecords = 0;
        $scope.total_records = 0;

        var firstName = currentUserFirstName();
        $scope.uname = firstName ? firstName + "'s" : (options.unameFallback || '');
        $scope.unamewithoutastr = firstName;

        if(options.modal){
            $("#SimplifiedMainModal").css({"display": "block"});
        }
        if(options.fullPane){
            setDetailPaneOpen(true);
        }
        if(options.recentItemOf){
            $("#recentItemOf").css({"width": "350"});
        }
        if(options.showMainMenu !== false){
            // Clear the inline display rather than forcing "block": the panel
            // is a flex column, and an inline block would flatten it and stop
            // the list scrolling under the fixed Quick Find.
            $(".mainmenuSidebar").css({"display":""});
        }

        $scope.selectedMetadata = options.clone ? withoutHashKey(data) : data;

        // What the standalone page opens on next time, when the audit trail
        // cannot be read - see lastOpenedMetadata.
        rememberLastMetadata(data.value);
        syncUrlForMetadata(data.value);

        // Counted here rather than at each call site: this is the one funnel
        // every metadata view goes through, whichever entry point opened it.
        if(data.value === $scope.packagexml || data.value === 'PackageXml'){
            /*
             * Rebuilt on the way in, every time.
             *
             * The manifest is only produced when the selection changes, so
             * anything that put the two out of step - a restore that half
             * happened, a tick that missed the type map - stayed wrong until
             * somebody ticked something else. Opening the page is the moment
             * it matters and the cheapest place to be sure.
             *
             * A hand-edited manifest is not overwritten: createpkgXmlString
             * refreshes the summary and leaves the text alone when
             * packageXmlEdited is set, so the counts come back in step
             * without taking the user's version away. Refresh package.xml is
             * still there for when that is what they want.
             */
            $scope.createpkgXmlString();
        }else if(data.value === $scope.usageanalytics){
            refreshUsage();
        }else if(data.value === $scope.newstimeline){
            $scope.loadNewsTimeline();
        }else if(data.value === $scope.apimonitor || data.value === 'ApiMonitor' || data.value === 'Integrator'){
            $scope.loadIntegratorDashboard();
        }else if(data.value === $scope.audittrail || data.value === 'AuditTrail'){
            $scope.loadAuditTrail();
        }else if(data.value === 'RestExplorer'){
            /* The rail's list of what this org advertises. Read once and kept:
             * the version root does not change while the panel is open. */
            $scope.loadRestResources();
        }else if(data.value === 'EventGraph'){
            /*
             * Reads the URL and records the navigation, but collects nothing:
             * a trace is a set of queries against a chosen root, and choosing
             * one for the user would run them against whatever page they
             * happened to open the panel from.
             */
            $scope.loadEventGraph();
        }else if(data.value === 'SyncJobs'){
            /*
             * Read on open, every time. A job that was running when this page
             * was last looked at has very likely finished since - the org
             * carried on after the worker was killed - so a cached list is
             * exactly the wrong thing to show here.
             */
            $scope.loadSync();
        }else if(data.value === 'WatchingList'){
            /*
             * Re-read before showing, then check.
             *
             * The list lives in localStorage, so another tab on this org can
             * have starred or removed something since this page loaded - and
             * the page most likely to be opened to answer "what changed" is
             * the worst one to answer it from a stale copy.
             */
            refreshBookmarkState();

            UsageService.record('watchingList');
            /*
             * The stored list and its history read without an org; only the
             * check needs one. Signed out the page is still worth opening, so
             * it shows what it has rather than reporting a failure the user
             * can do nothing about from here.
             */
            if($scope.hasSession){ checkBookmarks(false); }
        }else if(data.value === $scope.truststatus || data.value === 'TrustStatus'){
            $scope.loadTrustStatus();
        }else if(data.value === $scope.aboutus || data.value === 'AboutUs'){
            $scope.loadAbout();
        }else if(data.value === $scope.change){
            UsageService.record('viewAsUser');
        }else if(data.value === 'DebugLogs'){
            UsageService.record('debugLog');
        }else if(data.type === 'table'){
            UsageService.record('metadataView');
        }

        var queryToRun = data.query || data.queryForAll;
        if(data.type == 'table' && queryToRun){
            $scope.showloading = true;
            $scope.showallloading = true;
            // runListForSchema starts both lists, once the describe has settled
            // what they should select.
            $scope.rcd = runListForSchema(data, queryToRun);
            $scope.RecordHeaders = data.headers;
        }else{
            // Nothing to wait for: no table query on this entry.
            $scope.searchMetadata(data);
        }
    }

    /*
     * The keyboard shortcut, arriving from the service worker.
     *
     * Ctrl+Alt+S by default; Chrome owns the binding, so the user can change
     * or clear it at chrome://extensions/shortcuts. Only this controller can
     * open the menu, which is why the command is relayed here rather than
     * handled in the worker.
     */
    try{
        chrome.runtime.onMessage.addListener(function(message){
            if(!message || !message.type){
                return;
            }
            if(message.type === 'SS_OPEN_APEX_CLASSES'){
                $scope.$applyAsync(function(){
                    $scope.openApexClasses();
                });
                return;
            }
            /*
             * Someone clicked the off-hours notification. It was sent because
             * something happened to their org, so open on the news timeline
             * rather than dropping them on whatever was last selected - the
             * notification made a promise and this is it being kept.
             */
            if(message.type === 'SS_OPEN_PANEL'){
                $scope.$applyAsync(function(){
                    $scope.callModel();
                    $("#SimplifiedMainModal").css({"display": "block"});
                    var spec = MetaDataContainer.byValue($scope.newstimeline);
                    if(spec){
                        $scope.detailsPopupOpen(spec);
                    }
                });
            }
        });
    }catch(e){
        // Not an extension context (test harness).
    }

    $scope.openApexClasses = function(){
        // The menu has to be open for the panel to have anything to sit in,
        // and callModel() is what loads the menu's own state.
        $scope.callModel();

        var spec = MetaDataContainer.byValue('ApexClass');
        if(!spec){
            return;
        }
        /*
         * Everything, not just this user's. The shortcut exists to answer
         * "where is that class" - which is a question about the org, and the
         * my-records half of the panel would answer it only if the class
         * happened to be one of yours.
         */
        $scope.showmyview = $scope.userKnown;
        // detailsPopupOpen loads both halves - this user's and the org's - so
        // there is nothing further to trigger. searchMetadataRecordsOnChange
        // is the Search All action and needs a search term; calling it here
        // did nothing except record an advanced search that never happened.
        $scope.detailsPopupOpen(spec);
    };

    $scope.detailsPopupOpen = function(data){
        openMetadata(data, { modal: true, clone: true });
    }

    $scope.detailsPopupOpenFromMainMenu = function(){
        openMetadata(MetaDataContainer.data[3], { fullPane: true, recentItemOf: true });
    }

    $scope.detailsPopupOpenByOption = function(data, len){
        $scope.limitLength = len || 200;
        openMetadata(data, { fullPane: true, clone: true, showMainMenu: false });
    }

    $scope.createPackageXml = function(){
    }

    $scope.loadDataClosebtn = function(){
        //$(".ARISearch").css({"display":"none"});
        //$(".packageARISearch").css({"display":"none"});
        $(".mainmenuSidebar").css({"display":"none"});
        ssOpenMenu();
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
    function isSelectedForPackageXml(id){
    	return !!$scope.selectedMetaForPackageXml.get(id);
    }

    function isSelectedForDataDownload(id){
    	return !!$scope.selectedDataForDownload.get(id);
    }
    
    function getMetaFullName(){
    	
    }
    
    /* ----------------------------------------------------------------- */
    /* Salesforce queries                                                  */
    /*                                                                     */
    /* querySFDC / queryOnAllData / queryOnAllDataFilterText were three    */
    /* copies of the same 40 lines: build headers, run $http, decorate the */
    /* returned records, then hand-roll an error message. They now share   */
    /* decorateRecords() and showQueryError() and differ only in which     */
    /* scope fields they fill.                                             */
    /* ----------------------------------------------------------------- */

    function updateNamespaces(){
        var recs1 = $scope.records || [];
        var recs2 = $scope.AllMetaDataRecords || [];
        var combined = recs1.concat(recs2);

        if(!combined.length){
            $scope.availableNamespaces = [];
            $scope.selectedNamespaces = {};
            return;
        }

        var counts = Object.create(null);
        var unmanagedKey = '__unmanaged__';

        for (var i = 0; i < combined.length; i++) {
            var item = combined[i];
            if (!item) continue;
            var prefix = item.NamespacePrefix || null;
            var k = prefix === null ? unmanagedKey : prefix;
            counts[k] = (counts[k] || 0) + 1;
        }

        var keys = Object.keys(counts);
        var list = [];
        var sel = $scope.selectedNamespaces || {};

        for (var j = 0; j < keys.length; j++) {
            var key = keys[j];
            var label = key === unmanagedKey ? 'Unmanaged (Local)' : key;
            list.push({
                key: key,
                prefix: key === unmanagedKey ? null : key,
                label: label,
                count: counts[key]
            });

            if (sel[key] === undefined) {
                if (keys.length > 1) {
                    sel[key] = (key === unmanagedKey);
                } else {
                    sel[key] = true;
                }
            }
        }

        $scope.availableNamespaces = list;
        $scope.selectedNamespaces = sel;
    }

    $scope.namespaceFilter = function(record){
        if(!record){
            return false;
        }
        if(!$scope.availableNamespaces || !$scope.availableNamespaces.length){
            return true;
        }
        var prefix = record.NamespacePrefix || null;
        var key = prefix === null ? '__unmanaged__' : prefix;
        if ($scope.selectedNamespaces && $scope.selectedNamespaces[key] !== undefined) {
            return !!$scope.selectedNamespaces[key];
        }
        return true;
    };

    /*
     * Columns the row template renders by name. A record carrying one of these
     * already has a visible label, so it needs no generic fallback.
     */
    var EXPLICIT_LABEL_FIELDS = [
        'Name', 'MasterLabel', 'DeveloperName', 'CaseNumber',
        'ContractNumber', 'OrderNumber', 'email', 'LogLength'
    ];

    /*
     * Works out the label for records whose display column is none of the
     * above - Dashboard.Title, Task.Subject, ValidationRule.ValidationName,
     * EntityDefinition.QualifiedApiName and anything else an org's describe
     * nominates. Without this the row renders its checkbox and its actions
     * and simply no text, which is what an empty Dashboard list was.
     *
     * Computed once per fetch rather than called from the template, which
     * would re-run it for every row on every digest.
     */
    function labelFor(record, meta){
        if(!record){
            return '';
        }
        for(var i = 0; i < EXPLICIT_LABEL_FIELDS.length; i++){
            if(record[EXPLICIT_LABEL_FIELDS[i]]){
                return '';   // the template already shows this one
            }
        }
        var field = meta && meta.displayField;
        if(field && field !== 'Id'){
            var parts = field.split('.');
            var val = record;
            for(var p = 0; p < parts.length; p++){
                val = val ? val[parts[p]] : undefined;
            }
            if(val !== undefined && val !== null){
                return /percent|coverage/i.test(field) ? (val + '%') : String(val);
            }
        }
        /*
         * No usable spec: take the first plain value on the record. Numbers
         * count - ApexOrgWideCoverage carries nothing but PercentCovered, so a
         * string-only fallback rendered its row as a checkbox and no text at
         * all. Objects are checked for relationship names (e.g. ApexClassOrTrigger.Name).
         */
        for(var key in record){
            if(!record.hasOwnProperty(key) || key === 'Id' || key === 'attributes'){
                continue;
            }
            if(key.charAt(0) === '$' || key.charAt(0) === '_'){
                continue;
            }
            var value = record[key];
            if(typeof value === 'string' && value){
                return value;
            }
            if(typeof value === 'number'){
                // Coverage and similar percentage-style columns read better
                // with their unit than as a bare number in an empty row.
                return /percent|coverage/i.test(key) ? (value + '%') : String(value);
            }
            if(typeof value === 'object' && value !== null && key !== 'LastModifiedBy' && key !== 'CreatedBy'){
                if(value.Name) return value.Name;
                if(value.DeveloperName) return value.DeveloperName;
            }
        }
        /*
         * Nothing but the id, which the loop above skips on purpose because an
         * id is a poor label wherever there is a real one.
         *
         * There is not always a real one. An object with no label column gets
         * displayField 'Id', so the query selects Id and nothing else, and the
         * row rendered as a checkbox beside blank space - unreadable, and
         * unselectable in any meaningful sense because nothing on screen said
         * which record it was. The id is a worse label than a name and a far
         * better one than nothing.
         */
        return record.Id ? String(record.Id) : '';
    }

    // Applies the per-metadata display rules to a freshly fetched list.
    /*
     * The describe-chosen columns, rendered once per fetch.
     *
     * Formatted here rather than by a scope function in ng-repeat: the grid
     * shows up to 200 rows and up to five of these columns, so a getter in the
     * template is a thousand calls per digest for values that only change when
     * the records do.
     */
    function extraColumnValues(record, columns){
        return columns.map(function(col){
            var raw = record ? record[col.field] : undefined;
            if(raw === undefined || raw === null || raw === ''){ return ''; }
            if(col.type === 'boolean'){ return raw ? 'Yes' : 'No'; }
            if(col.type === 'date' || col.type === 'datetime'){
                var at = Date.parse(raw);
                // An unparseable date is shown as the org sent it rather than
                // as Invalid Date, which is what new Date(NaN) renders.
                if(isNaN(at)){ return String(raw); }
                var d = new Date(at);
                return col.type === 'date'
                    ? d.toLocaleDateString()
                    : d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            }
            return String(raw);
        });
    }

    /*
     * How many cells a row spends before its describe-driven columns.
     *
     * The grid has no header, which was fine while every row showed a name and
     * nothing else. Now that each object contributes its own columns, a row
     * reads "62.0  Active  1843" with no way to tell which is which - so the
     * columns need labelling, and a label has to sit over the right column.
     *
     * The leading cells are conditional and vary by object: a star only where
     * rows have ids, one cell per applicable field action, two checkboxes that
     * depend on the type, and a label cell chosen from whichever field the row
     * actually carries. This mirrors those conditions against the first row,
     * which is representative because every row of one object has the same
     * shape.
     *
     * Getting it wrong shifts the labels sideways; it does not break the grid.
     * The parity test keeps it in step with the cells it is counting.
     */
    /*
     * Collapsing either list.
     *
     * Both are on screen at once and either can be long, so reading the
     * whole-org list means scrolling past your own records first. Open by
     * default - collapsing is a thing you ask for, not a state to be found in.
     */
    $scope.sectionOpen = { my: true, all: true };

    $scope.toggleSection = function(which){
        if(!which){ return; }
        $scope.sectionOpen[which] = !$scope.sectionOpen[which];
    };

    $scope.gridLeadColumns = function(rows){
        var meta = $scope.selectedMetadata || {};
        var sample = (rows && rows.length) ? rows[0] : null;
        if(!sample){ return 1; }

        var count = 0;
        if($scope.canBookmark(sample)){ count++; }

        (meta.fieldlevelactions || []).forEach(function(faction){
            if(faction && faction.name &&
               (faction.actionUrl || meta.value === 'ChangeUser')){ count++; }
        });

        if(meta.eligibleForPackageXml){ count++; }
        if(meta.eligibleForDataDownload){ count++; }

        // The label block, in the template's own order and with its own
        // conditions - a debug log spends three cells here, most rows one.
        if(sample.LogLength){ count += 3; }
        if(sample.Name){ count++; }
        if(sample.MasterLabel && !sample.Name){ count++; }
        if(sample.CaseNumber){ count++; }
        if(sample.ContractNumber){ count++; }
        if(sample.OrderNumber){ count++; }
        // Lowercase: these are the change-user rows the controller builds, not
        // a Salesforce field. A queried record spells it Email.
        if(sample.email){ count++; }
        if(sample.DeveloperName && !sample.Name && !sample.MasterLabel){ count++; }
        if(sample._ssLabel && !sample.Name && !sample.MasterLabel &&
           !sample.DeveloperName){ count++; }

        return count || 1;
    };

    function decorateRecords(records){
        if(!records || !records.length){
            updateNamespaces();
            return records || [];
        }
        var meta = $scope.selectedMetadata || {};
        var cols = (meta.columns && meta.columns.length) ? meta.columns : [];
        if(meta.isSobjectType){
            records.forEach(function(e){
                if(!e.SobjectType){ return; }
                if(e.DeveloperName){ e.DeveloperName = e.SobjectType + '.' + e.DeveloperName; }
                if(e.Name){ e.Name = e.SobjectType + '.' + e.Name; }
            });
        }

        // Normalize entity-child metadata types so they display as ObjectName.MemberName
        // which is the exact format required for package.xml <members> entries
        var val = meta.value;
        records.forEach(function(r) {
            // Layout: prefer EntityDefinition.QualifiedApiName over TableEnumOrId (ID for custom objects)
            // package.xml format is "ObjectName-LayoutName"
            if (val === 'Layout' && r.Name) {
                var objName = (r.EntityDefinition && r.EntityDefinition.QualifiedApiName) || r.TableEnumOrId || '';
                if (objName && r.Name.indexOf(objName + '-') !== 0) {
                    r._packageXmlName = objName + '-' + r.Name;
                    r.Name = r._packageXmlName;
                }
            }
            // ValidationRule: EntityDefinition.QualifiedApiName + '.' + ValidationName
            if (val === 'ValidationRule' && r.EntityDefinition && r.ValidationName) {
                r._packageXmlName = r.EntityDefinition.QualifiedApiName + '.' + r.ValidationName;
                r.Name = r._packageXmlName;
            }
            // WebLink: EntityDefinition.QualifiedApiName + '.' + Name
            if (val === 'WebLink' && r.EntityDefinition && r.Name) {
                r._packageXmlName = r.EntityDefinition.QualifiedApiName + '.' + r.Name;
                r.Name = r._packageXmlName;
            }
            // CustomField via Tooling API: prefer EntityDefinition.QualifiedApiName (object dev name)
            // over TableEnumOrId which returns an 18-char ID for custom objects.
            if (val === 'CustomField' && r.DeveloperName) {
                var objectName = (r.EntityDefinition && r.EntityDefinition.QualifiedApiName)
                                 || r.TableEnumOrId || '';
                var suffix = r.DeveloperName.endsWith('__c') ? '' : '__c';
                r._packageXmlName = objectName + '.' + r.DeveloperName + suffix;
                r.Name = r._packageXmlName;
            }
            // RecordType: SobjectType + '.' + DeveloperName
            if (val === 'RecordType' && r.SobjectType && r.DeveloperName) {
                r._packageXmlName = r.SobjectType + '.' + r.DeveloperName;
                r.Name = r._packageXmlName;
            }
        });

        // After the rewrites above, so a record that just gained a Name is not
        // given a redundant second label.
        records.forEach(function(r){
            r._ssLabel = labelFor(r, meta);
            // Empty array when the describe has not landed yet, so the row
            // renders its usual cells and gains the extra ones on the rebuild.
            r._ssCols = cols.length ? extraColumnValues(r, cols) : [];
        });

        updateNamespaces();
        return records;
    }

    function clearQueryError(){
        $("div.userdetails > p").removeClass('userdetailsError');
        $scope.ErrorMsg = '';
    }

    /*
     * An answer the org refused to give is not an empty list.
     *
     * smartQuery returns emptyResult() when it decides an object cannot be
     * queried - blacklisted from an earlier refusal, servable by neither API,
     * or unlistable without a filter this extension cannot supply. That
     * resolves *successfully* with no records, so the panel rendered a blank
     * grid and said nothing: clicked a metadata type, got nothing, no reason.
     *
     * It carries its reason. Showing it turns "this does not work" into
     * something the user can act on, and tells them which of those four cases
     * they are in.
     */
    /*
     * Why this list is empty.
     *
     * Four very different situations arrive as the same blank table: the org
     * genuinely has none of these, a filter excluded them all, the response
     * reported a total and sent no rows, or the user cannot read them. A
     * refusal already explains itself through showUnsupported; the other
     * three did not, and a user cannot act on any of them without knowing
     * which one happened.
     *
     * Every answer here is derived from state the panel already holds, so
     * there is nothing to keep in step - and it says nothing at all when it
     * cannot tell, rather than guessing.
     */
    $scope.emptyListReason = function(context){
        var all = context === 'all';
        var loaded = all ? $scope.AllMetaDataRecords : $scope.records;
        /*
         * What the user can see, not what was fetched.
         *
         * A list filtered down to nothing is as empty as one that never had
         * rows, and it is the case most in need of a sentence: the filter that
         * did it is a checkbox in the right rail, off-screen from the table it
         * emptied. Falls back to the fetched list before the ng-repeat has run
         * and defined the rendered one.
         */
        var rendered = all ? $scope.allFilterItem : $scope.myFilterItem;
        var visible = rendered === undefined ? loaded : rendered;
        if(visible && visible.length){ return ''; }      // the user can see it
        if($scope.showErrorMessage){ return ''; }        // already explained

        var search = ($scope.searchAllMetaData || '').trim();
        var hiddenByNamespace = false;
        if($scope.availableNamespaces && $scope.availableNamespaces.length &&
           $scope.selectedNamespaces){
            hiddenByNamespace = $scope.availableNamespaces.some(function(ns){
                var key = ns && ns.key !== undefined ? ns.key : ns;
                return $scope.selectedNamespaces[key] === false;
            });
        }

        /*
         * The org answered with a total and no rows. This is the one that
         * reads as a bug, because the heading counts something the table does
         * not show - so it is named rather than folded in with "none found".
         */
        /*
         * Only when nothing came back at all. Rows that arrived and were then
         * filtered away were returned - saying they were not is a false alarm,
         * and the namespace branch below is the one that actually explains an
         * empty grid under a header that counted something.
         */
        if(all && !(loaded && loaded.length) &&
           typeof $scope.orgTotalRecords === 'number' && $scope.orgTotalRecords > 0){
            return 'This org has ' + $scope.orgTotalRecords + ', but none were returned. ' +
                   'That is usually field-level security on the columns this list reads.';
        }

        if(search && hiddenByNamespace){
            return 'Nothing matches "' + search + '" in the namespaces you have selected.';
        }
        if(search){
            return 'Nothing matches "' + search + '". Clear the search to see the rest.';
        }
        if(hiddenByNamespace){
            return 'All of these are in namespaces you have unticked - see Namespaces on the right.';
        }

        return '';   // genuinely none, and the type's own message says so
    };

    function unsupportedReason(data){
        return (data && data.ssUnsupported) ? (data.ssReason || 'This object cannot be queried here.') : null;
    }

    function showUnsupported(reason){
        $scope.ErrorMsg = reason;
        $scope.showErrorMessage = true;
        $scope.showloading = false;
        $scope.showallloading = false;
    }

    /*
     * Offered beside the refusal, because the refusal may be stale: the object
     * is remembered as unqueryable across sessions, and permissions change.
     */
    $scope.retryUnsupported = function(){
        var meta = $scope.selectedMetadata || {};
        var obj = meta.metadata || meta.value;
        if(!obj){ return; }

        sfdc.forgetUnqueryable(obj);
        $scope.ErrorMsg = '';
        $scope.showErrorMessage = false;
        $scope.detailsPopupOpen(meta);
    };

    function showQueryError(rejection){
        $("div.userdetails > p").addClass('userdetailsError');
        $scope.ErrorMsg = sfdc.errorMessage(rejection, ($scope.selectedMetadata || {}).value);
        $scope.showErrorMessage = true;
        $scope.showloading = false;
        $scope.showallloading = false;
        refreshSessionState();
    }

    $scope.myRawCopied = false;
    $scope.allRawCopied = false;

    /* ----------------------------------------------------------------- */
    /* The request behind a list                                           */
    /*                                                                     */
    /* Every metadata list is one SOQL call, and when a list is empty or    */
    /* wrong the first question is always "what did it actually ask?".      */
    /* Recorded as it goes out so that question has an answer, next to the  */
    /* response copy that already exists.                                   */
    /*                                                                     */
    /* The Authorization header is deliberately not included. It carries a  */
    /* live Salesforce session, and this is a thing built to be pasted into */
    /* a ticket or a chat window. The omission is stated in the payload      */
    /* rather than left silent, so nobody pastes it expecting a runnable    */
    /* curl and wonders why it 401s.                                        */
    /* ----------------------------------------------------------------- */

    $scope.lastRequest = { my: null, all: null };

    function recordRequest(scope, soql, baseUrl){
        try{
            var resolved = (typeof ssResolveQueryUid === 'function') ? ssResolveQueryUid(soql) : soql;
            var endpoint = (baseUrl || ssQueryUrl());
            $scope.lastRequest[scope] = {
                object: ($scope.selectedMetadata && $scope.selectedMetadata.value) || null,
                label: ($scope.selectedMetadata && $scope.selectedMetadata.label) || null,
                scope: scope === 'my' ? 'Records created or modified by this user'
                                      : 'All records in the org',
                method: 'GET',
                apiVersion: (typeof SS_API_VERSION !== 'undefined') ? SS_API_VERSION : null,
                soql: resolved,
                rowLimit: $scope.limitLength,
                endpoint: endpoint + encodeURIComponent(resolved),
                requestedAt: new Date().toISOString(),
                note: 'Generated by Salesforce Simplified Chrome Extension. The Authorization header is omitted on purpose: it carries a live Salesforce session.'
            };
        }catch(e){
            $scope.lastRequest[scope] = null;
        }
    }

    $scope.hasRequestJson = function(context){
        return !!($scope.lastRequest && $scope.lastRequest[context]);
    };

    $scope.copyRequestJson = function(context){
        var payload = $scope.lastRequest && $scope.lastRequest[context];
        if(!payload){ return; }
        var json = JSON.stringify(payload, null, 2);
        var flag = function(){
            $timeout(function(){
                if(context === 'my'){
                    $scope.myReqCopied = true;
                    $timeout(function(){ $scope.myReqCopied = false; }, 2500);
                }else{
                    $scope.allReqCopied = true;
                    $timeout(function(){ $scope.allReqCopied = false; }, 2500);
                }
            });
        };
        if(navigator && navigator.clipboard && navigator.clipboard.writeText){
            navigator.clipboard.writeText(json).then(flag, flag);
        }else{
            flag();
        }
    };

    $scope.copyRawJson = function(context) {
        var recs = [];
        if (context === 'my') {
            recs = $scope.records || [];
        } else if (context === 'all') {
            recs = $scope.AllMetaDataRecords || [];
        } else {
            recs = ($scope.records && $scope.records.length) ? $scope.records : ($scope.AllMetaDataRecords || []);
        }
        var json = ssBuildJsonDownloadPayload(recs);
        var setCopiedState = function() {
            $timeout(function() {
                if (context === 'my') {
                    $scope.myRawCopied = true;
                    $timeout(function() { $scope.myRawCopied = false; }, 2500);
                } else {
                    $scope.allRawCopied = true;
                    $timeout(function() { $scope.allRawCopied = false; }, 2500);
                }
            });
        };

        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json).then(setCopiedState).catch(function() {
                setCopiedState();
            });
        } else {
            var textArea = document.createElement("textarea");
            textArea.value = json;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
            setCopiedState();
        }
    };

    $scope.downloadRawJson = function(context) {
        var recs = [];
        var prefix = 'raw_data';
        var label = ($scope.selectedMetadata && $scope.selectedMetadata.label) ? $scope.selectedMetadata.label : 'data';
        if (context === 'my') {
            recs = $scope.records || [];
            var userPrefix = $scope.uname ? $scope.uname.replace(/\s+/g, '_') : 'my';
            prefix = userPrefix + '_' + label;
        } else if (context === 'all') {
            recs = $scope.AllMetaDataRecords || [];
            prefix = 'all_' + label;
        } else {
            recs = ($scope.records && $scope.records.length) ? $scope.records : ($scope.AllMetaDataRecords || []);
            prefix = label;
        }
        var json = ssBuildJsonDownloadPayload(recs);
        $scope.downloadDoc(prefix.toLowerCase().replace(/[^a-z0-9_]/g, '_') + '.json', json, 'application/json;charset=utf-8');
    };

    // "My records" list.
    $scope.querySFDC = function(query, url){
        var generation = listGeneration;
        recordRequest('my', query, url);
        return sfdc.query(query, url, $scope.limitLength).then(function(data){
            if(!listResponseStillWanted(generation)){ return; }
            var refused = unsupportedReason(data);
            if(refused){
                $scope.records = [];
                $scope.isDataAvailable = false;
                showUnsupported(refused);
                return;
            }
            clearQueryError();
            $scope.lastRawResponse = data;
            $scope.records = decorateRecords(data.records);
            // After the assignment, not before it. Counting $scope.records on
            // the line above read the previous response's array - which the
            // reset had just emptied - so every list reported (0) over its own
            // rows.
            $scope.total_records = $scope.records.length;
            $scope.isDataAvailable = !!($scope.records && $scope.records.length);
            $scope.showloading = false;
        }, function(rejection){
            if(!listResponseStillWanted(generation)){ return; }
            if (rejection && rejection.cancelled) {
                // Navigated away. The next open sets these again, but leaving
                // them true means a spinner that never stops if it does not.
                $scope.showloading = false;
                $scope.showallloading = false;
                return;
            }
            $scope.records = [];
            showQueryError(rejection);
        });
    }

    /*
     * How many the org actually has.
     *
     * The list carries an explicit LIMIT, and Salesforce answers totalSize as
     * the number of rows it returned - so the header read "All Apex Classes
     * (200)" in an org with three thousand of them. The count agreed with the
     * truncation instead of revealing it, and the word "All" did the rest:
     * Select all then built a package.xml from 200 of 3,000 and looked
     * finished.
     *
     * SELECT COUNT() answers in totalSize with no rows, so this costs one
     * cheap query and no payload - the same trick the news and usage panels
     * already use. Derived from the query that was actually sent, so any
     * WHERE the caller added is counted too.
     */
    function countQueryFrom(soql){
        if(!soql){ return null; }
        var from = /\sFROM\s+([A-Za-z0-9_]+)/i.exec(soql);
        if(!from){ return null; }
        var where = /\sWHERE\s([\s\S]*?)(?:\sORDER\s+BY\s|\sLIMIT\s|$)/i.exec(soql);
        return 'SELECT COUNT() FROM ' + from[1] +
               (where ? (' WHERE ' + where[1].trim()) : '');
    }

    function refreshOrgTotal(query, url, generation){
        $scope.orgTotalRecords = null;
        var counting = countQueryFrom(query);
        if(!counting){ return; }
        // No limit argument: a count with a LIMIT counts up to the limit.
        $q.when(sfdc.query(counting, url)).then(function(data){
            if(!listResponseStillWanted(generation)){ return; }
            if(data && typeof data.totalSize === 'number'){
                $scope.orgTotalRecords = data.totalSize;
            }
        }, function(){
            // Plenty of objects refuse COUNT(). Then the header simply says
            // what it loaded, which is what it did before.
        });
    }

    // Whole-org list, plus the top-contributors tag cloud.
    $scope.queryOnAllData = function(query, url){
        var generation = listGeneration;
        recordRequest('all', query, url);
        refreshOrgTotal(query, url, generation);
        return sfdc.query(query, url, $scope.limitLength).then(function(data){
            if(!listResponseStillWanted(generation)){ return; }
            var refused = unsupportedReason(data);
            if(refused){
                $scope.AllMetaDataRecords = [];
                $scope.isAllMetaDataRecords = false;
                $scope.showAllData = false;
                showUnsupported(refused);
                return;
            }
            $(".userdetails").removeClass('userdetailsError');
            $scope.lastRawResponse = data;
            $scope.AllMetaDataRecords = decorateRecords(data.records);
            /*
             * The count describes what is on screen, not what the org said
             * about the query.
             *
             * These are different numbers: totalSize is the org's answer, and
             * records is what it actually sent. They disagree when a query
             * reports a total and returns no rows - which drew a header
             * reading "(79)" over an empty table, with nothing to say why. The
             * whole-org figure has its own place beside it, from the COUNT()
             * query, so nothing is lost by making this one honest.
             */
            $scope.totalSize_AllMetaDataRecords =
                ($scope.AllMetaDataRecords && $scope.AllMetaDataRecords.length) || 0;
            $scope.isAllMetaDataRecords = !!($scope.AllMetaDataRecords && $scope.AllMetaDataRecords.length);
            $scope.showAllData = $scope.isAllMetaDataRecords;
            if($scope.isAllMetaDataRecords){
                $scope.createCloudTagData();
            }
            $scope.showloading = false;
            $scope.showallloading = false;
        }, function(rejection){
            if(!listResponseStillWanted(generation)){ return; }
            if (rejection && rejection.cancelled) { return; } // user navigated away
            $scope.showAllData = false;
            $scope.showloading = false;
            $scope.showallloading = false;
            showQueryError(rejection);
        });
    }

    // Whole-org list filtered by the advanced-search box.
    $scope.queryOnAllDataFilterText = function(query, url){
        var generation = listGeneration;
        clearQueryError();
        return sfdc.query(query, url, $scope.limitLength).then(function(data){
            if(!listResponseStillWanted(generation)){ return; }
            $scope.lastRawResponse = data;
            $scope.AllMetaDataRecords = decorateRecords(data.records);
            // This handler replaced the rows and left the count alone, so a
            // text search showed the previous list's number over the results.
            $scope.totalSize_AllMetaDataRecords = $scope.AllMetaDataRecords.length;
            $scope.isAllMetaDataRecords = !!($scope.AllMetaDataRecords && $scope.AllMetaDataRecords.length);
            $scope.showAllData = $scope.isAllMetaDataRecords;
            $scope.showloading = false;
        }, function(rejection){
            if(!listResponseStillWanted(generation)){ return; }
            if (rejection && rejection.cancelled) { return; } // user navigated away
            $scope.showAllData = false;
            $scope.showloading = false;
            showQueryError(rejection);
        });
    }

$scope.searchMetadata = function(selectMenu){
    try{
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
            try{
                $scope.queryOnAllData($scope.selectedMetadata1.queryForAll, $scope.selectedMetadata1.url);
            }catch(error){}
         }else{
            $scope.showallloading = false;
         }
        }catch(error){
			console.log(error);
		}
    }
    $scope.searchForUser = function(txt){
        $scope.searchAllMetaData = txt;
    }
    $scope.createCloudTagData = function(){
        try {
            $scope.userFrequencyList = [];
            $scope.showUserFrequency = false;
            if (!$scope.AllMetaDataRecords || !$scope.AllMetaDataRecords.length) {
                return;
            }
            var userList = [];
            for (var i = 0; i < $scope.AllMetaDataRecords.length; i++) {
                var r = $scope.AllMetaDataRecords[i];
                if (!r) continue;
                var uName = (r.LastModifiedBy && r.LastModifiedBy.Name) ||
                            (r.CreatedBy && r.CreatedBy.Name) ||
                            (r.LogUser && r.LogUser.Name) ||
                            (r.User && r.User.Name) ||
                            (r.LastModifiedBy && r.LastModifiedBy.Username) ||
                            (r.CreatedBy && r.CreatedBy.Username) ||
                            (($scope.selectedMetadata && ($scope.selectedMetadata.value === 'ChangeUser' || $scope.selectedMetadata.value === 'User')) ? (r.Name || r.username) : null);
                if (uName) {
                    userList.push(uName);
                }
            }
            if (userList && userList.length > 0) {
                var result = userAnalysis(userList);
                var unames = result[0];
                var ucounts = result[1];
                var userFrequencyList = [];
                for (var k = 0; k < unames.length; k++) {
                    userFrequencyList.push({
                        username: unames[k],
                        frequency: ucounts[k]
                    });
                }
                userFrequencyList.sort(function(a, b) {
                    return b.frequency - a.frequency;
                });
                $scope.userFrequencyList = userFrequencyList.slice(0, 10);
                $scope.showUserFrequency = true;
            }
        } catch(error) {
            console.log(error);
        }
    };

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

    $scope.searchMetadataRecordsOnChange = function(){
        UsageService.record('advanceSearch');
        try{
        if($scope.searchAllMetaData.length){
            var que='';
            if($scope.selectedMetadata1.queryForAllWithWhere){
                $scope.showloading = true;
                que = $scope.selectedMetadata1.queryForAllWithWhere+" '%25"+escapeSoqlLiteral($scope.searchAllMetaData)+"%25'";
                try{
                    $scope.queryOnAllDataFilterText(que, $scope.selectedMetadata1.url);
                }catch(error){}
            }
        }else{
            $scope.searchMetadata($scope.selectedMetadata1);
        }}catch(error){
			console.log(error);
		}
    }
    $scope.searchMetadataIfNothingTyped = function(){
        try{
            if(!$scope.searchAllMetaData.length){
                $scope.searchMetadata($scope.selectedMetadata1);
            }
        }catch(error){
            console.log(error);
        }
    };

    // ------------------------------------------------------------------
    // Integrator Dashboard Scope Handlers
    // ------------------------------------------------------------------
    $scope.integrationsList = [];
    $scope.integratorLogs = [];
    $scope.integratorReport = {};
    $scope.apiTraffic = { inboundTotal: 0, outboundTotal: 0, breakdown: {} };
    $scope.isCheckingHealth = false;
    $scope.showAddEndpoint = false;
    $scope.newEndpoint = { name: '', endpoint: '', method: 'GET', headers: '', body: '' };

    $scope.loadIntegratorDashboard = function() {
        $scope.integratorLogs = IntegrationService.getHealthLogs();
        $scope.integratorReport = IntegrationService.generateDailyReport($scope.integratorLogs);

        IntegrationService.getApiTrafficStats().then(function(traffic) {
            $scope.apiTraffic = traffic || {};
        });

        IntegrationService.discoverIntegrations().then(function(discovered) {
            $scope.integrationsList = discovered || [];
        });

        /*
         * The other direction. Everything discoverIntegrations returns is an
         * allow-list for Salesforce calling out; this is who has been calling
         * in. Loaded separately because it needs a permission the outbound
         * half does not, and losing it should cost only its own section.
         */
        IntegrationService.discoverInboundCallers($scope.inboundDays).then(function(callers) {
            $scope.inboundCallers = callers || [];
            $scope.inboundLoaded = true;
        });
    };

    $scope.inboundCallers = [];
    $scope.inboundLoaded = false;
    $scope.inboundDays = 30;

    $scope.setInboundWindow = function(days){
        $scope.inboundDays = days;
        $scope.inboundLoaded = false;
        return IntegrationService.discoverInboundCallers(days).then(function(callers){
            $scope.inboundCallers = callers || [];
            $scope.inboundLoaded = true;
        });
    };

    $scope.runIntegratorHealthCheck = function() {
        if (!$scope.integrationsList || !$scope.integrationsList.length) { return; }
        $scope.isCheckingHealth = true;
        var checks = $scope.integrationsList.map(function(item) {
            return IntegrationService.checkIntegrationHealth(item).then(function(log) {
                item.lastStatus = log.status;
                item.lastLatency = log.latencyMs;
                return log;
            });
        });

        $q.all(checks).then(function() {
            $scope.isCheckingHealth = false;
            $scope.integratorLogs = IntegrationService.getHealthLogs();
            $scope.integratorReport = IntegrationService.generateDailyReport($scope.integratorLogs);
        }, function() {
            $scope.isCheckingHealth = false;
        });
    };

    $scope.pingSingleIntegration = function(item) {
        if (!item) { return; }
        IntegrationService.checkIntegrationHealth(item).then(function(log) {
            item.lastStatus = log.status;
            item.lastLatency = log.latencyMs;
            $scope.integratorLogs = IntegrationService.getHealthLogs();
            $scope.integratorReport = IntegrationService.generateDailyReport($scope.integratorLogs);
        });
    };

    $scope.toggleAddEndpointForm = function() {
        $scope.showAddEndpoint = !$scope.showAddEndpoint;
    };

    $scope.saveCustomEndpoint = function() {
        if (!$scope.newEndpoint.name || !$scope.newEndpoint.endpoint) { return; }
        IntegrationService.addCustomIntegration($scope.newEndpoint);
        $scope.newEndpoint = { name: '', endpoint: '', method: 'GET', headers: '', body: '' };
        $scope.showAddEndpoint = false;
        $scope.loadIntegratorDashboard();
    };

    $scope.clearIntegratorHistory = function() {
        IntegrationService.clearLogs();
        $scope.integratorLogs = [];
        $scope.integratorReport = IntegrationService.generateDailyReport([]);
    };

    // ------------------------------------------------------------------
    // Footer stats
    //
    // Only the login locations, which are real: LoginHistory rows the org
    // actually holds. The hours that used to sit beside them - today, this
    // week, this month - were not measured. "Today" began at a hardcoded
    // fifteen minutes and accumulated wall-clock time the panel happened to
    // be open; week and month were login count multiplied by 1.8. Three
    // confident-looking figures that no one could act on, taking the width
    // the headline needed.
    // ------------------------------------------------------------------
    $scope.userStats = {
        countriesCount: 1
    };

    function calculateUserStats() {
        if (!UserId || !UserId.id) { return; }
        try {
            var loginQuery = "SELECT CountryIso, SourceIp FROM LoginHistory WHERE UserId = '" +
                escapeSoqlLiteral(UserId.id) + "' AND LoginTime = THIS_MONTH " +
                "ORDER BY LoginTime DESC LIMIT 100";
            sfdc.query(loginQuery).then(function(data) {
                if (!data || !data.records || !data.records.length) { return; }
                var countries = {};
                data.records.forEach(function(r) {
                    // CountryIso is blank on some login types, and the source
                    // IP is the next best evidence of a distinct origin.
                    var where = r.CountryIso || r.SourceIp;
                    if (where) { countries[where] = true; }
                });
                var count = Object.keys(countries).length;
                if (count > 0) { $scope.userStats.countriesCount = count; }
            }, function() {});
        } catch(e) {}
    }

    calculateUserStats();

    // ------------------------------------------------------------------
    // Setup Audit Trail Scope Handlers & Live Filter Search
    // ------------------------------------------------------------------
    $scope.auditTrailRawRecords = [];
    $scope.auditTrailRecords = [];
    $scope.isLoadingAuditTrail = false;
    /*
     * One object, not three loose strings - the "dot in your ng-model" rule.
     *
     * The Audit Trail panel is wrapped in ng-if, and ng-if creates a child
     * scope. An ng-model bound to a bare `auditSectionFilter` therefore wrote
     * the chosen value onto that child, shadowing the controller's copy,
     * while applyAuditFilters kept reading the controller's - which stayed
     * empty. Every filter appeared to do nothing.
     *
     * Writing through `auditFilters.section` resolves the object on the
     * parent by prototype chain and sets the property there, so the child
     * scope has nothing to shadow. It is also robust to someone wrapping this
     * in another ng-if, ng-repeat or transcluding directive later, which a
     * change to ng-show would not have been.
     */
    $scope.auditFilters = { search: '', section: '', user: '' };
    $scope.auditSectionsList = [];
    $scope.auditUsersList = [];


    /* ----------------------------------------------------------------- */
    /* Bookmarked components                                              */
    /*                                                                    */
    /* A short watch list, and what has happened to it since the last     */
    /* time the panel was open. The check runs here rather than in the    */
    /* service worker because it needs the org session, which lives on    */
    /* this page - so "since you last looked" is the honest promise, not  */
    /* "the moment it happens".                                           */
    /* ----------------------------------------------------------------- */
    $scope.bookmarks = [];
    $scope.bookmarkEvents = [];
    $scope.bookmarkUnseen = 0;
    $scope.bookmarkNotice = '';
    $scope.isCheckingBookmarks = false;
    $scope.maxBookmarks = BookmarkService.max;

    /*
     * Whether a found change raises a toast. The check still runs and the
     * timeline still fills either way - this only governs the interruption.
     */
    $scope.notifyOnWatchChange = BookmarkService.notifyEnabled();

    $scope.toggleWatchNotifications = function(){
        $scope.notifyOnWatchChange =
            BookmarkService.setNotifyEnabled(!$scope.notifyOnWatchChange);
    };

    /*
     * The star is rendered for every visible row and read several times per
     * row per digest - in ng-class, in the title and in the glyph itself.
     * Asking the service each time means a localStorage read and a JSON.parse
     * per call, which at 200 rows is hundreds of parses per digest for a set
     * that changes only when the user clicks a star.
     *
     * So the keys are held as a Set and rebuilt when they actually change.
     */
    var bookmarkKeys = new Set();
    // Bumped wherever the watch list changes, so derived counts can be cached
    // against it instead of recomputed on every digest.
    var bookmarkRevision = 0;

    /*
     * History state, declared here rather than beside the functions that use
     * it.
     *
     * refreshBookmarkState runs while the controller is being built and reads
     * these when the audit-trail preference is already on. A var declared
     * further down hoists as undefined, so historyFetchedKeys.has(...) threw
     * "Cannot read properties of undefined" and took the whole panel with it -
     * the same failure as the hoisting one before it, in state rather than in
     * a function.
     */
    var historyFetchedFor = null;
    var historyRaw = [];
    var historyFetchedKeys = new Set();

    /*
     * What the timeline shows: observed changes, plus audit-trail history when
     * it is switched on.
     *
     * Built into an array rather than merged by a scope function, because the
     * page renders it through ng-repeat - a function there re-merges and
     * re-sorts both lists on every digest, for a result that only changes when
     * one of them does.
     */
    $scope.bookmarkHistory = [];
    $scope.bookmarkTimeline = [];
    $scope.showBookmarkHistory = BookmarkService.historyEnabled();
    $scope.historyNotice = '';
    $scope.isLoadingHistory = false;

    function rebuildTimeline(){
        var merged = $scope.bookmarkEvents.slice();
        if($scope.showBookmarkHistory){ merged = merged.concat($scope.bookmarkHistory); }
        merged.sort(function(a, b){ return (b.at || 0) - (a.at || 0); });

        /*
         * A key ngRepeat can rely on.
         *
         * It tracked by id + timestamp + kind, and that collides: enabling one
         * Apex class for four profiles writes four audit rows naming the same
         * class in the same second, so four events shared a key and Angular
         * threw ngRepeat:dupes - which takes the whole page down, not just the
         * row.
         *
         * The audit row id separates those. The trailing disambiguator is the
         * belt: any future source that cannot distinguish two events still
         * gets distinct keys rather than crashing the panel.
         */
        var seen = Object.create(null);
        merged.forEach(function(event, index){
            var base = [event.source || 'watch', event.type, event.id,
                        event.at, event.kind, event.auditId || ''].join(':');
            event._key = seen[base] ? (base + '#' + index) : base;
            seen[base] = true;
        });

        $scope.bookmarkTimeline = merged;
    }

    function refreshBookmarkState(){
        bookmarkRevision++;
        $scope.bookmarks = BookmarkService.list();
        $scope.bookmarkEvents = BookmarkService.timeline();
        $scope.bookmarkUnseen = BookmarkService.unseenCount();
        bookmarkKeys = new Set($scope.bookmarks.map(function(item){
            return item.type + ':' + item.id;
        }));
        $scope.watchedTypes = BookmarkService.countsByType();
        /*
         * Starring something while history is on has to bring its past with
         * it, or the new row is the only one on the page with no history and
         * nothing says why. Guarded on a fetch already running so a burst of
         * stars costs one query, not one each.
         */
        if($scope.showBookmarkHistory && !$scope.isLoadingHistory &&
           historyFetchedFor !== watchSignature()){
            if(historyCovers(watchKeys())){
                // Nothing new to look up - removing, or re-starring something
                // the last read already covered.
                applyHistoryFilter();
                historyFetchedFor = watchSignature();
                rebuildTimeline();
            }else{
                loadBookmarkHistory();
            }
        }
        // Read back rather than stamped here: the service records it only when
        // the org was actually asked, so a refresh of the view does not make
        // the panel claim a check that never happened.
        $scope.lastBookmarkCheck = BookmarkService.lastCheckedAt();
        rebuildTimeline();
    }
    refreshBookmarkState();

    /*
     * The package.xml basket, from wherever it was left.
     *
     * At construction, not on opening a particular page: the ticks have to be
     * in place before the first list renders, or the checkboxes come up empty
     * against a selection that is really still there.
     *
     * The record basket comes back the same way and for the same reason.
     */
    restorePackageSelection();
    restoreDataSelection();

    /*
     * A declaration, not an expression assigned to $scope.
     *
     * refreshBookmarkState runs during controller construction and calls
     * this; an expression assigned further down the file is still
     * undefined at that moment, which is a TypeError that takes the whole
     * controller with it. Declarations hoist, so call order stops
     * mattering.
     */
    function loadBookmarkHistory(){
        if(!$scope.bookmarks.length){
            $scope.bookmarkHistory = [];
            historyRaw = [];
            historyFetchedKeys = new Set();
            historyFetchedFor = watchSignature();
            rebuildTimeline();
            return $q.when(null);
        }
        $scope.isLoadingHistory = true;
        $scope.historyNotice = '';

        return BookmarkService.auditHistoryFor($scope.bookmarks).then(function(result){
            $scope.isLoadingHistory = false;
            historyRaw = result.events;
            historyFetchedKeys = new Set(watchKeys());
            $scope.bookmarkHistory = result.events;
            historyFetchedFor = watchSignature();

            var notes = [];
            if(result.refused){
                notes.push('The setup audit trail could not be read - it needs the ' +
                           '"View Setup and Configuration" permission.');
            }
            if(result.truncated){
                notes.push('Only the most recent ' + BookmarkService.historyDays +
                           ' days of audit trail were read, and that was full - ' +
                           'older changes exist that are not shown.');
            }
            if(result.tooShort){
                notes.push(result.tooShort + ' watched ' +
                           (result.tooShort === 1 ? 'component has a name' : 'components have names') +
                           ' too short to match safely, so ' +
                           (result.tooShort === 1 ? 'it is' : 'they are') + ' left out.');
            }
            $scope.historyNotice = notes.join(' ');
            rebuildTimeline();
            return result;
        }, function(){
            $scope.isLoadingHistory = false;
            $scope.historyNotice = 'Audit trail history could not be loaded.';
            rebuildTimeline();
            return null;
        });
    }
    $scope.loadBookmarkHistory = loadBookmarkHistory;
/* ----------------------------------------------------------------- */
    /* Auto-refresh                                                       */
    /*                                                                    */
    /* A timer that re-checks the watch list while the panel is open.     */
    /* It keeps running when you move to another section, because being   */
    /* told a component changed while you are working on something else   */
    /* is the whole point of watching it.                                 */
    /* ----------------------------------------------------------------- */
    var autoRefreshTimer = null;

    $scope.autoRefreshChoices = BookmarkService.autoRefreshChoices;
    $scope.autoRefreshMinutes = BookmarkService.autoRefreshMinutes();
    $scope.lastBookmarkCheck = BookmarkService.lastCheckedAt();

    function stopAutoRefresh(){
        if(autoRefreshTimer){
            $interval.cancel(autoRefreshTimer);
            autoRefreshTimer = null;
        }
    }

    function startAutoRefresh(){
        stopAutoRefresh();
        var minutes = $scope.autoRefreshMinutes;
        if(!minutes){ return; }

        autoRefreshTimer = $interval(function(){
            /*
             * Every reason to skip a tick, checked at the tick rather than at
             * setup - all of them can change while the timer is running, and a
             * timer that queries a signed-out org every five minutes produces
             * a failure notice on a loop.
             */
            if(!$scope.hasSession){ return; }
            if($scope.isCheckingBookmarks){ return; }
            if(!BookmarkService.count()){ return; }

            checkBookmarks(true);
        }, minutes * 60 * 1000);
    }

    $scope.setAutoRefresh = function(minutes){
        $scope.autoRefreshMinutes = BookmarkService.setAutoRefreshMinutes(minutes);
        startAutoRefresh();
    };

    /*
     * The timer outlives the view unless something stops it.
     *
     * $interval is not tied to a scope, so a controller destroyed with a live
     * timer leaves it running against a dead scope - queries continue, the
     * toast tries to render into nothing, and closing the panel does not stop
     * either. This is the only thing that ends it.
     */
    $scope.$on('$destroy', stopAutoRefresh);

    startAutoRefresh();

    /*
     * Which components the history on screen was actually fetched for.
     *
     * The old test was "have we got any history yet", which is wrong in both
     * directions. Star three more components and their past never arrives -
     * the list already had entries, so nothing refetched, and the new rows sat
     * there with no history for a reason nothing on screen explained. And when
     * the first fetch legitimately found nothing, every toggle re-queried the
     * whole audit trail to find nothing again.
     */

    /*
     * Everything the last read returned, and which components it covered.
     *
     * Kept apart from what is on screen so that removing a component costs
     * nothing. The audit trail read is a query over six months of setup
     * changes; running it again because the user unstarred one row - when the
     * answer is a subset of what is already in hand - is a lot of work to
     * produce less data. Re-starring something is free for the same reason:
     * its rows never left this array.
     */

    function watchKeys(){
        return $scope.bookmarks.map(function(item){
            return item.type + ':' + item.id;
        });
    }

    function watchSignature(){
        return watchKeys().sort().join('|');
    }

    // True when the watch list has nothing the last read did not already cover.
    function historyCovers(keys){
        return keys.every(function(key){ return historyFetchedKeys.has(key); });
    }

    // The rows for the components currently watched, out of what was fetched.
    function applyHistoryFilter(){
        var current = new Set(watchKeys());
        $scope.bookmarkHistory = historyRaw.filter(function(event){
            return current.has(event.type + ':' + event.id);
        });
    }

    $scope.toggleBookmarkHistory = function(){
        $scope.showBookmarkHistory = !$scope.showBookmarkHistory;
        BookmarkService.setHistoryEnabled($scope.showBookmarkHistory);

        if($scope.showBookmarkHistory && historyFetchedFor !== watchSignature()){
            loadBookmarkHistory();
        } else {
            rebuildTimeline();
        }
    };

    $scope.isBookmarked = function(record){
        if(!record || !record.Id || !$scope.selectedMetadata){ return false; }
        /*
         * Keyed the same way it was stored.
         *
         * add() records the row's real type - an Apex class starred from
         * Recently Viewed is an ApexClass - while this read the menu, so it
         * looked up RecentlyViewed:01p... and never found anything. The star
         * stayed hollow on the one list where the two disagree, which is the
         * only list where any of this matters.
         */
        return bookmarkKeys.has(resolveWatchType(record) + ':' + record.Id);
    };

    /*
     * Only rows with a real Id can be watched.
     *
     * EntityDefinition and friends are addressed by QualifiedApiName and have
     * no ordinary Id, so there is nothing to query them back by later - the
     * star is hidden for those rather than offered and then silently failing.
     */
    /*
     * Which metadata type a starred row really is.
     *
     * The menu entry is the wrong answer on the mixed lists. Recently Viewed
     * queries one object and returns rows belonging to many, so starring an
     * Apex class there recorded it as a "Recently viewed" - the watch list
     * showed that as its type for every row, and the change check then asked
     * FROM RecentlyViewed for an id that does not live there.
     *
     * The row knows: RecentlyViewed carries Type, and every REST record
     * carries attributes.type. Type is checked first because on a mixed list
     * it is the real object while attributes.type is only the list that was
     * queried - but Type is not always an object name (a Group's Type is
     * "Public", a Document's is "Image"), so it is only believed when the
     * org's own catalogue says an object of that name exists. That way no
     * table of exceptions has to be kept.
     */
    function resolveWatchType(record){
        var menuType = $scope.selectedMetadata &&
                       ($scope.selectedMetadata.value || $scope.selectedMetadata.label);
        if(!record){ return menuType; }

        var declared = record.Type;
        if(declared && typeof declared === 'string'){
            var real = false;
            try{
                real = SchemaService.restCanQuery(declared) ||
                       SchemaService.toolingCanQuery(declared);
            }catch(e){ real = false; }
            if(real){ return declared; }
        }

        return (record.attributes && record.attributes.type) || menuType;
    }

    /*
     * A menu-entry shape carrying the row's real type, for the watch list to
     * store. The label is the type itself when it differs from the menu, since
     * "Recently viewed" is not what the row is.
     */
    function watchMetaFor(record){
        var type = resolveWatchType(record);
        var menu = $scope.selectedMetadata || {};
        var sameAsMenu = type === (menu.value || menu.label);
        return {
            value: type,
            label: sameAsMenu ? (menu.label || type) : type
        };
    }

    $scope.canBookmark = function(record){
        return !!(record && record.Id && $scope.selectedMetadata &&
                  $scope.selectedMetadata.value);
    };

    $scope.toggleBookmark = function(record){
        if(!$scope.canBookmark(record)){ return; }
        var type = resolveWatchType(record);
        $scope.bookmarkNotice = '';

        if(BookmarkService.isBookmarked(type, record.Id)){
            BookmarkService.remove(type, record.Id);
            refreshBookmarkState();
            return;
        }

        var result = BookmarkService.add(record, watchMetaFor(record));
        if(!result.ok){
            /*
             * Said where the click was, not only on the watching list.
             *
             * bookmarkNotice is rendered on that page, which is not where the
             * star is - so a refusal set only there is a click that appears to
             * do nothing at all, and the reason is behind a navigation nobody
             * has a reason to make.
             */
            $scope.bookmarkNotice = result.reason;
            $scope.showToast({
                variant: 'warning',
                icon: '\u2605',
                title: result.full ? 'Watch list is full' : 'Not watching this',
                lines: [result.reason],
                // "View" goes where the fix is: the list it is full of.
                action: result.full ? $scope.openWatchingList : null
            });
            return;
        }
        if(result.saved === false){
            $scope.bookmarkNotice = 'Bookmarked, but it could not be saved - ' +
                                    'browser storage is full or blocked.';
        }
        refreshBookmarkState();
        if(typeof ssCountUse === 'function'){ ssCountUse('componentsWatched', 1); }

        /*
         * A row the list did not carry a timestamp for has no baseline, so the
         * first check would call it changed. Establishing one now costs a
         * single query and makes the first report true.
         */
        if(!record.LastModifiedDate){
            $q.when(sfdc.query('SELECT Id, LastModifiedDate, LastModifiedById FROM ' +
                    type + " WHERE Id = '" + escapeSoqlLiteral(record.Id) + "'"))
                .then(function(data){
                    var row = data && data.records && data.records[0];
                    if(row){ BookmarkService.baseline(type, record.Id, row); refreshBookmarkState(); }
                }, function(){});
        }
    };

    /*
     * Through to the full page.
     *
     * Routed through the same openMetadata every menu row uses, rather than
     * setting selectedMetadata directly - that is what runs the open branch,
     * records the visit and re-reads the stored list, and skipping it would
     * land on a page that renders from whatever happened to be in scope.
     */
    $scope.openWatchingList = function(){
        var entry = MetaDataContainer.byValue('WatchingList');
        if(entry){ openMetadata(entry, { fullPane: true }); }
    };

    /*
     * The manifest page, from the footer count.
     *
     * The same shape as the watching list above, and the reason the sidebar
     * cards could go: every action they carried - verify, download, retrieve,
     * remove a type - already lives on this page. The card was a second place
     * to find them.
     */
    $scope.openPackageXml = function(){
        var entry = MetaDataContainer.byValue($scope.packagexml);
        if(entry){ openMetadata(entry, { fullPane: true }); }
    };

    /*
     * From the package to the org that is going to receive it.
     *
     * The two screens are halves of one job - this one says which components,
     * that one says which org - and the selection is shared, so nothing is
     * carried across but the user. Offered only when something is ticked:
     * with an empty selection there is nothing to send, and the sync page
     * would open with a button that can only refuse.
     *
     * Navigation, not the send itself. The send stays on the sync page next
     * to the pipeline it will run down, because which org this goes to is
     * the decision worth making deliberately.
     */
    $scope.openSyncJobs = function(){
        var entry = MetaDataContainer.byValue('SyncJobs');
        if(entry){ openMetadata(entry, { fullPane: true }); }
    };

    /*
     * Watch everything in the list, the way Select all works for package.xml -
     * acting on the rows the search and namespace filters have actually left
     * on screen, not on everything loaded.
     *
     * Unlike package.xml, this has a hard ceiling: the watch list is capped,
     * and every watched component costs a query on every check. So a list
     * longer than the remaining room fills what is left and says how many were
     * taken, rather than silently watching a prefix of the list.
     */
    $scope.allWatched = function(context){
        var list = packageListFor(context).filter($scope.canBookmark);
        return list.length > 0 && list.every($scope.isBookmarked);
    };

    /*
     * Anything at all watched in this list, which is what the control turns on.
     *
     * It used to flip only when every visible row was watched, and that state
     * is unreachable on any list longer than the cap: Watch all takes the
     * first hundred, allWatched stays false because the rest are not watched,
     * so the button still reads "Watch all", pressing it adds nothing because
     * the list is full, and there is no way left to clear it from here.
     *
     * Partial selections have the same problem more quietly - star three rows
     * by hand and the only way to undo them is three more clicks.
     */
    /*
     * How many of the rows in front of you are watched.
     *
     * Counted rather than merely detected, because "Unwatch all" over a list of
     * 42 says nothing about whether that means 42 or 1 - and the star column is
     * only readable a screenful at a time.
     *
     * Memoised on the watch list's revision and the array identity. Both are
     * exact: records are replaced wholesale on each fetch, and every change to
     * the watch list goes through refreshBookmarkState. It matters because
     * isBookmarked resolves each row's real type, which is a schema lookup per
     * row - and this is read from a binding, so it runs on every digest.
     */
    var watchedCountCache = {};

    $scope.watchedCount = function(context){
        var list = packageListFor(context);
        var cached = watchedCountCache[context];
        if(cached && cached.list === list && cached.revision === bookmarkRevision){
            return cached.count;
        }
        var count = list.filter($scope.canBookmark).filter($scope.isBookmarked).length;
        watchedCountCache[context] = { list: list, revision: bookmarkRevision, count: count };
        return count;
    };

    /*
     * How many rows a list actually has, asked of the controller.
     *
     * The templates used to read myFilterItem and allFilterItem - variables the
     * ng-repeat assigns as it renders. Everything above the table read them:
     * the heading, its count, the column header, the empty state. All of those
     * come first in the DOM, so they were reading a value the element below
     * them had not written yet, and the result was a heading that said 47 over
     * an empty table and "No Permission Set to show for the whole org" sitting
     * directly on top of forty-seven permission sets.
     *
     * packageListFor applies the same search and namespace filters and is
     * cached on the list and the filter signature, so this is a count that
     * cannot disagree with the rows and costs nothing to ask for.
     *
     * Deliberately not limited by renderLimit: this is how many match, and how
     * many are drawn is what the "more rows" line below the table is for.
     */
    $scope.visibleCount = function(context){
        return packageListFor(context).length;
    };

    $scope.anyWatched = function(context){
        return $scope.watchedCount(context) > 0;
    };

    $scope.watchAllVisible = function(context){
        var list = packageListFor(context).filter($scope.canBookmark);
        if(!list.length){ return; }
        $scope.bookmarkNotice = '';

        /*
         * Anything watched means the click clears, rather than only a fully
         * watched list. On a list longer than the cap 'fully watched' never
         * happens, so the old test left no way to undo a Watch all.
         */
        if($scope.anyWatched(context)){
            list.forEach(function(record){
                BookmarkService.remove(resolveWatchType(record), record.Id);
            });
            refreshBookmarkState();
            return;
        }

        var added = 0;
        var refused = 0;
        list.forEach(function(record){
            if($scope.isBookmarked(record)){ return; }
            var result = BookmarkService.add(record, watchMetaFor(record));
            if(result.ok){ added++; } else { refused++; }
        });
        refreshBookmarkState();

        if(refused){
            var summary = added
                ? 'Watching ' + added + ' more. ' + refused + ' would not fit - the ' +
                  'watch list holds ' + BookmarkService.max + ' and is now full.'
                : 'None were added - the watch list is already full at ' +
                  BookmarkService.max + ' components.';
            $scope.bookmarkNotice = summary;
            // Same reasoning as a single star: this is a click on a record
            // list, and the page that shows bookmarkNotice is elsewhere.
            $scope.showToast({
                variant: 'warning',
                icon: '\u2605',
                title: 'Watch list is full',
                lines: [summary],
                action: $scope.openWatchingList
            });
        }

        /*
         * Baselines for the ones the list had no timestamp for, in one query
         * per type rather than one per component - checkForChanges already
         * batches by type, and a null baseline is adopted rather than reported
         * as a change, so this is a correctness nicety and not a race.
         */
        if(added){ checkBookmarks(false); }
    };

    $scope.removeBookmark = function(item){
        if(!item){ return; }
        BookmarkService.remove(item.type, item.id);
        refreshBookmarkState();
    };

    /*
     * Clearing a whole type. Grouped once into a scope array rather than by a
     * function in ng-repeat - the page renders one chip per type, and a getter
     * there regroups and re-sorts the entire list on every digest.
     */
    $scope.removeWatchedType = function(type){
        if(!type){ return; }
        BookmarkService.removeType(type);
        $scope.bookmarkNotice = '';
        refreshBookmarkState();
    };

    $scope.clearAllBookmarks = function(){
        BookmarkService.clear();
        $scope.bookmarkNotice = '';
        refreshBookmarkState();
    };

    $scope.clearBookmarkTimeline = function(){
        BookmarkService.clearTimeline();
        refreshBookmarkState();
    };

    $scope.markBookmarksSeen = function(){
        BookmarkService.markAllSeen();
        refreshBookmarkState();
    };

    /*
     * A declaration, not an expression assigned to $scope.
     *
     * refreshBookmarkState runs during controller construction and calls
     * this; an expression assigned further down the file is still
     * undefined at that moment, which is a TypeError that takes the whole
     * controller with it. Declarations hoist, so call order stops
     * mattering.
     */
    function checkBookmarks(announce){
        if($scope.isCheckingBookmarks || !BookmarkService.count()){ return $q.when([]); }
        $scope.isCheckingBookmarks = true;
        $scope.bookmarkNotice = '';

        return BookmarkService.checkForChanges().then(function(events){
            $scope.isCheckingBookmarks = false;
            refreshBookmarkState();
            // The check and the timeline are unaffected by the preference; only the
            // interruption is.
            if(announce && events.length && BookmarkService.notifyEnabled()){
                /*
                 * One component changed, and it still exists: go straight to
                 * it in a new tab, which is what the notification is about.
                 * Several, or a deleted one, has no single record to open - a
                 * deleted id resolves to a Salesforce error page - so those
                 * land on the Watching List, where every row links onward.
                 */
                var only = events.length === 1 ? events[0] : null;
                var openable = only && only.kind !== 'deleted' && only.id && $scope.baseUrl;

                $scope.showToast({
                    variant: 'warning',
                    icon: '★',
                    title: events.length === 1 ? 'A bookmarked component changed'
                                               : events.length + ' bookmarked components changed',
                    lines: events.slice(0, 3).map(function(event){
                        return event.name + ' - ' +
                               (event.kind === 'deleted' ? 'deleted'
                                                         : 'edited' + (event.byName ? ' by ' + event.byName : ''));
                    }),
                    action: openable
                        ? function(){ window.open($scope.baseUrl + '/' + only.id, '_blank'); }
                        : function(){ $scope.openWatchingList(); }
                });
            }
            return events;
        }, function(){
            $scope.isCheckingBookmarks = false;
            $scope.bookmarkNotice = 'Bookmarks could not be checked just now.';
            return [];
        });
    }
    $scope.checkBookmarks = checkBookmarks;
/* ----------------------------------------------------------------- */
    /* Who is in the org today                                            */
    /*                                                                    */
    /* The audit trail answers "what changed", and the question it always  */
    /* raises next is "who else is in here" - during a release, before a   */
    /* deployment, or when a change appears that nobody claims.            */
    /*                                                                     */
    /* Taken from LoginHistory rather than from the audit rows on screen,   */
    /* because those two are not the same set: the audit trail lists only   */
    /* people who changed setup, and most people using an org change        */
    /* nothing. Answering "who is using this org" from setup changes would  */
    /* silently omit everyone doing ordinary work.                          */
    /*                                                                     */
    /* It needs the same "View Setup and Configuration" permission as       */
    /* SetupAuditTrail itself, so it fails exactly when the page does and   */
    /* costs nothing to the user who cannot see either.                     */
    /* ----------------------------------------------------------------- */
    $scope.activeUsersToday = [];
    $scope.activeUsersTodayError = '';
    $scope.isLoadingActiveUsersToday = false;

    $scope.isAuditTrailPage = function(){
        return !!($scope.selectedMetadata &&
                  ($scope.selectedMetadata.value === 'AuditTrail' ||
                   $scope.selectedMetadata.value === $scope.audittrail));
    };

    // TODAY is resolved in the viewer's own timezone, which is the only
    // reading of "today" that matches what they see in Salesforce.
    var ACTIVE_TODAY_SOQL =
        "SELECT UserId, LoginTime, Status, Application, LoginType FROM LoginHistory " +
        "WHERE LoginTime = TODAY ORDER BY LoginTime DESC LIMIT 1000";

    function summariseLogins(records){
        var byUser = Object.create(null);
        (records || []).forEach(function(row){
            var id = row && row.UserId;
            if(!id){ return; }
            var seen = byUser[id];
            if(!seen){
                seen = byUser[id] = {
                    userId: id, name: '', username: '',
                    logins: 0, failures: 0, lastLogin: null,
                    applications: Object.create(null)
                };
            }
            seen.logins++;
            // Anything but Success is a refusal - a locked-out admin mid-release
            // is the single most useful row this card can carry.
            if(row.Status && row.Status !== 'Success'){ seen.failures++; }
            if(row.Application){ seen.applications[row.Application] = true; }
            if(!seen.lastLogin || row.LoginTime > seen.lastLogin){
                seen.lastLogin = row.LoginTime;
            }
        });
        return byUser;
    }

    $scope.loadActiveUsersToday = function(){
        $scope.isLoadingActiveUsersToday = true;
        $scope.activeUsersTodayError = '';

        return sfdc.query(ACTIVE_TODAY_SOQL).then(function(data){
            var byUser = summariseLogins(data && data.records);
            var ids = Object.keys(byUser);
            if(!ids.length){
                $scope.isLoadingActiveUsersToday = false;
                $scope.activeUsersToday = [];
                return;
            }

            /*
             * Names come from a second query.
             *
             * LoginHistory carries UserId and no name, and the User
             * relationship is not traversable on it in every org - so the ids
             * are resolved separately rather than risking a query that works
             * in one org and fails in the next.
             */
            var quoted = ids.slice(0, 200).map(function(id){
                return "'" + escapeSoqlLiteral(id) + "'";
            }).join(',');

            return $q.when(sfdc.query(
                "SELECT Id, Name, Username FROM User WHERE Id IN (" + quoted + ")"
            )).then(function(users){
                ((users && users.records) || []).forEach(function(user){
                    if(byUser[user.Id]){
                        byUser[user.Id].name = user.Name || '';
                        byUser[user.Id].username = user.Username || '';
                    }
                });
                return byUser;
            }, function(){
                // Names refused; the ids still answer "how many, and how busy".
                return byUser;
            }).then(function(resolved){
                $scope.isLoadingActiveUsersToday = false;
                $scope.activeUsersToday = Object.keys(resolved).map(function(id){
                    var row = resolved[id];
                    row.label = row.name || row.userId;
                    row.applications = Object.keys(row.applications);
                    return row;
                }).sort(function(a, b){
                    // Busiest first, then most recent - the people actually in
                    // the org right now, rather than alphabetical order.
                    return (b.logins - a.logins) ||
                           String(b.lastLogin || '').localeCompare(String(a.lastLogin || ''));
                });
            });
        }, function(err){
            $scope.isLoadingActiveUsersToday = false;
            $scope.activeUsersToday = [];
            $scope.activeUsersTodayError =
                sfdc.errorMessage(err, 'Login history') ||
                'Login history could not be read.';
        });
    };

    /*
     * Filter the audit trail to one of today's users.
     *
     * The name, not the label. label falls back to the user's Id when the org
     * refused the name query, and an Id matches nothing in the audit trail -
     * Quick Find compares against CreatedBy.Name. Pasting an Id would look
     * exactly like a filter that found nothing, rather than one that was
     * given nothing to find, so a row with no name does not offer the click
     * at all.
     */
    $scope.canFindAuditUser = function(person){
        return !!(person && person.name);
    };

    $scope.findAuditUser = function(person){
        if(!$scope.canFindAuditUser(person)){ return; }

        $scope.auditFilters = $scope.auditFilters || { search: '', section: '', user: '' };

        /*
         * Clicking the name already in the box clears it. Without that the
         * only way back to the whole trail is to select the text and delete
         * it, which is a strange thing to have to do to a list you filtered
         * with one click.
         */
        $scope.auditFilters.search =
            ($scope.auditFilters.search === person.name) ? '' : person.name;

        $scope.applyAuditFilters();
    };

    $scope.loadAuditTrail = function() {
        $scope.isLoadingAuditTrail = true;
        $scope.auditTrailError = '';
        $scope.loadActiveUsersToday();
        var soql = "SELECT Id, Action, Section, Display, CreatedById, CreatedBy.Name, CreatedBy.Username, CreatedDate, DelegateUser FROM SetupAuditTrail ORDER BY CreatedDate DESC LIMIT 300";
        sfdc.query(soql).then(function(data) {
            $scope.isLoadingAuditTrail = false;
            var records = (data && data.records) ? data.records : [];
            $scope.auditTrailRawRecords = records;
            
            var sectionMap = {};
            var userMap = {};
            records.forEach(function(r) {
                if (r.Section) { sectionMap[r.Section] = true; }
                var uName = (r.CreatedBy && r.CreatedBy.Name) ? r.CreatedBy.Name : r.CreatedById;
                if (uName) { userMap[uName] = true; }
            });

            $scope.auditSectionsList = Object.keys(sectionMap).sort();
            $scope.auditUsersList = Object.keys(userMap).sort();

            $scope.applyAuditFilters();
        }, function(err) {
            $scope.isLoadingAuditTrail = false;
            $scope.auditTrailRawRecords = [];
            $scope.auditTrailRecords = [];
            /*
             * Say what happened. SetupAuditTrail needs "View Setup and
             * Configuration", so the common failure here is a permission the
             * user does not have - which used to empty the page in silence
             * and, because the session state is re-read on this path, looked
             * like being signed out rather than being told no.
             */
            $scope.auditTrailError = sfdc.errorMessage(err, 'Setup Audit Trail') ||
                'Setup Audit Trail could not be loaded.';
            refreshSessionState();
        });
    };

    /* ----------------------------------------------------------------- */
    /* About                                                              */
    /*                                                                    */
    /* The facts someone needs when they report a problem: which build,   */
    /* which API version the org negotiated, which host, which instance,  */
    /* and whether the session came from the cookie or a Connected App.   */
    /* Guessing at these in a bug report is what makes one unanswerable,  */
    /* so the page shows them and offers them as one block of text.       */
    /* ----------------------------------------------------------------- */

    $scope.about = {
        version: '',
        apiVersion: '',
        orgHost: SS_ORIGIN,
        instance: '',
        sessionMode: '',
        copied: false
    };

    $scope.loadAbout = function(){
        try{
            $scope.about.version = chrome.runtime.getManifest().version;
        }catch(e){
            // Not an extension context (test harness).
        }

        $scope.about.sessionMode = ssUsingOAuth() ? 'Connected App token' : 'Session cookie';

        // Cached for a week per org, so this is normally already resolved.
        $q.when(fetchLatestApiVersion()).then(function(version){
            $scope.about.apiVersion = version || SS_API_VERSION;
        }, function(){
            $scope.about.apiVersion = SS_API_VERSION;
        });

        // Memoised on TrustService, so opening this after Trust Status - or
        // the other way round - costs one query between them, not two.
        TrustService.getInstanceKey().then(function(key){
            $scope.about.instance = key;
        }, function(){
            $scope.about.instance = 'Not available';
        });
    };

    // One block of text for a bug report. Everything here is already on the
    // screen - this only saves retyping it.
    $scope.copyDiagnostics = function(){
        var lines = [
            'Salesforce Simplified ' + ($scope.about.version || 'unknown'),
            'Salesforce API: v' + ($scope.about.apiVersion || 'unknown'),
            'Org host: ' + $scope.about.orgHost,
            'Instance: ' + ($scope.about.instance || 'unknown'),
            'Session: ' + $scope.about.sessionMode,
            'Browser: ' + navigator.userAgent
        ].join('\n');

        function report(ok){
            $scope.$applyAsync(function(){
                $scope.about.copied = ok;
                $timeout(function(){ $scope.about.copied = false; }, 2500);
            });
        }

        if(navigator.clipboard && navigator.clipboard.writeText){
            // Reports what actually happened rather than claiming success on
            // a refused clipboard write.
            navigator.clipboard.writeText(lines).then(function(){ report(true); },
                                                      function(){ report(false); });
        }else{
            report(false);
        }
    };

    $scope.applyAuditFilters = function() {
        var filters = $scope.auditFilters || {};
        var query = (filters.search || '').toLowerCase().trim();
        var secFilter = filters.section || '';
        var usrFilter = filters.user || '';

        $scope.auditTrailRecords = $scope.auditTrailRawRecords.filter(function(item) {
            var matchSec = !secFilter || item.Section === secFilter;
            var userName = (item.CreatedBy && item.CreatedBy.Name) ? item.CreatedBy.Name : '';
            var matchUsr = !usrFilter || userName === usrFilter;

            if (!matchSec || !matchUsr) { return false; }
            if (!query) { return true; }

            var actionStr = (item.Action || '').toLowerCase();
            var sectionStr = (item.Section || '').toLowerCase();
            var displayStr = (item.Display || '').toLowerCase();
            var userStr = userName.toLowerCase();

            return actionStr.indexOf(query) !== -1 ||
                   sectionStr.indexOf(query) !== -1 ||
                   displayStr.indexOf(query) !== -1 ||
                   userStr.indexOf(query) !== -1;
        });
    };

    // ------------------------------------------------------------------
    // Salesforce Trust Status (org-specific)
    // ------------------------------------------------------------------
    $scope.trustStatus = {
        loading: false, loaded: false, error: '',
        key: '', location: '', statusClass: '', statusLabel: '',
        maintenanceWindow: '', incidents: [], messages: [], maintenances: []
    };

    // Status labels live on TrustService: the footer ticker names the same
    // statuses, and one wording for a status code is enough.

    function trustStatusClass(status){
        if(status === 'OK'){ return 'ok'; }
        if(status.indexOf('MAJOR_INCIDENT') === 0){ return 'incident'; }
        if(status.indexOf('MINOR_INCIDENT') === 0){ return 'warning'; }
        return 'maintenance';
    }

    // Loaded lazily on first open and then kept; Refresh re-pulls.
    $scope.loadTrustStatus = function(){
        if($scope.trustStatus.loaded){ return; }
        $scope.refreshTrustStatus();
    };

    $scope.refreshTrustStatus = function(){
        $scope.trustStatus.loading = true;
        $scope.trustStatus.error = '';
        TrustService.loadStatus().then(function(result){
            $scope.trustStatus.loading = false;
            if(!result || result.error){
                $scope.trustStatus.error = (result && result.error) || 'Trust Status is unavailable.';
                $scope.trustStatus.loaded = false;
                return;
            }
            $scope.trustStatus.key = result.key;
            $scope.trustStatus.location = result.location;
            $scope.trustStatus.statusClass = trustStatusClass(result.status);
            $scope.trustStatus.statusLabel = TrustService.statusLabel(result.status);
            $scope.trustStatus.maintenanceWindow = result.maintenanceWindow;
            $scope.trustStatus.incidents = result.incidents;
            $scope.trustStatus.messages = result.messages;
            $scope.trustStatus.maintenances = result.maintenances;
            $scope.trustStatus.loaded = true;
        });
    };

    /* ----------------------------------------------------------------- */
    /* Event Graph                                                        */
    /*                                                                    */
    /* The panel's side of js/event-graph. Everything that decides what a  */
    /* trace means lives there; this turns a trace into what the template  */
    /* binds to, and drives the replay clock.                              */
    /*                                                                    */
    /* The one piece of real logic here is edge geometry, which has to be  */
    /* here because it depends on the laid-out positions rather than on    */
    /* the graph.                                                          */
    /* ----------------------------------------------------------------- */

    $scope.eg = {
        root: {}, view: 'ALL', loading: false, error: '', built: false,
        stats: {}, layout: { width: 0, height: 0 }, positions: [], edgePaths: [],
        nodeStates: {}, edgeStates: {}, timeline: { rows: [], lanes: 0, skips: [] },
        selected: null, selectedId: null, selectedEdgeId: null, selectedEvidence: [],
        selectedInput: '', selectedOutput: '',
        filter: { text: '', failuresOnly: false, slowOnly: false, minConfidence: 'UNKNOWN' },
        grouping: true, playing: false, speed: 1, scrub: 0, clock: '',
        playheadPx: 0, parallel: false, activeCount: 0, compressed: false,
        chain: [], gaps: [], problems: [], answer: null,
        manualKind: 'record', manualId: '', ingestText: '', ingestResult: '',
        elapsed: '', depth: 2, includeHistory: true, collected: {}, replaying: false,
        emptyReason: null, inventory: [], excluded: [], included: [], skipped: [],
        excludedStale: false, budget: 8,
        /* Folded away until asked for - see the note on the template. */
        showSkipped: false
    };

    $scope.egDepths = [
        { value: 1, label: '1 hop - direct relations' },
        { value: 2, label: '2 hops - and theirs' },
        { value: 3, label: '3 hops - wide' }
    ];

    $scope.egViews = [
        { key: 'ALL',       label: 'Everything', hint: 'Every event collected' },
        { key: 'USER',      label: 'User',       hint: 'What the person did, and what came of it' },
        { key: 'RECORD',    label: 'Record',     hint: 'Records, their changes and what touched them' },
        { key: 'TECHNICAL', label: 'Technical',  hint: 'The execution path through components and APIs' },
        { key: 'BUSINESS',  label: 'Business',   hint: 'The transaction, in business terms' },
        { key: 'AGENT',     label: 'Agent',      hint: 'Agent and tool activity' }
    ];

    $scope.egRootKinds = [
        { value: 'record',      label: 'Record' },
        { value: 'user',        label: 'User' },
        { value: 'session',     label: 'Session' },
        { value: 'transaction', label: 'Transaction' },
        { value: 'component',   label: 'Component' },
        { value: 'api',         label: 'API' },
        { value: 'agent',       label: 'Agent' },
        { value: 'mcpTool',     label: 'MCP tool' }
    ];

    $scope.egSpeeds = [0.25, 0.5, 1, 2, 4];
    $scope.egRootOptions = [];
    $scope.egConfidenceBands = [];

    var egPlayer = null;
    var egCurrent = null;

    /*
     * Built when the page opens rather than at construction: it reads the URL,
     * and on the standalone page the org is not resolved when the controller
     * is created.
     */
    $scope.loadEventGraph = function(){
        try {
            $scope.egRootOptions = EventGraphService.traceOptions();
        } catch(e) {
            $scope.egRootOptions = [];
        }
        var context = EventGraphService.context();
        if(context.recordId && !$scope.eg.manualId){
            $scope.eg.manualId = context.recordId;
        }
        /* The navigation that brought the user here is itself evidence, and the
         * only first-hand event the extension will ever have. */
        EventGraphService.observeNavigation();
        EventGraphService.observeAction('Opened Event Graph');
    };

    /*
     * Tracing a record walks its relationships; tracing anything else collects
     * execution telemetry.
     *
     * The split matters because the two answer different questions from
     * different data. A record graph is built from lookups and audit fields -
     * present in every org, every edge confirmed. An execution trace needs
     * debug logs or instrumentation, which most orgs do not have for the
     * transaction being investigated, and which is why tracing a record the
     * old way produced two nodes and five gap notices.
     */
    $scope.egTrace = function(option){
        if(!option){ return; }
        $scope.eg.error = '';
        $scope.eg.loading = true;
        $scope.eg.chain = [];
        $scope.eg.root = { kind: option.kind, id: option.id, objectType: option.objectType };

        var collecting = option.kind === 'record'
            ? EventGraphService.collectRecordGraph({
                id: option.id,
                objectType: option.objectType,
                depth: Number($scope.eg.depth) || 2,
                maxChildRelations: Number($scope.eg.budget),
                includeHistory: $scope.eg.includeHistory !== false
            })
            : EventGraphService.collect({
                kind: option.kind,
                id: option.id,
                objectType: option.objectType
            });

        collecting.then(function(result){
            $scope.eg.loading = false;
            $scope.eg.collected = result || {};
            $scope.eg.inventory = (result && result.inventory) || [];
            $scope.eg.skipped = (result && result.skipped) || [];
            $scope.eg.excluded = EventGraphService.excludedObjects();
            $scope.eg.included = EventGraphService.includedObjects();
            /*
             * A record graph starts on the record view, because the question
             * being asked is about records. The execution views are still
             * there and still project the same graph.
             */
            if(option.kind === 'record'){
                $scope.eg.view = 'RECORD';
            }
            $scope.egRefresh();
        }, function(error){
            $scope.eg.loading = false;
            $scope.eg.error = (error && error.message) ||
                'The trace could not be collected.';
        });
    };

    /* Re-walk at a different depth. Cheap to offer and the control people
     * reach for first when a graph is too small or too busy. */
    $scope.egSetDepth = function(){
        if(!$scope.eg.root.id || $scope.eg.root.kind !== 'record'){ return; }
        EventGraphService.reset();
        $scope.egTrace({ kind: 'record', id: $scope.eg.root.id,
                         objectType: $scope.eg.root.objectType });
    };

    /* ---- Excluding objects ------------------------------------------- */

    /*
     * Hide now, and stop fetching next time.
     *
     * Two effects on purpose. Hiding is instant, because a redraw needs no
     * queries and waiting for a re-walk to see the result of a checkbox is
     * miserable. Not fetching is what actually makes a large org workable, and
     * that only takes effect on the next walk - so the panel offers the re-walk
     * rather than forcing one, and says what it is for.
     */
    $scope.egToggleObject = function(name){
        if(!name){ return; }
        $scope.eg.excluded = EventGraphService.toggleExcluded(name);
        $scope.eg.excludedStale = true;
        $scope.egRefresh();
    };

    $scope.egToggleSkipped = function(){
        $scope.eg.showSkipped = !$scope.eg.showSkipped;
    };

    /*
     * Pin a relationship the budget dropped.
     *
     * Unlike excluding, this cannot take effect without going back to the org -
     * the object was never queried, so there is nothing held to reveal. The
     * re-walk is therefore automatic here, where for exclusion it is offered:
     * a click that visibly does nothing until you find a second button is
     * worse than a click that costs a few seconds.
     */
    $scope.egIncludeObject = function(name){
        if(!name || $scope.eg.loading){ return; }
        $scope.eg.included = EventGraphService.toggleIncluded(name);
        $scope.egSetDepth();
    };

    $scope.egIsPinned = function(name){
        return ($scope.eg.included || []).indexOf(name) !== -1;
    };

    /*
     * How many relationships to follow per record.
     *
     * Each one is a query per record at that hop, so this is the control with
     * the steepest cost - twenty records at hop one and a budget of thirty is
     * six hundred queries. The labels say so rather than leaving somebody to
     * find out by waiting.
     */
    $scope.egBudgets = [
        { value: 8,  label: '8 per record (default)' },
        { value: 15, label: '15 per record' },
        { value: 30, label: '30 per record - slow' },
        { value: -1, label: 'Every relationship - very slow' }
    ];

    $scope.egSetBudget = function(){
        if(!$scope.eg.root.id || $scope.eg.root.kind !== 'record'){ return; }
        $scope.egSetDepth();
    };

    $scope.egClearExclusions = function(){
        $scope.eg.excluded = EventGraphService.setExcludedObjects([]);
        $scope.eg.excludedStale = true;
        $scope.egRefresh();
    };

    /*
     * Re-walk with the exclusions applied at collection.
     *
     * Offered rather than automatic: a re-walk is a few seconds of queries,
     * and somebody ticking through six objects should not trigger six of them.
     */
    $scope.egRewalk = function(){
        $scope.eg.excludedStale = false;
        $scope.egSetDepth();
    };

    $scope.egTraceManual = function(){
        if(!$scope.eg.manualId){
            $scope.eg.error = 'Give an id, a name or a trace id to start from.';
            return;
        }
        $scope.egTrace({ kind: $scope.eg.manualKind, id: $scope.eg.manualId });
    };

    $scope.egSetView = function(view){
        $scope.eg.view = view;
        $scope.egRefresh();
    };

    $scope.egClearFilters = function(){
        $scope.eg.filter = { text: '', failuresOnly: false, slowOnly: false,
                             minConfidence: 'UNKNOWN' };
        $scope.egRefresh();
    };

    /*
     * Rebuild everything the screen shows from the current root, view and
     * filters. Cheap enough to run on every keystroke - correlation over a few
     * thousand events is milliseconds - and rebuilding wholesale is what keeps
     * the graph, the timeline and the replay from drifting apart.
     */
    $scope.egRefresh = function(){
        if(!$scope.eg.root.kind){ return; }

        var built;
        try {
            built = EventGraphService.trace({
                kind: $scope.eg.root.kind,
                id: $scope.eg.root.id,
                view: $scope.eg.view,
                grouping: $scope.eg.grouping,
                minConfidence: $scope.eg.filter.minConfidence,
                filter: {
                    text: $scope.eg.filter.text,
                    failuresOnly: $scope.eg.filter.failuresOnly,
                    slowerThan: $scope.eg.filter.slowOnly ? 500 : 0,
                    /* Hidden immediately, whether or not the walk has been
                     * re-run with them applied. */
                    excludeTypes: $scope.eg.excluded
                }
            });
        } catch(e) {
            $scope.eg.error = 'The trace could not be built: ' + e.message;
            return;
        }

        egCurrent = built;
        $scope.eg.built = true;
        $scope.eg.emptyReason = built.emptyReason;

        /*
         * Recomputed here, not carried from the walk.
         *
         * The chips render their own excluded state, and that state changes on
         * every toggle - so an inventory captured once at collection went stale
         * the moment somebody clicked one. The object then stayed out of the
         * graph while its chip still looked included, which reads as a control
         * that did nothing.
         */
        $scope.eg.inventory = EventGraphService.inventory();
        $scope.eg.stats = built.stats;
        $scope.eg.layout = built.layout;
        $scope.eg.positions = built.layout.positions;
        $scope.eg.gaps = built.gaps;
        $scope.eg.problems = built.problems;
        $scope.eg.edgePaths = egEdgePaths(built);

        var counts = (built.fullGraph && built.fullGraph.confidenceCounts) || {};
        $scope.egConfidenceBands = ['CONFIRMED', 'LIKELY', 'INFERRED'].map(function(key){
            return {
                key: key,
                label: key.toLowerCase(),
                count: counts[key] || 0,
                hint: key === 'CONFIRMED'
                    ? 'Something in the data ties these events together explicitly.'
                    : key === 'LIKELY'
                        ? 'Ordering plus a known relationship. Not recorded as a fact.'
                        : 'Proximity only. Often right, never evidence.'
            };
        });

        egBuildReplay(built);

        /* Keep the selection across a refresh where the event survives it. */
        if($scope.eg.selectedId){
            var still = built.graph.nodes.filter(function(node){
                return node.eventId === $scope.eg.selectedId;
            })[0];
            if(still){ $scope.egSelect(still); } else { $scope.egCloseInspector(); }
        }
    };

    /*
     * Edge geometry.
     *
     * A cubic with horizontal control points, so an edge leaving a node leaves
     * sideways and arrives sideways - which reads as flow through columns
     * rather than as a web. A self-referential or unplaced edge is dropped
     * rather than drawn to the origin.
     */
    function egEdgePaths(built){
        var byId = built.layout.byId;
        var paths = [];

        (built.graph.edges || []).forEach(function(edge){
            var from = byId[edge.sourceEventId];
            var to = byId[edge.targetEventId];
            if(!from || !to || from === to){ return; }

            var x1 = from.x + 150, y1 = from.y + 22;
            var x2 = to.x, y2 = to.y + 22;
            var bend = Math.max(24, Math.abs(x2 - x1) / 2);

            /*
             * Sequence is not causality, and must not be drawn as though it
             * were. FOLLOWED_BY is CONFIRMED - two events really were
             * consecutive in one trace - so on the confidence scale it came
             * out as the boldest line on the graph, and a trace of thirteen
             * events was mostly a chain of thick green arrows saying nothing
             * more than "and then". The timeline already shows order; here
             * these recede so the causal edges are what the eye follows.
             */
            var isSequence = edge.relationshipType === 'FOLLOWED_BY';

            /*
             * A lookup is drawn as a lookup, not as a confidence.
             *
             * Structural edges are all CONFIRMED, so on the confidence scale
             * they are indistinguishable from a matched request id - and in a
             * record graph that is every edge on screen, rendered identically.
             * Colouring them by what they are instead lets ownership
             * (master-detail) stand out from association (lookup), which is
             * the distinction somebody reading a record tree actually wants.
             */
            var style = isSequence ? 'SEQUENCE'
                : edge.masterDetail ? 'master-detail'
                : edge.relationshipType === 'PARENT_OF' ? 'structural'
                : edge.confidence;

            paths.push({
                id: edge.relationshipId,
                d: 'M' + x1 + ',' + y1 +
                   ' C' + (x1 + bend) + ',' + y1 +
                   ' ' + (x2 - bend) + ',' + y2 +
                   ' ' + x2 + ',' + y2,
                confidence: style,
                state: edge.state,
                bridged: !!edge.bridged,
                edge: edge
            });
        });

        return paths;
    }

    /* ---- Replay ----------------------------------------------------- */

    function egBuildReplay(built){
        if(egPlayer){ egPlayer.destroy(); egPlayer = null; }

        var script = EventGraphService.script(built.graph);
        $scope.eg.compressed = script.compressed;
        $scope.eg.elapsed = script.realDuration
            ? EventGraphService.Analysis.formatDuration(script.realDuration) : '';

        $scope.eg.timeline = EventGraphService.Replay.timeline(script, { width: 900 });

        egPlayer = EventGraphService.player(script, {
            /*
             * $timeout rather than setTimeout: the tick mutates scope, and a
             * raw timer would leave the graph a frame behind the clock on every
             * step. Angular's own timer runs a digest for us.
             */
            schedule: function(fn, ms){ return $timeout(fn, ms); },
            cancel: function(handle){ $timeout.cancel(handle); },
            onTick: egApplyState
        });

        /*
         * At rest the graph shows the whole journey, not the first frame of it.
         *
         * Applying replay state immediately meant every node was 'pending' -
         * dimmed to a quarter opacity - the moment a trace was built, so the
         * default view of a completed transaction was a washed-out picture of
         * something that had not started. Replay is a mode you enter, and until
         * then no phase class is applied at all.
         */
        $scope.eg.replaying = false;
        $scope.eg.nodeStates = {};
        $scope.eg.edgeStates = {};
        $scope.eg.scrub = 0;
        $scope.eg.playing = false;
        $scope.eg.parallel = false;
        $scope.eg.playheadPx = 0;
        $scope.eg.clock = script.startedAt
            ? new Date(script.startedAt).toISOString().slice(11, 23) : '';
    }

    /* Entering replay is what turns the phase classes on. */
    function egEnterReplay(){
        if($scope.eg.replaying){ return; }
        $scope.eg.replaying = true;
        if(egPlayer){ egPlayer.seek(0); }
    }

    function egApplyState(state){
        if(!$scope.eg.replaying){ return; }
        $scope.eg.nodeStates = state.nodes;
        $scope.eg.edgeStates = state.edges;
        $scope.eg.parallel = state.parallel;
        $scope.eg.activeCount = state.activeCount;
        $scope.eg.playing = egPlayer ? egPlayer.playing : false;
        $scope.eg.scrub = Math.round(state.progress * 1000);
        $scope.eg.playheadPx = state.progress * ($scope.eg.timeline.width || 900);

        var script = egPlayer && egPlayer.script;
        if(script && script.startedAt){
            var real = EventGraphService.Replay.realTimeAt(script, state.at);
            $scope.eg.clock = real ? new Date(real).toISOString().slice(11, 23) : '';
        }
    }

    $scope.egTogglePlay = function(){
        if(!egPlayer){ return; }
        egEnterReplay();
        egPlayer.toggle();
        $scope.eg.playing = egPlayer.playing;
    };

    $scope.egStepForward = function(){
        if(!egPlayer){ return; }
        egEnterReplay();
        egPlayer.stepForward();
    };

    $scope.egStepBack = function(){
        if(!egPlayer){ return; }
        egEnterReplay();
        egPlayer.stepBack();
    };

    $scope.egScrub = function(){
        if(!egPlayer){ return; }
        var to = Number($scope.eg.scrub) / 1000;
        egEnterReplay();
        egPlayer.seekFraction(to);
    };

    $scope.egSetSpeed = function(){
        if(egPlayer){ egPlayer.setSpeed(Number($scope.eg.speed)); }
    };

    $scope.egJumpToFailure = function(){
        if(!egPlayer){ return; }
        egEnterReplay();
        egPlayer.jumpToFirstFailure();
    };

    /* Back to the whole journey, out of replay. */
    $scope.egStopReplay = function(){
        if(egPlayer){ egPlayer.pause(); }
        $scope.eg.replaying = false;
        $scope.eg.playing = false;
        $scope.eg.nodeStates = {};
        $scope.eg.edgeStates = {};
        $scope.eg.scrub = 0;
        $scope.eg.playheadPx = 0;
    };

    /* ---- Selection --------------------------------------------------- */

    $scope.egSelect = function(node){
        if(!node){ return; }
        $scope.eg.selected = node;
        $scope.eg.selectedId = node.eventId;
        $scope.eg.selectedEdgeId = null;
        $scope.eg.selectedInput = egPretty(node.input);
        $scope.eg.selectedOutput = egPretty(node.output);
        $scope.eg.selectedEvidence = egEvidenceFor(node);
    };

    $scope.egSelectById = function(eventId){
        if(!egCurrent){ return; }
        var node = egCurrent.fullGraph.nodes[eventId];
        if(node){ $scope.egSelect(node); }
    };

    $scope.egSelectEdge = function(path){
        if(!path || !path.edge){ return; }
        $scope.eg.selectedEdgeId = path.id;
        $scope.eg.selectedId = null;
        $scope.eg.selected = null;
        /* An edge's inspector is its evidence: the whole point of selecting one
         * is to find out why the engine believes it. */
        $scope.eg.answer = {
            question: path.edge.relationshipType + ' · ' +
                      EventGraphService.Model.CONFIDENCE_LABEL[path.edge.confidence],
            answer: (path.edge.evidence || []).map(function(item){
                return item.detail;
            }).join(' '),
            citations: [], gaps: path.edge.bridged
                ? ['This link spans steps hidden by the current view.'] : []
        };
    };

    $scope.egCloseInspector = function(){
        $scope.eg.selected = null;
        $scope.eg.selectedId = null;
        $scope.eg.selectedEvidence = [];
    };

    /*
     * Every link into and out of this event, with its evidence - which is what
     * "allow the user to inspect why a relationship received its confidence"
     * amounts to in practice.
     */
    function egEvidenceFor(node){
        if(!egCurrent || !node){ return []; }
        var graph = egCurrent.fullGraph;
        var links = [];

        (graph.in[node.eventId] || []).forEach(function(rel){
            var other = graph.nodes[rel.sourceEventId];
            links.push({
                type: rel.relationshipType, direction: 'from',
                other: other ? (other.action || other.typeLabel) : rel.sourceEventId,
                confidence: rel.confidence,
                confidenceLabel: EventGraphService.Model.CONFIDENCE_LABEL[rel.confidence],
                evidence: rel.evidence || []
            });
        });

        (graph.out[node.eventId] || []).forEach(function(rel){
            var other = graph.nodes[rel.targetEventId];
            links.push({
                type: rel.relationshipType, direction: 'to',
                other: other ? (other.action || other.typeLabel) : rel.targetEventId,
                confidence: rel.confidence,
                confidenceLabel: EventGraphService.Model.CONFIDENCE_LABEL[rel.confidence],
                evidence: rel.evidence || []
            });
        });

        return links;
    }

    /* ---- Actions ----------------------------------------------------- */

    $scope.egExpandGroup = function(group){
        if(!group || !group.isGroup){ return; }
        /* Turning grouping off entirely is the honest expansion: expanding one
         * group and leaving the rest collapsed produces a layout where the same
         * kind of node means two different things. */
        $scope.eg.grouping = false;
        $scope.egRefresh();
        $scope.egSelect(group.members[0]);
    };

    $scope.egFocus = function(node){
        if(!node || !egCurrent){ return; }
        $scope.eg.root = { kind: 'event', id: node.eventId };
        $scope.egRefresh();
    };

    $scope.egFollowRecord = function(node){
        if(!node || !node.entity || !node.entity.id){ return; }
        var followed = EventGraphService.follow({ kind: 'record', id: node.entity.id });
        $scope.eg.chain = followed.chain;
    };

    $scope.egAsk = function(question, target){
        $scope.eg.answer = EventGraphService.ask(question, target);
    };

    $scope.egIngest = function(){
        if(!$scope.eg.ingestText){ return; }
        var result = EventGraphService.ingestExternal($scope.eg.ingestText);
        $scope.eg.ingestResult = result.added + ' event(s) added' +
            (result.rejected.length ? ', ' + result.rejected.length + ' rejected: ' +
                result.rejected.map(function(entry){ return entry.reason; }).join('; ') : '.');
        if(result.added){
            $scope.eg.ingestText = '';
            $scope.egRefresh();
        }
    };

    /* ---- Export ------------------------------------------------------- */

    /*
     * Four formats over one drawing. See js/event-graph/ss-export.js for why
     * the picture is redrawn rather than screenshotted.
     *
     * PNG is deliberately not a third renderer: it is the exported SVG handed
     * to the browser to rasterise, so it cannot disagree with the SVG about
     * what the graph looks like.
     */
    function egDrawing(){
        if(!egCurrent){ return null; }
        var context = EventGraphService.context();
        var root = egCurrent.root || {};
        return EventGraphService.Export.buildDrawing(egCurrent, {
            title: 'Event Graph — ' + (root.id || root.kind || 'trace'),
            subtitle: [
                context.org ? 'Org: ' + context.org : null,
                'View: ' + (egCurrent.view || 'ALL'),
                egCurrent.stats.shown + ' shown',
                egCurrent.stats.failures ? egCurrent.stats.failures + ' failed' : null
            ].filter(Boolean).join('   ·   '),
            footer: 'Exported ' + new Date().toISOString() +
                    '. Payloads were redacted before storage; see the JSON export for what ' +
                    'was removed.'
        });
    }

    $scope.egExportSvg = function(){
        var drawing = egDrawing();
        if(!drawing){ return; }
        var svg = EventGraphService.Export.toSVG(drawing);
        $scope.downloadBlob(EventGraphService.Export.filename(egCurrent, 'svg'),
            new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    };

    $scope.egExportJson = function(){
        if(!egCurrent){ return; }
        var payload = EventGraphService.Export.toJSON(egCurrent, {
            org: EventGraphService.context().org,
            gaps: $scope.eg.gaps,
            problems: $scope.eg.problems,
            inventory: $scope.eg.inventory
        });
        $scope.downloadBlob(EventGraphService.Export.filename(egCurrent, 'json'),
            new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    };

    $scope.egExportPdf = function(){
        var drawing = egDrawing();
        if(!drawing){ return; }
        var pdf = EventGraphService.Export.toPDF(drawing);
        /*
         * Latin-1, one byte per character. The cross-reference table is byte
         * offsets, and letting the Blob encode this as UTF-8 would shift every
         * offset past the first non-ASCII character and produce a file no
         * reader will open. ss-export strips those characters; this makes sure
         * nothing re-introduces them on the way out.
         */
        var bytes = new Uint8Array(pdf.length);
        for(var i = 0; i < pdf.length; i++){ bytes[i] = pdf.charCodeAt(i) & 0xff; }
        $scope.downloadBlob(EventGraphService.Export.filename(egCurrent, 'pdf'),
            new Blob([bytes], { type: 'application/pdf' }));
    };

    /*
     * PNG, by asking the browser to rasterise the SVG.
     *
     * Two-times scale, because a graph exported at CSS pixel size is unreadable
     * the moment it is pasted into a document. The SVG is inlined as a data URL
     * rather than an object URL: an object URL taints the canvas in some
     * browsers, and a tainted canvas cannot be read back.
     */
    $scope.egExportPng = function(){
        var drawing = egDrawing();
        if(!drawing){ return; }
        var Export = EventGraphService.Export;
        var svg = Export.toSVG(drawing);
        var scale = 2;

        var image = new Image();
        image.onload = function(){
            try {
                var canvas = document.createElement('canvas');
                canvas.width = drawing.width * scale;
                canvas.height = drawing.height * scale;
                var pen = canvas.getContext('2d');
                pen.fillStyle = drawing.background;
                pen.fillRect(0, 0, canvas.width, canvas.height);
                pen.scale(scale, scale);
                pen.drawImage(image, 0, 0);
                canvas.toBlob(function(blob){
                    if(!blob){
                        $scope.$apply(function(){
                            $scope.eg.exportError = 'The image could not be produced.';
                        });
                        return;
                    }
                    $scope.downloadBlob(Export.filename(egCurrent, 'png'), blob);
                }, 'image/png');
            } catch(e) {
                $scope.$apply(function(){
                    $scope.eg.exportError = 'The image could not be produced: ' + e.message;
                });
            }
        };
        image.onerror = function(){
            /* Falling back rather than failing: an SVG the canvas will not take
             * is still a perfectly good file to hand the user. */
            $scope.$apply(function(){
                $scope.eg.exportError = 'This browser would not rasterise the graph, ' +
                                        'so the SVG has been saved instead.';
            });
            $scope.egExportSvg();
        };
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    };

    /* ---- Rendering helpers ------------------------------------------- */

    $scope.egNodeClass = function(node){
        if(!node){ return ''; }
        var classes = ['cat-' + (node.category || 'CUSTOM').toLowerCase()];
        if(node.status === 'failure' || node.error){ classes.push('is-bad'); }
        if(node.outcome){ classes.push('is-outcome'); }
        if(node.isGroup){ classes.push('is-group'); }
        if(node.state === 'inferred'){ classes.push('is-inferred'); }
        return classes.join(' ');
    };

    /*
     * The strapline above a node.
     *
     * For a record graph this is the object name, which is the single most
     * useful thing to see at a glance - a graph of "Case / Order / OrderItem /
     * Payment" reads as a business structure, where a graph of "salesforce /
     * salesforce / salesforce" reads as nothing.
     */
    $scope.egNodeKind = function(node){
        if(!node){ return ''; }
        if(node.entity && node.entity.type){ return node.entity.type; }
        if(node.component && node.component.kind){ return node.component.kind; }
        return (node.category || '').toLowerCase();
    };

    /*
     * And the label is the record's own name where it has one.
     *
     * "Created Order 00045" is what the event says; on a graph of thirty
     * records the repeated "Created ..." is pure noise, and the name is the
     * part that distinguishes one node from the next.
     */
    $scope.egNodeLabel = function(node){
        if(!node){ return ''; }
        var label;
        if(node.entity && node.entity.name && node.eventType === 'RECORD_CREATE'){
            label = node.entity.name;
        }else{
            label = node.action || node.typeLabel || node.eventType;
        }
        return label.length > 42 ? label.slice(0, 41) + '…' : label;
    };

    /* How this node was reached - the lookup field, named. */
    $scope.egReachedVia = function(node){
        var via = node && node.metadata && node.metadata.reachedVia;
        if(!via){ return ''; }
        return via.direction === 'parent'
            ? 'via ' + via.field
            : 'child by ' + via.field;
    };

    $scope.egNodeTitle = function(node){
        if(!node){ return ''; }
        var parts = [node.action || node.typeLabel];
        if(node.actor && node.actor.name){ parts.push('by ' + node.actor.name); }
        if(node.duration){ parts.push($scope.egMs(node.duration)); }
        parts.push(EventGraphService.Model.PROVENANCE_LABEL[node.source.kind] || node.source.kind);
        return parts.join(' · ');
    };

    $scope.egProvenance = function(kind){
        return EventGraphService.Model.PROVENANCE_LABEL[kind] || kind;
    };

    $scope.egMs = function(ms){
        if(!ms && ms !== 0){ return ''; }
        return EventGraphService.Analysis.formatDuration(ms);
    };

    $scope.egRecordUrl = function(node){
        if(!node || !node.entity || !node.entity.id){ return ''; }
        return ssOrgUrl('/' + node.entity.id);
    };

    function egPretty(payload){
        if(payload === null || payload === undefined){ return ''; }
        try {
            return JSON.stringify(payload, null, 2);
        } catch(e) {
            return String(payload);
        }
    }

});
