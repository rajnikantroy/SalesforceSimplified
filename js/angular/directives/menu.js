app.directive("menu", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.content
    };
}]);