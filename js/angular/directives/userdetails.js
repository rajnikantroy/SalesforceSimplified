app.directive("packagexml", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.packagexml
    };
}]);