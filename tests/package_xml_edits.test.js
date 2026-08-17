/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * A hand-edited package.xml must survive.
 *
 * The manifest is generated from what was ticked, and the generator gets
 * some component types wrong - which is exactly why the textarea is
 * editable. Regenerating over an edit and then retrieving the generated
 * version discards the one statement of intent the user made in words, and
 * does it silently: the retrieve appears to work and fetches the wrong set.
 *
 * The controller is a single 2000-line Angular closure, so this drives the
 * three functions that decide the question - createpkgXmlString,
 * currentPackageXml and regeneratePackageXml - lifted from the shipped
 * source with the collaborators they touch stubbed underneath.
 */

const source = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

function extract(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notStrictEqual(start, -1, 'could not find ' + startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, 'could not find the end of ' + startMarker);
    return source.slice(start, end + endMarker.length);
}

const edited = extract('$scope.packageXmlEdited = false;', '$scope.packageXmlEdited = false;');
const onEdit = extract('$scope.onPackageXmlEdited = function(){', '\n    };');
const regen = extract('$scope.regeneratePackageXml = function(){', '\n    };');
/*
 * The rebuild moved out of createpkgXmlString into a plain function, so that
 * automatic rebuilds - a restore, opening the page - do not count as somebody
 * using package.xml. Both are lifted: the wrapper is what callers reach for,
 * and the body is where the behaviour lives.
 */
const rebuild = extract('function rebuildPackageXml(){', '\n    }');
const create = extract('$scope.createpkgXmlString = function(){', '\n    }');
const current = extract('function currentPackageXml(){', '\n    }');

/*
 * createpkgXmlString saves the selection - it is the one point every path
 * that changes the basket reaches. The real functions are lifted rather than
 * stubbed: a stub of the thing being called is a second implementation, and
 * a permissive one has already made a mutation here look harmless once today.
 */
const selectionKey = extract('function packageSelectionKey(){', '\n    }');
const persist = extract('function persistPackageSelection(){', '\n    }');

let built = 0;
let summaries = 0;

const $scope = { str: '', retrieveState: { error: '' } };
const $q = { when: (v) => Promise.resolve(v) };
const UsageService = { record() {} };
const withApiVersion = () => Promise.resolve('61.0');
function buildPkgXmlString(version) {
    built++;
    $scope.str = '<GENERATED version="' + version + '"/>';
    return $scope.str;
}
function buildPackageFrequency() { summaries++; }

// What persistPackageSelection needs, and nothing more.
$scope.packageMetaTypeAndName = new Map();
const packageSourceMenu = new Map();
const SS_ORIGIN = 'https://acme.my.salesforce.com';
const ssOrgKey = (host) => host.split('.')[0];
const storage = {};
const windowStub = { localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = v; },
    removeItem: (k) => { delete storage[k]; }
} };

// eslint-disable-next-line no-new-func
const api = new Function(
    '$scope', '$q', 'UsageService', 'withApiVersion', 'buildPkgXmlString', 'buildPackageFrequency',
    'packageSourceMenu', 'SS_ORIGIN', 'ssOrgKey', 'window',
    edited + '\n' + onEdit + '\n' + regen + '\n' + rebuild + '\n' + create + '\n' + current +
    '\n' + selectionKey + '\n' + persist +
    '\nreturn { onEdit: $scope.onPackageXmlEdited, regenerate: $scope.regeneratePackageXml,' +
    ' create: $scope.createpkgXmlString, current: currentPackageXml, scope: $scope };'
)($scope, $q, UsageService, withApiVersion, buildPkgXmlString, buildPackageFrequency,
  packageSourceMenu, SS_ORIGIN, ssOrgKey, windowStub);

async function main() {
    /* ------------------------------------------------------------------ */
    /* Untouched: generated, and regenerated as the selection changes      */
    /* ------------------------------------------------------------------ */
    assert.strictEqual(await api.create(), '<GENERATED version="61.0"/>',
        'an untouched manifest is generated from the selection');
    assert.strictEqual(built, 1);

    assert.strictEqual(await api.create(), '<GENERATED version="61.0"/>',
        'and follows the selection on every change');
    assert.strictEqual(built, 2, 'each selection change rebuilds it');

    assert.strictEqual(await api.current(), '<GENERATED version="61.0"/>',
        'what gets retrieved is that generated manifest');

    /* ------------------------------------------------------------------ */
    /* Edited: the user's version stands                                   */
    /* ------------------------------------------------------------------ */
    $scope.str = '<Package><types><members>OnlyThisOne</members><name>ApexClass</name></types></Package>';
    api.onEdit();

    const builtBefore = built;
    const afterSelectionChange = await api.create();
    assert.strictEqual(afterSelectionChange, $scope.str,
        'selecting more metadata must not overwrite a hand-edited manifest');
    assert.strictEqual(built, builtBefore, 'and must not rebuild it behind the scenes');
    assert.ok(summaries > 0,
        'the selection summary still follows the ticks - only the text is left alone');

    /*
     * The bug this exists for: retrieve used to regenerate first, so the
     * edit was discarded and the generated manifest was fetched instead.
     */
    assert.strictEqual(await api.current(), $scope.str,
        'the retrieve must send exactly what is in the textarea');
    assert.strictEqual(built, builtBefore,
        'and must not rebuild on the way there');

    /* ------------------------------------------------------------------ */
    /* Regenerate: going back is deliberate                                */
    /* ------------------------------------------------------------------ */
    const regenerated = await api.regenerate();
    assert.strictEqual(regenerated, '<GENERATED version="61.0"/>',
        'Regenerate replaces the edit with the generated manifest');
    assert.strictEqual(api.scope.packageXmlEdited, false,
        'and hands control back to the selection');

    assert.strictEqual(await api.create(), '<GENERATED version="61.0"/>',
        'after which selection changes drive it again');

    console.log('package.xml edit retention test passed');
}

main().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
