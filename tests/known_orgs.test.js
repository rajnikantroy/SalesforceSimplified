/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * One row per org in the picker.
 *
 * ssBrief is keyed by ssOrgKey, which folds every host of an org - Lightning,
 * Setup, my-domain, Visualforce - onto a single key. But nothing removes
 * entries written before that fold existed, and ssUpdateBrief falls back to
 * the whole origin as a key whenever the host is not recognised. Both leave
 * extra entries behind for orgs the user is still using.
 *
 * The picker showed exactly that: the same org two and three times over,
 * including the identical host twice. It is not cosmetic - a list where three
 * rows are the same org, and the difference between them is invisible, makes
 * choosing one a guess.
 */

const background = fs.readFileSync('./js/background.js', 'utf8');

function load(brief) {
    const context = {
        chrome: {
            storage: {
                local: {
                    get: (keys, cb) => {
                        const bag = { ssBrief: brief };
                        if (cb) { cb(bag); return; }
                        return Promise.resolve(bag);
                    },
                    set: (b, cb) => { if (cb) cb(); return Promise.resolve(); },
                    remove: () => Promise.resolve()
                }
            },
            runtime: { onMessage: { addListener: () => {} }, onInstalled: { addListener: () => {} },
                       onStartup: { addListener: () => {} }, lastError: null,
                       getURL: (p) => 'chrome-extension://x/' + p },
            action: { onClicked: { addListener: () => {} } },
            alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
            notifications: { create: () => {}, onClicked: { addListener: () => {} } },
            cookies: { get: () => {} },
            tabs: { query: () => Promise.resolve([]), create: () => {},
                    onUpdated: { addListener: () => {}, removeListener: () => {} },
                    onRemoved: { addListener: () => {}, removeListener: () => {} } },
            identity: { getRedirectURL: () => 'https://ext.chromiumapp.org/' },
            commands: { onCommand: { addListener: () => {} } },
            windows: { create: () => {}, onRemoved: { addListener: () => {} } },
            webRequest: { onBeforeRequest: { addListener: () => {} } }
        },
        fetch: () => Promise.reject(new Error('not used')),
        URL, URLSearchParams, console, setTimeout, clearTimeout, Date, Promise
    };
    context.self = context;
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(background, context);
    return context;
}

const origins = (list) => Array.from(list, (o) => o.origin);

async function main() {

    /* ------------------------------------------------------------------ */
    /* The list the user was actually shown                                */
    /*                                                                     */
    /* Taken from the picker: one org under three keys, two of them the     */
    /* identical Setup host, plus a second org under two more.             */
    /* ------------------------------------------------------------------ */

    const messy = load({
        // The current-format key.
        'icqminstallationkit-dev-ed': {
            origin: 'https://icqminstallationkit-dev-ed.my.salesforce-setup.com',
            instanceKey: 'IND56', updatedAt: 300
        },
        // A whole-origin key, from ssUpdateBrief's fallback.
        'https://icqminstallationkit-dev-ed.my.salesforce-setup.com': {
            origin: 'https://icqminstallationkit-dev-ed.my.salesforce-setup.com',
            instanceKey: 'IND56', updatedAt: 200
        },
        // The same org seen on its Lightning host.
        'icqminstallationkit-dev-ed.lightning': {
            origin: 'https://icqminstallationkit-dev-ed.lightning.force.com',
            instanceKey: 'IND56', updatedAt: 100
        },
        'sas-dev-ed.develop': {
            origin: 'https://sas-dev-ed.develop.my.salesforce.com',
            instanceKey: 'SWE126', updatedAt: 90
        },
        'https://sas-dev-ed.develop.lightning.force.com': {
            origin: 'https://sas-dev-ed.develop.lightning.force.com',
            instanceKey: 'SWE126', updatedAt: 80
        }
    });

    const orgs = await messy.knownOrgs();
    assert.strictEqual(orgs.length, 2, 'five stored entries are two orgs, so two rows');
    assert.deepStrictEqual(origins(orgs).sort(), [
        'https://icqminstallationkit-dev-ed.my.salesforce-setup.com',
        'https://sas-dev-ed.develop.my.salesforce.com'
    ], 'one origin per org');

    // Most recently used first, as before.
    assert.match(orgs[0].origin, /icqminstallationkit/, 'the most recent org leads the list');

    /*
     * When an org has been seen on several hosts, the my-domain one wins: it
     * is where the REST and SOAP APIs are served from, so it is the origin
     * that works for everything the picker leads to.
     */
    assert.strictEqual(orgs[1].origin, 'https://sas-dev-ed.develop.my.salesforce.com',
        'the my-domain host is preferred over the Lightning one');

    /* ------------------------------------------------------------------ */
    /* Every host of an org is the same org                                */
    /* ------------------------------------------------------------------ */

    const allHosts = load({
        a: { origin: 'https://acme.my.salesforce.com', updatedAt: 5 },
        b: { origin: 'https://acme.lightning.force.com', updatedAt: 4 },
        c: { origin: 'https://acme.my.salesforce-setup.com', updatedAt: 3 },
        // Visualforce appends the package namespace to the first label, which
        // has to be stripped or a managed package makes its own row.
        d: { origin: 'https://acme--npsp.vf.force.com', updatedAt: 2 }
    });
    const folded = await allHosts.knownOrgs();
    assert.strictEqual(folded.length, 1, 'four hosts of one org are one row');
    assert.strictEqual(folded[0].origin, 'https://acme.my.salesforce.com',
        'and the my-domain host is the one kept');

    /*
     * The my-domain host wins on its merits, not on being encountered first.
     * Here the Lightning host is both stored first and more recently used, so
     * a fold that simply keeps the incumbent would settle on the host the
     * SOAP API is not served from.
     */
    const lightningFirst = load({
        a: { origin: 'https://acme.lightning.force.com', updatedAt: 99 },
        b: { origin: 'https://acme.my.salesforce.com', updatedAt: 1 }
    });
    const preferred = await lightningFirst.knownOrgs();
    assert.strictEqual(preferred.length, 1, 'still one row');
    assert.strictEqual(preferred[0].origin, 'https://acme.my.salesforce.com',
        'the my-domain host wins even when seen second and used less recently');
    assert.strictEqual(preferred[0].updatedAt, 99,
        'while the row still sorts by when the org was last used, on any host');

    /*
     * Anything that is not a Salesforce host is not an org, so it is not a row.
     *
     * This is the picker offering the extension itself: earlier versions
     * recorded the browsing page's origin rather than the org's, so a brief
     * written from simplified.html stored chrome-extension://... and it then
     * appeared in the list as somewhere to switch to. Filtering on read clears
     * those without a migration that has to be right first time.
     */
    const notOrgs = load({
        a: { origin: 'chrome-extension://hjeigbpcblpkaienmpihneipkempijob', updatedAt: 9 },
        b: { origin: 'https://foo--bar.example.com', updatedAt: 2 },
        c: { origin: 'https://acme.my.salesforce.com', updatedAt: 1 }
    });
    assert.deepStrictEqual(origins(await notOrgs.knownOrgs()),
        ['https://acme.my.salesforce.com'],
        'only Salesforce hosts are offered as orgs');

    // Every host the extension actually runs on stays eligible - filtering
    // must not quietly drop Setup or Visualforce origins along with the junk.
    const everyHost = load({
        a: { origin: 'https://one.my.salesforce-setup.com', updatedAt: 4 },
        b: { origin: 'https://two.lightning.force.com', updatedAt: 3 },
        c: { origin: 'https://three.vf.force.com', updatedAt: 2 },
        d: { origin: 'https://four.visual.force.com', updatedAt: 1 }
    });
    assert.strictEqual((await everyHost.knownOrgs()).length, 4,
        'setup, lightning and visualforce hosts are all real orgs');

    // Two genuinely different orgs must not be folded together.
    const distinct = load({
        a: { origin: 'https://acme.my.salesforce.com', updatedAt: 2 },
        b: { origin: 'https://beta.my.salesforce.com', updatedAt: 1 }
    });
    assert.strictEqual((await distinct.knownOrgs()).length, 2,
        'different orgs stay separate');

    // A sandbox is its own org, not the production one it is named after.
    const sandbox = load({
        a: { origin: 'https://acme.my.salesforce.com', updatedAt: 2 },
        b: { origin: 'https://acme--uat.sandbox.my.salesforce.com', updatedAt: 1 }
    });
    assert.strictEqual((await sandbox.knownOrgs()).length, 2,
        'a sandbox is not folded into production');

    /* ------------------------------------------------------------------ */
    /* What survives the fold                                              */
    /* ------------------------------------------------------------------ */

    /*
     * The instance key is what tells two similar-looking rows apart, and only
     * one entry may ever have resolved it - dropping it because that entry
     * lost the fold would leave the row less identifiable than before.
     */
    const partial = load({
        a: { origin: 'https://acme.my.salesforce.com', updatedAt: 9, instanceKey: null },
        b: { origin: 'https://acme.lightning.force.com', updatedAt: 1, instanceKey: 'IND56' }
    });
    const kept = await partial.knownOrgs();
    assert.strictEqual(kept.length, 1, 'still one row');
    assert.strictEqual(kept[0].instanceKey, 'IND56',
        'an instance key is carried over from whichever entry had it');

    /* ------------------------------------------------------------------ */
    /* Entries that name nothing                                           */
    /* ------------------------------------------------------------------ */

    const junk = load({
        a: { origin: null, updatedAt: 3 },
        b: { updatedAt: 2 },
        c: { origin: 'https://acme.my.salesforce.com', updatedAt: 1 }
    });
    assert.deepStrictEqual(origins(await junk.knownOrgs()),
        ['https://acme.my.salesforce.com'],
        'entries with no origin are not rows - there is nowhere for them to lead');

    assert.deepStrictEqual(Array.from(await load({}).knownOrgs()), [],
        'an empty store is an empty list');
    assert.deepStrictEqual(Array.from(await load(undefined).knownOrgs()), [],
        'and so is a missing one');

    console.log('known orgs regression test passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
