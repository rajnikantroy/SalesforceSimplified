/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Export - the records behind a list view, as a file.
 *
 * A list view shows the columns somebody chose and hands you no way to take
 * the data anywhere. Data Loader wants an install and a login; the report
 * builder wants a report. This puts an editable SOQL query and three file
 * formats behind one button on the list page itself.
 *
 * ---------------------------------------------------------------------------
 * What it borrows from the All Fields module, and why
 * ---------------------------------------------------------------------------
 *
 *   The relay. A content script's fetch is the page's fetch since Chrome 85 -
 *   the page's origin and none of the extension's host permissions - so a call
 *   to the org is cross-origin and the browser blocks it before it leaves.
 *   Every request here goes through the service worker, which holds the host
 *   permissions and is not subject to CORS.
 *
 *   The insertion. Their action <ul> is owned by a component that indexes its
 *   own <li> children. An <li> of ours broke the record page outright, so
 *   nothing of ours goes inside that list - only immediately before it.
 *
 * This ribbon is Aura rather than LWC (data-aura-rendered-by, not lwc-*), but
 * the rule is the same and so is the technique.
 */
(function () {
    'use strict';

    if (typeof ssIsOrgPage === 'function' && !ssIsOrgPage()) { return; }
    if (typeof ssIsStandalonePage === 'function' && ssIsStandalonePage()) { return; }

    var MODULE_BUILD = 'list-export/3';
    var BUTTON_ID = 'ssExportButton';
    var MODAL_ID = 'ssExportModal';
    var BACKDROP_ID = 'ssExportBackdrop';
    var ENABLED_COOKIE = 'Simplified_ListExport';

    // Enough to be worth having, low enough that a mistyped query cannot pull
    // a million rows through the browser before anyone notices.
    var MAX_ROWS = 50000;
    var DEFAULT_LIMIT = 200;

    function enabled() {
        try {
            return typeof readCookie !== 'function' || readCookie(ENABLED_COOKIE) !== 'false';
        } catch (e) {
            return true;
        }
    }

    function moduleStamp() {
        var version = '';
        try { version = chrome.runtime.getManifest().version; } catch (e) { version = '?'; }
        return MODULE_BUILD + ' (extension ' + version + ')';
    }

    /* ------------------------------------------------------------------ */
    /* Which list                                                          */
    /* ------------------------------------------------------------------ */

    /*
     * Lightning names the object in the path; the filter travels in the query
     * string, which is deliberately not read. The filter decides which rows
     * the list shows, and this exports what the query says - conflating the
     * two would mean claiming to honour a filter that is not in the SOQL.
     */
    function parseListUrl(pathname) {
        var path = String(pathname || '');

        var lightning = /^\/lightning\/o\/([A-Za-z0-9_]+)\/(list|home)\/?$/.exec(path);
        if (lightning) {
            return { objectApiName: lightning[1], surface: 'lightning' };
        }

        // Classic: /001/o is the Accounts tab. The prefix identifies the
        // object, and resolving it costs a describeGlobal - so it is handed
        // back for the caller to decide.
        var classic = /^\/([a-zA-Z0-9]{3})\/o\/?$/.exec(path);
        if (classic) {
            return { objectApiName: null, keyPrefix: classic[1], surface: 'classic' };
        }
        return null;
    }

    function defaultQuery(objectApiName) {
        /*
         * FIELDS(ALL) rather than a field list, because the point is to get
         * everything without having to know what everything is. The org caps
         * it at 200 rows - that is its rule, not ours - so the limit is stated
         * here rather than left to be discovered as a refusal.
         */
        return 'SELECT FIELDS(ALL) FROM ' + objectApiName + ' LIMIT ' + DEFAULT_LIMIT;
    }

    /* ------------------------------------------------------------------ */
    /* Shaping the answer                                                  */
    /* ------------------------------------------------------------------ */

    /*
     * One row per record, one column per leaf.
     *
     * A SOQL answer is not flat: a parent field arrives as a nested object,
     * and every record carries an `attributes` block that is about the
     * response rather than the data. Dotted paths keep the relationship
     * visible - Account.Owner.Name says where the value came from, where a
     * column called Name would not.
     */
    function flattenRecord(record, prefix, into) {
        var flat = into || {};
        var base = prefix || '';

        Object.keys(record || {}).forEach(function (key) {
            if (key === 'attributes') { return; }
            var value = record[key];
            var name = base ? (base + '.' + key) : key;

            if (value && typeof value === 'object' && !Array.isArray(value)) {
                // A parent record. Its own attributes block is skipped by the
                // same rule one level down.
                flattenRecord(value, name, flat);
                return;
            }
            if (Array.isArray(value)) {
                // A child relationship. Flattening it would multiply the rows;
                // JSON keeps it, and the flat formats say how many there were.
                flat[name] = value.length + ' record(s)';
                return;
            }
            flat[name] = value === null || value === undefined ? '' : value;
        });
        return flat;
    }

    /*
     * The union, in first-seen order.
     *
     * Records do not all carry the same keys - a null parent is absent rather
     * than empty - so taking the first record's keys loses columns that appear
     * later. Sorting them alphabetically would be tidier and would put the
     * fields that were asked for in an order nobody chose.
     */
    function columnsOf(rows) {
        var seen = Object.create(null);
        var columns = [];
        (rows || []).forEach(function (row) {
            Object.keys(row).forEach(function (key) {
                if (seen[key]) { return; }
                seen[key] = true;
                columns.push(key);
            });
        });
        return columns;
    }

    /*
     * RFC 4180, and the part of it that matters: a value containing a comma, a
     * quote or a newline has to be quoted, and quotes inside it doubled.
     * Getting this wrong does not fail - it produces a file that opens and is
     * quietly wrong from the first free-text field onwards.
     */
    function csvCell(value) {
        var text = value === null || value === undefined ? '' : String(value);
        if (!/[",\n\r]/.test(text)) { return text; }
        return '"' + text.replace(/"/g, '""') + '"';
    }

    function toCsv(rows, columns) {
        var lines = [columns.map(csvCell).join(',')];
        rows.forEach(function (row) {
            lines.push(columns.map(function (key) { return csvCell(row[key]); }).join(','));
        });
        // CRLF, which is what the format says and what Excel expects.
        return lines.join('\r\n');
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /*
     * An HTML table Excel opens, not a real .xlsx.
     *
     * A genuine xlsx is a zip of XML parts and would be several hundred lines
     * of this file for a format nobody here asked to author. Excel has opened
     * HTML tables since 2000 and keeps the column headers; the cost is that it
     * warns once about the extension not matching the content, and that this
     * is stated plainly rather than dressed up as xlsx.
     */
    function toExcelHtml(rows, columns) {
        var head = columns.map(function (key) {
            return '<th>' + escapeHtml(key) + '</th>';
        }).join('');

        var body = rows.map(function (row) {
            return '<tr>' + columns.map(function (key) {
                // Everything as text: Excel otherwise reads an 18-character
                // Salesforce id as a number and rounds it into nonsense.
                return '<td style="mso-number-format:\\@">' + escapeHtml(row[key]) + '</td>';
            }).join('') + '</tr>';
        }).join('');

        return '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head>' +
               '<meta charset="utf-8"></head><body><table border="1">' +
               '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>' +
               '</table></body></html>';
    }

    function exportFilename(objectApiName, extension) {
        var stamp = new Date().toISOString().slice(0, 10);
        return (objectApiName || 'export') + '-' + stamp + '.' + extension;
    }

    /*
     * Which rows match, as positions rather than as rows.
     *
     * The three formats read different things - JSON writes the original
     * records, CSV and Excel write the flattened ones - so a filter that
     * returned rows would have to be applied twice, against two arrays, and
     * the two could disagree. Positions apply once and index both.
     *
     * Matched against the values, not the column names: the columns are all
     * on screen already, and what someone wants from a filter over data is
     * the rows containing a thing.
     */
    function matchingIndexes(rows, filter) {
        var needle = String(filter || '').trim().toLowerCase();
        var all = rows || [];
        var indexes = [];

        for (var i = 0; i < all.length; i++) {
            if (!needle) { indexes.push(i); continue; }
            var row = all[i];
            var keys = Object.keys(row);
            for (var k = 0; k < keys.length; k++) {
                var value = row[keys[k]];
                if (value === null || value === undefined || value === '') { continue; }
                if (String(value).toLowerCase().indexOf(needle) !== -1) {
                    indexes.push(i);
                    break;
                }
            }
        }
        return indexes;
    }

    /* ------------------------------------------------------------------ */
    /* Suggesting fields                                                   */
    /* ------------------------------------------------------------------ */

    /*
     * The word the caret is in.
     *
     * Suggestions have to be about what is being typed, not about the whole
     * box - "Bil" should offer BillingCity, and the same three letters
     * elsewhere in the query should not. Dots count as part of the word so a
     * relationship path stays whole: Account.Na is one thing being typed, not
     * a finished Account and a stray Na.
     */
    function currentToken(text, caret) {
        var body = String(text || '');
        var at = Math.max(0, Math.min(caret === undefined ? body.length : caret, body.length));
        var isWord = function (ch) { return /[A-Za-z0-9_.]/.test(ch); };

        var start = at;
        while (start > 0 && isWord(body.charAt(start - 1))) { start--; }
        var end = at;
        while (end < body.length && isWord(body.charAt(end))) { end++; }

        return { start: start, end: end, value: body.slice(start, end) };
    }

    /*
     * Fields that match what has been typed, the ones that start with it
     * first.
     *
     * Prefix before substring because that is the order they are wanted in:
     * somebody typing "Bill" means BillingCity long before they mean
     * ShippingBillToId. Ranked rather than filtered, so a substring match is
     * still reachable instead of being hidden.
     */
    function suggestFields(fields, token, limit) {
        var needle = String(token || '').toLowerCase();
        var cap = limit || 40;
        if (!needle) { return (fields || []).slice(0, cap); }

        var prefix = [];
        var contains = [];
        (fields || []).forEach(function (field) {
            var name = (field.name || '').toLowerCase();
            var label = (field.label || '').toLowerCase();
            if (name.indexOf(needle) === 0) { prefix.push(field); return; }
            if (name.indexOf(needle) !== -1 || label.indexOf(needle) !== -1) { contains.push(field); }
        });
        return prefix.concat(contains).slice(0, cap);
    }

    /*
     * Replaces what is being typed, rather than appending to it.
     *
     * Inserting at the caret would leave "BillBillingCity" - the half-typed
     * word is what the suggestion is finishing, so it is what the suggestion
     * takes the place of.
     */
    function insertField(text, token, fieldName) {
        var body = String(text || '');
        var next = body.slice(0, token.start) + fieldName + body.slice(token.end);
        return { text: next, caret: token.start + fieldName.length };
    }

    /* ------------------------------------------------------------------ */
    /* Asking the org                                                      */
    /* ------------------------------------------------------------------ */

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
                var failure = chrome.runtime.lastError;
                if (failure) {
                    return reject(new Error(
                        'The extension could not reach its background worker (' +
                        failure.message + '). Reload the extension on ' +
                        'chrome://extensions, then reload this page.'));
                }
                if (!response) { return reject(new Error('The extension could not reach the org.')); }
                if (response.error && !response.status) { return reject(new Error(response.error)); }

                var data = null;
                if (response.text) {
                    try { data = JSON.parse(response.text); } catch (e) { data = null; }
                }
                if (!response.ok) { return reject(describeApiError(data, response.status, response.text)); }
                resolve(data);
            });
        });
    }

    function describeApiError(data, status, rawText) {
        var list = Array.isArray(data) ? data : (data ? [data] : []);
        var messages = list.map(function (item) {
            if (!item) { return ''; }
            var text = item.message || item.error_description || item.error || '';
            var code = item.errorCode || (item.error_description ? item.error : '');
            if (code && code !== text) { text = text ? (text + ' [' + code + ']') : code; }
            return text.trim();
        }).filter(Boolean);

        if (!messages.length && rawText) { messages = [String(rawText).slice(0, 2000)]; }
        if (!messages.length) { messages = ['The org refused the query.']; }

        var error = new Error(messages.join(' ') + ' (HTTP ' + status + ')');
        error.status = status;
        error.messages = messages;
        return error;
    }

    /*
     * A refusal the Tooling API might not share.
     *
     * Half of what anyone wants to export is not in the data API at all -
     * ApexClass, Flow, CustomField, ValidationRule and the rest live behind
     * /tooling. Asking the data API for them comes back "sObject type
     * 'ApexClass' is not supported", which is true and useless: the object
     * exists, just not there.
     *
     * Only for refusals about the *shape* of the query. A syntax error or a
     * permission problem will be refused identically by both, and retrying
     * turns one clear message into two and doubles the wait.
     */
    var TOOLING_WORTH_RETRY =
        /INVALID_TYPE|INVALID_FIELD|NOT_FOUND|is not supported|No such column|does not exist/i;

    function shouldRetryOnTooling(error) {
        if (!error) { return false; }
        // No status means the request never arrived. Sending it somewhere else
        // will not help, and would report the second failure over the first.
        if (!error.status) { return false; }
        var text = ((error.messages && error.messages.join(' ')) || error.message || '');
        return TOOLING_WORTH_RETRY.test(text);
    }

    /*
     * Both refusals, in the order they happened.
     *
     * Replacing the first with the second loses the message about the API the
     * user actually meant; dropping the second hides that the fallback was
     * tried at all, which is the part that explains the delay.
     */
    function combineFailures(first, second) {
        var error = new Error(first.message + ' \u2014 the Tooling API was tried too: ' +
                              second.message);
        error.status = first.status;
        error.messages = (first.messages || [first.message])
            .concat(['Tooling API: ' + second.message]);
        return error;
    }

    /*
     * Every page of the answer, not the first two thousand.
     *
     * A SOQL response carries at most 2000 records and a nextRecordsUrl for
     * the rest. Stopping at the first page is the difference between an export
     * and a sample, and nothing in the response says which one you got.
     */
    function queryVia(baseUrl, soql, onProgress) {
        var collected = [];

        function absorb(data) {
            if (!data) { return collected; }
            collected = collected.concat(data.records || []);
            if (typeof onProgress === 'function') {
                onProgress(collected.length, data.totalSize);
            }
            if (!data.done && data.nextRecordsUrl && collected.length < MAX_ROWS) {
                return apiFetch(ssApiOrigin() + data.nextRecordsUrl).then(absorb);
            }
            return collected;
        }

        return apiFetch(baseUrl + encodeURIComponent(soql)).then(absorb);
    }

    function runQuery(soql, onProgress) {
        state.usedTooling = false;

        return queryVia(ssQueryUrl(), soql, onProgress).catch(function (error) {
            if (!shouldRetryOnTooling(error)) { throw error; }

            state.usedTooling = true;
            return queryVia(ssToolingQueryUrl(), soql, onProgress)
                .catch(function (toolingError) {
                    state.usedTooling = false;
                    throw combineFailures(error, toolingError);
                });
        });
    }

    /* ------------------------------------------------------------------ */
    /* The button                                                          */
    /* ------------------------------------------------------------------ */

    /*
     * The list view's own action bar - New, Import, Assign Label.
     *
     * Aura here rather than LWC, so the markers differ, but the ownership is
     * the same: the component built those <li>s and reconciles them. Ours goes
     * immediately before the list, never inside it.
     */
    function findActionList() {
        return document.querySelector('ul.oneActionsRibbon.forceActionsContainer') ||
               document.querySelector('ul.branding-actions.slds-button-group');
    }

    function buttonElement() {
        var existing = document.getElementById(BUTTON_ID);
        if (existing) { return existing; }

        var button = document.createElement('button');
        button.id = BUTTON_ID;
        button.className = 'ssx-button';
        button.type = 'button';
        button.title = 'Export these records - By Salesforce Simplified';
        button.textContent = 'Export';
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
            openModal();
        });
        return button;
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

    function mountButton() {
        var button = buttonElement();
        var list = enabled() && state.target && state.target.objectApiName
            ? findActionList()
            : null;

        if (!list || !list.parentNode) {
            if (button.parentNode) { button.parentNode.removeChild(button); }
            if (state.open) { closeModal(); }
            return;
        }
        if (list.previousSibling === button) { return; }
        list.parentNode.insertBefore(button, list);
    }

    /* ------------------------------------------------------------------ */
    /* The modal                                                           */
    /* ------------------------------------------------------------------ */

    var state = { target: null, open: false, running: false, rows: [], flat: [],
                  columns: [], error: '', notice: '', query: '',
                  fields: [], fieldsFor: null, caret: 0, filter: '',
                  usedTooling: false, autoRan: false };

    /*
     * How many rows are drawn, not how many are exported.
     *
     * The file gets everything; the grid is a check that the query returned
     * what was meant. Fifty thousand rows of DOM would take longer to build
     * than the query took to run, and nobody reads past the first screen of a
     * verification.
     */
    var PREVIEW_ROWS = 200;

    function openModal() {
        state.open = true;
        state.error = '';
        if (!state.query) { state.query = defaultQuery(state.target.objectApiName); }
        drawModal();
        loadFields();

        /*
         * Run it once, on the first open for this list.
         *
         * The query it opens with is the one almost everybody wants - every
         * field, this object - so making them press Run to see it is a click
         * that only ever has one answer. The grid is the point of the modal
         * and it started empty.
         *
         * Once, though, not on every open. A second run after a refusal
         * repeats the same failing query silently, and a second run after a
         * good one throws away rows that are already on screen and may come
         * back different. Both are reopenings of a question already answered.
         */
        // Nothing to run it against yet - the prompt is showing instead.
        if (!state.autoRan && signedIn()) {
            state.autoRan = true;
            run_();
        }
    }

    /*
     * The object's fields, asked for once.
     *
     * A failure here costs the suggestions and nothing else - the query box
     * still works, and it worked without them before. So it is not reported as
     * an error over a modal that is otherwise fine.
     */
    function loadFields() {
        if (state.fields.length || state.fieldsFor === state.target.objectApiName) { return; }
        state.fieldsFor = state.target.objectApiName;

        var object = state.target.objectApiName;
        var keep = function (describe) {
            state.fields = ((describe && describe.fields) || []).map(function (field) {
                return { name: field.name, label: field.label, type: field.type };
            });
            if (state.open) { drawSuggestions(); }
        };

        // The same fallback as the query, for the same reason: a tooling
        // object has no describe in the data API, and without one there are no
        // suggestions for exactly the objects whose field names are hardest to
        // remember.
        apiFetch(ssRestBase() + '/sobjects/' + object + '/describe')
            .then(keep, function (error) {
                if (!shouldRetryOnTooling(error)) { state.fields = []; return; }
                return apiFetch(ssToolingSobjectsUrl() + '/' + object + '/describe')
                    .then(keep, function () { state.fields = []; });
            });
    }

    function closeModal() {
        state.open = false;
        drawModal();
    }

    function modalElements() {
        var modal = document.getElementById(MODAL_ID);
        if (modal) { return modal; }

        var backdrop = document.createElement('div');
        backdrop.id = BACKDROP_ID;
        backdrop.className = 'ssx-backdrop';
        backdrop.addEventListener('click', closeModal);
        document.body.appendChild(backdrop);

        modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.className = 'ssx-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Export records');
        document.body.appendChild(modal);
        return modal;
    }

    /*
     * The modal is only ever open without a session when the panel's sign-in
     * card could not be raised - no panel injected on this page, or Angular
     * not bootstrapped. One line and a way to try again, not a second sign-in
     * of its own: the card knows every way in and this cannot be kept in step
     * with it.
     */
    function signedOutNote() {
        var box = document.createElement('div');
        box.className = 'ssx-signedout';

        var line = document.createElement('p');
        line.textContent = 'Not signed in to this org.';
        box.appendChild(line);

        var hint = document.createElement('p');
        hint.className = 'ssx-signedout-hint';
        hint.textContent = 'Open the Simplified panel from the launcher on the left ' +
                           'and sign in there.';
        box.appendChild(hint);

        var retry = document.createElement('button');
        retry.className = 'ssx-signedout-btn';
        retry.type = 'button';
        retry.textContent = 'Open sign in';
        retry.addEventListener('click', function () {
            if (typeof ssOpenSignIn === 'function' && ssOpenSignIn()) {
                closeModal();
            }
        });
        box.appendChild(retry);
        return box;
    }

    function drawModal() {
        var modal = modalElements();
        var backdrop = document.getElementById(BACKDROP_ID);
        modal.style.display = state.open ? 'flex' : 'none';
        backdrop.style.display = state.open ? 'block' : 'none';
        if (!state.open) { return; }

        modal.textContent = '';
        modal.appendChild(modalHead());

        if (!signedIn()) {
            modal.appendChild(signedOutNote());
            return;
        }

        modal.appendChild(queryBox());
        modal.appendChild(suggestionStrip());
        if (state.error) { modal.appendChild(errorBlock()); }
        if (state.notice) { modal.appendChild(line('ssx-notice', state.notice)); }
        modal.appendChild(resultGrid());
        modal.appendChild(resultBar());
    }

    function line(className, text) {
        var el = document.createElement('div');
        el.className = className;
        el.textContent = text;
        return el;
    }

    function errorBlock() {
        var box = document.createElement('div');
        box.className = 'ssx-error';
        (state.errorList && state.errorList.length ? state.errorList : [state.error])
            .forEach(function (message) {
                box.appendChild(line('ssx-error-line', message));
            });
        return box;
    }

    function modalHead() {
        var head = document.createElement('div');
        head.className = 'ssx-head';

        var title = document.createElement('b');
        title.textContent = 'Export ' + (state.target ? state.target.objectApiName : '');
        head.appendChild(title);

        var close = document.createElement('button');
        close.className = 'ssx-close';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '\u00d7';
        close.addEventListener('click', closeModal);
        head.appendChild(close);
        return head;
    }

    function queryBox() {
        var wrap = document.createElement('div');
        wrap.className = 'ssx-query';

        var area = document.createElement('textarea');
        area.className = 'ssx-soql';
        area.spellcheck = false;
        area.value = state.query;

        /*
         * Read on input rather than only on Run, so the query survives a
         * redraw - an error redraws the modal, and losing what was typed at
         * exactly that moment is the worst time to lose it.
         *
         * The suggestions are redrawn on their own, never by redrawing the
         * modal: rebuilding the textarea on a keystroke takes the caret with
         * it and typing becomes impossible.
         */
        var track = function () {
            state.query = area.value;
            state.caret = area.selectionStart;
            drawSuggestions();
        };
        area.addEventListener('input', track);
        area.addEventListener('click', track);
        area.addEventListener('keyup', track);
        wrap.appendChild(area);

        var run = document.createElement('button');
        run.className = 'ssx-run';
        run.textContent = state.running ? 'Running\u2026' : 'Run query';
        run.disabled = state.running;
        run.addEventListener('click', run_);
        wrap.appendChild(run);
        return wrap;
    }

    /*
     * The answer, with its headers.
     *
     * A count alone says a query ran; it does not say it returned what was
     * meant. Seeing the columns is how a wrong FROM or a missing WHERE is
     * caught before the file is opened somewhere else.
     */
    function resultGrid() {
        var wrap = document.createElement('div');
        wrap.className = 'ssx-grid-wrap';

        if (!state.rows.length) {
            wrap.appendChild(line('ssx-empty', state.running
                ? 'Running\u2026'
                : 'Run the query to see the records here.'));
            return wrap;
        }

        var table = document.createElement('table');
        table.className = 'ssx-grid';

        var head = document.createElement('thead');
        var headRow = document.createElement('tr');
        // A row number, so a scrolled grid still says where you are.
        headRow.appendChild(cell('th', '#', 'ssx-rownum'));
        state.columns.forEach(function (name) {
            headRow.appendChild(cell('th', name));
        });
        head.appendChild(headRow);
        table.appendChild(head);

        var matches = matchingIndexes(state.flat, state.filter);
        if (!matches.length) {
            wrap.appendChild(line('ssx-empty',
                'No record contains "' + state.filter + '".'));
            return wrap;
        }

        var body = document.createElement('tbody');
        matches.slice(0, PREVIEW_ROWS).forEach(function (position, index) {
            var row = state.flat[position];
            var tr = document.createElement('tr');
            tr.appendChild(cell('td', String(index + 1), 'ssx-rownum'));
            state.columns.forEach(function (name) {
                tr.appendChild(cell('td', row[name]));
            });
            body.appendChild(tr);
        });
        table.appendChild(body);
        wrap.appendChild(table);

        if (matches.length > PREVIEW_ROWS) {
            // Said plainly, because a grid that stops without saying so reads
            // as a query that returned less than it did.
            wrap.appendChild(line('ssx-more',
                'Showing the first ' + PREVIEW_ROWS + ' of ' + matches.length +
                ' matching records. Every one of them is in the file.'));
        }
        return wrap;
    }

    function cell(tag, text, className) {
        var el = document.createElement(tag);
        if (className) { el.className = className; }
        el.textContent = text === null || text === undefined ? '' : String(text);
        // The full value on hover: a column is narrow and an id or a
        // description is not.
        if (tag === 'td' && el.textContent) { el.title = el.textContent; }
        return el;
    }

    function suggestionStrip() {
        var strip = document.createElement('div');
        strip.className = 'ssx-suggest';
        strip.id = 'ssxSuggest';
        fillSuggestions(strip);
        return strip;
    }

    // Redrawn in place, so the caret stays where it was.
    function drawSuggestions() {
        var strip = document.getElementById('ssxSuggest');
        if (strip) { fillSuggestions(strip); }
    }

    function fillSuggestions(strip) {
        strip.textContent = '';
        if (!state.fields.length) { return; }

        var token = currentToken(state.query, state.caret);
        var matches = suggestFields(state.fields, token.value);

        var label = document.createElement('span');
        label.className = 'ssx-suggest-label';
        label.textContent = (state.target ? state.target.objectApiName : '') + ' fields:';
        strip.appendChild(label);

        if (!matches.length) {
            strip.appendChild(line('ssx-suggest-none', 'No field matches "' + token.value + '".'));
            return;
        }

        matches.forEach(function (field) {
            var chip = document.createElement('button');
            chip.className = 'ssx-chip';
            chip.type = 'button';
            // The label and the type, because the API name alone does not say
            // what a field holds and the label alone does not go in a query.
            chip.title = field.label + ' \u2013 ' + field.type;

            var type = document.createElement('span');
            type.className = 'ssx-chip-type';
            type.textContent = typeMark(field.type);
            chip.appendChild(type);
            chip.appendChild(document.createTextNode(field.name));

            chip.addEventListener('click', function (event) {
                event.preventDefault();
                pickField(field.name);
            });
            strip.appendChild(chip);
        });
    }

    /* A hint at the kind of field, in one character. */
    function typeMark(type) {
        if (type === 'boolean') { return '\u2713'; }
        if (type === 'date' || type === 'datetime') { return '\u25f7'; }
        if (type === 'picklist' || type === 'multipicklist') { return '\u2261'; }
        if (type === 'reference') { return '\u2197'; }
        if (type === 'int' || type === 'double' || type === 'currency' || type === 'percent') {
            return '#';
        }
        return 'A';
    }

    function refreshResults() {
        var modal = document.getElementById(MODAL_ID);
        if (!modal) { return; }

        var wrap = modal.querySelector('.ssx-grid-wrap');
        if (wrap) { modal.replaceChild(resultGrid(), wrap); }

        var count = modal.querySelector('.ssx-count');
        if (count) {
            count.textContent = countText(state.rows.length,
                matchingIndexes(state.flat, state.filter).length, state.filter);
        }
        // The formats follow the filter, so they have to follow it here too.
        var matches = matchingIndexes(state.flat, state.filter).length;
        Array.prototype.forEach.call(modal.querySelectorAll('.ssx-export'), function (button) {
            button.disabled = !matches;
        });
    }

    function pickField(fieldName) {
        var area = document.querySelector('#' + MODAL_ID + ' .ssx-soql');
        if (!area) { return; }

        var token = currentToken(state.query, state.caret);
        var next = insertField(state.query, token, fieldName);
        state.query = next.text;
        state.caret = next.caret;

        area.value = next.text;
        // Focus first, then the selection: setting it on an unfocused textarea
        // is discarded in some browsers and the caret jumps to the end.
        area.focus();
        area.setSelectionRange(next.caret, next.caret);
        drawSuggestions();
    }

    /*
     * What the count says, given a filter.
     *
     * Kept apart from the drawing because it is the sentence that has to be
     * exactly true: the buttons beside it write whatever it describes, and a
     * filter that quietly did not apply to the file would only be discovered
     * after the file had been opened somewhere else.
     */
    function countText(total, matching, filter) {
        if (!total) { return 'No records yet - run the query.'; }
        if (!String(filter || '').trim()) {
            return total + ' record' + (total === 1 ? '' : 's') + ' ready';
        }
        return matching + ' of ' + total + ' record' + (total === 1 ? '' : 's') +
               ' match - the file gets the ' + matching + ' shown';
    }

    function resultBar() {
        var bar = document.createElement('div');
        bar.className = 'ssx-results';

        var filter = document.createElement('input');
        filter.className = 'ssx-filter';
        filter.type = 'search';
        filter.placeholder = 'Filter records\u2026';
        filter.value = state.filter;
        filter.disabled = !state.rows.length;
        /*
         * Redraws the grid and the count in place, never the modal: rebuilding
         * it would take this input - and the caret in it - away on every
         * keystroke, which is the same trap the query box has.
         */
        filter.addEventListener('input', function () {
            state.filter = filter.value;
            refreshResults();
        });
        bar.appendChild(filter);

        var count = document.createElement('span');
        count.className = 'ssx-count';
        count.textContent = countText(state.rows.length,
            matchingIndexes(state.flat, state.filter).length, state.filter);
        bar.appendChild(count);

        [['JSON', 'json'], ['CSV', 'csv'], ['Excel', 'xls']].forEach(function (pair) {
            var button = document.createElement('button');
            button.className = 'ssx-export';
            button.textContent = pair[0];
            button.disabled = !state.rows.length;
            button.addEventListener('click', function () { download(pair[1]); });
            bar.appendChild(button);
        });
        return bar;
    }

    function run_() {
        if (state.running) { return; }
        state.running = true;
        state.error = '';
        state.errorList = [];
        state.notice = '';
        state.rows = [];
        state.flat = [];
        state.columns = [];
        // A filter belongs to the answer it was typed against.
        state.filter = '';
        drawModal();

        runQuery(state.query, function (soFar, total) {
            state.notice = 'Fetched ' + soFar + (total ? ' of ' + total : '') + '\u2026';
            var el = document.querySelector('#' + MODAL_ID + ' .ssx-notice');
            // Updated in place: redrawing here would take the textarea - and
            // the caret in it - away while the query is still running.
            if (el) { el.textContent = state.notice; }
        }).then(function (records) {
            state.running = false;
            state.rows = records;
            /*
             * Flattened once here rather than twice - the grid and the file
             * are the same shape, and doing it per download meant the columns
             * on screen could differ from the columns in the file.
             */
            state.flat = records.map(function (record) { return flattenRecord(record); });
            state.columns = columnsOf(state.flat);
            var notes = [];
            if (state.usedTooling) {
                // Worth saying: it changes what the columns mean and which
                // objects the query can name next time.
                notes.push('Answered by the Tooling API - the data API does not ' +
                           'carry this object.');
            }
            if (records.length >= MAX_ROWS) {
                notes.push('Stopped at ' + MAX_ROWS + ' records - narrow the query for more.');
            }
            state.notice = notes.join(' ');
            drawModal();
        }, function (error) {
            state.running = false;
            state.error = (error && error.message) || 'The query failed.';
            state.errorList = (error && error.messages) || [];
            console.info('Salesforce Simplified: the export query was refused.',
                { build: moduleStamp(), soql: state.query, status: error && error.status });
            drawModal();
        });
    }

    /*
     * An object URL rather than a data: URL.
     *
     * A data: URL carries the whole file in the address, and the length limit
     * truncates a large export into a file that saves and is corrupt. This is
     * the same reasoning as downloadBlob in the panel, and the same fix.
     */
    function download(kind) {
        if (!state.rows.length) { return; }

        /*
         * What is on screen, not what was fetched.
         *
         * The filter is applied here rather than only to the grid: a filter
         * that narrowed the view and left the file alone would be discovered
         * after the file had been opened somewhere else, which is the worst
         * place to discover it. The count beside the buttons says so.
         */
        var matches = matchingIndexes(state.flat, state.filter);
        if (!matches.length) { return; }

        var flat = matches.map(function (i) { return state.flat[i]; });
        var columns = state.columns;
        var body;
        var mime;

        if (kind === 'json') {
            body = JSON.stringify(matches.map(function (i) { return state.rows[i]; }), null, 2);
            mime = 'application/json';
        } else if (kind === 'csv') {
            // A byte-order mark, or Excel reads a UTF-8 CSV as Latin-1 and
            // every accented name in it arrives mangled.
            body = '\ufeff' + toCsv(flat, columns);
            mime = 'text/csv;charset=utf-8';
        } else {
            body = toExcelHtml(flat, columns);
            mime = 'application/vnd.ms-excel';
        }

        if (typeof ssCountUse === 'function') {
            // The file, and what went in it - one export of forty thousand rows
            // is not the same as forty exports of one.
            ssCountUse('exports', 1);
            ssCountUse('recordsExported', flat.length);
        }

        var url = URL.createObjectURL(new Blob([body], { type: mime }));
        var link = document.createElement('a');
        link.href = url;
        link.download = exportFilename(state.target.objectApiName, kind);
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Released later: revoking synchronously can beat the browser to
        // starting the download.
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    /* ------------------------------------------------------------------ */
    /* Staying attached                                                    */
    /* ------------------------------------------------------------------ */

    var lastPath = null;

    function apply() {
        var path = window.location.pathname;
        if (path !== lastPath) {
            lastPath = path;
            state.target = parseListUrl(path);
            // A query belongs to the object it was written for.
            state.query = '';
            state.rows = [];
            state.flat = [];
            state.columns = [];
            // The fields belong to the object that was open, not to this one.
            state.fields = [];
            state.fieldsFor = null;
            state.filter = '';
            // A different object is a different question, so it gets its own
            // first run.
            state.autoRan = false;
            state.error = '';
            state.notice = '';
            state.open = false;
            if (document.getElementById(MODAL_ID)) { drawModal(); }
        }
        mountButton();
    }

    function watch() {
        apply();
        new MutationObserver(function () { apply(); })
            .observe(document.body, { childList: true, subtree: true });

        window.addEventListener('popstate', apply);
        if (window.navigation && window.navigation.addEventListener) {
            window.navigation.addEventListener('navigate', function () { setTimeout(apply, 0); });
        }
        document.addEventListener('keydown', function (event) {
            if (!state.open) { return; }
            if (event.key !== 'Escape' && event.keyCode !== 27) { return; }
            event.preventDefault();
            event.stopPropagation();
            closeModal();
        }, true);
    }

    /*
     * Contained, like the other module and for the same reason: this file
     * loads before bootstrap.js, and an exception here would stop the file and
     * take Angular - the whole extension - with it.
     */
    function start() {
        try {
            watch();
        } catch (error) {
            console.warn('Salesforce Simplified: Export did not start.', moduleStamp(), error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.ssListExport = {
        diagnose: function () {
            var list = findActionList();
            return {
                build: moduleStamp(),
                url: window.location.pathname,
                list: parseListUrl(window.location.pathname),
                enabled: enabled(),
                actionListFound: !!list,
                buttonAttached: !!(document.getElementById(BUTTON_ID) || {}).parentNode,
                placed: !!(list && list.previousSibling === document.getElementById(BUTTON_ID))
            };
        },
        parseListUrl: parseListUrl,
        defaultQuery: defaultQuery,
        flattenRecord: flattenRecord,
        columnsOf: columnsOf,
        csvCell: csvCell,
        toCsv: toCsv,
        toExcelHtml: toExcelHtml,
        exportFilename: exportFilename,
        runQuery: runQuery,
        shouldRetryOnTooling: shouldRetryOnTooling,
        combineFailures: combineFailures,
        currentToken: currentToken,
        suggestFields: suggestFields,
        insertField: insertField,
        matchingIndexes: matchingIndexes,
        countText: countText,
        enabled: enabled,
        moduleStamp: moduleStamp,
        MAX_ROWS: MAX_ROWS,
        ENABLED_COOKIE: ENABLED_COOKIE
    };
}());
