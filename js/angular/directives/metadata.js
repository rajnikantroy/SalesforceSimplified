app.directive("metadatamainmenu", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.metadatamainmenu
    };
}]);