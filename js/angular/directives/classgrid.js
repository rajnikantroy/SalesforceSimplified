app.directive("classgrid", ['mygridviewservices', function(mygridviewservices) {
    return {
        restrict : "E",
        template : mygridviewservices.classgrid
    };
}]);