/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The manifest document itself.
 *
 * buildPkgXmlString produces the text the user sees in the editor, downloads
 * as Package.xml, and retrieves with - and the retrieve re-reads that same
 * text with DOMParser before sending anything. So a document this function
 * gets wrong is not a cosmetic problem: it fails its own validation and
 * reports "this is not valid XML, check for a stray character in the editor
 * below", which blames the user for a string the extension generated.
 *
 * Lifted out of the controller the same way package_member_names does it, so
 * the assertions run against the shipped source rather than a copy.
 */

const source = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

function extract(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notStrictEqual(start, -1, 'could not find ' + startMarker + ' in the controller');
    const end = source.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, 'could not find the end of ' + startMarker);
    return source.slice(start, end) + endMarker;
}

const pieces = [
    extract('function escapeXmlText(value){', '\n    }'),
    extract('function resolveMemberName(member){', '\n    }'),
    extract('function buildPackageFrequency(){', '\n    }'),
    /*
     * The real manifestProvenance, not a stub. It decides what the file
     * discloses about its own completeness - the thing this test is about -
     * and leaving it out is a ReferenceError inside the builder.
     */
    extract('function manifestProvenance(){', '\n    }'),
    extract('function buildPkgXmlString(apiVersion){', '\n    }')
].join('\n');

function build(types, entityNames) {
    const $scope = {
        packageMetaTypeAndName: new Map(),
        objectEntityIdNameMap: new Map(Object.entries(entityNames || {}))
    };
    for (const [type, members] of Object.entries(types)) {
        $scope.packageMetaTypeAndName.set(type, new Map(Object.entries(members)));
    }
    // eslint-disable-next-line no-new-func
    const fn = new Function('$scope', 'ssPackageApiVersion',
        pieces + '\nreturn buildPkgXmlString;')($scope, (v) => v || '62.0');
    return { xml: fn('62.0'), $scope: $scope };
}

// What the file has to survive: being read back as XML. A hand-rolled reader
// would agree with whatever this function does, which is the one thing worth
// not assuming - so this checks the properties a parser actually enforces.
function membersOf(xml, type) {
    const block = xml.split('<types>').find((b) => b.includes('<name>' + type + '</name>'));
    if (!block) { return []; }
    return (block.match(/<members>([\s\S]*?)<\/members>/g) || [])
        .map((m) => m.replace(/<\/?members>/g, ''));
}

function main() {

    /* ------------------------------------------------------------------ */
    /* Names that are legal in Salesforce and illegal in raw XML           */
    /*                                                                     */
    /* API names are alphanumeric, but the labels hanging off an object    */
    /* are free text: a layout may be called "Sales & Service <Primary>".  */
    /* Written raw, Chrome's DOMParser reports parsererror and hands back  */
    /* an empty member - verified in a browser, not assumed here.          */
    /* ------------------------------------------------------------------ */

    const awkward = build({
        Layout: { '00h1': 'Account-Sales & Service <Primary>' }
    }).xml;

    assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(awkward),
        'a bare ampersand must not reach the document');
    assert.ok(!/<members>[^<]*<[^/]/.test(awkward),
        'a bare angle bracket must not reach the document');
    assert.deepStrictEqual(membersOf(awkward, 'Layout'),
        ['Account-Sales &amp; Service &lt;Primary&gt;'],
        'the awkward characters survive as entities, not as markup');

    // Escaping is only correct if it round-trips: the retrieve reads the
    // member back out and sends what it finds, so an over-escaped document
    // would deploy a component named "Sales &amp; Service".
    const decoded = membersOf(awkward, 'Layout')[0]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.strictEqual(decoded, 'Account-Sales & Service <Primary>',
        'decoding the member must give back exactly the original name');

    // The ampersand has to be escaped before the brackets, or the entities
    // the other two produce get their own ampersand escaped again.
    assert.ok(!/&amp;lt;|&amp;gt;|&amp;amp;/.test(awkward),
        'entities must not be double-escaped');

    /* ------------------------------------------------------------------ */
    /* The same component, reached two ways                                */
    /*                                                                     */
    /* A field can be ticked by hand and pulled in again as an object's or  */
    /* a permission set's dependency. They are held under different keys -  */
    /* a record id and a dep: key - so only the member text can tell that   */
    /* they are the same component.                                        */
    /* ------------------------------------------------------------------ */

    const doubled = build({
        CustomField: {
            '00N1': 'Account.Rating__c',
            'dep:CustomField|Account.Rating__c': 'Account.Rating__c',
            '00N2': 'Account.Tier__c'
        }
    }).xml;

    assert.deepStrictEqual(membersOf(doubled, 'CustomField'),
        ['Account.Rating__c', 'Account.Tier__c'],
        'a component reached twice is named once');

    /* ------------------------------------------------------------------ */
    /* Stable order                                                        */
    /*                                                                     */
    /* The hint under the button offers this as something to "commit as it  */
    /* is". A manifest whose member order follows Map insertion rewrites    */
    /* itself into a noisy diff every time the selection is rebuilt.        */
    /* ------------------------------------------------------------------ */

    const unordered = build({
        ApexClass: { c: 'Zebra', a: 'Alpha', b: 'Mango' }
    }).xml;
    assert.deepStrictEqual(membersOf(unordered, 'ApexClass'),
        ['Alpha', 'Mango', 'Zebra'], 'members are sorted, not insertion-ordered');

    /* ------------------------------------------------------------------ */
    /* Entity ids become the names they deploy as                          */
    /* ------------------------------------------------------------------ */

    const resolved = build(
        { CustomField: { '00N1': '01I000000000001.Rating__c' } },
        { '01I000000000001': 'Invoice__c' }
    ).xml;
    assert.deepStrictEqual(membersOf(resolved, 'CustomField'), ['Invoice__c.Rating__c'],
        'the owner half of a member is swapped for the name it deploys as');

    /*
     * Only a member that splits cleanly in two is taken apart. A layout whose
     * own name contains a hyphen must survive intact - splitting it at the
     * wrong place produces a member the Metadata API cannot find, and the
     * retrieve comes back quietly missing it.
     */
    // The owner map holds identity entries for names as well as id entries,
    // so "Account" really does resolve - which is what makes a greedy split
    // dangerous rather than merely untidy. Splitting at the first hyphen here
    // would emit "Account-Sales" and silently drop the rest of the name.
    const hyphenated = build(
        { Layout: { '00h1': 'Account-Sales-EMEA Layout' } },
        { Account: 'Account' }
    ).xml;
    assert.deepStrictEqual(membersOf(hyphenated, 'Layout'), ['Account-Sales-EMEA Layout'],
        'a name with more than one separator is left alone');

    /* ------------------------------------------------------------------ */
    /* Shape                                                               */
    /* ------------------------------------------------------------------ */

    const shaped = build({
        ApexClass: { a: 'Alpha' },
        Empty: {},
        // packageMemberName returns '' for a record carrying no name at all,
        // so a type can be non-empty and still have nothing to say. An empty
        // <members/> fails buildUnpackaged's own validation.
        Nameless: { x: '', y: '' },
        CustomField: { b: 'Account.Rating__c' }
    });

    assert.ok(!/<name>Empty<\/name>/.test(shaped.xml),
        'a type with nothing selected contributes no block');
    assert.ok(!/<name>Nameless<\/name>/.test(shaped.xml),
        'a type whose members are all blank contributes no block');
    assert.ok(!/<members><\/members>/.test(shaped.xml),
        'a blank member is never written');

    // Every types block needs its name, and the version closes the document -
    // buildUnpackaged rejects a manifest missing either.
    assert.strictEqual((shaped.xml.match(/<types>/g) || []).length,
                       (shaped.xml.match(/<name>/g) || []).length,
        'every types block carries exactly one name');
    assert.ok(/<version>62\.0<\/version>\s*<\/Package>/.test(shaped.xml),
        'the version is the last thing before the close');

    // The summary counts what is ticked, so it is allowed to differ from the
    // deduplicated member count - but it must still have been rebuilt.
    assert.ok(shaped.$scope.packageMetaDataFrequency.length === 3,
        'the frequency summary counts what is ticked, skipping only the empty type');

    console.log('package xml document regression test passed');
}

main();
