/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * When the staged jobs are put in front of the user.
 *
 * A job waiting for review is the one thing on that page that stops until
 * somebody acts, and a section can be scrolled past - so it is also shown as
 * a modal. The rules about when it appears are the whole feature: too eager
 * and people learn to close it without reading, too shy and it never solves
 * the problem it was added for.
 *
 * Driven rather than grepped: "the file mentions seen[job.id]" passed while
 * the modal never opened at all.
 */

const ROOT = path.join(__dirname, '..');
const controller = fs.readFileSync(
    path.join(ROOT, 'js/angular/controllers/MenuAndDetailsCtrl.js'), 'utf8');

function lift(signature) {
    const at = controller.indexOf(signature);
    assert.ok(at > -1, signature + ' not found - it has been renamed or removed');

    let depth = 0;
    let started = false;
    for (let i = at; i < controller.length; i += 1) {
        if (controller[i] === '{') { depth += 1; started = true; }
        else if (controller[i] === '}') {
            depth -= 1;
            if (started && depth === 0) { return controller.slice(at, i + 1); }
        }
    }
    throw new Error('Could not find the end of ' + signature);
}

function panel(active) {
    const sandbox = {
        $scope: {
            sync: { groups: { active: active || [] } },
            syncReview: { open: false, jobs: [], seen: {} }
        }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(
        lift('function syncOfferReview(){') + '\n' +
        lift('$scope.syncDismissReview = function(){').replace('$scope.syncDismissReview =',
            'var syncDismissReview =') + ';', sandbox);
    return sandbox;
}

const staged = (id) => ({ id: id, state: 'staged' });
const running = (id) => ({ id: id, state: 'running' });

/* ------------------------------------------------------------------ */
/* It appears when there is a decision to make                         */
/* ------------------------------------------------------------------ */

const one = panel([staged('j1')]);
vm.runInContext('syncOfferReview()', one);
assert.strictEqual(one.$scope.syncReview.open, true,
    'a staged job puts the modal in front of the user');
assert.strictEqual(Array.from(one.$scope.syncReview.jobs).length, 1,
    'and the modal is given the job to show');

/*
 * A running job is not a decision. It is already happening, and there is
 * nothing to apply or discard.
 */
const busy = panel([running('j2')]);
vm.runInContext('syncOfferReview()', busy);
assert.strictEqual(busy.$scope.syncReview.open, false,
    'a job already running asks nothing of anybody');
assert.strictEqual(Array.from(busy.$scope.syncReview.jobs).length, 0);

/* Mixed: only the staged one is listed. */
const mixed = panel([running('j2'), staged('j3')]);
vm.runInContext('syncOfferReview()', mixed);
assert.deepStrictEqual(Array.from(mixed.$scope.syncReview.jobs).map((j) => j.id), ['j3'],
    'only the jobs waiting on a decision are listed');

/* ------------------------------------------------------------------ */
/* It does not nag                                                     */
/* ------------------------------------------------------------------ */

/*
 * Turned down once, it stays down for that job. A modal that returns on
 * every page load is one people close without reading, which costs more than
 * it was added to fix.
 */
const nag = panel([staged('j1'), staged('j2')]);
vm.runInContext('syncOfferReview()', nag);
assert.strictEqual(nag.$scope.syncReview.open, true);

vm.runInContext('syncDismissReview()', nag);
assert.strictEqual(nag.$scope.syncReview.open, false, 'Later closes it');

/* And the jobs are untouched - Later is not Discard. */
assert.strictEqual(Array.from(nag.$scope.sync.groups.active).length, 2,
    'turning it down changes nothing about the jobs');
assert.strictEqual(nag.$scope.sync.groups.active[0].state, 'staged',
    'they are still waiting, still in the section');

vm.runInContext('syncOfferReview()', nag);
assert.strictEqual(nag.$scope.syncReview.open, false,
    'and it does not come back for jobs already turned down');

/*
 * But a new job is a new decision, and does bring it back - otherwise one
 * dismissal silences every job that follows.
 */
nag.$scope.sync.groups.active.push(staged('j3'));
vm.runInContext('syncOfferReview()', nag);
assert.strictEqual(nag.$scope.syncReview.open, true,
    'something new to decide opens it again');

/* ------------------------------------------------------------------ */
/* It closes itself when there is nothing left                         */
/* ------------------------------------------------------------------ */

const emptied = panel([staged('j1')]);
vm.runInContext('syncOfferReview()', emptied);
assert.strictEqual(emptied.$scope.syncReview.open, true);

/* Applied or discarded elsewhere: nothing is staged any more. */
emptied.$scope.sync.groups.active = [];
vm.runInContext('syncOfferReview()', emptied);
assert.strictEqual(emptied.$scope.syncReview.open, false,
    'an empty modal closes rather than sitting there asking about nothing');
assert.strictEqual(Array.from(emptied.$scope.syncReview.jobs).length, 0);


/* ------------------------------------------------------------------ */
/* The modal shows what it is asking about                             */
/* ------------------------------------------------------------------ */

/*
 * "Apply or discard" over a line reading "2 components -> org" names the
 * shape of the job and not one thing in it. Approving a deploy you have not
 * been shown is not a review, so the modal renders the same block the detail
 * row does - the same template, not a second copy of it, because two copies
 * of "what this job carries" is exactly the pair that comes to disagree.
 */
const view = fs.readFileSync(path.join(ROOT, 'js/angular/services/ViewService.js'), 'utf8');

const reviewList = view.slice(
    view.indexOf('<ul class="ss-review-list">'),
    view.indexOf('</ul>', view.indexOf('<ul class="ss-review-list">')));
assert.ok(reviewList.length > 100, 'the review list is gone or could not be read');

assert.ok(/<syncjobcarries><\/syncjobcarries>/.test(reviewList),
    'the review modal still asks about a job without showing what is in it');

/* One template, two users. */
assert.strictEqual((view.match(/<syncjobcarries><\/syncjobcarries>/g) || []).length, 2,
    'expected the carried-items block in exactly two places: the detail row ' +
    'and the review modal');
assert.strictEqual((view.match(/this\.syncjobcarries = /g) || []).length, 1,
    'there is more than one definition of what a job carries');

/*
 * The markup itself must have left the detail row, or the extraction is
 * cosmetic and there are still two copies - one of them stale.
 */
const detail = view.slice(view.indexOf('this.syncjobdetail ='),
    view.indexOf('this.bulkjobs'));
assert.ok(!/Components \(\{\{job\.components\.length\}\}\)/.test(detail),
    'the detail row still carries its own copy of the components list');
assert.ok(!/ss-sync-chip"/.test(detail),
    'the detail row still renders its own component chips');

/* It has to be a registered directive, or the element renders as nothing. */
const directives = fs.readFileSync(path.join(ROOT, 'js/angular/directives.js'), 'utf8');
assert.ok(/syncjobcarries: 'syncjobcarries'/.test(directives),
    'syncjobcarries is not registered, so the element renders as an empty tag');

/*
 * And it must have no isolate scope, like syncjobdetail. It reads the `job`
 * of the repeat it sits inside - in the modal that is syncReview.jobs, in the
 * detail row it is the history list. An isolate scope would leave every
 * binding in it evaluating to nothing, silently.
 */
assert.ok(!/scope:\s*\{/.test(directives),
    'a directive here declares an isolate scope, which would cut syncjobcarries ' +
    'off from the job it is meant to render');

/*
 * Both kinds. A metadata job shows its components; a data job shows the
 * object, what it matches on, and the query - and the modal is the last
 * point at which any of that can be looked at before records are written.
 */
const carries = view.slice(view.indexOf('this.syncjobcarries = '),
    view.indexOf('this.syncjobdetail ='));
assert.ok(/ng-if="job\.kind === \\'data\\'"/.test(carries),
    'the data half of the carried-items block did not come across');
assert.ok(/ng-if="job\.kind !== \\'data\\'"/.test(carries),
    'the metadata half of the carried-items block did not come across');
assert.ok(/ng-repeat="c in job\.components \| limitTo:60"/.test(carries),
    'the components are not listed, or no longer capped');
assert.ok(/job\.components\.length > 60[\s\S]{0,80}more/.test(carries),
    'a job over the cap does not say how many were left out');
assert.ok(/\{\{job\.query\}\}/.test(carries),
    'the query a data job will run is not shown before it is approved');



/* ------------------------------------------------------------------ */
/* The decision stays reachable                                        */
/* ------------------------------------------------------------------ */

/*
 * This is the bug the section exists for. The modal grew a list of what is
 * in the job, and a 42-component deploy filled the box and pushed Apply and
 * Discard off the bottom of it - leaving a modal that asks a question with
 * only "Later" within reach. Nothing caught it, because every assertion here
 * was about the buttons existing, and they did exist.
 */
vm.runInContext(lift('$scope.syncSoleReviewJob = function(){') + ';', one);
const sole = (jobs) => {
    one.$scope.syncReview.jobs = jobs;
    return vm.runInContext('$scope.syncSoleReviewJob()', one);
};

assert.strictEqual(sole([]), null, 'an empty modal offers a decision about nothing');
assert.strictEqual(sole([staged('j1')]).id, 'j1',
    'the single staged job is not offered to the footer');
assert.strictEqual(sole([staged('j1'), staged('j2')]), null,
    'with two jobs the footer cannot say which one it means, and must offer neither');

/* ---- and the markup that puts it there ---------------------------- */

const modalAt = view.indexOf('ng-if="syncReview.open && !syncRun.open"');
assert.ok(modalAt > -1, 'the review modal is gone');
const modal = view.slice(modalAt, view.indexOf('ng-if="syncRun.open"', modalAt));

/*
 * Head, scrolling body, fixed footer - and the footer outside the body, or
 * it scrolls away with everything else, which is the whole failure.
 */
const bodyAt = modal.indexOf('<div class="ss-run-body">');
const listAt = modal.indexOf('<ul class="ss-review-list">');
const bodyEnd = modal.indexOf("'</div>'+\n\n'<div class=\"ss-run-actions");
assert.ok(bodyAt > -1, 'the modal has no scrolling body');
assert.ok(listAt > bodyAt, 'the job list is not inside the scrolling body');
assert.ok(bodyEnd > listAt, 'the scrolling body is not closed before the footer');

const footAt = modal.indexOf('<div class="ss-run-actions is-review-foot">');
assert.ok(footAt > bodyEnd,
    'the footer is inside the scrolling body, so it scrolls away under a long job');

const footer = modal.slice(footAt);
assert.ok(/ng-click="syncApply\(syncSoleReviewJob\(\)\)"/.test(footer),
    'the footer cannot apply the job it is asking about');
assert.ok(/ng-click="syncDiscard\(syncSoleReviewJob\(\)\)"/.test(footer),
    'the footer cannot discard the job it is asking about');
assert.ok(/ng-click="syncDismissReview\(\)"/.test(footer),
    'the way out is gone from the footer');

/* Disabled while that job is running, or Apply can be pressed twice. */
assert.ok(/ng-disabled="sync\.busyJob === syncSoleReviewJob\(\)\.id"/.test(footer),
    'the footer Apply stays live while the job is already running');

/*
 * One pair of buttons, never two. The footer answers for a single job and
 * the per-job rows answer when there are several; both at once is two Apply
 * buttons for one job and a question about which is the real one.
 */
const perJob = modal.slice(modal.indexOf('<div class="ss-review-do"'), footAt);
assert.ok(/ng-if="syncReview\.jobs\.length > 1"/.test(perJob),
    'the per-job buttons render alongside the footer pair for a single job');

/*
 * And where there are several, the buttons come before the list of what is
 * in each job - below it they are buried under however many components that
 * job happens to have, which is the same failure one level down.
 */
const doAt = modal.indexOf('<div class="ss-review-do"');
const carriesAt = modal.indexOf('<syncjobcarries></syncjobcarries>');
assert.ok(doAt > -1 && carriesAt > -1);
assert.ok(doAt < carriesAt,
    'a job\'s buttons are drawn below its component list, where a large job ' +
    'buries them exactly as the footer was buried');

/* ---- the shell that makes it hold ---------------------------------- */

const css = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
assert.ok(/\.ss-run \{[^}]*flex-direction:\s*column/.test(css),
    'the modal is not a column, so the body cannot be the only part that scrolls');
assert.ok(/\.ss-run \{[^}]*max-height:/.test(css),
    'the modal has no height limit, so a long job grows it past the viewport');
assert.ok(/\.ss-run-body \{[^}]*overflow-y:\s*auto/.test(css),
    'the body does not scroll, so the content pushes the footer out instead');
assert.ok(/\.ss-run-body \{[^}]*min-height:\s*0/.test(css),
    'without min-height:0 a flex child refuses to shrink and scrolls the whole ' +
    'modal instead of its own body');

/*
 * And the list must not scroll on its own any more, or there is a scrollbar
 * inside a scrollbar with the footer below both.
 */
const listRule = (css.match(/\.ss-review-list \{([^}]*)\}/) || [, ''])[1];
assert.ok(!/overflow/.test(listRule),
    'the job list still scrolls independently, which nests a scrollbar inside ' +
    'the body that already scrolls');
assert.ok(!/max-height/.test(listRule),
    'the job list is still capped, so it scrolls inside the scrolling body');



/* ------------------------------------------------------------------ */
/* The button names what it does                                       */
/* ------------------------------------------------------------------ */

/*
 * "Apply" is the machinery's word - a staged job is applied. What happens to
 * the org is a deploy, a check-only validation, or records being written,
 * and those are three quite different things to be one click away from.
 */
const service = fs.readFileSync(path.join(ROOT, 'js/angular/services/PipelineService.js'), 'utf8');
const box = { console: console, window: {} };
box.globalThis = box;
box.angular = { module: () => ({ service: function (name, deps) {
    const build = deps[deps.length - 1];
    box.made = new build(
        () => ({ defer: () => ({ promise: null }) }),
        Object.assign(() => {}, { cancel: () => {} }));
    return this;
} }) };
vm.createContext(box);
vm.runInContext(service, box);
const P = box.made;

assert.strictEqual(P.applyLabel({ kind: 'metadata' }), 'Deploy');
assert.strictEqual(P.applyLabel({ kind: 'metadata', checkOnly: true }), 'Validate',
    'a check-only job is not a deploy and must not offer to be one');
assert.strictEqual(P.applyLabel({ kind: 'data', keyField: 'Email' }), 'Migrate');

/*
 * A quick deploy is a deploy. It carries a validationId and checkOnly false -
 * naming it anything else would be the one case where the button undersells
 * what it is about to do to production.
 */
assert.strictEqual(P.applyLabel({ kind: 'metadata', validationId: '0Af123' }), 'Deploy');

/* A data job is records whether or not it matches on anything. */
assert.strictEqual(P.applyLabel({ kind: 'data', keyField: '__ss_create_all__' }), 'Migrate');

/*
 * checkOnly on the job, not on its result. The result's copy says what
 * happened; this button says what is about to.
 */
assert.strictEqual(P.applyLabel({ kind: 'metadata', result: { checkOnly: true } }), 'Deploy',
    'the label is being read from the result of a previous run');

assert.strictEqual(P.applyLabel(null), 'Apply', 'no job at all still needs a word');

/* And the same act while it is happening. */
assert.strictEqual(P.applyingLabel({ kind: 'metadata' }), 'Deploying…');
assert.strictEqual(P.applyingLabel({ kind: 'metadata', checkOnly: true }), 'Validating…');
assert.strictEqual(P.applyingLabel({ kind: 'data' }), 'Migrating…');
assert.strictEqual(P.applyingLabel(null), 'Working…');

/* Every button that applies a job uses it - all three, counted. */
assert.strictEqual((view.match(/>Apply<\/button>/g) || []).length, 0,
    'a button still says "Apply" rather than what applying it will do');
assert.strictEqual((view.match(/syncApplyLabel\(/g) || []).length, 3,
    'expected the naming on all three apply buttons: the waiting tile, the ' +
    'per-job pair, and the footer');
assert.strictEqual((view.match(/syncApplyingLabel\(/g) || []).length, 2,
    'the two buttons that can be caught mid-run must both say which run it is');

/* Bound on the scope, or the binding renders empty and the button is blank. */
['syncApplyLabel', 'syncApplyingLabel'].forEach((name) => {
    assert.ok(new RegExp('\\$scope\\.' + name + ' = function').test(controller),
        name + ' is not on the scope, so the button renders with no text at all');
});

/* ------------------------------------------------------------------ */
/* The head and the foot read as pinned                                */
/* ------------------------------------------------------------------ */

/*
 * Both stay while the middle scrolls, and that is invisible until they are
 * drawn as surfaces - a rule on its own reads as a line in the text.
 */
[['.ss-run.is-review .ss-run-head', 'the head'],
 ['.ss-run-actions.is-review-foot', 'the foot']].forEach(([selector, what]) => {
    const rule = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        ' \\{([^}]*)\\}'));
    assert.ok(rule, what + ' has no rule of its own');
    assert.ok(/background:/.test(rule[1]),
        what + ' has no background, so it does not read as a bar the content ' +
        'passes behind');
    assert.ok(/margin:[^;]*-20px/.test(rule[1]),
        what + ' is not outdented to the card edge, so its tint stops short of ' +
        'the sides and reads as a box rather than a bar');
    assert.ok(/border-radius:/.test(rule[1]),
        what + ' does not follow the card\'s corners, so the tint squares off ' +
        'inside a rounded card');
});


console.log('sync_review: ok');
