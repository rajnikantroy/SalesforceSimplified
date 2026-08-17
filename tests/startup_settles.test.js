/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * The promise the whole panel starts from.
 *
 * ssAuthReady() gates everything: the client id, the watch list, and
 * refreshSessionState(), which is the only thing that ever turns hasSession
 * off. hasSession starts optimistically true so the sign-in overlay does not
 * flash while storage is read - which is a good default only for as long as
 * something is still going to correct it.
 *
 * So a chain that never settles does not fail: it leaves the panel believing
 * in a session it has not got. No overlay, no error, no request - the panel
 * simply sits there. That is what a first-time user saw on opening it and
 * touching nothing, and it is invisible from a reading of the source, where
 * every line looks like it runs.
 *
 * Driven, because the distinction that matters here is between a promise that
 * rejects and one that never settles, and nothing static can tell them apart.
 */

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'js/ss-core.js'), 'utf8');

function lift(signature) {
    const at = core.indexOf(signature);
    assert.ok(at > -1, signature + ' not found - it has been renamed or removed');
    let depth = 0, started = false;
    for (let i = at; i < core.length; i += 1) {
        if (core[i] === '{') { depth += 1; started = true; }
        else if (core[i] === '}') {
            depth -= 1;
            if (started && depth === 0) { return core.slice(at, i + 1); }
        }
    }
    throw new Error('unterminated ' + signature);
}

const TIMEOUT = Number(core.match(/var SS_PAGE_SESSION_TIMEOUT_MS = (\d+)/)[1]);
assert.ok(TIMEOUT > 0, 'the give-up timeout is gone or zero');

/*
 * A standalone page, a worker that behaves however the case needs, and a
 * clock the test fires by hand.
 */
function page(options) {
    const settings = options || {};
    const timers = [];
    const calls = { adopted: 0, dropped: 0, identity: 0 };

    const box = {
        console: console,
        Promise: Promise,
        URLSearchParams: URLSearchParams,
        window: { location: { search: '', pathname: '/simplified.html' } },

        setTimeout: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
        clearTimeout: (t) => { if (t) { t.live = false; } },

        ssIsStandalonePage: () => true,
        ssAdoptOrg: () => { calls.adopted += 1; },
        ssNoteOrgUse: () => {},
        ssDropForeignCredentials: () => { calls.dropped += 1; },
        ssResolveUserFromIdentity: () => {
            calls.identity += 1;
            return settings.identityFails
                ? Promise.reject(new Error('no identity'))
                : Promise.resolve(null);
        },

        chrome: {
            runtime: {
                lastError: null,
                sendMessage: (message, done) => {
                    if (settings.throws) { throw new Error('context invalidated'); }
                    if (settings.silent) { return; }   /* never calls back */
                    Promise.resolve().then(() => done(settings.response || null));
                }
            }
        }
    };
    box.globalThis = box;
    vm.createContext(box);
    vm.runInContext(
        'var SS_PAGE_SESSION_TIMEOUT_MS = ' + TIMEOUT + ';\n' +
        lift('function ssResolveStandaloneOrg() {'), box);

    return {
        calls: calls,
        run: () => vm.runInContext('ssResolveStandaloneOrg()', box),
        /* Fire every timer that is still armed, as the browser would. */
        fireTimers: () => timers.filter((t) => t.live).forEach((t) => { t.live = false; t.fn(); }),
        armed: () => timers.filter((t) => t.live).length
    };
}

/* A promise that must settle, checked without waiting for a real timeout. */
function settlesWith(promise, label) {
    return Promise.race([
        promise.then((v) => ({ settled: true, value: v }),
                     (e) => ({ settled: true, rejected: e })),
        new Promise((r) => setTimeout(() => r({ settled: false }), 60))
    ]).then((outcome) => {
        assert.ok(outcome.settled,
            label + ': the promise never settled, so ssAuthReady never resolves and ' +
            'the panel starts believing in a session it has not got');
        assert.ok(!outcome.rejected,
            label + ': the promise rejected, and the outer chain would hang on it');
        return outcome.value;
    });
}

async function run() {

    /* The ordinary case, so the rest means something. */
    {
        const p = page({ response: { origin: 'https://acme.my.salesforce.com', sid: 'S' } });
        const value = await settlesWith(p.run(), 'a worker that answers');
        assert.ok(value && value.origin, 'the response is not passed on');
        assert.strictEqual(p.calls.adopted, 1, 'the org was not adopted');
        assert.strictEqual(p.calls.dropped, 1,
            'credentials belonging to another org were not dropped');
        assert.strictEqual(p.armed(), 0,
            'the give-up timer is still armed after a good answer, so it fires later ' +
            'and settles a promise that was already settled');
    }

    /*
     * A worker that never calls back. Chrome stops the background worker when
     * idle; if it goes away mid-flight the callback never runs and there is no
     * error to catch - the one failure with nothing at all to observe.
     */
    {
        const p = page({ silent: true });
        const promise = p.run();
        assert.strictEqual(p.armed(), 1, 'nothing is waiting to give up');
        p.fireTimers();
        const value = await settlesWith(promise, 'a worker that never answers');
        assert.strictEqual(value, null, 'giving up should yield no org, not a stale one');
    }

    /*
     * An identity lookup that fails. The session is already adopted by then -
     * a name is the least of what the page needs, and not knowing it is no
     * reason to never finish starting.
     */
    {
        const p = page({
            identityFails: true,
            response: { origin: 'https://acme.my.salesforce.com', sid: 'S' }
        });
        const value = await settlesWith(p.run(), 'an identity lookup that fails');
        assert.ok(value && value.origin,
            'the org was thrown away because the name could not be read');
        assert.strictEqual(p.calls.adopted, 1, 'the session was not adopted');
    }

    /* sendMessage throwing outright - no extension context at all. */
    {
        const p = page({ throws: true });
        const value = await settlesWith(p.run(), 'messaging that throws');
        assert.strictEqual(value, null);
        assert.strictEqual(p.armed(), 0, 'the give-up timer outlives a synchronous throw');
    }

    /*
     * And it settles once. Both the answer and the timer can arrive - a slow
     * worker that replies just after the deadline - and the second one must
     * not resolve a promise that already has a value.
     */
    {
        const p = page({ response: { origin: 'https://late.my.salesforce.com' } });
        const promise = p.run();
        p.fireTimers();                       /* deadline first */
        const value = await settlesWith(promise, 'a late answer after the deadline');
        assert.strictEqual(value, null,
            'the late answer replaced the value the promise had already settled with');
    }

    /* ------------------------------------------------------------------ */
    /* The outer chain, which is gated on all of the above                 */
    /* ------------------------------------------------------------------ */

    /*
     * _ssAuthReady resolves on both outcomes of the org lookup. Written with
     * a success handler alone, a rejection anywhere in that chain leaves it
     * pending - the same silence, one level up.
     */
    const outer = core.slice(core.indexOf('restoreTyped.then(function () {'),
                             core.indexOf('function ssAuthReady()'));
    assert.ok(/\}, function \(\) \{[\s\S]{0,120}resolve\(SS_AUTH\);/.test(outer),
        'the startup chain has no failure path, so a rejection in the org lookup ' +
        'leaves ssAuthReady pending and the panel silent');

    console.log('startup_settles: ok');
}

run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
