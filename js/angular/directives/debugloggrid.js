app.directive("debugloggrid", ['mygridviewservices', function(mygridviewservices) {
    return {
        restrict : "E",
        template : mygridviewservices.debugloggrid
    };
}]);