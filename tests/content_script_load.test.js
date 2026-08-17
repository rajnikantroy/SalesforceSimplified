/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * Every content script, evaluated in the order the manifest loads them.
 *
 * Nothing else here catches a file that throws while it is being evaluated,
 * and that failure is total: Chrome stops running the script, so the launcher
 * never mounts and the extension is simply absent from the page. It has
 * happened twice, both times the same shape - a `var` read before its
 * initialiser had run, which hoists the name but not the value, so the read
 * gets undefined instead of a ReferenceError and dies one property deeper:
 *
 *   SS_ORG_HOSTS, read from the storage callback in ss-core
 *   LAUNCHER_COLORS, read by DEFAULT_LAUNCHER_COLOR above its own declaration
 *
 * This does not test behaviour. It tests that the files load at all, which
 * is the floor everything else stands on.
 */

const manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
const scripts = manifest.content_scripts[0].js;

// The two vendor bundles are somebody else's code and enormous; they are
// replaced by stubs good enough for our files to register against.
const VENDOR = /jq\.js$|angular\.min\.js$/;

function jqNode() {
    // A plain object, not a function: index.js reads .length off the result,
    // and a function's own length is read-only.
    const node = {
        length: 0,
        ready(fn) { if (fn) { fn(); } return node; },
        find() { return jqNode(); },
        after() { return node; },
        insertBefore() { return node; },
        attr() { return node; },
        css() { return node; },
        text() { return node; },
        addClass() { return node; },
        on() { return node; },
        scope() { return null; }
    };
    return node;
}

function makeContext() {
    const element = {
        style: {}, className: '', classList: { add() {}, remove() {}, contains: () => false },
        setAttribute() {}, getAttribute: () => '', removeAttribute() {},
        appendChild() {}, removeChild() {}, insertAdjacentHTML() {},
        addEventListener() {}, click() {}, animate() {}, remove() {},
        querySelector: () => null, querySelectorAll: () => [],
        getElementsByTagName: () => [], offsetWidth: 0
    };

    const $ = Object.assign(function () { return jqNode(); }, {
        ajax() { return { done() { return this; }, fail() { return this; }, then() { return this; } }; },
        Deferred() {
            const p = { promise: () => p, then: (f) => f && f() };
            return { resolve: () => p, reject: () => p, promise: () => p };
        }
    });

    const module = {};
    ['config', 'controller', 'service', 'factory', 'directive', 'filter', 'value', 'run']
        .forEach((name) => { module[name] = () => module; });

    const context = {
        console,
        setTimeout, clearTimeout, URL, Blob: class {}, Uint8Array,
        // A real content-script global. record-fields.js watches the record
        // page for Lightning's re-renders, and without this the file throws on
        // load - which is exactly what this test reports, so the sandbox has to
        // be honest about what a browser provides.
        MutationObserver: class { observe() {} disconnect() {} },
        atob: (b) => Buffer.from(b, 'base64').toString('binary'),
        DOMParser: class { parseFromString() { return { getElementsByTagName: () => [], getElementsByTagNameNS: () => [] }; } },
        navigator: { userAgent: 'test', clipboard: { writeText: () => Promise.resolve() } },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: Object.assign(Object.create(element), {
            cookie: '',
            body: element,
            // bootstrap.js checks for the compiled sidenav and logs if it is
            // absent; angular.bootstrap is a no-op here, so hand it one and
            // keep the expected-noise out of the test output.
            getElementById: (id) => (id === 'mySidenav' ? Object.create(element) : null),
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: () => Object.create(element),
            addEventListener() {}
        }),
        chrome: {
            runtime: {
                getURL: (p) => 'chrome-extension://test' + p,
                sendMessage: (m, cb) => { if (cb) { cb({}); } },
                getManifest: () => manifest,
                lastError: null,
                onMessage: { addListener() {} }
            },
            storage: { local: { get: (k, cb) => cb({}), set: (v, cb) => cb && cb(), remove() {} } }
        },
        angular: {
            module: () => module,
            element: () => ({ ready: (fn) => fn && fn(), injector: () => null, scope: () => null }),
            bootstrap() {}
        },
        $: $,
        jQuery: $
    };

    context.window = context;
    context.window.location = {
        origin: 'https://sas-dev-ed.develop.lightning.force.com',
        hostname: 'sas-dev-ed.develop.lightning.force.com',
        href: 'https://sas-dev-ed.develop.lightning.force.com/lightning/o/Account/list'
    };
    context.self = context;
    return vm.createContext(context);
}

function main() {
    const context = makeContext();
    const loaded = [];

    scripts.forEach((path) => {
        if (VENDOR.test(path)) { return; }
        const file = '.' + (path.startsWith('/') ? path : '/' + path);
        assert.ok(fs.existsSync(file), 'manifest lists a file that does not exist: ' + path);

        try {
            vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: path });
        } catch (error) {
            assert.fail('content script failed to evaluate: ' + path + '\n    ' + error.message +
                        '\n    Everything after this file never runs, so the extension does not load.');
        }
        loaded.push(path);
    });

    assert.ok(loaded.length >= 15,
        'expected the manifest to list the content scripts, got ' + loaded.length);

    /*
     * The launcher default specifically: the value that broke, resolved
     * through the same map lookup index.js does at evaluation time.
     */
    assert.ok(context.LAUNCHER_COLORS, 'LAUNCHER_COLORS should be defined by the end of index.js');
    assert.strictEqual(
        context.DEFAULT_LAUNCHER_COLOR,
        context.LAUNCHER_COLORS[context.SS_LAUNCHER_DEFAULTS.color],
        'the default launcher colour must resolve to a real icon, not undefined');
    assert.ok(/ss_icon_enable\.png$/.test(context.DEFAULT_LAUNCHER_COLOR),
        'and the shipped default is the red icon: ' + context.DEFAULT_LAUNCHER_COLOR);

    /*
     * Keyboard shortcuts, against Chrome's rules for them.
     *
     * A bad binding is not a runtime bug - Chrome refuses the whole manifest
     * with "Could not load manifest", so the extension does not install at
     * all. Ctrl+Alt is the trap: it reads as a sensible chord and Chrome
     * rejects it outright, because on Windows it is how AltGr is produced.
     */
    Object.keys(manifest.commands || {}).forEach((name) => {
        const suggested = (manifest.commands[name] || {}).suggested_key || {};
        Object.keys(suggested).forEach((platform) => {
            const combo = suggested[platform];
            const parts = combo.split('+');
            const key = parts[parts.length - 1];
            const modifiers = parts.slice(0, -1);

            assert.ok(modifiers.length >= 1 && modifiers.length <= 2,
                combo + ' must have one or two modifiers');
            assert.ok(modifiers.some((m) => ['Ctrl', 'Alt', 'Command', 'MacCtrl'].includes(m)),
                combo + ' needs Ctrl, Alt, Command or MacCtrl - Shift alone is not accepted');
            assert.ok(!(modifiers.includes('Ctrl') && modifiers.includes('Alt')),
                combo + ' uses Ctrl+Alt, which Chrome rejects outright (AltGr) - ' +
                'the manifest will not load at all');
            assert.ok(/^([A-Z0-9]|F([1-9]|1[0-2])|Comma|Period|Home|End|PageUp|PageDown|Space|Insert|Delete|Up|Down|Left|Right)$/.test(key),
                combo + ' ends in a key Chrome does not accept: ' + key);
        });
    });

    console.log('content script load test passed (' + loaded.length + ' files)');
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
}
