/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * The orgs this browser remembers, live and expired alike.
 *
 * The list already outlived the session - it comes from ssBrief, which records
 * an org because the extension was opened on it, not because a session exists.
 * What was missing was saying which of them are still usable, so an org whose
 * session had gone looked exactly like one that worked and the first sign of
 * trouble was a job failing on it.
 *
 * Two things are asserted here and the second matters more than the first.
 *
 * What it does: report every remembered org with a live/expired state, and
 * offer to sign in to the expired ones.
 *
 * What it must never do: hold a credential. The stored entry is an origin and
 * a label; the state is read from the browser's cookie jar at the moment it is
 * asked; the session id never leaves the worker; and "sign in" opens the org
 * so that Salesforce can take the password, because a form here that asked for
 * one would be the single worst thing in this extension.
 */

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const background = read('js/background.js');
const view = read('js/angular/services/ViewService.js');
const controller = read('js/angular/controllers/MenuAndDetailsCtrl.js');

function lift(source, signature) {
    const at = source.indexOf(signature);
    assert.ok(at > -1, signature + ' not found - it has been renamed or removed');
    let depth = 0, started = false;
    for (let i = at; i < source.length; i += 1) {
        if (source[i] === '{') { depth += 1; started = true; }
        else if (source[i] === '}') {
            depth -= 1;
            if (started && depth === 0) { return source.slice(at, i + 1); }
        }
    }
    throw new Error('unterminated ' + signature);
}

/* ------------------------------------------------------------------ */
/* Live or expired, decided by this org's own cookie                   */
/* ------------------------------------------------------------------ */

/*
 * readOrgSession is what answers "is this org signed in", so the cookie it
 * picks is the whole of the answer. chrome.cookies.get settles a tie by path
 * and then creation time and never by how specific the domain is - so a sid
 * set on login.salesforce.com matches every org beneath it, and an org that
 * signed out weeks ago reports as live.
 */
function jar(cookies) {
    const box = {
        console: console,
        URL: URL,
        Promise: Promise,
        chrome: {
            runtime: { lastError: null },
            cookies: {
                getAll: (details, done) => done(cookies.filter((c) => {
                    const host = new URL(details.url).hostname;
                    const domain = String(c.domain || '').replace(/^\./, '');
                    return host === domain || host.endsWith('.' + domain);
                }))
            }
        }
    };
    box.globalThis = box;
    vm.createContext(box);
    vm.runInContext(
        lift(read('js/sync-engine.js'), 'function ssSyncPickCookie(cookies, host) {') + '\n' +
        lift(background, 'function readOrgSession(origin) {'), box);
    return (origin) => vm.runInContext(
        'readOrgSession(' + JSON.stringify(origin) + ')', box);
}

const ORG = 'https://acme.my.salesforce.com';
const own = { domain: 'acme.my.salesforce.com', path: '/', value: 'ACME-SID' };
const shared = { domain: '.salesforce.com', path: '/', value: 'SOME-OTHER-ORG' };

async function run() {

    assert.strictEqual(await jar([own])(ORG), 'ACME-SID',
        'an org with its own session is not reported as signed in');

    /*
     * The one that matters. Both cookies match the url and both have path
     * "/", so cookies.get would settle it on creation time - and the shared
     * one, set at login, is almost always older.
     */
    assert.strictEqual(await jar([shared, own])(ORG), 'ACME-SID',
        'a parent-domain sid was returned as this org\'s session, which reports ' +
        'a signed-out org as signed in');

    assert.strictEqual(await jar([])(ORG), null,
        'an org with no cookie at all is not reported as expired');

    /* And nothing outside the Salesforce hosts is asked about at all. */
    assert.strictEqual(await jar([own])('https://evil.example.com'), null,
        'a session was read for a host that is not an org');

    /* -------------------------------------------------------------- */
    /* The handler reports state, and only state                       */
    /* -------------------------------------------------------------- */

    const handler = background.slice(
        background.indexOf("if (message.type === 'SS_ORG_SESSIONS')"),
        background.indexOf("if (message.type === 'SS_PAGE_SESSION')"));
    assert.ok(handler.length > 200, 'the org-sessions handler is gone');

    /*
     * Whether, not what. A session id on this object would be a credential
     * crossing into a page's process for no reason - the panel has no use
     * for it, and every copy is somewhere else it can leak from.
     */
    assert.ok(/live: !!sid/.test(handler),
        'the handler does not report a boolean for the session state');
    assert.ok(!/\bsid: sid\b/.test(handler) && !/sessionId/.test(handler),
        'the handler puts a session id in its reply, which is a credential ' +
        'leaving the worker for no reason');

    /*
     * And not to a web page at all. A content script arrives with sender.tab
     * set; this reply names every org the user works in, which is not a page's
     * business even without a session attached.
     */
    assert.ok(/sender && sender\.tab && sender\.url &&\s*\n?\s*sender\.url\.indexOf\('chrome-extension:\/\/'\) !== 0/
        .test(handler),
        'the handler answers page scripts, so any site could enumerate the orgs ' +
        'this browser is used with');
    assert.ok(/Not available to page scripts/.test(handler),
        'the refusal for page scripts is gone');

    /*
     * Expired orgs are kept, not filtered out - that is the whole feature.
     *
     * Asserted as "the list is passed through unchanged" rather than as
     * "there is no filter": a pattern looking for `.filter(...live` stops at
     * the first close paren, which is the one in `function(o)`, so the very
     * mutation it was written for slipped past it.
     */
    assert.ok(/sendResponse\(\{ ok: true, orgs: orgs \}\)/.test(handler),
        'the org list is transformed on its way out - it must be reported as ' +
        'built, expired entries and all');

    /* -------------------------------------------------------------- */
    /* The panel: expired last, and signing in is the browser's job     */
    /* -------------------------------------------------------------- */

    const sandbox = { $scope: {}, window: { open: function () { sandbox.opened = arguments; } } };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(
        lift(controller, '$scope.expiredOrgCount = function(){') + ';\n' +
        lift(controller, '$scope.signInToOrg = function(org){') + ';', sandbox);

    sandbox.$scope.orgSessions = { list: [
        { origin: 'https://a.my.salesforce.com', live: true },
        { origin: 'https://b.my.salesforce.com', live: false },
        { origin: 'https://c.my.salesforce.com', live: false }
    ] };
    assert.strictEqual(vm.runInContext('$scope.expiredOrgCount()', sandbox), 2,
        'the count of orgs needing a sign-in is wrong');

    sandbox.$scope.orgSessions = { list: [] };
    assert.strictEqual(vm.runInContext('$scope.expiredOrgCount()', sandbox), 0);

    /*
     * Signing in opens the org. Salesforce takes the credentials; this
     * extension has none and asks for none.
     */
    vm.runInContext(
        '$scope.signInToOrg({ origin: "https://b.my.salesforce.com" })', sandbox);
    assert.ok(sandbox.opened, 'signing in does nothing at all');
    assert.strictEqual(sandbox.opened[0], 'https://b.my.salesforce.com',
        'signing in opens something other than the org');

    sandbox.opened = null;
    vm.runInContext('$scope.signInToOrg(null)', sandbox);
    vm.runInContext('$scope.signInToOrg({})', sandbox);
    assert.ok(!sandbox.opened, 'an org with no origin still opened a window');

    /* -------------------------------------------------------------- */
    /* Nothing on this page asks for a password                        */
    /* -------------------------------------------------------------- */

    /*
     * Stated as a rule rather than left to judgement. The obvious next step
     * from "let them authenticate" is a username and password box, and it
     * must never be built here: this extension would then be handling
     * credentials for orgs it has no business holding.
     */
    const orgBlock = view.slice(view.indexOf('<div class="ss-org-list">'),
                                view.indexOf('expiredOrgCount()'));
    assert.ok(!/type="password"/.test(orgBlock),
        'a credential field has appeared in the org list - signing in belongs to ' +
        'the org, and a box here would make this extension the thing handling it');

    /*
     * Scoped to this block on purpose. The panel already has one masked input
     * elsewhere: the session-id sign-in, where somebody pastes a sid they got
     * from their own Developer Console. That is a session, not a password, it
     * is masked only so it is not left legible on a shared screen, and it is
     * held in memory for the tab rather than written anywhere. Asserting
     * across the whole template would forbid that too, on a resemblance
     * rather than a reason.
     */
    const masked = (view.match(/type="password"/g) || []).length;
    assert.strictEqual(masked, 1,
        'expected exactly one masked field in the panel - the session-id paste - ' +
        'and found ' + masked);
    assert.ok(/ng-click="signInToOrg\(knownOrg\)"/.test(orgBlock),
        'the expired rows offer no way to sign in');
    assert.ok(/ng-if="!knownOrg\.live"/.test(orgBlock),
        'the sign-in button is offered on orgs that are already signed in');

    /* And it says who takes the password, because that is the reassurance
     * somebody needs before clicking it. */
    assert.ok(/Salesforce takes your credentials, not/.test(view),
        'the page does not say who receives the credentials');

    console.log('org_sessions: ok');
}

run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
