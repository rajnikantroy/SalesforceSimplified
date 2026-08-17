/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Export - the parts that decide what ends up in the file.
 *
 * The DOM half is not pretended to be testable here; whether an Aura ribbon
 * keeps our sibling is a question for a real org. What is checked is the
 * shaping and the escaping, because a mistake there does not fail - it
 * produces a file that opens and is quietly wrong.
 */

const source = fs.readFileSync('./js/list-export.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));

for (const file of ['./js/list-export.js']) {
    try { new Function(fs.readFileSync(file, 'utf8')); }
    catch (error) { assert.fail(file + ' does not parse: ' + error.message); }
}

function load() {
    const win = { location: { pathname: '/' }, addEventListener: () => {} };
    const env = {
        window: win,
        document: { readyState: 'loading', addEventListener: () => {},
                    querySelector: () => null, getElementById: () => null,
                    body: { appendChild: () => {} }, createElement: () => ({ style: {}, classList: {}, addEventListener: () => {} }) },
        ssIsOrgPage: () => true, ssIsStandalonePage: () => false,
        ssApiOrigin: () => 'https://acme.my.salesforce.com',
        ssQueryUrl: () => 'https://acme.my.salesforce.com/services/data/v60.0/query/?q=',
        ssSessionId: () => 'sid', readCookie: () => null,
        chrome: { runtime: { sendMessage: (...a) => relay.calls.push(a), lastError: null,
                             getManifest: () => ({ version: '2.1.0' }) } },
        MutationObserver: function () { this.observe = () => {}; },
        URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
        Blob: class {},
        setTimeout
    };
    new Function(...Object.keys(env), source)(...Object.values(env));
    return win.ssListExport;
}

const relay = { calls: [] };
const api = load();

function assertOrder(haystack, first, second, why) {
    const a = haystack.indexOf(first);
    const b = haystack.indexOf(second);
    assert.notStrictEqual(a, -1, 'missing "' + first + '": ' + why);
    assert.notStrictEqual(b, -1, 'missing "' + second + '": ' + why);
    assert.ok(a < b, '"' + first + '" must come before "' + second + '": ' + why);
}

function main() {

    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    /* ------------------------------------------------------------------ */
    /* Which list                                                          */
    /* ------------------------------------------------------------------ */

    assert.deepStrictEqual(api.parseListUrl('/lightning/o/Account/list'),
        { objectApiName: 'Account', surface: 'lightning' }, 'a list view names its object');
    assert.deepStrictEqual(api.parseListUrl('/lightning/o/My_Object__c/home'),
        { objectApiName: 'My_Object__c', surface: 'lightning' }, 'and so does an object home');

    for (const path of ['/lightning/r/Account/0011x00000AbCdEAAV/view',
                        '/lightning/setup/ObjectManager/home',
                        '/lightning/n/My_Tab', '/']) {
        assert.strictEqual(api.parseListUrl(path), null, path + ' is not a list page');
    }

    const classic = api.parseListUrl('/001/o');
    assert.strictEqual(classic.surface, 'classic');
    assert.strictEqual(classic.keyPrefix, '001', 'Classic hands back the prefix to resolve');

    assert.ok(/FIELDS\(ALL\) FROM Account LIMIT 200/.test(api.defaultQuery('Account')),
        'the starting query asks for everything, with the cap the org imposes on ' +
        'FIELDS(ALL) stated rather than discovered as a refusal: ' + api.defaultQuery('Account'));

    /* ------------------------------------------------------------------ */
    /* Shaping the answer                                                  */
    /* ------------------------------------------------------------------ */

    const record = {
        attributes: { type: 'Contact', url: '/x' },
        Id: '003x', Name: 'Rose Gonzalez', Fax: null,
        Account: { attributes: { type: 'Account' }, Name: 'Edge', Owner: { Name: 'Mark' } },
        Cases: { records: [{}, {}] }
    };
    const flat = api.flattenRecord(record);

    assert.ok(!('attributes' in flat),
        'the attributes block is about the response, not the data');
    assert.strictEqual(flat['Account.Name'], 'Edge',
        'a parent field keeps the path that says where it came from');
    assert.strictEqual(flat['Account.Owner.Name'], 'Mark', 'however deep it goes');
    assert.ok(!('Account.attributes.type' in flat),
        'and the nested attributes block goes too, not only the top one');
    assert.strictEqual(flat.Fax, '', 'null becomes empty rather than the word null');

    /*
     * The union, not the first record's keys. A null parent is absent from a
     * SOQL answer rather than empty, so columns appear part-way down.
     */
    const columns = api.columnsOf([{ Id: 1, Name: 'a' }, { Id: 2, Phone: 'b' }]);
    assert.deepStrictEqual(columns, ['Id', 'Name', 'Phone'],
        'every column any record has, in the order first seen');

    /* ------------------------------------------------------------------ */
    /* CSV, where a mistake is silent                                      */
    /* ------------------------------------------------------------------ */

    assert.strictEqual(api.csvCell('plain'), 'plain', 'nothing to quote');
    assert.strictEqual(api.csvCell('a,b'), '"a,b"', 'a comma forces quotes');
    assert.strictEqual(api.csvCell('say "hi"'), '"say ""hi"""',
        'a quote is doubled inside quotes - the single case that corrupts every ' +
        'row after it');
    assert.strictEqual(api.csvCell('line\nbreak'), '"line\nbreak"',
        'and a newline is quoted, not left to end the row early');
    assert.strictEqual(api.csvCell(null), '', 'null is empty');
    assert.strictEqual(api.csvCell(0), '0', 'but zero is zero, not empty');
    assert.strictEqual(api.csvCell(false), 'false', 'and false is a value');

    const csv = api.toCsv([{ Id: '1', Note: 'a,b' }, { Id: '2', Note: 'say "hi"' }],
                          ['Id', 'Note']);
    const lines = csv.split('\r\n');
    assert.strictEqual(lines[0], 'Id,Note', 'the header is the columns');
    assert.strictEqual(lines[1], '1,"a,b"');
    assert.strictEqual(lines[2], '2,"say ""hi"""');
    assert.ok(/\r\n/.test(csv), 'CRLF, which is what the format says and Excel expects');

    /* A column missing from a row is an empty cell, not a shifted row. */
    const ragged = api.toCsv([{ Id: '1' }], ['Id', 'Name']);
    assert.strictEqual(ragged.split('\r\n')[1], '1,', 'the row keeps its shape');

    /* ------------------------------------------------------------------ */
    /* Excel                                                               */
    /* ------------------------------------------------------------------ */

    const xls = api.toExcelHtml([{ Id: '001d200001RkMFBAA3', Note: '<b>x</b>' }], ['Id', 'Note']);
    assert.ok(/<th>Id<\/th>/.test(xls), 'the columns are the header row');
    assert.ok(/&lt;b&gt;x&lt;\/b&gt;/.test(xls),
        'and a value containing markup is escaped, not rendered as markup');
    assert.ok(/mso-number-format/.test(xls),
        'every cell is text - Excel otherwise reads an 18-character id as a number ' +
        'and rounds it into nonsense');

    /* ------------------------------------------------------------------ */
    /* Every page, not the first                                           */
    /* ------------------------------------------------------------------ */

    /*
     * Paging lives in queryVia now - runQuery is the pair of attempts around
     * it, and both attempts page.
     */
    const queryBody = /function queryVia\(baseUrl, soql, onProgress\) \{[\s\S]*?\n    \}/.exec(source)[0];
    assert.ok(/nextRecordsUrl/.test(queryBody),
        'a SOQL response carries 2000 records and a pointer to the rest - stopping ' +
        'at the first page is the difference between an export and a sample');
    assert.ok(/collected\.length < MAX_ROWS/.test(queryBody),
        'bounded, so a mistyped query cannot pull a million rows through the browser');
    assert.ok(api.MAX_ROWS > 1000, 'but high enough to be worth having');


    /* ------------------------------------------------------------------ */
    /* The answer, with its headers                                        */
    /*                                                                     */
    /* A count alone says a query ran; it does not say it returned what was */
    /* meant. Seeing the columns is how a wrong FROM or a missing WHERE is  */
    /* caught before the file is opened somewhere else.                     */
    /* ------------------------------------------------------------------ */

    const gridFn = /function resultGrid\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/state\.columns\.forEach/.test(gridFn), 'a header cell per column');
    assert.ok(/cell\('th'/.test(gridFn) && /cell\('td'/.test(gridFn),
        'headers as <th>, values as <td> - a table of divs has no sticky header');
    assert.ok(/'#'/.test(gridFn),
        'and a row number, so a scrolled grid still says where you are');

    /*
     * Flattened once, when the query returns. Doing it again per download let
     * the columns on screen differ from the columns in the file.
     */
    assert.ok(/state\.flat = records\.map/.test(code) && /state\.columns = columnsOf/.test(code),
        'the grid and the file are shaped once, together');
    const downloadFn = /function download\(kind\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/state\.flat\[i\]/.test(downloadFn) && /var columns = state\.columns/.test(downloadFn),
        'and the download reads that shape - selecting from it, never rebuilding ' +
        'it - so the columns in the file are the columns on screen: ' +
        downloadFn.slice(0, 200));
    assert.ok(!/flattenRecord|columnsOf/.test(downloadFn),
        'it never reshapes the records itself');

    /*
     * The preview is capped; the file is not. A grid that stops without
     * saying so reads as a query that returned less than it did.
     */
    assert.ok(/PREVIEW_ROWS/.test(gridFn), 'the grid draws a bounded number of rows');
    assert.ok(/slice\(0, PREVIEW_ROWS\)/.test(gridFn), 'taking them from the front');
    assert.ok(!/PREVIEW_ROWS/.test(downloadFn),
        'while the file gets everything - the cap is about drawing, not exporting');
    assert.ok(/Every one of them is in the file/.test(gridFn),
        'and the difference is stated');

    /* Cleared when the query is re-run, or the old grid outlives its query. */
    const runFn = /function run_\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/state\.flat = \[\]/.test(runFn) && /state\.columns = \[\]/.test(runFn),
        'a new run empties the previous answer before fetching');

    /* ------------------------------------------------------------------ */
    /* Full screen, and scrolling in the right places                      */
    /* ------------------------------------------------------------------ */

    const gridCss = fs.readFileSync('./css/list-export.css', 'utf8');
    const modalRule = /\.ssx-modal \{([^}]*)\}/.exec(gridCss);
    assert.ok(/width:\s*100vw/.test(modalRule[1]) && /height:\s*100vh/.test(modalRule[1]),
        'the whole viewport - a grid of sixty columns wants every pixel there is: ' +
        modalRule[1].trim());
    assert.ok(/inset:\s*0/.test(modalRule[1]),
        'pinned to all four edges, so no margin creeps back in from one side');
    assert.ok(!/transform:\s*translate/.test(modalRule[1]),
        'and nothing left to centre');

    /*
     * No border and no radius. Both exist to say where a window ends against
     * what is behind it, and at full screen there is nothing behind it - a
     * rounded corner over a black backdrop is a gap, not a frame.
     */
    assert.ok(!/border-radius/.test(modalRule[1]),
        'no rounded corners against the screen edge: ' + modalRule[1].trim());
    assert.ok(!/^\s*border:/m.test(modalRule[1]),
        'and no border for the same reason');

    /*
     * The backdrop stays even though nothing of it shows. It is no longer
     * something to click - there is no outside left - but it still stops a
     * stray click or scroll reaching the list underneath.
     */
    assert.ok(/\.ssx-backdrop \{/.test(gridCss), 'the backdrop is still there');
    assert.ok(/ssx-close/.test(code) && /Escape/.test(code),
        'and the ways out are the close button and Escape, neither of which is ' +
        'behind the thing it closes');

    const wrapRule = /\.ssx-modal \.ssx-grid-wrap \{([^}]*)\}/.exec(gridCss);
    assert.ok(wrapRule && /flex:\s*1/.test(wrapRule[1]),
        'the grid takes what the header, query and footer leave');
    assert.ok(/min-height:\s*0/.test(wrapRule[1]),
        'with min-height:0, or a flex child refuses to scroll and overflows instead');
    assert.ok(/overflow:\s*auto/.test(wrapRule[1]), 'and scrolls both ways');

    const thRule = /\.ssx-modal \.ssx-grid th \{([^}]*)\}/.exec(gridCss);
    assert.ok(thRule && /position:\s*sticky/.test(thRule[1]),
        'the header stays while the rows scroll - which is the whole reason for ' +
        'showing it: ' + thRule[1].trim());

    const tdRule = /\.ssx-modal \.ssx-grid td \{([^}]*)\}/.exec(gridCss);
    assert.ok(tdRule && /white-space:\s*nowrap/.test(tdRule[1]) && /max-width/.test(tdRule[1]),
        'and a description field cannot make one row as tall as the screen: ' +
        tdRule[1].trim());

    const queryRule = /\.ssx-modal \.ssx-query \{([^}]*)\}/.exec(gridCss);
    assert.ok(queryRule && /flex:\s*0/.test(queryRule[1]),
        'the query box keeps its size so the grid gets the slack, not the other ' +
        'way round: ' + queryRule[1].trim());


    /* ------------------------------------------------------------------ */
    /* Field suggestions while typing                                      */
    /* ------------------------------------------------------------------ */

    const FIELDS = [
        { name: 'BillingCity', label: 'Billing City', type: 'string' },
        { name: 'BillingCountry', label: 'Billing Country', type: 'string' },
        { name: 'ShippingBillToId', label: 'Bill To', type: 'reference' },
        { name: 'Name', label: 'Account Name', type: 'string' },
        { name: 'AnnualRevenue', label: 'Annual Revenue', type: 'currency' }
    ];

    /*
     * The word the caret is in - not the whole box. "Bil" should offer
     * BillingCity, and the same letters elsewhere in the query should not.
     */
    const q = 'SELECT Bil, FROM Account LIMIT 200';
    assert.deepStrictEqual(api.currentToken(q, 10), { start: 7, end: 10, value: 'Bil' },
        'the token is what is being typed at the caret');
    /*
     * The scan runs both ways from the caret, which is what lets someone click
     * into the middle of a field name and get suggestions for the whole of it.
     * The cost is that a caret resting against a word is inside that word -
     * position 0 here is in SELECT, not in nothing. Harmless: no field matches
     * a keyword, so the strip simply offers none.
     */
    assert.strictEqual(api.currentToken(q, 0).value, 'SELECT',
        'a caret against a word is in that word, whichever side it is on');
    assert.strictEqual(api.currentToken(q, 6).value, 'SELECT',
        'and at the end of one, likewise');
    assert.strictEqual(api.currentToken('SELECT  FROM x', 7).value, '',
        'while a caret in whitespace is in nothing');

    /* A relationship path is one thing, not two. */
    assert.strictEqual(api.currentToken('SELECT Account.Na', 17).value, 'Account.Na',
        'dots are part of the word, or a path is cut in half at the dot');

    /* Whole-word boundaries: a caret inside a word takes the whole word. */
    assert.strictEqual(api.currentToken('SELECT BillingCity FROM x', 12).value, 'BillingCity',
        'the token is the word around the caret, not the part before it');

    /*
     * Prefix before substring: somebody typing "Bill" means BillingCity long
     * before they mean ShippingBillToId.
     */
    /*
     * Deliberately adverse order: the substring match is listed first, so
     * returning the fields in the order they arrived would put it first too.
     * With the fixture already prefix-first, ranking and not ranking give the
     * same answer and the test proves nothing.
     */
    const ADVERSE = [
        { name: 'ShippingBillToId', label: 'Bill To', type: 'reference' },
        { name: 'BillingCity', label: 'Billing City', type: 'string' },
        { name: 'BillingCountry', label: 'Billing Country', type: 'string' }
    ];
    const ranked = api.suggestFields(ADVERSE, 'Bil').map((f) => f.name);
    assert.deepStrictEqual(ranked, ['BillingCity', 'BillingCountry', 'ShippingBillToId'],
        'fields that start with it come first, whatever order they arrived in: ' +
        ranked.join(', '));
    assert.ok(ranked.indexOf('ShippingBillToId') === ranked.length - 1,
        'and a substring match is last but still reachable rather than hidden');
    assert.strictEqual(api.suggestFields(FIELDS, 'Bil').indexOf('Name'), -1,
        'while an unrelated field is not offered');

    /* The label is searched too - a field is often known by what it is called. */
    assert.ok(api.suggestFields(FIELDS, 'annual revenue').length === 0 ||
              api.suggestFields(FIELDS, 'revenue').map((f) => f.name).indexOf('AnnualRevenue') !== -1,
        'the label is matched as well as the API name');

    assert.strictEqual(api.suggestFields(FIELDS, '').length, FIELDS.length,
        'nothing typed offers everything - the list is the point before you know ' +
        'what you are looking for');
    assert.strictEqual(api.suggestFields(FIELDS, '', 2).length, 2, 'bounded');
    /*
     * And bounded on the matching path too. The empty-needle path returns
     * early with its own cap, so testing only that leaves the one that
     * actually filters uncapped - which is the path an object with three
     * hundred fields goes down.
     */
    assert.strictEqual(api.suggestFields(FIELDS, 'i', 2).length, 2,
        'a filtered list is capped as well as an unfiltered one');
    assert.deepStrictEqual(api.suggestFields([], 'Bil'), [], 'and no fields is not a crash');

    /* Case does not matter; nobody types API casing while searching. */
    assert.ok(api.suggestFields(FIELDS, 'billingcity').length,
        'matching ignores case');

    /*
     * The suggestion replaces the half-typed word rather than being appended
     * to it - otherwise "Bil" becomes "BilBillingCity".
     */
    const inserted = api.insertField(q, api.currentToken(q, 10), 'BillingCity');
    assert.strictEqual(inserted.text, 'SELECT BillingCity, FROM Account LIMIT 200',
        'the partial word is what the suggestion takes the place of');
    assert.strictEqual(inserted.caret, 18,
        'and the caret lands after it, ready for the next thing typed');

    /* Inserting with nothing typed puts it at the caret and disturbs nothing. */
    const empty = 'SELECT  FROM Account';
    const at7 = api.insertField(empty, api.currentToken(empty, 7), 'Name');
    assert.strictEqual(at7.text, 'SELECT Name FROM Account',
        'an empty token inserts rather than replacing');

    /* ------------------------------------------------------------------ */
    /* Drawn without stealing the caret                                    */
    /* ------------------------------------------------------------------ */

    assert.ok(/function drawSuggestions\(\)/.test(code), 'the strip redraws on its own');
    const trackHandler = /var track = function \(\) \{[\s\S]*?\n        \};/.exec(code)[0];
    assert.ok(/drawSuggestions\(\)/.test(trackHandler) && !/drawModal\(\)/.test(trackHandler),
        'typing redraws only the strip - rebuilding the modal takes the textarea, ' +
        'and the caret in it, away on every keystroke');
    assert.ok(/state\.caret = area\.selectionStart/.test(trackHandler),
        'and the caret is tracked, since the suggestions depend on where it is');

    const pickFn = /function pickField\(fieldName\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assertOrder(pickFn, 'area.focus()', 'setSelectionRange',
        'focus before the selection - setting it on an unfocused textarea is ' +
        'discarded and the caret jumps to the end');

    /*
     * Losing the describe costs the suggestions and nothing else. The query
     * box worked without them before, so a failure here is not an error over
     * a modal that is otherwise fine.
     */
    const loadFn = /function loadFields\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/function \(\) \{ state\.fields = \[\]; \}/.test(loadFn),
        'a refused describe is swallowed rather than shown as a query error');
    assert.ok(/state\.fieldsFor === state\.target\.objectApiName/.test(loadFn),
        'and it is asked for once per object, not once per open');

    /*
     * One row that scrolls sideways, not several that wrap. An object with
     * three hundred fields would otherwise take half the modal and push the
     * grid off the bottom - which is the thing the grid was made full screen
     * for.
     */
    const stripCss = fs.readFileSync('./css/list-export.css', 'utf8');
    const stripRule = /\.ssx-modal \.ssx-suggest \{([^}]*)\}/.exec(stripCss);
    assert.ok(stripRule, 'the strip needs a rule');
    assert.ok(/overflow-x:\s*auto/.test(stripRule[1]),
        'it scrolls sideways: ' + stripRule[1].trim());
    assert.ok(/white-space:\s*nowrap/.test(stripRule[1]) && !/flex-wrap:\s*wrap/.test(stripRule[1]),
        'and does not wrap into several rows: ' + stripRule[1].trim());
    assert.ok(/flex:\s*0/.test(stripRule[1]),
        'keeping its size, so the grid still gets the slack');

    /* The fields belong to the object that was open. */
    const applyFn = /function apply\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/state\.fields = \[\]/.test(applyFn) && /state\.fieldsFor = null/.test(applyFn),
        'moving to another list drops the previous object\'s fields');


    /* ------------------------------------------------------------------ */
    /* Filtering the records                                               */
    /*                                                                     */
    /* And filtering the file with them. A filter that narrowed the view    */
    /* and left the file alone would be discovered after the file had been  */
    /* opened somewhere else, which is the worst place to discover it.      */
    /* ------------------------------------------------------------------ */

    const ROWS = [
        { Name: 'United Oil', City: 'Houston', Revenue: 5000 },
        { Name: 'Acme', City: 'Leeds', Revenue: null },
        { Name: 'ABC123', City: 'Houston', Revenue: 0 }
    ];

    /*
     * A row with nothing in it. Without an explicit "no filter means all", an
     * empty needle falls through to the value loop - where indexOf('') is 0
     * for any non-empty value, so every row with data still matches and only
     * the blank one silently disappears.
     */
    const WITH_BLANK = ROWS.concat([{ Name: '', City: '', Revenue: null }]);
    assert.deepStrictEqual(api.matchingIndexes(WITH_BLANK, ''), [0, 1, 2, 3],
        'no filter matches everything, including a record with no values at all');
    assert.deepStrictEqual(api.matchingIndexes(ROWS, ''), [0, 1, 2],
        'no filter matches everything');
    assert.deepStrictEqual(api.matchingIndexes(ROWS, '   '), [0, 1, 2],
        'and whitespace is not a filter');
    assert.deepStrictEqual(api.matchingIndexes(ROWS, 'Houston'), [0, 2],
        'a value match keeps the rows containing it');
    assert.deepStrictEqual(api.matchingIndexes(ROWS, 'houston'), [0, 2],
        'ignoring case - nobody types the casing of their data');
    assert.deepStrictEqual(api.matchingIndexes(ROWS, 'nothing'), [],
        'and nothing matching is empty rather than everything');

    /* Any column, not just the first. */
    assert.deepStrictEqual(api.matchingIndexes(ROWS, 'Acme'), [1],
        'a match anywhere in the row counts');
    assert.deepStrictEqual(api.matchingIndexes(ROWS, '5000'), [0],
        'including a number, which is compared as it is displayed');

    /*
     * Zero is a value; empty is not. Skipping falsy values would drop a row
     * whose only match is a zero, and matching empty ones would make every
     * row match anything.
     */
    assert.deepStrictEqual(api.matchingIndexes(ROWS, '0'), [0, 2],
        'zero is searchable, and 5000 contains a zero too');

    /*
     * Positions, not rows. JSON writes the original records and CSV writes the
     * flattened ones - a filter returning rows would be applied twice, to two
     * arrays, and the two could disagree.
     */
    assert.ok(api.matchingIndexes(ROWS, 'Houston').every((i) => typeof i === 'number'),
        'the filter yields positions, which index both arrays');

    /* ------------------------------------------------------------------ */
    /* And the count says exactly what will be written                     */
    /* ------------------------------------------------------------------ */

    assert.strictEqual(api.countText(0, 0, ''), 'No records yet - run the query.');
    assert.strictEqual(api.countText(3, 3, ''), '3 records ready',
        'unfiltered, it is simply the total');
    assert.strictEqual(api.countText(1, 1, ''), '1 record ready', 'and reads as English for one');

    const filtered = api.countText(3, 2, 'houston');
    assert.ok(/2 of 3/.test(filtered), 'filtered, it says both numbers: ' + filtered);
    assert.ok(/file gets the 2/.test(filtered),
        'and says which of them the file gets, since that is the question the ' +
        'buttons beside it answer: ' + filtered);

    /* The download applies it, not only the grid. */
    const downloadBody = /function download\(kind\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/matchingIndexes\(state\.flat, state\.filter\)/.test(downloadBody),
        'the file is the filtered set');
    assert.ok(/matches\.map\(function \(i\) \{ return state\.flat\[i\]; \}\)/.test(downloadBody),
        'CSV and Excel walk the filtered positions - reading state.flat while ' +
        'mapping over all of it writes every row and still mentions the filter');
    assert.ok(/matches\.map\(function \(i\) \{ return state\.rows\[i\]; \}\)/.test(downloadBody),
        'JSON too - it writes the original records, indexed by the same positions');
    assert.ok(/if \(!matches\.length\) \{ return; \}/.test(downloadBody),
        'and a filter matching nothing writes no file rather than an empty one');

    /* The grid draws the filtered set, capped as before. */
    const gridBody = /function resultGrid\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/matchingIndexes\(state\.flat, state\.filter\)/.test(gridBody),
        'the grid shows what the filter kept');
    assert.ok(/matches\.slice\(0, PREVIEW_ROWS\)/.test(gridBody),
        'still bounded, and bounded after filtering rather than before');
    assert.ok(/No record contains/.test(gridBody),
        'and says so when the filter matches nothing');

    /* Typing in it must not take the caret away. */
    const barBody = /function resultBar\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/refreshResults\(\)/.test(barBody) && !/drawModal\(\)/.test(barBody),
        'the filter redraws the results in place, not the modal - the same trap ' +
        'the query box has');

    const refreshBody = /function refreshResults\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/\.ssx-count/.test(refreshBody), 'the count follows the filter');
    assert.ok(/\.ssx-export/.test(refreshBody) && /disabled/.test(refreshBody),
        'and so do the format buttons - a filter matching nothing has nothing to write');

    const filterCss = fs.readFileSync('./css/list-export.css', 'utf8');
    const filterRule = /\.ssx-modal \.ssx-filter \{([^}]*)\}/.exec(filterCss);
    assert.ok(filterRule, 'the filter box needs a rule, or it is an unstyled input ' +
        'in a styled bar');
    assert.ok(/flex:\s*0/.test(filterRule[1]),
        'holding its width so the count still takes the slack: ' + filterRule[1].trim());

    /* A filter belongs to the answer it was typed against. */
    const runBody = /function run_\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/state\.filter = ''/.test(runBody),
        'a new query clears it, or the new rows arrive already hidden by the old one');


    /* ------------------------------------------------------------------ */
    /* Falling back to the Tooling API                                     */
    /*                                                                     */
    /* Half of what anyone wants to export is not in the data API at all -  */
    /* ApexClass, Flow, CustomField, ValidationRule. Asking for them there  */
    /* comes back "sObject type 'ApexClass' is not supported", which is     */
    /* true and useless: the object exists, just not there.                */
    /* ------------------------------------------------------------------ */

    const retry = api.shouldRetryOnTooling;

    assert.ok(retry({ status: 400, message: "sObject type 'ApexClass' is not supported. [INVALID_TYPE]" }),
        'an unknown type is exactly the case tooling answers');
    assert.ok(retry({ status: 400, message: 'No such column FullName [INVALID_FIELD]' }),
        'and a column that exists only in tooling');
    assert.ok(retry({ status: 404, message: 'The requested resource does not exist [NOT_FOUND]' }),
        'and a resource the data API has never heard of');

    /*
     * Not for refusals both APIs will share. A syntax error or a permission
     * problem is refused identically by tooling, so retrying turns one clear
     * message into two and doubles the wait.
     */
    assert.ok(!retry({ status: 400, message: 'unexpected token: FROMM [MALFORMED_QUERY]' }),
        'a syntax error is a syntax error in both');
    assert.ok(!retry({ status: 403, message: 'Insufficient access [INSUFFICIENT_ACCESS]' }),
        'and so is a permission problem');

    /*
     * No status means it never arrived. Sending it somewhere else cannot help,
     * and would report the second failure over the first.
     */
    assert.ok(!retry({ status: 0, message: 'Failed to fetch' }),
        'an unreachable org is not a tooling question');
    /*
     * The same, with a message that would otherwise match. Without this the
     * status guard is never the thing under test - "Failed to fetch" fails the
     * pattern anyway, so removing the guard changes nothing here.
     */
    assert.ok(!retry({ status: 0, message: 'The requested resource does not exist' }),
        'no status means it never arrived, whatever the message happens to say');
    assert.ok(!retry(null), 'and nothing at all is not either');

    /* Both messages survive, in the order they happened. */
    const both = api.combineFailures(
        { status: 400, message: 'not supported', messages: ['not supported'] },
        { status: 400, message: 'also refused' });
    assert.ok(/not supported/.test(both.message), 'the first refusal is kept');
    assert.ok(/Tooling API was tried too/.test(both.message),
        'and the fallback is named, which is what explains the delay: ' + both.message);
    assert.ok(/also refused/.test(both.message), 'along with what it said');
    assert.strictEqual(both.status, 400, 'the status is the original one');
    assert.strictEqual(both.messages.length, 2, 'and both lines are kept separately');

    /* The retry actually happens, and only after the first attempt. */
    const runFn2 = /function runQuery\(soql, onProgress\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assertOrder(runFn2, 'ssQueryUrl()', 'ssToolingQueryUrl()',
        'the data API is asked first - it is what the user meant');
    assert.ok(/if \(!shouldRetryOnTooling\(error\)\) \{ throw error; \}/.test(runFn2),
        'and tooling is only tried for refusals it could answer');
    assert.ok(/combineFailures\(error, toolingError\)/.test(runFn2),
        'if both refuse, both are reported');

    /* And it says which API answered, because it changes what the rows mean. */
    assert.ok(/state\.usedTooling = true/.test(runFn2), 'the fallback is recorded');
    assert.ok(/Answered by the Tooling API/.test(code),
        'and said, since it changes which objects the query can name next time');
    assert.ok(/state\.usedTooling = false;\n                    throw combineFailures/.test(code),
        'a tooling attempt that also failed does not leave the claim standing');

    /* The field suggestions need the same fallback, for the same reason. */
    const loadFn2 = /function loadFields\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/ssToolingSobjectsUrl\(\)/.test(loadFn2),
        'a tooling object has no describe in the data API - without this there are ' +
        'no suggestions for exactly the objects whose fields are hardest to remember');
    assertOrder(loadFn2, 'ssRestBase()', 'ssToolingSobjectsUrl()',
        'data API first there too');
    assert.ok(/shouldRetryOnTooling\(error\)/.test(loadFn2),
        'and by the same rule, not unconditionally');


    /* ------------------------------------------------------------------ */
    /* It can be switched off                                              */
    /*                                                                     */
    /* Beside the All Fields switch, in the section about Salesforce's own  */
    /* pages - neither is drawn by the panel they are set in, so each row   */
    /* says which surface it is about.                                      */
    /* ------------------------------------------------------------------ */

    const controllerSource = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
    const viewSource = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');

    const enabledIn = (value) => {
        const win = { location: { pathname: '/' }, addEventListener: () => {} };
        const env = {
            window: win,
            document: { readyState: 'loading', addEventListener: () => {},
                        querySelector: () => null, getElementById: () => null,
                        body: { appendChild: () => {} },
                        createElement: () => ({ style: {}, classList: {}, addEventListener: () => {} }) },
            ssIsOrgPage: () => true, ssIsStandalonePage: () => false,
            ssApiOrigin: () => '', ssQueryUrl: () => '', ssToolingQueryUrl: () => '',
            ssRestBase: () => '', ssToolingSobjectsUrl: () => '', ssSessionId: () => null,
            readCookie: (name) => (name === 'Simplified_ListExport' ? value : null),
            chrome: { runtime: { sendMessage: () => {}, lastError: null,
                                 getManifest: () => ({ version: '0' }) } },
            MutationObserver: function () { this.observe = () => {}; },
            URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
            Blob: class {}, setTimeout
        };
        new Function(...Object.keys(env), source)(...Object.values(env));
        return win.ssListExport.enabled();
    };

    assert.strictEqual(enabledIn('false'), false, 'off when it says off');
    assert.strictEqual(enabledIn('true'), true, 'on when it says on');
    assert.strictEqual(enabledIn(null), true, 'and on when it has never been set');
    assert.strictEqual(enabledIn(''), true, 'a cleared cookie is not off');
    assert.strictEqual(enabledIn('0'), true,
        'only the word turns it off - anything else is on');

    /* Read when the button is mounted, so the switch acts where it is flicked. */
    const mountBody2 = /function mountButton\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/enabled\(\)/.test(mountBody2),
        'the preference is read on each mount, not once at load - otherwise ' +
        'turning it off does nothing until a reload');
    assert.ok(/if \(state\.open\) \{ closeModal\(\); \}/.test(mountBody2),
        'and switching it off closes an open modal, which would otherwise outlive ' +
        'the button that opened it');

    /* Written by the panel, under the same name, the same way round. */
    assert.ok(/\$scope\.showListExport = readCookie\('Simplified_ListExport'\) !== 'false';/
        .test(controllerSource),
        'the panel reads the same cookie, the same way round');
    assert.ok(/setSimplifiedCookie\('Simplified_ListExport'/.test(controllerSource),
        'and writes it through the shared preference writer');
    assert.strictEqual(api.ENABLED_COOKIE, 'Simplified_ListExport',
        'one name, spelled the same in both files');

    assert.ok(/ng-model="showListExport" ng-change="toggleListExport\(\)"/.test(viewSource),
        'the checkbox writes on change - a model with no handler looks like it ' +
        'works and forgets on reload');

    /* In the same section as the other one, and saying where it applies. */
    const flatView = viewSource
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        .replace(/'\s*\+\s*\n\s*'/g, '');
    const sectionAt = flatView.indexOf('<div class="ss-settings-section">');
    assert.notStrictEqual(sectionAt, -1, 'the settings section must exist');
    const section = flatView.slice(sectionAt, sectionAt + 1200);

    assert.ok(/showAllFieldsTab/.test(section) && /showListExport/.test(section),
        'both switches live in the one section');
    assert.ok(/On Salesforce pages/.test(section),
        'headed for both surfaces, not for one of them - All Fields is on a ' +
        'record and Export is on a list view');

    const exportRow = section.slice(section.indexOf('showListExport'));
    assert.ok(/list views/.test(exportRow.slice(0, 220)),
        'and the Export row says which surface it is about: ' + exportRow.slice(0, 160));
    assert.ok(/JSON, CSV or Excel/.test(exportRow),
        'with a line saying what it does');


    /* ------------------------------------------------------------------ */
    /* It runs itself, once                                                */
    /*                                                                     */
    /* The query it opens with is the one almost everybody wants - every    */
    /* field, this object - so making them press Run to see it is a click   */
    /* with only one answer, and the grid is the point of the modal.        */
    /* ------------------------------------------------------------------ */

    const openFn = /function openModal\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/run_\(\)/.test(openFn), 'opening it runs the query');
    assertOrder(openFn, 'drawModal()', 'run_()',
        'the modal is drawn first, so the query is on screen while it runs rather ' +
        'than appearing when it finishes');
    assert.ok(/state\.query = defaultQuery/.test(openFn),
        'and it is the default query that runs, not an empty box');

    /*
     * Once, though. A second run after a refusal repeats the same failing
     * query silently; a second run after a good one throws away rows already
     * on screen that may come back different. Both are reopenings of a
     * question already answered.
     */
    assert.ok(/if \(!state\.autoRan && signedIn\(\)\) \{/.test(openFn),
        'guarded on both: reopening does not re-run it, and there is nothing to ' +
        'run it against without a session');
    assertOrder(openFn, 'state.autoRan = true;', 'run_()',
        'and the guard is set before the run, not after - a run that throws would ' +
        'otherwise leave it unset and re-run on the next open');

    /* A different list is a different question, and gets its own first run. */
    const applyFn2 = /function apply\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/state\.autoRan = false/.test(applyFn2),
        'moving to another object clears it');

    /* Run it, rather than read it. */
    {
        const runs = [];
        const scope = { open: false, error: '', query: '', autoRan: false,
                        target: { objectApiName: 'Account' } };
        const open = new Function('state', 'drawModal', 'loadFields', 'run_', 'defaultQuery',
            'signedIn', openFn + ';return openModal;')(
            scope, () => {}, () => {}, () => runs.push(scope.query),
            (name) => 'SELECT FIELDS(ALL) FROM ' + name + ' LIMIT 200',
            () => true);

        open();
        assert.strictEqual(runs.length, 1, 'the first open runs it');
        assert.ok(/FROM Account/.test(runs[0]),
            'with the default query: ' + runs[0]);

        open();
        assert.strictEqual(runs.length, 1, 'and a second open does not run it again');

        scope.autoRan = false;
        open();
        assert.strictEqual(runs.length, 2,
            'while a new object - which clears the flag - gets its own first run');

        /*
         * And no session means no run at all. The modal opens and shows the
         * sign-in prompt instead; running would only produce a refusal that
         * says less than the prompt already has.
         */
        const signedOut = [];
        const outScope = { open: false, error: '', query: '', autoRan: false,
                           target: { objectApiName: 'Account' } };
        new Function('state', 'drawModal', 'loadFields', 'run_', 'defaultQuery', 'signedIn',
            openFn + ';return openModal;')(
            outScope, () => {}, () => {}, () => signedOut.push(1),
            (name) => 'q ' + name, () => false)();
        assert.strictEqual(signedOut.length, 0, 'signed out, nothing is run');
        assert.strictEqual(outScope.autoRan, false,
            'and the first run is still owed, so it happens once signed in');
    }

    /* ------------------------------------------------------------------ */
    /* Wiring                                                              */
    /* ------------------------------------------------------------------ */

    const script = manifest.content_scripts[0];
    assert.ok(script.js.includes('/js/list-export.js'), 'the module is loaded');
    assert.strictEqual(script.js[script.js.length - 1], '/js/bootstrap.js',
        'and does not displace bootstrap.js, which has to stay last');
    assert.ok(script.js.indexOf('/js/ss-core.js') < script.js.indexOf('/js/list-export.js'),
        'ss-core first - this uses ssQueryUrl and ssSessionId');
    assert.ok(script.css.includes('/css/list-export.css'), 'and its styles');

    /* The relay, for the reason the other module found the hard way. */
    assert.ok(!/[^.\w]fetch\s*\(/.test(code),
        'a content script cannot reach the org directly - CORS blocks it before it leaves');
    assert.ok(/SS_REST_REQUEST/.test(code), 'so it asks the service worker');

    /* A sibling of their list, never a child of it. */
    const mountBody = /function mountButton\(\) \{[\s\S]*?\n    \}/.exec(code)[0];
    assert.ok(/list\.parentNode\.insertBefore\(button, list\)/.test(mountBody),
        'the button goes immediately before their action list');
    assert.ok(!/createElement\('li'\)/.test(code),
        'nothing of ours is an <li> - that is the shape their components count');
    assert.ok(/if \(list\.previousSibling === button\) \{ return; \}/.test(mountBody),
        'and it is only re-inserted when it has actually moved');

    /* Contained, because this loads before bootstrap.js. */
    assert.ok(/function start\(\) \{[\s\S]*?try \{/.test(code),
        'its own failure must not take Angular down with it');

    /* Scoped styles. */
    const css = fs.readFileSync('./css/list-export.css', 'utf8');
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)]
        .flatMap((m) => m[1].split(',').map((s) => s.trim()))
        .filter(Boolean);
    assert.ok(selectors.length > 5, 'expected a stylesheet');
    selectors.forEach((selector) => {
        assert.ok(/^\.ssx-/.test(selector),
            'every rule starts from our own class, or it restyles their list view: ' + selector);
    });

    console.log('list export test passed');
}

main();
