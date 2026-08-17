/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Every org the sign-in can target must be one the extension may talk to.
 *
 * The token exchange runs in the service worker as a plain fetch, and
 * Salesforce's token endpoint sends no CORS headers - so a host outside
 * host_permissions is blocked by the browser and surfaces as "Failed to
 * fetch", *after* the user has already logged in and approved. It looks like
 * the org refusing, and it is the extension not being allowed to ask.
 *
 * This is not hypothetical twice over. The Setup domain fell through
 * normalizeLoginOrigin to login.salesforce.com, which was not permitted; and
 * later the two login hosts were removed from the manifest on the reasoning
 * that only a since-deleted feature used them - which was wrong, because the
 * Production and Sandbox buttons in the sign-in overlay exchange tokens there.
 *
 * So this derives the answer rather than trusting either the reasoning or the
 * comment: run every host the overlay can start from through the real
 * normalizeLoginOrigin, and check each result against the real manifest.
 */

const background = fs.readFileSync('./js/background.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));

function lift(name) {
    const match = background.match(new RegExp('function ' + name + '[\\s\\S]*?\\n}'));
    assert.ok(match, 'could not find ' + name + ' in background.js');
    return match[0];
}

const normalizeLoginOrigin = new Function(
    lift('isSandboxHost') + '\n' + lift('hostOf') + '\n' + lift('normalizeLoginOrigin') +
    '\nreturn normalizeLoginOrigin;')();

/*
 * A Chrome match pattern, reduced to the question asked here: does this
 * pattern cover this origin. Only https patterns of the form
 * https://<host-or-*.host>/* appear in this manifest.
 */
function covers(pattern, origin) {
    const match = /^https:\/\/([^/]+)\/\*$/.exec(pattern);
    if (!match) { return false; }
    const host = new URL(origin).hostname.toLowerCase();
    const patternHost = match[1].toLowerCase();

    if (patternHost.startsWith('*.')) {
        const suffix = patternHost.slice(2);
        // "*." matches any number of leading labels, so a sandbox host under
        // several of them still counts.
        return host === suffix || host.endsWith('.' + suffix);
    }
    return host === patternHost;
}

// Everywhere the overlay can start a sign-in from: the org being browsed on
// any host the extension is injected into, plus the two explicit buttons and
// a custom URL.
const STARTING_POINTS = [
    ['https://acme.my.salesforce.com', 'my domain'],
    ['https://acme.lightning.force.com', 'Lightning'],
    ['https://acme.my.salesforce-setup.com', 'Setup'],
    ['https://acme.vf.force.com', 'Visualforce'],
    ['https://acme.visual.force.com', 'Visualforce (legacy)'],
    ['https://acme--uat.sandbox.my.salesforce.com', 'sandbox my domain'],
    ['https://acme--uat.sandbox.lightning.force.com', 'sandbox Lightning'],
    ['https://acme--uat.sandbox.my.salesforce-setup.com', 'sandbox Setup'],
    ['https://login.salesforce.com', 'the Production button'],
    ['https://test.salesforce.com', 'the Sandbox button'],
    ['https://acme--dev.develop.my.salesforce.com', 'a develop org']
];

function main() {
    const uncovered = [];

    for (const [origin, label] of STARTING_POINTS) {
        const target = normalizeLoginOrigin(origin);
        const permitted = manifest.host_permissions.some((pattern) => covers(pattern, target));
        if (!permitted) { uncovered.push(label + ': ' + origin + ' -> ' + target); }
    }

    assert.deepStrictEqual(uncovered, [],
        'the token exchange would be blocked for these, and it fails only after the ' +
        'user has logged in - which reads as the org refusing:\n  ' + uncovered.join('\n  '));

    /*
     * The fallback path too. When the first attempt cannot load, signIn retries
     * against login or test.salesforce.com - so those must be reachable even
     * for an org whose own host is permitted, or the fallback trades one
     * failure for a worse one.
     */
    for (const fallback of ['https://login.salesforce.com', 'https://test.salesforce.com']) {
        assert.ok(manifest.host_permissions.some((pattern) => covers(pattern, fallback)),
            fallback + ' is signIn\'s fallback and must be permitted, or a sign-in that ' +
            'nearly worked fails with "Failed to fetch" instead');
    }

    /*
     * The other thing host_permissions gates here: reading an org's session
     * cookie.
     *
     * readOrgSession answers the standalone page's "give me a session for this
     * org" with chrome.cookies.get, which needs permission for that host - not
     * just the "cookies" permission. Its own allow-list is the set of hosts it
     * will read for, so every one of them has to be permitted or the page
     * silently gets no session for orgs it can otherwise see in the picker.
     *
     * Checked against the regex in the shipped source rather than a copy, so a
     * host added there without a matching permission fails here.
     */
    // Scoped to readOrgSession: the SOAP relay has a similar-looking guard
    // earlier in the file, and matching that one would test the wrong list.
    const fnStart = background.indexOf('function readOrgSession(');
    assert.notStrictEqual(fnStart, -1, 'could not find readOrgSession');
    const fnBody = background.slice(fnStart, background.indexOf('\n}', fnStart));

    const guard = fnBody.match(/\(\^\|\\\.\)\(([^)]+)\)\$/);
    assert.ok(guard, "could not find readOrgSession's host allow-list");

    const cookieHosts = guard[1].split('|').map((raw) => raw.replace(/\\/g, ''));
    assert.ok(cookieHosts.length >= 4, 'expected several org hosts, found ' + cookieHosts.length);

    for (const host of cookieHosts) {
        const origin = 'https://acme.' + host;
        assert.ok(manifest.host_permissions.some((pattern) => covers(pattern, origin)),
            host + ' is read for session cookies but is not in host_permissions - the ' +
            'org appears in the picker and then has no session');
    }

    // Nothing broader than it needs to be: a wildcard over all of Salesforce
    // would pass everything above and grant far more than sign-in requires.
    for (const pattern of manifest.host_permissions) {
        assert.ok(!/^https:\/\/\*\/\*$/.test(pattern) && !/^<all_urls>$/.test(pattern),
            'host permissions must stay specific, found: ' + pattern);
    }

    console.log('oauth reachability regression test passed (' +
        STARTING_POINTS.length + ' starting points, ' + cookieHosts.length + ' cookie hosts)');
}

main();
