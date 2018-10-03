app.directive("articles", ['viewservice', function(viewservice) {
    return {
        restrict : "E",
        template : viewservice.articles
    };
}]);