/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Boxes that should fill a tall window, and the surface that never did.
 *
 * The scrolling panels - the news timeline, the package.xml editor - are
 * capped at 460px so they cannot overflow the windowed modal, which is a small
 * box. The cap is written as min(460px, calc(100vh - 300px)), and min() picks
 * the smaller operand: above a 760px viewport the flat 460 always wins and the
 * calc never gets a say. That is deliberate for the modal and wrong for
 * anything that owns the whole screen, so each capped rule needs an override.
 *
 * There were two such surfaces and only one override. The injected panel in
 * full screen is #SimplifiedMainModal.ssFullScreen; simplified.html wraps the
 * same body in .ss-page, with no such id and nothing that ever sets
 * ssFullScreen - so the override could not match it and the standalone page,
 * the one that is full screen by construction, stayed pinned at 460px however
 * tall the window was.
 *
 * The capped rules are found rather than listed, so a third one added later
 * has to answer this too instead of quietly inheriting the bug.
 */

const css = fs.readFileSync('./css/styles.css', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');

// Every surface that owns the whole viewport, and the selector that reaches it.
const FULL_HEIGHT_SURFACES = [
    ['the injected panel in full screen', '#SimplifiedMainModal.ssFullScreen'],
    ['the standalone page', '.ss-page']
];

function main() {

    /* ------------------------------------------------------------------ */
    /* Both surfaces are real                                              */
    /*                                                                     */
    /* A selector for a wrapper that no template renders protects nothing,  */
    /* and reads in the stylesheet exactly like one that works.             */
    /* ------------------------------------------------------------------ */

    assert.ok(/id="SimplifiedMainModal"[^>]*ng-class="\{ssFullScreen: fullScreen\}"/.test(view),
        'the modal wrapper must still carry the ssFullScreen toggle');
    assert.ok(/class="ss-page /.test(view),
        'the standalone page wrapper must still carry .ss-page');

    // And they are genuinely different wrappers - the whole bug was assuming
    // one selector covered both.
    const standaloneTemplate = view.slice(view.indexOf('this.page = '));
    assert.ok(!/SimplifiedMainModal/.test(standaloneTemplate.slice(0, 1200)),
        'the standalone page must not carry the modal id - if it ever does, ' +
        'these overrides need revisiting rather than doubling up');

    /* ------------------------------------------------------------------ */
    /* Every capped box can escape its cap on every full-height surface     */
    /* ------------------------------------------------------------------ */

    /*
     * Any flat cap against the viewport, not just the 460px ones this started
     * with. min() takes the smaller operand, so min(<flat>, calc(100vh - x))
     * is a fixed ceiling on every screen tall enough to matter, whatever the
     * flat number happens to be - the audit trail history box was 340.
     */
    const capped = [...css.matchAll(/([^\n{}]+)\{([^}]*min\(\d+px,\s*calc\(100vh[^}]*)\}/g)]
        .map((match) => ({ selector: match[1].trim(), at: match.index }));

    assert.ok(capped.length >= 3,
        'expected several capped panels, found ' + capped.length +
        ' - an extraction that matches nothing looks exactly like a pass');

    for (const rule of capped) {
        // ".ss-timeline-list" -> the class it caps
        const target = rule.selector.replace(/^[^.]*/, '').trim();
        assert.ok(target.startsWith('.'), 'expected a class selector, got ' + rule.selector);

        for (const [label, surface] of FULL_HEIGHT_SURFACES) {
            const override = new RegExp(
                surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+' +
                target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[,{]');
            const found = override.exec(css);

            const cap = /min\((\d+)px/.exec(css.slice(rule.at, rule.at + 400));
            const size = cap ? cap[1] + 'px' : 'its flat cap';

            assert.ok(found,
                target + ' is capped at ' + size + ' but has no override for ' + label +
                ' (' + surface + ') - on that surface it stays ' + size + ' however tall ' +
                'the window is, leaving empty space under a scrolling box');

            /*
             * Later in the file as well as more specific. Both rules here are
             * single-class versus two-selector, so specificity already decides
             * it - but a cap moved below its own override would silently win
             * and look no different in the source.
             */
            assert.ok(found.index > rule.at,
                'the override for ' + target + ' on ' + label + ' must come after ' +
                'the capped rule, or the cap wins and nothing on screen says why');
        }
    }

    /*
     * And no scroll box sets its own height inline.
     *
     * An inline max-height wins over every rule above without !important, so
     * an element carrying one is outside this check entirely - the stylesheet
     * can be perfectly correct and the box still fixed. The audit trail
     * history box was exactly that: max-height:340px on the element, immune to
     * the cascade and to everything asserted here.
     */
    const templates = view.match(/this\.\w+ = '[\s\S]*?';/g) || [];
    const inlineCaps = [];
    for (const template of templates) {
        for (const hit of template.matchAll(/style="[^"]*max-height:\s*(\d+)px/g)) {
            inlineCaps.push(hit[1] + 'px in ' + (/this\.(\w+) =/.exec(template) || [])[1]);
        }
    }
    assert.deepStrictEqual(inlineCaps, [],
        'these panels fix their height inline, which no stylesheet rule can override ' +
        'and which ignores the viewport entirely - move them to a class: ' +
        inlineCaps.join(', '));

    console.log('full height surfaces test passed (' + capped.length +
        ' capped panels x ' + FULL_HEIGHT_SURFACES.length + ' surfaces, no inline caps)');
}

main();
