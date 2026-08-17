/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * Talking to a worker Chrome keeps switching off.
 *
 * Manifest V3 stops the background worker after about thirty seconds idle
 * and starts it again on the next message. A message that arrives while it is
 * still starting is closed before it is answered, and the page reported that
 * as an error - on a page with no pipelines configured, where nothing had
 * been attempted and nothing had gone wrong. "Press it again" was always the
 * fix, so it presses it again.
 *
 * The dangerous half is the other one. Only a transport failure may be
 * retried: re-sending a message the worker already acted on is how one
 * deploy becomes two, and from the page a slow answer and a lost one look
 * identical. So the retry is keyed on the failure being transport, and this
 * drives both.
 */

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(
    path.join(ROOT, 'js/angular/services/PipelineService.js'), 'utf8');

/* $q and $timeout, enough for what the service uses. $timeout fires on the
 * microtask queue so the test does not wait for real milliseconds. */
function harness(responder) {
    const sent = [];
    const timers = new Set();

    const $q = {
        defer: function () {
            let resolve, reject;
            const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
            return { promise: promise, resolve: resolve, reject: reject };
        },
        when: (v) => Promise.resolve(v),
        all: (l) => Promise.all(l)
    };

    /*
     * Short waits fire immediately; long ones never do.
     *
     * The service sets two timers: a quarter-second pause before a retry, and
     * a twenty-second guard for a worker that never answers at all. Firing
     * both on the microtask queue makes the guard win every race, so every
     * test would measure the timeout rather than the thing it is about.
     */
    const IMMEDIATE_BELOW_MS = 1000;
    const $timeout = function (fn, delay) {
        const token = {};
        timers.add(token);
        if ((delay || 0) < IMMEDIATE_BELOW_MS) {
            Promise.resolve().then(() => {
                if (timers.has(token)) { timers.delete(token); fn(); }
            });
        }
        return token;
    };
    $timeout.cancel = (token) => { timers.delete(token); };

    const chrome = {
        runtime: {
            lastError: null,
            sendMessage: function (message, done) {
                const attempt = sent.length + 1;
                sent.push(message);
                const answer = responder(attempt, message);
                /* A chrome that refuses outright - the panel running where
                 * the extension's messaging is not available at all. */
                if (answer.thrown) { throw new Error(answer.thrown); }
                Promise.resolve().then(() => {
                    chrome.runtime.lastError = answer.lastError || null;
                    done(answer.response);
                    chrome.runtime.lastError = null;
                });
            }
        }
    };

    let made = null;
    const box = {
        console: console, Promise: Promise, chrome: chrome, window: {},
        angular: { module: () => ({ service: function (name, deps) {
            made = new (deps[deps.length - 1])($q, $timeout);
            return this;
        } }) }
    };
    box.globalThis = box;
    vm.createContext(box);
    vm.runInContext(source, box);
    assert.ok(made, 'PipelineService did not construct');
    return { service: made, sent: sent };
}

const closed = { lastError: { message: 'The message port closed before a response was received.' } };
const ok = (payload) => ({ response: Object.assign({ ok: true }, payload || {}) });

async function run() {

    /* -------------------------------------------------------------- */
    /* A worker that was merely asleep                                 */
    /* -------------------------------------------------------------- */

    /*
     * The case from the report. First message lost to a worker starting up,
     * second answered - and nothing reaches the user at all, because nothing
     * was wrong.
     */
    {
        const { service, sent } = harness((attempt) =>
            attempt === 1 ? closed : ok({ pipelines: [], jobs: [] }));

        const answer = await service.state('https://acme.my.salesforce.com');
        assert.strictEqual(answer.ok, true,
            'a worker that woke on the second message still reported an error');
        assert.strictEqual(sent.length, 2, 'the message was not sent again');
        assert.strictEqual(sent[0].type, sent[1].type,
            'the retry sent a different message from the one that was lost');
    }

    /* Still failing after the second try is a real failure, with its code. */
    {
        const { service, sent } = harness(() => closed);
        await service.state('https://acme.my.salesforce.com').then(
            () => { throw new Error('a worker that never answered resolved anyway'); },
            (problem) => {
                assert.strictEqual(problem.code, 'SS-101',
                    'the failure carries no code, so the panel can link to nothing');
                assert.ok(/background worker/.test(problem.message),
                    'the message no longer says what could not be reached');
            });

        assert.strictEqual(sent.length, 2,
            'expected exactly one retry, got ' + sent.length + ' attempts in total');
    }

    /* -------------------------------------------------------------- */
    /* An answer is never retried                                      */
    /* -------------------------------------------------------------- */

    /*
     * This is the half that matters. A refusal from the worker is an answer:
     * it ran, it decided, it said no. Re-sending is how a message the worker
     * already acted on gets acted on twice, and from here a slow answer and
     * a lost one are indistinguishable.
     */
    {
        const { service, sent } = harness(() =>
            ({ response: { ok: false, error: 'That pipeline is switched off.', code: 'SS-301' } }));

        const answer = await service.state('https://acme.my.salesforce.com');
        assert.strictEqual(answer.ok, false);
        assert.strictEqual(answer.code, 'SS-301', 'the worker\'s own code was dropped');
        assert.strictEqual(sent.length, 1,
            'a refusal from the worker was retried - a message it had already acted ' +
            'on was sent a second time');
    }

    /*
     * An empty reply is the worker going away mid-answer, which is transport,
     * not a decision - so it does retry.
     */
    {
        const { service, sent } = harness((attempt) =>
            attempt === 1 ? { response: null } : ok());
        const answer = await service.state('https://acme.my.salesforce.com');
        assert.strictEqual(answer.ok, true);
        assert.strictEqual(sent.length, 2, 'an empty reply was treated as an answer');
    }

    /*
     * And the other non-transport failure: messaging that is not there at
     * all. It fails with the code that says so, and is not retried - sending
     * it again would throw identically, and the rule is that only a lost
     * message is worth a second attempt.
     *
     * A worker's own refusal cannot exercise this: it resolves rather than
     * failing, so it never reaches the branch that decides whether to retry.
     */
    {
        const { service, sent } = harness(() => ({ thrown: 'Extension context invalidated.' }));
        await service.state('https://acme.my.salesforce.com').then(
            () => { throw new Error('a chrome that threw resolved anyway'); },
            (problem) => {
                assert.strictEqual(problem.code, 'SS-103',
                    'messaging being unavailable is reported as a transport failure, ' +
                    'so it would be retried');
            });
        assert.strictEqual(sent.length, 1,
            'a failure that is not transport was retried anyway');
    }

    /* -------------------------------------------------------------- */
    /* Bounded                                                         */
    /* -------------------------------------------------------------- */

    /*
     * Two attempts, not a loop. A worker that is genuinely broken must be
     * reported rather than hammered - every attempt is a wake-up Chrome pays
     * for and an error the user is still waiting on.
     */
    {
        const { service, sent } = harness(() => closed);
        await service.state('https://acme.my.salesforce.com').catch(() => {});
        assert.ok(sent.length <= 2,
            'the retry is unbounded: ' + sent.length + ' attempts for one call');
    }

    console.log('worker_retry: ok');
}

run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
