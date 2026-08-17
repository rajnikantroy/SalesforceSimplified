/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/*
 * Sending what is in hand, from the footer.
 *
 * A selection can be made anywhere - components in one metadata list, records
 * in another - and until now the only way to act on it was to remember it was
 * there and navigate to Org Sync & Jobs. The footer already carried the counts;
 * these are the two acts that go with them.
 *
 * The rules worth holding are about restraint rather than function: each button
 * appears only when it has a subject, neither stages anything on the spot, and
 * they must not look like the counts sitting beside them.
 */

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const view = read('js/angular/services/ViewService.js');
const controller = read('js/angular/controllers/MenuAndDetailsCtrl.js');
const css = read('css/styles.css');

/* The footer only. The panel has buttons of its own all over it, and every
 * check below would otherwise pass against one of those. */
const footerAt = view.indexOf('var SS_PANEL_FOOTER');
assert.ok(footerAt > -1, 'the footer template is gone');
const footer = view.slice(footerAt, view.indexOf('</footer>', footerAt));
assert.ok(footer.length > 500, 'the footer extraction came back too small');

/* ------------------------------------------------------------------ */
/* Both acts are there                                                 */
/* ------------------------------------------------------------------ */

const acts = [
    { label: 'Deploy', gate: 'selectedMetaForPackageXml.size', subject: 'components' },
    { label: 'Migrate', gate: 'selectedDataForDownload.size', subject: 'records' }
];

acts.forEach(({ label, gate, subject }) => {
    const at = footer.indexOf(label + ' ({{');
    assert.ok(at > -1, 'the footer has no ' + label + ' button');

    const opening = footer.lastIndexOf('<button', at);
    const tag = footer.slice(opening, at);

    /*
     * Gated on its own subject. A Deploy button with no components ticked
     * carries nothing, and a control that can only refuse is worse than one
     * that is not offered.
     */
    assert.ok(new RegExp('ng-show="' + gate.replace('.', '\\.') + '"').test(tag),
        label + ' is not gated on the ' + subject + ' being selected: ' + tag);

    /* And the number it shows is the number it is gated on - a count from
     * somewhere else is a button that promises to send the wrong thing. */
    const shown = footer.slice(at, footer.indexOf('</button>', at));
    assert.ok(shown.indexOf('{{' + gate + '}}') > -1,
        label + ' shows a count that is not the selection it acts on');

    /*
     * It opens the page rather than staging. Staging needs a pipeline, there
     * may be several, and picking one from here would be choosing which org
     * to write into on somebody's behalf.
     */
    assert.ok(/ng-click="openSyncJobs\(\)"/.test(tag),
        label + ' does not open Org Sync & Jobs');
    assert.ok(!/syncStage|syncApply|syncOpenData/.test(tag),
        label + ' stages or applies a job straight from the footer, without a ' +
        'pipeline having been chosen');
});

/*
 * The binding has to exist, or both buttons are decoration. This is the
 * failure this codebase has shipped more than any other: a control wired to
 * a scope member that is not there does nothing at all when clicked.
 */
assert.ok(/\$scope\.openSyncJobs = function/.test(controller),
    'openSyncJobs is not on the scope, so the footer buttons do nothing');

/* ------------------------------------------------------------------ */
/* They do not look like the counts beside them                        */
/* ------------------------------------------------------------------ */

/*
 * The chips are counts: a number and a way in. These write to another org.
 * Given the same treatment, "6 package.xml" and "Deploy (6)" read as two of
 * the same thing, and the one with consequences is the one that must not.
 */
acts.forEach(({ label }) => {
    const at = footer.indexOf(label + ' ({{');
    const tag = footer.slice(footer.lastIndexOf('<button', at), at);
    assert.ok(/class="ss-foot-act"/.test(tag),
        label + ' is not marked as an act: ' + tag);
    assert.ok(!/ss-foot-chip/.test(tag),
        label + ' is drawn as a count chip, which is what its neighbours are');
});

assert.ok(/\.ss-foot-act \{[^}]*background:\s*#eff6ff/.test(css),
    'the footer acts have no tint of their own, so they read as chips');
assert.ok(/\.ss-foot-act:hover \{/.test(css),
    'the footer acts do not respond to a pointer, so they do not read as buttons');

/* ------------------------------------------------------------------ */
/* On both surfaces                                                    */
/* ------------------------------------------------------------------ */

/*
 * The footer is one template used by the injected panel and by
 * simplified.html. A selection made on an org page is just as actionable from
 * the standalone one, and vice versa - so this is asserted rather than left
 * to the fact that they happen to share a variable today.
 */
['this.content = ', 'this.page = '].forEach((surface) => {
    const at = view.indexOf(surface);
    assert.ok(at > -1, surface + ' is gone');
    const body = view.slice(at, view.indexOf(';\n', view.indexOf('SS_PANEL_FOOTER', at)));
    assert.ok(/SS_PANEL_FOOTER/.test(body),
        surface.trim() + ' does not include the footer, so the send buttons are ' +
        'missing from that surface');
});

/* ------------------------------------------------------------------ */
/* The counts they act on are the ones the rest of the panel uses      */
/* ------------------------------------------------------------------ */

/*
 * Both gates name state the controller owns. A typo here renders an empty
 * count behind a button that is always hidden, which looks exactly like a
 * feature nobody asked for being quietly absent.
 */
acts.forEach(({ gate }) => {
    const member = gate.split('.')[0];
    assert.ok(new RegExp('\\$scope\\.' + member + '\\s*=').test(controller),
        gate + ' is not a scope member, so the button never appears');
});

console.log('footer_send: ok');
