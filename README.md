# Salesforce Simplified

**Browse, search and package your org's metadata from any Salesforce page — Apex, flows, fields, logs, package.xml and org health.**

`v2.1.8` · Manifest V3 · MIT licensed · no build step, no bundler, no tracking

**Download link** : https://chrome.google.com/webstore/detail/salesforce-simplified/hjeigbpcblpkaienmpihneipkempijob

**Blog** : https://salesforcsimplified.blogspot.com

**Report Issue** : https://github.com/rajnikantroy/Salesforce-Simplified/issues/new

---

Salesforce Simplified puts the org's metadata one hover away from wherever you already are. No Setup navigation, no second tab, no waiting for a page that lists the thing you wanted to click.

It runs two ways, from the same code:

- **Injected overlay** — a launcher on any Salesforce page. Hover it, the sidebar opens over the page you were on. `Esc` closes it.
- **Standalone workspace** — the same panel as its own full tab, for when you are working in it rather than glancing at it. `Alt + Shift + S`.

## The engine

Nothing here keeps a list of what your org contains. Every object, field and route is resolved from the org at the moment it is asked:

- **Live dynamic describe** — `/sobjects`, `/tooling/sobjects` and per-object describes decide what can be queried and where, so standard, custom and managed-package objects are all discovered rather than enumerated.
- **Self-correcting queries** — a request is routed to the API that can actually serve it, preflighted against the object's real fields, and repaired if the org still refuses it: read what the error names, drop exactly that, retry. Each repair is remembered, so the same object never pays for the same mistake twice.
- **Optimized pagination** — lists page rather than truncating at the first 200 rows.

This is why it works against an org it has never seen, including one with a field added this morning.

## Features

### 🔍 Metadata Explorer
Apex classes, triggers, Visualforce pages and components, Aura and LWC bundles, objects, fields, labels, flows, workflows, email templates, static resources, debug logs and test coverage — as recent items or searched across the whole org, newest first. **View As** shows what another user has been working on, without logging in as them.

### 📦 Package.xml & Retrieve
Tick components and get a manifest — then get what the manifest forgot. Dependency resolution asks the org what travels with each selection: an object's fields, layouts, record types, validation rules, list views, buttons and compact layouts; a permission set, group or profile's every grant. Managed-package components are guarded against, and **Retrieve** hands back a real deployable ZIP built by the org's own Metadata API, so it deploys with `sf project deploy` or Ant untouched.

### 🔀 Org Sync & Jobs
Move metadata between two authenticated orgs: retrieve from the source, deploy to the target, quick-deploy a passed validation. Records travel too, matched on an External Id or a key field you nominate — upserted in one call where the org allows it, looked up and split into updates and inserts where it does not. Every job keeps history that survives a browser restart, and staged jobs wait for you to press Apply.

### 🕸️ Event Graph
Correlate what happened across debug logs, SetupAuditTrail, AsyncApexJob, record timestamps and the extension's own actions. Every edge states its confidence — confirmed by a shared identifier, likely from ordering plus a known relationship, or merely inferred from proximity — and the graph is explicit about what it could not see rather than inferring across the gap. **Replay** animates a trace without re-executing anything. Export as JSON, SVG, PNG or a real vector PDF.

Where no runtime telemetry exists — which is most orgs — the **record relationship graph** answers from what every org always has: lookups, child relationships, audit fields and history objects.

### 🧩 All Fields & Export
Two buttons added to pages you are already on:

- **All Fields** on a record page — every field on the record, not just the ones on the layout, editable wherever the org says the running user may edit them.
- **Export** on a list view — an editable SOQL query and three file formats, no Data Loader install and no report to build.

### ⭐ Change Watcher
Star the handful of components a release depends on and get a timeline of every time one of them moved. Detected by comparing `LastModifiedDate`, not by reading the audit trail — so it needs only the read access you already used to find them, and a component that disappears is reported as deleted.

### 🩺 Diagnostics & Utilities
REST Explorer with a rail of what the org actually advertises, Bulk API job status, object describe, a debug log centre that filters to one user's logs, Salesforce Trust status for your instance, API limits and usage, a news timeline of what changed in the org today, and Named Credentials. Every error the extension raises carries a code you can look up.

### 🔑 Authentication & multi-org
The page's own session is used when it is available. When the org hides it — *Lock sessions to the domain in which they were first used*, or an HttpOnly cookie — it falls back to a Connected App via OAuth (Authorization Code with PKCE), or a session id you paste in. Grants are held **one per org**, so signing in to a sandbox does not overwrite production and signing out of one does not sign you out of the other.

## Supported pages

`*.my.salesforce.com` · `*.lightning.force.com` · `*.my.salesforce-setup.com` · `*.vf.force.com` · `*.visual.force.com`

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt + Shift + S` | Open or focus the full-page workspace (rebindable at `chrome://extensions/shortcuts`) |
| `Esc` | Close the injected overlay |
| `/` | Focus the component search box |

## Install from source

```bash
git clone https://github.com/rajnikantroy/Salesforce-Simplified.git
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select the folder. There is no build step — what is in the repository is what runs.

## For developers

### Architecture

| Layer | Where | Role |
| --- | --- | --- |
| Content script | `index.js` → `js/bootstrap.js` | Mounts the UI into the host page |
| Shared core | `js/ss-core.js` | Org URLs, API version, session and OAuth state, cookies, SOQL escaping |
| Service worker | `js/background.js` | OAuth PKCE, per-org token store, REST/SOAP relay, notifications, alarms |
| Sync engine | `js/sync-engine.js` | Two-org retrieve/deploy — runs in the worker, the only place that can hold two credentials at once |
| Angular app | `js/angular/` | 16 services and 2 controllers; templates are strings on `ViewService` / `mygridviewservices`, rendered by generic directives |
| Event graph | `js/event-graph/` | Plain JavaScript — no Angular, no network, no model calls |

Two constraints worth knowing before editing:

- **`js/bootstrap.js` must stay last** in the manifest's `content_scripts`. Angular compiles the injected markup on bootstrap, and compiling it needs every service, controller and directive already registered. Getting this wrong fails silently — Angular swallows the error and the launcher simply stops responding to hover.
- **Content scripts cannot reach the org directly.** Since Chrome 85 a content script's `fetch` carries the page's origin, so cross-origin calls are blocked before they leave. Requests go through the service worker, which holds the host permissions.

### Tests

95 files, plain `node` and `assert` — no framework, no dependencies, nothing to install.

```bash
for t in tests/*.test.js; do node "$t" || echo "FAIL $t"; done
```

The event-graph modules and the sync engine are `require`-able directly; the Angular services are loaded under `vm.runInNewContext` with stubbed `ss-core` globals (see `tests/sfdc_api.test.js` for the pattern).

## Privacy

Usage counters live in this browser's `localStorage`, keyed by org, and are never sent anywhere — nothing about a record, a query or a user is stored, only that a feature was used and when. There is no analytics endpoint and no telemetry. The only non-Salesforce host contacted is `api.status.salesforce.com`, the public Trust API, and only to show your instance's status.

Nothing is sent to any AI or inference service. The Event Graph's analysis is deterministic: it walks the graph, and every finding cites the events it came from.

## License

MIT © 2018 Rajni Kant Roy — see [LICENSE](LICENSE).
