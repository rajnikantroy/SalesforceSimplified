app.directive("launchercolor", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.launchercolor
    };
}]);