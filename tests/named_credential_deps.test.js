/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/*
 * What travels with a Named Credential.
 *
 * This is the one family in the service where the useful direction is
 * backwards. A Named Credential points at an External Credential - an
 * ordinary forward dependency. The External Services point at *it*, so no
 * forward query from the credential can ever reach them however good its
 * coverage, and the manifest arrives in the target org with a credential
 * whose services were left behind.
 *
 * Driven against the real service with a stub org, because the two things
 * that can go wrong here are both invisible to a read of the source: a query
 * filtered on the wrong end of the dependency object returns rows, just the
 * wrong ones; and a column name that does not exist on this release returns
 * nothing at all, which is indistinguishable from "there are none".
 */

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(
    path.join(ROOT, 'js/angular/services/PackageDependencyService.js'), 'utf8');

/* A $q backed by native promises - the service only uses when/all/catch. */
const $q = {
    when: (value) => Promise.resolve(value),
    all: (list) => Promise.all(list)
};

/*
 * A stub org that records what it was asked.
 *
 * Asserting on the query matters as much as asserting on the answer here:
 * both directions of the dependency object return well-formed rows, so a
 * filter on the wrong end looks like a working feature returning nothing.
 */
function org(options) {
    const settings = options || {};
    const asked = { queries: [], describes: [] };

    const sfdc = {
        get: function (url) {
            if (/\/describe$/.test(url)) {
                asked.describes.push(url);
                return settings.describe
                    ? Promise.resolve(settings.describe)
                    : Promise.reject(new Error('no permission'));
            }
            /* rawToolingQuery builds its own URL and calls get. */
            asked.queries.push(decodeURIComponent(url));
            return Promise.resolve({ records: settings.dependencyRows || [] });
        },
        query: function (soql) {
            asked.queries.push(soql);
            return Promise.resolve({ records: settings.serviceRows || [] });
        }
    };

    const MetadataApiService = {
        describeTypes: () => Promise.resolve(
            'types' in settings
                ? settings.types
                : { ExternalServiceRegistration: true, ApexClass: true, Flow: true })
    };

    let made = null;
    const box = {
        console: console,
        window: {},
        Promise: Promise,
        decodeURIComponent: decodeURIComponent,
        encodeURIComponent: encodeURIComponent,
        ssToolingQueryUrl: () => '/services/data/v67.0/tooling/query/?q=',
        ssToolingSobjectsUrl: () => '/services/data/v67.0/tooling/sobjects',
        ssApiOrigin: () => '',
        escapeSoqlLiteral: (v) => String(v || '').replace(/'/g, "\\'"),
        angular: { module: () => ({ service: function (name, deps) {
            const build = deps[deps.length - 1];
            made = new build(sfdc, $q, {}, MetadataApiService);
            return this;
        } }) }
    };
    box.globalThis = box;
    vm.createContext(box);
    vm.runInContext(source, box);
    assert.ok(made, 'the service did not construct');
    return { service: made, asked: asked };
}

const CREDENTIAL = { Id: '0XA000000000001', DeveloperName: 'ERP_Gateway' };
const withFields = (...names) => ({ fields: names.map((name) => ({ name: name })) });
const serviceQuery = (asked) =>
    asked.queries.filter((q) => /FROM ExternalServiceRegistration/.test(q))[0];
const dependencyQuery = (asked) =>
    asked.queries.filter((q) => /MetadataComponentDependency/.test(q))[0];

async function run() {

    /* -------------------------------------------------------------- */
    /* It is asked about at all                                        */
    /* -------------------------------------------------------------- */

    /*
     * The gate that produced the report. hasDependencies decides which ticked
     * components get resolved, and a type missing from it is never asked - so
     * a Named Credential contributed nothing, silently.
     */
    {
        const { service } = org({});
        assert.strictEqual(service.hasDependencies('NamedCredential'), true,
            'a Named Credential is never asked what travels with it');

        ['CustomObject', 'PermissionSet', 'PermissionSetGroup', 'Profile', 'EntityDefinition']
            .forEach((type) => assert.strictEqual(service.hasDependencies(type), true,
                type + ' stopped resolving'));
        assert.strictEqual(service.hasDependencies('ApexClass'), false,
            'every type now resolves, which is not what this gate is for');
    }

    /* And resolve() must route it, or the gate opens onto nothing. */
    {
        const { service, asked } = org({ describe: withFields('NamedCredential') });
        await service.resolve('NamedCredential', CREDENTIAL);
        assert.ok(serviceQuery(asked),
            'resolve() does not route a Named Credential to its own resolver');
    }

    /* -------------------------------------------------------------- */
    /* The external services registered against it                     */
    /* -------------------------------------------------------------- */

    {
        const { service, asked } = org({
            describe: withFields('DeveloperName', 'NamedCredential'),
            serviceRows: [
                { DeveloperName: 'ErpOrders', NamespacePrefix: null },
                { DeveloperName: 'ErpInvoices', NamespacePrefix: 'null' }
            ]
        });
        const members = await service.forNamedCredential(CREDENTIAL);

        assert.deepStrictEqual(
            Array.from(members).map((m) => m.type + ':' + m.name).sort(),
            ['ExternalServiceRegistration:ErpInvoices', 'ExternalServiceRegistration:ErpOrders'],
            'the external services registered against the credential are not returned');

        /* The string "null" is what the org sends for an absent namespace on
         * some columns, and it must not become a namespace. */
        assert.ok(!Array.from(members).some((m) => m.namespace),
            'the literal string "null" was taken as a namespace');

        assert.ok(/WHERE NamedCredential = 'ERP_Gateway'/.test(serviceQuery(asked)),
            'the services are not filtered to this credential: ' + serviceQuery(asked));
    }

    /* A managed external service keeps its namespace, in the name and on the
     * member - the manifest needs the prefixed name. */
    {
        const { service } = org({
            describe: withFields('NamedCredential'),
            serviceRows: [{ DeveloperName: 'ErpOrders', NamespacePrefix: 'acme' }]
        });
        const members = await service.forNamedCredential(CREDENTIAL);
        assert.strictEqual(members[0].name, 'acme__ErpOrders');
        assert.strictEqual(members[0].namespace, 'acme');
    }

    /* -------------------------------------------------------------- */
    /* Which column, asked of the org                                  */
    /* -------------------------------------------------------------- */

    /*
     * The column has not kept one name across releases. Written down here it
     * does not fail on the releases it does not match - the query returns no
     * rows, which reads exactly like a credential with no services. So the
     * describe decides, and both shapes have to work.
     */
    {
        const { service, asked } = org({
            describe: withFields('DeveloperName', 'NamedCredentialId'),
            serviceRows: [{ DeveloperName: 'ErpOrders' }]
        });
        await service.forNamedCredential(CREDENTIAL);
        assert.ok(/WHERE NamedCredentialId = '0XA000000000001'/.test(serviceQuery(asked)),
            'an Id column must be matched against the Id, not the name: ' +
            serviceQuery(asked));
    }

    /*
     * With both, the name column wins. A record reaching resolve() from a
     * list that carried no Id still has a name, so matching by name is the
     * one that always has something to match on.
     */
    {
        const { service, asked } = org({
            describe: withFields('NamedCredentialId', 'NamedCredential'),
            serviceRows: []
        });
        await service.forNamedCredential(CREDENTIAL);
        assert.ok(/WHERE NamedCredential = 'ERP_Gateway'/.test(serviceQuery(asked)),
            'with both columns available the Id one was chosen: ' + serviceQuery(asked));
    }

    /* No such column on this org: nothing, rather than a query that cannot
     * parse. */
    {
        const { service, asked } = org({
            describe: withFields('DeveloperName', 'MasterLabel'),
            serviceRows: [{ DeveloperName: 'ErpOrders' }]
        });
        const members = await service.forNamedCredential(CREDENTIAL);
        assert.ok(!serviceQuery(asked),
            'a query was sent against a column the org does not have');
        assert.deepStrictEqual(Array.from(members), []);
    }

    /*
     * No describe at all - no permission, or no such object here. Everything
     * in this service degrades to an empty list rather than failing the
     * resolve, and this is no exception.
     */
    {
        const { service } = org({ describe: null, serviceRows: [{ DeveloperName: 'X' }] });
        const members = await service.forNamedCredential(CREDENTIAL);
        assert.deepStrictEqual(Array.from(members), [],
            'a describe this user cannot read must not fail the whole resolve');
    }

    /*
     * And the type has to be one the org can actually retrieve. A manifest
     * naming a metadata type this org has not got fails the entire retrieve,
     * which is a poor trade for one dependency.
     */
    {
        const { service } = org({
            describe: withFields('NamedCredential'),
            serviceRows: [{ DeveloperName: 'ErpOrders' }],
            types: { ApexClass: true }
        });
        const members = await service.forNamedCredential(CREDENTIAL);
        assert.deepStrictEqual(Array.from(members), [],
            'a type the org cannot retrieve was put in the manifest anyway');
    }

    /* -------------------------------------------------------------- */
    /* The dependency query runs backwards                             */
    /* -------------------------------------------------------------- */

    /*
     * This is the crux. Everywhere else the service asks "what does X point
     * at" - MetadataComponentId on the left, RefMetadataComponent* read back.
     * Here the question is "what points at X", which is the same object with
     * the filter on the other end. Filtered the usual way it returns rows,
     * they are simply the wrong ones, and the feature looks like it works.
     */
    {
        const { service, asked } = org({
            describe: withFields('NamedCredential'),
            dependencyRows: [
                { MetadataComponentName: 'ErpOrders',
                  MetadataComponentType: 'ExternalServiceRegistration',
                  MetadataComponentNamespace: null },
                { MetadataComponentName: 'ErpSync',
                  MetadataComponentType: 'ApexClass',
                  MetadataComponentNamespace: null }
            ]
        });
        const members = await service.forNamedCredential(CREDENTIAL);
        const soql = dependencyQuery(asked);

        assert.ok(soql, 'nothing asks the dependency API what points at the credential');
        assert.ok(/WHERE RefMetadataComponentId = '0XA000000000001'/.test(soql),
            'the dependency query is filtered on the wrong end - this asks what the ' +
            'credential points at, which can never reach anything pointing at it:\n    ' +
            soql);
        assert.ok(/SELECT MetadataComponentName, MetadataComponentType/.test(soql),
            'the reverse query still reads the Ref* columns, which name the credential ' +
            'itself rather than its dependents:\n    ' + soql);

        const names = Array.from(members).map((m) => m.type + ':' + m.name).sort();
        assert.deepStrictEqual(names,
            ['ApexClass:ErpSync', 'ExternalServiceRegistration:ErpOrders'],
            'everything that points at the credential should travel with it');
    }

    /*
     * Both sources, deduped. Neither is reliable alone - the dependency API
     * has been Beta for years with coverage that varies by type, and the
     * direct query knows about exactly one kind of dependent.
     */
    {
        const { service } = org({
            describe: withFields('NamedCredential'),
            serviceRows: [{ DeveloperName: 'ErpOrders' }],
            dependencyRows: [{ MetadataComponentName: 'ErpOrders',
                               MetadataComponentType: 'ExternalServiceRegistration',
                               MetadataComponentNamespace: null }]
        });
        const members = await service.forNamedCredential(CREDENTIAL);
        assert.strictEqual(Array.from(members).length, 1,
            'the same service found by both sources is listed twice');
    }

    /* A credential with no Id cannot be asked the reverse question, and must
     * not send a query filtered on nothing. */
    {
        const { service, asked } = org({
            describe: withFields('NamedCredential'),
            serviceRows: [{ DeveloperName: 'ErpOrders' }]
        });
        const members = await service.forNamedCredential({ DeveloperName: 'ERP_Gateway' });
        assert.ok(!dependencyQuery(asked),
            'a dependency query was sent with no id to filter on');
        assert.strictEqual(Array.from(members).length, 1,
            'the direct query should still work without an Id');
    }

    /* Nothing at all is an empty list, not a rejection. */
    {
        const { service } = org({ describe: withFields('NamedCredential') });
        assert.deepStrictEqual(Array.from(await service.forNamedCredential(CREDENTIAL)), []);
        assert.deepStrictEqual(Array.from(await service.forNamedCredential(null)), []);
    }

    console.log('named_credential_deps: ok');
}

run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
