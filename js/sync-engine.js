/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Sync engine - moving metadata from one authenticated org to another.
 *
 * Runs in the service worker, and it has to. Everything else in this
 * extension is bound to the org whose page it is sitting on: ssSessionId()
 * is that page's session and ssSoapOrigin() is that page's host. A pipeline
 * is by definition about two orgs, and only the worker can hold two
 * credentials and post to two hosts at once.
 *
 * ---------------------------------------------------------------------------
 * What this does, and what it deliberately does not
 * ---------------------------------------------------------------------------
 *
 * Does: retrieve() a package from the source org, deploy() it to the target,
 * poll until the org says how it went, and keep the outcome as history that
 * can be read and retried later.
 *
 * Also does: carry records, which needs something metadata does not. Ids are
 * not portable between orgs - a record edited in one sandbox has no
 * counterpart Id in the other - so the user nominates a field that means the
 * same row in both, and there are two ways to honour it:
 *
 *   upsert  the org matches, in one call, on a field marked as an External Id
 *   lookup  we match, by querying the target for the incoming key values,
 *           then updating what exists and inserting what does not
 *
 * The first is tidier and needs an admin to have prepared the object. The
 * second works on a stock Account where nothing has been prepared, at the
 * cost of an extra query and a question upsert never has to ask: what if two
 * records in the target share the value.
 *
 * Does not: run itself. Jobs are staged and wait for someone to apply them.
 * An unattended write into a second org is how two sandboxes overwrite each
 * other's work, and the pipeline being bidirectional doubles that rather
 * than halving it.
 *
 * ---------------------------------------------------------------------------
 * Why there is an alarm at all, given jobs are user-applied
 * ---------------------------------------------------------------------------
 *
 * A Manifest V3 service worker is killed after about thirty seconds of
 * inactivity, and a deploy takes minutes. The org keeps going - the deploy
 * has an async id and finishes whether or not anything is listening - so the
 * job records that id, and the alarm exists to pick the polling back up after
 * the worker has been shot. Without it every deploy longer than the worker's
 * lifetime would read as failed while actually succeeding, which is the worst
 * of the possible wrong answers.
 *
 * The retrieved zip is never persisted. It routinely runs to tens of
 * megabytes and chrome.storage.local is not the place for it, so a job
 * interrupted between retrieve and deploy starts again from the retrieve.
 * That costs one extra call and keeps the store small enough to be reliable.
 */

/* global chrome */

var SS_SYNC_JOBS_KEY = 'ssSyncJobs';
var SS_SYNC_PIPELINES_KEY = 'ssSyncPipelines';
var SS_SYNC_ALARM = 'ss-sync-sweep';

/* Enough to be a useful record, small enough that the store stays quick. */
var SS_SYNC_MAX_JOBS = 100;
var SS_SYNC_MAX_HISTORY = 20;

/*
 * How long a job may sit in 'running' with nothing to poll before it is
 * called interrupted. This only catches the window between apply and the org
 * handing back an async id; once there is an id, the job is resumable and
 * this does not apply.
 */
var SS_SYNC_STALL_MS = 5 * 60 * 1000;

/* The org's own deploys are minutes, not seconds. Past this it is reported
 * as still running rather than declared failed - the org is the authority on
 * whether it finished, and it has not said no. */
var SS_SYNC_DEPLOY_LIMIT_MS = 60 * 60 * 1000;

var SS_SYNC_META_NS = 'http://soap.sforce.com/2006/04/metadata';

/* How many finished components to keep for the progress view. Enough to see
 * movement, few enough that the record stays small. */
var SS_SYNC_RECENT_LIMIT = 8;

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */

function ssSyncId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' +
        Math.random().toString(36).slice(2, 8);
}

function ssSyncEscapeXml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function ssSyncFirstText(text, tag) {
    if (!text) { return null; }
    var match = new RegExp('<(?:\\w+:)?' + tag + '[^>]*>([\\s\\S]*?)</(?:\\w+:)?' + tag + '>', 'i')
        .exec(text);
    return match ? match[1] : null;
}

function ssSyncSoapFault(text) {
    if (!text) { return null; }
    var match = /<faultstring>([\s\S]*?)<\/faultstring>/i.exec(text);
    return match ? match[1].trim() : null;
}

/* ------------------------------------------------------------------ */
/* Building what gets sent                                             */
/* ------------------------------------------------------------------ */

/*
 * The manifest for a set of components.
 *
 * Grouped by type because package.xml is grouped by type: one <types> block
 * per metadata type with every member under it. Sending one block per
 * component is accepted by some orgs and refused by others, and the grouped
 * form is the documented one.
 */
function ssSyncPackageXml(components, apiVersion) {
    var byType = {};
    var order = [];

    (components || []).forEach(function (component) {
        if (!component || !component.type || !component.name) { return; }
        var type = String(component.type);
        if (!byType[type]) { byType[type] = []; order.push(type); }
        if (byType[type].indexOf(component.name) === -1) {
            byType[type].push(String(component.name));
        }
    });

    if (!order.length) { return null; }

    // Sorted so that the same selection produces the same manifest: two jobs
    // that differ only in the order things were ticked should not read as
    // different packages in the history.
    order.sort();

    var types = order.map(function (type) {
        var members = byType[type].slice().sort().map(function (name) {
            return '<members>' + ssSyncEscapeXml(name) + '</members>';
        }).join('');
        // One <name> per block, however many members are in it.
        return '<types>' + members + '<name>' + ssSyncEscapeXml(type) + '</name></types>';
    }).join('');

    return '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Package xmlns="' + SS_SYNC_META_NS + '">' +
        types +
        '<version>' + ssSyncEscapeXml(apiVersion) + '</version>' +
        '</Package>';
}

function ssSyncEnvelope(sessionId, body) {
    return '<?xml version="1.0" encoding="UTF-8"?>' +
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
        'xmlns:met="' + SS_SYNC_META_NS + '">' +
        '<soapenv:Header><met:SessionHeader><met:sessionId>' +
        ssSyncEscapeXml(sessionId) +
        '</met:sessionId></met:SessionHeader></soapenv:Header>' +
        '<soapenv:Body>' + body + '</soapenv:Body></soapenv:Envelope>';
}

/*
 * The <unpackaged> block inside a retrieveRequest is the manifest without its
 * XML declaration and without the outer <Package> element's namespace, which
 * the envelope has already declared.
 */
function ssSyncUnpackaged(packageXml) {
    var inner = String(packageXml || '')
        .replace(/<\?xml[^>]*\?>/i, '')
        .replace(/<Package[^>]*>/i, '')
        .replace(/<\/Package>/i, '')
        .trim();
    return inner
        .replace(/<types>/g, '<met:types>').replace(/<\/types>/g, '</met:types>')
        .replace(/<members>/g, '<met:members>').replace(/<\/members>/g, '</met:members>')
        .replace(/<name>/g, '<met:name>').replace(/<\/name>/g, '</met:name>')
        .replace(/<version>/g, '<met:version>').replace(/<\/version>/g, '</met:version>');
}

function ssSyncRetrieveBody(packageXml, apiVersion) {
    return '<met:retrieve><met:retrieveRequest>' +
        '<met:apiVersion>' + ssSyncEscapeXml(apiVersion) + '</met:apiVersion>' +
        '<met:singlePackage>true</met:singlePackage>' +
        '<met:unpackaged>' + ssSyncUnpackaged(packageXml) + '</met:unpackaged>' +
        '</met:retrieveRequest></met:retrieve>';
}

function ssSyncCheckRetrieveBody(asyncId) {
    return '<met:checkRetrieveStatus>' +
        '<met:asyncProcessId>' + ssSyncEscapeXml(asyncId) + '</met:asyncProcessId>' +
        '<met:includeZip>true</met:includeZip>' +
        '</met:checkRetrieveStatus>';
}

/*
 * deploy().
 *
 * rollbackOnError is not optional here and is not offered as a setting. A
 * partial deploy into a second org leaves it in a state neither org's history
 * describes, and the whole point of this feature is that the two match.
 *
 * checkOnly comes from the job so that a validation can be run against the
 * same code path as the real thing - a dry run that took a different route
 * would not be evidence about the real one.
 */
/*
 * Which tests the org runs. Only the two that matter here:
 *
 *   NoTestRun      the default in a sandbox, and the fast one
 *   RunLocalTests  what a production deploy requires, and what a validation
 *                  must have run for that deploy to be quick-deployable later
 *
 * The second is the reason this is a setting at all. A validation that ran no
 * tests is still a validation, but the org will not let it stand in for a
 * production deploy - so somebody aiming at production has to have chosen it
 * before validating, not after.
 */
var SS_SYNC_TEST_LEVELS = ['NoTestRun', 'RunLocalTests'];

function ssSyncTestLevel(value) {
    return SS_SYNC_TEST_LEVELS.indexOf(value) === -1 ? 'NoTestRun' : value;
}

function ssSyncDeployBody(zipBase64, options) {
    var opts = options || {};
    return '<met:deploy>' +
        '<met:ZipFile>' + zipBase64 + '</met:ZipFile>' +
        '<met:DeployOptions>' +
        '<met:singlePackage>true</met:singlePackage>' +
        '<met:rollbackOnError>true</met:rollbackOnError>' +
        '<met:checkOnly>' + (opts.checkOnly ? 'true' : 'false') + '</met:checkOnly>' +
        '<met:testLevel>' + ssSyncTestLevel(opts.testLevel) + '</met:testLevel>' +
        '</met:DeployOptions>' +
        '</met:deploy>';
}

/*
 * Quick deploy: deploy a validation the org has already done.
 *
 * A successful checkOnly deploy leaves the org holding the whole verified
 * package. deployRecentValidation says "that one, for real" - no zip is sent
 * again, nothing is recompiled, and any tests it ran are not re-run. On a
 * package that took twenty minutes to validate against production, that is
 * the difference between a deploy window and an outage.
 *
 * The org keeps a validation for ten days. Past that the id is gone and the
 * only honest thing to offer is validating again.
 */
var SS_SYNC_VALIDATION_TTL_MS = 10 * 24 * 60 * 60 * 1000;

function ssSyncQuickDeployBody(validationId) {
    return '<met:deployRecentValidation>' +
        '<met:validationId>' + ssSyncEscapeXml(validationId) + '</met:validationId>' +
        '</met:deployRecentValidation>';
}

/*
 * Whether a job is a validation that can still be turned into a deploy.
 *
 * Every clause is a way it could fail, checked here rather than by sending it
 * and reading the refusal: it has to be metadata, it has to have succeeded,
 * it has to have been a validation rather than a deploy that already
 * happened, the org's id for it has to have been kept, and it has to be
 * inside the window the org keeps it for.
 */
function ssSyncQuickDeployable(job, now) {
    return ssSyncQuickDeployBlocker(job, now) === null;
}

/*
 * Why a validation cannot be quick deployed, or null if it can.
 *
 * Written as the reason rather than a boolean because the answer people need
 * is not "no" - it is what to do instead, and the commonest case has a fix
 * they would never guess: a validation that ran no tests is not eligible, so
 * the pipeline has to be set to run local tests and the validation done
 * again. That was offered as a button, and pressing it produced a refusal
 * from the org that read as the feature being broken.
 */
function ssSyncQuickDeployBlocker(job, now) {
    if (!job || job.kind === 'data') { return 'Records are not deployed.'; }
    if (job.state !== 'succeeded') { return 'Only a validation that succeeded can be deployed.'; }

    var result = job.result || {};
    if (!result.checkOnly) { return 'This was a deploy, not a validation.'; }
    if (!result.deployId) {
        return 'The org\'s id for this validation was not kept, so there is nothing ' +
               'to deploy from. Validate again.';
    }

    /*
     * The org's own rule: deployRecentValidation needs the validation to have
     * run tests. NoTestRun is the fast default and is fine for validating -
     * it just cannot stand in for a deploy afterwards.
     */
    if (!result.testLevel || result.testLevel === 'NoTestRun') {
        return 'This was validated without running tests, and the org will only quick ' +
               'deploy a validation that ran them. Set Tests to local tests on the ' +
               'pipeline and validate again.';
    }

    if (((now || Date.now()) - (job.updatedAt || 0)) >= SS_SYNC_VALIDATION_TTL_MS) {
        return 'The org only keeps a validation for ten days, and this one has expired. ' +
               'Validate again.';
    }
    return null;
}

/* What is left of the ten days, for a screen that would rather say "8 days
 * left" than let somebody discover the expiry by pressing the button. */
function ssSyncValidationDaysLeft(job, now) {
    var gone = (now || Date.now()) - ((job && job.updatedAt) || 0);
    return Math.max(0, Math.ceil((SS_SYNC_VALIDATION_TTL_MS - gone) / (24 * 60 * 60 * 1000)));
}

function ssSyncCheckDeployBody(asyncId) {
    return '<met:checkDeployStatus>' +
        '<met:asyncProcessId>' + ssSyncEscapeXml(asyncId) + '</met:asyncProcessId>' +
        '<met:includeDetails>true</met:includeDetails>' +
        '</met:checkDeployStatus>';
}

/* ------------------------------------------------------------------ */
/* Reading what comes back                                             */
/* ------------------------------------------------------------------ */

function ssSyncAsyncId(text) {
    var result = ssSyncFirstText(text, 'result');
    var id = ssSyncFirstText(result || text, 'id');
    return id ? id.trim() : null;
}

/*
 * The retrieve status. Regex rather than a DOM parse because the zip is
 * base64 that runs to tens of megabytes, and building a DOM around it costs
 * far more than finding two tags in it.
 */
function ssSyncRetrieveStatus(text) {
    var done = (ssSyncFirstText(text, 'done') || '').trim() === 'true';
    var status = (ssSyncFirstText(text, 'status') || '').trim();
    var message = (ssSyncFirstText(text, 'errorMessage') || '').trim();
    var zip = null;

    if (done) {
        var match = /<(?:\w+:)?zipFile>([\s\S]*?)<\/(?:\w+:)?zipFile>/i.exec(text || '');
        zip = match ? match[1].replace(/\s+/g, '') : null;
    }

    return {
        done: done,
        status: status || null,
        zipFile: zip,
        error: message || ssSyncSoapFault(text) || null
    };
}

/*
 * The deploy status, and the component failures with it.
 *
 * The failures are the whole value of this screen. "Deploy failed" tells
 * somebody nothing they can act on; "ApexClass Foo line 12: Variable does not
 * exist" tells them what to fix, and it is what the org actually said.
 */
function ssSyncDeployStatus(text) {
    var done = (ssSyncFirstText(text, 'done') || '').trim() === 'true';
    var status = (ssSyncFirstText(text, 'status') || '').trim();
    var success = (ssSyncFirstText(text, 'success') || '').trim() === 'true';

    var failures = [];
    var pattern = /<(?:\w+:)?componentFailures>([\s\S]*?)<\/(?:\w+:)?componentFailures>/gi;
    var hit;
    while ((hit = pattern.exec(text || '')) !== null) {
        var block = hit[1];
        failures.push({
            type: (ssSyncFirstText(block, 'componentType') || '').trim() || null,
            name: (ssSyncFirstText(block, 'fullName') || '').trim() || null,
            file: (ssSyncFirstText(block, 'fileName') || '').trim() || null,
            line: (ssSyncFirstText(block, 'lineNumber') || '').trim() || null,
            problem: (ssSyncFirstText(block, 'problem') || '').trim() || null
        });
    }

    /*
     * The components the org has finished with so far.
     *
     * checkDeployStatus reports these as it goes, and they were being thrown
     * away - which left the panel with a spinner and no answer to the one
     * question somebody watching a deploy has: what is it doing now.
     *
     * Capped, because a large package reports hundreds and only the recent
     * few are worth showing. The count comes from the org's own tally, not
     * from the length of this list.
     */
    var recent = [];
    var successes = /<(?:\w+:)?componentSuccesses>([\s\S]*?)<\/(?:\w+:)?componentSuccesses>/gi;
    var got;
    while ((got = successes.exec(text || '')) !== null) {
        var name = (ssSyncFirstText(got[1], 'fullName') || '').trim();
        var kind = (ssSyncFirstText(got[1], 'componentType') || '').trim();
        if (!name || name === 'package.xml') { continue; }
        recent.push(kind ? kind + ' ' + name : name);
        if (recent.length > SS_SYNC_RECENT_LIMIT) { recent.shift(); }
    }

    var counts = {
        deployed: parseInt(ssSyncFirstText(text, 'numberComponentsDeployed') || '0', 10) || 0,
        total: parseInt(ssSyncFirstText(text, 'numberComponentsTotal') || '0', 10) || 0,
        errors: parseInt(ssSyncFirstText(text, 'numberComponentErrors') || '0', 10) || 0
    };

    return {
        done: done,
        status: status || null,
        success: done && success,
        failures: failures,
        recent: recent,
        counts: counts,
        error: (ssSyncFirstText(text, 'errorMessage') || '').trim() ||
               ssSyncSoapFault(text) || null
    };
}

/*
 * One line for a job that failed, built from what the org said rather than
 * from the fact that it said no.
 */
function ssSyncFailureSummary(status) {
    if (!status) { return 'The deploy failed.'; }
    if (status.failures && status.failures.length) {
        var first = status.failures[0];
        var where = [first.type, first.name].filter(Boolean).join(' ');
        var line = first.line ? ' (line ' + first.line + ')' : '';
        var head = (where ? where + line + ': ' : '') + (first.problem || 'no reason given');
        if (status.failures.length > 1) {
            return head + ' - and ' + (status.failures.length - 1) + ' more';
        }
        return head;
    }
    if (status.error) { return status.error; }
    if (status.status) { return 'The deploy finished as ' + status.status + '.'; }
    return 'The deploy failed.';
}

/* ------------------------------------------------------------------ */
/* Job records                                                         */
/* ------------------------------------------------------------------ */

/*
 * States, and the only ways between them:
 *
 *   staged   -> running                (someone applied it)
 *   running  -> succeeded | failed | blocked
 *   failed   -> running                (retry)
 *   blocked  -> running                (retry, once there is a credential)
 *
 * 'blocked' is separate from 'failed' on purpose. A missing session is not a
 * broken job - nothing about it was wrong, and the fix is signing in rather
 * than changing anything. Showing those as failures teaches people to ignore
 * the failure list.
 */
var SS_SYNC_STATES = ['staged', 'running', 'succeeded', 'failed', 'blocked'];

function ssSyncNewJob(spec) {
    var now = Date.now();
    return {
        id: ssSyncId('job'),
        createdAt: now,
        updatedAt: now,
        pipelineId: (spec && spec.pipelineId) || null,
        /*
         * 'metadata' or 'data'. They share everything about being a job -
         * staged, reviewed, applied, retried, kept as history - and share
         * none of how they are carried out, which is why the runner branches
         * on this rather than the two being separate machinery.
         */
        kind: (spec && spec.kind) === 'data' ? 'data' : 'metadata',
        checkOnly: !!(spec && spec.checkOnly),
        /* Which tests the org runs; see SS_SYNC_TEST_LEVELS. */
        testLevel: ssSyncTestLevel(spec && spec.testLevel),
        /*
         * Set only on a quick deploy: the org's id for the validation this
         * job is turning into a real deploy. Its presence is what makes the
         * runner skip the retrieve.
         */
        validationId: (spec && spec.validationId) || null,
        validationOf: (spec && spec.validationOf) || null,
        source: (spec && spec.source) || null,
        target: (spec && spec.target) || null,
        components: (spec && spec.components) || [],
        /* Data jobs only. */
        objectApiName: (spec && spec.objectApiName) || null,
        keyField: (spec && spec.keyField) || null,
        query: (spec && spec.query) || null,
        apiVersion: (spec && spec.apiVersion) || null,
        state: 'staged',
        stage: null,
        async: null,
        attempts: 0,
        error: null,
        result: null,
        /* Attempt zero: staging is not an attempt at anything, and the
         * grouping needs every line stamped or it cannot tell a new record
         * from an old unstamped one. */
        history: [{ at: now, state: 'staged', note: 'Staged for review.', attempt: 0 }]
    };
}

/*
 * Every state change goes through here so that every state change is dated
 * and kept. A job that failed twice and then worked is a different story from
 * one that worked first time, and the history is where that story lives.
 */
function ssSyncTransition(job, state, note, patch) {
    if (!job) { return job; }
    if (SS_SYNC_STATES.indexOf(state) === -1) {
        throw new Error('Unknown sync job state: ' + state);
    }

    var next = {};
    var field;
    for (field in job) {
        if (Object.prototype.hasOwnProperty.call(job, field)) { next[field] = job[field]; }
    }
    if (patch) {
        for (field in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, field)) { next[field] = patch[field]; }
        }
    }

    var at = Date.now();
    next.state = state;
    next.updatedAt = at;

    var history = (job.history || []).slice();
    /*
     * Which attempt this line belongs to.
     *
     * Recorded after the patch is applied, so the transition that starts a
     * run - the one that increments attempts - is the first line of the new
     * attempt rather than the last of the old one. Without it a job retried
     * twice reads as one long list of the same three lines repeated, and
     * there is no way to see where one attempt ended.
     */
    history.push({ at: at, state: state, note: note || null, attempt: next.attempts || 0 });
    if (history.length > SS_SYNC_MAX_HISTORY) {
        history = history.slice(history.length - SS_SYNC_MAX_HISTORY);
    }
    next.history = history;
    return next;
}

/*
 * Anything that stopped can be started again. Succeeded cannot: re-running it
 * would be a second deploy of the same package, which is a new decision and
 * should be a new job rather than a button that quietly repeats one.
 */
function ssSyncRetryable(job) {
    return !!job && (job.state === 'failed' || job.state === 'blocked');
}

function ssSyncApplyable(job) {
    return !!job && job.state === 'staged';
}

/*
 * Whether a job may be forgotten.
 *
 * Anything that has stopped, and nothing that has not. A running job holds
 * the org's async deploy id, and that id is the only way back to a deploy
 * that outlived the worker - throw the record away and the deploy carries on
 * in the org with nothing left that can report how it went.
 *
 * The list never offers Discard on a running row, but the rule belongs here
 * rather than in the markup: a handler that deletes whatever it is told to is
 * one mistaken caller away from doing exactly that.
 */
function ssSyncForgettable(job) {
    return !!job && job.state !== 'running';
}

/*
 * The two lists the screen offers to empty, defined the same way the screen
 * groups them - 'failed' covers blocked as well, because that is what is
 * under the Failed heading. A Clear all that left rows behind on the list it
 * was pressed from would be worse than no button.
 */
function ssSyncInGroup(job, group) {
    if (!job) { return false; }
    if (group === 'succeeded') { return job.state === 'succeeded'; }
    if (group === 'failed') { return job.state === 'failed' || job.state === 'blocked'; }
    return false;
}

/*
 * Clearing a list. Returns what is left and how many went, so the screen can
 * say what it did rather than just emptying.
 *
 * Nothing in the org is touched by this: these are records of deploys that
 * already finished, kept in this browser. A cleared failure is a forgotten
 * report, not an undone deployment.
 */
function ssSyncClear(jobs, group) {
    if (group !== 'succeeded' && group !== 'failed') {
        return { jobs: jobs || [], removed: 0, error: 'There is no such list to clear.' };
    }
    var kept = [];
    var removed = 0;
    (jobs || []).forEach(function (job) {
        /*
         * ssSyncForgettable cannot currently fire here: neither group holds a
         * running job, which the test pins directly. It is the second lock on
         * the thing that must not happen - a group definition growing to
         * include a live state would otherwise start deleting deploys that
         * are still in flight, and that is not a failure worth discovering in
         * production.
         */
        if (ssSyncInGroup(job, group) && ssSyncForgettable(job)) {
            removed += 1;
            return;
        }
        kept.push(job);
    });
    return { jobs: kept, removed: removed };
}

/*
 * Newest first, and only as many as are worth keeping. Succeeded jobs are
 * dropped before failed ones of the same age: a failure somebody has not
 * looked at is the record that still has something to say.
 */
function ssSyncPrune(jobs, max) {
    var limit = max || SS_SYNC_MAX_JOBS;
    var all = (jobs || []).slice().sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    if (all.length <= limit) { return all; }

    var keep = [];
    var spare = [];
    all.forEach(function (job) {
        if (job.state === 'succeeded') { spare.push(job); } else { keep.push(job); }
    });

    if (keep.length >= limit) { return keep.slice(0, limit); }
    return keep.concat(spare.slice(0, limit - keep.length)).sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
}

function ssSyncCounts(jobs) {
    var counts = { staged: 0, running: 0, succeeded: 0, failed: 0, blocked: 0 };
    (jobs || []).forEach(function (job) {
        if (job && counts[job.state] !== undefined) { counts[job.state] += 1; }
    });
    return counts;
}

/*
 * How much a pipeline has actually been used.
 *
 * Counted on the pipeline rather than worked out from the job list, because
 * the job list is not a record of everything that happened: it is capped at a
 * hundred, and either Clear all empties half of it. A tally derived from it
 * would drop from "47 runs" to "12 runs" the moment somebody tidied up, which
 * is a worse answer than none.
 *
 * A run is a run. A retry of a failed job is a second run, and a quick deploy
 * of a validation is another - both of them asked the org to do something, so
 * both count. Pure, so the arithmetic is testable without a store.
 */
function ssSyncCountUse(pipeline, event, when) {
    if (!pipeline) { return pipeline; }
    var at = when || Date.now();

    var usage = {
        runs: (pipeline.usage && pipeline.usage.runs) || 0,
        succeeded: (pipeline.usage && pipeline.usage.succeeded) || 0,
        failed: (pipeline.usage && pipeline.usage.failed) || 0,
        lastRunAt: (pipeline.usage && pipeline.usage.lastRunAt) || null
    };

    if (event === 'run') { usage.runs += 1; usage.lastRunAt = at; }
    else if (event === 'succeeded') { usage.succeeded += 1; }
    else if (event === 'failed') { usage.failed += 1; }
    else { return pipeline; }

    var next = {};
    Object.keys(pipeline).forEach(function (field) { next[field] = pipeline[field]; });
    next.usage = usage;
    return next;
}

/*
 * The same event, written down against whichever pipeline the job belongs to.
 * A job whose pipeline has since been removed simply has nothing to count
 * against, which is not an error - the history of it survives either way.
 */
function ssSyncRecordUse(pipelineId, event) {
    if (!pipelineId) { return Promise.resolve(false); }
    return ssSyncRead(SS_SYNC_PIPELINES_KEY, []).then(function (pipelines) {
        var found = false;
        var next = (pipelines || []).map(function (pipeline) {
            if (pipeline && pipeline.id === pipelineId) {
                found = true;
                return ssSyncCountUse(pipeline, event);
            }
            return pipeline;
        });
        if (!found) { return false; }
        return ssSyncWrite(SS_SYNC_PIPELINES_KEY, next);
    });
}

/*
 * A pipeline is a pair of orgs and a direction. Both ends have to be real and
 * different: an org paired with itself is a deploy into the org the package
 * came from, which is at best a no-op and at worst a way to overwrite
 * something with an older copy of itself.
 */
function ssSyncValidatePipeline(pipeline) {
    if (!pipeline) { return 'No pipeline given.'; }
    if (!pipeline.a || !pipeline.a.origin) { return 'The first org is missing.'; }
    if (!pipeline.b || !pipeline.b.origin) { return 'The second org is missing.'; }
    if (ssSyncSameOrg(pipeline.a.origin, pipeline.b.origin)) {
        return 'A pipeline needs two different orgs.';
    }
    /*
     * 'both' means either org may be the source, decided by where you are
     * when you press. It is a permission and not automation - the direction
     * is only ever the two refusals in ssSyncRoute, and nothing runs without
     * a press either way.
     */
    if (['a-to-b', 'b-to-a', 'both'].indexOf(pipeline.direction) === -1) {
        return 'Choose which way this pipeline runs.';
    }
    return null;
}

/*
 * Which org may send down this pipeline.
 *
 * A one-way pipeline has exactly one, and that is the answer somebody in the
 * other org needs: not "you cannot do this here" but "do it there". A
 * bidirectional one has no single sender, so it says so with null rather
 * than picking a side.
 */
function ssSyncSender(pipeline) {
    if (!pipeline) { return null; }
    if (pipeline.direction === 'a-to-b') { return pipeline.a || null; }
    if (pipeline.direction === 'b-to-a') { return pipeline.b || null; }
    return null;
}

var SS_SYNC_ORG_HOST_SUFFIX =
    /\.(?:lightning\.force\.com|my\.salesforce-setup\.com|my\.salesforce\.com|vf\.force\.com|visual\.force\.com)$/i;

function ssSyncOrgKey(origin) {
    if (!origin) { return ''; }
    var host = String(origin).toLowerCase();
    try {
        if (/^https?:\/\//i.test(host)) {
            host = new URL(host).hostname;
        }
    } catch (e) {}
    if (!SS_SYNC_ORG_HOST_SUFFIX.test(host)) { return host; }
    var key = host.replace(SS_SYNC_ORG_HOST_SUFFIX, '');
    var labels = key.split('.');
    labels[0] = labels[0].replace(/--[^-]*$/, '');
    return labels.join('.');
}

function ssSyncSameOrg(a, b) {
    if (!a || !b) { return false; }
    if (a === b) { return true; }
    var keyA = ssSyncOrgKey(a);
    var keyB = ssSyncOrgKey(b);
    return !!keyA && keyA === keyB;
}

/*
 * Which way round a job goes, given the pipeline and the org it started from.
 * A one-way pipeline asked to carry something the wrong way says so rather
 * than quietly reversing it.
 */
function ssSyncRoute(pipeline, fromOrigin) {
    if (!pipeline) { return { error: 'No pipeline.' }; }
    var a = pipeline.a || {};
    var b = pipeline.b || {};

    if (fromOrigin === a.origin || ssSyncSameOrg(fromOrigin, a.origin)) {
        if (pipeline.direction === 'b-to-a') {
            return { code: 'SS-302',
                     error: 'This pipeline only runs ' + (b.label || 'the second org') +
                            ' to ' + (a.label || 'the first org') + '.' };
        }
        return { source: a, target: b };
    }
    if (fromOrigin === b.origin || ssSyncSameOrg(fromOrigin, b.origin)) {
        if (pipeline.direction === 'a-to-b') {
            return { code: 'SS-302',
                     error: 'This pipeline only runs ' + (a.label || 'the first org') +
                            ' to ' + (b.label || 'the second org') + '.' };
        }
        return { source: b, target: a };
    }
    return { error: 'That org is not part of this pipeline.', code: 'SS-302' };
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/*                                                                     */
/* Metadata moves by name. Records do not: an Account in one sandbox    */
/* and "the same" Account in another have different Ids, and there is   */
/* nothing in either record that says so. Something else has to say     */
/* which row is which, and Salesforce is specific about what may.       */
/* ------------------------------------------------------------------ */

/* One call to the sObject Collections endpoint, and the reason the first
 * version stops there. allOrNone applies within a request, so across three
 * batches "all or nothing" would mean "all or nothing, three times" - which
 * is partial by another name. One batch, and it means what it says. */
var SS_SYNC_DATA_LIMIT = 200;

/*
 * Which fields may be used to match a record across two orgs.
 *
 * Asked of the org rather than listed here. Salesforce marks every field that
 * an upsert may address with idLookup, which covers External Id fields and
 * the few standard ones that qualify - so the org already knows the answer,
 * and any list kept in this file would be wrong for somebody's org on the day
 * it was written. A "Migration Id" works exactly when an admin has marked it
 * as an External Id, and this reports that rather than guessing.
 *
 * Id itself is excluded, and that exclusion is the whole point of the
 * feature: Ids are not the same in two orgs, so matching on one would either
 * miss every record or hit the wrong one.
 */
function ssSyncKeyFields(describe) {
    var fields = (describe && describe.fields) || [];
    return fields.filter(function (field) {
        return field && field.idLookup === true && field.name !== 'Id';
    }).map(function (field) {
        return {
            name: field.name,
            label: field.label || field.name,
            type: field.type || null,
            external: !!field.externalId,
            unique: !!field.unique
        };
    }).sort(function (a, b) {
        // External Ids first: they are the ones put there for this purpose.
        if (a.external !== b.external) { return a.external ? -1 : 1; }
        return a.name.localeCompare(b.name);
    });
}

/*
 * The other way to match a record, when the org has no External Id.
 *
 * Salesforce's upsert is the tidy way and it is not the only way. Any field
 * that can be filtered on can identify a record if you are willing to go and
 * look: query the target for rows whose key is one of the incoming values,
 * update the ones that come back, insert the ones that do not. That is what
 * a person does by hand, and it works on a stock Account where nothing is
 * marked as an External Id.
 *
 * It costs the atomicity of a single call and it introduces a question upsert
 * never has to ask - what if two target records share the value - so it is
 * offered as the second choice, not the first.
 *
 * Only filterable scalars: a field that cannot appear in a WHERE clause
 * cannot be looked up, and the compound types are not values in the sense
 * this needs.
 */
var SS_SYNC_MATCHABLE_TYPES = {
    string: true, textarea: false, email: true, phone: true, url: true,
    picklist: true, int: true, double: true, currency: true, percent: true,
    date: true, datetime: true, id: false, reference: false
};

function ssSyncMatchFields(describe) {
    var fields = (describe && describe.fields) || [];
    return fields.filter(function (field) {
        if (!field || !field.name || field.name === 'Id') { return false; }
        if (field.idLookup) { return false; }        // offered as an upsert key instead
        if (field.filterable === false) { return false; }
        if (field.compoundFieldName) { return false; }
        if (!SS_SYNC_MATCHABLE_TYPES[field.type]) { return false; }
        return true;
    }).map(function (field) {
        return {
            name: field.name,
            label: field.label || field.name,
            type: field.type || null,
            external: false,
            unique: !!field.unique,
            mode: 'lookup'
        };
    }).sort(function (a, b) {
        /* Unique first: a unique field cannot produce the ambiguity that
         * makes this mode refuse records. */
        if (a.unique !== b.unique) { return a.unique ? -1 : 1; }
        return a.name.localeCompare(b.name);
    });
}

/*
 * Everything that could identify a record, in the order worth trying.
 *
 * One list rather than two controls: the difference between the modes is a
 * property of the field, so the field is the choice and the mode follows from
 * it. External Ids come first because they are the safe path.
 */
/*
 * The choice that is not a field: create everything, match nothing.
 *
 * A sentinel rather than an empty value, because empty already means "you
 * have not chosen yet" and the two must not be confused - one writes
 * nothing, the other writes every record.
 */
var SS_SYNC_INSERT_ONLY = '__ss_create_all__';

function ssSyncCandidateKeys(describe) {
    return ssSyncKeyFields(describe).map(function (field) {
        return {
            name: field.name, label: field.label, type: field.type,
            external: field.external, unique: field.unique, mode: 'upsert'
        };
    }).concat(ssSyncMatchFields(describe)).concat([{
        /*
         * Offered last, and deliberately.
         *
         * It is the only choice here that cannot update anything: every
         * record is created, so a record the target already has becomes a
         * second copy of itself. That is right when the target is empty and
         * wrong almost everywhere else, which is why it sits below the
         * options that match.
         */
        name: SS_SYNC_INSERT_ONLY,
        label: 'Do not match - create every record as new',
        type: null,
        external: false,
        unique: false,
        mode: 'insert'
    }]);
}

function ssSyncKeyMode(candidates, name) {
    var found = (candidates || []).filter(function (f) { return f.name === name; })[0];
    return found ? found.mode : null;
}

/*
 * Which incoming rows already exist in the target, and which do not.
 *
 * The ambiguous case is the one that matters. If two records in the target
 * share the key value, there is no answer to "which one did you mean" - and
 * picking either is the silent wrong-record write this whole feature exists
 * to avoid. Those rows are refused by name, with the count, so the reason is
 * something a person can act on.
 */
function ssSyncMatchPlan(rows, keys, targetRecords, keyField) {
    var byValue = {};
    (targetRecords || []).forEach(function (record) {
        if (!record) { return; }
        var value = String(record[keyField]);
        (byValue[value] = byValue[value] || []).push(record.Id);
    });

    var updates = [];
    var inserts = [];
    var ambiguous = [];

    (rows || []).forEach(function (row, index) {
        var value = String((keys || [])[index]);
        var found = byValue[value] || [];

        if (found.length > 1) {
            ambiguous.push({ index: index, key: (keys || [])[index], count: found.length });
            return;
        }
        if (found.length === 1) {
            var update = {};
            Object.keys(row).forEach(function (name) { update[name] = row[name]; });
            update.Id = found[0];
            updates.push({ row: update, key: (keys || [])[index] });
            return;
        }
        inserts.push({ row: row, key: (keys || [])[index] });
    });

    return { updates: updates, inserts: inserts, ambiguous: ambiguous };
}

/*
 * The query that finds them.
 *
 * Values are quoted and escaped even though they came from the same platform:
 * an apostrophe in a company name would otherwise end the literal and change
 * the query, which is the everyday version of an injection rather than an
 * exotic one.
 */
function ssSyncMatchQuery(objectApiName, keyField, values, limit) {
    var seen = {};
    var literals = [];
    (values || []).forEach(function (value) {
        if (value === undefined || value === null || value === '') { return; }
        var text = String(value);
        if (seen[text]) { return; }
        seen[text] = true;
        literals.push("'" + text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'");
    });
    if (!literals.length) { return null; }

    return 'SELECT Id, ' + keyField + ' FROM ' + objectApiName +
        ' WHERE ' + keyField + ' IN (' + literals.join(',') + ')' +
        ' LIMIT ' + (limit || SS_SYNC_DATA_LIMIT * 2);
}

/*
 * Which fields may be carried across.
 *
 * Writable, and nothing else. In particular:
 *
 * - Reference fields are left behind. They hold Ids belonging to the source
 *   org, and an Id written into another org either points at an unrelated
 *   record or fails - the first of which is silent, which makes it the
 *   dangerous one. Relating records across orgs needs each parent matched by
 *   its own key, which is a larger thing than this.
 * - Compound fields (address, geolocation) are skipped because their parts
 *   are separate writable fields; sending both writes the same value twice
 *   and the org rejects it.
 * - Formula, autonumber and audit fields are not writable at all.
 */
/*
 * Why a field cannot be carried, or null if it can.
 *
 * One function, so that the rule which drops a field and the sentence shown
 * to explain it are the same code. They were two, in different orders, and
 * could name different causes for the same field - which is a bad property
 * for the thing whose whole job is saying why.
 */
/*
 * The field's own properties, before anything about its relatives.
 *
 * Ordered by how much the answer tells somebody, not by how cheap the test
 * is. "Calculated" and "the org generates it" both explain why a field is not
 * writable, so they are reached first; the bare "not writable" is the
 * fallback for a field with no more specific reason. A reader who is told
 * only "not writable" about a formula field has been told nothing they could
 * not see.
 */
function ssSyncFieldRefusal(field) {
    if (!field || !field.name) { return 'it has no name'; }

    if (field.calculated) {
        return 'the target org reports it as calculated, so it cannot be written there';
    }
    if (field.autoNumber) {
        return 'the target org generates it';
    }
    if (field.type === 'reference') {
        return 'it is a lookup, and lookups are not carried between orgs - they hold ' +
               'Ids belonging to the source org';
    }
    if (field.type === 'address' || field.type === 'location') {
        return 'it is a compound field, written through its parts instead';
    }
    if (!field.createable && !field.updateable) {
        return 'the target org reports it as not writable';
    }
    return null;
}

/*
 * Why a field cannot be carried, or null if it can.
 *
 * One function, so that the rule which drops a field and the sentence shown
 * to explain it are the same code. They were two, in different orders, and
 * could name different causes for the same field - a bad property for the
 * thing whose whole job is saying why.
 *
 * Compound fields are the awkward part, and getting them wrong is what
 * produced "requires Name on a new Account, and it was not sent". Salesforce
 * marks both the compound and its parts with compoundFieldName, so:
 *
 *   - A field naming itself is the compound, not a part. Account.Name comes
 *     back as compoundFieldName "Name" where Person Accounts are on, and
 *     dropping it removed the one field a new Account cannot be made without.
 *
 *   - A part is dropped only when the compound it belongs to can be written
 *     instead, because writing both is what the org refuses. Where the
 *     compound cannot be written - BillingAddress is not creatable, and
 *     Contact.Name is calculated - the parts are the only way in, and
 *     dropping those carried no address and no contact name at all.
 */
function ssSyncNotPortable(field, byName) {
    var own = ssSyncFieldRefusal(field);
    if (own) { return own; }

    if (field.compoundFieldName && field.compoundFieldName !== field.name) {
        var compound = (byName || {})[field.compoundFieldName];
        if (compound && !ssSyncFieldRefusal(compound)) {
            return 'it is part of ' + field.compoundFieldName +
                   ', which is written instead';
        }
    }
    return null;
}

function ssSyncFieldsByName(describe) {
    var byName = {};
    ((describe && describe.fields) || []).forEach(function (field) {
        if (field && field.name) { byName[field.name] = field; }
    });
    return byName;
}

function ssSyncPortableFields(describe) {
    var byName = ssSyncFieldsByName(describe);
    return ((describe && describe.fields) || []).filter(function (field) {
        return !ssSyncNotPortable(field, byName);
    }).map(function (field) { return field.name; });
}

/*
 * What the target insists on before it will create a record.
 *
 * nillable:false is the org saying "this must have a value". defaultedOnCreate
 * means it will supply one itself, and a boolean always has one, so neither is
 * ever missing. Read from the describe rather than listed here, because which
 * fields are required is a property of that object in that org - Name is
 * required on a stock Account and not on one where somebody made it optional.
 */
function ssSyncRequiredForCreate(describe) {
    var fields = (describe && describe.fields) || [];
    return fields.filter(function (field) {
        if (!field || !field.name) { return false; }
        if (!field.createable) { return false; }
        if (field.nillable !== false) { return false; }
        if (field.defaultedOnCreate) { return false; }
        if (field.type === 'boolean') { return false; }
        return true;
    }).map(function (field) { return field.name; });
}

/*
 * Why a field the target requires is not in what we are about to send.
 *
 * This exists because of a failure that read as the org's fault and was ours:
 * an insert went out without Name, and the org said "Required fields are
 * missing: [Name]" - a true statement that tells nobody which of the several
 * possible causes it was. Answered here, before anything is written, in terms
 * of the thing that actually decided it.
 */
function ssSyncMissingRequired(entries, describe, keyField) {
    var required = ssSyncRequiredForCreate(describe);
    if (!required.length || !entries || !entries.length) { return []; }

    var portable = {};
    ssSyncPortableFields(describe).forEach(function (name) { portable[name] = true; });
    portable[keyField] = true;

    var byName = ssSyncFieldsByName(describe);

    return required.filter(function (name) {
        return entries.some(function (entry) {
            var value = entry && entry.row && entry.row[name];
            return value === undefined || value === null || value === '';
        });
    }).map(function (name) {
        var field = byName[name] || {};
        /* Dropped by us, or simply absent from the records - and the first of
         * those is answered by the function that made the decision. */
        var reason = portable[name]
            ? 'the records being sent have no value in it'
            : ssSyncNotPortable(field, byName);

        return { name: name, label: field.label || name, reason: reason };
    });
}

/*
 * Why the org is complaining about a field, when we are the reason.
 *
 * "Required fields are missing: [Name]" is a true statement about the request
 * and a useless one about the cause: the request looked like that because
 * this extension did not send Name, and only this extension knows why. So the
 * org's own words are kept, and the missing half is added to them.
 *
 * Every field the message names is looked up. One we deliberately dropped
 * gets the reason we dropped it; one we did send is left alone, because then
 * the org means something else and guessing would be worse than silence.
 */
function ssSyncExplainFailure(message, describe, keyField) {
    if (!message) { return message; }

    var named = [];
    var listed = /\[([^\]]+)\]/.exec(message);
    if (listed) {
        named = listed[1].split(',').map(function (name) { return name.trim(); });
    }
    if (!named.length) { return message; }

    var portable = {};
    ssSyncPortableFields(describe).forEach(function (name) { portable[name] = true; });
    portable[keyField] = true;

    var byName = ssSyncFieldsByName(describe);

    var notes = named.filter(function (name) {
        return byName[name] && !portable[name];
    }).map(function (name) {
        /* The reason the field was dropped, from the function that dropped
         * it - not a second opinion assembled here. */
        return name + ' was not sent: ' + ssSyncNotPortable(byName[name], byName);
    });

    return notes.length ? message + ' - ' + notes.join('; ') + '.' : message;
}

/*
 * The rows to send, cut down to what may be sent.
 *
 * The key travels with them - it is what the upsert matches on - and
 * attributes, Id and anything not portable are dropped. A row with no value
 * in the key field cannot be matched at all, so it is refused here rather
 * than arriving as an org error per record.
 */
function ssSyncDataPayload(records, portable, keyField) {
    var allowed = {};
    (portable || []).forEach(function (name) { allowed[name] = true; });
    allowed[keyField] = true;

    var rows = [];
    /*
     * The key values, kept beside the rows rather than on them. A marker
     * field added to the payload would be sent to the org as a field it does
     * not have; this is only ever used to name which record a failure was.
     */
    var keys = [];

    /*
     * Rows with nothing in the key field.
     *
     * They cannot be matched - there is no value to match on - but that is
     * not a reason to leave them behind. A record that cannot be found in the
     * target is a record the target does not have, which is exactly the case
     * for creating it. So these are carried as inserts rather than discarded,
     * and the outcome says how many of them there were.
     */
    var keyless = [];

    function portableRow(record) {
        var row = {};
        Object.keys(record).forEach(function (name) {
            if (name === 'attributes' || name === 'Id') { return; }
            if (!allowed[name]) { return; }
            row[name] = record[name];
        });
        return row;
    }

    (records || []).forEach(function (record) {
        if (!record) { return; }
        var value = record[keyField];
        if (value === undefined || value === null || value === '') {
            keyless.push({ row: portableRow(record), key: null });
            return;
        }
        rows.push(portableRow(record));
        keys.push(value);
    });

    return { rows: rows, keys: keys, keyless: keyless, skipped: [] };
}

/*
 * Update and insert in one all-or-nothing write.
 *
 * Lookup matching produces two sets, and the two REST calls that carry them
 * are separate: PATCH /composite/sobjects takes rows with an Id, POST takes
 * rows without. Sent as two calls, the second failing after the first
 * succeeded leaves the target half-written - which is the thing the metadata
 * side goes out of its way to prevent with rollbackOnError.
 *
 * /composite with allOrNone rolls back every subrequest when any of them
 * fails, so the pair behaves like the single upsert does.
 */
/*
 * The batches a data job writes, in one all-or-nothing request.
 *
 * Three kinds, and a job uses at most two of them:
 *
 *   upsert  the org matches on an External Id             (upsert mode)
 *   update  rows we found in the target, addressed by Id  (lookup mode)
 *   insert  rows with no counterpart, and rows with no key at all
 *
 * Everything goes through /composite even when there is only one batch. The
 * alternative is two REST calls, and the second failing after the first
 * succeeded leaves the target half written - the thing the metadata side
 * avoids with rollbackOnError. One composite with allOrNone makes the whole
 * write behave the way a single call does.
 */
function ssSyncCompositeWrite(apiVersion, objectApiName, keyField, batches) {
    var version = apiVersion || '62.0';
    var base = '/services/data/v' + version + '/composite/sobjects';

    function shape(entry) {
        return Object.assign({ attributes: { type: objectApiName } }, entry.row);
    }

    var requests = (batches || []).filter(function (batch) {
        return batch && batch.entries && batch.entries.length;
    }).map(function (batch) {
        var url = batch.kind === 'upsert'
            ? ssSyncUpsertUrl('', version, objectApiName, keyField)
            : base;
        return {
            method: batch.kind === 'insert' ? 'POST' : 'PATCH',
            url: url,
            referenceId: batch.kind,
            body: { allOrNone: true, records: batch.entries.map(shape) }
        };
    });

    return requests.length
        ? { path: '/services/data/v' + version + '/composite',
            body: { allOrNone: true, compositeRequest: requests } }
        : null;
}

/*
 * The composite answer, flattened back to one result per record.
 *
 * The subrequests come back in the order they were sent, so the batches are
 * read in that same order and each one's keys with it - crossing them would
 * name the wrong record in a failure.
 */
function ssSyncCompositeResults(answer, batches) {
    var responses = (answer && answer.compositeResponse) || [];
    var order = (batches || []).filter(function (batch) {
        return batch && batch.entries && batch.entries.length;
    });

    var succeeded = 0;
    var created = 0;
    var failures = [];

    responses.forEach(function (response, position) {
        var batch = order[position] || { kind: null, entries: [] };
        var body = (response && response.body) || [];

        /* A subrequest rolled back because a sibling failed answers with one
         * error, not one result per record. */
        if (!Array.isArray(body)) {
            failures.push({
                index: failures.length,
                key: null,
                statusCode: (body && body.errorCode) || null,
                message: (body && body.message) || 'The org refused this batch.',
                fields: null
            });
            return;
        }

        body.forEach(function (result, index) {
            if (result && result.success) {
                succeeded += 1;
                /*
                 * An insert always creates. An upsert says so itself. An
                 * update never does - so what a job created is knowable
                 * whichever way it ran.
                 */
                if (batch.kind === 'insert' || result.created) { created += 1; }
                return;
            }
            var first = ((result && result.errors) || [])[0] || {};
            failures.push({
                index: index,
                key: (batch.entries[index] || {}).key === undefined
                    ? null : batch.entries[index].key,
                statusCode: first.statusCode || null,
                message: first.message || 'The org refused this record.',
                fields: (first.fields || []).join(', ') || null
            });
        });
    });

    return { succeeded: succeeded, created: created, failures: failures };
}

function ssSyncUpsertUrl(origin, apiVersion, objectApiName, keyField) {
    return origin + '/services/data/v' + (apiVersion || '62.0') +
        '/composite/sobjects/' + encodeURIComponent(objectApiName) +
        '/' + encodeURIComponent(keyField);
}

/*
 * A data job's own validation, before anything is queried.
 *
 * Every one of these is a refusal the org would eventually make, made here
 * instead - at the point where it can be read and corrected, rather than
 * after a query has run against one org and a write has been attempted
 * against another.
 */
function ssSyncValidateDataJob(spec) {
    if (!spec) { return 'Nothing to send.'; }
    if (!spec.objectApiName) { return 'Choose an object to sync.'; }
    if (!spec.keyField) {
        return 'Choose the field that identifies the same record in both orgs.';
    }
    /*
     * Creating everything needs no key and no key in the query - there is
     * nothing to match on because nothing is being matched.
     */
    if (spec.keyField === SS_SYNC_INSERT_ONLY) {
        return spec.query ? null : 'There is no query to choose the records.';
    }
    if (spec.keyField === 'Id') {
        return 'Id cannot be the matching key: the same record has different Ids in ' +
               'different orgs, which is the reason a key is needed at all.';
    }
    if (!spec.query) { return 'There is no query to choose the records.'; }

    /*
     * The key has to be among what the query selects, or there is nothing to
     * match on - but FIELDS(ALL) selects it without naming it, and refusing
     * that would refuse the one query that carries a whole record.
     */
    var query = String(spec.query).toUpperCase();
    var custom = /__C$/.test(String(spec.keyField).toUpperCase());

    /*
     * Which FIELDS() group actually contains this key.
     *
     * ALL always does. CUSTOM covers a __c field and STANDARD does not - so
     * accepting either of them for any key would wave through a query that
     * genuinely does not select what it is about to match on.
     */
    var selectsKey =
        /FIELDS\s*\(\s*ALL\s*\)/.test(query) ||
        (custom ? /FIELDS\s*\(\s*CUSTOM\s*\)/.test(query)
                : /FIELDS\s*\(\s*STANDARD\s*\)/.test(query));

    if (spec.keyField && !selectsKey &&
        query.indexOf(spec.keyField.toUpperCase()) === -1) {
        return 'The query has to select ' + spec.keyField +
               ' - without it there is nothing to match the records on. ' +
               'SELECT FIELDS(ALL) covers it, and carries the rest of the record too.';
    }
    return null;
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

function ssSyncRead(key, fallback) {
    return new Promise(function (settle) {
        try {
            chrome.storage.local.get(key, function (stored) {
                void chrome.runtime.lastError;
                settle((stored && stored[key]) || fallback);
            });
        } catch (e) { settle(fallback); }
    });
}

function ssSyncWrite(key, value) {
    return new Promise(function (settle) {
        try {
            var items = {};
            items[key] = value;
            chrome.storage.local.set(items, function () {
                void chrome.runtime.lastError;
                settle(true);
            });
        } catch (e) { settle(false); }
    });
}

function ssSyncJobs() {
    return ssSyncRead(SS_SYNC_JOBS_KEY, []);
}

function ssSyncSaveJobs(jobs) {
    return ssSyncWrite(SS_SYNC_JOBS_KEY, ssSyncPrune(jobs, SS_SYNC_MAX_JOBS));
}

/*
 * Read, change one job, write back. Every mutation goes through this so that
 * two of them landing at once cannot write each other's stale copy back.
 */
function ssSyncUpdateJob(id, change) {
    return ssSyncJobs().then(function (jobs) {
        var found = null;
        var next = (jobs || []).map(function (job) {
            if (job && job.id === id) {
                found = change(job) || job;
                return found;
            }
            return job;
        });
        if (!found) { return null; }
        return ssSyncSaveJobs(next).then(function () { return found; });
    });
}

/* ------------------------------------------------------------------ */
/* Credentials                                                         */
/* ------------------------------------------------------------------ */

/*
 * A session for an org that is not the one being looked at.
 *
 * The cookie is tried first and is the reason this works at all: chrome
 * .cookies can read an org's sid even when it is HttpOnly, for any org the
 * browser is signed in to, with no tab open on it. That is exactly the second
 * org in a pipeline.
 *
 * The stored OAuth token is the fallback, and only when it belongs to this
 * org - ssAuth holds one token at a time, and using it against a different
 * org is the cross-org leak the sign-in guard exists to prevent.
 */
/*
 * The org's own sid, rather than whichever sid Chrome happened to hand back.
 *
 * chrome.cookies.get breaks a tie by path length and then by creation time,
 * and pointedly not by how specific the domain is. Salesforce sets a sid on
 * login.salesforce.com as well, and a cookie on a parent domain matches every
 * host under it - so asking for org B's session could return org A's, which
 * org B then refuses as INVALID_SESSION_ID.
 *
 * That failure is indistinguishable from an expired session from the outside,
 * and it was reported as one: "sign in again" to an org the user was already
 * signed in to, which no amount of signing in could fix.
 *
 * getAll returns every match, so the cookie set on this exact host can be
 * preferred instead of hoping the tie-break lands on it. A parent-domain
 * cookie is still accepted when it is all there is - it is the right answer
 * often enough, and refusing it would break the orgs this already works for.
 */
function ssSyncPickCookie(cookies, host) {
    var wanted = String(host || '').toLowerCase();
    if (!wanted) { return null; }

    var best = null;
    (cookies || []).forEach(function (cookie) {
        if (!cookie || !cookie.value) { return; }

        var domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
        if (!domain) { return; }

        /* This host, or a parent of it. Anything else is another org's. */
        var exact = domain === wanted;
        if (!exact && wanted.slice(-(domain.length + 1)) !== '.' + domain) { return; }

        var candidate = {
            /* Specificity first: the host's own cookie is this org's session,
             * a parent's may belong to any org under that parent. */
            rank: exact ? 2 : 1,
            path: String(cookie.path || '').length,
            cookie: cookie
        };
        if (!best || candidate.rank > best.rank ||
            (candidate.rank === best.rank && candidate.path > best.path)) {
            best = candidate;
        }
    });

    return best ? best.cookie : null;
}

/*
 * Every OAuth token the browser holds, new store and old.
 *
 * ssAuthOrgs is a map keyed by the org's host; ssAuth was the single record
 * that preceded it and is still read, for a browser that has not written the
 * map yet. Which of them may be used for a given org is decided by the
 * caller, on the host - not here.
 */
function $ssSyncAllTokens() {
    return Promise.all([
        ssSyncRead('ssAuthOrgs', null),
        ssSyncRead('ssAuth', null)
    ]).then(function (both) {
        var found = [];
        var map = both[0] || {};
        Object.keys(map).forEach(function (slot) {
            if (map[slot]) { found.push(map[slot]); }
        });
        if (both[1]) { found.push(both[1]); }
        return found;
    });
}

function ssSyncCredential(origin) {
    if (!origin) { return Promise.resolve(null); }

    return new Promise(function (settle) {
        var host;
        try { host = new URL(origin).hostname.toLowerCase(); }
        catch (e) { return settle(null); }

        try {
            chrome.cookies.getAll({ url: origin, name: 'sid' }, function (cookies) {
                void chrome.runtime.lastError;
                var cookie = ssSyncPickCookie(cookies, host);
                if (cookie && cookie.value) {
                    return settle({
                        sessionId: cookie.value,
                        from: 'cookie',
                        /* Where it came from, carried so a refusal can say so.
                         * A session read off a parent domain is the one most
                         * likely to belong to a different org. */
                        cookieDomain: String(cookie.domain || '').replace(/^\./, ''),
                        exactHost: String(cookie.domain || '').replace(/^\./, '')
                                       .toLowerCase() === host
                    });
                }
                settle(null);
            });
        } catch (e) { settle(null); }
    }).then(function (fromCookie) {
        if (fromCookie) { return fromCookie; }
        /*
         * Tokens are stored per org now, so a pipeline's second org can have
         * one of its own. With a single record there was at most one token in
         * the browser and the far end of every pipeline was reduced to its
         * cookie - which is the case this fallback exists for.
         *
         * The host still has to match. That guard is the whole reason this
         * branch is safe: ssAuth held one token then and holds several now,
         * and handing any of them to the wrong org is the same leak either
         * way.
         */
        return $ssSyncAllTokens().then(function (saved) {
            var wanted;
            try { wanted = new URL(origin).hostname.toLowerCase(); }
            catch (e) { return null; }

            for (var i = 0; i < saved.length; i += 1) {
                var record = saved[i];
                if (!record || !record.accessToken || !record.instanceUrl) { continue; }
                var host;
                try { host = new URL(record.instanceUrl).hostname.toLowerCase(); }
                catch (e) { continue; }
                if (host === wanted) {
                    return { sessionId: record.accessToken, from: 'oauth' };
                }
            }
            return null;
        });
    });
}

/* ------------------------------------------------------------------ */
/* Running a job                                                       */
/* ------------------------------------------------------------------ */

/*
 * Whether a refusal is really "sign in again".
 *
 * The org has several ways of saying it and none of them read as an action:
 * INVALID_SESSION_ID from REST, "Session expired or invalid" from the same
 * call in prose, and a plain 401. All three mean the same thing and have the
 * same fix, and none of them is a broken job - which is why they end as
 * 'blocked' rather than 'failed', the same as having no session at all.
 */
/*
 * An error that carries the catalogue code for what it is.
 *
 * The code travels on the Error rather than inside the sentence, so the panel
 * can render it as a link to the page that explains it - and so a message can
 * be reworded without breaking the lookup.
 */
function ssSyncCoded(code, message) {
    var error = new Error(message);
    error.ssCode = code;
    return error;
}

function ssSyncIsSessionFailure(message, status) {
    if (status === 401 || status === 403) { return true; }
    var text = String(message || '');
    return /INVALID_SESSION_ID|Session expired or invalid|INVALID_LOGIN/i.test(text);
}

/*
 * A stored job, re-read in the light of what we now know.
 *
 * The sign-in treatment is applied when a job fails, which does nothing for
 * the jobs already in the list - they were written before, and go on showing
 * a bare "Session expired or invalid" with no action attached. It also does
 * nothing for any path that throws a session error without being tagged.
 *
 * Applying the same rule on the way out fixes both, and keeps the rule in one
 * place. The stored state is not rewritten: what happened, happened. This
 * only changes how it is presented, which is where the omission was.
 */
function ssSyncNormaliseJob(job) {
    if (!job || !job.error || job.error.needsAuth) { return job; }
    if (!ssSyncIsSessionFailure(job.error.message)) { return job; }

    var error = {};
    Object.keys(job.error).forEach(function (field) { error[field] = job.error[field]; });
    error.needsAuth = true;

    var next = {};
    Object.keys(job).forEach(function (field) { next[field] = job[field]; });
    next.error = error;
    return next;
}

function ssSyncSoapUrl(origin, apiVersion) {
    return origin + '/services/Soap/m/' + (apiVersion || '62.0');
}

/*
 * REST, through background.js's relay for the same reason SOAP goes through
 * it: the relay holds the guard that refuses to send a Salesforce session
 * anywhere but an org. The session travels as a bearer token, which is what
 * lets this address an org that is not the one any tab is on.
 */
async function ssSyncRest(origin, sid, method, path, body) {
    var answer = await restRequest({
        url: origin + path,
        method: method,
        sid: sid,
        body: body
    });
    if (!answer) { throw new Error('The org returned nothing.'); }
    if (!answer.ok) {
        var detail = null;
        try {
            var parsed = JSON.parse(answer.text || '[]');
            var first = Array.isArray(parsed) ? parsed[0] : parsed;
            detail = first && (first.message || first.error_description);
        } catch (e) { detail = null; }

        /*
         * Which org refused, carried on the error.
         *
         * A pipeline touches two, and "Session expired or invalid" names
         * neither - so without this the panel can only say that something
         * needs signing in, not what.
         */
        var failure = new Error(detail || answer.error ||
            (method + ' failed (HTTP ' + answer.status + ').'));
        failure.ssOrigin = origin;
        failure.ssStatus = answer.status;
        failure.ssNeedsAuth = ssSyncIsSessionFailure(failure.message, answer.status);
        throw failure;
    }
    if (!answer.text) { return null; }
    try {
        return JSON.parse(answer.text);
    } catch (e) {
        throw new Error('The org answered with something that is not JSON.');
    }
}

/*
 * Posts an envelope and gives back the body text, or throws with something
 * worth reading. soapRequest is background.js's, and holds the host guard
 * that keeps a session from being posted anywhere but an org.
 */
function ssSyncPost(origin, apiVersion, sessionId, body) {
    return soapRequest(ssSyncSoapUrl(origin, apiVersion), ssSyncEnvelope(sessionId, body))
        .then(function (response) {
            if (!response) { throw new Error('The org returned nothing.'); }
            if (!response.ok) {
                var fault = ssSyncSoapFault(response.text);
                var soapFailure = new Error(
                    (response.status === 401 || response.status === 403)
                        ? (fault || 'The org refused this session. Deploying needs the ' +
                            '"Modify Metadata Through Metadata API Functions" or ' +
                            '"Modify All Data" permission.')
                        : (fault || response.error ||
                            'The Metadata API request failed (HTTP ' + response.status + ').'));
                soapFailure.ssOrigin = origin;
                soapFailure.ssStatus = response.status;
                soapFailure.ssNeedsAuth = ssSyncIsSessionFailure(soapFailure.message, response.status);
                throw soapFailure;
            }
            return response.text;
        });
}

function ssSyncWait(ms) {
    return new Promise(function (settle) { setTimeout(settle, ms); });
}

/*
 * Retrieve from the source, in full, before anything is sent anywhere.
 *
 * The zip is returned rather than stored: see the note at the top of the
 * file. If the worker dies here the job runs this again, which is a wasted
 * call and not a wrong outcome.
 */
async function ssSyncRetrieve(job, credential) {
    var origin = job.source.origin;
    var version = job.apiVersion || '62.0';
    var manifest = ssSyncPackageXml(job.components, version);
    if (!manifest) {
        throw new Error('This job names no components to move.');
    }

    await ssSyncProgress(job.id, { stage: 'retrieve', note: 'Retrieving from ' +
        ((job.source && job.source.label) || 'the source org') + '.',
        total: (job.components || []).length });

    var started = await ssSyncPost(origin, version, credential.sessionId,
        ssSyncRetrieveBody(manifest, version));
    var id = ssSyncAsyncId(started);
    if (!id) {
        throw new Error(ssSyncSoapFault(started) || 'The org did not start the retrieve.');
    }

    var waited = 0;
    var delay = 2000;
    while (waited < SS_SYNC_DEPLOY_LIMIT_MS) {
        await ssSyncWait(delay);
        waited += delay;
        var text = await ssSyncPost(origin, version, credential.sessionId,
            ssSyncCheckRetrieveBody(id));
        var status = ssSyncRetrieveStatus(text);
        if (status.done) {
            if (!status.zipFile) {
                throw new Error(status.error || 'The retrieve returned no package.');
            }
            return status.zipFile;
        }
        delay = Math.min(Math.round(delay * 1.5), 15000);
    }
    throw new Error('The retrieve did not finish in time.');
}

/*
 * Start the deploy and record its id before polling.
 *
 * The order matters and is the reason this is written out rather than folded
 * into the poll: once the org has an async id, that deploy is happening. If
 * the id is not written down before the first poll, a worker killed during
 * that poll loses track of a deploy that is still running, and the job says
 * failed while the target org says otherwise.
 */
async function ssSyncStartDeploy(job, credential, zipBase64) {
    var version = job.apiVersion || '62.0';
    var started = await ssSyncPost(job.target.origin, version, credential.sessionId,
        ssSyncDeployBody(zipBase64, { checkOnly: job.checkOnly, testLevel: job.testLevel }));
    var id = ssSyncAsyncId(started);
    if (!id) {
        throw new Error(ssSyncSoapFault(started) || 'The org did not start the deploy.');
    }
    await ssSyncUpdateJob(job.id, function (current) {
        return ssSyncTransition(current, 'running', 'Deploy ' + id + ' started.', {
            stage: 'deploy',
            async: { stage: 'deploy', id: id, startedAt: Date.now() }
        });
    });
    return id;
}

/*
 * Start a quick deploy, and record its id the same way an ordinary deploy
 * records one.
 *
 * The refusal worth translating is the org saying the validation cannot be
 * used: that happens when it has expired, or when it ran no tests and the
 * target requires them. Both are actionable, and neither is obvious from
 * Salesforce's own wording.
 */
async function ssSyncStartQuickDeploy(job, credential) {
    var version = job.apiVersion || '62.0';
    var started;
    try {
        started = await ssSyncPost(job.target.origin, version, credential.sessionId,
            ssSyncQuickDeployBody(job.validationId));
    } catch (error) {
        var said = (error && error.message) || String(error);
        if (/INVALID_ID_FIELD|not eligible|expired|INVALID_CROSS_REFERENCE/i.test(said)) {
            throw new Error('The org will not deploy that validation: ' + said +
                ' A validation is only good for ten days, and one that ran no tests ' +
                'cannot stand in for a deploy where tests are required. Validate again.');
        }
        throw error;
    }

    var id = ssSyncAsyncId(started);
    if (!id) {
        throw new Error(ssSyncSoapFault(started) || 'The org did not start the deploy.');
    }
    await ssSyncUpdateJob(job.id, function (current) {
        return ssSyncTransition(current, 'running', 'Quick deploy ' + id + ' started.', {
            stage: 'deploy',
            async: { stage: 'deploy', id: id, startedAt: Date.now() }
        });
    });
    return id;
}

/*
 * Poll a deploy that is already running. Separate from starting it so that
 * the alarm can call this on its own after the worker has been killed - that
 * is the whole reason the async id is on the job record.
 */
async function ssSyncPollDeploy(job, credential, asyncId) {
    var version = job.apiVersion || '62.0';
    var delay = 3000;
    var startedAt = (job.async && job.async.startedAt) || Date.now();

    while (Date.now() - startedAt < SS_SYNC_DEPLOY_LIMIT_MS) {
        var text = await ssSyncPost(job.target.origin, version, credential.sessionId,
            ssSyncCheckDeployBody(asyncId));
        var status = ssSyncDeployStatus(text);
        if (status.done) { return status; }

        /*
         * Written onto the job so somebody watching can see it.
         *
         * The panel cannot be told directly - the run happens here and the
         * call it is waiting on does not come back until the end - but it
         * already reads the job list, so the record is the channel. It also
         * means the progress survives this worker being killed: the alarm
         * resumes the poll and carries on writing to the same place.
         */
        await ssSyncProgress(job.id, {
            stage: 'deploy',
            done: status.counts.deployed,
            total: status.counts.total,
            status: status.status,
            recent: status.recent
        });

        await ssSyncWait(delay);
        delay = Math.min(Math.round(delay * 1.5), 20000);
    }
    throw new Error('The deploy is still running in the org after an hour. ' +
                    'It has not failed - check Deployment Status in Setup.');
}

/*
 * A data job, start to finish.
 *
 * Three things happen in a deliberate order:
 *
 * 1. The target org is described. The target, not the source - the fields
 *    that matter are the ones that can be written where the records are
 *    going, and the two orgs are not guaranteed to have the same ones.
 * 2. The source is queried, capped. The cap is enforced here and not left to
 *    the query: a LIMIT somebody edited out would otherwise turn one batch
 *    into a partial multi-batch write.
 * 3. One upsert, allOrNone. Either every row lands or none does.
 */
async function ssSyncRunData(job, sourceCred, targetCred) {
    var version = job.apiVersion || '62.0';

    var describe = await ssSyncRest(job.target.origin, targetCred.sessionId, 'GET',
        '/services/data/v' + version + '/sobjects/' + encodeURIComponent(job.objectApiName) +
        '/describe');

    var candidates = ssSyncCandidateKeys(describe);
    var mode = ssSyncKeyMode(candidates, job.keyField);
    if (!mode) {
        throw new Error(job.keyField + ' cannot be used to match records in ' +
            (job.target.label || 'the target org') + ' - it is not a field there, ' +
            'or it cannot be filtered on.');
    }

    await ssSyncProgress(job.id, { stage: 'query', note: 'Reading records from ' +
        ((job.source && job.source.label) || 'the source org') + '.' });

    var answer = await ssSyncRest(job.source.origin, sourceCred.sessionId, 'GET',
        '/services/data/v' + version + '/query?q=' + encodeURIComponent(job.query));
    var records = (answer && answer.records) || [];

    if (!records.length) {
        throw ssSyncCoded('SS-402', 'That query returned no records in ' +
            (job.source.label || 'the source org') + ', so there is nothing to send.');
    }
    if (records.length > SS_SYNC_DATA_LIMIT) {
        throw ssSyncCoded('SS-403', 'That query returned ' + records.length + ' records. One job ' +
            'carries at most ' + SS_SYNC_DATA_LIMIT + ', because that is the largest ' +
            'number the org will accept as a single all-or-nothing write. Narrow the ' +
            'query and send it in more than one job.');
    }

    /*
     * Insert-only carries no key, so every row lands in the keyless half and
     * becomes a create. Passing null rather than the sentinel says that
     * outright instead of relying on no record happening to have a field
     * named after it.
     */
    var payload = ssSyncDataPayload(records, ssSyncPortableFields(describe),
        mode === 'insert' ? null : job.keyField);
    if (!payload.rows.length && !payload.keyless.length) {
        throw new Error('There is nothing to write.');
    }

    var batches = [];
    var matched = 0;

    if (mode === 'insert') {
        /* Nothing is looked up and nothing is updated: the target is not
         * asked what it already has. */
        batches.push({ kind: 'insert', entries: payload.keyless });
    } else if (mode === 'upsert') {
        /*
         * The org matches the keyed rows itself. The keyless ones it cannot -
         * an upsert addresses a record through the key, and there is no key -
         * so they go in the same request as plain inserts.
         */
        batches.push({ kind: 'upsert', entries: payload.rows.map(function (row, index) {
            return { row: row, key: payload.keys[index] };
        }) });
        batches.push({ kind: 'insert', entries: payload.keyless });
    } else {
        var lookup = ssSyncMatchQuery(job.objectApiName, job.keyField, payload.keys);
        var existing = lookup
            ? await ssSyncRest(job.target.origin, targetCred.sessionId, 'GET',
                '/services/data/v' + version + '/query?q=' + encodeURIComponent(lookup))
            : { records: [] };

        var plan = ssSyncMatchPlan(payload.rows, payload.keys,
            (existing && existing.records) || [], job.keyField);

        /*
         * Ambiguity stops the job rather than skipping the rows.
         *
         * Every other refusal here is per record, but this one says the key
         * does not identify records in the target - which makes every match
         * on it a guess, not only the ones that happened to collide.
         */
        if (plan.ambiguous.length) {
            var first = plan.ambiguous[0];
            throw new Error(job.keyField + ' does not identify records in ' +
                (job.target.label || 'the target org') + ': "' + first.key + '" matches ' +
                first.count + ' records there' +
                (plan.ambiguous.length > 1 ? ', and ' + (plan.ambiguous.length - 1) +
                    ' other value' + (plan.ambiguous.length === 2 ? '' : 's') + ' do too' : '') +
                '. Nothing was written. Choose a key whose values are unique, or make that ' +
                'field unique in the target org.');
        }

        matched = plan.updates.length;
        batches.push({ kind: 'update', entries: plan.updates });
        /* Not found, plus never matchable: both are records the target does
         * not have, which is the definition of something to create. */
        batches.push({ kind: 'insert', entries: plan.inserts.concat(payload.keyless) });
    }

    /*
     * Checked before anything is sent, and only against the rows that will be
     * created - an update does not have to carry a required field, because
     * the record it is updating already has one.
     *
     * The org would refuse these anyway. The difference is that it refuses
     * with "Required fields are missing: [Name]", which is true of the
     * request and says nothing about why the request looked like that.
     */
    var inserting = (batches.filter(function (batch) {
        return batch.kind === 'insert';
    })[0] || {}).entries || [];

    var missing = ssSyncMissingRequired(inserting, describe,
        mode === 'insert' ? null : job.keyField);
    if (missing.length) {
        throw new Error(
            (job.target.label || 'The target org') + ' requires ' +
            missing.map(function (field) { return field.name; }).join(', ') +
            ' on a new ' + job.objectApiName + ', and ' +
            (missing.length === 1 ? 'it was not sent because ' : 'they were not sent because ') +
            missing.map(function (field) { return field.name + ': ' + field.reason; }).join('; ') +
            '. Nothing was written.');
    }

    /*
     * A record write is one request, so there is no "3 of 5" to report - what
     * there is, is what is about to happen, which is the part worth showing
     * before it does.
     */
    await ssSyncProgress(job.id, {
        stage: 'write',
        done: 0,
        total: batches.reduce(function (all, batch) { return all + batch.entries.length; }, 0),
        note: 'Writing to ' + ((job.target && job.target.label) || 'the target org') + '.',
        recent: batches.filter(function (batch) { return batch.entries.length; })
            .map(function (batch) {
                return batch.entries.length + ' to ' +
                    (batch.kind === 'insert' ? 'create'
                        : batch.kind === 'upsert' ? 'match or create' : 'update');
            })
    });

    var write = ssSyncCompositeWrite(version, job.objectApiName, job.keyField, batches);
    if (!write) { throw new Error('There is nothing to write.'); }

    var answer = await ssSyncRest(job.target.origin, targetCred.sessionId, 'POST',
        write.path, write.body);

    var outcome = ssSyncCompositeResults(answer, batches);

    /*
     * The org's message, plus the half only this side knows. Done here rather
     * than in ssSyncCompositeResults because this is where the describe is -
     * and the describe is what turns "Required fields are missing: [Name]"
     * into something somebody can act on.
     */
    outcome.failures.forEach(function (failure) {
        failure.message = ssSyncExplainFailure(failure.message, describe,
            mode === 'insert' ? null : job.keyField);
    });

    return {
        outcome: outcome,
        payload: payload,
        sent: payload.rows.length + payload.keyless.length,
        mode: mode,
        keyless: payload.keyless.length,
        created: outcome.created,
        matched: mode === 'upsert' ? (outcome.succeeded - outcome.created) : matched
    };
}

/*
 * Where a running job has got to.
 *
 * Kept apart from the history: history is what happened, and this is what is
 * happening - it is overwritten on every poll and means nothing once the job
 * has stopped. Cleared when it does, so a finished job never shows a stale
 * "deploying 3 of 5" under its outcome.
 */
function ssSyncProgress(jobId, progress) {
    return ssSyncUpdateJob(jobId, function (current) {
        var next = {};
        Object.keys(current).forEach(function (field) { next[field] = current[field]; });
        next.progress = progress;
        next.updatedAt = Date.now();
        return next;
    });
}

/*
 * The whole of one job.
 *
 * Credentials are resolved for both orgs before anything is retrieved. Doing
 * the retrieve first and discovering the target is not signed in afterwards
 * spends minutes of the org's time to arrive at a question that could have
 * been asked at the start.
 */
async function ssSyncRun(jobId) {
    var jobs = await ssSyncJobs();
    var job = (jobs || []).filter(function (entry) { return entry && entry.id === jobId; })[0];
    if (!job) { return { ok: false, error: 'That job is gone.' }; }
    if (job.state === 'running' && job.async && job.async.id) {
        // Already in flight; the sweep owns it from here.
        return { ok: true, state: 'running' };
    }

    var sourceCred = await ssSyncCredential(job.source && job.source.origin);
    var targetCred = await ssSyncCredential(job.target && job.target.origin);

    if (!sourceCred || !targetCred) {
        var which = !sourceCred ? (job.source && job.source.label) : (job.target && job.target.label);
        var blocked = await ssSyncUpdateJob(jobId, function (current) {
            return ssSyncTransition(current, 'blocked',
                'No session for ' + (which || 'one of the orgs') + '.', {
                    error: {
                        message: 'Not signed in to ' + (which || 'one of the orgs') + '.',
                        needsAuth: true,
                        origin: !sourceCred
                            ? (job.source && job.source.origin)
                            : (job.target && job.target.origin)
                    }
                });
        });
        return { ok: false, state: 'blocked', job: blocked };
    }

    await ssSyncUpdateJob(jobId, function (current) {
        return ssSyncTransition(current, 'running',
            job.kind === 'data'
                ? 'Reading records from ' + ((job.source && job.source.label) || 'the source org') + '.'
                : 'Retrieving from ' + ((job.source && job.source.label) || 'the source org') + '.', {
                stage: job.kind === 'data' ? 'query' : 'retrieve',
                async: null,
                attempts: (current.attempts || 0) + 1,
                error: null
            });
    });

    /*
     * One more use of this pipeline. Counted at the point the job starts
     * rather than when it finishes, because a run that fails is still a run -
     * and it is counted on the pipeline rather than derived from the job
     * list, which gets pruned and cleared.
     */
    await ssSyncRecordUse(job.pipelineId, 'run');

    /*
     * Armed here, immediately after the job becomes running and before the
     * first call that can outlive this worker. Arming it any earlier finds
     * nothing running and clears itself; any later and the worker may already
     * be dead, leaving a deploy nothing will ever come back to.
     */
    await ssSyncArmAlarm();

    try {
        /*
         * A data job is over in one exchange - query, then upsert - so there
         * is no async id, nothing for the sweep to resume, and no alarm to
         * outlive. It finishes here or it fails here.
         */
        if (job.kind === 'data') {
            var done = await ssSyncRunData(job, sourceCred, targetCred);
            return await ssSyncFinishData(jobId, done);
        }

        /*
         * A quick deploy has nothing to fetch. The package was verified by
         * the validation this job points at and is still held by the target
         * org, so the source org is not touched at all - which is the point,
         * and also why this branch skips the retrieve rather than doing it
         * and throwing the zip away.
         */
        var deployId = job.validationId
            ? await ssSyncStartQuickDeploy(job, targetCred)
            : await ssSyncStartDeploy(job, targetCred, await ssSyncRetrieve(job, sourceCred));
        var fresh = await ssSyncJobs().then(function (all) {
            return all.filter(function (entry) { return entry && entry.id === jobId; })[0];
        });
        var status = await ssSyncPollDeploy(fresh || job, targetCred, deployId);
        return await ssSyncFinish(jobId, status);
    } catch (error) {
        var said = (error && error.message) || String(error);

        /*
         * A session that expired mid-job is not a broken job.
         *
         * Nothing about it was wrong and the fix is signing in, not changing
         * anything - which is exactly what 'blocked' means here, and what a
         * job with no session at all already gets. Reporting it as failed
         * puts it on the list people scan for real problems.
         */
        if (error && error.ssNeedsAuth) {
            var which = [job.source, job.target].filter(function (end) {
                return end && end.origin === error.ssOrigin;
            })[0] || {};

            /*
             * Which credential the org refused, when it was not that org's own.
             *
             * A sid read off a parent domain - login.salesforce.com sets one -
             * is a valid session for some org, just not necessarily this one,
             * and the org refuses it exactly as it would refuse an expired
             * one. Told only to sign in again, somebody already signed in has
             * nothing to act on. Saying where the session came from is the
             * difference between a dead end and a fixable problem.
             */
            var borrowed = null;
            if (error.ssOrigin) {
                var refused = error.ssOrigin === (job.source && job.source.origin)
                    ? sourceCred : targetCred;
                if (refused && refused.from === 'cookie' && refused.exactHost === false) {
                    borrowed = refused.cookieDomain;
                }
            }

            var advice = borrowed
                ? 'The session used for ' + (which.label || 'that org') + ' came from ' +
                  borrowed + ', not from that org itself, and the org refused it. ' +
                  'Open that org in a tab once so the browser holds its own session, then retry.'
                : 'The session for ' + (which.label || 'one of the orgs') +
                  ' expired or was refused. Sign in to it again and retry.';

            var stuck = await ssSyncUpdateJob(jobId, function (current) {
                return ssSyncTransition(current, 'blocked',
                    'The session for ' + (which.label || 'one of the orgs') + ' expired.', {
                        error: {
                            message: advice,
                            code: borrowed ? 'SS-203' : 'SS-202',
                            needsAuth: true,
                            origin: error.ssOrigin || which.origin || null,
                            label: which.label || null
                        }
                    });
            });
            return { ok: false, state: 'blocked', job: stuck };
        }

        var failed = await ssSyncUpdateJob(jobId, function (current) {
            return ssSyncTransition(current, 'failed', said, {
                /* The code the throw carried, when it carried one. Kept on the
                 * job so the row can link to what it means long after the
                 * throw is gone. */
                error: { message: said, code: (error && error.ssCode) || null }
            });
        });
        return { ok: false, state: 'failed', job: failed };
    }
}

/*
 * What the org said, written down as the outcome.
 *
 * A deploy that finished unsuccessfully is a failure with reasons, not an
 * error: nothing went wrong with the request, the org simply refused the
 * contents, and the component failures are the useful part.
 */
async function ssSyncFinish(jobId, status) {
    if (status.success) {
        var ok = await ssSyncUpdateJob(jobId, function (current) {
            return ssSyncTransition(current, 'succeeded',
                current.checkOnly
                    ? 'Validated against the target org.'
                    : 'Deployed to the target org.', {
                    stage: null,
                    async: null,
                    error: null,
                    progress: null,
                    result: {
                        checkOnly: !!current.checkOnly,
                        deployed: status.counts.deployed,
                        total: status.counts.total,
                        status: status.status,
                        testLevel: current.testLevel || null,
                        /*
                         * The org's id for this deploy, kept rather than
                         * cleared with the rest of the in-flight state.
                         *
                         * For a validation it is the whole of what quick
                         * deploy needs: the package is already verified and
                         * sitting in the org, and this is the only handle on
                         * it. Discarding it - which this did - throws away
                         * the twenty minutes it took to produce.
                         */
                        deployId: (current.async && current.async.id) || null
                    }
                });
        });
        await ssSyncRecordUse(ok && ok.pipelineId, 'succeeded');
        return { ok: true, state: 'succeeded', job: ok };
    }

    var bad = await ssSyncUpdateJob(jobId, function (current) {
        return ssSyncTransition(current, 'failed', ssSyncFailureSummary(status), {
            stage: null,
            async: null,
            progress: null,
            error: {
                message: ssSyncFailureSummary(status),
                status: status.status,
                failures: status.failures || []
            },
            result: {
                deployed: status.counts.deployed,
                total: status.counts.total,
                errors: status.counts.errors
            }
        });
    });
    await ssSyncRecordUse(bad && bad.pipelineId, 'failed');
    return { ok: false, state: 'failed', job: bad };
}

/*
 * A data job's outcome.
 *
 * allOrNone means the two cases are clean: every row landed, or none did. A
 * partial count here would be a contradiction, so the failure path reports
 * what the org objected to and states plainly that nothing was written.
 */
async function ssSyncFinishData(jobId, done) {
    var outcome = done.outcome;

    if (!outcome.failures.length) {
        /* Lookup matching knows which rows it updated and which it created,
         * and that is worth saying: "12 records written" hides the fact that
         * eleven of them are new rows in an org somebody thought they were
         * updating. */
        /*
         * Said the same way whichever mode ran, because the reader's question
         * is the same: how much of this was new. A record with no counterpart
         * in the target is created rather than skipped, and creating is the
         * half worth being explicit about.
         */
        var note = 'Updated ' + done.matched + ' and created ' + done.created +
            ' record' + ((done.matched + done.created) === 1 ? '' : 's') + '.';

        var ok = await ssSyncUpdateJob(jobId, function (current) {
            return ssSyncTransition(current, 'succeeded', note, {
                    stage: null,
                    async: null,
                    progress: null,
                    result: {
                        kind: 'data',
                        mode: done.mode,
                        upserted: outcome.succeeded,
                        matched: done.matched === undefined ? null : done.matched,
                        created: done.created === undefined ? null : done.created,
                        sent: done.sent,
                        keyless: done.keyless
                    }
                });
        });
        await ssSyncRecordUse(ok && ok.pipelineId, 'succeeded');
        return { ok: true, state: 'succeeded', job: ok };
    }

    var first = outcome.failures[0];
    var summary = (first.key ? first.key + ': ' : '') + first.message +
        (outcome.failures.length > 1 ? ' - and ' + (outcome.failures.length - 1) + ' more' : '');

    var bad = await ssSyncUpdateJob(jobId, function (current) {
        return ssSyncTransition(current, 'failed', summary, {
            stage: null,
            async: null,
            error: {
                message: summary,
                /*
                 * Said explicitly. "Failed" after a write is the moment
                 * somebody wonders whether half of it went in, and with
                 * allOrNone the answer is no - which is worth stating rather
                 * than leaving them to check the other org.
                 */
                detail: 'Nothing was written: the whole batch is rejected together.',
                records: outcome.failures
            },
            result: { kind: 'data', upserted: 0, sent: done.sent }
        });
    });
    await ssSyncRecordUse(bad && bad.pipelineId, 'failed');
    return { ok: false, state: 'failed', job: bad };
}

/* ------------------------------------------------------------------ */
/* The alarm                                                           */
/* ------------------------------------------------------------------ */

/*
 * Which running jobs the sweep can do something about.
 *
 * A job with an async id is resumable however long ago the worker died. One
 * without an id, past the stall window, was interrupted before the org was
 * ever asked - nothing is running anywhere, and leaving it as 'running'
 * forever is a lie the list would keep telling.
 */
function ssSyncSweepPlan(jobs, now) {
    var at = now || Date.now();
    var resume = [];
    var stalled = [];

    (jobs || []).forEach(function (job) {
        if (!job || job.state !== 'running') { return; }
        if (job.async && job.async.id) { resume.push(job); return; }
        if (at - (job.updatedAt || 0) > SS_SYNC_STALL_MS) { stalled.push(job); }
    });

    return { resume: resume, stalled: stalled };
}

async function ssSyncSweep() {
    var jobs = await ssSyncJobs();
    var plan = ssSyncSweepPlan(jobs, Date.now());

    for (const job of plan.stalled) {
        await ssSyncUpdateJob(job.id, function (current) {
            return ssSyncTransition(current, 'failed',
                'Interrupted before the org was asked.', {
                    stage: null,
                    async: null,
                    error: {
                        message: 'The browser stopped this job before it reached the org. ' +
                                 'Nothing was deployed - retry it.'
                    }
                });
        });
    }

    for (const job of plan.resume) {
        try {
            const credential = await ssSyncCredential(job.target && job.target.origin);
            if (!credential) {
                await ssSyncUpdateJob(job.id, function (current) {
                    return ssSyncTransition(current, 'blocked',
                        'No session for ' + ((job.target && job.target.label) || 'the target org') + '.', {
                            error: {
                                message: 'Not signed in to ' +
                                         ((job.target && job.target.label) || 'the target org') +
                                         '. The deploy may still be running in the org.',
                                needsAuth: true,
                                origin: job.target && job.target.origin
                            }
                        });
                });
                continue;
            }
            const status = await ssSyncPollDeploy(job, credential, job.async.id);
            await ssSyncFinish(job.id, status);
        } catch (error) {
            await ssSyncUpdateJob(job.id, function (current) {
                return ssSyncTransition(current, 'failed',
                    (error && error.message) || String(error), {
                        error: { message: (error && error.message) || String(error) }
                    });
            });
        }
    }

    await ssSyncArmAlarm();
}

/*
 * The alarm runs only while there is something to watch.
 *
 * A periodic alarm that fires forever wakes the worker every minute for the
 * whole life of the browser to look at an empty list, which costs the user
 * battery to learn nothing. It is created when a job starts running and
 * cleared when none are.
 */
async function ssSyncArmAlarm() {
    var jobs = await ssSyncJobs();
    var running = (jobs || []).some(function (job) { return job && job.state === 'running'; });
    try {
        if (running) {
            chrome.alarms.create(SS_SYNC_ALARM, { periodInMinutes: 1 });
        } else {
            chrome.alarms.clear(SS_SYNC_ALARM, function () { void chrome.runtime.lastError; });
        }
    } catch (e) {
        // No alarms: jobs still run, they just do not resume after the worker
        // is killed until something else opens the panel.
    }
    return running;
}

/* Node's test harness lifts these out of the file; the worker uses them
 * directly. Neither needs an export in a classic service worker. */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ssSyncPackageXml: ssSyncPackageXml,
        ssSyncUnpackaged: ssSyncUnpackaged,
        ssSyncDeployBody: ssSyncDeployBody,
        ssSyncRetrieveStatus: ssSyncRetrieveStatus,
        ssSyncDeployStatus: ssSyncDeployStatus,
        ssSyncFailureSummary: ssSyncFailureSummary,
        ssSyncNewJob: ssSyncNewJob,
        ssSyncTransition: ssSyncTransition,
        ssSyncRetryable: ssSyncRetryable,
        ssSyncApplyable: ssSyncApplyable,
        ssSyncPrune: ssSyncPrune,
        ssSyncCounts: ssSyncCounts,
        ssSyncForgettable: ssSyncForgettable,
        ssSyncInGroup: ssSyncInGroup,
        ssSyncClear: ssSyncClear,
        ssSyncKeyFields: ssSyncKeyFields,
        ssSyncIsSessionFailure: ssSyncIsSessionFailure,
        ssSyncNormaliseJob: ssSyncNormaliseJob,
        ssSyncNotPortable: ssSyncNotPortable,
        ssSyncPortableFields: ssSyncPortableFields,
        ssSyncRequiredForCreate: ssSyncRequiredForCreate,
        ssSyncMissingRequired: ssSyncMissingRequired,
        ssSyncExplainFailure: ssSyncExplainFailure,
        ssSyncDataPayload: ssSyncDataPayload,
        ssSyncUpsertUrl: ssSyncUpsertUrl,
        ssSyncValidateDataJob: ssSyncValidateDataJob,
        ssSyncMatchFields: ssSyncMatchFields,
        ssSyncCandidateKeys: ssSyncCandidateKeys,
        ssSyncKeyMode: ssSyncKeyMode,
        SS_SYNC_INSERT_ONLY: SS_SYNC_INSERT_ONLY,
        ssSyncMatchPlan: ssSyncMatchPlan,
        ssSyncMatchQuery: ssSyncMatchQuery,
        ssSyncCompositeWrite: ssSyncCompositeWrite,
        ssSyncCompositeResults: ssSyncCompositeResults,
        SS_SYNC_DATA_LIMIT: SS_SYNC_DATA_LIMIT,
        ssSyncCountUse: ssSyncCountUse,
        ssSyncValidatePipeline: ssSyncValidatePipeline,
        ssSyncSender: ssSyncSender,
        ssSyncRoute: ssSyncRoute,
        ssSyncTestLevel: ssSyncTestLevel,
        ssSyncQuickDeployBody: ssSyncQuickDeployBody,
        ssSyncQuickDeployable: ssSyncQuickDeployable,
        ssSyncQuickDeployBlocker: ssSyncQuickDeployBlocker,
        ssSyncValidationDaysLeft: ssSyncValidationDaysLeft,
        SS_SYNC_VALIDATION_TTL_MS: SS_SYNC_VALIDATION_TTL_MS,
        ssSyncProgress: ssSyncProgress,
        /*
         * Exported so the handoff from a validation to a quick deploy can be
         * driven end to end: the finisher is what writes the org's deploy id
         * onto the job, and the button that follows exists only if it did.
         */
        ssSyncFinish: ssSyncFinish,
        ssSyncJobs: ssSyncJobs,
        ssSyncSweepPlan: ssSyncSweepPlan,
        ssSyncAsyncId: ssSyncAsyncId,
        /*
         * Exported so the test can drive it against a fake chrome. It decides
         * which session is used against which org, and a text search of this
         * file cannot tell a correct answer from a cross-org one.
         */
        ssSyncCredential: ssSyncCredential,
        ssSyncPickCookie: ssSyncPickCookie
    };
}
