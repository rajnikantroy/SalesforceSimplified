/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * All Fields - every field on the record, in one place, editable.
 *
 * A Lightning record page shows the fields somebody chose to put on the
 * layout. Everything else on the record - and there is usually far more of it
 * than there is on the layout - is reachable only through Setup, the API, or
 * by editing the layout. This adds a button beside the record actions that
 * lists all of them with their values, and lets them be changed where the org
 * allows it.
 *
 * ---------------------------------------------------------------------------
 * Two rules this module is built around
 * ---------------------------------------------------------------------------
 *
 * 1. It does not join Salesforce's tabset.
 *
 *    One <li> goes into their <ul>; nothing else of ours lives inside a
 *    component they own. The panel is our own element, positioned under the
 *    tab bar. Joining the tabset would mean owning their aria-selected, their
 *    panel container and their re-render - and LWC reclaims all three. Their
 *    tabs keep working exactly as before; clicking one closes our panel.
 *
 * 2. What is editable is the org's answer, never ours.
 *
 *    describe().fields[].updateable already accounts for field-level security
 *    and the object permissions of the running user, and UserRecordAccess
 *    answers the sharing question for this row. A field is offered for editing
 *    only when both say yes. There is no list of "system fields" here: a
 *    hardcoded guess would be wrong for some org, and wrong in the direction
 *    of offering an edit that then fails on save.
 */
(function () {
    'use strict';

    if (typeof ssIsOrgPage === 'function' && !ssIsOrgPage()) { return; }
    if (typeof ssIsStandalonePage === 'function' && ssIsStandalonePage()) { return; }

    /*
     * The switch, in the panel's Features card.
     *
     * On unless it has been turned off: the tab is why the module exists, and
     * a feature that has to be found and enabled before it does anything is
     * one most people never see. Anything other than the string 'false' means
     * on, so a cookie that has been cleared, corrupted or never written all
     * settle the same way.
     */
    /*
     * Which copy of this file is running.
     *
     * Chrome keeps the extension it loaded until it is reloaded on
     * chrome://extensions - a page reload re-injects the *previous* content
     * script, not the one on disk. So a fixed message can reappear unchanged
     * after the fix, and the only way to tell was to recognise the old
     * wording. Stamped on every diagnostic instead: if the build below is not
     * the one being read about, the browser is running something older.
     */
    var MODULE_BUILD = 'all-fields/10';

    function moduleStamp() {
        var version = '';
        try { version = chrome.runtime.getManifest().version; } catch (e) { version = '?'; }
        return MODULE_BUILD + ' (extension ' + version + ')';
    }

    var ENABLED_COOKIE = 'Simplified_AllFieldsTab';

    function allFieldsEnabled() {
        try {
            return typeof readCookie !== 'function' || readCookie(ENABLED_COOKIE) !== 'false';
        } catch (e) {
            return true;
        }
    }

    var PANEL_ID = 'ssAllFieldsPanel';
    var BACKDROP_ID = 'ssAllFieldsBackdrop';
    var TAB_CLASS = 'ss-allfields-tab';
    var TAB_ID = 'ssAllFieldsTab';

    /* ------------------------------------------------------------------ */
    /* Which record                                                        */
    /* ------------------------------------------------------------------ */

    /*
     * Lightning names the object in the URL; Classic does not, and its id is
     * the whole path. The 3-character key prefix identifies the object there,
     * but resolving it costs a describeGlobal - so the caller is handed the
     * prefix and decides.
     *
     * Returned ids are kept exactly as they appear. An 18-character id is the
     * 15-character one plus a checksum, and every API here accepts both, so
     * there is nothing to normalise and a normaliser would only be one more
     * thing that can be wrong.
     */
    function parseRecordUrl(pathname) {
        var path = String(pathname || '');

        // /lightning/r/Account/001.../view - and the "view" is required:
        // /edit and /related/... are the same record but not this page.
        var lightning = /^\/lightning\/r\/([A-Za-z0-9_]+)\/([a-zA-Z0-9]{15,18})\/view\/?$/.exec(path);
        if (lightning) {
            return { objectApiName: lightning[1], recordId: lightning[2], surface: 'lightning' };
        }

        // Older links leave the object out, so the prefix has to answer for it.
        var lightningBare = /^\/lightning\/r\/([a-zA-Z0-9]{15,18})\/view\/?$/.exec(path);
        if (lightningBare) {
            return {
                objectApiName: null, recordId: lightningBare[1],
                keyPrefix: lightningBare[1].slice(0, 3), surface: 'lightning'
            };
        }

        // Classic: the id is the path. A trailing segment means something else
        // is being done to the record - /e is edit, /d is the detail frame.
        var classic = /^\/([a-zA-Z0-9]{15,18})\/?$/.exec(path);
        if (classic) {
            return {
                objectApiName: null, recordId: classic[1],
                keyPrefix: classic[1].slice(0, 3), surface: 'classic'
            };
        }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /* The field list                                                      */
    /* ------------------------------------------------------------------ */

    /*
     * Compound fields are read-only here on purpose.
     *
     * Address and Location arrive as objects, and writing them means writing
     * their components (BillingStreet, BillingCity...) which the describe also
     * lists separately and which are editable in their own right. Offering the
     * compound as well would be two ways to edit one thing, disagreeing.
     */
    var UNEDITABLE_TYPES = { address: 1, location: 1, base64: 1, encryptedstring: 1 };

    function buildFieldModel(describe, record, canEditRecord) {
        var fields = (describe && describe.fields) || [];
        var row = record || {};
        var model = [];

        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            if (!f || !f.name) { continue; }

            /*
             * Absent, not empty. The REST retrieve omits fields the user
             * cannot read, so a name in the describe that is missing from the
             * record is one they have no access to - which is a different
             * thing from a field that is genuinely blank, and saying "empty"
             * would be a lie about the data.
             */
            var readable = Object.prototype.hasOwnProperty.call(row, f.name);

            model.push({
                name: f.name,
                label: f.label || f.name,
                type: f.type,
                value: readable ? row[f.name] : null,
                readable: readable,
                editable: !!(canEditRecord && f.updateable && !UNEDITABLE_TYPES[f.type] && readable),
                required: !f.nillable && !f.defaultedOnCreate && !!f.updateable,
                length: f.length || 0,
                referenceTo: (f.referenceTo && f.referenceTo[0]) || null,
                options: (f.picklistValues || [])
                    .filter(function (p) { return p && p.active; })
                    .map(function (p) { return { value: p.value, label: p.label || p.value }; })
            });
        }

        /*
         * Populated first, then the rest - both alphabetical by label.
         *
         * The list is long (a few hundred on a well-used Account) and its
         * point is to show what is there. Fields with something in them are
         * what somebody came to look at; blanks are the haystack.
         */
        model.sort(function (a, b) {
            var aSet = isBlank(a.value) ? 1 : 0;
            var bSet = isBlank(b.value) ? 1 : 0;
            if (aSet !== bSet) { return aSet - bSet; }
            return a.label.localeCompare(b.label);
        });
        return model;
    }

    /*
     * What a save is confirmed with.
     *
     * The count matters: after a save the panel re-reads and redraws with the
     * same values on screen, so without a number there is nothing to
     * distinguish "saved" from "nothing happened" - which is exactly what a
     * save that silently wrote fewer fields than expected looks like.
     */
    function savedMessage(count) {
        return count === 1 ? 'Saved 1 change.' : 'Saved ' + count + ' changes.';
    }

    /*
     * The record as the org returned it, minus the response wrapper.
     *
     * `attributes` is about the request - the type and the REST url of the row
     * - not about the record. Anyone pasting this into a script, a test
     * fixture or a ticket wants the fields; the wrapper is noise they would
     * have to delete.
     *
     * Nested parent records carry their own, so it is stripped at every level
     * rather than only at the top.
     */
    function recordForCopy(record) {
        if (!record || typeof record !== 'object') { return record; }
        if (Array.isArray(record)) { return record.map(recordForCopy); }

        var copy = {};
        Object.keys(record).forEach(function (key) {
            if (key === 'attributes') { return; }
            copy[key] = recordForCopy(record[key]);
        });
        return copy;
    }

    function isBlank(value) {
        return value === null || value === undefined || value === '';
    }

    /* ------------------------------------------------------------------ */
    /* What to send back                                                   */
    /* ------------------------------------------------------------------ */

    /*
     * Only what changed, and only what the org said could change.
     *
     * Sending the whole record back would overwrite fields with the values
     * they had when the page was opened, silently undoing anything anyone
     * else changed in between. Sending a field the describe called read-only
     * fails the whole PATCH, taking the edits that were valid with it.
     */
    function changedPayload(model, edits) {
        var payload = {};
        var byName = {};
        for (var i = 0; i < model.length; i++) { byName[model[i].name] = model[i]; }

        Object.keys(edits || {}).forEach(function (name) {
            var field = byName[name];
            if (!field || !field.editable) { return; }

            var next = coerce(edits[name], field.type);
            var before = field.value === undefined ? null : field.value;
            if (next === before) { return; }
            // Both blank, spelled differently - '' from a cleared input against
            // a null from the org is not an edit.
            if (isBlank(next) && isBlank(before)) { return; }
            payload[name] = next;
        });
        return payload;
    }

    /*
     * An empty input means null, not "".
     *
     * Salesforce rejects "" for date, number and reference fields, and for a
     * text field it stores an empty string that then reads back as null - so
     * the next comparison sees a change that is not one and the field is sent
     * again on every save.
     */
    function coerce(raw, type) {
        if (type === 'boolean') { return !!raw; }
        if (raw === '' || raw === null || raw === undefined) { return null; }

        if (type === 'int') {
            var whole = parseInt(raw, 10);
            return isNaN(whole) ? null : whole;
        }
        if (type === 'double' || type === 'currency' || type === 'percent') {
            var num = parseFloat(raw);
            return isNaN(num) ? null : num;
        }
        if (type === 'multipicklist' && Array.isArray(raw)) { return raw.join(';'); }
        return raw;
    }

    /* ------------------------------------------------------------------ */
    /* Talking to the org                                                  */
    /* ------------------------------------------------------------------ */

    /*
     * Every call goes through the service worker.
     *
     * Not for indirection's sake - a content script cannot make this request.
     * Since Chrome 85 its fetch is the page's fetch: the page's origin and
     * none of the extension's host permissions. From a Lightning page a call
     * to the org's my-domain host is a plain cross-origin request, and
     * Salesforce sends CORS headers only for origins an admin has allowlisted
     * in Setup. The browser blocks it before it leaves and the page is handed
     * "Failed to fetch" - no status, no body, nothing to tell the user.
     *
     * The service worker holds host_permissions and is not subject to CORS, so
     * the request works there. It is the same relay the Metadata API already
     * uses, for the same reason.
     */
    function apiFetch(url, options) {
        var settings = options || {};
        var sid = typeof ssSessionId === 'function' ? ssSessionId() : null;

        return new Promise(function (resolve, reject) {
            chrome.runtime.sendMessage({
                type: 'SS_REST_REQUEST',
                url: url,
                method: settings.method || 'GET',
                body: settings.body || null,
                sid: sid
            }, function (response) {
                // The worker being asleep, or the extension having been
                // reloaded under a page that is still open. Neither is
                // something the user can read a status code out of.
                var failure = chrome.runtime.lastError;
                if (failure) {
                    /*
                     * No receiver. Either the service worker has no handler for
                     * this message - which is what a half-updated extension
                     * looks like, the new content script running against the
                     * old background - or the extension was reloaded under a
                     * page that is still open.
                     *
                     * Both are fixed by the same two actions, and neither is
                     * guessable from "Could not establish connection".
                     */
                    return reject(new Error(
                        'The extension could not reach its background worker (' +
                        failure.message + '). Reload the extension on ' +
                        'chrome://extensions, then reload this page.'));
                }
                if (!response) {
                    return reject(new Error('The extension could not reach the org.'));
                }
                if (response.error && !response.status) {
                    return reject(new Error(response.error));
                }

                var data = null;
                if (response.text) {
                    try { data = JSON.parse(response.text); } catch (e) { data = null; }
                }
                if (!response.ok) {
                    return reject(describeApiError(data, response.status, response.text));
                }
                resolve(data);
            });
        });
    }

    /*
     * Salesforce refuses in more than one shape, and the useful part differs
     * in each.
     *
     *   [{ message, errorCode, fields }]   the REST answer
     *   { message, errorCode }             a single one, unwrapped
     *   { error, error_description }       the OAuth-style answer, which is
     *                                      what an expired session returns
     *
     * The first version of this read only `message`, so anything else became
     * an empty string and the user was shown a bare "error" - which is
     * indistinguishable from a validation rule that happens to say "error",
     * and cost a round of guessing to tell apart.
     *
     * So: the code always travels with the message, the status always
     * appears, and if nothing could be parsed the raw body is shown rather
     * than replaced with a sentence about it.
     */
    function describeApiError(data, status, rawText) {
        var list = Array.isArray(data) ? data : (data ? [data] : []);

        var messages = list.map(function (item) {
            if (!item) { return ''; }
            var text = item.message || item.error_description || item.error || '';
            var code = item.errorCode || (item.error_description ? item.error : '');
            // The code is what a search finds and what an admin recognises;
            // the message alone is often the part that has been customised.
            if (code && code !== text) { text = text ? (text + ' [' + code + ']') : code; }
            if (item.fields && item.fields.length) { text += ' (' + item.fields.join(', ') + ')'; }
            return text.trim();
        }).filter(Boolean);

        if (!messages.length && rawText) {
            /*
             * An unparseable body, kept whole up to a limit that is about the
             * screen rather than about the message: 300 characters cut an
             * Apex trigger's addError in half, and the half that went is
             * where such messages put the part you can act on.
             */
            messages = [String(rawText).slice(0, 2000)];
        }
        if (!messages.length) {
            messages = ['The org refused the request.'];
        }

        var error = new Error(messages.join(' ') + ' (HTTP ' + status + ')');
        error.status = status;
        error.details = list;
        error.raw = rawText || null;
        /*
         * Each refusal separately as well as joined. One PATCH can break
         * several rules at once, and running them together into one sentence
         * is how the second and third stop being read.
         */
        error.messages = messages;
        return error;
    }

    function loadRecord(objectApiName, recordId) {
        var base = ssRestBase();
        return Promise.all([
            apiFetch(base + '/sobjects/' + objectApiName + '/describe'),
            apiFetch(base + '/sobjects/' + objectApiName + '/' + recordId),
            recordAccess(recordId)
        ]).then(function (answers) {
            return {
                describe: answers[0],
                record: answers[1],
                canEdit: answers[2]
            };
        });
    }

    /*
     * Sharing, which field-level security knows nothing about.
     *
     * describe().updateable answers "may this user ever edit this field on
     * this object"; UserRecordAccess answers "may they edit this row". Both
     * have to say yes. A refusal here is treated as read-only rather than as
     * an error: the panel is still worth showing.
     */
    function recordAccess(recordId) {
        var uid = typeof readCookie === 'function' ? readCookie('uid') : null;
        if (!uid) { return Promise.resolve(false); }

        var soql = "SELECT RecordId, HasEditAccess FROM UserRecordAccess " +
                   "WHERE UserId = '" + escapeSoqlLiteral(uid) + "' " +
                   "AND RecordId = '" + escapeSoqlLiteral(recordId) + "'";
        return apiFetch(ssQueryUrl() + encodeURIComponent(soql)).then(function (data) {
            var row = data && data.records && data.records[0];
            return !!(row && row.HasEditAccess);
        }, function () { return false; });
    }

    function saveChanges(objectApiName, recordId, payload) {
        return apiFetch(ssRestBase() + '/sobjects/' + objectApiName + '/' + recordId, {
            method: 'PATCH',
            body: payload
        });
    }

    /* ------------------------------------------------------------------ */
    /* The tab                                                             */
    /* ------------------------------------------------------------------ */

    /*
     * Nothing of ours goes inside their tab list.
     *
     * The first version of this inserted an <li> into
     * ul.slds-tabs_default__nav, which is what a tab is. It broke the page:
     *
     *   TypeError: Cannot read properties of undefined (reading 'linkId')
     *     at B._synchronizeA11y
     *     at B.renderedCallback
     *
     * Their component walks the <li> children of that <ul> on every render and
     * indexes them against its own array of tabs. One extra child shifts every
     * index, the last lookup runs off the end, and the whole record page is
     * replaced by a component error. First or last makes no difference - it is
     * the count that breaks it.
     *
     * So the tab is our own button, on the body, positioned to sit level with
     * theirs. It looks like part of the row and is not part of their component.
     */
    /*
     * The record page's own tab bar - not the first one on the page.
     *
     * lightning-tab-bar is a generic component. Setup uses it, the Lightning
     * App Builder uses it for Components/Fields, modals use it, and a Tabs
     * component dropped on a layout uses it. Taking the first match put an
     * "All Fields" button next to Components/Fields in the App Builder, over a
     * page that has no record at all.
     *
     * A record page's tab bar identifies itself: its tabs carry the standard
     * values Salesforce assigns them. If none of the tab bars on the page look
     * like one, the answer is none - showing the button beside an unrelated
     * set of tabs is worse than not showing it.
     */
    var RECORD_TAB_VALUES = ['detailTab', 'relatedListsTab', 'chatterTab', 'feedTab'];

    /*
     * The buttons in the highlights panel - New Contact, New Case, New Note.
     *
     * Preferred over the tab bar because it is where the actions on a record
     * already live, and the space to its left is empty on every layout wide
     * enough to matter.
     *
     * Nothing of ours goes into its <ul>, for the reason the tab bar taught:
     * this component owns those <li>s too, and moves them in and out of the
     * "Show more actions" menu as the width changes. An extra child is one it
     * did not put there and will either count or discard.
     */
    function chooseRibbon(candidates) {
        var withList = -1;
        for (var i = 0; i < (candidates || []).length; i++) {
            var c = candidates[i] || {};
            if (!c.hasList) { continue; }
            // The record's own ribbon names itself; take it over any other.
            if (c.hasRecordProvider) { return i; }
            if (withList === -1) { withList = i; }
        }
        return withList;
    }

    function findActionRibbon() {
        var ribbons = document.querySelectorAll('runtime_platform_actions-actions-ribbon');
        if (!ribbons.length) { return null; }

        var described = [];
        for (var i = 0; i < ribbons.length; i++) {
            described.push({
                hasList: !!ribbons[i].querySelector('ul.slds-button-group-list'),
                hasRecordProvider:
                    !!ribbons[i].querySelector('runtime_platform_actions-provider-record-detail-ple')
            });
        }
        var index = chooseRibbon(described);
        return index === -1 ? null : ribbons[index].querySelector('ul.slds-button-group-list');
    }

    function chooseTabList(candidates) {
        for (var i = 0; i < (candidates || []).length; i++) {
            var values = candidates[i] || [];
            for (var j = 0; j < values.length; j++) {
                if (RECORD_TAB_VALUES.indexOf(values[j]) !== -1) { return i; }
            }
        }
        return -1;
    }

    function findTabList() {
        var bars = document.querySelectorAll('lightning-tab-bar ul.slds-tabs_default__nav');
        if (!bars.length) { return null; }

        var values = [];
        for (var i = 0; i < bars.length; i++) {
            values.push(Array.prototype.map.call(
                bars[i].querySelectorAll('[data-tab-value]'),
                function (node) { return node.getAttribute('data-tab-value'); }));
        }
        var index = chooseTabList(values);
        return index === -1 ? null : bars[index];
    }

    /*
     * What the hover says.
     *
     * The attribution is the point of it: this sits in a row of Salesforce's
     * own controls and is dressed to match, so anyone wondering where it came
     * from - or what to switch off when it misbehaves - can find out by
     * pointing at it rather than by opening the extensions list.
     */
    function tabTitle() {
        return 'Every field on this record - By Salesforce Simplified';
    }

    function tabElement() {
        var existing = document.getElementById(TAB_ID);
        if (existing) { return existing; }

        var button = document.createElement('button');
        button.id = TAB_ID;
        button.className = TAB_CLASS;
        button.type = 'button';
        button.title = tabTitle();

        var label = document.createElement('span');
        label.className = 'ssaf-tab-label';
        label.textContent = 'All Fields';
        button.appendChild(label);

        /*
         * No data-tab-value, no aria-selected, no <li>. Their controllers read
         * all three to decide what belongs to them.
         */
        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            /*
             * No session: the panel's own card, and nothing else.
             *
             * Opening this modal as well would put a full screen of nothing
             * over the card that is asking for the session - and the card
             * already knows every way in, which a second prompt would have to
             * be kept in step with.
             */
            if (!signedIn() && typeof ssOpenSignIn === 'function' && ssOpenSignIn()) {
                return;
            }
            togglePanel();
        });
        return button;
    }

    /*
     * Placed in the layout, not over it.
     *
     * This was an absolutely positioned button measured against their markup,
     * and every version of that measurement was wrong in a new way: it sat on
     * the hierarchy icon, it went stale on scroll, it needed its own width
     * cached and a compact form for narrow windows.
     *
     * None of that is needed. Their components index the <li> children *inside*
     * the list - that is what broke the tab bar with "Cannot read properties of
     * undefined (reading 'linkId')" - so a sibling of the list is invisible to
     * that walk while still flowing in the row. It cannot overlap anything,
     * because the browser is doing the placing.
     *
     * The one cost is that LWC may drop it when it re-renders. The observer
     * that already watches the page puts it back.
     */
    function anchorList() {
        return findActionRibbon() || findTabList();
    }

    /*
     * Signed out is a state the modal shows, not a reason not to open it.
     *
     * The button is deliberately shown when signed out - hiding it would say
     * the feature does not exist, when what is missing is a session. Returning
     * early on the click was no better: the panel's card is a separate
     * surface, and on a page where it has not been injected the click did
     * nothing visible at all.
     */
    function signedIn() {
        return typeof ssHasSession !== 'function' || ssHasSession();
    }

    function mountTab() {
        var button = tabElement();
        var list = allFieldsEnabled() && state.target && state.target.objectApiName
            ? anchorList()
            : null;

        if (!list || !list.parentNode) {
            if (button.parentNode) { button.parentNode.removeChild(button); }
            // A panel with no way back to it is worse than no panel.
            if (state.open) { state.open = false; render(); }
            return;
        }

        // Beside buttons it should look like a button; beside tabs, like a tab.
        button.classList.toggle('is-button', !!findActionRibbon());

        // Already in the right place - and this runs on every mutation, so
        // re-inserting unconditionally would fight the page for the rest of
        // the session.
        if (list.previousSibling === button) { return; }
        list.parentNode.insertBefore(button, list);
    }

    /* ------------------------------------------------------------------ */
    /* The panel                                                           */
    /* ------------------------------------------------------------------ */

    var state = { open: false, loading: false, target: null, model: [], edits: {},
                  error: '', errorList: [], errorStatus: 0, saved: '', canEdit: false,
                  record: null, copied: false };
    var savedTimer = null;

    function panelElement() {
        var existing = document.getElementById(PANEL_ID);
        if (existing) { return existing; }

        /*
         * A backdrop as well as the panel.
         *
         * Without one a centred box floats over the record with no edge to it
         * and no obvious way out - and clicking away, which is what everyone
         * tries first, does nothing.
         */
        var backdrop = document.createElement('div');
        backdrop.id = BACKDROP_ID;
        backdrop.className = 'ssaf-backdrop';
        backdrop.addEventListener('click', closePanel);
        document.body.appendChild(backdrop);

        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'ssaf-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'All fields on this record');
        document.body.appendChild(panel);
        return panel;
    }

    function backdropElement() {
        panelElement();          // creates both, and only once
        return document.getElementById(BACKDROP_ID);
    }

    /*
     * Centred, as a modal.
     *
     * It hung under whatever opened it, which meant measuring that thing,
     * clamping the result into the window, and following it on scroll - three
     * pieces of arithmetic that each went wrong in turn when the anchor moved
     * from the tab bar to the action ribbon. A modal has no anchor: the
     * stylesheet centres it and there is nothing left to compute.
     */

    function togglePanel() {
        state.open = !state.open;
        if (!state.open) { return render(); }
        if (!state.model.length && !state.loading) { load(); }
        if (typeof ssCountUse === 'function') { ssCountUse('allFieldsOpened', 1); }
        render();
    }

    function closePanel() {
        if (!state.open) { return; }
        state.open = false;
        render();
    }

    function load() {
        var target = state.target;
        if (!target || !target.objectApiName) { return; }
        // A query with no session comes back as a refusal about the session,
        // which the prompt has already said more clearly.
        if (!signedIn()) { return; }
        state.loading = true;
        state.error = '';
        render();

        loadRecord(target.objectApiName, target.recordId).then(function (answer) {
            state.canEdit = answer.canEdit;
            // Kept whole: the copy is what the org sent, not what the panel
            // managed to render.
            state.record = answer.record;
            state.model = buildFieldModel(answer.describe, answer.record, answer.canEdit);
            state.edits = {};
            state.loading = false;
            render();
        }, function (error) {
            state.loading = false;
            state.error = (error && error.message) || 'Could not read this record.';
            render();
        });
    }

    function save() {
        var payload = changedPayload(state.model, state.edits);
        var count = Object.keys(payload).length;
        if (!count) { return; }
        state.loading = true;
        state.error = '';
        state.errorList = [];
        state.errorStatus = 0;
        // A confirmation from the previous save must not be left standing over
        // this one - it would read as though this attempt had already finished.
        clearSaved();
        render();

        saveChanges(state.target.objectApiName, state.target.recordId, payload).then(function () {
            noteSaved(count);
            // Counted on success: an attempt that the org refused is not an
            // edit, and counting it would make the tally a measure of typing.
            if (typeof ssCountUse === 'function') {
                ssCountUse('recordsEdited', 1);
                ssCountUse('fieldsEdited', count);
            }
            /*
             * Re-read rather than assume. A save can change more than it was
             * sent - formulas, rollups and before-save flows all run - and a
             * panel showing what was typed instead of what was stored is the
             * thing this feature exists to avoid.
             */
            load();
        }, function (error) {
            state.loading = false;
            clearSaved();
            state.error = (error && error.message) || 'The save was refused.';
            state.errorList = (error && error.messages) || [];
            state.errorStatus = (error && error.status) || 0;
            reportSaveFailure(payload, error);
            render();
        });
    }

    /*
     * Held across the re-read that follows a save.
     *
     * load() clears the error and redraws, so anything set before it has to
     * survive that deliberately - the confirmation is about the save, not
     * about the read that came after it.
     */
    function noteSaved(count) {
        clearSaved();
        state.saved = savedMessage(count);
        savedTimer = setTimeout(function () {
            savedTimer = null;
            state.saved = '';
            render();
        }, 6000);
    }

    function clearSaved() {
        if (savedTimer) { clearTimeout(savedTimer); savedTimer = null; }
        state.saved = '';
    }

    /*
     * A refusal by the org is not a fault in the extension.
     *
     * A validation rule, a required field, a sharing rule - the org was asked
     * and said no. That is an ordinary answer and belongs on screen where the
     * user can act on it. Written at warn level it also lands in Chrome's
     * extension error log, where it reads as the extension malfunctioning and
     * buries anything that actually is.
     *
     * A status means the org answered, whatever it answered. No status means
     * the request never got there - no receiver, no network, nothing
     * parseable - and that is the extension's own problem to report.
     */
    function reportSaveFailure(payload, error) {
        var answered = !!(error && error.status);
        var detail = {
            build: moduleStamp(),
            payload: payload,
            status: error && error.status,
            details: error && error.details,
            raw: error && error.raw
        };

        if (answered) {
            // Kept, because it is the only place the org's raw answer
            // survives - but at a level that does not claim something broke.
            console.info('Salesforce Simplified: the org refused this save.', detail);
            return;
        }
        console.warn('Salesforce Simplified: the save could not be sent.', detail, error);
    }

    /* ------------------------------------------------------------------ */
    /* Drawing                                                             */
    /* ------------------------------------------------------------------ */

    /*
     * The modal is only ever open without a session when the panel's sign-in
     * card could not be raised - no panel injected on this page, or Angular
     * not bootstrapped. One line and a way to try again, not a second sign-in
     * of its own: the card knows every way in and this cannot be kept in step
     * with it.
     */
    function signedOutNote() {
        var box = document.createElement('div');
        box.className = 'ssaf-signedout';

        var line = document.createElement('p');
        line.textContent = 'Not signed in to this org.';
        box.appendChild(line);

        var hint = document.createElement('p');
        hint.className = 'ssaf-signedout-hint';
        hint.textContent = 'Open the Simplified panel from the launcher on the left ' +
                           'and sign in there.';
        box.appendChild(hint);

        var retry = document.createElement('button');
        retry.className = 'ssaf-signedout-btn';
        retry.type = 'button';
        retry.textContent = 'Open sign in';
        retry.addEventListener('click', function () {
            if (typeof ssOpenSignIn === 'function' && ssOpenSignIn()) {
                // The card is up behind this; it cannot be used through it.
                closePanel();
            }
        });
        box.appendChild(retry);
        return box;
    }

    function render() {
        var panel = panelElement();
        panel.style.display = state.open ? 'flex' : 'none';
        backdropElement().style.display = state.open ? 'block' : 'none';
        var button = document.getElementById(TAB_ID);
        if (button) { button.classList.toggle('is-open', state.open); }
        if (!state.open) { return; }

        panel.textContent = '';
        panel.appendChild(header());

        if (state.saved) { panel.appendChild(note('ssaf-ok', state.saved)); }

        if (!signedIn()) {
            panel.appendChild(signedOutNote());
            return;
        }

        if (state.error) { panel.appendChild(errorBlock()); }
        if (state.loading) { panel.appendChild(note('ssaf-note', 'Reading the record...')); return; }
        if (!state.model.length) { return; }
        if (!state.canEdit) {
            panel.appendChild(note('ssaf-note',
                'Read-only: your access to this record does not allow editing.'));
        }
        panel.appendChild(table());
    }

    /*
     * Every refusal, in full, and reachable.
     *
     * It was one joined sentence in a box the panel clips: overflow is hidden
     * on the panel and this sits outside the scrolling rows, so a long
     * validation message ran off the bottom with no way to reach the rest of
     * it. Now each message is its own line, the block scrolls on its own, and
     * pre-wrap keeps any line breaks the org put there.
     */
    function errorBlock() {
        var box = document.createElement('div');
        box.className = 'ssaf-error';

        var lines = (state.errorList && state.errorList.length)
            ? state.errorList : [state.error];

        lines.forEach(function (line) {
            var row = document.createElement('div');
            row.className = 'ssaf-error-line';
            row.textContent = line;
            box.appendChild(row);
        });

        if (state.errorStatus) {
            var code = document.createElement('div');
            code.className = 'ssaf-error-status';
            code.textContent = 'HTTP ' + state.errorStatus;
            box.appendChild(code);
        }
        return box;
    }

    function note(className, text) {
        var el = document.createElement('div');
        el.className = className;
        el.textContent = text;
        return el;
    }

    function header() {
        var bar = document.createElement('div');
        bar.className = 'ssaf-head';

        var title = document.createElement('b');
        title.textContent = 'All Fields';
        bar.appendChild(title);

        var count = document.createElement('span');
        count.className = 'ssaf-count';
        count.textContent = state.model.length ? state.model.length + ' fields' : '';
        bar.appendChild(count);

        var filter = document.createElement('input');
        filter.className = 'ssaf-filter';
        filter.type = 'search';
        filter.placeholder = 'Filter fields...';
        filter.value = state.filter || '';
        filter.addEventListener('input', function () {
            state.filter = filter.value;
            renderRows();
        });
        bar.appendChild(filter);

        var dirty = Object.keys(changedPayload(state.model, state.edits)).length;
        var saveBtn = document.createElement('button');
        saveBtn.className = 'ssaf-save';
        saveBtn.textContent = dirty ? 'Save ' + dirty + ' change' + (dirty === 1 ? '' : 's') : 'Save';
        saveBtn.disabled = !dirty || state.loading;
        saveBtn.addEventListener('click', save);
        bar.appendChild(saveBtn);

        /*
         * Copy, as an icon rather than a button with a word.
         *
         * It sits beside Save and the close, and neither of those is what
         * anyone came here for - a third labelled control in that row would
         * compete with the field list for a job most people do occasionally.
         * The mark carries it; the title says the rest.
         */
        var copy = document.createElement('button');
        copy.className = 'ssaf-copy' + (state.copied ? ' is-done' : '');
        copy.type = 'button';
        copy.textContent = state.copied ? '\u2713' : '\u29c9';
        copy.title = state.copied
            ? 'Copied'
            : 'Copy this record as JSON - every field, not only the ones shown';
        copy.setAttribute('aria-label', 'Copy this record as JSON');
        copy.disabled = !state.record;
        copy.addEventListener('click', copyRecord);
        bar.appendChild(copy);

        var close = document.createElement('button');
        close.className = 'ssaf-close';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '\u00d7';
        close.addEventListener('click', closePanel);
        bar.appendChild(close);
        return bar;
    }

    /*
     * The whole record, not the filtered view.
     *
     * The filter here searches field names to find one - it is a way of
     * looking, not a way of choosing. Copying only what matched would mean
     * typing "bill" to find BillingCity and silently getting a record with
     * three fields in it.
     */
    function copyRecord() {
        if (!state.record) { return; }
        var text = JSON.stringify(recordForCopy(state.record), null, 2);

        writeClipboard(text).then(function (ok) {
            if (!ok) {
                state.error = 'The clipboard could not be written to. The record is ' +
                              'in the console instead.';
                state.errorList = [state.error];
                console.info('Salesforce Simplified: record JSON', text);
                render();
                return;
            }
            state.copied = true;
            render();
            if (copiedTimer) { clearTimeout(copiedTimer); }
            copiedTimer = setTimeout(function () {
                copiedTimer = null;
                state.copied = false;
                render();
            }, 1600);
        });
    }

    var copiedTimer = null;

    /*
     * navigator.clipboard first, the old way after.
     *
     * The modern call needs a secure context and a focused document, and it
     * rejects rather than throwing - both of which happen here often enough
     * that a silent failure would be the common case. execCommand is
     * deprecated and still the thing that works when it does not.
     */
    function writeClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(text)
                    .then(function () { return true; }, function () { return legacyCopy(text); });
            }
        } catch (e) { /* fall through */ }
        return Promise.resolve(legacyCopy(text));
    }

    function legacyCopy(text) {
        try {
            var area = document.createElement('textarea');
            area.value = text;
            // Off-screen rather than hidden: display:none cannot be selected.
            area.style.position = 'fixed';
            area.style.left = '-9999px';
            document.body.appendChild(area);
            area.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(area);
            return ok;
        } catch (e) {
            return false;
        }
    }

    function table() {
        var wrap = document.createElement('div');
        wrap.className = 'ssaf-rows';
        wrap.id = 'ssafRows';
        renderRows(wrap);
        return wrap;
    }

    function renderRows(into) {
        var wrap = into || document.getElementById('ssafRows');
        if (!wrap) { return; }
        wrap.textContent = '';

        var needle = (state.filter || '').trim().toLowerCase();
        state.model.forEach(function (field) {
            if (needle &&
                field.label.toLowerCase().indexOf(needle) === -1 &&
                field.name.toLowerCase().indexOf(needle) === -1) { return; }
            wrap.appendChild(row(field));
        });
    }

    function row(field) {
        var line = document.createElement('div');
        line.className = 'ssaf-row' + (field.editable ? '' : ' is-locked');

        var label = document.createElement('div');
        label.className = 'ssaf-label';
        label.textContent = field.label;
        // The API name is what anyone acting on this needs, and it is not
        // always guessable from the label.
        var api = document.createElement('span');
        api.className = 'ssaf-api';
        api.textContent = field.name;
        label.appendChild(api);
        line.appendChild(label);

        line.appendChild(field.editable ? input(field) : readOnly(field));
        return line;
    }

    function readOnly(field) {
        var cell = document.createElement('div');
        cell.className = 'ssaf-value';
        if (!field.readable) {
            cell.classList.add('ssaf-hidden-field');
            cell.textContent = 'No access';
            return cell;
        }
        cell.textContent = isBlank(field.value) ? '\u2014' : String(
            typeof field.value === 'object' ? JSON.stringify(field.value) : field.value);
        return cell;
    }

    function input(field) {
        var current = Object.prototype.hasOwnProperty.call(state.edits, field.name)
            ? state.edits[field.name] : field.value;
        var control;

        if (field.type === 'boolean') {
            control = document.createElement('input');
            control.type = 'checkbox';
            control.checked = !!current;
            control.addEventListener('change', function () {
                state.edits[field.name] = control.checked;
                refreshSaveButton();
            });
        } else if (field.type === 'picklist' && field.options.length) {
            control = document.createElement('select');
            control.appendChild(new Option('--None--', ''));
            field.options.forEach(function (option) {
                control.appendChild(new Option(option.label, option.value));
            });
            control.value = current === null || current === undefined ? '' : current;
            control.addEventListener('change', function () {
                state.edits[field.name] = control.value;
                refreshSaveButton();
            });
        } else {
            control = document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
            if (field.type !== 'textarea') { control.type = inputType(field.type); }
            control.value = current === null || current === undefined ? '' : current;
            if (field.length) { control.maxLength = field.length; }
            control.addEventListener('input', function () {
                state.edits[field.name] = control.value;
                refreshSaveButton();
            });
        }

        control.className = 'ssaf-input';
        var cell = document.createElement('div');
        cell.className = 'ssaf-value';
        cell.appendChild(control);
        return cell;
    }

    function inputType(type) {
        if (type === 'date') { return 'date'; }
        if (type === 'datetime') { return 'datetime-local'; }
        if (type === 'email') { return 'email'; }
        if (type === 'phone') { return 'tel'; }
        if (type === 'url') { return 'url'; }
        if (type === 'int' || type === 'double' || type === 'currency' || type === 'percent') {
            return 'number';
        }
        return 'text';
    }

    // Only the button changes while typing. Re-rendering the rows would take
    // the focused input with them on every keystroke.
    function refreshSaveButton() {
        var button = document.querySelector('#' + PANEL_ID + ' .ssaf-save');
        if (!button) { return; }
        var dirty = Object.keys(changedPayload(state.model, state.edits)).length;
        button.textContent = dirty ? 'Save ' + dirty + ' change' + (dirty === 1 ? '' : 's') : 'Save';
        button.disabled = !dirty || state.loading;
    }

    /* ------------------------------------------------------------------ */
    /* Staying attached                                                    */
    /* ------------------------------------------------------------------ */

    /*
     * Lightning navigates without loading a page, and re-renders the tab bar
     * whenever it feels like it - both of which remove the tab. So this
     * watches rather than runs once.
     *
     * Every path goes through apply(): a changed URL resets the record and
     * closes the panel, an unchanged one just puts the tab back.
     */
    var lastPath = null;

    function apply() {
        var target = parseRecordUrl(window.location.pathname);
        var path = window.location.pathname;

        if (path !== lastPath) {
            lastPath = path;
            state.target = target;
            state.model = [];
            state.edits = {};
            state.error = '';
            clearSaved();
            state.open = false;
            render();
        }
        /*
         * Always, not only on record pages. mountTab is what takes the button
         * away as well as what puts it there, and a page with no record still
         * has to be told so.
         *
         * No object in the URL means the key prefix would have to be resolved
         * first; until that is done there is nothing to load, so no tab.
         */
        mountTab();
    }

    function watch() {
        apply();
        new MutationObserver(function () { apply(); })
            .observe(document.body, { childList: true, subtree: true });

        window.addEventListener('popstate', apply);
        // Fires for the SPA navigations popstate does not cover. Absent in
        // older Chrome, where the observer above is the fallback.
        if (window.navigation && window.navigation.addEventListener) {
            window.navigation.addEventListener('navigate', function () { setTimeout(apply, 0); });
        }
        // The tab is fixed to the viewport, so it has to be re-measured
        // whenever what it is anchored to moves. Passive and capturing: the
        // record page scrolls in an inner container, not on the window.
        var reposition = function () { mountTab(); };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, { capture: true, passive: true });
        /*
         * Escape closes it, and stops there.
         *
         * Salesforce listens for Escape too - on its own modals, its console
         * tabs and its inline edits. Letting the key through after we have
         * handled it would close one of theirs as well, from a press the user
         * meant for this.
         */
        document.addEventListener('keydown', function (event) {
            if (!state.open) { return; }
            if (event.key !== 'Escape' && event.keyCode !== 27) { return; }
            event.preventDefault();
            event.stopPropagation();
            closePanel();
        }, true);

        // Their tabs and ours are alternatives, not companions.
        document.addEventListener('click', function (event) {
            var target = event.target;
            if (!target || !target.closest) { return; }
            if (target.closest('.slds-tabs_default__link')) { closePanel(); }
        }, true);
    }

    /*
     * This module loads immediately before bootstrap.js, and an exception here
     * would stop the file - so Angular would never be bootstrapped and the
     * whole extension would be gone, launcher and all, because of a feature
     * that is an extra on one kind of page.
     *
     * It is also the most fragile thing in the extension: it reaches into
     * markup that belongs to Salesforce and changes with their releases. So
     * its own failure is contained here, and reported rather than swallowed.
     */
    function start() {
        try {
            watch();
        } catch (error) {
            console.warn('Salesforce Simplified: All Fields did not start.',
                moduleStamp(), error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    /*
     * Why the button is or is not on screen.
     *
     * Every reason it can be absent is a different check in mountTab, and
     * from the outside they all look identical: nothing there. Rather than
     * guess across several rounds - which is what "it only shows on Account"
     * would otherwise take - this reports each answer in turn.
     *
     * Meant to be run by hand: ssAllFields.diagnose() in the page console.
     */
    function diagnose() {
        var ribbon = findActionRibbon();
        var tabs = findTabList();
        var list = ribbon || tabs;
        var button = document.getElementById(TAB_ID);

        var report = {
            build: moduleStamp(),
            url: window.location.pathname,
            record: parseRecordUrl(window.location.pathname),
            enabled: allFieldsEnabled(),
            ribbonFound: !!ribbon,
            tabBarFound: !!tabs,
            ribbonsOnPage: document.querySelectorAll(
                'runtime_platform_actions-actions-ribbon').length,
            tabBarsOnPage: document.querySelectorAll(
                'lightning-tab-bar ul.slds-tabs_default__nav').length,
            buttonInDom: !!button,
            buttonAttached: !!(button && button.parentNode)
        };

        if (!report.record) {
            report.verdict = 'This URL is not a record detail page.';
            return report;
        }
        if (!report.record.objectApiName) {
            report.verdict = 'The URL does not name the object, so there is nothing to query.';
            return report;
        }
        if (!report.enabled) {
            report.verdict = 'Switched off in Features - All Fields button.';
            return report;
        }
        if (!list) {
            report.verdict = report.tabBarsOnPage
                ? 'Tab bars were found but none looked like a record page\'s.'
                : 'No action ribbon and no tab bar to sit beside.';
            return report;
        }

        var box = list.getBoundingClientRect();
        report.anchor = ribbon ? 'action ribbon' : 'tab bar';
        report.anchorBox = { left: box.left, right: box.right, top: box.top, width: box.width };

        if (!box.width) {
            report.verdict = 'The anchor is on the page but has no width - probably not the visible tab.';
            return report;
        }

        report.insertedBeforeList = !!(button && list.previousSibling === button);
        report.verdict = report.insertedBeforeList
            ? 'In place, immediately before the action list.'
            : 'The anchor was found but the button is not beside it yet - the page ' +
              'may have re-rendered since; it is put back on the next mutation.';
        return report;
    }

    window.ssAllFields = {
        diagnose: diagnose,
        parseRecordUrl: parseRecordUrl,
        buildFieldModel: buildFieldModel,
        recordForCopy: recordForCopy,
        changedPayload: changedPayload,
        savedMessage: savedMessage,
        chooseTabList: chooseTabList,
        chooseRibbon: chooseRibbon,
        tabTitle: tabTitle,
        allFieldsEnabled: allFieldsEnabled,
        moduleStamp: moduleStamp,
        MODULE_BUILD: MODULE_BUILD,
        ENABLED_COOKIE: ENABLED_COOKIE,
        RECORD_TAB_VALUES: RECORD_TAB_VALUES,
        coerce: coerce,
        isBlank: isBlank,
        loadRecord: loadRecord,
        saveChanges: saveChanges,
        recordAccess: recordAccess,
        PANEL_ID: PANEL_ID,
        TAB_CLASS: TAB_CLASS
    };
}());
