app.directive("usersrecords", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.usersrecords
    };
}]);