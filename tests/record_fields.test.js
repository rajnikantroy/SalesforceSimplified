/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * All Fields - the parts that decide what is written.
 *
 * The DOM half of this module cannot be checked here and is not pretended to
 * be: whether an <li> survives an LWC re-render is a question for a real org.
 * What is checked is everything that decides which record is open, which
 * fields may be edited, and what is sent back - because a mistake in any of
 * those writes wrong data to someone's org rather than merely looking wrong.
 */

const source = fs.readFileSync('./js/record-fields.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
const controllerSource = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const viewSource = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');

/*
 * Both files must parse before anything else is asserted about them.
 *
 * Everything below reads them as text, and text assertions pass happily over
 * a file that will not run - a mutation that turned `try {` into `if (true) {`
 * left the `catch` block sitting there for the regex to find while the file
 * was no longer valid JavaScript. background.js failing to parse takes the
 * whole service worker with it.
 */
for (const file of ['./js/record-fields.js', './js/background.js']) {
    try {
        new Function(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        assert.fail(file + ' does not parse: ' + error.message);
    }
}

/* Load the module with the org helpers it expects, and take its exports. */
const relay = { calls: [] };

function load() {
    const win = {};
    const env = {
        window: win,
        document: { readyState: 'loading', addEventListener: () => {} },
        ssIsOrgPage: () => true,
        ssIsStandalonePage: () => false,
        ssRestBase: () => 'https://acme.my.salesforce.com/services/data/v60.0',
        ssQueryUrl: () => 'https://acme.my.salesforce.com/services/data/v60.0/query/?q=',
        ssSessionId: () => 'sid',
        readCookie: () => '005xx',
        escapeSoqlLiteral: (v) => String(v).replace(/'/g, "\\'"),
        /*
         * Deliberately absent from this sandbox. A content script cannot make
         * this request - since Chrome 85 its fetch is the page's fetch, so a
         * call to the org from a Lightning page is cross-origin and the
         * browser blocks it with "Failed to fetch". Leaving fetch undefined
         * here means any return to it fails loudly rather than passing.
         */
        chrome: { runtime: { sendMessage: (...args) => relay.calls.push(args), lastError: null } },
        MutationObserver: function () { this.observe = () => {}; }
    };
    new Function(...Object.keys(env), source)(...Object.values(env));
    assert.ok(win.ssAllFields, 'the module must expose its logic');
    return win.ssAllFields;
}

const api = load();

/*
 * `first` appears before `second`, and both appear at all. Written once
 * because the naive form - indexOf(a) < indexOf(b) - silently passes when a is
 * missing, which is the mutation it is meant to catch.
 */
function assertOrder(haystack, first, second, why) {
    const a = haystack.indexOf(first);
    const b = haystack.indexOf(second);
    assert.notStrictEqual(a, -1, 'missing "' + first + '": ' + why);
    assert.notStrictEqual(b, -1, 'missing "' + second + '": ' + why);
    assert.ok(a < b, '"' + first + '" must come before "' + second + '": ' + why);
}

function main() {

    /* ------------------------------------------------------------------ */
    /* Which record is open                                               */
    /* ------------------------------------------------------------------ */

    assert.deepStrictEqual(
        api.parseRecordUrl('/lightning/r/Account/0011x00000AbCdEAAV/view'),
        { objectApiName: 'Account', recordId: '0011x00000AbCdEAAV', surface: 'lightning' },
        'Lightning names the object and the record, so neither is guessed');

    assert.deepStrictEqual(
        api.parseRecordUrl('/lightning/r/npsp__Grant__c/a011x00000AbCdEAAV/view'),
        { objectApiName: 'npsp__Grant__c', recordId: 'a011x00000AbCdEAAV', surface: 'lightning' },
        'a managed custom object is an ordinary case');

    /*
     * These are the same record and not this page. Mounting on them would put
     * an "All Fields" tab over the edit form and over the related-list view.
     */
    for (const path of [
        '/lightning/r/Account/0011x00000AbCdEAAV/edit',
        '/lightning/r/Account/0011x00000AbCdEAAV/related/Contacts/view',
        '/lightning/o/Account/list',
        '/lightning/setup/ObjectManager/home',
        '/lightning/n/My_Tab'
    ]) {
        assert.strictEqual(api.parseRecordUrl(path), null, path + ' is not a record detail page');
    }

    /* Classic: the id is the path, so the object has to come from the prefix. */
    const classic = api.parseRecordUrl('/0011x00000AbCdEAAV');
    assert.strictEqual(classic.surface, 'classic');
    assert.strictEqual(classic.objectApiName, null, 'Classic does not name the object');
    assert.strictEqual(classic.keyPrefix, '001', 'so the key prefix is handed back to resolve it');

    assert.strictEqual(api.parseRecordUrl('/0011x00000AbCdEAAV/e'), null,
        'a trailing segment is something else being done to the record - /e is edit');
    assert.strictEqual(api.parseRecordUrl('/001/o'), null, 'and /001/o is a list view');

    /* 15 and 18 are both real ids; anything else is not one. */
    assert.ok(api.parseRecordUrl('/0011x00000AbCdE'), '15-character ids are ids');
    assert.strictEqual(api.parseRecordUrl('/0011x00000Ab'), null, 'a 12-character path is not');
    assert.strictEqual(api.parseRecordUrl('/home/home.jsp'), null, 'nor a page name');

    /* ------------------------------------------------------------------ */
    /* Which fields may be edited                                          */
    /* ------------------------------------------------------------------ */

    const describe = {
        fields: [
            { name: 'Name', label: 'Account Name', type: 'string', updateable: true, nillable: false, length: 255 },
            { name: 'Id', label: 'Account ID', type: 'id', updateable: false, nillable: false },
            { name: 'CreatedDate', label: 'Created Date', type: 'datetime', updateable: false, nillable: false },
            { name: 'Industry', label: 'Industry', type: 'picklist', updateable: true, nillable: true,
              picklistValues: [{ value: 'Banking', label: 'Banking', active: true },
                               { value: 'Retired', label: 'Retired', active: false }] },
            { name: 'BillingAddress', label: 'Billing Address', type: 'address', updateable: true, nillable: true },
            { name: 'AnnualRevenue', label: 'Annual Revenue', type: 'currency', updateable: true, nillable: true },
            { name: 'SecretScore__c', label: 'Secret Score', type: 'double', updateable: true, nillable: true },
            { name: 'Website', label: 'Website', type: 'url', updateable: true, nillable: true, length: 255 }
        ]
    };
    // SecretScore__c is absent: the retrieve omits fields the user cannot read.
    const record = {
        Name: 'Acme', Id: '0011x', CreatedDate: '2026-01-01T00:00:00.000+0000',
        Industry: null, BillingAddress: { city: 'Leeds' }, AnnualRevenue: 1000,
        // An empty string rather than null - the org does return these, and it
        // is the case where "both blank" and "equal" are not the same test.
        Website: ''
    };

    const model = api.buildFieldModel(describe, record, true);
    const byName = Object.fromEntries(model.map((f) => [f.name, f]));

    assert.strictEqual(model.length, 8, 'every described field is listed, readable or not');
    assert.strictEqual(byName.Name.editable, true, 'an updateable field is editable');
    assert.strictEqual(byName.Id.editable, false, 'a read-only one is not');
    assert.strictEqual(byName.CreatedDate.editable, false, 'nor an audit field');

    /*
     * Compound fields are read-only deliberately: writing one means writing
     * its components, which the describe lists separately and which are
     * editable in their own right. Two ways to edit one thing disagree.
     */
    assert.strictEqual(byName.BillingAddress.editable, false,
        'a compound address is shown but not edited here');

    /*
     * Absent from the retrieve means no field-level read access - which is a
     * different thing from blank, and must never be offered for editing.
     */
    assert.strictEqual(byName.SecretScore__c.readable, false, 'an unreadable field is marked so');
    assert.strictEqual(byName.SecretScore__c.editable, false,
        'and never editable - a save would be refused, and the value shown would be invented');
    assert.strictEqual(byName.Industry.readable, true,
        'while a field that is present and null is readable and simply empty');

    /* Inactive picklist values are not offered. */
    assert.deepStrictEqual(byName.Industry.options, [{ value: 'Banking', label: 'Banking' }],
        'a retired picklist value is not something to newly set');

    /* No edit access on the record: everything is read-only, whatever FLS says. */
    const locked = api.buildFieldModel(describe, record, false);
    assert.ok(locked.every((f) => !f.editable),
        'sharing has the final say - describe answers the object, not this row');

    /* Populated first, then blanks, each alphabetical. */
    const order = model.map((f) => f.label);
    const firstBlank = model.findIndex((f) => api.isBlank(f.value));
    assert.ok(firstBlank > 0, 'populated fields come first - they are what was come for');
    assert.ok(model.slice(0, firstBlank).every((f) => !api.isBlank(f.value)),
        'and nothing blank is mixed in among them: ' + order.join(', '));

    /* ------------------------------------------------------------------ */
    /* What is sent back                                                   */
    /* ------------------------------------------------------------------ */

    /*
     * Only what changed. Sending the whole record would overwrite fields with
     * the values they had when the page opened, undoing anyone else's edits
     * in between.
     */
    assert.deepStrictEqual(
        api.changedPayload(model, { Name: 'Acme Corp' }), { Name: 'Acme Corp' },
        'a changed field is sent');
    assert.deepStrictEqual(
        api.changedPayload(model, { Name: 'Acme' }), {},
        'a field typed back to what it was is not a change');
    assert.deepStrictEqual(
        api.changedPayload(model, {}), {}, 'and nothing touched sends nothing');

    /*
     * Only what the org said could change. One read-only field in the payload
     * fails the whole PATCH, taking the valid edits with it.
     */
    assert.deepStrictEqual(
        api.changedPayload(model, { Id: '0022x', CreatedDate: '2020-01-01', Name: 'New' }),
        { Name: 'New' },
        'read-only fields are dropped rather than sent and refused');
    assert.deepStrictEqual(
        api.changedPayload(model, { SecretScore__c: 5 }), {},
        'and so is a field the user cannot even read');
    assert.deepStrictEqual(
        api.changedPayload(model, { NotAField__c: 'x' }), {},
        'a name that is not on the object is not passed through');

    /*
     * A cleared input is null, not "". Salesforce rejects "" for dates,
     * numbers and references, and stores it for text as something that reads
     * back as null - so the field would be sent again on every save.
     */
    assert.deepStrictEqual(
        api.changedPayload(model, { AnnualRevenue: '' }), { AnnualRevenue: null },
        'clearing a number sends null');
    assert.deepStrictEqual(
        api.changedPayload(model, { Industry: '' }), {},
        'and clearing something already null is not a change at all');

    /*
     * Blank against blank, spelled differently.
     *
     * The org returned '' and the cleared input gives null. They are not ===,
     * so without a blank-versus-blank test this is sent as a change on every
     * save - and the two guards mask each other, so each needs its own case:
     * this one, and the coerce assertions below.
     */
    assert.deepStrictEqual(
        api.changedPayload(model, { Website: '' }), {},
        "clearing a field the org returned as '' is not a change");
    assert.deepStrictEqual(
        api.changedPayload(model, { Website: 'https://acme.example' }),
        { Website: 'https://acme.example' },
        'but filling it in is');

    /*
     * An empty input is null for every type, not only the ones with a parser
     * that happens to reject ''. Salesforce refuses '' for date and reference
     * fields, and for text it stores something that reads back as null - so
     * the field would be sent again on every subsequent save.
     */
    for (const type of ['string', 'textarea', 'date', 'datetime', 'reference', 'url', 'email', 'picklist']) {
        assert.strictEqual(api.coerce('', type), null,
            "an empty " + type + " input must be sent as null, not ''");
    }

    /* Numbers go as numbers. A quoted number is accepted here and not there. */
    assert.deepStrictEqual(
        api.changedPayload(model, { AnnualRevenue: '2500.50' }), { AnnualRevenue: 2500.5 },
        'a currency arrives from the input as text and must be sent as a number');
    assert.strictEqual(api.coerce('12', 'int'), 12);
    assert.strictEqual(api.coerce('abc', 'int'), null, 'and unparseable is null, not NaN');
    assert.strictEqual(api.coerce('', 'boolean'), false, 'a checkbox is never null');
    assert.strictEqual(api.coerce(['A', 'B'], 'multipicklist'), 'A;B',
        'multi-select goes as the semicolon list the API expects');

    /* ------------------------------------------------------------------ */
    /* Wiring                                                              */
    /* ------------------------------------------------------------------ */

    const script = manifest.content_scripts[0];
    assert.ok(script.js.includes('/js/record-fields.js'), 'the module must be loaded');
    assert.strictEqual(script.js[script.js.length - 1], '/js/bootstrap.js',
        'and must not displace bootstrap.js, which has to stay last');
    assert.ok(script.js.indexOf('/js/ss-core.js') < script.js.indexOf('/js/record-fields.js'),
        'it uses ssRestBase and ssSessionId, so ss-core must load first');
    assert.ok(script.css.includes('/css/record-fields.css'), 'and its styles');

    /*
     * This stylesheet is injected into somebody else's application. A bare
     * element selector restyles their page.
     */
    const css = fs.readFileSync('./css/record-fields.css', 'utf8');
    /*
     * At-rule preludes are not selectors. An @media wrapper is picked up by
     * this pattern as though it were one, and reported as a rule leaking into
     * the record page - which is a failure about the matcher, not the styles.
     */
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)]
        .flatMap((m) => m[1].split(',').map((s) => s.trim()))
        .filter(Boolean)
        .filter((s) => !s.startsWith('@'));
    assert.ok(selectors.length > 5, 'expected a stylesheet, found ' + selectors.length + ' rules');
    selectors.forEach((selector) => {
        assert.ok(/^\.ssaf-|^\.ss-allfields-tab/.test(selector),
            'every rule must start from our own class, or it leaks into the record page: ' + selector);
    });

    /*
     * The tab must not claim to be one of theirs. Checked against the code
     * with comments stripped - the comment explaining why we do not set these
     * mentions them, and matched the first version of this assertion.
     */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    /*
     * Never set on our element. Reading it is fine and now necessary - it is
     * how the record's own tab bar is told from the App Builder's - so this
     * asks about setting rather than about the string appearing at all.
     */
    assert.ok(!/setAttribute\(\s*'data-tab-value'/.test(code),
        'our element must not carry data-tab-value - their controller reads it to ' +
        'pick a panel, and would try to activate one that does not exist');
    assert.ok(!/setAttribute\(\s*'aria-selected'/.test(code),
        'nor aria-selected, for the same reason');
    assert.ok(/querySelectorAll\('\[data-tab-value\]'\)/.test(code),
        'though it is read, to identify whose tab bar this is');
    /*
     * Our tab and theirs are alternatives. Ours is no longer inside their
     * markup, so there is no handler of theirs to escape - what matters now is
     * the other direction: clicking a real tab must put our panel away, or it
     * hangs over whatever they switched to.
     */
    assert.ok(/closest\('\.slds-tabs_default__link'\)[\s\S]{0,60}closePanel\(\)/.test(code),
        'clicking one of their tabs closes our panel');

    /* ------------------------------------------------------------------ */
    /* Nothing of ours goes inside their tab list                          */
    /*                                                                     */
    /* The first version inserted an <li> into ul.slds-tabs_default__nav.  */
    /* Their component walks that list's children on every render and      */
    /* indexes them against its own array of tabs, so one extra child ran  */
    /* the last lookup off the end:                                        */
    /*                                                                     */
    /*   TypeError: Cannot read properties of undefined (reading 'linkId') */
    /*     at B._synchronizeA11y / at B.renderedCallback                   */
    /*                                                                     */
    /* and the whole record page became a component error. First or last   */
    /* makes no difference; it is the count that breaks it.                */
    /* ------------------------------------------------------------------ */

    /*
     * A sibling of the list, never a child of it.
     *
     * Their components index the <li> children *inside* that list - that is
     * what an <li> of ours broke. A sibling is invisible to that walk, and
     * flows in the row so it cannot land on top of anything.
     */
    const mountBody = /function mountTab\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/list\.parentNode\.insertBefore\(button, list\)/.test(mountBody),
        'the button goes immediately before their list, in the list\'s parent');
    assert.ok(!/list\.appendChild|list\.insertBefore\(button, list\.firstChild\)/.test(mountBody),
        'and never inside the list itself');
    assert.ok(!/createElement\('li'\)/.test(code),
        'nothing of ours is an <li> - that is the shape their controllers count');
    assert.ok(!/slds-tabs_default__item|slds-button-group-list'/.test(code.replace(/querySelector[^\n]*/g, '')),
        'and nothing of ours wears their list classes');

    /*
     * Re-inserted only when it has moved. mountTab runs on every mutation, and
     * re-inserting unconditionally would fight the page for the session -
     * every insert is itself a mutation.
     */
    assert.ok(/if \(list\.previousSibling === button\) \{ return; \}/.test(mountBody),
        'an already-placed button is left alone');
    assertOrder(mountBody, 'previousSibling === button', 'insertBefore(button, list)',
        'the check comes before the insert');

    /*
     * Only the modal and its backdrop stay on the body.
     *
     * A raw count is the wrong question - the clipboard fallback appends a
     * textarea and removes it in the same breath. What matters is that nothing
     * else is left there.
     */
    const panelFn = /function panelElement\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.strictEqual((panelFn.match(/document\.body\.appendChild/g) || []).length, 2,
        'the panel and its backdrop are mounted together, and only there');

    const mounts = (code.match(/document\.body\.appendChild/g) || []).length;
    const removals = (code.match(/document\.body\.removeChild/g) || []).length;
    assert.strictEqual(mounts - removals, 2,
        'and everything else put on the body is taken off again - ' + mounts +
        ' appended, ' + removals + ' removed');

    const styles = fs.readFileSync('./css/record-fields.css', 'utf8');
    const panelRule = /\.ssaf-panel\s*\{([^}]*)\}/.exec(styles);
    assert.ok(panelRule && /position:\s*fixed/.test(panelRule[1]),
        'the panel is fixed to the viewport, so a re-render behind it cannot ' +
        'move or remove it');

    /*
     * The button is not. It is in their row now, and the browser places it -
     * which is what stopped it landing on the hierarchy icon.
     */
    const tabRule = /\.ss-allfields-tab\s*\{([^}]*)\}/.exec(styles);
    assert.ok(tabRule, 'the button needs a rule');
    assert.ok(!/position:\s*fixed|position:\s*absolute/.test(tabRule[1]),
        'the button flows in the row rather than being positioned over it: ' +
        tabRule[1].trim());
    assert.ok(/display:\s*inline-flex/.test(tabRule[1]),
        'sitting inline beside their controls');

    /*
     * Fixed things go stale when what they are measured against moves. The
     * record page scrolls in an inner container, so the listener has to
     * capture rather than wait for the window.
     */
    /*
     * The panel is still fixed and still has to follow what it hangs from, so
     * the scroll listener stays - but the button no longer needs it.
     */
    assert.ok(/addEventListener\('scroll'[\s\S]{0,80}capture:\s*true/.test(code),
        'the panel follows on scroll, capturing - the record page scrolls an ' +
        'inner container, not the window');




    /* ------------------------------------------------------------------ */
    /* Only on a record page, and only beside the record's own tabs        */
    /*                                                                     */
    /* Two separate faults put the button next to Components/Fields in the  */
    /* Lightning App Builder:                                              */
    /*                                                                     */
    /*   1. apply() only called mountTab on a record page, and mountTab is  */
    /*      what hides the button as well as what places it - so off a      */
    /*      record page nothing hid it and it kept the display and the      */
    /*      coordinates it had on the last one.                            */
    /*                                                                     */
    /*   2. findTabList took the first lightning-tab-bar in the document.   */
    /*      That component is generic: Setup uses it, the App Builder uses  */
    /*      it, modals use it, and a Tabs component on a layout uses it.   */
    /* ------------------------------------------------------------------ */

    const applyBody = /function apply\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/\n\s*mountTab\(\);/.test(applyBody),
        'mountTab runs on every page, not only on record pages - it is what takes ' +
        'the button away as well as what puts it there');
    assert.ok(!/if \(target && target\.objectApiName\) \{ mountTab\(\); \}/.test(applyBody),
        'gating the call is what left the button standing on Setup and the App Builder');

    const mountBody0 = /function mountTab\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/!state\.target \|\| !state\.target\.objectApiName/.test(
        mountBody0.replace(/\s+/g, ' ').replace('state.target && state.target.objectApiName', '!state.target || !state.target.objectApiName')) ||
        /state\.target && state\.target\.objectApiName/.test(mountBody0),
        'whether to show it is decided from the record, not from whether a list exists');
    assert.ok(/removeChild\(button\)/.test(mountBody0),
        'and off a record page the button is taken out of the page, not left ' +
        'standing where it was');

    /*
     * And the lookup must actually use the chooser.
     *
     * Testing chooseTabList in isolation says nothing about whether anything
     * calls it - reverting findTabList to bars[0] left every case below
     * passing while the App Builder bug was back.
     */
    const findBody = /function findTabList\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/chooseTabList\(/.test(findBody),
        'findTabList must ask the chooser which bar belongs to the record');
    assert.ok(!/bars\[0\]/.test(findBody),
        'and must not fall back to the first one on the page: ' + findBody);
    assert.ok(/index === -1 \? null/.test(findBody),
        'no recognisable record tab bar means no tab, not the nearest one');

    /* Which tab bar, given what is on the page. */
    const pick = api.chooseTabList;
    const RECORD = ['detailTab', 'relatedListsTab'];
    const APP_BUILDER = ['components', 'fields'];

    assert.strictEqual(pick([RECORD]), 0, 'a record page has one and it is chosen');
    assert.strictEqual(pick([APP_BUILDER]), -1,
        'the App Builder\'s Components/Fields bar is not a record tab bar - this is ' +
        'the reported case, and the answer is none rather than the first');
    assert.strictEqual(pick([APP_BUILDER, RECORD]), 1,
        'and when both are present the record\'s own is found, whatever the order');
    assert.strictEqual(pick([]), -1, 'no tab bars, nothing to choose');
    assert.strictEqual(pick([[], []]), -1, 'nor bars with no tab values at all');

    /* Chatter-only and Details-only pages are still record pages. */
    for (const values of [['detailTab'], ['relatedListsTab'], ['chatterTab'], ['feedTab']]) {
        assert.strictEqual(pick([values]), 0,
            values[0] + ' alone is enough - not every record page has all of them');
    }

    /*
     * Showing nothing is the safe failure here. A custom tab set that matches
     * none of these loses the button; attaching it to an unrelated bar is what
     * was being complained about.
     */
    assert.strictEqual(pick([['myCustomTab__c']]), -1,
        'an unrecognised tab set gets no button rather than a misplaced one');


    /* ------------------------------------------------------------------ */
    /* The hover says whose button it is                                   */
    /*                                                                     */
    /* It sits in a row of Salesforce's own tabs and is styled to match, so */
    /* there is otherwise nothing on screen saying it came from an          */
    /* extension - which matters both for the curious and for anyone trying */
    /* to work out what to turn off when it misbehaves.                     */
    /* ------------------------------------------------------------------ */

    assert.ok(/By Salesforce Simplified/.test(api.tabTitle()),
        'the attribution is there: ' + api.tabTitle());
    assert.ok(/every field on this record/i.test(api.tabTitle()),
        'alongside what the button does: ' + api.tabTitle());
    assert.ok(!/All Fields/.test(api.tabTitle()),
        'and it does not repeat the label that is already on screen beside it');

    /* Set from the one function, in both places it is set. */
    const titleAssignments = (code.match(/button\.title = /g) || []).length;
    assert.strictEqual(titleAssignments, 1,
        'set once, where the button is built - it no longer changes with the width');
    assert.ok(/button\.title = tabTitle\(\)/.test(code), 'and from tabTitle');

    /*
     * The org-page tooltip suppressor hides a title that only repeats the
     * text it is on. This one never can, so it will always show.
     */
    assert.notStrictEqual(api.tabTitle(), 'All Fields',
        'the title must differ from the label, or the suppressor in ss-core removes it');


    /* ------------------------------------------------------------------ */
    /* It can be switched off                                              */
    /*                                                                     */
    /* On unless turned off: the tab is why the module exists, and a        */
    /* feature that must be found and enabled before it does anything is    */
    /* one most people never see. So anything other than the string        */
    /* 'false' means on - a cookie cleared, corrupted or never written all   */
    /* settle the same way.                                                 */
    /* ------------------------------------------------------------------ */

    {
        const withCookie = (value) => {
            const win = {};
            const env = {
                window: win,
                document: { readyState: 'loading', addEventListener: () => {} },
                ssIsOrgPage: () => true, ssIsStandalonePage: () => false,
                ssRestBase: () => '', ssQueryUrl: () => '', ssSessionId: () => null,
                readCookie: (name) => (name === 'Simplified_AllFieldsTab' ? value : null),
                escapeSoqlLiteral: (v) => v,
                chrome: { runtime: { sendMessage: () => {}, lastError: null } },
                MutationObserver: function () { this.observe = () => {}; }
            };
            new Function(...Object.keys(env), source)(...Object.values(env));
            return win.ssAllFields.allFieldsEnabled();
        };

        assert.strictEqual(withCookie('false'), false, 'off when it says off');
        assert.strictEqual(withCookie('true'), true, 'on when it says on');
        assert.strictEqual(withCookie(null), true, 'and on when it has never been set');
        assert.strictEqual(withCookie(''), true, 'a cleared cookie is not off');
        assert.strictEqual(withCookie('0'), true,
            'nor is anything else that is not the word - only "false" turns it off');
        assert.strictEqual(withCookie(false), true,
            'and a boolean false is not the string "false" - the cookie holds text');
    }

    /* Read on every placement, so the switch acts where it was flicked. */
    const mountBody3 = /function mountTab\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/allFieldsEnabled\(\)/.test(mountBody3),
        'the preference is read when the button is mounted, not once at load - ' +
        'otherwise turning it off does nothing until a reload');
    assertOrder(mountBody3, 'allFieldsEnabled()', 'anchorList()',
        'and decided before any work is done looking for a list to sit beside');
    assert.ok(/if \(state\.open\) \{ state\.open = false; render\(\); \}/.test(mountBody3),
        'switching it off closes an open panel too - it would outlive the button ' +
        'that opened it, with nothing on screen to close it');

    /* The switch itself, and the name it writes. */
    assert.ok(/\$scope\.showAllFieldsTab = readCookie\('Simplified_AllFieldsTab'\) !== 'false';/
        .test(controllerSource),
        'the panel reads the same cookie, the same way round');
    assert.ok(/setSimplifiedCookie\('Simplified_AllFieldsTab'/.test(controllerSource),
        'and writes it through the shared preference writer');
    assert.strictEqual(api.ENABLED_COOKIE, 'Simplified_AllFieldsTab',
        'one name, spelled the same in both files');

    assert.ok(/ng-model="showAllFieldsTab" ng-change="toggleAllFieldsTab\(\)"/.test(viewSource),
        'the checkbox writes on change - a model with no change handler looks like ' +
        'it works and forgets on reload');
    /*
     * In its own section, not among the panel's own filters.
     *
     * Everything else in that card changes what the panel shows. This one
     * changes Salesforce's own record pages, whether or not the panel is
     * open - so the checkbox has to be told apart from "Metadata" and "Data"
     * rather than sat in the same list as them.
     */
    /*
     * Flattened first. These templates are concatenated strings with comments
     * between the pieces, so matching across a join without stripping those
     * finds nothing and reports it as a missing section.
     */
    const flatView = viewSource
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/'\s*\+\s*\n\s*'/g, '');

    const sectionAt = flatView.indexOf('<div class="ss-settings-section">');
    assert.notStrictEqual(sectionAt, -1, 'the setting must live in a section of its own');
    const section = flatView.slice(sectionAt, sectionAt + 700);

    assert.ok(/showAllFieldsTab/.test(section), 'containing this checkbox');
    assert.ok(/On Salesforce pages/.test(section),
        'under a heading naming where these take effect, since none of them are ' +
        'drawn by this panel');
    assert.ok(/every field on the record/i.test(section),
        'with a line saying what it does');

    /*
     * And the row says which surface. The section covers two now - All Fields
     * on a record, Export on a list view - so a heading naming one of them
     * would be wrong about the other.
     */
    const allFieldsRow = section.slice(section.indexOf('showAllFieldsTab'));
    assert.ok(/record pages/.test(allFieldsRow.slice(0, 200)),
        'the All Fields row says it is on record pages');

    /* And no longer sat among the panel's own filters. */
    const featuresAt = flatView.indexOf('<div class="ss-features-group">');
    assert.notStrictEqual(featuresAt, -1, 'the features group must still exist');
    assert.ok(!/showAllFieldsTab/.test(flatView.slice(featuresAt, sectionAt)),
        'the record-page setting is not one of the panel\'s content filters');

    const rule = /\.theme-lightning \.ss-settings-section \{([^}]*)\}/.exec(
        fs.readFileSync('./css/styles.css', 'utf8'));
    assert.ok(rule, 'the section needs a rule, or it is a heading with nothing under it');
    assert.ok(/border-top/.test(rule[1]),
        'ruled off rather than merely spaced - grouping by appearance would say ' +
        'these are the same kind of setting: ' + rule[1].trim());


    /* ------------------------------------------------------------------ */
    /* Which copy is running                                               */
    /*                                                                     */
    /* Chrome keeps the extension it loaded until it is reloaded on         */
    /* chrome://extensions; a page reload re-injects the previous content   */
    /* script, not the one on disk. A message that had already been fixed   */
    /* therefore came back unchanged, and the only way to tell was to       */
    /* recognise the old wording.                                          */
    /* ------------------------------------------------------------------ */

    assert.ok(/^[a-z-]+\/\d+$/.test(api.MODULE_BUILD),
        'the build marker is a name and a number that can be bumped: ' + api.MODULE_BUILD);
    assert.ok(/all-fields/.test(api.moduleStamp()),
        'the stamp carries it: ' + api.moduleStamp());
    assert.ok(/extension/.test(api.moduleStamp()),
        'alongside the extension version, so both halves can be checked');

    /*
     * getManifest is unavailable outside an extension page. It must degrade
     * rather than throw - this is called from a failure path, and a diagnostic
     * that throws replaces the fault being diagnosed.
     */
    assert.ok(/catch \(e\) \{ version = '\?'/.test(code),
        'a missing manifest gives a question mark, not an exception');

    assert.ok(/build: moduleStamp\(\)/.test(code),
        'a failed save reports which build reported it');


    /* Rendered as lines, not as one string, and reachable when long. */
    assert.ok(/panel\.appendChild\(errorBlock\(\)\)/.test(code),
        'the panel draws the block rather than a single note');
    const blockFn = /function errorBlock\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/state\.errorList/.test(blockFn), 'from the list of refusals');
    assert.ok(/\[state\.error\]/.test(blockFn),
        'falling back to the single message when there is no list - an unreachable ' +
        'org has one and no array');
    assert.ok(/ssaf-error-line/.test(blockFn), 'one element per refusal');
    assert.ok(/HTTP ' \+ state\.errorStatus/.test(blockFn), 'with the status beneath them');

    const errStyles = fs.readFileSync('./css/record-fields.css', 'utf8');
    const errRule = /\.ssaf-panel \.ssaf-error \{([^}]*)\}/.exec(errStyles);
    assert.ok(errRule, 'the error box needs a rule');
    assert.ok(/overflow-y:\s*auto/.test(errRule[1]),
        'it scrolls on its own - the panel hides what overflows it: ' + errRule[1].trim());
    assert.ok(/max-height/.test(errRule[1]),
        'and is bounded, or a long message pushes the fields off the screen');
    const lineRule = /\.ssaf-panel \.ssaf-error-line \{([^}]*)\}/.exec(errStyles);
    assert.ok(lineRule && /white-space:\s*pre-wrap/.test(lineRule[1]),
        'line breaks the org wrote survive: ' + (lineRule ? lineRule[1].trim() : 'no rule'));

    /* The raw fallback is no longer cut where a message says what to do. */
    assert.ok(/slice\(0, 2000\)/.test(code),
        'an unparseable body is kept whole enough to be useful - 300 characters cut ' +
        'an Apex addError in half');

    /* ------------------------------------------------------------------ */
    /* A refusal by the org is not a fault in the extension                */
    /*                                                                     */
    /* A validation rule firing is the org being asked and saying no. Logged */
    /* at warn level it also lands in Chrome's extension error list, where   */
    /* it reads as the extension malfunctioning and buries anything that     */
    /* actually is.                                                          */
    /* ------------------------------------------------------------------ */

    const reportFn = /function reportSaveFailure\(payload, error\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/error\.status/.test(reportFn),
        'the two are told apart by whether the org answered at all');

    /* Run it both ways rather than read the branch. */
    const logged = [];
    const runReport = (error) => {
        logged.length = 0;
        new Function('console', 'moduleStamp', 'payload', 'error',
            reportFn + ';reportSaveFailure(payload, error);')(
            { info: (...a) => logged.push(['info', a]), warn: (...a) => logged.push(['warn', a]) },
            () => 'all-fields/test', { Fax: '1' }, error);
        return logged[0];
    };

    const refused = runReport({ status: 400, message: 'error', details: [{ errorCode: 'X' }] });
    assert.strictEqual(refused[0], 'info',
        'a validation rule is reported as information, not as a warning');
    assert.ok(/refused/i.test(refused[1][0]), 'and says the org refused it: ' + refused[1][0]);
    assert.strictEqual(refused[1][1].status, 400, 'keeping the status');
    assert.ok(refused[1][1].payload, 'and the fields that were being written');

    /*
     * Still kept, though. It is the only place the org's raw answer survives,
     * and that is what settles an ambiguous message like the bare "error".
     */
    assert.ok('details' in refused[1][1] && 'raw' in refused[1][1],
        'the raw answer is not thrown away just because it is not a warning');

    const unreachable = runReport({ status: 0, message: 'The extension could not reach it.' });
    assert.strictEqual(unreachable[0], 'warn',
        'a request that never got there is the extension\'s problem and is warned about');
    assert.ok(/could not be sent/i.test(unreachable[1][0]),
        'and says so plainly: ' + unreachable[1][0]);

    assert.strictEqual(runReport({})[0], 'warn', 'no status at all is also ours');
    assert.strictEqual(runReport({ status: 500 })[0], 'info',
        'while an org that answered - even badly - answered');


    /* ------------------------------------------------------------------ */
    /* Beside the record's action buttons                                  */
    /*                                                                     */
    /* Where a record's actions already are, in the empty space to the left */
    /* of New Contact. Nothing of ours goes into that <ul> either: the      */
    /* ribbon owns those <li>s and moves them in and out of "Show more      */
    /* actions" as the width changes, so an extra child is one it did not   */
    /* put there and will either count or discard - the lesson the tab bar  */
    /* taught by replacing the page with a component error.                 */
    /* ------------------------------------------------------------------ */

    const ribbon = api.chooseRibbon;
    assert.strictEqual(ribbon([{ hasList: true, hasRecordProvider: true }]), 0,
        'the record detail ribbon is the one wanted');
    assert.strictEqual(
        ribbon([{ hasList: true, hasRecordProvider: false },
                { hasList: true, hasRecordProvider: true }]), 1,
        'and is preferred over another ribbon that happens to come first');
    assert.strictEqual(ribbon([{ hasList: false, hasRecordProvider: true }]), -1,
        'a ribbon with no button list is nothing to sit beside');
    assert.strictEqual(ribbon([{ hasList: true, hasRecordProvider: false }]), 0,
        'and one without the marker still serves - the page is already known ' +
        'to be a record, and the marker is not in every release');
    assert.strictEqual(ribbon([]), -1, 'no ribbon, no answer');

    /* Wired: ribbon first, tabs second. */
    const anchorBody = /function anchorList\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/findActionRibbon\(\) \|\| findTabList\(\)/.test(anchorBody),
        'the action ribbon is preferred and the tab bar is the fallback, not the ' +
        'other way round: ' + anchorBody);
    const mountBody4 = /function mountTab\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/classList\.toggle\('is-button', !!findActionRibbon\(\)\)/.test(mountBody4),
        'and it is dressed as a button beside buttons, a tab beside tabs');

    /* Nothing is inserted into the ribbon, exactly as with the tab list. */
    assert.ok(!/slds-button-group-list[\s\S]{0,120}(insertBefore|appendChild)/.test(code),
        'nothing of ours is put into their button group');

    const ribbonStyles = fs.readFileSync('./css/record-fields.css', 'utf8');
    const buttonRule = /\.ss-allfields-tab\.is-button \{([^}]*)\}/.exec(ribbonStyles);
    assert.ok(buttonRule, 'the button form needs a rule');
    /*
     * A visible border, not merely the word. `border: 0` satisfies /border/
     * and is exactly the change that makes this read as a link again.
     */
    assert.ok(/border:\s*[1-9]\d*px\s+\w+\s+#[0-9a-f]{3,6}/i.test(buttonRule[1]),
        'a border with a width and a colour: ' + buttonRule[1].trim());
    assert.ok(/background:\s*#[0-9a-f]{3,6}/i.test(buttonRule[1]),
        'and a ground, or it reads as a link among buttons: ' + buttonRule[1].trim());



    /* ------------------------------------------------------------------ */
    /* A modal, with nothing to measure                                    */
    /*                                                                     */
    /* It hung under whatever opened it, which meant measuring that thing,  */
    /* clamping the result into the window and following it on scroll -     */
    /* three pieces of arithmetic that each went wrong in turn when the     */
    /* anchor moved from the tab bar to the action ribbon. Centring it      */
    /* deletes all three.                                                   */
    /* ------------------------------------------------------------------ */

    assert.ok(!/panelPosition|positionPanel/.test(code),
        'no panel geometry survives - the stylesheet centres it');

    const modalStyles = fs.readFileSync('./css/record-fields.css', 'utf8');
    const modalRule = /\.ssaf-panel \{([^}]*)\}/.exec(modalStyles);
    assert.ok(modalRule, 'the panel needs a rule');
    assert.ok(/width:\s*100vw/.test(modalRule[1]) && /height:\s*100vh/.test(modalRule[1]),
        'the whole viewport - a few hundred fields want it: ' + modalRule[1].trim());
    assert.ok(/inset:\s*0/.test(modalRule[1]),
        'pinned to all four edges, so no margin creeps back in from one side');
    assert.ok(!/transform:\s*translate/.test(modalRule[1]),
        'nothing left to centre');
    assert.ok(!/border-radius/.test(modalRule[1]) && !/^\s*border:/m.test(modalRule[1]),
        'and no frame against the screen edge - a rounded corner over a backdrop ' +
        'is a gap, not a frame: ' + modalRule[1].trim());

    /*
     * Columns, not one long list. An Account has a few hundred fields, and at
     * full width a single column of them is a mile of scrolling beside an
     * empty half of the screen.
     */
    const rowsGrid = /\.ssaf-panel \.ssaf-rows \{([^}]*)\}/.exec(modalStyles);
    assert.ok(/display:\s*grid/.test(rowsGrid[1]), 'the field list is a grid');

    /*
     * Two columns, not as many as fit. Three made each value column narrow
     * enough that an 18-character id, a datetime or a description was clipped
     * in the very place it is being read or edited.
     */
    assert.ok(/grid-template-columns:\s*repeat\(2,/.test(rowsGrid[1]),
        'two columns: ' + rowsGrid[1].trim());

    /*
     * minmax(0, 1fr), not 1fr. The latter is minmax(auto, 1fr), so one long
     * unbreakable value pushes its column past its share and skews the row
     * beside it - which is exactly what a Salesforce id or a long URL does.
     */
    assert.ok(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(rowsGrid[1]),
        'with columns that cannot be pushed wider than their share: ' +
        rowsGrid[1].trim());

    assert.ok(/align-content:\s*start/.test(rowsGrid[1]),
        'and a short list stays at the top instead of being spread down the screen');

    /* One column when two would leave neither usable. */
    const narrow = /@media \(max-width: \d+px\) \{\s*\.ssaf-panel \.ssaf-rows \{([^}]*)\}/
        .exec(modalStyles);
    assert.ok(narrow, 'a narrow window must fall back to one column');
    assert.ok(/grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(narrow[1]),
        'to a single column, not to something narrower still: ' + narrow[1].trim());

    const backdropRule = /\.ssaf-backdrop \{([^}]*)\}/.exec(modalStyles);
    assert.ok(backdropRule, 'a modal needs a backdrop, or it floats with no edge');
    assert.ok(/position:\s*fixed/.test(backdropRule[1]) && /inset:\s*0/.test(backdropRule[1]),
        'covering the window: ' + backdropRule[1].trim());

    const panelZ = /z-index:\s*(\d+)/.exec(modalRule[1]);
    const backZ = /z-index:\s*(\d+)/.exec(backdropRule[1]);
    assert.ok(panelZ && backZ && Number(panelZ[1]) > Number(backZ[1]),
        'and behind the panel, not over it');

    /*
     * Shown and hidden with the panel, in the same place.
     *
     * A backdrop that is never shown is a backdrop that never catches a click,
     * and the only symptom is that clicking away stops working - which reads
     * as the close handler being broken rather than the element being absent.
     */
    const renderBody = /function render\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/panel\.style\.display = state\.open \?/.test(renderBody),
        'the panel follows state.open');
    assert.ok(/backdropElement\(\)\.style\.display = state\.open \?/.test(renderBody),
        'and so does the backdrop, from the same flag and the same function');

    /* Ways out. Clicking away is what everyone tries first. */
    assert.ok(/backdrop\.addEventListener\('click', closePanel\)/.test(code),
        'clicking the backdrop closes it');
    assert.ok(/aria-modal/.test(code) && /role', 'dialog'/.test(code),
        'and it announces itself as a dialog');

    /*
     * Escape closes ours and stops. Salesforce listens for it too - on its own
     * modals, console tabs and inline edits - and letting it through after we
     * have handled it closes one of theirs from a press meant for this.
     */
    const escHandler = /addEventListener\('keydown'[\s\S]*?\}, true\);/.exec(code);
    assert.ok(escHandler, 'Escape must close it');
    assert.ok(/if \(!state\.open\) \{ return; \}/.test(escHandler[0]),
        'but only when it is open - otherwise every Escape on the page is ours');
    assert.ok(/stopPropagation/.test(escHandler[0]),
        'and it does not travel on to their handlers');

    /* The rows take what is left, rather than guessing at it. */
    const rowsRule = /\.ssaf-panel \.ssaf-rows \{([^}]*)\}/.exec(modalStyles);
    assert.ok(rowsRule && /flex:\s*1/.test(rowsRule[1]),
        'the field list flexes into the space left by the header and any message ' +
        'above it - a fixed calc() guessed at both: ' + rowsRule[1].trim());
    assert.ok(/min-height:\s*0/.test(rowsRule[1]),
        'with min-height:0, or a flex child refuses to scroll and overflows instead');


    /* ------------------------------------------------------------------ */
    /* Copying the record                                                  */
    /* ------------------------------------------------------------------ */

    const RAW = {
        attributes: { type: 'Account', url: '/services/data/v60.0/sobjects/Account/001' },
        Id: '001', Name: 'Acme', Fax: null,
        Owner: { attributes: { type: 'User' }, Name: 'Mark' },
        Tags: [{ attributes: { type: 'Tag' }, Name: 'a' }]
    };
    const copied = api.recordForCopy(RAW);

    /*
     * attributes is about the request - the type and the REST url of the row -
     * not about the record. Anyone pasting this into a script, a fixture or a
     * ticket would have to delete it.
     */
    assert.ok(!('attributes' in copied), 'the response wrapper is not part of the record');
    assert.ok(!('attributes' in copied.Owner),
        'and nested parents carry their own, so it goes at every level');
    /*
     * And an array is still an array. Without the array branch it falls through
     * to the object path and comes back as {0: {...}} - which still has its
     * attributes stripped, so checking only that passes while the shape is
     * wrong and the JSON no longer matches what the API returns.
     */
    assert.ok(Array.isArray(copied.Tags), 'a child list stays a list');
    assert.strictEqual(copied.Tags.length, 1, 'with its entries');
    assert.ok(!('attributes' in copied.Tags[0]), 'each of them unwrapped too');

    assert.strictEqual(copied.Name, 'Acme', 'the fields survive');
    assert.strictEqual(copied.Fax, null,
        'including the empty ones - a field that is null is a fact about the record');
    assert.strictEqual(copied.Owner.Name, 'Mark', 'and the parent values');

    /* It does not mutate what it was given - the panel is still rendering it. */
    assert.ok('attributes' in RAW, 'the record itself is untouched');

    assert.strictEqual(api.recordForCopy(null), null, 'nothing is nothing');
    assert.strictEqual(api.recordForCopy('x'), 'x', 'and a scalar is itself');

    /*
     * The whole record, not the filtered view. The filter searches field names
     * to find one - a way of looking, not a way of choosing - so copying only
     * what matched would mean typing "bill" to find BillingCity and silently
     * getting a record with three fields in it.
     */
    const copyFn = /function copyRecord\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/recordForCopy\(state\.record\)/.test(copyFn),
        'it copies the record the org sent');
    assert.ok(!/state\.filter|state\.model/.test(copyFn),
        'not the filtered list and not what was rendered: ' + copyFn.slice(0, 200));
    assert.ok(/JSON\.stringify\([^,]+, null, 2\)/.test(copyFn),
        'pretty-printed - it is going somewhere a person will read it');

    /* The record is kept whole when it loads, or there is nothing to copy. */
    const loadBody = /function load\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/state\.record = answer\.record/.test(loadBody),
        'the raw record is kept, not only the rendered model');

    /*
     * The modern clipboard call needs a secure context and a focused document
     * and rejects rather than throwing. Both happen here often enough that a
     * silent failure would be the common case.
     */
    const writeFn = /function writeClipboard\(text\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/navigator\.clipboard/.test(writeFn), 'the modern call is tried first');
    assert.ok(/legacyCopy\(text\)/.test(writeFn),
        'and the old one catches what it drops - a rejection, not only a throw');
    assert.ok(/function \(\) \{ return legacyCopy\(text\); \}/.test(writeFn),
        'including the rejected-promise path, which is the common one');

    const legacyFn = /function legacyCopy\(text\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/position = 'fixed'/.test(legacyFn) && /-9999px/.test(legacyFn),
        'the fallback textarea is off-screen, not hidden - display:none cannot be ' +
        'selected, so it would copy nothing');
    assert.ok(/removeChild\(area\)/.test(legacyFn), 'and is cleaned up');

    /* A failure says so and does not lose the record. */
    assert.ok(/console\.info\('Salesforce Simplified: record JSON'/.test(copyFn),
        'a clipboard that refuses puts the record in the console rather than ' +
        'losing it');

    /* The icon, minimally. */
    assert.ok(/class="ssaf-copy"|ssaf-copy/.test(code), 'there is a copy control');
    assert.ok(/copy\.disabled = !state\.record/.test(code),
        'disabled until there is something to copy - a control that looks ready ' +
        'and does nothing is worse than one that waits');
    assert.ok(/aria-label', 'Copy this record as JSON'/.test(code),
        'and named for anyone who cannot see the mark');

    const copyRule = /\.ssaf-panel \.ssaf-copy \{([^}]*)\}/.exec(
        fs.readFileSync('./css/record-fields.css', 'utf8'));
    assert.ok(copyRule, 'the icon needs a rule');
    assert.ok(/border:\s*0/.test(copyRule[1]) && /background:\s*none/.test(copyRule[1]),
        'minimal - a bordered button there would compete with Save: ' +
        copyRule[1].trim());

    /* ------------------------------------------------------------------ */
    /* A save that worked says so                                          */
    /*                                                                     */
    /* After a save the panel re-reads and redraws with the same values on  */
    /* screen. Without a confirmation there is nothing to tell "saved" from */
    /* "the button did nothing" - and nothing to tell a save of two fields  */
    /* from one that quietly wrote fewer.                                   */
    /* ------------------------------------------------------------------ */

    assert.strictEqual(api.savedMessage(1), 'Saved 1 change.', 'one reads as English');
    assert.strictEqual(api.savedMessage(3), 'Saved 3 changes.', 'and so does three');
    assert.ok(/\d/.test(api.savedMessage(2)),
        'the count is in it - a bare "Saved" cannot be told from a save that ' +
        'wrote fewer fields than were edited');

    const saveFn = /function save\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/noteSaved\(count\)/.test(saveFn),
        'a successful save is confirmed');
    /*
     * Present, then ordered. indexOf returns -1 for something that is not
     * there, and -1 is less than any index - so an ordering test alone passes
     * when the call has been removed entirely.
     */
    assertOrder(saveFn, 'clearSaved()', 'noteSaved(count)',
        'the previous confirmation is cleared on the way in, or it stands over ' +
        'an attempt that has not finished');
    assert.ok(/clearSaved\(\);\s*\n\s*state\.error =/.test(saveFn),
        'a refusal clears it too - a tick above an error is worse than neither');

    /*
     * The confirmation is about the save, and the re-read comes after it. If
     * load() cleared it, it would never be seen.
     */
    const loadFn = /function load\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(!/clearSaved|state\.saved/.test(loadFn),
        'the re-read that follows a save must not wipe the confirmation');
    assert.ok(/state\.error = ''/.test(loadFn), 'though it does clear the error');

    /* It goes on its own, and the timer cannot be left to wipe a later one. */
    const noteFn = /function noteSaved\(count\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/setTimeout/.test(noteFn), 'it clears itself rather than needing dismissal');
    assertOrder(noteFn, 'clearSaved()', 'state.saved =',
        'any timer already running is cancelled first, or it fires later and ' +
        'wipes a confirmation it does not belong to');

    /* Drawn, and distinguishable from a failure. */
    assert.ok(/note\('ssaf-ok', state\.saved\)/.test(code), 'it is rendered');
    const okRule = /\.ssaf-panel \.ssaf-ok \{([^}]*)\}/.exec(
        fs.readFileSync('./css/record-fields.css', 'utf8'));
    assert.ok(okRule, 'with a rule of its own');
    assert.ok(!/#b91c1c|#fef2f2/.test(okRule[1]),
        'and not in the error colours: ' + okRule[1].trim());

    /* Leaving the record drops it with everything else about that record. */
    const applyFn = /function apply\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/clearSaved\(\)/.test(applyFn),
        'moving to another record must not carry the last one\'s confirmation over');

    /* ------------------------------------------------------------------ */
    /* Every call goes through the service worker                          */
    /*                                                                     */
    /* Not indirection for its own sake. A content script's fetch has been  */
    /* the page's fetch since Chrome 85 - the page's origin, none of the    */
    /* extension's host permissions - so a call from a Lightning page to    */
    /* the org's my-domain host is cross-origin. Salesforce sends CORS      */
    /* headers only for origins an admin allowlisted in Setup, so the       */
    /* browser blocked it before it left and the page got "Failed to        */
    /* fetch": no status, no body, nothing to report.                      */
    /* ------------------------------------------------------------------ */

    assert.ok(!/[^.\w]fetch\s*\(/.test(code),
        'the module must not call fetch itself - it cannot reach the org that way');
    assert.ok(/SS_REST_REQUEST/.test(code), 'it asks the service worker instead');

    relay.calls.length = 0;
    api.saveChanges('Account', '0011x00000AbCdEAAV', { Name: 'Acme Corp' });
    assert.strictEqual(relay.calls.length, 1, 'the save is relayed');
    const sent = relay.calls[0][0];
    assert.strictEqual(sent.type, 'SS_REST_REQUEST');
    assert.strictEqual(sent.method, 'PATCH', 'a record update is a PATCH');
    assert.ok(/\/sobjects\/Account\/0011x00000AbCdEAAV$/.test(sent.url),
        'at the record: ' + sent.url);
    assert.deepStrictEqual(sent.body, { Name: 'Acme Corp' }, 'carrying only the change');
    assert.strictEqual(sent.sid, 'sid', 'and the session, which the worker puts in the header');

    /* The relay must not become a way to send a Salesforce session anywhere. */
    const background = fs.readFileSync('./js/background.js', 'utf8');
    const guard = /async function restRequest\(message\) \{[\s\S]*?\n\}/.exec(background);
    assert.ok(guard, 'the relay must exist');
    assert.ok(/Refusing to send a Salesforce session off-org/.test(guard[0]),
        'and refuse any host that is not the org - it forwards the session');
    assert.ok(guard[0].indexOf('Refusing') < guard[0].indexOf('await fetch'),
        'before the request is made, not after');

    const hostCheck = /if \(!\/\(\^\|\\\.\)\(([^/]*)\)\$\/\.test\(host\)\)/.exec(guard[0]);
    assert.ok(hostCheck, 'the check is on the hostname');
    for (const evil of ['evil.com', 'salesforce.com.evil.com', 'notsalesforce.com']) {
        const pattern = new RegExp('(^|\\.)(' + hostCheck[1] + ')$');
        assert.ok(!pattern.test(evil), evil + ' must not pass the host check');
    }
    for (const good of ['acme.my.salesforce.com', 'acme.lightning.force.com']) {
        const pattern = new RegExp('(^|\\.)(' + hostCheck[1] + ')$');
        assert.ok(pattern.test(good), good + ' is the org and must pass');
    }

    /* A PATCH answers 204 with no body; reading it as JSON would throw. */
    assert.ok(/status === 204/.test(background),
        'the relay must not try to read a body from a 204 - that is what a ' +
        'successful save returns');


    /* ------------------------------------------------------------------ */
    /* A failure has to say which failure                                  */
    /*                                                                     */
    /* "Failed to fetch" is what both a CORS block and an unreachable host  */
    /* produce, and it carries no status, no body and no URL. It cost two   */
    /* rounds of guessing; neither layer may pass it up unchanged again.    */
    /* ------------------------------------------------------------------ */

    const relayFn = /async function restRequest\(message\) \{[\s\S]*?\n\}/.exec(background)[0];
    assert.ok(/catch \(error\)/.test(relayFn),
        'the worker must catch its own network failure rather than let it become ' +
        'an unhandled rejection with no context');
    assert.ok(/could not be reached/.test(relayFn) && /host/.test(relayFn),
        'and name the host and method it was attempting');

    /*
     * No receiver is the other one, and it looks nothing like a network
     * failure: a content script updated against a background that was not
     * reloaded. The fix is a specific pair of actions.
     */
    assert.ok(/chrome:\/\/extensions/.test(code),
        'a missing background handler must tell the user to reload the extension - ' +
        '"Could not establish connection" does not');

    /* Run it: no receiver must reject with that, not hang. */
    let noReceiver;
    {
        const win = {};
        const env = {
            window: win,
            document: { readyState: 'loading', addEventListener: () => {} },
            ssIsOrgPage: () => true, ssIsStandalonePage: () => false,
            ssRestBase: () => 'https://acme.my.salesforce.com/services/data/v60.0',
            ssQueryUrl: () => 'https://acme.my.salesforce.com/services/data/v60.0/query/?q=',
            ssSessionId: () => 'sid', readCookie: () => '005xx',
            escapeSoqlLiteral: (v) => v,
            chrome: { runtime: {
                lastError: { message: 'Could not establish connection.' },
                sendMessage: (msg, cb) => cb(undefined)
            } },
            MutationObserver: function () { this.observe = () => {}; }
        };
        new Function(...Object.keys(env), source)(...Object.values(env));
        noReceiver = win.ssAllFields.saveChanges('Account', '0011x00000AbCdEAAV', { Name: 'x' })
            .then(function () {
                throw new Error('a save with no receiver must not resolve');
            }, function (error) {
                assert.ok(/Reload the extension/.test(error.message),
                    'and says how to fix it: ' + error.message);
            });
    }

    /* ------------------------------------------------------------------ */
    /* A refusal has to be readable                                        */
    /*                                                                     */
    /* The org answers refusals in several shapes and only one of them has  */
    /* a `message`. Reading only that turned an expired session into an     */
    /* empty string, and left a real validation-rule message of "error"     */
    /* indistinguishable from a parser that had found nothing.              */
    /* ------------------------------------------------------------------ */

    return noReceiver.then(function () {
        const relayed = { calls: [] };
        const win = {};
        const env = {
            window: win,
            document: { readyState: 'loading', addEventListener: () => {} },
            ssIsOrgPage: () => true, ssIsStandalonePage: () => false,
            ssRestBase: () => 'https://acme.my.salesforce.com/services/data/v60.0',
            ssQueryUrl: () => 'https://acme.my.salesforce.com/services/data/v60.0/query/?q=',
            ssSessionId: () => 'sid', readCookie: () => '005xx',
            escapeSoqlLiteral: (v) => v,
            chrome: { runtime: {
                lastError: null,
                sendMessage: (msg, cb) => cb(relayed.next)
            } },
            MutationObserver: function () { this.observe = () => {}; }
        };
        new Function(...Object.keys(env), source)(...Object.values(env));
        const mod = win.ssAllFields;

        const refuse = (status, body) => {
            relayed.next = { ok: false, status: status, text: JSON.stringify(body) };
            return mod.saveChanges('Account', '0011x00000AbCdEAAV', { Fax: '1' })
                .then(() => { throw new Error('a refusal must not resolve'); },
                      (e) => e);
        };

        return refuse(400, [{
            message: 'error', errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', fields: ['Fax']
        }]).then((error) => {
            /*
             * The exact case that was reported: the org's own message really
             * was the word "error". Useless alone; the code and the field say
             * where it came from.
             */
            assert.ok(/FIELD_CUSTOM_VALIDATION_EXCEPTION/.test(error.message),
                'the error code travels with the message: ' + error.message);
            assert.ok(/\(Fax\)/.test(error.message), 'and the field it is about');
            assert.ok(/HTTP 400/.test(error.message), 'and the status');
            assert.strictEqual(error.status, 400, 'kept on the error for the console');

            /* An expired session has no `message` at all. */
            return refuse(401, { error: 'invalid_session_id', error_description: 'Session expired or invalid' });
        }).then((error) => {
            assert.ok(/Session expired or invalid/.test(error.message),
                'the OAuth-shaped refusal is read too, not reduced to nothing: ' + error.message);
            assert.ok(/invalid_session_id/.test(error.message), 'with its code');

            /* A single unwrapped object, and a body that is not JSON at all. */
            return refuse(403, { message: 'Insufficient access', errorCode: 'INSUFFICIENT_ACCESS' });
        }).then((error) => {
            assert.ok(/Insufficient access \[INSUFFICIENT_ACCESS\]/.test(error.message),
                'an unwrapped single error is read: ' + error.message);

            relayed.next = { ok: false, status: 500, text: '<html>Gateway problem</html>' };
            return mod.saveChanges('Account', '0011x00000AbCdEAAV', { Fax: '1' })
                .then(() => { throw new Error('must not resolve'); }, (e) => e);
        }).then((error) => {
            assert.ok(/Gateway problem/.test(error.message),
                'a body that will not parse is shown rather than replaced by a ' +
                'sentence about it: ' + error.message);
            assert.ok(/HTTP 500/.test(error.message), 'still with the status');
        }).then(() => {
    /* ------------------------------------------------------------------ */
    /* The whole refusal, and all of them                                  */
    /*                                                                     */
    /* One PATCH can break several rules at once. They were joined into a   */
    /* single sentence in a box the panel clips - overflow is hidden on the */
    /* panel and the box sits outside the scrolling rows - so the second    */
    /* message onwards ran off the bottom with no way to reach it.         */
    /* ------------------------------------------------------------------ */

    {
        const relayed2 = {};
        const win = {};
        const env = {
            window: win,
            document: { readyState: 'loading', addEventListener: () => {} },
            ssIsOrgPage: () => true, ssIsStandalonePage: () => false,
            ssRestBase: () => '', ssQueryUrl: () => '', ssSessionId: () => 'sid',
            readCookie: () => null, escapeSoqlLiteral: (v) => v,
            chrome: { runtime: { lastError: null, sendMessage: (m, cb) => cb(relayed2.next),
                                 getManifest: () => ({ version: '0' }) } },
            MutationObserver: function () { this.observe = () => {}; }
        };
        new Function(...Object.keys(env), source)(...Object.values(env));

        relayed2.next = { ok: false, status: 400, text: JSON.stringify([
            { message: 'Fax must be (999) 999-9999.\nSee the Data Standards page.',
              errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', fields: ['Fax'] },
            { message: 'Description cannot mention a competitor.',
              errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', fields: ['Description'] }
        ]) };

        return win.ssAllFields.saveChanges('Account', '001x', { Fax: '1' })
            .then(() => { throw new Error('must not resolve'); }, (error) => {
                assert.ok(Array.isArray(error.messages), 'each refusal is kept separately');
                assert.strictEqual(error.messages.length, 2,
                    'both rules are reported, not just the first');
                assert.ok(/Data Standards/.test(error.messages[0]),
                    'and each in full - the second sentence of a message is often the ' +
                    'part that says what to do: ' + error.messages[0]);
                assert.ok(/\n/.test(error.messages[0]),
                    'line breaks the org wrote are preserved, so pre-wrap can show them');
                assert.ok(/Description cannot mention/.test(error.messages[1]),
                    'the second is not swallowed by the first');
            });
    }

        }).then(() => { console.log('record fields test passed'); });
    });
}

Promise.resolve(main()).catch((e) => { console.error(e); process.exit(1); });
