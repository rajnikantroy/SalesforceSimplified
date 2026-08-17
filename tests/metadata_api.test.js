/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/*
 * MetadataApiService regression tests - retrieving a deployable package.
 *
 * The zip itself comes from the org, so what is worth pinning here is the
 * translation on either side of it:
 *
 *   - the manifest the user is looking at becomes the <unpackaged> block, so
 *     what gets retrieved is what the textarea says, escaping and all;
 *   - checkRetrieveStatus is read correctly, including the cases where the
 *     org reports problems but still returns a package.
 */

const factories = {};
const context = {
    window: {},
    angular: { module: () => ({ service(name, deps) { factories[name] = deps[deps.length - 1]; } }) },
    // ss-core globals the service builds its URLs and auth from.
    ssApiOrigin: () => 'https://acme.my.salesforce.com',
    SS_API_VERSION: '62.0',
    ssSessionId: () => 'session-token',
    DOMParser: require('util').types ? undefined : undefined,
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } },
    Uint8Array: Uint8Array,
    Date: Date
};

// A minimal XML DOM: enough for getElementsByTagName(NS) over a manifest.
// Node has no DOMParser, and pulling one in for four element types would be a
// dependency for a test rather than for the product.
context.DOMParser = class {
    parseFromString(text) {
        function collect(tag) {
            const out = [];
            const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
            let m;
            while ((m = re.exec(text)) !== null) { out.push(m[1]); }
            return out;
        }
        // A real DOMParser decodes entities on the way out; without this the
        // fake would hand escapeXml an already-escaped string and the test
        // would happily accept double-escaped output the browser never sees.
        function decode(x) {
            return x.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                    .replace(/&amp;/g, '&');
        }
        function node(inner) {
            return {
                textContent: decode(inner),
                getElementsByTagName: (tag) => {
                    const out = [];
                    const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
                    let m;
                    while ((m = re.exec(inner)) !== null) { out.push(node(m[1])); }
                    return out;
                }
            };
        }
        /*
         * Well-formedness, the one thing a real DOMParser reports that a
         * regex scraper otherwise would not. Without it the fake accepted an
         * unclosed tag, and the "not valid XML" branch was never exercised.
         */
        function malformed(xml) {
            if (/^\s*$/.test(xml)) { return true; }
            const stack = [];
            const re = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
            let m;
            while ((m = re.exec(xml)) !== null) {
                const [, closing, name, attrs, selfClose] = m;
                if (attrs.indexOf('?') === 0 || name === 'xml') { continue; }
                if (selfClose) { continue; }
                if (closing) {
                    if (stack.pop() !== name) { return true; }
                } else {
                    stack.push(name);
                }
            }
            return stack.length > 0;
        }
        const parseError = malformed(text.replace(/<\?[\s\S]*?\?>/g, ''));
        return {
            getElementsByTagName: (tag) => {
                if (tag === 'parsererror') { return parseError ? [node('')] : []; }
                return collect(tag).map(node);
            },
            getElementsByTagNameNS: (ns, tag) =>
                text.indexOf('http://soap.sforce.com/2006/04/metadata') === -1
                    ? []
                    : collect(tag).map(node)
        };
    }
};

vm.runInNewContext(
    fs.readFileSync('./js/angular/services/MetadataApiService.js', 'utf8'),
    context
);

const $q = Object.assign(v => Promise.resolve(v), {
    when: v => Promise.resolve(v),
    reject: v => Promise.reject(v),
    defer() {
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
    }
});
const $timeout = (fn) => Promise.resolve().then(fn);

const service = new factories.MetadataApiService($q, $timeout);

const MANIFEST =
`<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
\t<types>
\t\t<members>AccountController</members>
\t\t<members>Billing &amp; Invoicing</members>
\t\t<name>ApexClass</name>
\t</types>
\t<types>
\t\t<members>Account.Rating__c</members>
\t\t<name>CustomField</name>
\t</types>
\t<version>61.0</version>
</Package>`;

function main() {
    /* ------------------------------------------------------------------ */
    /* The manifest becomes the retrieve request                           */
    /* ------------------------------------------------------------------ */
    const unpackaged = service.buildUnpackaged(MANIFEST);
    assert.ok(unpackaged, 'a manifest with components should produce a request');
    assert.strictEqual(unpackaged.members, 3, 'every member should carry across');
    assert.strictEqual(unpackaged.version, '61.0',
        "the manifest's own version wins - it is what the user is looking at");

    assert.ok(unpackaged.xml.indexOf('<met:name>ApexClass</met:name>') !== -1,
        'types should be namespaced for the envelope');
    assert.ok(unpackaged.xml.indexOf('<met:members>AccountController</met:members>') !== -1,
        'members should be namespaced too');
    assert.ok(unpackaged.xml.indexOf('<met:version>61.0</met:version>') !== -1,
        'the version belongs inside unpackaged');

    /*
     * A component name containing XML must survive as one member, escaped
     * exactly once. Escaping it twice would ask the org for a component
     * literally called "Billing &amp; Invoicing", which does not exist.
     */
    assert.ok(unpackaged.xml.indexOf('<met:members>Billing &amp; Invoicing</met:members>') !== -1,
        'an ampersand should be escaped exactly once: ' + unpackaged.xml);
    assert.strictEqual(unpackaged.xml.indexOf('&amp;amp;'), -1,
        'and never double-escaped');

    /* ------------------------------------------------------------------ */
    /* Nothing to retrieve is not a request worth making                   */
    /* ------------------------------------------------------------------ */
    /*
     * The editor is free text, so the failure has to name which kind of wrong
     * it is. "Nothing selected" told someone staring at a typo the opposite
     * of what was true.
     */
    const empty = service.buildUnpackaged('');
    assert.ok(empty.error, 'an empty manifest should not become a retrieve');

    const broken = service.buildUnpackaged('<Package><types><members>A</members>');
    assert.ok(broken.error, 'unparseable XML should not become a retrieve');
    assert.ok(/validation failed/i.test(broken.error),
        'and should say validation failed: ' + broken.error);
    assert.ok(/not valid XML/i.test(broken.error),
        'naming the actual problem rather than the selection: ' + broken.error);

    const noTypes = service.buildUnpackaged('<?xml version="1.0"?><Package xmlns="http://soap.sforce.com/2006/04/metadata"><version>62.0</version></Package>');
    assert.ok(noTypes.error, 'a manifest with no types should not become a retrieve');
    assert.ok(/not a correct package\.xml/i.test(noTypes.error),
        'and should say so plainly: ' + noTypes.error);

    const noMembers = service.buildUnpackaged('<Package xmlns="http://soap.sforce.com/2006/04/metadata"><types><name>ApexClass</name></types><version>62.0</version></Package>');
    assert.ok(noMembers.error, 'a type with no members asks for nothing');
    assert.ok(/members/i.test(noMembers.error),
        'and should point at the missing members: ' + noMembers.error);

    /* ------------------------------------------------------------------ */
    /* Reading checkRetrieveStatus                                         */
    /* ------------------------------------------------------------------ */
    const pending = service.parseRetrieveStatus(
        '<soapenv:Body><result><done>false</done><id>09S1</id><status>Pending</status></result></soapenv:Body>');
    assert.strictEqual(pending.done, false, 'a queued retrieve is not done');
    assert.strictEqual(pending.status, 'Pending', 'and reports the stage it is at');
    assert.ok(!pending.error, 'a queued retrieve is not an error');

    const succeeded = service.parseRetrieveStatus(
        '<result><done>true</done><status>Succeeded</status><zipFile>UEsDBAo=</zipFile></result>');
    assert.strictEqual(succeeded.done, true);
    assert.strictEqual(succeeded.zipFile, 'UEsDBAo=', 'the package comes back as base64');
    assert.ok(!succeeded.error, 'a successful retrieve carries no error');

    /*
     * Partial success: the org returns a package AND says what it left out.
     * Reporting only the zip would hand over a package quietly missing
     * pieces, which is the failure that costs someone a deployment.
     */
    const partial = service.parseRetrieveStatus(
        '<result><done>true</done><status>Succeeded</status>' +
        '<messages><fileName>classes/Secret.cls</fileName><problem>Not found</problem></messages>' +
        '<messages><fileName>objects/Ghost__c.object</fileName><problem>No access</problem></messages>' +
        '<zipFile>UEsDBAo=</zipFile></result>');
    assert.strictEqual(partial.problems.length, 2, 'every reported problem should surface');
    assert.strictEqual(partial.problems[0], 'classes/Secret.cls: Not found',
        'a problem should name the file it belongs to');
    assert.ok(!partial.error,
        'a package that arrived is not a failure - the problems are shown beside it');

    const failed = service.parseRetrieveStatus(
        '<result><done>true</done><status>Failed</status>' +
        '<messages><problem>INVALID_TYPE: Unknown metadata type</problem></messages></result>');
    assert.ok(failed.error, 'a failed retrieve must report an error');
    assert.ok(/Unknown metadata type/.test(failed.error),
        "and should use the org's own words: " + failed.error);

    /* ------------------------------------------------------------------ */
    /* base64 -> zip                                                       */
    /* ------------------------------------------------------------------ */
    // "PK\x03\x04" - the zip magic number, so a real package is recognisable.
    const blob = service.zipBlob('UEsDBAoAAAAAAA==');
    assert.strictEqual(blob.type, 'application/zip', 'the download should be typed as a zip');
    const first = blob.parts[0];
    assert.strictEqual(first[0], 0x50, 'byte 0 should be P');
    assert.strictEqual(first[1], 0x4b, 'byte 1 should be K');
    assert.strictEqual(first[2], 0x03, 'byte 2 should be 0x03');
    assert.strictEqual(first[3], 0x04, 'byte 3 should be 0x04');

    // A package larger than one chunk must not lose or reorder bytes.
    const big = Buffer.alloc(20000);
    for (let i = 0; i < big.length; i++) { big[i] = i % 256; }
    const bigBlob = service.zipBlob(big.toString('base64'));
    const total = bigBlob.parts.reduce((n, p) => n + p.length, 0);
    assert.strictEqual(total, big.length, 'a chunked package should keep every byte');
    assert.strictEqual(bigBlob.parts[0][0], 0, 'and keep them in order');
    assert.strictEqual(bigBlob.parts[1][0], 8192 % 256, 'across the chunk boundary too');

    console.log('metadata api regression test passed');
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
