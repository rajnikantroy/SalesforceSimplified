app.directive("allrecords", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.allrecords
    };
}]);