app.directive("packagexmleditor", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.packagexmleditor
    };
}]);