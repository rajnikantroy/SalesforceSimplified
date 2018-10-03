app.directive("userdetails", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.userdetails
    };
}]);