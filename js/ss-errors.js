/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * The error catalogue.
 *
 * One entry per *cause*, not per message. Several different sentences can
 * mean "the org refused your session", and they all have the same fix, so
 * they share one code - a catalogue with one code per string is an index of
 * this codebase rather than a thing anybody can use.
 *
 * The catalogue is the single source for both surfaces: the panel puts the
 * code next to the message so it can be looked up or quoted in a bug report,
 * and error.html renders the whole of this file as the page that explains
 * them. Two copies of an explanation is two explanations that disagree, and
 * the one people find is always the stale one.
 *
 * Each entry:
 *   title  - what went wrong, in a few words
 *   when   - the circumstance, so somebody can recognise their own case
 *   why    - the actual cause. Not reassurance; the mechanism.
 *   steps  - what to do, in order, most likely first. Every entry has at
 *            least one, because a documented error with no action is a
 *            lookup that wastes somebody's time twice.
 *
 * Loaded as a plain script in both the extension pages and the content
 * script, so it declares one global and nothing else.
 */
var SS_ERRORS = {

    /* -------------------------------------------------------------- */
    /* 1xx - the extension itself                                      */
    /* -------------------------------------------------------------- */

    'SS-101': {
        title: 'The background worker did not answer',
        when: 'Opening Org Sync & Jobs, or pressing a button on it, and the ' +
              'page reports that it could not reach the extension’s own worker — ' +
              'often as “the message port closed before a response was received”.',
        why: 'Chrome stops an extension’s background worker after about thirty ' +
             'seconds of idleness and starts it again on the next message. If the ' +
             'first message arrives while it is still starting, or the extension was ' +
             'reloaded or updated while this tab stayed open, the connection is ' +
             'closed before an answer comes back. It is a timing problem, not a ' +
             'problem with your orgs or your pipelines.',
        steps: [
            'Press the button again. The worker is awake by then and the second ' +
            'attempt almost always succeeds.',
            'If the page has been open across an extension update, reload the page.',
            'If it keeps happening, open chrome://extensions, reload Salesforce ' +
            'Simplified, then reload the page.'
        ]
    },

    'SS-102': {
        title: 'The sync engine is not loaded',
        when: 'Any Org Sync action, reported as the engine not being loaded.',
        why: 'The worker started but the sync engine script did not come with it. ' +
             'This happens when an extension update was interrupted, or when files ' +
             'were changed on disk while the extension was loaded unpacked.',
        steps: [
            'Open chrome://extensions and reload Salesforce Simplified.',
            'Reload the Salesforce tab.',
            'If you are running it unpacked, check the browser console on the ' +
            'extension’s service worker for a script that failed to parse.'
        ]
    },

    'SS-103': {
        title: 'This is not available here',
        when: 'A sync action attempted from somewhere that is not the extension.',
        why: 'Org Sync runs inside the extension, where it can hold a session for ' +
             'two orgs at once. A page script cannot reach it, and it will not ' +
             'answer one — that boundary is what stops any web page you visit from ' +
             'asking the extension to deploy something.',
        steps: [
            'Open Simplified from the Salesforce tab, or open its own page from ' +
            'the ↗ button, and use Org Sync there.'
        ]
    },

    /* -------------------------------------------------------------- */
    /* 2xx - sessions                                                  */
    /* -------------------------------------------------------------- */

    'SS-201': {
        title: 'Not signed in to that org',
        when: 'Staging or applying a job, where one end of the pipeline has no ' +
              'session in this browser. The job waits as “Needs sign in” rather ' +
              'than failing.',
        why: 'A pipeline needs a live session for both orgs at once. The extension ' +
             'reads them from the browser’s own cookies, so an org you have never ' +
             'opened in this browser — or have signed out of — has nothing to read.',
        steps: [
            'Open the named org in a tab and sign in.',
            'Come back to Org Sync & Jobs and press Retry on the job.',
            'The job was not started, so nothing was deployed and nothing needs ' +
            'undoing.'
        ]
    },

    'SS-202': {
        title: 'The org refused the session',
        when: 'A job that was running stops and reports that the session expired ' +
              'or was refused.',
        why: 'The session was valid when the job started and is not now — it timed ' +
             'out, or somebody signed out of that org elsewhere. A deploy runs with ' +
             'rollback on error, so a package that failed part-way left the target ' +
             'org as it was.',
        steps: [
            'Open that org in a tab and sign in again.',
            'Press Retry on the job.',
            'For a data job, check the job’s detail first: records written before ' +
            'the session went are reported there, and retrying re-matches on the ' +
            'same key rather than duplicating them.'
        ]
    },

    'SS-203': {
        title: 'The session used was not that org’s own',
        when: 'The org refused a session, and the message says where the session ' +
              'came from rather than only that it expired.',
        why: 'Salesforce sets a session cookie on login.salesforce.com as well as ' +
             'on each org’s own host, and a cookie on the parent domain matches ' +
             'every org beneath it. The extension prefers the org’s own cookie, ' +
             'but when that org has never been opened in this browser there is only ' +
             'the parent one — which belongs to some other org, and this one ' +
             'rejects it exactly as it would reject an expired session.',
        steps: [
            'Open that org in a tab once, so the browser holds a session on the ' +
            'org’s own host.',
            'Press Retry on the job.',
            'Signing in again elsewhere does not help on its own: it is which host ' +
            'holds the session that matters, not how recently you signed in.'
        ]
    },

    /* -------------------------------------------------------------- */
    /* 3xx - pipelines and where you are standing                      */
    /* -------------------------------------------------------------- */

    'SS-301': {
        title: 'That pipeline is gone or switched off',
        when: 'Pressing a button on a pipeline that has since been removed, or ' +
              'one whose Enabled box is unticked.',
        why: 'The page was showing a pipeline list read earlier. It has changed ' +
             'since — usually because it was edited in another tab.',
        steps: [
            'Reload the page to read the pipelines again.',
            'If the pipeline is switched off, use Edit and tick Enabled.'
        ]
    },

    'SS-302': {
        title: 'This org cannot send down that pipeline',
        when: 'A pipeline row says the current org is not part of it, or that it ' +
              'only runs the other way.',
        why: 'A pipeline is a pair of orgs and a direction. A job always starts ' +
             'from the org you are in, so a one-way pipeline pointed the other way ' +
             'has nothing it can do from here, and a pipeline this org is no part ' +
             'of has nothing at all.',
        steps: [
            'Open the org the row names as the sender, and tick what you want to ' +
            'send there.',
            'Or use Edit on the pipeline and set the direction to Both ways, if ' +
            'sending either way is what you meant.'
        ]
    },

    'SS-303': {
        title: 'This panel cannot be pointed at that org',
        when: 'Org Sync in the in-page panel, where no pipeline can send from here.',
        why: 'The panel acts as the org whose page it is sitting on and cannot be ' +
             'pointed anywhere else — signing in to a second org from the panel does ' +
             'not move it. A pipeline built against an org’s my.salesforce.com host ' +
             'is also not reachable from that org’s Lightning page: those are two ' +
             'different origins.',
        steps: [
            'Use the button on that notice to open Simplified as its own page.',
            'Choose the org you want to send from in the org picker.',
            'The pipelines then become usable, and the selection you ticked ' +
            'travels with you.'
        ]
    },

    /* -------------------------------------------------------------- */
    /* 4xx - what was selected                                         */
    /* -------------------------------------------------------------- */

    'SS-401': {
        title: 'Nothing was selected to send',
        when: 'Send selection or Validate only with nothing ticked.',
        why: 'These act on the components ticked in the metadata lists — the same ' +
             'selection package.xml is built from. With none, there is no subject.',
        steps: [
            'Open any metadata list and tick the components you want to send.',
            'Return to Org Sync & Jobs; the buttons appear with the count in them.'
        ]
    },

    'SS-402': {
        title: 'That query returned no records',
        when: 'Staging a record migration.',
        why: 'The query ran and matched nothing, so there is nothing to carry. A ' +
             'job with no rows is not staged, because it would report success ' +
             'having done nothing.',
        steps: [
            'Check the filter in the query — it is shown in full before staging.',
            'Run the same query in the REST Explorer to see what the org returns.'
        ]
    },

    'SS-403': {
        title: 'That query returned too many records',
        when: 'Staging a record migration whose query matches more rows than one ' +
              'job carries.',
        why: 'Records are written all or none, and 200 is the largest single ' +
             'all-or-nothing write the org accepts. A larger migration is more than ' +
             'one job, deliberately: a partial write is the outcome that is hardest ' +
             'to unpick.',
        steps: [
            'Narrow the query — by date, by record type, by owner — so each run ' +
            'carries 200 or fewer.',
            'Run it several times with different filters. Matching is on your key, ' +
            'so a row carried twice is updated, not duplicated.'
        ]
    },

    'SS-404': {
        title: 'There is nothing to match these records on',
        when: 'A record migration where the chosen key is empty on the records ' +
              'being sent.',
        why: 'Record Ids differ between orgs, so a field has to mean the same row ' +
             'in both. If none of the selected records has a value in that field, ' +
             'nothing can be matched and every row would be created.',
        steps: [
            'Choose a different key — an External Id field is the one the org ' +
            'matches on itself.',
            'Or choose “create every record as new”, if creating them all is what ' +
            'you actually want.',
            'Or populate the key on the source records first.'
        ]
    },

    'SS-405': {
        title: 'A key matched more than one record',
        when: 'A record migration where a key value exists twice in the target org.',
        why: 'The job stops rather than guessing. Two rows with the same key means ' +
             'the extension cannot tell which one you meant to update, and picking ' +
             'either would overwrite a record nobody chose.',
        steps: [
            'Find the duplicates in the target org on that field.',
            'Either merge them, or pick a key that is genuinely unique — an ' +
            'External Id field with the Unique box ticked cannot get into this ' +
            'state.'
        ]
    },

    'SS-406': {
        title: 'The org needs fields the job does not carry',
        when: 'A record migration where records have to be created in the target ' +
              'and a required field is missing.',
        why: 'Some fields cannot be carried across: formulas and roll-ups are ' +
             'calculated, and lookups hold Ids belonging to the source org. If one ' +
             'of those is required on create, the org refuses the row.',
        steps: [
            'Read the job’s detail — it names the fields the org asked for and, ' +
            'where the extension dropped one itself, why.',
            'Include the missing field in the query if it is one that can be ' +
            'carried.',
            'If it is a lookup, create the parent records in the target org first.'
        ]
    },

    /* -------------------------------------------------------------- */
    /* 5xx - what the org said                                         */
    /* -------------------------------------------------------------- */

    'SS-501': {
        title: 'The org refused a component',
        when: 'A deploy or validation that fails with one or more components named.',
        why: 'The target org rejected part of the package. The job’s detail carries ' +
             'the org’s own words against the component and line it said them ' +
             'about. Deploys run with rollback on error, so nothing was left ' +
             'half-applied.',
        steps: [
            'Open the job and read what the org refused — it is the org’s message, ' +
            'not the extension’s.',
            'A component that names something missing usually means the manifest ' +
            'is short a dependency: tick the component in package.xml and use ' +
            '“include related components”, then send again.',
            'Fix the source, then Retry.'
        ]
    },

    'SS-502': {
        title: 'That validation cannot be quick deployed',
        when: 'Quick deploy is not offered on a successful validation, or is ' +
              'refused when pressed.',
        why: 'The org only quick deploys a validation that ran tests, and only for ' +
             'ten days. A validation run with no tests can never become a quick ' +
             'deploy however recent it is.',
        steps: [
            'Use Edit on the pipeline and set Tests to local tests.',
            'Validate again. The new validation is quick deployable.',
            'If the validation is simply old, validate again — the ten days are ' +
            'the org’s limit, not a setting.'
        ]
    },

    'SS-503': {
        title: 'The org did not finish in time',
        when: 'A retrieve or deploy that stops being waited on.',
        why: 'The extension stops waiting after its own limit. The org may still ' +
             'be working: a deploy is identified by an id, and a job interrupted ' +
             'mid-deploy is picked back up rather than being reported as failed.',
        steps: [
            'Check Deployment Status in the target org’s setup — the deploy may ' +
            'have finished after the extension stopped watching.',
            'If it did, discard the job here; the org has already done the work.',
            'If it did not, Retry.'
        ]
    },

    'SS-504': {
        title: 'The org’s answer could not be read',
        when: 'A job stops reporting that the org returned nothing, or something ' +
              'that is not JSON.',
        why: 'Almost always a login page returned in place of an API response, ' +
             'which is what an org sends when the session is not accepted. It can ' +
             'also be a maintenance window or a proxy between the browser and the ' +
             'org.',
        steps: [
            'Open the org in a tab and check that you are signed in.',
            'Check Trust Status for that instance.',
            'Retry the job.'
        ]
    }
};

/* Both surfaces need the same lookup, and neither should reach into the map
 * directly - an unknown code has to produce something rather than undefined. */
function ssErrorInfo(code) {
    return (code && SS_ERRORS[code]) || null;
}

/* The extension's own page for a code, for linking to from a message. */
function ssErrorPageUrl(code) {
    var base = 'error.html';
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
            base = chrome.runtime.getURL('error.html');
        }
    } catch (e) { /* not in an extension context; the relative path still works */ }
    return code ? base + '#' + encodeURIComponent(code) : base;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SS_ERRORS: SS_ERRORS, ssErrorInfo: ssErrorInfo,
                       ssErrorPageUrl: ssErrorPageUrl };
}
