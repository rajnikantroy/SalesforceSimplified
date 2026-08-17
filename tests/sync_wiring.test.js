/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/*
 * The sync feature's wiring, as opposed to its logic.
 *
 * tests/sync_engine.test.js runs the engine's own functions and is where the
 * behaviour is proved. This file exists because every runtime failure in this
 * extension so far has been wiring rather than logic: a script not in the
 * manifest, a directive never registered, a template bound to a scope member
 * that does not exist, a message type sent to a worker with no handler for
 * it. None of those are visible to a test of the functions themselves.
 */

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/*
 * One handler's code, bounded by the next handler rather than by whichever
 * one happens to follow it today.
 *
 * Slicing "from SS_SYNC_STAGE_DATA to SS_SYNC_APPLY" broke the moment a new
 * handler was inserted between them: the slice swallowed it, and an
 * assertion that staging must not run a job started reading a handler whose
 * whole purpose is to run one.
 */
function handlerFor(source, type) {
    const start = source.indexOf("message.type === '" + type + "'");
    assert.ok(start > -1, 'no handler for ' + type);
    const next = source.indexOf('if (message.type ===', start + 10);
    return source.slice(start, next === -1 ? source.length : next);
}

const engine = read('js/sync-engine.js');
const background = read('js/background.js');
const service = read('js/angular/services/PipelineService.js');
const controller = read('js/angular/controllers/MenuAndDetailsCtrl.js');
const view = read('js/angular/services/ViewService.js');
const css = read('css/styles.css');
const directives = read('js/angular/directives.js');
const container = read('js/angular/services/MetaDataContainer.js');
const manifest = JSON.parse(read('manifest.json'));
const standalone = read('simplified.html');

/* ------------------------------------------------------------------ */
/* The engine reaches the worker at all                                */
/* ------------------------------------------------------------------ */

assert.ok(/importScripts\(['"]\/js\/sync-engine\.js['"]\)/.test(background),
    'background.js must load the engine - without this every sync message ' +
    'answers "the sync engine is not loaded"');

/*
 * The engine calls soapRequest, which lives in background.js. That only works
 * because importScripts shares one scope; if the engine ever grows its own
 * fetch it loses the host guard that keeps a session on-org.
 */
assert.ok(/soapRequest\(/.test(engine), 'the engine posts through background.js\'s relay');
assert.ok(!/\bfetch\s*\(/.test(engine),
    'the engine must not fetch directly - soapRequest holds the guard that ' +
    'refuses to send a Salesforce session off-org');

/* ------------------------------------------------------------------ */
/* Every message sent has a handler, and every handler is reachable    */
/* ------------------------------------------------------------------ */

const sent = [...new Set([...service.matchAll(/type:\s*'(SS_SYNC_\w+)'/g)].map((m) => m[1]))];
assert.ok(sent.length >= 6, 'expected the service to send several sync messages, found ' + sent.length);

const handled = [...new Set([...background.matchAll(/message\.type === '(SS_SYNC_\w+)'/g)]
    .map((m) => m[1]))];

const unhandled = sent.filter((type) => !handled.includes(type));
assert.deepStrictEqual(unhandled, [],
    'the panel sends sync messages the worker does not handle: ' + unhandled.join(', '));

const unsent = handled.filter((type) => !sent.includes(type));
assert.deepStrictEqual(unsent, [],
    'the worker handles sync messages nothing sends: ' + unsent.join(', '));

/* The dispatcher only sees these at all if the prefix test routes them. */
assert.ok(/message\.type\.indexOf\('SS_SYNC_'\) === 0/.test(background),
    'the listener must route SS_SYNC_* to the sync dispatcher');

/* ------------------------------------------------------------------ */
/* The alarm - the whole reason a deploy survives the worker           */
/* ------------------------------------------------------------------ */

/*
 * A Manifest V3 worker is killed after ~30 seconds idle and a deploy takes
 * minutes. Without this listener the job stays 'running' forever while the
 * org has long since finished, which is the worst of the wrong answers: the
 * deploy landed and the history says it did not.
 */
const alarmBlock = background.slice(background.indexOf('chrome.alarms.onAlarm.addListener'));
assert.ok(/alarm\.name === SS_SYNC_ALARM/.test(alarmBlock),
    'the alarm listener must recognise the sync alarm');
assert.ok(/ssSyncSweep\(\)/.test(alarmBlock), 'and run the sweep when it fires');

assert.ok(/chrome\.alarms\.create\(SS_SYNC_ALARM/.test(engine), 'the engine arms its alarm');
assert.ok(/chrome\.alarms\.clear\(SS_SYNC_ALARM/.test(engine),
    'and clears it - a periodic alarm nothing is waiting on wakes the worker ' +
    'every minute for the life of the browser');

/*
 * Armed from inside ssSyncRun, after the job becomes running. Arming it from
 * the caller before the run finds no running job and clears itself, and
 * arming it after the run is too late: the worker may already be dead.
 */
const runBody = engine.slice(engine.indexOf('async function ssSyncRun'),
    engine.indexOf('async function ssSyncFinish'));
assert.ok(/ssSyncArmAlarm\(\)/.test(runBody),
    'ssSyncRun must arm the alarm itself, before the first call that can outlive the worker');
assert.ok(runBody.indexOf('ssSyncArmAlarm()') < runBody.indexOf('ssSyncRetrieve('),
    'and arm it before the retrieve starts, not after');

assert.ok(manifest.permissions.includes('alarms'), 'alarms permission');
assert.ok(manifest.permissions.includes('cookies'),
    'cookies permission - reading the second org\'s sid is how a pipeline has ' +
    'two sessions at once');

/* ------------------------------------------------------------------ */
/* Credentials: two files agreeing on a shape                          */
/* ------------------------------------------------------------------ */

/*
 * The engine reads the saved OAuth token that background.js wrote. Nothing
 * connects the two but the field names, and a rename on the writing side
 * would leave the reader quietly finding nothing - every job blocked on
 * "not signed in" while the token sits right there.
 */
/*
 * Tokens are stored per org now - ssAuthOrgs, keyed by the org's host - with
 * the old single ssAuth record still read for a browser that has not written
 * the map yet. Both keys are asserted on both sides.
 */
assert.ok(/ssSyncRead\('ssAuthOrgs'/.test(engine),
    'the engine does not read the per-org token store');
assert.ok(/ssSyncRead\('ssAuth'/.test(engine),
    'the engine no longer reads the old single record, so a browser that has ' +
    'not signed in since the change loses its token');
assert.ok(/const TOKENS_KEY = 'ssAuthOrgs'/.test(background),
    'which is the key background.js writes');
assert.ok(/const TOKEN_KEY = 'ssAuth'/.test(background),
    'and the old key it migrates from');

/*
 * The field names, in the engine's credential path. Read there rather than
 * anywhere in the file, and by field rather than by the variable that holds
 * them - the reader was renamed once and this went on passing against an
 * unrelated `saved` elsewhere.
 */
const credentialPath = engine.slice(engine.indexOf('function ssSyncCredential'),
                                    engine.indexOf('/* ------', engine.indexOf('function ssSyncCredential')));
['accessToken', 'instanceUrl'].forEach((field) => {
    assert.ok(new RegExp('\\.' + field).test(credentialPath),
        'the engine does not read .' + field + ' when choosing a credential');
});

/*
 * Both writing sites, not just one.
 *
 * background.js stores a token twice - once when signing in and again on
 * every refresh - and the two must write the same shape. Asserting the field
 * merely exists somewhere passes while one of them has been renamed, which is
 * the version of this bug that only appears an hour after signing in, when
 * the first refresh replaces a readable record with an unreadable one.
 */
const tokenWrites = (background.match(/accessToken: token\.access_token/g) || []).length;
assert.strictEqual(tokenWrites, 2,
    'both the sign-in and the refresh must write accessToken (found ' + tokenWrites + ')');
const urlWrites = (background.match(/instanceUrl: token\.instance_url/g) || []).length;
assert.strictEqual(urlWrites, 2,
    'and both must write instanceUrl (found ' + urlWrites + ')');

/*
 * The cookie is tried before the token, and that order is the feature: a
 * pipeline's second org is one no tab is open on, and chrome.cookies can read
 * its sid where the single stored token cannot.
 */
const credentialBody = engine.slice(engine.indexOf('function ssSyncCredential'),
    engine.indexOf('function ssSyncSoapUrl'));
/* The stored tokens are fetched through a helper now, so the ordering is
 * against the call rather than against the storage read inside it. */
assert.ok(credentialBody.indexOf('chrome.cookies.getAll') <
          credentialBody.indexOf('$ssSyncAllTokens('),
    'the cookie is tried before the stored token');

/*
 * And the token is only used for the org it belongs to. Using it against a
 * different org is the cross-org leak the sign-in guard exists to prevent,
 * and a pipeline is precisely where two orgs are in play at once.
 */
/*
 * Both sides normalised, then compared. Written as one expression before,
 * which the per-org loop split across lines - the guard is unchanged, and
 * sync_engine.test.js drives it besides: a token minted for org A, asked for
 * org B, must come back as nothing.
 */
/* The token branch only: the cookie lookup above it normalises a host too,
 * and counting across the whole function measures that instead. */
const tokenBranch = credentialBody.slice(credentialBody.indexOf('$ssSyncAllTokens('));
assert.strictEqual((tokenBranch.match(/hostname\.toLowerCase\(\)/g) || []).length, 2,
    'the stored token is matched to the org by host before being used, with ' +
    'both sides normalised');
assert.ok(/if \(host === wanted\)/.test(tokenBranch),
    'the normalised hosts are never actually compared');

/* ------------------------------------------------------------------ */
/* Loaded, registered, and reachable from the menu                     */
/* ------------------------------------------------------------------ */

manifest.content_scripts.forEach((entry, index) => {
    assert.ok(entry.js.includes('/js/angular/services/PipelineService.js'),
        'content_scripts[' + index + '] must load PipelineService.js');
    /* Angular resolves services at controller construction, so the file only
     * has to be there first - but the controller asks for it by name, and a
     * missing file is an injector error that takes the whole panel down. */
    assert.ok(entry.js.indexOf('/js/angular/services/PipelineService.js') <
              entry.js.indexOf('/js/angular/controllers/MenuAndDetailsCtrl.js'),
        'content_scripts[' + index + ']: the service must load before the controller');
});

assert.ok(standalone.includes('js/angular/services/PipelineService.js'),
    'simplified.html must load PipelineService.js too - it runs the same controller');

assert.ok(/PipelineService/.test(controller.slice(0, 600)),
    'the controller must inject PipelineService');

assert.ok(/syncjobs:\s*'syncjobs'/.test(directives), 'the syncjobs directive is registered');
assert.ok(/syncjobdetail:\s*'syncjobdetail'/.test(directives),
    'the syncjobdetail directive is registered');
assert.ok(/this\.syncjobs\s*=/.test(view), 'ViewService provides the syncjobs template');
assert.ok(/this\.syncjobdetail\s*=/.test(view), 'ViewService provides the detail template');

assert.ok(/'<syncjobs><\/syncjobs>'/.test(view),
    'the page must be in the composite, or the directive never renders');

assert.ok(/value: "SyncJobs"/.test(container), 'SyncJobs is in the system menu');
assert.ok(/'SyncJobs':\s*\d+/.test(controller), 'and has a place in the menu order');

/* Opening the page has to load it; a cached list is exactly wrong here. */
assert.ok(/data\.value === 'SyncJobs'[\s\S]{0,400}\$scope\.loadSync\(\)/.test(controller),
    'selecting the page must call loadSync()');

/* ------------------------------------------------------------------ */
/* The mapping, seen from the org the user is in                       */
/* ------------------------------------------------------------------ */

const stateHandler = handlerFor(background, 'SS_SYNC_STATE');

/*
 * The route is worked out by ssSyncRoute, which is the same function that
 * routes the actual job. A second copy of the direction rules in the panel
 * would eventually disagree with the one that decides where the deploy goes,
 * and the screen would then be confidently wrong about which org is which.
 */
assert.ok(/ssSyncRoute\(pipeline,\s*here\)/.test(stateHandler),
    'each pipeline must be described using the same routing the job uses');
assert.ok(/message\.fromOrigin/.test(stateHandler),
    'and described from the org the panel says it is in');
assert.ok(/canSend/.test(stateHandler), 'the answer says whether this org can send');

/* The panel has to actually send its org, or every row reads as "not here". */
assert.ok(/PipelineService\.state\(\$scope\.sync\.here\)/.test(controller),
    'loadSync must pass the current org');
assert.ok(/\$scope\.sync\.here\s*=\s*syncFromOrigin\(\)/.test(controller),
    'and take it from the same place staging does, so the two cannot disagree');

/*
 * The decoration describes one tab's org and must never reach storage.
 *
 * SS_SYNC_STATE hands back decorated pipelines, the editor works on a copy of
 * one, and saving it as it arrives would write "this org is the source" into
 * a store the next tab reads as fact.
 */
const saveHandler = handlerFor(background, 'SS_SYNC_SAVE_PIPELINE');
assert.ok(/const incoming = \{/.test(saveHandler),
    'the saved pipeline must be rebuilt from named fields, not stored as sent');
assert.ok(!/here/.test(saveHandler.replace(/\/\*[\s\S]*?\*\//g, '')),
    'and the route decoration must not be among them');

const persisted = (saveHandler.match(/const incoming = \{[\s\S]*?\n        \};/) || [''])[0];
['id', 'a', 'b', 'direction', 'enabled'].forEach((field) => {
    assert.ok(new RegExp('\\b' + field + ':').test(persisted),
        'a saved pipeline keeps its ' + field);
});

/*
 * And the screen is reloaded after a save rather than taking the list the
 * save returned - that list is the stored one, with no route on it, so
 * assigning it directly drops the highlighting.
 */
assert.ok(/Pipeline saved\.[\s\S]{0,400}\$scope\.loadSync\(\)/.test(controller),
    'saving a pipeline must reload the described list');

/* What the row draws: the mapping when this org can send, the flat two-org
 * line when it cannot. */
/*
 * The template as markup: the string concatenation joined up, and the inner
 * quotes unescaped. Without the second step every ng-click carrying an
 * argument reads as syncClear(\'failed\') and no assertion about one ever
 * matches - which looks exactly like the control being missing.
 */
const pipelineRow = view.slice(view.indexOf('this.syncjobs ='), view.indexOf('this.syncjobdetail ='))
    .replace(/'\s*\+\s*\n?\s*'/g, '')
    .replace(/\\'/g, "'");

/* The expanded row under a job, flattened the same way - it is a separate
 * template, and assertions about it kept being aimed at the list above. */
function flatTemplate(name) {
    const at = view.indexOf('this.' + name + ' =');
    assert.ok(at > -1, 'the ' + name + ' template is gone');
    return view.slice(at, view.indexOf("';", view.indexOf('</div>', at)))
        .replace(/'\s*\+\s*\n?\s*'/g, '')
        .replace(/\\'/g, "'");
}

/*
 * What a job carries moved out of the detail row into its own template, so
 * that the review modal could render the same thing rather than a second
 * copy of it. The detail row now pulls it in as an element, so assertions
 * about components and the query belong to this one.
 */
const carries = flatTemplate('syncjobcarries');
const detailRow = flatTemplate('syncjobdetail') + carries;
/*
 * Both ends asserted inside the mapping span, not anywhere in the template.
 * p.here.target.label is now also used by the records form further down, so
 * the loose version of this passed with the mapping's target replaced by
 * literal text.
 */
const mapAt = pipelineRow.indexOf('<span class="ss-sync-map"');
assert.ok(mapAt > -1, 'the mapping span must exist');
const mapping = pipelineRow.slice(mapAt, pipelineRow.indexOf('</td>', mapAt));

assert.ok(/ng-if="p\.here\.canSend"/.test(mapping),
    'the mapping is drawn only when this org is one end of the pipeline');
assert.ok(/\{\{p\.here\.source\.label\}\}/.test(mapping),
    'the source end is named: ' + mapping);
assert.ok(/\{\{p\.here\.target\.label\}\}/.test(mapping),
    'and so is the target: ' + mapping);
assert.ok(/ng-if=\\?"!p\.here\.canSend\\?"[\s\S]{0,200}syncPipelineLine\(p\)/.test(pipelineRow),
    'a pipeline this org is no part of falls back to the plain two-org line');
assert.ok(/\{\{p\.here\.reason\}\}/.test(pipelineRow),
    'and says why it cannot send from here');

/*
 * What gates these two buttons.
 *
 * Both conditions, and the history of this is why they are both asserted:
 *
 *   The selection, because they act on the ticked components and have no
 *   subject without one.
 *
 *   The route, because a pipeline that only runs the other way cannot be
 *   sent down from this org at all. Offering it anyway produced a button
 *   whose only possible outcome was a refusal in red across the top of the
 *   page - which is what a user saw.
 *
 * An earlier version of this file asserted the opposite of the second, after
 * the org gate was removed for taking away a working control. The distinction
 * that was missing then: the tag identifies the mapping, and the route
 * decides whether the action can happen at all.
 */
const sendButtonMarkup = (pipelineRow.match(/<button[^>]*syncStage\(p, false\)[^>]*>/) || [''])[0];
const validateMarkup = (pipelineRow.match(/<button[^>]*syncStage\(p, true\)[^>]*>/) || [''])[0];
const recordsMarkup = (pipelineRow.match(/<button[^>]*syncOpenData\(p\)[^>]*>/) || [''])[0];

/*
 * Each label carries the number it is about to send.
 *
 * The count exists below the table too, but the button is where the decision
 * is made - and two of these send components while the third sends records,
 * so one number under the list cannot speak for all three.
 */
const labelled = pipelineRow.replace(/\s+/g, ' ');
[['Send selection', '{{sync.selected}}'],
 ['Validate only', '{{sync.selected}}'],
 ['Send records', '{{sync.selectedRecords}}']].forEach(([name, count]) => {
    const label = new RegExp('>' + name + ' \\(' + count.replace(/[{}]/g, '\\$&') + '\\)');
    assert.ok(label.test(labelled),
        name + ' states how much it will send: expected ' + name + ' (' + count + ')');
});

[['Send selection', sendButtonMarkup, 'sync.selected'],
 ['Validate only', validateMarkup, 'sync.selected'],
 ['Send records', recordsMarkup, 'sync.selectedRecords']].forEach(([name, markup, gate]) => {
    assert.ok(markup, 'the ' + name + ' button must exist');
    assert.ok(markup.includes(gate),
        name + ' appears only when something is ticked: ' + markup);
    assert.ok(markup.includes('p.here.canSend'),
        name + ' appears only where this org can send down the pipeline: ' + markup);
});

/*
 * Send records is gated on the record basket, not the component one - two
 * baskets, two counts, and neither gate may read the other's number.
 */
assert.ok(!/sync\.selected"/.test(recordsMarkup),
    'Send records does not read the component count: ' + recordsMarkup);

assert.ok(/\$scope\.sync\.selectedRecords\s*=\s*\$scope\.selectedDataForDownload\.size/
    .test(controller),
    'the record count comes from the basket itself, read once on load');

/*
 * And a row that cannot send says where it can be done instead. A one-way
 * pipeline has exactly one org that may send down it, and naming it is more
 * use than saying this is not the one.
 */
assert.ok(/sender: ssSyncSender\(pipeline\)/.test(background),
    'a row that cannot send reports which org could');
assert.ok(/p\.here\.sender[\s\S]{0,200}p\.here\.sender\.origin/.test(pipelineRow),
    'and the row links to it');

/*
 * And the count behind that gate is held, not computed per binding. These
 * buttons are drawn per pipeline, so a function here would walk the whole
 * selection once per row per digest.
 */
assert.ok(/\$scope\.sync\.selected\s*=\s*syncSelectedComponents\(\)\.length/.test(controller),
    'the selection count is read once, on load');
assert.ok(!/\$scope\.syncSelectionCount\s*=/.test(controller),
    'and there is no second way to ask the same question - that is how a ' +
    'heading came to disagree with the rows under it');

/*
 * And the suggested query carries the ticked rows, not the object.
 *
 * This is the difference between sending twelve records and sending every
 * row of an object into another org. The user ticked twelve; a generated
 * query that quietly widened to "everything with a key" would be the single
 * most expensive mistake this screen could make, and it would look like a
 * convenience.
 */
const suggest = controller.slice(controller.indexOf('$scope.syncSuggestQuery = function'),
    controller.indexOf('$scope.syncStageData = function'));
assert.ok(/syncSelectedRecordsByType\(\)\[form\.objectApiName\]/.test(suggest),
    'the suggested query reads the ticked ids for that object');
assert.ok(/Id IN \(/.test(suggest),
    'and restricts the query to them: ' + suggest.slice(0, 200).replace(/\s+/g, ' '));

/*
 * And selects the whole record, not just the key.
 *
 * A record with no counterpart in the target is created. With a query of
 * "SELECT Id, Migration_Id__c" that creation produced a row holding an
 * External Id and nothing else - technically a successful sync, and useless.
 */
assert.ok(/SELECT FIELDS\(ALL\)/.test(suggest),
    'the suggested query carries every field, so a created record is a real one');
assert.ok(!/SELECT Id, ' \+ form\.keyField/.test(suggest),
    'and not just the key');

/*
 * Both write paths report how many records they created.
 *
 * The success line and the history row read those two numbers, so a path that
 * returned only a total would render "null updated, null created" - a job
 * that worked, described as though it had not.
 */
const runData = engine.slice(engine.indexOf('async function ssSyncRunData'),
    engine.indexOf('async function ssSyncRun('));

/*
 * The one place a data job reports its outcome has to carry both counts.
 * The success line and the history row read them, so a path returning only a
 * total would render "null updated, null created" - a job that worked,
 * described as though it had not.
 */
const dataOutcome = (runData.match(/return \{\s*\n\s*outcome:[\s\S]*?\n    \};/) || [''])[0];
assert.ok(dataOutcome, 'the data runner must return an outcome');
['matched:', 'created:', 'keyless:', 'sent:'].forEach((field) => {
    assert.ok(dataOutcome.includes(field),
        'the data outcome must report ' + field + ' ' + dataOutcome.replace(/\s+/g, ' '));
});

/*
 * Both modes write through one batched request, so a keyless row has
 * somewhere to go whichever way the job matches.
 */
assert.ok(/kind: 'insert', entries: payload\.keyless/.test(runData),
    'upsert mode sends its keyless rows as inserts');
assert.ok(/plan\.inserts\.concat\(payload\.keyless\)/.test(runData),
    'and lookup mode adds them to the rows it could not find');
assert.ok(!/nothing to match them on/.test(engine),
    'no path refuses a job for having records without a key - they are created');

/*
 * A required field the target will insist on is checked before the write, and
 * only against the rows being created: an update need not carry one, because
 * the record it updates already has a value.
 */
assert.ok(/ssSyncMissingRequired\(inserting, describe,/.test(runData),
    'the insert rows are checked against what the target requires, before writing');
assert.ok(/batch\.kind === 'insert'/.test(runData),
    'and only the insert rows');

/*
 * And when the org refuses anyway, its message is joined to the half only
 * this side knows. "Required fields are missing: [Name]" is true of the
 * request and silent about why the request looked like that.
 */
assert.ok(/ssSyncExplainFailure\(failure\.message, describe,/.test(runData),
    'the org\'s per-record messages are explained with what we dropped and why');

/* ------------------------------------------------------------------ */
/* Records: the key comes from the org, not from a text box            */
/* ------------------------------------------------------------------ */

const keysHandler = handlerFor(background, 'SS_SYNC_KEY_CHOICES');

/*
 * The choices are read from the target org's describe. Anything else - a
 * hardcoded list, or a free-text field name - configures a key the org may
 * not accept, and that only surfaces at write time.
 */
assert.ok(/sobjects\/[\s\S]{0,80}describe/.test(keysHandler),
    'key choices come from a describe');
/*
 * Both ways of matching are offered, from the one place that knows them.
 *
 * Offering only the org's own upsert keys made the feature unusable on any
 * standard object nobody had marked with an External Id - which is most of
 * them, and was reported as "no field on Account can match records".
 */
assert.ok(/ssSyncCandidateKeys\(describe\)/.test(keysHandler),
    'the choices are the upsert keys and the lookup keys together');
/*
 * Pinned to the describe call itself, not merely to the target being named
 * somewhere in the handler - the credential lookup names it too, so the
 * looser check passed with the describe pointed at the source org. Which org
 * is described decides which fields are offered as keys, and the source org's
 * External Ids say nothing about what the target will match on.
 */
assert.ok(/ssSyncRest\(route\.target\.origin/.test(keysHandler),
    'the describe is run against the TARGET org - it is the one doing the matching');
assert.ok(!/ssSyncRest\(route\.source\.origin/.test(keysHandler),
    'and not against the source');

/* The engine, not the panel, decides what is a usable key. */
assert.ok(!/idLookup/.test(controller) && !/externalId/.test(controller),
    'the panel must not have its own opinion about which fields can be keys');

const stageDataHandler = handlerFor(background, 'SS_SYNC_STAGE_DATA');
assert.ok(/ssSyncValidateDataJob\(spec\)/.test(stageDataHandler),
    'a data job is validated before it is staged');
assert.ok(/ssSyncNewJob\(\{[\s\S]{0,120}kind: 'data'/.test(stageDataHandler),
    'and staged as a data job');
assert.ok(!/ssSyncRun\(/.test(stageDataHandler),
    'staging records must not write them - review is the point');

/*
 * The chosen key is remembered against the object, which is what makes it a
 * configuration rather than a question asked every time.
 */
assert.ok(/keys\[spec\.objectApiName\] = spec\.keyField/.test(stageDataHandler),
    'the key is remembered per object on the pipeline');
assert.ok(/keys: sent\.keys/.test(saveHandler),
    'and survives an edit of the pipeline - otherwise editing it silently ' +
    'un-configures every object it has carried');

/*
 * One number for the batch cap. It appears in the suggested query, in what
 * the page says, and in the refusal that enforces it.
 */
assert.ok(/dataLimit: SS_SYNC_DATA_LIMIT/.test(background),
    'the cap is sent from the engine that enforces it');

/*
 * And the suggested query uses that value rather than a number typed here.
 * A query suggesting a limit the engine does not enforce is a job the user
 * builds and the worker refuses.
 */
assert.ok(/' LIMIT ' \+ \(\$scope\.sync\.dataLimit/.test(controller),
    'the suggested query uses the cap the engine sent, not a copy of it');

/* ------------------------------------------------------------------ */
/* Getting there from package.xml                                      */
/* ------------------------------------------------------------------ */

/*
 * The two screens are halves of one job: package.xml says which components,
 * Org Sync says which org. The route between them is offered only when there
 * is a selection to send - an always-present button to a page that can only
 * refuse is a question the page keeps asking.
 */
const packageTemplate = view.slice(view.indexOf('this.packagexmleditor ='),
    view.indexOf('this.packagexmleditor =') + 20000);
assert.ok(/ng-show=\\?"packageIsReady\(\)\\?"\s*ng-click=\\?"openSyncJobs\(\)\\?"/
    .test(packageTemplate.replace(/'\s*\+\s*\n?\s*'/g, '')),
    'package.xml needs a route to Org Sync, shown only when something is selected');

assert.ok(/\$scope\.openSyncJobs\s*=\s*function/.test(controller),
    'and openSyncJobs must exist on the scope');

/*
 * It navigates by the same route every other page uses. Reaching for
 * selectedMetadata directly would skip openMetadata, which is where the page
 * is told to load itself - so the screen would arrive empty.
 */
const openSyncBody = controller.slice(controller.indexOf('$scope.openSyncJobs = function'),
    controller.indexOf('$scope.openSyncJobs = function') + 400);
assert.ok(/MetaDataContainer\.byValue\('SyncJobs'\)/.test(openSyncBody),
    'openSyncJobs resolves the menu entry by value');
assert.ok(/openMetadata\(entry/.test(openSyncBody),
    'and opens it through openMetadata, which is what triggers loadSync');

/*
 * The sync page reads the package.xml selection itself rather than keeping a
 * copy, so the two screens cannot disagree about what is ticked. Pinned to
 * the loop that builds the list, not merely to the map being mentioned: the
 * guard above it names the map too.
 */
assert.ok(
    /packageMetaTypeAndName\.forEach[\s\S]{0,300}components\.push\(\{\s*type:\s*type,\s*name:\s*member/
        .test(controller),
    'the components sent must be built from the ticked selection itself');

/* The absence of the send buttons is explained rather than left a mystery. */
assert.ok(/ng-if="sync\.pipelines\.length && !sync\.selected"/.test(pipelineRow),
    'with nothing ticked the page says so, and says what to do about it');

/* ------------------------------------------------------------------ */
/* The template binds to things that exist                             */
/* ------------------------------------------------------------------ */

const templates = ['syncjobs', 'syncjobdetail'].map((name) => {
    const start = view.indexOf('this.' + name + ' =');
    assert.ok(start > -1, name + ' template not found');
    const end = view.indexOf("';", view.indexOf('</div>', start));
    return { name, body: view.slice(start, end) };
});

/*
 * Loop variables and filter arguments, which are not scope members. Kept as a
 * named list rather than a pattern so that a genuine typo in a binding still
 * shows up as missing - that is the whole point of the check below.
 */
/*
 * Loop variables, which are not scope members - and which must be declared by
 * a repeat or an ng-options in the same template. Kept apart from the scope
 * members below so that an alias used with no repeat to define it fails,
 * rather than being waved through as "just a local": that is how an inner
 * repeat went on reading a group its outer repeat no longer produced.
 */
const REPEAT_ALIASES = new Set(['job', 'p', 'c', 'f', 'h', 'o', 'd', 'k', 'r', 't', 'g',
    /*
     * The orgs this browser remembers. Named knownOrg rather than org
     * because this set drives a search through every binding, and "org"
     * appears inside prose in several of them - "Asking the org..." is a
     * label, not a use of an alias, and the check cannot tell them apart.
     */
    'knownOrg']);

/* Real scope members reached through no property path. */
const SCOPE_LOCALS = new Set([
    'sync', 'syncData', 'selectedMetadata', 'syncDirections', 'requestSignIn'
]);

const LOCALS = new Set([...REPEAT_ALIASES, ...SCOPE_LOCALS]);

templates.forEach(({ name, body }) => {
    const expressions = [
        ...[...body.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]),
        ...[...body.matchAll(/ng-(?:if|show|click|change|class|repeat|repeat-start|disabled|model|options)=\\?"([^"\\]+)/g)].map((m) => m[1])
    ];
    /* A floor, not a measurement: it is here so that an extraction that
     * silently finds nothing fails instead of passing vacuously. */
    assert.ok(expressions.length > 5, name + ': expected bindings, found ' + expressions.length);

    const roots = new Set();
    expressions.forEach((raw) => {
        /* String literals first - a date filter's 'd MMM HH:mm' is an
         * argument, not three scope members. */
        const expression = raw.replace(/'[^']*'/g, "''").replace(/\\?"[^"]*\\?"/g, '""');
        [...expression.matchAll(/(?<![.\w$'"])([A-Za-z_$][\w$]*)/g)].forEach((m) => {
            const word = m[1];
            if (['in', 'true', 'false', 'null', 'undefined', 'limitTo', 'date', 'as', 'for',
                 'track', 'by'].includes(word)) { return; }
            roots.add(word);
        });
    });

    const missing = [...roots].filter((word) => {
        if (LOCALS.has(word)) { return false; }
        return !new RegExp('\\$scope\\.' + word + '\\s*=').test(controller);
    });
    assert.deepStrictEqual(missing, [],
        name + ' binds to scope members that do not exist: ' + missing.join(', '));

    /*
     * And every loop variable used here is declared here. An alias with no
     * repeat behind it is undefined at render time, which Angular shows as
     * nothing - the same silent failure as reading one outside its repeat,
     * and invisible to the check above because it is a known local.
     */
    const declared = new Set(
        [...body.matchAll(/ng-(?:repeat|repeat-start|options)=\\?"[^"\\]*?([A-Za-z_$][\w$]*)\s+(?:in|as|for)\s/g)]
            .map((m) => m[1]));
    /* ng-options reads "value as label for x in list" - the alias is after
     * "for", so pick up that form too. */
    [...body.matchAll(/for\s+([A-Za-z_$][\w$]*)\s+in\s/g)].forEach((m) => declared.add(m[1]));

    /*
 * Aliases a template inherits rather than declares.
 *
 * syncjobdetail is a directive with no isolate scope, rendered only inside
 * the job repeats of syncjobs - so its `job` comes from the parent scope and
 * is real. That relationship is stated here because it is the only thing
 * making those bindings valid; if the detail were ever rendered anywhere
 * else, they would be undefined and this list would be the lie that hid it.
 */
const INHERITED = { syncjobdetail: ['job'] };
(INHERITED[name] || []).forEach((alias) => declared.add(alias));

const undeclared = [...roots].filter((word) => REPEAT_ALIASES.has(word) && !declared.has(word));
    assert.deepStrictEqual(undeclared, [],
        name + ': loop variables used with no repeat to define them: ' + undeclared.join(', '));
});

/* ------------------------------------------------------------------ */
/* Every button says what it does                                      */
/* ------------------------------------------------------------------ */

/*
 * A button with no label renders as a few pixels of nothing. It is still in
 * the DOM, still clickable, and still passes any check that only asks whether
 * the button is there - which is how an assertion about Quick deploy went on
 * passing after its label had been deleted.
 */
templates.forEach(({ name, body }) => {
    const flat = body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/'\s*\+\s*\n?\s*'/g, '')
        .replace(/\\'/g, "'");

    [...flat.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].forEach((match) => {
        const label = match[1].replace(/<[^>]*>/g, '').trim();
        assert.ok(label.length > 0,
            name + ': a button with no label is an invisible control - "' +
            match[0].slice(0, 110).replace(/\s+/g, ' ') + '"');
    });
});

/* ------------------------------------------------------------------ */
/* A repeat's variable exists only inside the repeat                   */
/* ------------------------------------------------------------------ */

/*
 * The rule that keeps being broken.
 *
 * ng-repeat defines its alias on the elements it covers and nowhere else. A
 * sibling that reads it gets undefined, and Angular renders undefined as
 * nothing at all - no error, no warning, just a control that does nothing.
 * That has now shipped four times in this project: a "no records" line above
 * its table, a count above its rows, a column header, and a form row placed
 * after a pipeline repeat instead of inside it, where "Send records" set its
 * state and appeared dead.
 */
/*
 * The element an attribute sits on, from its "<" to its matching close.
 *
 * Balanced, because these templates now nest a div inside a div - the
 * attempt-grouped history is a repeat containing a repeat. A naive search
 * for the first "</div>" stopped at the inner one, cut the span short, and
 * reported the outer repeat's own alias as being read outside itself.
 */
function elementSpan(text, attrIndex) {
    const open = text.lastIndexOf('<', attrIndex);
    const tag = (/^<(\w+)/.exec(text.slice(open, open + 20)) || [])[1];
    if (!tag) { return null; }

    const opener = new RegExp('<' + tag + '[\\s>]', 'g');
    const closer = new RegExp('</' + tag + '>', 'g');
    opener.lastIndex = open + 1;

    let depth = 1;
    let cursor = open + 1;

    while (depth > 0) {
        closer.lastIndex = cursor;
        const close = closer.exec(text);
        if (!close) { return { start: open, end: text.length }; }

        opener.lastIndex = cursor;
        let nested = 0;
        let hit;
        while ((hit = opener.exec(text)) !== null && hit.index < close.index) {
            nested += 1;
        }

        depth += nested - 1;
        cursor = close.index + close[0].length;
    }

    return { start: open, end: cursor };
}

templates.forEach(({ name, body }) => {
    /* Comments out first: the prose explaining this very rule mentions
     * "p.id", and markup is what is being checked, not commentary. */
    const flat = body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/'\s*\+\s*\n?\s*'/g, '')
        .replace(/\\'/g, "'");
    const spans = {};

    [...flat.matchAll(/ng-repeat(-start)?="\s*([A-Za-z_$][\w$]*)\s+in\s/g)].forEach((match) => {
        const alias = match[2];
        const isMulti = !!match[1];
        let span = elementSpan(flat, match.index);
        if (!span) { return; }

        if (isMulti) {
            /*
             * The repeat covers everything up to and including the element
             * carrying ng-repeat-end - and that end must come before the next
             * repeat-start, or it belongs to a different repeat.
             */
            const endAt = flat.indexOf('ng-repeat-end', match.index);
            const nextStart = flat.indexOf('ng-repeat-start', match.index + 1);
            assert.ok(endAt > -1 && (nextStart === -1 || endAt < nextStart),
                name + ': ng-repeat-start="' + alias + ' in …" has no ng-repeat-end of ' +
                'its own - Angular throws on that at compile time');
            const endSpan = elementSpan(flat, endAt);
            span = { start: span.start, end: endSpan ? endSpan.end : flat.length };
        }
        (spans[alias] = spans[alias] || []).push(span);
    });

    /*
     * Only bindings are searched, with their positions kept. Prose is not a
     * binding: the page contains "One job carries at most 200 records", and
     * the word "job" there is English, not the repeat's alias.
     */
    const bindings = [];
    [...flat.matchAll(/\{\{([^}]*)\}\}/g)].forEach((m) => {
        bindings.push({ at: m.index + 2, text: m[1] });
    });
    [...flat.matchAll(/ng-[a-z-]+="([^"]*)"/g)].forEach((m) => {
        bindings.push({ at: m.index + m[0].indexOf('"') + 1, text: m[1] });
    });

    Object.keys(spans).forEach((alias) => {
        /*
         * Every read of the alias, not only "alias.something". syncIsOpen(job)
         * passes it whole, and that breaks the same way for the same reason.
         * The declaration itself ("job in …") is not a read and is skipped.
         */
        const pattern = new RegExp('(?<![.\\w$])' + alias + '(?![\\w$])', 'g');
        const uses = [];

        bindings.forEach((binding) => {
            [...binding.text.matchAll(pattern)].forEach((use) => {
                if (/^\s+in\s/.test(binding.text.slice(use.index + alias.length))) { return; }
                uses.push({ index: binding.at + use.index, context: binding.text });
            });
        });

        assert.ok(uses.length, name + ': alias ' + alias + ' is repeated but never read');

        uses.forEach((use) => {
            const inside = spans[alias].some(function (span) {
                return use.index >= span.start && use.index <= span.end;
            });
            assert.ok(inside,
                name + ': "' + alias + '" is read outside its ng-repeat, in "' +
                use.context.trim() + '". The alias is undefined there, which Angular ' +
                'renders as nothing - this is how a control comes to do nothing when clicked.');
        });
    });
});

/* ------------------------------------------------------------------ */
/* The infinite-digest rule                                            */
/* ------------------------------------------------------------------ */

/*
 * $watchCollection compares the elements it is given by identity, so a
 * function that builds fresh objects each call never compares equal to its
 * last answer and the digest never settles. That is a real crash this project
 * has already shipped once, from featureUseTiles(); `track by` does not help,
 * because it decides DOM reuse long after the watcher has already fired.
 */
templates.forEach(({ name, body }) => {
    [...body.matchAll(/ng-repeat(?:-start)?=\\?"([^"\\]+)/g)].forEach((m) => {
        const source = m[1].split(/\sin\s/)[1] || '';
        const collection = source.split('|')[0].trim();
        assert.ok(!collection.includes('('),
            name + ': ng-repeat over a function call (' + collection + ') - it returns a ' +
            'fresh array every digest and never settles. Compute it and hold it on the scope.');
    });
});

/* The groups the lists repeat over are held, not computed on demand. */
assert.ok(/sync\.groups\s*=\s*PipelineService\.group\(/.test(controller),
    'job groups must be computed once and stored on the scope');

/* ------------------------------------------------------------------ */
/* How often a pipeline has been used                                  */
/* ------------------------------------------------------------------ */

/*
 * Counted when a job starts running, on the pipeline itself.
 *
 * Deriving it from the job list would be simpler and wrong: that list is
 * capped and can be emptied, so the number would fall whenever somebody
 * tidied up.
 */
assert.ok(/ssSyncRecordUse\(job\.pipelineId, 'run'\)/.test(engine),
    'a run is counted against its pipeline when it starts');
assert.ok(/ssSyncRecordUse\(ok && ok\.pipelineId, 'succeeded'\)/.test(engine),
    'and the outcome when it finishes');
assert.ok(/ssSyncRecordUse\(bad && bad\.pipelineId, 'failed'\)/.test(engine),
    'including the failures');

/* Both finishers, metadata and data - one of them counting and the other not
 * would make the totals disagree with themselves. */
assert.strictEqual((engine.match(/ssSyncRecordUse\(ok && ok\.pipelineId/g) || []).length, 2,
    'both the metadata and the data finisher count a success');
assert.strictEqual((engine.match(/ssSyncRecordUse\(bad && bad\.pipelineId/g) || []).length, 2,
    'and both count a failure');

/* The tally survives an edit of the pipeline, like the keys do. */
assert.ok(/usage: sent\.usage/.test(saveHandler),
    'editing a pipeline must not reset how often it has been used');

/* Shown on the row, from the pipeline rather than from the jobs below it. */
/* The value, not merely the gate: an ng-if naming the function while the
 * binding beside it renders nothing is a row that shows no tally at all. */
assert.ok(/\{\{syncUsageLine\(p\)\}\}/.test(pipelineRow),
    'the row renders the tally, not just gates on it');
assert.ok(/ng-if="syncUsageLine\(p\)"/.test(pipelineRow),
    'and shows nothing at all before the pipeline has been used');
assert.ok(/pipeline\.usage/.test(controller) || /p\.usage/.test(pipelineRow),
    'read from the pipeline');
assert.ok(!/sync\.jobs[\s\S]{0,80}filter[\s\S]{0,80}pipelineId/.test(controller),
    'and not counted from the job list, which is capped and clearable');

/* ------------------------------------------------------------------ */
/* Which way a pipeline may be used                                    */
/* ------------------------------------------------------------------ */

/*
 * All three directions are offered.
 *
 * "Both ways" is a permission rather than automation: either org may be the
 * source, and which one it is gets decided by the org you are in when you
 * press. Nothing runs on its own - the direction is only ever the two
 * refusals in ssSyncRoute.
 */
const directions = controller.slice(controller.indexOf('var SYNC_DIRECTIONS = ['),
    controller.indexOf('$scope.syncDirections = SYNC_DIRECTIONS'));
["'both'", "'a-to-b'", "'b-to-a'"].forEach((value) => {
    assert.ok(directions.includes(value),
        'the direction ' + value + ' is offered when making a pipeline');
});

/* Held, not computed: ng-options watches the collection it is given. */
assert.ok(/\$scope\.syncDirections = SYNC_DIRECTIONS\.slice\(\)/.test(controller),
    'the choices are a held array');
assert.ok(!/ng-options="[^"]*syncDirections\(/.test(pipelineRow),
    'and not a function call in the binding');

/* The engine accepts all three, or the option could be chosen and not saved. */
assert.ok(/'a-to-b', 'b-to-a', 'both'/.test(engine),
    'every direction the panel offers is one the engine will store');

/*
 * And a bidirectional pipeline routes from whichever end you are in, which
 * is the whole of what the setting does.
 */
/*
 * Read out of ssSyncRoute rather than measured as a distance from the
 * direction check. A window wide enough to survive the branch growing a line
 * is wide enough to match the branch after it, and one narrow enough to be
 * precise breaks on the next comment - which is how this failed on a change
 * that only added an error code.
 */
const route = (function() {
    const at = engine.indexOf('function ssSyncRoute(pipeline, fromOrigin) {');
    assert.ok(at > -1, 'ssSyncRoute is gone');
    let depth = 0, started = false;
    for (let i = at; i < engine.length; i += 1) {
        if (engine[i] === '{') { depth += 1; started = true; }
        else if (engine[i] === '}') {
            depth -= 1;
            if (started && depth === 0) { return engine.slice(at, i + 1); }
        }
    }
    throw new Error('unterminated ssSyncRoute');
})();

/* Standing at a, the wrong direction is b-to-a and the route is a -> b. */
const fromA = route.slice(route.indexOf('fromOrigin === a.origin'),
                          route.indexOf('fromOrigin === b.origin'));
const fromB = route.slice(route.indexOf('fromOrigin === b.origin'));

assert.ok(/direction === 'b-to-a'/.test(fromA) && /source: a, target: b/.test(fromA),
    'standing at the first org, the wrong direction is not refused or the route is wrong');
assert.ok(/direction === 'a-to-b'/.test(fromB) && /source: b, target: a/.test(fromB),
    'standing at the second org, the wrong direction is not refused or the route is wrong');
assert.ok(!/'both'/.test(route),
    'ssSyncRoute names "both" explicitly - it works by neither refusal firing, ' +
    'and a third branch is a third thing that can disagree with the other two');

/* ------------------------------------------------------------------ */
/* Putting the waiting jobs in front of the user                       */
/* ------------------------------------------------------------------ */

const reviewModal = view.slice(view.indexOf('ss-run-backdrop" ng-if="syncReview.open'),
    view.indexOf('ss-run-backdrop" ng-if="syncRun.open'))
    .replace(/'\s*\+\s*\n?\s*'/g, '').replace(/\\'/g, "'");

/*
 * A staged job is the one thing here that stops until somebody acts, and a
 * section can be scrolled past. The modal is a second way to reach those
 * jobs, not a replacement for the section.
 */
assert.ok(/sync\.groups\.active\.length/.test(pipelineRow),
    'the Waiting on you section still exists');
assert.ok(/ng-repeat="job in syncReview\.jobs"/.test(reviewModal),
    'and the modal lists the staged jobs');
assert.ok(/syncApply\(job\)/.test(reviewModal) && /syncDiscard\(job\)/.test(reviewModal),
    'with both decisions on each one');

/* Held, not filtered in the binding - a repeat over a call never settles. */
assert.ok(/\$scope\.syncReview\.jobs = staged/.test(controller),
    'the staged list is computed once and held');
assert.ok(!/ng-repeat="job in [^"]*\(/.test(reviewModal),
    'and the modal does not repeat over a function call');

/*
 * Dismissible, and it stays dismissed. A modal that returns every time the
 * page is opened is one people learn to close without reading.
 */
assert.ok(/syncDismissReview/.test(reviewModal), 'it can be turned down');
assert.ok(/\$scope\.syncReview\.seen\[job\.id\] = true/.test(controller),
    'and remembers which jobs were turned down');
assert.ok(/!\$scope\.syncReview\.seen\[job\.id\]/.test(controller),
    'so it only returns for a job not already turned down');

/* Turning it down changes nothing about the jobs themselves. */
const dismiss = controller.slice(controller.indexOf('$scope.syncDismissReview = function'),
    controller.indexOf('$scope.loadSync = function'));
assert.ok(!/discard|Discard|state =/.test(dismiss),
    'Later leaves the jobs staged: ' + dismiss.replace(/\s+/g, ' ').slice(0, 120));

/* One modal at a time. */
assert.ok(/ng-if="syncReview\.open && !syncRun\.open"/.test(reviewModal),
    'the review hides while a run is being watched');
assert.ok(/\$scope\.syncReview\.open = false;\s*\n\s*\$scope\.syncRun = \{ open: true/
    .test(controller),
    'and applying from it hands over to the run modal');

/* Nothing staged, nothing to ask about. */
assert.ok(/if\(!staged\.length\)\{\s*\n\s*\$scope\.syncReview\.open = false;/.test(controller),
    'the modal closes itself once nothing is waiting');

/* ------------------------------------------------------------------ */
/* Watching a job run                                                  */
/* ------------------------------------------------------------------ */

/*
 * The run happens in the worker and the call the panel waits on does not
 * come back until the end, so progress travels on the job record - which the
 * panel already reads. That also means a worker killed mid-deploy does not
 * stop the view: the alarm resumes the poll and writes to the same place.
 */
assert.ok(/ssSyncProgress\(job\.id, \{[\s\S]{0,120}stage: 'deploy'/.test(engine),
    'the deploy poll records how far it has got');
assert.ok(/recent: status\.recent/.test(engine),
    'including which components the org has finished with');
assert.ok(/componentSuccesses/.test(engine),
    'which are read from the org\'s own report rather than guessed at');
assert.ok(/name === 'package\.xml'/.test(engine),
    'and the manifest itself is not listed as a deployed component');

/* Progress is cleared when the job stops, or a finished job shows a stale
 * "3 of 5" under its outcome. */
const cleared = (engine.match(/progress: null/g) || []).length;
assert.ok(cleared >= 3,
    'every finish clears the progress (found ' + cleared + ')');

/* The panel watches by re-reading, and stops when it is done. */
assert.ok(/\$interval\(function\(\)\{[\s\S]{0,300}PipelineService\.state/.test(controller),
    'the panel polls the job record while the modal is open');
assert.ok(/\$interval\.cancel\(syncWatch\)/.test(controller), 'and cancels the poll');
assert.ok(/\$scope\.\$on\('\$destroy', syncStopWatching\)/.test(controller),
    'including when the panel goes away - an interval outliving its scope is a leak');

const runner = controller.slice(controller.indexOf('function runJob(job, how, label)'),
    controller.indexOf('$scope.syncApply = function'));
assert.ok(/syncStartWatching\(job\.id\)/.test(runner), 'watching starts with the run');
assert.ok((runner.match(/syncStopWatching\(\)/g) || []).length >= 2,
    'and stops on both the success and the failure path');

/*
 * The modal cannot be dismissed while the job is running - not to trap
 * anybody, but because closing it loses the only view of something happening
 * now, and the list behind it cannot show a running job's progress.
 */
const runModal = view.slice(view.indexOf('ss-run-backdrop'), view.indexOf('<h4>Org Sync</h4>'))
    .replace(/'\s*\+\s*\n?\s*'/g, '').replace(/\\'/g, "'");
assert.ok(/ss-run-close" ng-if="syncRun\.outcome"/.test(runModal),
    'the close control appears only once the job has stopped');
assert.ok(/ss-run-actions" ng-if="syncRun\.outcome"/.test(runModal),
    'and so does the Close button');

/* Every outcome is accounted for, including the one that is not an outcome. */
["'succeeded'", "'failed'", "'blocked'", "'unknown'"].forEach((state) => {
    assert.ok(runModal.includes('syncRun.outcome === ' + state),
        'the modal says what happened when a run ends ' + state);
});
assert.ok(/Lost contact with the extension/.test(runModal),
    'and a worker that stopped answering is reported as that, not as a failure - ' +
    'it says nothing about what the org did');

/*
 * And the panel actually sets that outcome. The branch existing in the
 * markup proves nothing if the rejection path calls the run a failure: the
 * org may well have finished the deploy.
 */
assert.ok(/\$scope\.syncRun\.outcome = 'unknown'/.test(controller),
    'losing the worker is recorded as unknown, not as failed');

/* ------------------------------------------------------------------ */
/* Paged lists, and the order of the sections                          */
/* ------------------------------------------------------------------ */

/*
 * The rows come from a held page, not from the whole group and not from a
 * function - a repeat whose source is a call gets a fresh array every digest
 * and never settles.
 */
['active', 'succeeded', 'failed'].forEach((group) => {
    /* A plain ng-repeat since the rows became tiles - one element per job,
     * so the split-repeat construct is gone from this page entirely. */
    assert.ok(new RegExp('ng-repeat="job in sync\\.pages\\.' + group + '\\.items"')
        .test(pipelineRow), group + ' repeats over its held page');
    assert.ok(!new RegExp('ng-repeat-start="job in sync\\.groups\\.' + group)
        .test(pipelineRow), group + ' does not repeat over the whole group');

    /*
     * The heading counts the whole list, not the page.
     *
     * Pinned to the <h4> itself: sync.groups.X.length also appears in the
     * section gate and the Clear all confirmation, and a looser check passed
     * while the heading had been switched to the page length - "Failed (10)"
     * over ten of forty-seven rows. That is the header-versus-rows
     * disagreement this project has already shipped once.
     */
    const heading = (pipelineRow.match(new RegExp('<h4>[^<]*\\{\\{sync\\.[^}]*' + group + '[^}]*\\}\\}[^<]*</h4>')) || [''])[0];
    assert.ok(heading, group + ' needs a heading that states a count');
    assert.ok(heading.includes('sync.groups.' + group + '.length'),
        group + ' is counted in full in its heading, not by the page: ' + heading);
});

assert.ok(/\$scope\.sync\.pages\[group\] = slice/.test(controller),
    'the page slices are computed once and held');
assert.ok(/\$scope\.sync\.page\[group\] = slice\.page/.test(controller),
    'and the clamped page is written back, so discarding the last row of the ' +
    'last page does not leave an empty section');

/* The pager hides itself when there is nothing to page. */
assert.ok(/ss-sync-pager" ng-if="sync\.pages\.failed\.pages > 1"/.test(pipelineRow),
    'a list that fits on one page carries no pager');

/*
 * Section order: what is waiting on you, then what worked, then what did
 * not. Failed last is a deliberate choice, so it is asserted rather than
 * left to whichever edit happens last.
 */
const at = (gate) => pipelineRow.indexOf('sync.groups.' + gate + '.length');
assert.ok(at('active') < at('succeeded'),
    'the section asking for a decision comes first');
assert.ok(at('succeeded') < at('failed'),
    'and failures come after successes');

/* ------------------------------------------------------------------ */
/* History grouped by attempt                                          */
/* ------------------------------------------------------------------ */

/*
 * Computed once per load and held on the job. The detail template repeats
 * over these, and a repeat whose source is a function call gets a fresh
 * array every digest - which never compares equal to the last and never
 * settles. That has already crashed this panel once.
 */
assert.ok(/job\.historyGroups = PipelineService\.historyGroups\(job\)/.test(controller),
    'history groups are computed on load and held on the job');
assert.ok(/ng-repeat="g in job\.historyGroups"/.test(detailRow),
    'and the template repeats over the held array');
assert.ok(!/ng-repeat="[^"]*historyGroups\(/.test(detailRow),
    'never over a function call');

/* The seam is the whole point: without a label the three runs read as one
 * list of repeated sentences. */
assert.ok(/ss-sync-attempt" ng-if="g\.label"/.test(detailRow),
    'each attempt is labelled, when there is an attempt to label');

/*
 * Records written before attempts were stamped carry none, and there is no
 * way to reconstruct them - they come back as one unlabelled group and
 * render exactly as the flat list did. Inventing numbers for them would be a
 * guess presented as history.
 */
assert.ok(/stamped/.test(service) && /attempt: null, label: null/.test(service),
    'unstamped history is left flat rather than given invented attempt numbers');

/* ------------------------------------------------------------------ */
/* Creating everything, matching nothing                               */
/* ------------------------------------------------------------------ */

/*
 * The third mode. It is the only choice on that dropdown that cannot update
 * anything, so the risk is stated where the choice is made rather than
 * discovered in the target org afterwards.
 */
assert.ok(/mode === 'insert'[\s\S]{0,300}kind: 'insert', entries: payload\.keyless/.test(runData),
    'insert-only sends every row as a create');
/*
 * Every place the key is used, not just one of them.
 *
 * There are three, and a single-match check was satisfied by the other two
 * while the first had been handed the sentinel. That one is behaviourally
 * inert - no record has a field named after it, so the rows sort the same
 * way either - but the two below it are not: the required-field check and
 * the failure explanation would both treat the sentinel as a real field
 * name and reason about a field that does not exist.
 */
const insertNulls = (runData.match(/mode === 'insert' \? null : job\.keyField/g) || []).length;
assert.strictEqual(insertNulls, 3,
    'insert-only carries no key anywhere it is used (found ' + insertNulls + ')');
assert.ok(!/ssSyncMatchQuery/.test(runData.slice(runData.indexOf("if (mode === 'insert')"),
    runData.indexOf("} else if (mode === 'upsert')"))),
    'and does not look anything up - the target is never asked what it has');

assert.ok(/<b>Nothing is matched\.<\/b>/.test(pipelineRow),
    'the warning leads with what it does');
assert.ok(/become second copies/.test(pipelineRow),
    'and says what that costs when the target already has the records');

/*
 * The sentinel is machinery. It must not reach the screen - "Matched on
 * __ss_create_all__" is the internals leaking into a report somebody reads.
 */
assert.ok(/job\.keyField === '__ss_create_all__'[\s\S]{0,200}every record created/.test(detailRow),
    'the job detail says "none - every record created" rather than the sentinel');
assert.ok(!/Matched on<\/td><td class="ss-about-value">\{\{job\.keyField\}\}<\/td><\/tr>$/
    .test(detailRow.slice(0, detailRow.indexOf('Matching'))) ||
    /ng-if="job\.keyField !== '__ss_create_all__'"/.test(detailRow),
    'and the "Matched on" row is hidden when nothing was matched');
assert.ok(/__ss_create_all__[\s\S]{0,80}all created/.test(service),
    'and the job title says so too');

/* ------------------------------------------------------------------ */
/* Sessions: asking for the right org                                  */
/* ------------------------------------------------------------------ */

/*
 * An expired session is a sign-in wherever it happens, and the org that
 * refused has to be named - a pipeline touches two, and "Session expired or
 * invalid" names neither.
 */
assert.ok(/failure\.ssOrigin = origin/.test(engine) && /soapFailure\.ssOrigin = origin/.test(engine),
    'both relays tag their failures with the org that refused');
/* Both relays, counted - the SOAP one satisfying this on its own let the
 * REST one be hardcoded to false without any test noticing. */
const authFlags = (engine.match(/ssNeedsAuth = ssSyncIsSessionFailure\(/g) || []).length;
assert.strictEqual(authFlags, 2,
    'both relays decide needs-auth from the same rule (found ' + authFlags + ')');

/*
 * A job that dies on an expired session is blocked, not failed.
 *
 * Read out of the branch rather than measured as a distance from the `if`.
 * The distance version broke the moment the branch grew a second case, which
 * says nothing about whether the transition is still there - and a window
 * wide enough to survive that is wide enough to match the next branch along.
 */
const authBranch = (function () {
    const at = engine.indexOf('if (error && error.ssNeedsAuth) {');
    assert.ok(at > -1, 'the needs-auth branch is gone');
    let depth = 0, started = false;
    for (let i = at; i < engine.length; i += 1) {
        if (engine[i] === '{') { depth += 1; started = true; }
        else if (engine[i] === '}') {
            depth -= 1;
            if (started && depth === 0) { return engine.slice(at, i + 1); }
        }
    }
    throw new Error('unterminated needs-auth branch');
})();
assert.ok(/ssSyncTransition\(current, 'blocked'/.test(authBranch),
    'a session failure mid-job becomes blocked, the state that offers signing in');
assert.ok(!/'failed'/.test(authBranch),
    'the needs-auth branch can still end as failed, which puts it on the list ' +
    'people scan for real problems');

/*
 * Jobs already in the list get the same treatment, applied on the way out.
 * Without this the rule only ever helps jobs that fail after it was written.
 */
assert.ok(/ssSyncPrune\(jobs, SS_SYNC_MAX_JOBS\)\.map\(ssSyncNormaliseJob\)/.test(stateHandler),
    'stored jobs are read through the same session rule');

/*
 * And the panel reads the mark rather than the state, or a job stored as
 * failed before the distinction existed would keep its red pill and its
 * missing action.
 */
assert.ok(/this\.needsAuth\(job\) \? 'Needs sign in' : 'Failed'/.test(service),
    'a failure that is really a sign-in is labelled as one');
assert.ok(/if \(this\.needsAuth\(job\)\) \{ return 'ss-sync-state is-blocked'; \}/.test(service),
    'and coloured as one');
assert.ok(/return !!\(job && job\.error && job\.error\.needsAuth\);/.test(service),
    'needsAuth reads the mark, not job.state');

/*
 * Neither action is offered when the record does not say which org refused.
 * Guessing put the panel's own card on a job stuck on the other org.
 */
assert.ok(/if\(!origin\)\{ return false; \}/.test(controller),
    'an unknown origin offers no sign-in button');
assert.ok(/job\.error\.origin && !syncSignInHere\(job\)/.test(pipelineRow),
    'and no link to nowhere');

/* The key lookup answers the same way, naming the target org. */
assert.ok(/needsAuth: true,\s*\n\s*org: route\.target/.test(keysHandler),
    'the key lookup says which org needs signing in');

/*
 * And the panel offers the sign-in it can actually perform. Its own card
 * signs in to the org the page is on; the far end of a pipeline cannot be
 * signed in to from here, so that case gets a link to the org instead of a
 * button that would do nothing.
 */
assert.ok(/\$scope\.syncSignInHere\s*=\s*function/.test(controller),
    'the panel distinguishes the org it can sign in to from the one it cannot');
assert.ok(/origin === \$scope\.sync\.here/.test(controller),
    'by comparing against the org this page is on');

const signInButton = (pipelineRow.match(/<button[^>]*syncSignIn\(job\)[^>]*>/) || [''])[0];
assert.ok(/syncSignInHere\(job\)/.test(signInButton),
    'the Sign in button appears only for the org this panel can sign in to: ' + signInButton);
assert.ok(/!syncSignInHere\(job\)[\s\S]{0,200}job\.error\.origin/.test(pipelineRow),
    'and the other org is offered as a link to open it');

/* The key-lookup prompt names the org and does not pretend the panel card
 * would help. */
/* The heading, not merely somewhere in the block: the link below it also
 * names the org, and satisfied a looser check while the heading had been
 * reduced to "An org needs signing in again." */
assert.ok(/<b>\{\{syncData\.keyAuth\.label\}\} needs signing in again\.<\/b>/.test(pipelineRow),
    'the prompt names the org in its heading');
assert.ok(/ng-href="\{\{syncData\.keyAuth\.origin\}\}"/.test(pipelineRow),
    'and links to it');
assert.ok(/ng-show="syncData\.keyError && !syncData\.keyAuth"/.test(pipelineRow),
    'and replaces the bare red error rather than sitting beside it');

/* ------------------------------------------------------------------ */
/* Quick deploy                                                        */
/* ------------------------------------------------------------------ */

const quickHandler = handlerFor(background, 'SS_SYNC_QUICK_DEPLOY');

assert.ok(/ssSyncQuickDeployable\(validation, Date\.now\(\)\)/.test(quickHandler),
    'the worker checks eligibility itself rather than trusting the button');

/*
 * A new job, not a change to the old one. The validation is a finished thing
 * that happened; reopening it would lose the record of it, and the two are
 * different events with different outcomes.
 */
assert.ok(/ssSyncNewJob\(\{/.test(quickHandler), 'quick deploy creates its own job');
assert.ok(/validationId: validation\.result\.deployId/.test(quickHandler),
    'carrying the org\'s id for the validation - which is all the runner needs');
assert.ok(/components: validation\.components/.test(quickHandler),
    'and the same components, so the history reads as the same package');

/* Runs on the press: what would be reviewed already was, at validation. */
assert.ok(/ssSyncRun\(job\.id\)/.test(quickHandler), 'and runs it');

/*
 * The runner must skip the retrieve. Fetching the package and throwing it
 * away would work and would waste the minutes quick deploy exists to save.
 */
assert.ok(/job\.validationId[\s\S]{0,200}ssSyncStartQuickDeploy/.test(engine),
    'a job with a validation id goes straight to the deploy');
assert.ok(/ssSyncStartQuickDeploy\(job, targetCred\)/.test(engine),
    'against the target org, which is the one holding the validation');

/*
 * And it records the async id the same way an ordinary deploy does, or the
 * sweep cannot resume it after the worker is killed - which is likelier
 * here, since this is the path used for long production deploys.
 */
const quickBody = engine.slice(engine.indexOf('async function ssSyncStartQuickDeploy'),
    engine.indexOf('async function ssSyncPollDeploy'));
assert.ok(/async: \{ stage: 'deploy', id: id/.test(quickBody),
    'a quick deploy is resumable like any other');

/* The id has to survive the validation finishing, or there is nothing to
 * deploy from. */
assert.ok(/deployId: \(current\.async && current\.async\.id\) \|\| null/.test(engine),
    'the org\'s deploy id is kept on a successful job rather than cleared with ' +
    'the rest of the in-flight state');

/* The button, and the window it lives in. */
const quickMarkup = (pipelineRow.match(/<button[^>]*syncQuickDeploy\(job\)[^>]*>/) || [''])[0];
assert.ok(quickMarkup, 'validated jobs need a Quick deploy button');
assert.ok(/ng-if="syncQuickDeployable\(job\)"/.test(quickMarkup),
    'shown only while the org still holds the validation: ' + quickMarkup);
assert.ok(/syncValidationDaysLeft\(job\)/.test(pipelineRow),
    'and the row says how long that is, rather than letting the expiry be discovered');

/*
 * And when it is not offered, the row says why.
 *
 * A missing button explains nothing, and the commonest reason - validated
 * without tests, which the org will not deploy - has a fix nobody would
 * guess. Offering the button regardless is what made this read as broken.
 */
assert.ok(/syncQuickWhyNot\(job\)/.test(pipelineRow),
    'a validation that cannot be quick deployed says why');
assert.ok(/testLevel === 'NoTestRun'/.test(controller),
    'and the panel knows the test-level rule, so it decides before asking the worker');
assert.ok(/result\.testLevel === 'NoTestRun'/.test(engine),
    'while the engine stays the authority and checks again before running');

/*
 * The test level is a pipeline setting because it must be chosen before
 * validating. Offering it at deploy time would be offering it too late.
 */
assert.ok(/sync\.draft\.testLevel/.test(pipelineRow),
    'the pipeline editor chooses the test level');
assert.ok(/testLevel: pipeline\.testLevel/.test(handlerFor(background, 'SS_SYNC_STAGE')),
    'and a staged metadata job takes it from the pipeline');
assert.ok(/testLevel: ssSyncTestLevel\(sent\.testLevel\)/.test(saveHandler),
    'and it is persisted, through the engine\'s own validation of the value');

/* ------------------------------------------------------------------ */
/* The section that is asking for something                            */
/* ------------------------------------------------------------------ */

/*
 * "Waiting on you" is the only section on this page that wants a decision;
 * the other two are records of what already happened. It is marked so it does
 * not get skimmed at the same speed as them - and only it, because a page
 * where three of four sections are highlighted has highlighted nothing.
 */
assert.ok(/class="ss-usage-api ss-sync-waiting" ng-if="sync\.groups\.active\.length"/
    .test(pipelineRow),
    'the waiting section is marked, and only appears when something is waiting');

const highlighted = (pipelineRow.match(/ss-sync-waiting/g) || []).length;
assert.strictEqual(highlighted, 1,
    'exactly one section carries the highlight (found ' + highlighted + ')');

['sync.groups.failed.length', 'sync.groups.succeeded.length'].forEach((gate) => {
    const at = pipelineRow.indexOf('ng-if="' + gate + '"');
    assert.ok(at > -1, 'expected a section gated on ' + gate);
    const opening = pipelineRow.slice(pipelineRow.lastIndexOf('<div', at), at);
    assert.ok(!/ss-sync-waiting/.test(opening),
        'the history sections are not highlighted: ' + opening);
});

/* The colour is its own. Blue marks the current org in the mapping and amber
 * marks a job that needs signing in to; reusing either would make one colour
 * mean two things on one screen. */
/*
 * The panel's own rule, cut at its closing brace. A fixed-length window ran
 * past it into the h4 rule below, so emptying this one still found a purple
 * further down and passed.
 */
const waitingAt = css.indexOf('.ss-sync-waiting {');
assert.ok(waitingAt > -1, 'the waiting panel needs a style rule');
const waitingCss = css.slice(waitingAt, css.indexOf('}', waitingAt));

assert.ok(/#6d28d9|#5b21b6|#ddd6fe/.test(waitingCss),
    'the waiting panel uses the staged colour, matching the pill on its rows: ' + waitingCss);
assert.ok(/border-left:\s*3px/.test(waitingCss),
    'and carries the accent that distinguishes it from the plain cards');
assert.ok(!/#1d4ed8/.test(waitingCss), 'and not the blue that marks the current org');
assert.ok(!/#b45309/.test(waitingCss), 'nor the amber that means needs-sign-in');

/* ------------------------------------------------------------------ */
/* Clearing history                                                    */
/* ------------------------------------------------------------------ */

const clearHandler = handlerFor(background, 'SS_SYNC_CLEAR');
assert.ok(/ssSyncClear\(jobs, message\.group\)/.test(clearHandler),
    'clearing goes through the engine, which owns what is on each list');
assert.ok(/outcome\.error/.test(clearHandler), 'and an unknown list is refused');

/*
 * The discard handler enforces the same rule the list does.
 *
 * The markup never offers Discard on a running row, but a handler that
 * deletes whatever it is told to is one mistaken caller away from throwing
 * away the async id of a deploy that is still going - after which nothing
 * can report how it went.
 */
const discardHandler = handlerFor(background, 'SS_SYNC_DISCARD');
assert.ok(/ssSyncForgettable\(job\)/.test(discardHandler),
    'discard must refuse a running job rather than trusting the markup');

/*
 * Both lists offer it, and both ask first.
 *
 * Asserted against each state's own markup rather than the template as a
 * whole. Searching the whole thing passes on a Clear all wired straight to
 * syncClear, because the Cancel button in the confirmation calls
 * syncConfirmClear too - which is how three broken versions of this passed
 * the first time it was written.
 */
['failed', 'succeeded'].forEach((group) => {
    const idleAt = pipelineRow.indexOf("ng-if=\"sync.clearing !== '" + group + "'\"");
    assert.ok(idleAt > -1, 'the ' + group + ' list needs a Clear all control');
    const idle = pipelineRow.slice(idleAt, idleAt + 200);

    assert.ok(new RegExp("ng-click=\"syncConfirmClear\\('" + group + "'\\)\"").test(idle),
        'pressing Clear all on ' + group + ' asks first: ' + idle);
    assert.ok(!/ng-click="syncClear\(/.test(idle),
        'and does not clear on the first press: ' + idle);

    const askAt = pipelineRow.indexOf("ng-if=\"sync.clearing === '" + group + "'\"");
    assert.ok(askAt > -1, 'the ' + group + ' list needs a confirmation state');
    const asking = pipelineRow.slice(askAt, askAt + 400);

    assert.ok(new RegExp("ng-click=\"syncClear\\('" + group + "'\\)\"").test(asking),
        'confirming ' + group + ' actually clears it');
    assert.ok(new RegExp("ng-click=\"syncConfirmClear\\('" + group + "'\\)\"").test(asking),
        'and there is a way out of the confirmation');

    /* "Clear" is a frightening word next to a deployment list, so each
     * confirmation says what is not being undone - both of them, not one. */
    assert.ok(/The org is not affected/.test(asking),
        'the ' + group + ' confirmation says the org is untouched: ' + asking);
});

/*
 * The confirmation is per list, so confirming one cannot clear the other.
 * A single boolean here would arm both buttons at once.
 */
assert.ok(/\$scope\.sync\.clearing\s*=\s*\(\$scope\.sync\.clearing === group\)\s*\?\s*null\s*:\s*group/
    .test(controller),
    'the confirm state names which list is asking');


/* ------------------------------------------------------------------ */
/* Nothing here writes to an org by itself                             */
/* ------------------------------------------------------------------ */

/*
 * The user chose "stage for review, then apply". A staging path that also ran
 * the job would be that choice quietly reversed, so the handler is held to
 * it: staging may create a job and may not run one.
 */
const stageHandler = handlerFor(background, 'SS_SYNC_STAGE');
assert.ok(/ssSyncNewJob\(/.test(stageHandler), 'staging creates a job');
assert.ok(!/ssSyncRun\(/.test(stageHandler),
    'staging must not run the job it stages - review is the point');

/* And applying is gated on the job actually being in a state that allows it. */
const applyHandler = handlerFor(background, 'SS_SYNC_APPLY');
assert.ok(/ssSyncApplyable\(job\)/.test(applyHandler) && /ssSyncRetryable\(job\)/.test(applyHandler),
    'apply and retry must each check the job is in a state that allows it');

console.log('sync_wiring: ok (' + sent.length + ' messages, both templates bound)');
