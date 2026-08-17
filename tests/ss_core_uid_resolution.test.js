/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * "My records" queries carry a {uid} placeholder that must be resolved at
 * query time, not baked in at startup. A uid cookie that is empty on first
 * load - or a "View as different user" - must not pin the query to a stale or
 * missing id, otherwise the current user's records (e.g. debug logs) never
 * appear. Regression test for ssResolveQueryUid in ss-core.js.
 */
let cookieValue = null;
const context = {
    window: { location: { origin: 'https://example.my.salesforce.com' } },
    document: { cookie: '' },
    chrome: {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
};

function setUidCookie(value) {
    // ss-core.js defines its own readCookie over document.cookie, so the test
    // drives the cookie directly rather than stubbing the function.
    cookieValue = value;
    context.document.cookie = value == null ? '' : 'uid=' + value + '; path=/';
}

vm.runInNewContext(
    fs.readFileSync('./js/ss-core.js', 'utf8'),
    context
);

const resolve = context.ssResolveQueryUid;

const queryWithUid = "SELECT Id, LogUserId FROM ApexLog where LogUserId='{uid}' order by StartTime desc";

setUidCookie('005abc123');
assert.strictEqual(resolve(queryWithUid),
    "SELECT Id, LogUserId FROM ApexLog where LogUserId='005abc123' order by StartTime desc",
    'uid cookie value should be substituted for the placeholder');

setUidCookie(null);
assert.strictEqual(resolve(queryWithUid),
    "SELECT Id, LogUserId FROM ApexLog where LogUserId='' order by StartTime desc",
    'a missing uid should resolve to an empty literal, not crash');

setUidCookie("O'Brian's 005");
assert.strictEqual(resolve(queryWithUid),
    "SELECT Id, LogUserId FROM ApexLog where LogUserId='O\\'Brian\\'s 005' order by StartTime desc",
    'the substituted id should be SOQL-escaped like any other literal');

setUidCookie('005abc123');
const plainQuery = "SELECT Id, Name FROM ApexClass order by LastModifiedDate desc";
assert.strictEqual(resolve(plainQuery), plainQuery,
    'queries without the placeholder should pass through untouched');

console.log('ss-core uid resolution regression test passed');
