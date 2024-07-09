app.directive("technologylist", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.technologylist
    };
}]);