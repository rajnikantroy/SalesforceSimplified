/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * What this org advertises over REST.
 *
 * Asked of the org - GET on the version root - rather than written into this
 * extension. A list in the source would be this extension's idea of
 * Salesforce, drifting a little further from every org with each release, and
 * identical on an org with half of those resources switched off.
 *
 * The answer is a flat object of name to path, and the two things that can go
 * wrong with it are quiet: a non-string entry rendered into the path box as
 * "[object Object]", and the whole list being re-fetched on every visit to a
 * page that is opened often.
 */

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const controller = read('js/angular/controllers/MenuAndDetailsCtrl.js');
const view = read('js/angular/services/ViewService.js');
const directives = read('js/angular/directives.js');

function lift(signature) {
    const at = controller.indexOf(signature);
    assert.ok(at > -1, signature + ' not found - it has been renamed or removed');
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

/* The real functions over a stub org that records what was asked. */
function panel(options) {
    const settings = options || {};
    const asked = [];

    const box = {
        console: console,
        Promise: Promise,
        Object: Object,
        SS_API_VERSION: '67.0',
        /* Absolute, as the real one is: a relative path resolves against the
         * page's own origin, which on a Lightning page is not the API host. */
        ssRestBase: () => 'https://acme.my.salesforce.com/services/data/v67.0',
        $q: { when: (v) => Promise.resolve(v) },
        sfdc: {
            get: (url) => {
                asked.push(url);
                return settings.fails
                    ? Promise.reject(new Error('refused'))
                    : Promise.resolve(settings.answer);
            },
            errorMessage: () => settings.message || null
        },
        $scope: {
            restResources: { loading: false, error: '', list: [] },
            rest: { method: 'POST', path: '/old', body: '{"a":1}' },
            selectedMetadata: settings.page === undefined
                ? { value: 'RestExplorer' } : settings.page
        }
    };
    box.globalThis = box;
    vm.createContext(box);
    /* The baseline is lifted from the source too, so this cannot hold a
     * different idea of what "every org has" than the code does. */
    const baselineDecl = controller.slice(
        controller.indexOf('var REST_BASELINE = ['),
        controller.indexOf('];', controller.indexOf('var REST_BASELINE = [')) + 2);
    assert.ok(baselineDecl.length > 100, 'the baseline list could not be read');

    vm.runInContext(
        baselineDecl + '\n' +
        lift('function baselineResources(){') + '\n' +
        lift('$scope.isRestExplorerPage = function(){') + ';\n' +
        lift('$scope.loadRestResources = function(force){') + ';\n' +
        lift('$scope.useRestResource = function(resource){') + ';', box);

    return {
        scope: box.$scope,
        asked: asked,
        load: (force) => vm.runInContext('$scope.loadRestResources(' +
            (force ? 'true' : '') + ')', box),
        use: (resource) => vm.runInContext(
            '$scope.useRestResource(' + JSON.stringify(resource) + ')', box),
        onPage: () => vm.runInContext('$scope.isRestExplorerPage()', box)
    };
}

const ORG_ANSWER = {
    sobjects: '/services/data/v67.0/sobjects',
    query: '/services/data/v67.0/query',
    limits: '/services/data/v67.0/limits',
    /* Some versions carry a nested object here rather than a path. */
    eclair: { geo: '/services/data/v67.0/eclair' },
    /* And a value that is not a path at all. */
    version: '67.0'
};

async function run() {

    /* -------------------------------------------------------------- */
    /* Read from the org, and only the paths                           */
    /* -------------------------------------------------------------- */

    {
        const p = panel({ answer: ORG_ANSWER });
        await p.load();

assert.deepStrictEqual(Array.from(p.asked),
            ['https://acme.my.salesforce.com/services/data/v67.0/'],
            'the resource list is not read from the org version root, absolutely - ' +
            'a relative path goes to the page\'s own origin, which on a Lightning ' +
            'page is not the API host');

        const names = Array.from(p.scope.restResources.list).map((r) => r.name);

        /* Everything the org named, in order. */
        ['limits', 'query', 'sobjects'].forEach((name) => {
            assert.ok(names.includes(name), 'the org named ' + name + ' and it is missing');
        });
        assert.deepStrictEqual(names, Array.from(names).slice().sort(),
            'the list is not sorted - got ' + JSON.stringify(names));
        assert.strictEqual(p.scope.restResources.fromOrg, true,
            'a list read from the org is not marked as such');

        /*
         * And the baseline for what the version root omits. It does not
         * advertise every callable resource - Bulk ingest and the tooling
         * sobjects are two it leaves out on most orgs - so a list built only
         * from it is shorter than what the org will actually answer.
         */
        assert.ok(names.includes('jobs/ingest'),
            'a resource the version root omits was not added from the baseline');

        /* The org's own path wins where both have one: it is the org speaking
         * about itself. */
        const sobjects = Array.from(p.scope.restResources.list)
            .filter((r) => r.name === 'sobjects');
        assert.strictEqual(sobjects.length, 1,
            'the baseline duplicated a resource the org already named');

        /*
         * The nested object and the bare version string are both dropped. A
         * nested one rendered into the path box reads "[object Object]", and
         * "67.0" is not something that can be called.
         */
        assert.ok(!names.includes('eclair'),
            'a nested object was offered as a path, which pastes [object Object]');
        assert.ok(!names.includes('version'),
            'a value that is not a path was offered as one');

        Array.from(p.scope.restResources.list).forEach((r) => {
            assert.strictEqual(r.path.charAt(0), '/', r.name + ' is not a path');
        });
    }

    /* -------------------------------------------------------------- */
    /* Asked once                                                      */
    /* -------------------------------------------------------------- */

    /*
     * The version root does not change while the panel is open, and this page
     * is opened often - a call per visit is a call per visit against the org's
     * API limit, for an answer that was already correct.
     */
    {
        const p = panel({ answer: ORG_ANSWER });
        await p.load();
        await p.load();
        await p.load();
        assert.strictEqual(p.asked.length, 1,
            'the org was asked ' + p.asked.length + ' times for a list that cannot change');

        /* Unless asked again on purpose. */
        await p.load(true);
        assert.strictEqual(p.asked.length, 2, 'a forced reload did not re-ask');
    }

    /* -------------------------------------------------------------- */
    /* A refusal is a message, not an empty list                       */
    /* -------------------------------------------------------------- */

    {
        const p = panel({ fails: true, message: 'REST resources could not be read.' });
        await p.load();
        assert.strictEqual(p.scope.restResources.loading, false,
            'the card is left spinning after a refusal');
        assert.ok(p.scope.restResources.error,
            'a refusal leaves no message, so the card is silently empty');

        /*
         * Still a list. A card explaining that nothing could be read is a card
         * with nothing to click, on a page whose whole purpose is having
         * something to click - and these endpoints exist on every org whether
         * or not the version root could be reached.
         */
        assert.ok(p.scope.restResources.list.length >= 5,
            'a refusal left the card empty rather than falling back to the ' +
            'endpoints every org has');
        assert.strictEqual(p.scope.restResources.fromOrg, false,
            'a fallback list is presented as though it came from the org');

        Array.from(p.scope.restResources.list).forEach((r) => {
            assert.ok(/^\/services\/data\/v[\d.]+\//.test(r.path),
                r.name + ' has a path that is not under the version root: ' + r.path);
        });
    }

    /* And with no message from sfdc, one of its own rather than nothing. */
    {
        const p = panel({ fails: true, message: null });
        await p.load();
        assert.ok(p.scope.restResources.error.length > 10,
            'a refusal with no message from the api layer says nothing at all');
    }

    /* -------------------------------------------------------------- */
    /* Clicking one fills the box                                      */
    /* -------------------------------------------------------------- */

    {
        const p = panel({ answer: ORG_ANSWER });
        p.use({ name: 'sobjects', path: '/services/data/v67.0/sobjects' });

        assert.strictEqual(p.scope.rest.path, '/services/data/v67.0/sobjects',
            'the path is not put in the box');

        /*
         * GET and no body. Every one of these is a collection or a
         * description, and carrying the method and payload over from whatever
         * was tried last would post the previous call's data to this one's
         * endpoint - the same reasoning the sample chips already use.
         */
        assert.strictEqual(p.scope.rest.method, 'GET',
            'the previous method was left in place, so a resource can be POSTed to');
        assert.strictEqual(p.scope.rest.body, '',
            'the previous body was left in place, so it would be sent to this endpoint');
    }

    /* Nothing usable is a no-op rather than a cleared box. */
    {
        const p = panel({ answer: ORG_ANSWER });
        p.use(null);
        p.use({ name: 'broken' });
        assert.strictEqual(p.scope.rest.path, '/old',
            'a resource with no path cleared the box anyway');
    }

    /* -------------------------------------------------------------- */
    /* Only on its own page                                            */
    /* -------------------------------------------------------------- */

    assert.strictEqual(panel({ answer: ORG_ANSWER }).onPage(), true);
    assert.strictEqual(panel({ answer: ORG_ANSWER, page: { value: 'ApexClass' } }).onPage(), false);
    assert.strictEqual(panel({ answer: ORG_ANSWER, page: null }).onPage(), false);

    /*
     * And not on a page whose value is undefined. There is no
     * $scope.restexplorer alias - audittrail has one and this does not - so a
     * comparison against it is a comparison against undefined, which matches
     * exactly that case.
     */
    assert.strictEqual(panel({ answer: ORG_ANSWER, page: {} }).onPage(), false,
        'a page with no value is treated as the REST Explorer');

    /* -------------------------------------------------------------- */
    /* Wired into the rail                                             */
    /* -------------------------------------------------------------- */

    const card = view.slice(view.indexOf('this.restresources'), view.indexOf('this.searchdata'));
    assert.ok(card.length > 400, 'the card template could not be read');

    assert.ok(/ng-show="isRestExplorerPage\(\)"/.test(card),
        'the card is not gated to its own page, so it shows up beside everything');
    assert.ok(/ng-click="useRestResource\(resource\)"/.test(card),
        'the rows do nothing when clicked');
    assert.ok(/ng-show="restResources.list.length"> \(\{\{restResources.list.length\}\}\)/.test(card),
        'the count is shown before the list has loaded, so it reads "(0)" while ' +
        'the org is still being asked');
    assert.ok(/is-filtering[\s\S]{0,80}rest\.path === resource\.path/.test(card),
        'the row currently in the box is not marked');

    /* The rail has to be shown on that page at all - the REST Explorer is a
     * Settings page, which hasRightSidebar excludes. */
    assert.ok(/isAuditTrailPage\(\) \|\| isRestExplorerPage\(\)\) && hasSession/.test(view),
        'the right rail is not shown on the REST Explorer, so the card renders nowhere');
    assert.ok(/<restresources><\/restresources>/.test(view),
        'the card is never placed in the rail');
    assert.ok(/restresources: 'restresources'/.test(directives),
        'the directive is not registered, so the element renders as an empty tag');

    /* And the bindings exist. */
    ['isRestExplorerPage', 'loadRestResources', 'useRestResource'].forEach((name) => {
        assert.ok(new RegExp('\\$scope\\.' + name + ' = function').test(controller),
            name + ' is not on the scope');
    });

    /* Loaded when the page opens, or the card is empty until something else
     * happens to ask. */
    assert.ok(/data\.value === 'RestExplorer'\)\{[\s\S]{0,300}loadRestResources\(\)/.test(controller),
        'nothing loads the list when the REST Explorer is opened');

    /* -------------------------------------------------------------- */
    /* The note says which list this is                                */
    /* -------------------------------------------------------------- */

    /*
     * A fallback list that claims to have come from the org is worse than no
     * list: it is a confident, wrong answer to "what does this org offer".
     */
    assert.ok(/ng-show="restResources.fromOrg"/.test(card),
        'nothing distinguishes the org\'s own list from the fallback');
    assert.ok(/ng-show="!restResources.fromOrg"/.test(card),
        'the fallback is not labelled as the fallback');

    /* The error sits beside the list rather than instead of it. */
    assert.ok(card.indexOf('restResources.error') < card.indexOf('ng-repeat="resource in'),
        'the message replaces the list rather than annotating it');
    assert.ok(!/ng-show="!restResources.loading && !restResources.error && !restResources.list.length"/
        .test(card),
        'the empty-state is still gated on there being no error, so with a ' +
        'fallback list present it can never be right');

    /* -------------------------------------------------------------- */
    /* Following the paths a response mentions                         */
    /* -------------------------------------------------------------- */

    /*
     * Most answers here are indexes - a resource root returns paths to its
     * children - and reading one only to retype part of it into the box above
     * is the loop this page exists to remove.
     */
    function explorer(current) {
        const box = {
            console: console, Object: Object, RegExp: RegExp, String: String,
            $scope: { rest: { method: 'POST', path: current || '/here',
                              body: '{"a":1}', response: '', links: [] } }
        };
        box.globalThis = box;
        vm.createContext(box);

        /* Both ceilings, lifted rather than written here: how many are
         * collected, and how many of those render at once. */
        const maxDecl = controller.slice(
            controller.indexOf('var REST_LINK_MAX = '),
            controller.indexOf(';', controller.indexOf('var REST_LINK_MAX = ')) + 1);
        const shownDecl = controller.slice(
            controller.indexOf('$scope.restLinkShown = '),
            controller.indexOf(';', controller.indexOf('$scope.restLinkShown = ')) + 1);
        assert.ok(/\d/.test(maxDecl) && /\d/.test(shownDecl),
            'the link ceilings could not be read');

        vm.runInContext(
            maxDecl + '\n' + shownDecl + '\n' +
            lift('function restLinkLabel(path){') + '\n' +
            lift('function restLinksIn(text){') + '\n' +
            lift('$scope.restLinksMatching = function(){') + ';\n' +
            lift('$scope.restLinksOverflow = function(){') + ';\n' +
            lift('$scope.followRestLink = function(link){') + ';', box);

        return {
            scope: box.$scope,
            linksIn: (text) => vm.runInContext(
                'restLinksIn(' + JSON.stringify(text) + ')', box),
            follow: (link) => vm.runInContext(
                '$scope.followRestLink(' + JSON.stringify(link) + ')', box),
            matching: () => vm.runInContext('$scope.restLinksMatching()', box),
            overflow: () => vm.runInContext('$scope.restLinksOverflow()', box),
            max: Number(maxDecl.match(/(\d+)/)[1]),
            shown: Number(shownDecl.match(/(\d+)/)[1])
        };
    }

    /* The response from the report, verbatim in shape. */
    {
        const e = explorer('/services/data/v67.0/action-features');
        const links = Array.from(e.linksIn(JSON.stringify({
            enums: '/services/data/v67.0/action-features/enums',
            callback: '/services/data/v67.0/action-features/callback'
        })));

        assert.deepStrictEqual(links.map((l) => l.path), [
            '/services/data/v67.0/action-features/enums',
            '/services/data/v67.0/action-features/callback'
        ], 'the paths in the answer are not offered');

        /*
         * Labelled by the last segment. Whole paths share a long prefix, so a
         * row of them is a row of /services/data/v67.0/ with the part that
         * tells them apart cut off the right edge.
         */
        assert.deepStrictEqual(links.map((l) => l.label), ['enums', 'callback'],
            'the chips are labelled with something other than what distinguishes them');
    }

    /* The path just requested is not somewhere to go next. */
    {
        const e = explorer('/services/data/v67.0/limits');
        const links = Array.from(e.linksIn('{"self":"/services/data/v67.0/limits",' +
                                '"next":"/services/data/v67.0/limits/recordCount"}'));
        assert.deepStrictEqual(links.map((l) => l.path),
            ['/services/data/v67.0/limits/recordCount'],
            'the response offered a link back to the request that produced it');
    }

    /* The same path under two names is one chip, not two. */
    {
        const e = explorer();
        const links = Array.from(e.linksIn('{"a":"/services/data/v67.0/query",' +
                                '"b":"/services/data/v67.0/query"}'));
        assert.strictEqual(links.length, 1, 'a repeated path was offered twice');
    }

    /*
     * Bounded. /sobjects names every object in the org with a url apiece, and
     * a thousand chips is not a choice - it is a wall between the reader and
     * the response underneath.
     */
    {
        const e = explorer();
        const many = {};
        for (let i = 0; i < 300; i += 1) { many['o' + i] = '/services/data/v67.0/sobjects/O' + i; }
        e.scope.rest.links = e.linksIn(JSON.stringify(many));

        /*
         * All of them are kept. Stopping at the row's width was the version
         * that looked tidy and lied: somebody scanning for a path that is
         * genuinely in the answer would conclude it is not there.
         */
        assert.strictEqual(e.scope.rest.links.length, 300,
            'paths past the row width were dropped rather than kept behind a filter');
        assert.ok(!e.scope.rest.links.truncated,
            'a list well under the collection ceiling was marked truncated');

        /* And the row admits what it is not showing. */
        assert.strictEqual(e.matching(), 300);
        assert.strictEqual(e.overflow(), true,
            'the row does not know it is showing less than it has');

        /* The filter is what reaches the rest, and it matches on the whole
         * path - two children of different parents can share a last segment. */
        e.scope.rest.linkFilter = 'O25';
        const narrowed = e.matching();
        assert.ok(narrowed > 0 && narrowed < 300,
            'filtering did not narrow the row: ' + narrowed + ' of 300');
        assert.ok(narrowed <= e.shown,
            'a filter that narrows below the row width still reports an overflow');
        assert.strictEqual(e.overflow(), false);

        e.scope.rest.linkFilter = 'no-such-path';
        assert.strictEqual(e.matching(), 0, 'a filter matching nothing still counts rows');
    }

    /*
     * Past the collection ceiling it says so. A body with more paths than
     * this is rare, and the reader should know the row is a sample of it.
     */
    {
        const e = explorer();
        const huge = {};
        for (let i = 0; i < e.max + 200; i += 1) {
            huge['o' + i] = '/services/data/v67.0/sobjects/O' + i;
        }
        const links = e.linksIn(JSON.stringify(huge));
        assert.strictEqual(links.length, e.max,
            'the collection ceiling is not applied at all');
        assert.strictEqual(links.truncated, true,
            'a body past the ceiling is silently cut, so the row claims to be ' +
            'the whole of what the answer mentioned');
    }

    /*
     * Read off the text, not a parsed object: a refusal is shown here too and
     * is not always JSON, and a body that would not parse is exactly when a
     * path in it is worth being able to click.
     */
    {
        const e = explorer();
        const links = Array.from(e.linksIn('Not JSON at all, but it mentions ' +
                                '"/services/data/v67.0/limits" anyway'));
        assert.deepStrictEqual(links.map((l) => l.path), ['/services/data/v67.0/limits'],
            'a path in a body that is not JSON is not offered');
    }

    /* Nothing to follow is an empty row, not a throw. */
    {
        const e = explorer();
        assert.deepStrictEqual(Array.from(e.linksIn('')), []);
        assert.deepStrictEqual(Array.from(e.linksIn('{"count": 4}')), []);
        assert.deepStrictEqual(Array.from(e.linksIn(null)), []);
    }

    /* Following one fills the box as a fresh GET. */
    {
        const e = explorer();
        e.follow({ path: '/services/data/v67.0/limits' });
        assert.strictEqual(e.scope.rest.path, '/services/data/v67.0/limits');
        assert.strictEqual(e.scope.rest.method, 'GET',
            'the previous method was kept, so a link can be POSTed to');
        assert.strictEqual(e.scope.rest.body, '',
            'the previous body was kept, so it would be sent to a path that was ' +
            'only mentioned');

        e.follow(null);
        e.follow({});
        assert.strictEqual(e.scope.rest.path, '/services/data/v67.0/limits',
            'a link with no path cleared the box anyway');
    }

    /* -------------------------------------------------------------- */
    /* Computed once, and rendered                                     */
    /* -------------------------------------------------------------- */

    /*
     * Held on the scope rather than computed in the binding. A function in an
     * ng-repeat returns a fresh array every digest and never settles - the
     * infinite-digest this codebase has hit more than once.
     */
    assert.ok(/\$scope\.rest\.links = restLinksIn\(/.test(controller),
        'the links are not worked out when the answer arrives');

    /*
     * And the filter goes with them. Left from the last answer it hides paths
     * in this one - and the box it was typed into may be scrolled out of
     * sight above, so the row simply looks short.
     */
    assert.ok(/\$scope\.rest\.links = restLinksIn\([\s\S]{0,320}\$scope\.rest\.linkFilter = ''/
        .test(controller),
        'a filter from the previous answer is left in place, hiding paths in the new one');
    assert.ok(!/ng-repeat="link in restLinks\(/.test(view),
        'the link row repeats over a function call, which never settles');
/*
 * Over the held list, filtered and capped by Angular's own filters. Those
 * return the same item references, which ngRepeat compares by identity - a
 * custom function returning fresh objects is what never settles, and is why
 * the list is computed once when the answer arrives rather than in here.
 */
assert.ok(/ng-repeat="link in rest\.links \| filter:\{path: rest\.linkFilter\} \| limitTo:restLinkShown/
        .test(view),
    'the link row does not repeat over the held list, filtered and capped');

/* Filtered on the path rather than the label: two children of different
 * parents can share a last segment, and the prefix is what separates them. */
assert.ok(/filter:\{path: rest\.linkFilter\}/.test(view),
    'the filter matches on the label, so two paths with the same last segment ' +
    'cannot be told apart');

/* The row says what the cap hid, and offers the way to reach it. */
assert.ok(/restLinksOverflow\(\)/.test(view) && /restLinksMatching\(\) - restLinkShown/.test(view),
    'the row does not say how many it is not showing');
assert.ok(/ng-model="rest\.linkFilter"/.test(view),
    'there is no way to narrow a row that is showing less than it has');
assert.ok(/ng-show="rest\.links\.length > restLinkShown"/.test(view),
    'the filter box is shown even when everything already fits');
assert.ok(/rest\.links\.truncated/.test(view),
    'a response past the collection ceiling does not say so');
    assert.ok(/ng-click="followRestLink\(link\)"/.test(view),
        'the chips do nothing when clicked');

    /* And cleared with the response, or the last answer's links outlive it. */
    const send = controller.slice(controller.indexOf('$scope.sendRest = function'),
                                  controller.indexOf('$scope.copyRestResponse'));
    assert.ok((send.match(/rest\.links = \[\]/g) || []).length >= 3,
        'the links are not cleared on every path that clears the response, so a ' +
        'previous answer\'s links sit under a new one');

    console.log('rest_resources: ok');
}

run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
