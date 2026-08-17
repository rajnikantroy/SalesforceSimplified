/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
var app = window.app || angular.module("SalesforceSimplifiedApp");
app.service('UserId', function() {
    __getUserId();
    this.id = readCookie('ss_selected_uid') || readCookie('uid');
});