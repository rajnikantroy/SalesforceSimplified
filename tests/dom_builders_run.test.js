/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The functions that build DOM are executed, not merely matched.
 *
 * Every other test in this suite reads these modules as text. That catches a
 * missing call and a wrong selector, and it cannot catch this:
 *
 *   Uncaught ReferenceError: head is not defined
 *     at js/record-fields.js:949
 *
 * A copy button was appended with head.appendChild in a function whose
 * variable is called bar. new Function(source) parses the file without running
 * a line of it, so the assertion that the button existed passed while the
 * header threw on every open.
 *
 * So each builder is lifted and called against a stub document. What is
 * asserted is only that it runs - the shape of what it builds is somebody
 * else's test - because the failure this exists for is a name that is not
 * there.
 */

const MODULES = {
    'record-fields': {
        source: fs.readFileSync('./js/record-fields.js', 'utf8'),
        builders: ['header', 'errorBlock', 'table', 'row', 'readOnly', 'input', 'note',
                   'signedOutNote']
    },
    'list-export': {
        source: fs.readFileSync('./js/list-export.js', 'utf8'),
        builders: ['modalHead', 'queryBox', 'resultBar', 'resultGrid', 'suggestionStrip',
                   'errorBlock', 'line', 'cell', 'signedOutNote']
    }
};

function lift(source, name) {
    const signature = 'function ' + name + '(';
    const start = source.indexOf(signature);
    if (start === -1) { return null; }
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') { depth++; }
        else if (source[i] === '}') { depth--; if (depth === 0) { return source.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + name);
}

/* Enough of a document to be appended to and read back. */
function stubElement() {
    const el = {
        style: {}, dataset: {}, children: [],
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute() {}, getAttribute: () => null, removeAttribute() {},
        addEventListener() {}, focus() {}, setSelectionRange() {},
        querySelector: () => null, querySelectorAll: () => [],
        appendChild(child) { this.children.push(child); return child; },
        removeChild() {}, insertBefore() {}, replaceChild() {},
        getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }),
        get textContent() { return this._text || ''; },
        set textContent(v) { this._text = v; },
        offsetWidth: 40
    };
    return el;
}

function stubDocument() {
    return {
        readyState: 'complete',
        body: stubElement(),
        addEventListener() {},
        createElement: () => stubElement(),
        createTextNode: (t) => ({ text: t }),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
    };
}

function main() {
    let ran = 0;

    for (const [name, spec] of Object.entries(MODULES)) {
        for (const builder of spec.builders) {
            const body = lift(spec.source, builder);
            assert.ok(body, name + ': no builder called ' + builder +
                ' - if it was renamed, rename it here too rather than losing the cover');

            /*
             * Every free name the builders reach for, stubbed. A missing one
             * would throw the very error this is looking for, so the list is
             * deliberately generous - the point is to reach the body, not to
             * model the module.
             */
            const scope = {
                document: stubDocument(),
                Option: function (label, value) { return { label, value }; },
                state: {
                    model: [{ name: 'Name', label: 'Name', type: 'string', value: 'x',
                              readable: true, editable: true, options: [], length: 80 }],
                    columns: ['Name'], flat: [{ Name: 'x' }], rows: [{ Name: 'x' }],
                    edits: {}, errorList: ['e'], error: 'e', errorStatus: 400,
                    filter: '', query: 'SELECT Id FROM Account', fields: [],
                    saved: '', canEdit: true, running: false, loading: false,
                    record: { Id: '1' }, copied: false, caret: 0,
                    target: { objectApiName: 'Account', recordId: '001' }
                },
                changedPayload: () => ({}),
                matchingIndexes: (rows) => (rows || []).map((_, i) => i),
                countText: () => 'n records ready',
                currentToken: () => ({ start: 0, end: 0, value: '' }),
                suggestFields: () => [],
                isBlank: (v) => v === null || v === undefined || v === '',
                inputType: () => 'text',
                typeMark: () => 'A',
                refreshSaveButton() {}, renderRows() {}, save() {}, run_() {},
                closePanel() {}, closeModal() {}, download() {}, copyRecord() {},
                pickField() {}, refreshResults() {}, drawSuggestions() {},
                fillSuggestions() {}, cell: () => stubElement(),
                line: () => stubElement(), note: () => stubElement(),
                row: () => stubElement(), input: () => stubElement(),
                readOnly: () => stubElement(), errorBlock: () => stubElement(),
                PREVIEW_ROWS: 200, MODAL_ID: 'm', PANEL_ID: 'p',
                tabTitle: () => 't'
            };

            const call = builder === 'cell' ? "cell('td', 'x')"
                : builder === 'note' ? "note('c', 'x')"
                : builder === 'line' ? "line('c', 'x')"
                : builder === 'row' || builder === 'readOnly' || builder === 'input'
                    ? builder + '(state.model[0])'
                    : builder + '()';

            try {
                new Function(...Object.keys(scope), body + ';return ' + call + ';')
                    (...Object.values(scope));
            } catch (error) {
                assert.fail(name + ': ' + builder + '() threw when run - ' +
                    'this is exactly the class of fault a text assertion cannot see: ' +
                    error.message);
            }
            ran++;
        }
    }

    assert.ok(ran >= 16, 'expected every builder to be exercised, ran ' + ran);
    console.log('dom builders run test passed (' + ran + ' builders)');
}

main();
