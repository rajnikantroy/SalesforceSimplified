/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * REST Explorer.
 *
 * Everything else in the panel asks one fixed question. This asks whatever is
 * typed, which is what you want the moment the menu has no entry for it - and
 * is otherwise a login to Workbench or a curl command with a session id pasted
 * into it.
 *
 * The part that matters most is the smallest: it takes a path, not a URL. A
 * box that took a URL would send this org's session wherever it was pointed,
 * and the first mistyped host would be a credential leak rather than a 404.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const container = fs.readFileSync('./js/angular/services/MetaDataContainer.js', 'utf8');
const core = fs.readFileSync('./js/ss-core.js', 'utf8');
const directives = fs.readFileSync('./js/angular/directives.js', 'utf8');

function lift(source, signature) {
    const start = source.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') { depth++; }
        else if (source[i] === '}') { depth--; if (depth === 0) { return source.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

function main() {

    /* ------------------------------------------------------------------ */
    /* A path, never a URL                                                 */
    /* ------------------------------------------------------------------ */

    const restUrl = new Function('ssApiOrigin', 'SS_API_VERSION',
        lift(controller, 'function restUrl(path){') + ';return restUrl;')
        (() => 'https://acme.my.salesforce.com', '60.0');

    assert.strictEqual(restUrl('/services/data/v60.0/limits').url,
        'https://acme.my.salesforce.com/services/data/v60.0/limits',
        'a path is made absolute against this org');
    assert.strictEqual(restUrl('services/data').url,
        'https://acme.my.salesforce.com/services/data',
        'and a missing leading slash is added rather than refused');
    assert.strictEqual(restUrl('  /limits  ').url,
        'https://acme.my.salesforce.com/limits', 'trimmed');

    /*
     * Anything with a scheme is refused rather than corrected. "https://..."
     * here means the user meant another host, and rewriting it to this one
     * would answer a question they did not ask.
     */
    for (const typed of ['https://evil.com/steal',
                         'http://acme.my.salesforce.com/services/data',
                         'HTTPS://EVIL.COM',
                         'javascript:alert(1)',
                         'data:text/html,x']) {
        const answer = restUrl(typed);
        assert.ok(answer.error, typed + ' must be refused, not sent');
        assert.ok(!answer.url, typed + ' must not produce a URL at all');
        assert.ok(/Paths only/.test(answer.error),
            'and say why: ' + answer.error);
    }

    /* Nothing typed is a prompt, not a request to the org root. */
    assert.ok(restUrl('').error, 'an empty path is refused');
    assert.ok(restUrl('   ').error, 'and so is whitespace');
    assert.ok(/Enter a path/.test(restUrl('').error), 'with a worked example');

    /* A protocol-relative URL is still another host. */
    assert.ok(restUrl('//evil.com/x').url.indexOf('acme.my.salesforce.com') !== -1,
        'a protocol-relative path stays on this origin: ' + restUrl('//evil.com/x').url);

    /* ------------------------------------------------------------------ */
    /* Bodies, where they mean something                                   */
    /* ------------------------------------------------------------------ */

    const takesBody = (method) => new Function('$scope',
        lift(controller, '$scope.restTakesBody = function(){') + ';return $scope.restTakesBody;')
        ({ rest: { method } })();

    assert.strictEqual(takesBody('GET'), false,
        'a GET has no body - sending one is how a 400 arrives with a message ' +
        'about JSON rather than about the request');
    assert.strictEqual(takesBody('DELETE'), false, 'nor a DELETE');
    for (const method of ['POST', 'PATCH', 'PUT']) {
        assert.strictEqual(takesBody(method), true, method + ' takes one');
    }

    const send = lift(controller, '$scope.sendRest = function(){');
    assert.ok(/JSON\.parse\(\$scope\.rest\.body\)/.test(send),
        'the body is parsed here rather than posted as text');
    assert.ok(/The body is not valid JSON/.test(send),
        'and a bad one is caught before it is sent - the org would refuse it ' +
        'with a parser error about its own copy, which says less');
    assert.ok(/\$scope\.restTakesBody\(\) && \$scope\.rest\.body\.trim\(\)/.test(send),
        'an empty body is no body, not an empty string');

    /* ------------------------------------------------------------------ */
    /* A refusal is an answer                                              */
    /* ------------------------------------------------------------------ */

    assert.ok(/statusText = answer\.ok \? 'OK' : 'Refused'/.test(send),
        'a non-2xx status is labelled, not treated as a failure');
    /*
     * In the success handler specifically. sendRest also clears the error on
     * the way in, so looking for the assignment anywhere in the function
     * passes with the handler setting it from the status.
     */
    const onAnswer = /\}\)\).then\(function\(answer\)\{([\s\S]*?)\}, function\(failure\)\{/.exec(send);
    assert.ok(onAnswer, 'the answer handler must be findable');
    assert.ok(/\$scope\.rest\.error = '';/.test(onAnswer[1]),
        'the error line stays empty for a refusal - the body is where the org ' +
        'says why, and putting a status there instead throws that away: ' +
        onAnswer[1].trim().slice(-120));
    assert.ok(!/rest\.error = answer/.test(onAnswer[1]),
        'and is not derived from the status at all');

    const format = new Function(lift(controller, 'function formatRest(text){') +
        ';return formatRest;')();
    assert.strictEqual(format('{"a":1}'), '{\n  "a": 1\n}', 'JSON is pretty-printed');
    assert.strictEqual(format('<html>nope</html>'), '<html>nope</html>',
        'and anything else is shown verbatim - an HTML error page is still what ' +
        'the org said, and "could not parse" throws away the only evidence');
    assert.strictEqual(format(''), '(no content)', 'an empty 204 says so');

    /* ------------------------------------------------------------------ */
    /* The call itself                                                     */
    /* ------------------------------------------------------------------ */

    const call = lift(core, 'function ssRestCall(spec)');
    assert.ok(/SS_REST_REQUEST/.test(call),
        'it goes through the relay - a content script cannot reach the org directly');
    assert.ok(/if \(!response\.status && response\.error\)/.test(call),
        'and rejects only when the request never left, so a 404 with a message ' +
        'in it arrives as an answer');
    assert.ok(/chrome:\/\/extensions/.test(call),
        'a missing background worker says how to fix it');

    /* ------------------------------------------------------------------ */
    /* Wiring                                                              */
    /* ------------------------------------------------------------------ */

    assert.ok(/label: "REST Explorer"/.test(container), 'the menu entry exists');
    assert.ok(/value: "RestExplorer"/.test(container), 'with a value');
    assert.ok(/'RestExplorer': \d/.test(controller),
        'pinned to the utility bar, or it sorts into the scrolling metadata list');
    assert.ok(/restexplorer: 'restexplorer'/.test(directives), 'the directive is registered');
    assert.ok(/<restexplorer><\/restexplorer>/.test(view), 'and the page is mounted');

    const page = view.slice(view.indexOf('this.restexplorer ='),
                            view.indexOf('\nthis.', view.indexOf('this.restexplorer =') + 10));
    assert.ok(/ng-show="selectedMetadata\.value == \\'RestExplorer\\'"/.test(page),
        'shown only on its own page');
    assert.ok(/ng-show="restTakesBody\(\)"/.test(page),
        'the body box appears only where a body is sent - a box for one that is ' +
        'dropped is a promise the request does not keep');
    assert.ok(/keyCode === 13 && sendRest\(\)/.test(page),
        'Enter sends it, since the path is the field being typed in');

    /* The samples are a starting point, and each carries its own method. */
    const samples = lift(controller, '$scope.restSamples = [');
    assert.ok(/\{v\}/.test(samples),
        'the API version is substituted rather than baked in and going stale');
    const use = lift(controller, '$scope.useRestSample = function(sample){');
    assert.ok(/sample\.path\.replace\('\{v\}', SS_API_VERSION\)/.test(use),
        'at the moment it is used, from the version the org reported');
    assert.ok(/\$scope\.rest\.body = sample\.body \|\| ''/.test(use),
        'and the body is replaced, not left - the previous sample\'s payload would ' +
        'otherwise be posted to this one\'s endpoint');

    console.log('rest explorer test passed');
}

main();
