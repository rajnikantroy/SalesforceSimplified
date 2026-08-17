/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * PipelineService - the panel's side of the sync engine.
 *
 * Deliberately thin. Every decision about what a job is, whether it may run,
 * and what the org said lives in js/sync-engine.js inside the service worker,
 * because that is the only place that can hold two orgs' credentials at once.
 * This asks it questions and turns the answers into something the templates
 * can bind to.
 *
 * Nothing here writes to an org. The furthest it goes is asking the worker to
 * stage a job, which produces a record waiting for someone to press Apply.
 */
(function() {
'use strict';
var app = window.app || angular.module("SalesforceSimplifiedApp");

app.service('PipelineService', ['$q', '$timeout', function($q, $timeout) {

    /* Long enough for the worker to wake, short enough that a wedged worker
     * is reported rather than waited on forever. Applying a job is exempt:
     * that call does not come back until the org's deploy has finished. */
    var ASK_TIMEOUT_MS = 20000;
    var APPLY_TIMEOUT_MS = 65 * 60 * 1000;

    /*
     * How many times a message is worth sending before it is an error.
     *
     * Chrome stops the worker after about thirty seconds idle and starts it
     * again on the next message; a message that arrives mid-start is closed
     * before it is answered. That is the commonest failure on this page and
     * it is not a failure of anything the user did - reporting it on a page
     * with no pipelines configured yet is pure noise, and "press it again"
     * has always been the fix. So it presses it again.
     */
    var WAKE_ATTEMPTS = 2;
    var WAKE_PAUSE_MS = 250;

    function ask(message, timeoutMs, attempt) {
        var deferred = $q.defer();
        var settled = false;
        var tries = attempt || 1;

        /*
         * A transport failure is the worker being asleep until it has been
         * given a second chance to prove otherwise. Anything the worker
         * itself said is an answer, not a transport failure, and is never
         * retried - re-sending a message the worker already acted on is how
         * one deploy becomes two.
         */
        function fail(text, code) {
            if (settled) { return; }

            if (code === 'SS-101' && tries < WAKE_ATTEMPTS) {
                settled = true;
                return $timeout(function() {
                    ask(message, timeoutMs, tries + 1).then(function(answer) {
                        deferred.resolve(answer);
                    }, function(problem) {
                        deferred.reject(problem);
                    });
                }, WAKE_PAUSE_MS);
            }

            settled = true;
            deferred.reject({ message: text, code: code || null });
        }

        var timer = $timeout(function() {
            fail('The extension\'s background worker did not answer. Reloading the ' +
                 'page usually fixes this.', 'SS-101');
        }, timeoutMs || ASK_TIMEOUT_MS);

        try {
            chrome.runtime.sendMessage(message, function(response) {
                $timeout.cancel(timer);
                if (settled) { return; }

                var lost = chrome.runtime.lastError;
                if (lost) {
                    return fail('The extension could not reach its own background worker (' +
                                lost.message + ').', 'SS-101');
                }
                if (!response) {
                    return fail('The background worker returned nothing.', 'SS-101');
                }
                settled = true;
                deferred.resolve(response);
            });
        } catch (e) {
            $timeout.cancel(timer);
            fail('Sync is only available inside the extension.', 'SS-103');
        }

        return deferred.promise;
    }

    /* ------------------------------------------------------------------ */
    /* Reading                                                             */
    /* ------------------------------------------------------------------ */

    /*
     * fromOrigin is the org the user is in, and the answer is shaped around
     * it: each pipeline comes back knowing whether this org is its source,
     * its target, or no part of it at all.
     */
    /*
     * Every org this browser remembers, and whether each is still signed in.
     *
     * Deliberately separate from state(): the pipelines are about two orgs
     * you chose, this is about every org you have ever used - including the
     * ones no pipeline mentions, which are exactly the ones whose session
     * goes quietly and is noticed only when something fails.
     */
    this.orgs = function() {
        return ask({ type: 'SS_ORG_SESSIONS' });
    };

    this.state = function(fromOrigin) {
        return ask({ type: 'SS_SYNC_STATE', fromOrigin: fromOrigin || null });
    };

    /* ------------------------------------------------------------------ */
    /* Pipelines                                                           */
    /* ------------------------------------------------------------------ */

    this.savePipeline = function(pipeline) {
        return ask({ type: 'SS_SYNC_SAVE_PIPELINE', pipeline: pipeline });
    };

    this.deletePipeline = function(id) {
        return ask({ type: 'SS_SYNC_DELETE_PIPELINE', id: id });
    };

    /* ------------------------------------------------------------------ */
    /* Jobs                                                                */
    /* ------------------------------------------------------------------ */

    /*
     * Stage, never run. The second argument is the org the components came
     * from, which is what decides the direction: a pipeline knows its two
     * ends but not which of them you are standing in.
     */
    this.stage = function(spec) {
        return ask({
            type: 'SS_SYNC_STAGE',
            pipelineId: spec.pipelineId,
            fromOrigin: spec.fromOrigin,
            components: spec.components,
            apiVersion: spec.apiVersion,
            checkOnly: !!spec.checkOnly
        });
    };

    /*
     * The fields the target org will match records on. Asked per object,
     * because it is a property of that object in that org - not something
     * this extension can know in advance.
     */
    this.keyChoices = function(spec) {
        return ask({
            type: 'SS_SYNC_KEY_CHOICES',
            pipelineId: spec.pipelineId,
            fromOrigin: spec.fromOrigin,
            objectApiName: spec.objectApiName,
            apiVersion: spec.apiVersion
        });
    };

    this.stageData = function(spec) {
        return ask({
            type: 'SS_SYNC_STAGE_DATA',
            pipelineId: spec.pipelineId,
            fromOrigin: spec.fromOrigin,
            objectApiName: spec.objectApiName,
            keyField: spec.keyField,
            query: spec.query,
            apiVersion: spec.apiVersion
        });
    };

    this.apply = function(id) {
        return ask({ type: 'SS_SYNC_APPLY', id: id }, APPLY_TIMEOUT_MS);
    };

    /*
     * Turn a successful validation into a real deploy. Long timeout for the
     * same reason apply has one: this does not come back until the org has
     * finished deploying.
     */
    this.quickDeploy = function(id) {
        return ask({ type: 'SS_SYNC_QUICK_DEPLOY', id: id }, APPLY_TIMEOUT_MS);
    };

    this.retry = function(id) {
        return ask({ type: 'SS_SYNC_RETRY', id: id }, APPLY_TIMEOUT_MS);
    };

    this.discard = function(id) {
        return ask({ type: 'SS_SYNC_DISCARD', id: id });
    };

    /*
     * Empty one of the history lists - 'succeeded' or 'failed'. The worker
     * decides what is in each, so that what a Clear all removes is exactly
     * what the list it was pressed from was showing.
     */
    this.clear = function(group) {
        return ask({ type: 'SS_SYNC_CLEAR', group: group });
    };

    /* ------------------------------------------------------------------ */
    /* Shaping for the screen                                              */
    /* ------------------------------------------------------------------ */

    /*
     * One line saying what a job is, without making the reader open it.
     *
     * The component count rather than the list: a package of sixty classes
     * has no useful one-line rendering, and the detail view is one click
     * away for anyone who wants the names.
     */
    /*
     * The org a job is going to.
     *
     * Its own function because the list is nearly always one pipeline's
     * history, where this is the same string on every row - so on screen it
     * is shown once and quietly, next to a subject that is the only part
     * that differs between rows.
     */
    this.jobTarget = function(job) {
        return (job && job.target && job.target.label) || 'the target org';
    };

    /*
     * What the job is about, with no org attached.
     */
    this.jobSubject = function(job) {
        if (!job) { return ''; }

        /*
         * A data job is named by its object and its key, because those are
         * the two things somebody needs before approving it: what is being
         * written, and what decides which row gets overwritten.
         */
        if (job.kind === 'data') {
            /* The sentinel is machinery, not something to read. What matters
             * on this line is that nothing was matched. */
            var how = job.keyField === '__ss_create_all__'
                ? ', all created'
                : (job.keyField ? ' on ' + job.keyField : '');
            return (job.objectApiName || 'Records') + how;
        }

        var count = (job.components || []).length;
        var what = count === 1
            ? ((job.components[0].type || 'component') + ' ' + job.components[0].name)
            : (count + ' components');
        return what;
    };

    /*
     * Both halves as one string, for the places that need one: a toast, a
     * title attribute, a job named in prose. The screen renders the two
     * separately so the repeated half can be played down.
     */
    this.jobTitle = function(job) {
        if (!job) { return ''; }
        return this.jobSubject(job) + ' → ' + this.jobTarget(job);
    };

    /*
     * What applying this job will actually do, in the word for it.
     *
     * "Apply" is the machinery's word - a staged job is applied. What happens
     * to the org is a deploy, a check-only validation, or records being
     * written, and those are three different things to be one click away
     * from. The button that starts it says which, so the decision is made
     * against what will happen rather than against a verb that covers all
     * three equally badly.
     *
     * checkOnly is the flag the job was staged with, not the one on its
     * result: this names what is about to happen, not what happened.
     */
    this.applyLabel = function(job) {
        if (!job) { return 'Apply'; }
        if (job.kind === 'data') { return 'Migrate'; }
        if (job.checkOnly) { return 'Validate'; }
        return 'Deploy';
    };

    /* The same act while it is happening. 'Working…' told somebody watching a
     * deploy nothing they did not already know. */
    this.applyingLabel = function(job) {
        if (!job) { return 'Working…'; }
        if (job.kind === 'data') { return 'Migrating…'; }
        if (job.checkOnly) { return 'Validating…'; }
        return 'Deploying…';
    };

    /*
     * The states, in the words somebody reading a list would use, and with
     * the distinction the engine cares about kept intact: blocked is not
     * failed, because nothing about the job is wrong.
     */
    this.stateLabel = function(job) {
        if (!job) { return ''; }
        switch (job.state) {
            case 'staged':    return 'Waiting for review';
            case 'running':
                if (job.stage === 'query')  { return 'Reading records'; }
                if (job.stage === 'deploy') { return 'Deploying'; }
                return job.kind === 'data' ? 'Writing records' : 'Retrieving';
            case 'succeeded':
                if (job.result && job.result.checkOnly) { return 'Validated'; }
                return job.validationId ? 'Quick deployed' : 'Succeeded';
            /* A failure that is really a sign-in says so, however it was
             * stored - the label is about what to do, not about which branch
             * of the state machine wrote it. */
            case 'failed':    return this.needsAuth(job) ? 'Needs sign in' : 'Failed';
            case 'blocked':   return 'Needs sign in';
            default:          return job.state || '';
        }
    };

    this.stateClass = function(job) {
        if (!job) { return ''; }
        /* Amber, not red, when the answer is signing in: the colour carries
         * the same distinction the label does. */
        if (this.needsAuth(job)) { return 'ss-sync-state is-blocked'; }
        return 'ss-sync-state is-' + job.state;
    };

    /*
     * Whether this job is waiting on a sign-in, whatever state it was stored
     * in. A job that failed on an expired session before that distinction
     * existed is still waiting on a sign-in - the record just does not say
     * 'blocked'. The worker marks those on the way out; this reads the mark
     * rather than the state.
     */
    this.needsAuth = function(job) {
        return !!(job && job.error && job.error.needsAuth);
    };

    /*
     * One page of a list, and everything the pager needs to describe itself.
     *
     * The history holds up to a hundred jobs, and a hundred rows is a page
     * nobody reads to the bottom of. Ten is enough to see the recent ones
     * without the section burying what is under it.
     *
     * The page is clamped rather than trusted: discarding the last job on
     * page five leaves the caller asking for a page that no longer exists,
     * and an empty list with a "Next" button is worse than no pager.
     */
    var PAGE_SIZE = 10;
    this.pageSize = PAGE_SIZE;

    this.paginate = function(list, page, size) {
        var all = list || [];
        var per = size || PAGE_SIZE;
        var pages = Math.max(1, Math.ceil(all.length / per));
        var current = Math.min(Math.max(0, page || 0), pages - 1);
        var from = current * per;

        return {
            items: all.slice(from, from + per),
            page: current,
            pages: pages,
            total: all.length,
            /* One-based, because these are for reading: "1-10 of 47". */
            from: all.length ? from + 1 : 0,
            to: Math.min(from + per, all.length),
            hasPrevious: current > 0,
            hasNext: current < pages - 1
        };
    };

    /*
     * The history, split by attempt.
     *
     * A job retried twice keeps every line of all three runs, and flat they
     * read as the same three sentences repeated with no seam - the reader
     * has to compare timestamps to work out where one attempt ended.
     *
     * Records written before attempts were stamped carry none, and there is
     * no way to reconstruct them: those come back as a single unlabelled
     * group, which renders exactly as the flat list did. Inventing attempt
     * numbers for them would be a guess presented as history.
     */
    this.historyGroups = function(job) {
        var history = (job && job.history) || [];
        var stamped = history.some(function(entry) { return entry && entry.attempt; });
        if (!stamped) {
            return history.length ? [{ attempt: null, label: null, entries: history }] : [];
        }

        var groups = [];
        var current = null;
        history.forEach(function(entry) {
            var attempt = (entry && entry.attempt) || 0;
            if (!current || current.attempt !== attempt) {
                current = {
                    attempt: attempt,
                    /* Attempt 0 is everything before the first run - the
                     * staging, which is not an attempt at anything. */
                    label: attempt ? 'Attempt ' + attempt : 'Staged',
                    entries: []
                };
                groups.push(current);
            }
            current.entries.push(entry);
        });
        return groups;
    };

    /*
     * Split for the two lists the user asked for - succeeded and failed -
     * with the two live states kept out in front where they are actionable.
     * A single list ordered by date buries the one job waiting on a decision
     * under fifty that are finished with.
     */
    this.group = function(jobs) {
        var groups = { active: [], succeeded: [], failed: [] };
        (jobs || []).forEach(function(job) {
            if (!job) { return; }
            if (job.state === 'staged' || job.state === 'running') {
                groups.active.push(job);
            } else if (job.state === 'succeeded') {
                groups.succeeded.push(job);
            } else {
                // failed and blocked together: both are things that did not
                // land, and separating them hides half the problem list.
                groups.failed.push(job);
            }
        });
        return groups;
    };

}]);
})();
