/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * The shared panel body, and what it is allowed to cost.
 *
 * Every surface compiles SS_PANEL_BODY - the injected panel and
 * simplified.html both - so anything wrong in it fails everywhere at once
 * rather than on one screen.
 *
 * There are no nested controllers in the templates today. The rules about
 * them are kept anyway, and skipped when there are none, because the last
 * time one was added it was wired with ng-show: the controller was then
 * constructed on every page load whether or not anyone opened its panel, it
 * threw, and the whole extension stopped working. A guard that only exists
 * while the mistake is present is a guard that is missing when it is made
 * again.
 *
 * So the rules this enforces are narrow and specific:
 *
 *   1. a panel controller is reached through ng-if, never ng-show, so it is
 *      constructed when selected and not before
 *   2. every controller named in a template is registered, and registered
 *      before bootstrap runs
 *   3. every service any registered controller injects is loaded on every
 *      surface that compiles the body
 *
 * Rule 3 used to be scoped to controllers named in a template, and there are
 * none - so it iterated an empty list and passed unconditionally. The main
 * controller injects a dozen services and not one of them was being checked,
 * which is precisely the case the rule exists for: a service injected but
 * never loaded is an Unknown provider, and that aborts the digest and leaves
 * the whole panel blank. The set that matters is every controller the
 * manifest registers, not the subset a template happens to name.
 */

const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
const standalone = fs.readFileSync('./simplified.html', 'utf8');

const contentScripts = manifest.content_scripts[0].js;

function main() {

    /* ------------------------------------------------------------------ */
    /* 1. Panel controllers are gated on ng-if                             */
    /* ------------------------------------------------------------------ */

    const controllerUses = [...view.matchAll(/ng-controller="(\w+)"/g)].map((m) => m[1]);

    for (const name of controllerUses) {
        /*
         * Matched by line rather than by a quoted-string regex: these
         * templates are JavaScript string literals containing escaped quotes,
         * so a [^']* run stops at the first \' and never reaches the
         * attribute being looked for.
         *
         * The element carrying ng-controller must also carry ng-if. Angular
         * evaluates ng-if first - it has the higher priority - so the
         * controller is constructed only once the condition is true.
         */
        const lines = view.split('\n').filter((line) =>
            line.includes('ng-controller="' + name + '"'));
        assert.ok(lines.length, 'could not find the element declaring ' + name);
        const markup = lines.join(' ');

        assert.ok(/ng-if=/.test(markup),
            name + ' must be gated on ng-if - with ng-show it is constructed on ' +
            'every page load, and anything it throws takes the whole app down');
        assert.ok(!/ng-show=/.test(markup),
            name + ' must not use ng-show for its own gate');
    }

    /* ------------------------------------------------------------------ */
    /* 2. Every named controller is registered, before bootstrap           */
    /* ------------------------------------------------------------------ */

    const registered = Object.create(null);
    for (const file of contentScripts) {
        if (!/controllers\//.test(file)) { continue; }
        const source = fs.readFileSync('.' + file, 'utf8');
        for (const match of source.matchAll(/app\.controller\('(\w+)'/g)) {
            registered[match[1]] = file;
        }
    }

    for (const name of controllerUses) {
        assert.ok(registered[name],
            name + ' is named in a template but no content script registers it - ' +
            'Angular fails the whole compile on an unknown controller');
        assert.ok(contentScripts.indexOf(registered[name]) <
                  contentScripts.indexOf('/js/bootstrap.js'),
            registered[name] + ' must load before bootstrap.js, or the controller ' +
            'is registered after Angular has already compiled');
    }

    // simplified.html compiles the same body, so it needs the same files.
    for (const name of controllerUses) {
        const file = registered[name].replace(/^\//, '');
        assert.ok(standalone.includes(file),
            'simplified.html must load ' + file + ' - it compiles the same body as the panel');
        assert.ok(standalone.indexOf(file) < standalone.indexOf('js/simplified.js'),
            file + ' must load before simplified.js bootstraps');
    }

    /* ------------------------------------------------------------------ */
    /* 3. Everything those controllers inject is available                 */
    /* ------------------------------------------------------------------ */

    // Angular reserves the $ prefix for its own services and per-controller
    // locals, and nothing in this codebase registers one - so the prefix is a
    // more reliable test than a hand-kept list, which had already gone stale
    // and reported $filter as a missing provider.
    const isBuiltIn = (name) => name.charAt(0) === '$';

    const provided = Object.create(null);
    for (const file of contentScripts) {
        if (!/services\//.test(file)) { continue; }
        const source = fs.readFileSync('.' + file, 'utf8');
        for (const match of source.matchAll(/app\.(?:service|factory)\('(\w+)'/g)) {
            provided[match[1]] = file;
        }
    }

    /*
     * Driven from what the manifest registers, not from what a template names.
     * Both declaration styles are read: the array form Angular needs to
     * survive minification, and the bare function this codebase actually uses,
     * whose parameter names are the injector's only clue.
     */
    const controllerNames = Object.keys(registered);
    assert.ok(controllerNames.length,
        'no controllers found in the content scripts - this check has nothing to ' +
        'verify, which is how it silently passed while a service was missing');

    let checkedDeps = 0;
    for (const name of controllerNames) {
        const source = fs.readFileSync('.' + registered[name], 'utf8');

        const asArray = source.match(
            new RegExp("app\\.controller\\('" + name + "',\\s*\\[([^\\]]*)\\]"));
        const asFunction = source.match(
            new RegExp("app\\.controller\\('" + name + "',\\s*function\\s*\\(([^)]*)\\)"));

        const deps = asArray
            ? [...asArray[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
            : (asFunction ? asFunction[1].split(',').map((raw) => raw.trim()).filter(Boolean) : null);

        assert.ok(deps, name + ' declares its dependencies in a form this cannot read - ' +
            'if the declaration changed, this check stops protecting it');

        for (const dep of deps) {
            if (isBuiltIn(dep)) { continue; }
            checkedDeps++;
            assert.ok(provided[dep],
                name + ' injects ' + dep + ', which no content script provides - ' +
                'Angular fails the compile with Unknown provider, the digest aborts, ' +
                'and the panel renders blank');
            assert.ok(standalone.includes(provided[dep].replace(/^\//, '')),
                'simplified.html must load ' + provided[dep] + ' for ' + name +
                ' - it compiles the same body, so a service missing here blanks that page only');
        }
    }

    // A count, so this cannot quietly go back to verifying nothing.
    assert.ok(checkedDeps >= 10,
        'expected the controllers to inject a good number of services, checked only ' +
        checkedDeps + ' - a parse that silently matches nothing looks exactly like a pass');

    /* ------------------------------------------------------------------ */
    /* Every directive the body renders is registered                      */
    /* ------------------------------------------------------------------ */

    const directives = fs.readFileSync('./js/angular/directives.js', 'utf8');
    const bodyStart = view.indexOf('var SS_PANEL_BODY');
    const body = view.slice(bodyStart, view.indexOf('var SS_PANEL_FOOTER', bodyStart));

    for (const match of body.matchAll(/<([a-z][a-z0-9]{3,})><\/\1>/g)) {
        assert.ok(directives.includes("'" + match[1] + "'"),
            '<' + match[1] + '> is rendered in the panel body but not registered as a ' +
            'directive - it renders as nothing at all');
    }

    console.log('panel compile regression test passed' +
        (controllerUses.length ? '' : ' (no nested controllers to check)'));
}

main();
