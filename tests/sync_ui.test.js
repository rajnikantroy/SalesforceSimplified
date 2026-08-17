/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * How the Org Sync page reads, as opposed to what it does.
 *
 * Three sections list jobs - waiting, succeeded, failed - and they are three
 * separate copies of the same markup. That is the shape that has already
 * produced a half-applied edit on this page once, where an anchor matched in
 * one place and the other two silently kept the old rendering. So every rule
 * about a job row is asserted against all three, counted, rather than
 * against whichever copy a search happens to reach first.
 */

const ROOT = path.join(__dirname, '..');
const view = fs.readFileSync(path.join(ROOT, 'js/angular/services/ViewService.js'), 'utf8');
const controller = fs.readFileSync(
    path.join(ROOT, 'js/angular/controllers/MenuAndDetailsCtrl.js'), 'utf8');
const service = fs.readFileSync(
    path.join(ROOT, 'js/angular/services/PipelineService.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');

/* The sync page's template only, so nothing here can be satisfied by the
 * bulk-jobs list or the audit trail, which have rows of their own. */
const start = view.indexOf('this.syncjobs');
assert.ok(start > -1, 'the syncjobs template is gone');
const syncjobs = view.slice(start, view.indexOf('this.syncjobdetail'));
assert.ok(syncjobs.length > 5000, 'the syncjobs template extraction came back too small');

const count = (haystack, needle) => haystack.split(needle).length - 1;

/* ------------------------------------------------------------------ */
/* A job row is a disclosure, not a link                               */
/* ------------------------------------------------------------------ */

/*
 * The rows were <a href="">. Browsers colour a visited anchor, so a history
 * list turned purple row by row as it was read - reading as though the
 * entries had been navigated to, when the click only expands the detail
 * underneath. Anchors also underline the full width of the row.
 */
assert.strictEqual(count(syncjobs, '<a href="" ng-click="syncToggleJob(job)"'), 0,
    'job titles are still anchors, which browsers mark visited as they are read');

assert.strictEqual(count(syncjobs, 'ng-click="syncToggleJob(job)"'), 3,
    'expected exactly three job lists (waiting, succeeded, failed) to be toggleable');

assert.strictEqual(count(syncjobs, '<button class="ss-sync-job"'), 3,
    'not every job list renders its title as a disclosure button');

/* And the caret that says it opens, on all three. */
assert.strictEqual(count(syncjobs, 'ss-sync-caret'), 3,
    'not every job row has the caret that marks it as expandable');

/*
 * The caret has to actually turn, or it is decoration that lies about state
 * - pointing right at a row that is open.
 */
/*
 * Two elements per job mark themselves open, and they do different jobs: the
 * title button, whose caret turns, and the tile, which takes the full width
 * of the grid so the detail inside it is readable. Six in all, across three
 * lists - counted, because a check that one of them is still there passes
 * while the others have carets frozen shut or details crushed into a column.
 */
assert.strictEqual(
    (syncjobs.match(/ng-class="\{\\?'is-open\\?':\s*syncIsOpen\(job\)\}"/g) || []).length, 6,
    'the tile and its title button must both mark themselves open, in all three lists');
assert.ok(/\.ss-sync-job\.is-open \.ss-sync-caret\s*\{[^}]*rotate/.test(css),
    'the caret never turns, so it says "closed" on an open row');

/* ------------------------------------------------------------------ */
/* The answer leads the row                                            */
/* ------------------------------------------------------------------ */

/*
 * "Did this work" is the question a history list is scanned for, and it was
 * answered at the far right margin, a full row width from the job it was
 * about. The pill now travels with the title.
 */
assert.strictEqual(count(syncjobs, 'ng-class="syncStateClass(job)"'), 3,
    'expected one state pill per job list, no more and no less');

const rows = syncjobs.split('<button class="ss-sync-job"').slice(1);
assert.strictEqual(rows.length, 3);
rows.forEach((row, i) => {
    const upToClose = row.slice(0, row.indexOf('</button>'));
    assert.ok(upToClose.indexOf('syncStateClass(job)') > -1,
        'job list ' + (i + 1) + ': the state pill is outside the title, back at the margin');
    assert.ok(upToClose.indexOf('ss-sync-caret') < upToClose.indexOf('syncStateClass(job)'),
        'job list ' + (i + 1) + ': the caret must lead, then the state, then the subject');
});

/* ------------------------------------------------------------------ */
/* The org is said quietly, because it is said on every row            */
/* ------------------------------------------------------------------ */

/*
 * The list is nearly always one pipeline's history, so the target org is the
 * same string on all 27 rows - at full strength it was most of the width and
 * none of the information. Subject and target are rendered separately so
 * only one of them can be played down.
 */
/* Asserted inside each row's own button, not counted across the template -
 * the review modal below uses the subject too, and a total would let one
 * row lose it while another gained a second copy. */
rows.forEach((row, i) => {
    const upToClose = row.slice(0, row.indexOf('</button>'));
    assert.strictEqual(count(upToClose, '{{syncJobSubject(job)}}'), 1,
        'job list ' + (i + 1) + ': the subject is not rendered on its own');
    assert.strictEqual(count(upToClose, '{{syncJobTarget(job)}}'), 1,
        'job list ' + (i + 1) + ': the target is not separate, so it cannot be played down');
    assert.ok(upToClose.indexOf('{{syncJobSubject(job)}}') <
              upToClose.indexOf('{{syncJobTarget(job)}}'),
        'job list ' + (i + 1) + ': the repeated org comes before the part that differs');
});
/*
 * Nowhere that already names the org separately says it again in the title.
 *
 * The review modal is the other place with this shape: it prints the subject
 * and then "source -> target" on the line below, so the combined title put
 * the target org on screen twice, two lines apart.
 */
assert.strictEqual(count(syncjobs, '{{syncJobTitle(job)}}'), 0,
    'a row or card still renders the combined title beside a separate org line');
assert.ok(/ss-review-what">\{\{syncJobSubject\(job\)\}\}/.test(syncjobs),
    'the review modal does not use the subject, so it names the target twice');

/*
 * The run modal is the exception and keeps the full title. It is about one
 * job with no org line under it, and a progress dialog that does not say
 * which org it is writing into is the one place that reading matters most.
 */
assert.ok(/\{\{syncJobTitle\(syncRun\.job\)\}\}/.test(syncjobs),
    'the run modal no longer names the org it is deploying into');

assert.ok(/\.ss-sync-job-to\s*\{[^}]*color:\s*#94a3b8/.test(css),
    'the repeated org is not actually played down');

/*
 * Splitting it must not have changed what the combined string says. Other
 * things read jobTitle - a toast, a title attribute - and a split that
 * quietly drops the arrow or the org would break them silently.
 */
const box = { console: console };
box.globalThis = box;
box.window = {};
box.angular = { module: () => ({ service: (name, deps) => { box.factory = deps[deps.length - 1]; } }) };
vm.createContext(box);
vm.runInContext(service, box);
const Pipelines = new box.factory(
    (fn) => ({ defer: () => ({ promise: null, resolve: fn, reject: fn }) }),
    Object.assign(() => {}, { cancel: () => {} }));

const metadataJob = {
    kind: 'metadata',
    components: [{ type: 'ApexClass', name: 'Test1' }],
    target: { label: 'acme.my.salesforce.com (IND56)' }
};
assert.strictEqual(Pipelines.jobSubject(metadataJob), 'ApexClass Test1');
assert.strictEqual(Pipelines.jobTarget(metadataJob), 'acme.my.salesforce.com (IND56)');
assert.strictEqual(Pipelines.jobTitle(metadataJob),
    'ApexClass Test1 → acme.my.salesforce.com (IND56)',
    'the combined title changed when it was split - callers of jobTitle now read differently');

const dataJob = {
    kind: 'data', objectApiName: 'Contact', keyField: 'Email',
    target: { label: 'acme.my.salesforce.com (IND56)' }
};
assert.strictEqual(Pipelines.jobSubject(dataJob), 'Contact on Email');
assert.strictEqual(Pipelines.jobTitle(dataJob),
    'Contact on Email → acme.my.salesforce.com (IND56)');

/* The create-everything sentinel is machinery and stays out of the subject. */
assert.strictEqual(
    Pipelines.jobSubject({ kind: 'data', objectApiName: 'Account',
        keyField: '__ss_create_all__' }),
    'Account, all created',
    'the insert-only sentinel leaked into what the user reads');

/* A job with no target still names something rather than trailing an arrow
 * into nothing. */
assert.strictEqual(Pipelines.jobTarget({ kind: 'data' }), 'the target org');
assert.strictEqual(Pipelines.jobSubject(null), '');
assert.strictEqual(Pipelines.jobTitle(null), '',
    'a missing job produces a bare arrow rather than nothing');

/* ------------------------------------------------------------------ */
/* The pipeline actions have ranks                                     */
/* ------------------------------------------------------------------ */

/*
 * Five identical blue links wrapped into a corner: sending a deploy and
 * deleting the pipeline looked the same and read in whatever order they
 * happened to wrap. Same controls, weights made visible.
 */
const ranks = {
    'is-send': ['syncStage(p, false)', 'syncOpenData(p)'],
    'is-check': ['syncStage(p, true)'],
    'is-quiet': ['syncEditPipeline(p)'],
    'is-danger': ['syncDeletePipeline(p)']
};
Object.keys(ranks).forEach((rank) => {
    ranks[rank].forEach((action) => {
        const at = syncjobs.indexOf('ng-click="' + action + '"');
        assert.ok(at > -1, action + ' is no longer on the page at all');
        const opening = syncjobs.lastIndexOf('<button', at);
        const tag = syncjobs.slice(opening, at);
        assert.ok(tag.indexOf('ss-sync-act ' + rank) > -1,
            action + ' is not ranked ' + rank + ' - it reads as the same weight as its neighbours');
    });
});

/*
 * The job rows carry the same ranks, for the same reason. Apply is the one
 * thing "Waiting on you" exists to ask for and was drawn identically to the
 * Discard beside it.
 */
const applyAt = syncjobs.indexOf('ng-click="syncApply(job)">{{sync.busyJob');
assert.ok(applyAt > -1, 'the Apply button in the waiting list has moved');
assert.ok(syncjobs.slice(syncjobs.lastIndexOf('<button', applyAt), applyAt)
        .indexOf('ss-sync-act is-send') > -1,
    'Apply is not drawn as the act the section is asking for');

assert.strictEqual(count(syncjobs, '<button class="ss-desc-link" ng-click="syncDiscard(job)">'), 0,
    'a Discard is still drawn at the same weight as the Apply next to it');
assert.strictEqual(count(syncjobs, 'ng-click="syncDiscard(job)"'), 4,
    'expected Discard in the review modal and all three job lists');

/*
 * And nothing carries a margin of its own: the actions cell is a flex row
 * with a gap, and a margin on top of it compounds into uneven spacing that
 * only shows when the row wraps.
 */
assert.ok(!/\.ss-sync-act \{[^}]*margin:/.test(css),
    'ss-sync-act sets a margin, which compounds with the flex gap around it');

/* Destructive must not share a rank with the thing that does the work. */
assert.ok(!/ss-sync-act is-send[^>]*syncDeletePipeline/.test(syncjobs),
    'Remove is styled as a primary action');

/* And each rank has to be drawn differently, or the classes are labels on
 * nothing. Three distinct treatments, three distinct rules. */
['is-send', 'is-check', 'is-quiet', 'is-danger'].forEach((rank) => {
    assert.ok(new RegExp('\\.ss-sync-act\\.' + rank + '\\s*\\{').test(css),
        rank + ' has no style of its own, so the rank is invisible');
});

/* ------------------------------------------------------------------ */
/* A pipeline that has never once worked says so                       */
/* ------------------------------------------------------------------ */

function liftScope(signature) {
    const at = controller.indexOf(signature);
    assert.ok(at > -1, signature + ' not found');
    let depth = 0, started = false;
    for (let i = at; i < controller.length; i += 1) {
        if (controller[i] === '{') { depth += 1; started = true; }
        else if (controller[i] === '}') {
            depth -= 1;
            if (started && depth === 0) { return controller.slice(at, i + 1); }
        }
    }
    throw new Error('unterminated ' + signature);
}

const scope = { $scope: {} };
scope.globalThis = scope;
vm.createContext(scope);
vm.runInContext(liftScope('$scope.syncAllFailed = function(pipeline){') + ';', scope);
const allFailed = (usage) => vm.runInContext(
    '$scope.syncAllFailed(' + JSON.stringify({ usage: usage }) + ')', scope);

/* The pipeline from the report: thirteen runs, thirteen failures, drawn in
 * the same grey as a healthy one. */
assert.strictEqual(allFailed({ runs: 13, failed: 13 }), true,
    'a pipeline that has never succeeded is not marked');

assert.strictEqual(allFailed({ runs: 57, succeeded: 27, failed: 10 }), false,
    'a working pipeline is marked as broken');

/*
 * Strict about what "all" means. Runs counts more than succeeded and failed
 * together, because a job can still be staged - so a pipeline with failures
 * and nothing else finished yet is not a pipeline that only ever fails.
 */
assert.strictEqual(allFailed({ runs: 13, failed: 5 }), false,
    'runs still in flight are being counted as failures');
assert.strictEqual(allFailed({ runs: 13, succeeded: 1, failed: 12 }), false,
    'one success is enough - it is not a pipeline that has never worked');
assert.strictEqual(allFailed({}), false, 'a pipeline that has never run is not a failing one');
assert.strictEqual(allFailed({ runs: 0, failed: 0 }), false);

assert.ok(/ng-class="\{\\?'is-allfailed\\?':\s*syncAllFailed\(p\)\}"/.test(syncjobs),
    'nothing on the page uses syncAllFailed, so the marking never appears');
assert.ok(/\.ss-sync-usage\.is-allfailed\s*\{[^}]*#b91c1c/.test(css),
    'is-allfailed has no colour, so a pipeline that only fails still reads as ordinary');

/* ------------------------------------------------------------------ */
/* The preamble is said once                                           */
/* ------------------------------------------------------------------ */

/*
 * The page header already says what this page is. A card headed "Org Sync"
 * restating it put two boxes of throat-clearing above the first thing worth
 * looking at.
 */
assert.strictEqual(count(syncjobs, '<h4>Org Sync</h4>'), 0,
    'the page still repeats its own title in a card below the header');
assert.strictEqual(
    count(syncjobs, 'Send components from one org you are signed in to, to another.'), 0,
    'the page still restates its own subtitle');

/* But the things that card actually carried are still shown. */
assert.ok(/ng-show="sync\.error"/.test(syncjobs), 'errors no longer render');
assert.ok(/ng-show="sync\.notice"/.test(syncjobs), 'notices no longer render');
assert.ok(/ng-show="sync\.loading"/.test(syncjobs), 'the loading line no longer renders');

/*
 * And it collapses when it holds none of them, rather than leaving an empty
 * bordered box where the preamble used to be.
 */
const strip = syncjobs.indexOf('<div class="ss-sync-status"');
assert.ok(strip > -1, 'the status strip is gone entirely');
assert.ok(/ng-show="sync\.error \|\| sync\.notice \|\| sync\.loading \|\| syncNeedsFullPage\(\)"/
        .test(syncjobs),
    'the status strip renders even with nothing to say');

/*
 * The guarantee that was worth keeping moved to the pipelines, beside the
 * buttons it is about rather than two cards above them.
 */
const guarantee = syncjobs.indexOf('Nothing here deploys on its own.');
assert.ok(guarantee > -1, 'the "nothing deploys on its own" guarantee was dropped, not moved');
assert.ok(guarantee > syncjobs.indexOf('ng-click="syncStage(p, false)"'),
    'the guarantee is still above the buttons it describes');


/* ------------------------------------------------------------------ */
/* A pipeline is one card                                              */
/* ------------------------------------------------------------------ */

/*
 * Asserted against the template as it actually renders, not against the
 * source string. The source is a concatenation of ~200 quoted fragments;
 * whether the tags balance and what contains what cannot be read out of it
 * with a search, and the two bugs this page has actually shipped - an
 * element written outside its repeat, and a half-applied edit that landed in
 * one of three copies - are both structural.
 */
let template = null;
{
    const box = {
        console: console,
        chrome: { runtime: { getURL: (u) => u } },
        angular: { module: () => ({ service: function (name, deps) {
            const build = deps[deps.length - 1];
            const inst = {};
            build.apply(inst, deps.slice(0, -1).map(
                () => ({ data: [], systemData: [], byValue: () => null })));
            template = inst.syncjobs || template;
            return this;
        } }) }
    };
    box.window = box;
    box.globalThis = box;
    vm.createContext(box);
    vm.runInContext(view, box);
}
assert.ok(template && template.length > 5000,
    'the syncjobs template did not render - it can no longer be checked structurally');

/* A tiny tag walker. Enough to answer "what contains what". */
const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link']);
function walk(html) {
    const root = { tag: '#root', attrs: '', children: [] };
    const stack = [root];
    const unbalanced = [];
    for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>/g)) {
        const [, closing, tag, attrs] = m;
        if (VOID.has(tag) || /\/$/.test(attrs)) { continue; }
        if (closing) {
            if (stack.length < 2 || stack[stack.length - 1].tag !== tag) { unbalanced.push(tag); }
            else { stack.pop(); }
        } else {
            const node = { tag, attrs, children: [] };
            stack[stack.length - 1].children.push(node);
            stack.push(node);
        }
    }
    return { root, unbalanced, unclosed: stack.slice(1).map((n) => n.tag) };
}
const tree = walk(template);
assert.deepStrictEqual(Array.from(tree.unbalanced), [],
    'the template has close tags that match nothing');
assert.deepStrictEqual(Array.from(tree.unclosed), [],
    'the template leaves elements unclosed');

function findAll(node, test, out) {
    out = out || [];
    if (node.tag !== '#root' && test(node)) { out.push(node); }
    node.children.forEach((child) => findAll(child, test, out));
    return out;
}
/*
 * Whole class tokens, split rather than matched with \b. A word boundary
 * treats "ss-sync-card-head" as a match for "ss-sync-card", because the
 * hyphen is a non-word character - which quietly found two cards where
 * there is one.
 */
const hasClass = (name) => (n) => {
    const attr = (n.attrs.match(/class="([^"]*)"/) || [, ''])[1];
    return attr.split(/\s+/).indexOf(name) > -1;
};

const cards = findAll(tree.root, hasClass('ss-sync-card'));
assert.strictEqual(cards.length, 1, 'expected exactly one pipeline card template');
const card = cards[0];

/*
 * One repeat, one element. The three-row version needed repeat-start and
 * repeat-end, and that construct has produced the same bug on this page four
 * times: something written after the repeat rather than inside it, where the
 * alias is undefined and every binding on it evaluates to nothing.
 */
assert.ok(/ng-repeat="p in sync\.pipelines"/.test(card.attrs),
    'the card is not the repeated element');
assert.ok(!/ng-repeat-(start|end)/.test(template.slice(
        template.indexOf('ss-sync-cards'), template.indexOf('ss-usage-note'))),
    'the pipeline list still uses a split repeat, which is what the card removed');

/* Everything a pipeline owns is inside its own card. */
[['ss-sync-card-head', 'the mapping'],
 ['ss-sync-actions', 'the action band'],
 ['ss-sync-draft', 'the records form']].forEach(([name, what]) => {
    assert.strictEqual(findAll(card, hasClass(name)).length, 1,
        what + ' is not inside the pipeline card, so it belongs to no pipeline');
});

/* The band comes after the mapping, not before it. */
const order = card.children.map((c) => (c.attrs.match(/class="([^"]*)"/) || [, ''])[1]);
assert.ok(order.findIndex((c) => /ss-sync-card-head/.test(c)) <
          order.findIndex((c) => /ss-sync-actions/.test(c)),
    'the buttons are drawn above the mapping they act on');

/*
 * The current-org mark is on the card itself. On the row version it had to
 * be repeated on each row and drawn as an inset shadow on a first cell;
 * either copy could be lost on its own.
 */
assert.ok(/ng-class="\{\\?'is-here\\?':\s*p\.here\.canSend\}"/.test(card.attrs),
    'the card does not mark itself as the org that can send');
assert.strictEqual(
    (template.match(/'is-here'/g) || template.match(/is-here/g) || []).length >= 1, true);
assert.ok(/\.ss-sync-card\.is-here \{/.test(css),
    'is-here has no card rule, so the current pipeline is not marked at all');

/*
 * The records form is gated on this pipeline, and on the form being open.
 * Ungated it renders under every card at once; gated on nothing it never
 * renders at all, and "Send records" opens a form that is not there.
 */
const draft = findAll(card, hasClass('ss-sync-draft'))[0];
const draftHost = findAll(card, (n) => findAll(n, hasClass('ss-sync-draft')).length > 0 &&
    /ng-if=/.test(n.attrs))[0];
assert.ok(draft, 'the records form is gone from the card');
assert.ok(draftHost, 'the records form is not gated at all - it renders under every pipeline');
assert.ok(/syncData\.open/.test(draftHost.attrs),
    'the records form does not check that it is open');
assert.ok(/syncData\.pipeline === p\.id/.test(draftHost.attrs),
    'the records form is not tied to this pipeline, so it opens under all of them');

/*
 * And the card is a container, not four loose elements. Checked for an
 * actual edge: `border: 0` still satisfies a search for "border:", which is
 * how a card with no border at all passed this once.
 */
assert.ok(/\.ss-sync-card \{[^}]*border:\s*[1-9]/.test(css),
    'the card has no border, so nothing groups a pipeline with its buttons');

/*
 * The cards need space between them, or two pipelines meet edge to edge and
 * read as one bordered block with two headings.
 */
const cardList = findAll(tree.root, hasClass('ss-sync-cards'));
assert.strictEqual(cardList.length, 1, 'the card list container is missing');
assert.ok(cardList[0].children.indexOf(card) > -1, 'the card is not inside the card list');
assert.ok(/\.ss-sync-cards \{[^}]*gap:/.test(css),
    'nothing separates one pipeline card from the next');
assert.ok(/\.ss-sync-card \.ss-sync-actions\.is-band \{[^}]*border-top:/.test(css),
    'the footer is not divided from the head, so the card is one undifferentiated block');

/* Left-aligned. Right-aligned wrapping is what produced the ragged group. */
assert.ok(/\.ss-sync-actions\.is-band \{[^}]*justify-content:\s*flex-start/.test(css),
    'the band is right-aligned, so a wrapped line ends somewhere different again');

/*
 * Edit and Remove are pushed away from the sends. They are administration,
 * not part of the sequence that deploys anything.
 */
assert.ok(/\.ss-sync-actions\.is-band \.ss-sync-act\.is-quiet \{[^}]*margin-left:\s*auto/.test(css),
    'the administrative actions sit in the same run as the sends');

/* The rules the table version needed are gone, not left behind to rot. */
assert.ok(!/tr\.ss-sync-pipe/.test(css),
    'the dead row-group rules are still in the stylesheet');

/* ------------------------------------------------------------------ */
/* Nothing is so quiet it reads as disabled                            */
/* ------------------------------------------------------------------ */

/*
 * Remove was set at #94a3b8 on white - light enough to read as a disabled
 * control rather than an available one. Checked as contrast rather than
 * pinned to a hex, so the rule survives a palette change and still refuses
 * anything that disappears into the card.
 */
function contrast(hex) {
    const channel = (v) => {
        const c = parseInt(v, 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const L = 0.2126 * channel(hex.slice(1, 3)) +
              0.7152 * channel(hex.slice(3, 5)) +
              0.0722 * channel(hex.slice(5, 7));
    return (1.0 + 0.05) / (L + 0.05);   /* against white */
}

[['is-quiet', 'Edit'], ['is-danger', 'Remove'],
 ['is-send', 'Send selection'], ['is-check', 'Validate only']].forEach(([rank, name]) => {
    /* The base rule, anchored from .theme-lightning - an unanchored search
     * finds the .is-band modifier above it, which only sets a margin. */
    const rule = css.match(
        new RegExp('\\.theme-lightning \\.ss-sync-act\\.' + rank + ' \\{([^}]*)\\}'));
    assert.ok(rule, rank + ' has no rule to read a colour from');
    /* The `color` property, not `border-color` - an unanchored search finds
     * the border first and measured the wrong value entirely. */
    const colour = rule[1].match(/(?:^|[;{])\s*color:\s*(#[0-9a-fA-F]{6})/);
    assert.ok(colour, rank + ' declares no colour of its own');
    const ratio = contrast(colour[1]);
    assert.ok(ratio >= 4.5,
        name + ' is drawn at ' + colour[1] + ', a contrast of ' + ratio.toFixed(2) +
        ':1 on white - light enough to read as a disabled control');
});


/*
 * And none of them is a block of colour.
 *
 * Three solid blue buttons in a row outweighed the pipeline mapping above
 * them, which is the thing to read before pressing any of them - and on a
 * page where no button deploys anything on its own, that much emphasis was
 * claiming an urgency the controls do not have.
 */
['is-send', 'is-check'].forEach((rank) => {
    const rule = css.match(
        new RegExp('\\.theme-lightning \\.ss-sync-act\\.' + rank + ' \\{([^}]*)\\}'));
    assert.ok(rule, rank + ' has no rule of its own');
    assert.ok(!/color:\s*#f{3,6}\b/i.test(rule[1]),
        rank + ' uses white text, so it is a filled block of colour again');
    const background = rule[1].match(/background:\s*([^;]+)/);
    if (background) {
        assert.ok(!/#1d4ed8|#1e40af|#2563eb/i.test(background[1]),
            rank + ' is filled with a saturated blue rather than tinted');
    }
});



/* ------------------------------------------------------------------ */
/* Job history, as a grid of tiles                                     */
/* ------------------------------------------------------------------ */

/*
 * Three lists - waiting, succeeded, failed - and three separate copies of
 * the same markup, which is the shape that produced a half-applied edit on
 * this page before. Every rule is counted across all three.
 */
const grids = findAll(tree.root, hasClass('ss-job-tiles'));
assert.strictEqual(grids.length, 3,
    'expected a tile grid for each of the three job lists, found ' + grids.length);

const tiles = findAll(tree.root, hasClass('ss-job-tile'));
assert.strictEqual(tiles.length, 3, 'expected one tile template per list');

/* No table markup left behind. A half-converted list is the failure mode. */
assert.ok(!/<t[dr][\s>]/.test(template),
    'the job lists still contain table cells, so one of the three was not converted');
assert.ok(!/ng-repeat-(start|end)/.test(template),
    'a split repeat survives somewhere in this template - the construct that has ' +
    'produced the same scope bug on this page four times');

tiles.forEach((tile, i) => {
    const which = 'job list ' + (i + 1) + ': ';

    /* One element per job. */
    assert.ok(/ng-repeat="job in sync\.pages\.\w+\.items"/.test(tile.attrs),
        which + 'the tile is not the repeated element');

    /* Its title, its actions, and its detail all live inside it. */
    assert.strictEqual(findAll(tile, hasClass('ss-sync-job')).length, 1,
        which + 'the tile has no title button');
    assert.strictEqual(findAll(tile, hasClass('ss-sync-actions')).length, 1,
        which + 'the actions are not inside the tile they act on');
    assert.strictEqual(findAll(tile, hasClass('ss-job-tile-detail')).length, 1,
        which + 'the expanded detail is not inside its own tile');

    /* The footer is the footer: actions after the text, not before it. */
    const classes = tile.children.map((c) => (c.attrs.match(/class="([^"]*)"/) || [, ''])[1]);
    assert.ok(classes.findIndex((c) => /ss-sync-job\b/.test(c)) <
              classes.findIndex((c) => /ss-sync-actions/.test(c)),
        which + 'the actions are drawn above the job they act on');

    /*
     * And the tile marks itself open. Without it the detail renders inside a
     * single grid column, where the component chips and the SOQL query are
     * unreadable - which would make expanding a job worse than the row it
     * replaced.
     */
    assert.ok(/ng-class="\{\\?'is-open\\?':\s*syncIsOpen\(job\)\}"/.test(tile.attrs),
        which + 'the tile does not mark itself open, so an expanded job stays ' +
        'crushed into one column');
});

/* ---- and the CSS that makes it a grid ----------------------------- */

assert.ok(/\.ss-job-tiles \{[^}]*display:\s*grid/.test(css),
    'the tiles are not laid out as a grid, so a wide screen gets one column ' +
    'and none of the height back');
assert.ok(/\.ss-job-tiles \{[^}]*repeat\(auto-fill, minmax\(/.test(css),
    'the grid has a fixed column count rather than fitting the width available');

/*
 * The open tile spans every column. Anything less and the detail is rendered
 * at one column's width.
 */
assert.ok(/\.ss-job-tile\.is-open \{[^}]*grid-column:\s*1 \/ -1/.test(css),
    'an expanded job does not span the grid, so its detail is unreadable');

/*
 * The footer is pushed down rather than offset by a fixed amount, so tiles
 * side by side line their actions up even when one carries an extra
 * explanation - which the validated ones always do.
 */
assert.ok(/\.ss-job-tile \.ss-sync-actions\.is-foot \{[^}]*margin-top:\s*auto/.test(css),
    'the tile footers are not pinned to the bottom, so actions sit at a ' +
    'different height in every tile of a row');

/*
 * Nothing may push a tile wider than its track. An org hostname is long
 * enough to do it on its own, and one overflowing tile stretches the whole
 * grid column.
 */
assert.ok(/\.ss-job-tile \{[^}]*min-width:\s*0/.test(css),
    'the tile has no min-width:0, so a long org hostname blows out its column');
assert.ok(/\.ss-job-tile \.ss-sync-job \{[^}]*min-width:\s*0/.test(css),
    'the title row has no min-width:0, so the org name cannot truncate');


console.log('sync_ui: ok');
