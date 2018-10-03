app.directive("developeranalysis", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.developeranalysis
    };
}]);