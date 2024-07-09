app.directive("compare", ['mygridviewservices', function(mygridviewservices) {
    return {
        restrict : "E",
        template : mygridviewservices.compare
    };
}]);