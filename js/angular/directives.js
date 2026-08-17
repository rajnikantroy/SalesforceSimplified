/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * All Salesforce Simplified element directives.
 *
 * These were previously 20 separate files, each a single four-line
 * registration. Every one of them was a separate content_scripts entry that
 * Chrome had to fetch and evaluate on every Salesforce page load. They are
 * merged here; behaviour is identical.
 *
 * Each directive renders a template string held on one of the two template
 * services, so the mapping below is directive name -> service + property.
 */
(function() {
    'use strict';
    var app = window.app || angular.module("SalesforceSimplifiedApp");

    function register(directiveName, serviceName, templateProperty) {
        app.directive(directiveName, [serviceName, function(templateService) {
            return {
                restrict: 'E',
                template: templateService[templateProperty]
            };
        }]);
    }

    // Templates provided by the `viewservice` service.
    var viewserviceDirectives = {
        activeuserstoday: 'activeuserstoday',
        allrecords: 'allrecords',
        articles: 'articles',
        developeranalysis: 'developeranalysis',
        functionalitiesmenu: 'functionalitiesMenu',
        launchercolor: 'launchercolor',
        menu: 'content',
        simplifiedpage: 'page',
        metadatamainmenu: 'metadatamainmenu',
        objectlevelaction: 'objectlevelaction',
        querynotice: 'querynotice',
        packagexmleditor: 'packagexmleditor',
        packagexmlfrequency: 'packagexmlfrequency',
        searchdata: 'searchdata',
        signinoverlay: 'signinoverlay',
        signedoutnotice: 'signedoutnotice',
        notificationsettings: 'notificationsettings',
        sstoast: 'sstoast',
        ssnews: 'ssnews',
        technologylist: 'technologylist',
        usageanalytics: 'usageanalytics',
        newstimeline: 'newstimeline',
        apimonitor: 'apimonitor',
        audittrail: 'audittrail',
        /* The rail beside the REST Explorer: what this org advertises. */
        restresources: 'restresources',
        bulkjobs: 'bulkjobs',
        syncjobs: 'syncjobs',
        /*
         * What a job carries - components, or records and the query.
         * Rendered in two places: the detail row under a job, and the review
         * modal that asks whether to apply a staged one. Like syncjobdetail
         * it has no isolate scope, so it renders the `job` of whichever
         * repeat it is sitting in.
         */
        syncjobcarries: 'syncjobcarries',
        /*
         * The expanded row under a job. Registered as its own element only to
         * keep the job list readable; it has no isolate scope, so the `job`
         * of the ng-repeat it sits inside is what it renders.
         */
        syncjobdetail: 'syncjobdetail',
        objectdescribe: 'objectdescribe',
        eventgraph: 'eventgraph',
        restexplorer: 'restexplorer',
        truststatus: 'truststatus',
        watchinglist: 'watchinglist',
        aboutus: 'aboutus',
        userdetails: 'userdetails',
        usersrecords: 'usersrecords'
    };

    // Templates provided by the `mygridviewservices` service.
    var gridserviceDirectives = {
        classgrid: 'classgrid',
        compare: 'compare',
        debugloggrid: 'debugloggrid'
    };

    /*
     * scroll, as an attribute Angular owns.
     *
     * This was an inline onscroll="" on the scrolling pane. Inline handlers
     * are script, and an extension page runs under Manifest V3's content
     * security policy, which forbids them - so on simplified.html the sticky
     * header simply never engaged and the console filled with CSP violations.
     * They also cannot be reached from a content script's isolated world,
     * which is the other reason not to write them.
     *
     * The expression is called directly rather than wrapped in $apply:
     * handleMainScroll already compares against the previous value and starts
     * its own digest only when it changed, and a digest per scroll event
     * would be its own bug.
     */
    app.directive('ssOnScroll', ['$parse', function($parse) {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                var handler = $parse(attrs.ssOnScroll);
                function onScroll(event) { handler(scope, { $event: event }); }
                element[0].addEventListener('scroll', onScroll, { passive: true });
                scope.$on('$destroy', function() {
                    element[0].removeEventListener('scroll', onScroll);
                });
            }
        };
    }]);

    Object.keys(viewserviceDirectives).forEach(function(name) {
        register(name, 'viewservice', viewserviceDirectives[name]);
    });

    Object.keys(gridserviceDirectives).forEach(function(name) {
        register(name, 'mygridviewservices', gridserviceDirectives[name]);
    });
})();
