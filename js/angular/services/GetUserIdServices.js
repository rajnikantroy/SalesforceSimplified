app.service('UserId', function() {
    __getUserId();
    this.id = readCookie('uid');
});