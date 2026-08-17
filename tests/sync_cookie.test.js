/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * Which sid is this org's sid.
 *
 * chrome.cookies.get resolves a tie by path length and then by creation time,
 * and pointedly not by how specific the domain is. Salesforce sets a sid on
 * login.salesforce.com too, and a cookie on a parent domain matches every host
 * beneath it - so asking for org B's session could hand back org A's, which
 * org B then refuses as INVALID_SESSION_ID.
 *
 * From the outside that is indistinguishable from an expired session, and it
 * was reported as one: "sign in again" shown to somebody already signed in,
 * where no amount of signing in could help. One org in the pipeline worked and
 * the other did not, which is exactly the shape of picking the wrong cookie
 * rather than of a session going stale.
 */

const ROOT = path.join(__dirname, '..');
const engine = fs.readFileSync(path.join(ROOT, 'js/sync-engine.js'), 'utf8');

function lift(signature) {
    const at = engine.indexOf(signature);
    assert.ok(at > -1, signature + ' not found - it has been renamed or removed');
    let depth = 0, started = false;
    for (let i = at; i < engine.length; i += 1) {
        if (engine[i] === '{') { depth += 1; started = true; }
        else if (engine[i] === '}') {
            depth -= 1;
            if (started && depth === 0) { return engine.slice(at, i + 1); }
        }
    }
    throw new Error('unterminated ' + signature);
}

const box = { console: console };
box.globalThis = box;
vm.createContext(box);
vm.runInContext(lift('function ssSyncPickCookie(cookies, host) {'), box);

const pick = (cookies, host) => vm.runInContext(
    'ssSyncPickCookie(' + JSON.stringify(cookies) + ', ' + JSON.stringify(host) + ')', box);

const ORG = 'sas-dev-ed.develop.my.salesforce.com';
const OTHER = 'icqminstallationkit-dev-ed.my.salesforce.com';

const own = { domain: ORG, path: '/', value: 'THIS-ORG' };
/* login.salesforce.com's cookie, which matches every host under it. */
const parent = { domain: '.salesforce.com', path: '/', value: 'SOME-OTHER-ORG' };

/* ------------------------------------------------------------------ */
/* The org's own cookie wins                                           */
/* ------------------------------------------------------------------ */

assert.strictEqual(pick([own], ORG).value, 'THIS-ORG',
    'the only cookie there is, is not returned');

/*
 * The bug as reported. Both cookies match the URL, both have path "/", so
 * chrome.cookies.get would settle it on creation time - and the parent, set
 * at login, is almost always the older of the two.
 */
assert.strictEqual(pick([parent, own], ORG).value, 'THIS-ORG',
    'a parent-domain sid beat the org\'s own, which is the org that then refuses it');
assert.strictEqual(pick([own, parent], ORG).value, 'THIS-ORG',
    'and the order they arrive in must not decide it either');

/* A leading dot is how a domain cookie is written; it is the same host. */
assert.strictEqual(pick([{ domain: '.' + ORG, path: '/', value: 'DOTTED' }], ORG).value,
    'DOTTED', 'a host cookie written with a leading dot is not recognised as this host');

/*
 * Specificity outranks path length. A parent cookie on a longer path would
 * otherwise win, and it is still some other org's session.
 */
assert.strictEqual(
    pick([{ domain: '.salesforce.com', path: '/services/data', value: 'PARENT-DEEP' }, own], ORG).value,
    'THIS-ORG',
    'a deeper path on a parent domain outranked this org\'s own cookie');

/* Among equals, the longer path is the more specific and wins. */
assert.strictEqual(
    pick([{ domain: ORG, path: '/', value: 'SHALLOW' },
          { domain: ORG, path: '/services', value: 'DEEP' }], ORG).value,
    'DEEP', 'two cookies on this host are not separated by path');

/* ------------------------------------------------------------------ */
/* A parent cookie is still better than nothing                        */
/* ------------------------------------------------------------------ */

/*
 * Refusing it outright would break every org this already works for, where
 * the parent cookie is the right answer. It is a fallback, not a first
 * choice - and when it is used the refusal says so, below.
 */
assert.strictEqual(pick([parent], ORG).value, 'SOME-OTHER-ORG',
    'with only a parent cookie available, nothing is returned at all');

/* ------------------------------------------------------------------ */
/* Another org's cookie is never this org's                            */
/* ------------------------------------------------------------------ */

assert.strictEqual(pick([{ domain: OTHER, path: '/', value: 'WRONG-ORG' }], ORG), null,
    'a sibling org\'s cookie was accepted as this org\'s session');

/*
 * A suffix that is not a domain boundary.
 *
 * "evilmy.salesforce.com" ends with "my.salesforce.com" as a string and is
 * not a subdomain of it. A check written as endsWith rather than on the dot
 * accepts that cookie as this host's session - which is the whole of the
 * attack, since anyone able to set a cookie on a lookalike host could then
 * have it sent to an org as a session.
 */
assert.strictEqual(
    pick([{ domain: 'my.salesforce.com', path: '/', value: 'NOT-MINE' }],
         'evilmy.salesforce.com'),
    null,
    'a cookie whose domain is a mere string suffix of the host was accepted');

/* And the genuine parent still is a parent. */
assert.strictEqual(
    pick([{ domain: 'my.salesforce.com', path: '/', value: 'PARENT' }],
         'acme.my.salesforce.com').value,
    'PARENT',
    'a real parent domain is no longer recognised, which breaks every org ' +
    'that only has one');

assert.strictEqual(pick([], ORG), null, 'an empty jar produced something');
assert.strictEqual(pick(null, ORG), null);
assert.strictEqual(pick([own], ''), null, 'no host asked for, yet a cookie chosen');

/* A cookie with no value is not a session. */
assert.strictEqual(pick([{ domain: ORG, path: '/', value: '' }], ORG), null,
    'an empty sid was returned as a session');

/* ------------------------------------------------------------------ */
/* It is actually used, and the refusal can explain itself             */
/* ------------------------------------------------------------------ */

/*
 * getAll, not get. The whole fix is having every match to choose from; with
 * get there is one cookie and the choice has already been made wrongly.
 */
assert.ok(/chrome\.cookies\.getAll\(\{ url: origin, name: 'sid' \}/.test(engine),
    'the engine still reads one cookie with cookies.get, so nothing can be preferred');
/* The call site, not the declaration - `function ssSyncPickCookie(cookies,
 * host)` contains the same text, and satisfied this while the call had been
 * replaced by cookies[0]. */
assert.ok(/var cookie = ssSyncPickCookie\(cookies, host\);/.test(engine),
    'the cookies are fetched but not put through the picker');

/*
 * Whether the session came from this host travels with it, so a refusal can
 * say where it came from. Told only "sign in again", somebody already signed
 * in has nothing to act on - which is how this was reported.
 */
/* Computed, not asserted. `exactHost: true` satisfies a search for the key
 * and makes every session look like the org's own, which is the state the
 * whole message depends on telling apart. */
assert.ok(/exactHost: String\(cookie\.domain[\s\S]{0,140}=== host/.test(engine),
    'exactHost is not worked out from the cookie, so it cannot be trusted');
/*
 * Driven, not searched. Both messages are string literals in the file
 * whichever branch is taken, so their presence proves nothing - what matters
 * is that `borrowed` is what chooses between them.
 */
const advice = (function () {
    const at = engine.indexOf('var advice = borrowed');
    assert.ok(at > -1, 'the refusal no longer chooses its wording from the borrowed session');
    return engine.slice(at, engine.indexOf(';', engine.indexOf('and retry.', at)));
})();
assert.ok(/borrowed\s*$/m.test(advice.split('\n')[0]) || /^var advice = borrowed$/m.test(advice.split('\n')[0].trim()),
    'the borrowed session is not the condition');
assert.ok(/came from ' \+[\s\S]{0,40}borrowed/.test(advice),
    'the refusal never names where the session it used came from');
assert.ok(/expired or was refused/.test(advice),
    'the other branch no longer carries the plain expiry wording');
assert.ok(/Open that org in a tab once/.test(engine),
    'the refusal gives no action for a session borrowed from a parent domain');

/*
 * And the borrowed case must be distinguishable from a genuinely expired one,
 * or the new message replaces the old everywhere and says the wrong thing to
 * everybody whose session really did expire.
 */
assert.ok(/expired or was refused\. Sign in to it again and retry\./.test(engine),
    'the plain expiry message is gone - a real expiry now reads as a cookie problem');
assert.ok(/refused\.from === 'cookie' && refused\.exactHost === false/.test(engine),
    'the borrowed-session message is not gated on the session actually being borrowed');

console.log('sync_cookie: ok');
