app.directive("objectlevelaction", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.objectlevelaction
    };
}]);