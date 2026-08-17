/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * The launcher must not appear before the user is inside the org.
 *
 * Salesforce serves its login screen, its logout screen, identity
 * verification and the OAuth approval page from the same hosts as the org UI,
 * so the host allowlist that decides where this extension mounts cannot tell
 * them apart - and the launcher used to end up floating over the login box,
 * opening panels that need a session nobody has yet.
 *
 * ssIsAuthPage draws that line. It is worth pinning in both directions:
 *
 *   - miss a login page and the icon is back where it should not be;
 *   - claim an ordinary page is a login and the extension disappears from the
 *     org entirely, which is far the worse of the two.
 *
 * Deliberately NOT decided from the sid cookie. Signed-in users in orgs that
 * set sid HttpOnly or lock it to the domain have no readable cookie, and they
 * are precisely the users the Connected App sign-in exists for - gating the
 * launcher on the cookie would take away the only way to reach it.
 */

/* ------------------------------------------------------------------ */
/* Load the helper out of ss-core, with no browser around it           */
/* ------------------------------------------------------------------ */

const core = fs.readFileSync('./js/ss-core.js', 'utf8');
const start = core.indexOf('var SS_AUTH_PATHS');
const end = core.indexOf('/*\n * One org, seen from any of its UI hosts');
assert.ok(start > -1 && end > start, 'ss-core must still define SS_AUTH_PATHS / ssIsAuthPage');

const context = vm.createContext({ console });
vm.runInContext(core.slice(start, end), context);
const ssIsAuthPage = context.ssIsAuthPage;

/* ------------------------------------------------------------------ */
/* A DOM stand-in that parses the markup rather than pattern-matching   */
/* the test's own expectations back at itself                          */
/* ------------------------------------------------------------------ */

function parseTags(html) {
    const tags = [];
    for (const match of html.matchAll(/<(input|form)\b([^>]*)>/gi)) {
        const attrs = {};
        for (const attr of match[2].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
            attrs[attr[1].toLowerCase()] = attr[2];
        }
        tags.push({ tag: match[1].toLowerCase(), attrs });
    }
    return tags;
}

// Supports exactly the selector forms ssIsAuthPage uses.
function matches(tag, selector) {
    let want = selector.trim();
    let tagName = null;
    const named = want.match(/^([a-z]+)(#.*|\[.*)$/i);
    if (named) { tagName = named[1].toLowerCase(); want = named[2]; }
    if (tagName && tag.tag !== tagName) { return false; }

    if (want.startsWith('#')) { return tag.attrs.id === want.slice(1); }
    const attr = want.match(/^\[([\w-]+)="([^"]*)"\]$/);
    if (attr) { return tag.attrs[attr[1]] === attr[2]; }
    return false;
}

function fakeDocument(html) {
    const tags = parseTags(html);
    return {
        querySelector(selector) {
            for (const part of selector.split(',')) {
                const hit = tags.find((tag) => matches(tag, part));
                if (hit) { return hit; }
            }
            return null;
        }
    };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

// The real thing, captured from login.salesforce.com. My Domain login screens
// are the same platform form. If Salesforce ever renames these ids the form
// half of the check stops firing, and this is what will say so.
const REAL_LOGIN = fs.readFileSync('./tests/fixtures/salesforce-login-form.html', 'utf8');

const ORG_PAGE = '<div id="setupComponent"><table class="list"><tr><td>ApexClass</td></tr></table></div>';

// A password field with no login form around it. Suppressing the launcher
// here would be the damaging direction of this bug.
const CHANGE_PASSWORD =
    '<form><input id="newpw" type="password" name="np"><input id="confirmpw" type="password" name="cp"></form>';

/* ------------------------------------------------------------------ */
/* Pages the launcher must stay off                                     */
/* ------------------------------------------------------------------ */

const authPages = [
    ['My Domain login screen, served from the root path', '/', REAL_LOGIN],
    ['login page reached with a redirect', '/', REAL_LOGIN],
    ['Classic login.jsp', '/login.jsp', ORG_PAGE],
    ['logout page', '/secur/logout.jsp', ORG_PAGE],
    ['SSO frontdoor hand-off', '/secur/frontdoor.jsp', ORG_PAGE],
    ['identity verification', '/_ui/identity/verification/method/VerifyEmail', ORG_PAGE],
    ['OAuth approval page', '/setup/secur/RemoteAccessAuthorizationPage.apexp', ORG_PAGE],
    ['auth provider endpoint', '/services/auth/oauth/MyProvider', ORG_PAGE]
];

for (const [what, path, html] of authPages) {
    assert.strictEqual(
        ssIsAuthPage(path, fakeDocument(html)), true,
        `${what} (${path}) must be recognised as an auth page - the launcher does not belong there`
    );
}

/* ------------------------------------------------------------------ */
/* Pages the launcher must still appear on                              */
/*                                                                      */
/* A false positive here is worse than the bug being fixed: it removes  */
/* the extension from the org altogether.                               */
/* ------------------------------------------------------------------ */

const orgPages = [
    ['Classic home', '/home/home.jsp', ORG_PAGE],
    ['Setup home', '/lightning/setup/SetupOneHome/home', ORG_PAGE],
    ['Apex class list', '/01p', ORG_PAGE],
    ['Lightning record page', '/lightning/r/Account/001xx000003DGb2AAG/view', ORG_PAGE],
    ['Visualforce page whose name merely contains "login"', '/apex/MyLoginHelper', ORG_PAGE],
    // The auth paths are anchored at the start for these two: they are
    // Salesforce's own top-level paths, and matching them anywhere in the URL
    // lets an ordinary record or Visualforce path contain one by accident.
    ['a Visualforce path containing an auth path', '/apex/services/auth/Something', ORG_PAGE],
    ['a record path containing an auth path', '/01p000000000001/secur/logout.jsp', ORG_PAGE],
    ['change-password screen - password fields, but no login form', '/_ui/system/security/ChangePassword', CHANGE_PASSWORD],
    ['a page with no forms at all', '/01p000000000001', '<div>nothing here</div>']
];

for (const [what, path, html] of orgPages) {
    assert.strictEqual(
        ssIsAuthPage(path, fakeDocument(html)), false,
        `${what} (${path}) must NOT be treated as an auth page - this would hide the extension from the org`
    );
}

/* ------------------------------------------------------------------ */
/* The real login form is recognised by the form test alone             */
/*                                                                      */
/* The path half cannot help on a My Domain login screen, which lives   */
/* at "/", so this is the half that has to work there.                  */
/* ------------------------------------------------------------------ */

const realDoc = fakeDocument(REAL_LOGIN);
assert.ok(realDoc.querySelector('input[type="password"]'), 'fixture must still contain the password field');
assert.ok(realDoc.querySelector('#login_form'), 'fixture must still contain the login form');
assert.ok(realDoc.querySelector('input#username'), 'fixture must still contain the username field');
assert.strictEqual(ssIsAuthPage('/', realDoc), true);

// The username field is type="email", not type="text" - matching it by type
// would have missed the real page entirely.
const username = realDoc.querySelector('input#username');
assert.strictEqual(username.attrs.type, 'email',
    'the real username input is type=email; the check must key off the id, not the type');

/* ------------------------------------------------------------------ */
/* index.js actually consults it before mounting                        */
/* ------------------------------------------------------------------ */

const index = fs.readFileSync('./index.js', 'utf8');
const ready = index.slice(index.indexOf('$(document).ready'));
assert.ok(
    /ssIsAuthPage\(\)/.test(ready.slice(0, ready.indexOf('appendRecentItems();'))),
    'index.js must check ssIsAuthPage() before mounting the launcher'
);

// bootstrap.js reports a compile failure when #mySidenav is absent. On an auth
// page it is absent by design, so bootstrap has to bail out for the same
// reason index.js does - otherwise every login page logs an error about
// markup that was deliberately never injected.
const bootstrap = fs.readFileSync('./js/bootstrap.js', 'utf8');
assert.ok(
    /ssIsAuthPage\(\)/.test(bootstrap.slice(0, bootstrap.indexOf('bootstrapAllRoots'))),
    'bootstrap.js must bail out on auth pages, or it warns about a launcher that was never mounted'
);

console.log('auth page detection regression test passed');
