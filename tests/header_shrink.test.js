/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * The shrinking header, and why it still flickered.
 *
 * Shrinking hides the title and action rows, so the header loses real height -
 * and that height comes out of the very scroll that caused the shrink. On a
 * page with only a little more content than fits: scroll past the threshold,
 * header shrinks, content no longer overflows, the browser clamps scrollTop
 * to zero, header expands, content overflows again. Several times a second.
 *
 * The guard against that is "only shrink when what is left to scroll is more
 * than the shrink would remove", and it is only as good as its estimate of
 * what the shrink removes. Three things were corrupting that estimate, and
 * every one of them pushed it *downward* - which is the direction that turns
 * the guard off:
 *
 *   - the state was read from $scope.isMainScrolled, which is true on a
 *     non-searchable page where the header never shrinks at all, so a
 *     full-height reading was filed as the shrunk height;
 *   - the flag is set through $applyAsync, so the class lands a digest later
 *     and the same mis-filing happens on searchable pages too;
 *   - the shrink is a 200ms transition and scroll events arrive throughout
 *     it, so most readings are mid-animation and sit between the two real
 *     heights.
 *
 * Driven against the real function with a fake header, because none of this
 * is visible in a reading of the source - the code looked correct, and did.
 */

const ROOT = path.join(__dirname, '..');
const controller = fs.readFileSync(
    path.join(ROOT, 'js/angular/controllers/MenuAndDetailsCtrl.js'), 'utf8');

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

/* A `var NAME = value;` declaration, taken from the controller so the test
 * cannot disagree with the code about what the number is. */
function constant(name) {
    const found = controller.match(new RegExp('var ' + name + ' = ([^;]+);'));
    assert.ok(found, name + ' is no longer declared in the controller');
    return 'var ' + name + ' = ' + found[1].trim() + ';\n';
}

/*
 * The two real heights.
 *
 * Chosen so the difference is NOT the fallback assumption. They were 148 and
 * 58, a difference of exactly 90 - which is ASSUMED_SHRINK, so a change that
 * stopped the shrink being learned at all fell back to 90 and every
 * assertion still passed. A fixture that cannot tell the right answer from
 * the safety net measures nothing.
 */
const EXPANDED = 172;
const SHRUNK = 41;
const FALLBACK = Number(controller.match(/var ASSUMED_SHRINK = (\d+)/)[1]);
assert.notStrictEqual(EXPANDED - SHRUNK, FALLBACK,
    'the fixture delta is the fallback, so learning and not learning look alike');

function panel(options) {
    const settings = options || {};

    /* A header that answers offsetHeight the way the browser would, including
     * mid-transition, and carries the class the template applies. */
    const header = {
        offsetHeight: EXPANDED,
        classList: {
            has: false,
            contains: function (name) { return name === 'is-scrolled' && this.has; }
        }
    };

    /* A clock the test drives, so the 200ms transition can be stepped through
     * without the test taking 200ms to do it. */
    let now = 1000;
    const sandbox = {
        Math: Math,
        Date: { now: () => now },
        document: { querySelector: () => header },
        $scope: {
            isMainScrolled: false,
            selectedMetadata: { isSearchable: settings.searchable !== false }
        }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(
        /*
         * The constants lifted from the source, not written out here.
         *
         * Injected copies made every one of them untestable: the settle
         * window could be cut to nothing in the controller and this harness
         * went on using its own 260, so a mutation that reintroduced the
         * flicker passed.
         */
        constant('SHRINK_AT') + constant('EXPAND_BELOW') +
        constant('ASSUMED_SHRINK') + constant('SHRINK_SETTLE_MS') +
        'var expandedHeight = 0, shrunkHeight = 0, shrunkSince = 0;\n' +
        lift('function headerElement(pane){') + '\n' +
        lift('function headerIsShrunk(header){') + '\n' +
        lift('function shrinkDelta(pane){'), sandbox);

    return {
        tick: (ms) => { now += ms; },
        header: header,
        scope: sandbox.$scope,
        /* One scroll event's worth of measurement. */
        measure: () => vm.runInContext('shrinkDelta(null)', sandbox),
        /* What the header is really doing: the class flips at once, the
         * height eases toward the target over the next few frames. */
        shrink: function () { header.classList.has = true; },
        expand: function () { header.classList.has = false; },
        settleTo: function (height) { header.offsetHeight = height; }
    };
    /* Filled in below - it needs the object above to exist first. */
}

/*
 * The shrink as it actually happens: the class lands, scroll events measure
 * throughout the 200ms transition, and only the ones after it can be
 * believed. A single measurement taken long afterwards is not this - nothing
 * would have observed the transition starting - and writing the test that
 * way is what made it disagree with a correct implementation.
 */
function shrinkFully(p) {
    p.shrink();
    p.measure();            /* the first event after the class lands */
    for (let ms = 16; ms <= 208; ms += 16) { p.tick(16); p.measure(); }
    p.settleTo(SHRUNK);
    p.tick(60);
    p.measure();            /* now past the transition, so this one counts */
}

/* ------------------------------------------------------------------ */
/* The delta is learned, and learned correctly                         */
/* ------------------------------------------------------------------ */

{
    const p = panel();
    p.measure();                    /* expanded, at rest */
    shrinkFully(p);
    const delta = p.measure();
    assert.strictEqual(delta, EXPANDED - SHRUNK,
        'the shrink is not learned from the header at all');
}

/* ------------------------------------------------------------------ */
/* Mid-transition readings must not shrink the estimate                */
/* ------------------------------------------------------------------ */

/*
 * The whole 200ms of it, sampled the way a scroll does. Every intermediate
 * height is a true reading of the element and a false reading of the state,
 * and taking the latest one lands the estimate somewhere in the middle.
 */
{
    const p = panel();
    p.measure();
    p.shrink();

    /*
     * Every reading is either the fallback - nothing learned yet - or the
     * true shrink. Never anything between: a value in between is a partial
     * height taken as final, and that is the reading that switches the
     * anti-flicker guard off.
     *
     * Asserted as membership rather than as a floor, because the fallback is
     * legitimately lower than a shrink larger than it, and a floor would
     * report that as the bug.
     */
    const seen = [];
    [160, 140, 122, 100, 84, 66, 50].forEach((height) => {
        p.settleTo(height);
        p.tick(16);
        seen.push(p.measure());
    });
    p.settleTo(SHRUNK);
    p.tick(200);
    seen.push(p.measure());

    const stray = seen.filter((d) => d !== FALLBACK && d !== EXPANDED - SHRUNK);
    assert.deepStrictEqual(stray, [],
        'a mid-transition reading was taken as the shrunk height: saw ' +
        JSON.stringify(stray) + ' where only ' + FALLBACK + ' (nothing learned ' +
        'yet) or ' + (EXPANDED - SHRUNK) + ' (the real shrink) are legitimate');

    assert.strictEqual(seen[seen.length - 1], EXPANDED - SHRUNK,
        'the shrink is never learned even once the transition has finished');
}

/* Expanding again is a transition too, and must not lower the expanded height. */
{
    const p = panel();
    p.measure();
    shrinkFully(p);

    p.expand();
    [70, 92, 118, 136, EXPANDED].forEach((height) => {
        p.settleTo(height); p.tick(16); p.measure();
    });

    shrinkFully(p);
    assert.strictEqual(p.measure(), EXPANDED - SHRUNK,
        'a mid-expansion reading was taken as the expanded height');
}

/* ------------------------------------------------------------------ */
/* The class is what decides, not the scope flag                       */
/* ------------------------------------------------------------------ */

/*
 * The flag is set through $applyAsync, so between it flipping and the class
 * landing there is at least one scroll event that sees a full-height header
 * while the flag says shrunk.
 */
{
    const p = panel();
    p.measure();

    p.scope.isMainScrolled = true;      /* flag flipped... */
    /* ...class has not landed, header is still full height */
    p.measure();

    shrinkFully(p);
    assert.strictEqual(p.measure(), EXPANDED - SHRUNK,
        'a reading taken between the flag flipping and the class landing was ' +
        'filed as the shrunk height, collapsing the estimate');
}

/* ------------------------------------------------------------------ */
/* A header that cannot shrink is not measured at all                  */
/* ------------------------------------------------------------------ */

/*
 * is-scrolled is applied only when the list is searchable. On any other page
 * the flag still flips with the scroll while the header stays exactly as it
 * was - and the reading it produced was filed against whichever slot the
 * flag happened to name, poisoning the estimate for every page afterwards.
 */
{
    const p = panel({ searchable: false });
    p.scope.isMainScrolled = true;
    assert.strictEqual(p.measure(), 0,
        'a header that cannot shrink still reports a shrink, so the guard ' +
        'withholds the scrolled state on pages where nothing would move');
}

{
    /* And the poisoning itself: measure on a non-searchable page, then go
     * back to a searchable one and check the estimate survived. */
    const p = panel();
    p.measure();
    shrinkFully(p);

    p.scope.selectedMetadata.isSearchable = false;
    p.expand(); p.settleTo(112);        /* a different page's header */
    p.scope.isMainScrolled = true;
    p.measure();

    p.scope.selectedMetadata.isSearchable = true;
    shrinkFully(p);
    assert.strictEqual(p.measure(), EXPANDED - SHRUNK,
        'a measurement taken on a page whose header does not shrink changed the ' +
        'estimate used by one that does');
}

/* ------------------------------------------------------------------ */
/* And it never guesses low                                            */
/* ------------------------------------------------------------------ */

/*
 * Before both states have been seen there is nothing to subtract, and the
 * fallback has to be generous: refusing to shrink costs a little space,
 * guessing low costs the page.
 */
{
    const p = panel();
    assert.strictEqual(p.measure(), FALLBACK,
        'with only one state seen the fallback is not the generous assumption');
}

{
    /* A header that reports nothing - detached, or display:none - must not
     * produce a zero delta that reads as "shrinking is free". */
    const p = panel();
    p.settleTo(0);
    assert.strictEqual(p.measure(), FALLBACK,
        'a header measuring zero was taken as a real reading');
}


/* ------------------------------------------------------------------ */
/* The flag alone is not evidence, however long it is held             */
/* ------------------------------------------------------------------ */

/*
 * The settle window covers the ordinary one-digest lag, so this is the case
 * it does not: a page busy enough that the class takes longer than the
 * window to land. Reading the flag instead of the class files a full-height
 * header as the shrunk one and the estimate collapses to nothing.
 */
{
    const p = panel();
    p.measure();
    p.scope.isMainScrolled = true;      /* flag says shrunk... */
    /* ...and the class never arrives. Scroll throughout. */
    for (let i = 0; i < 40; i += 1) { p.tick(16); p.measure(); }

    assert.strictEqual(p.measure(), FALLBACK,
        'a header that never got the class was measured as though it had, so ' +
        'the estimate is ' + p.measure() + ' instead of the safe assumption');
}

/* ------------------------------------------------------------------ */
/* The settle timer restarts on every shrink                           */
/* ------------------------------------------------------------------ */

/*
 * Left running from the first shrink, the timer is already satisfied when
 * the second one begins - so the very first mid-transition reading of that
 * shrink is believed, which is exactly the reading the timer exists to
 * refuse.
 */
{
    const p = panel();
    p.measure();
    shrinkFully(p);
    assert.strictEqual(p.measure(), EXPANDED - SHRUNK);

    /* Back to the top, then straight down again. */
    p.expand();
    p.settleTo(EXPANDED);
    p.tick(300);
    p.measure();

    p.shrink();
    p.settleTo(138);                    /* one frame into the transition */
    p.tick(16);
    assert.strictEqual(p.measure(), EXPANDED - SHRUNK,
        'the second shrink believed its first mid-transition reading, so the ' +
        'timer is not being restarted when the header shrinks again');
}

/* ------------------------------------------------------------------ */
/* An expansion that is interrupted                                    */
/* ------------------------------------------------------------------ */

/*
 * Scrolling back to the top and down again before the header has finished
 * growing. The tallest reading is the expanded height; the ones on the way
 * up are true readings of a moving element, and taking the latest leaves the
 * estimate short by however far it got.
 */
{
    const p = panel();
    p.measure();
    shrinkFully(p);

    p.expand();
    [70, 92, 104].forEach((height) => { p.settleTo(height); p.tick(16); p.measure(); });
    /* Interrupted here - down again before it reached full height. */
    shrinkFully(p);

    assert.strictEqual(p.measure(), EXPANDED - SHRUNK,
        'an interrupted expansion lowered the expanded height, so the estimate ' +
        'is short by however far the header had got');
}


/*
 * And the mis-filing that does not collapse to the fallback.
 *
 * Navigating to another searchable list whose header is shorter - fewer
 * action buttons - while the scrolled flag is still set from the last page.
 * Reading the flag rather than the class files that shorter full-height
 * header as the shrunk one, and the result is not a safe fallback but a
 * plausible, wrong, far-too-small delta.
 */
{
    const p = panel();
    p.measure();
    shrinkFully(p);
    assert.strictEqual(p.measure(), EXPANDED - SHRUNK);

    /* A different list: header expanded again, and shorter than the last. */
    p.expand();
    p.settleTo(EXPANDED - 30);
    p.scope.isMainScrolled = true;      /* still set from before */
    for (let i = 0; i < 40; i += 1) { p.tick(16); p.measure(); }

    assert.strictEqual(p.measure(), EXPANDED - SHRUNK,
        'a full-height header on a new page was filed as the shrunk height, ' +
        'giving a delta of ' + p.measure() + ' against a real shrink of ' +
        (EXPANDED - SHRUNK));
}


console.log('header_shrink: ok');
