/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * package.xml member naming.
 *
 * Metadata that lives under an object has to be named for the object that
 * owns it. A bare member name is a component the Metadata API cannot find,
 * so the retrieve comes back without it and says nothing - the failure is a
 * package that looks fine and is missing pieces, which is the worst shape a
 * deployment problem can take.
 *
 * packageMemberName is a closure inside MenuAndDetailsCtrl, so rather than
 * standing up Angular the test lifts it out with the two collaborators it
 * touches. That keeps the assertions against the shipped source: if the
 * function moves or changes shape, this stops finding it and fails.
 */

const source = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');

function extract(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notStrictEqual(start, -1, 'could not find ' + startMarker + ' in the controller');
    const end = source.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, 'could not find the end of ' + startMarker);
    return source.slice(start, end);
}

const separators = extract('var OBJECT_SCOPED_SEPARATOR', '};') + '};';
const owning = extract('function owningObject(record){', '\n    }') + '\n    }';
const homePage = extract('function isHomePageLink(record){', '\n    }') + '\n    }';
const typing = extract('function packageMetadataType(record){', '\n    }') + '\n    }';
const naming = extract('function packageMemberName(record){', '\n    }') + '\n    }';

// The two things the lifted code reaches for.
const $scope = { entityIdMap: new Map(), selectedMetadata: {} };

// eslint-disable-next-line no-new-func
const lifted = new Function('$scope',
    separators + '\n' + owning + '\n' + homePage + '\n' + typing + '\n' + naming +
    '\nreturn { packageMemberName: packageMemberName, packageMetadataType: packageMetadataType };')($scope);
const packageMemberName = lifted.packageMemberName;
const packageMetadataType = lifted.packageMetadataType;

function record(type, fields) {
    return Object.assign({ attributes: { type: type } }, fields);
}

function main() {
    /* ------------------------------------------------------------------ */
    /* Object-scoped types carry their object                              */
    /* ------------------------------------------------------------------ */
    $scope.selectedMetadata = { value: 'CustomField' };
    assert.strictEqual(
        packageMemberName(record('CustomField', {
            DeveloperName: 'Rating',
            EntityDefinition: { QualifiedApiName: 'Account' }
        })),
        'Account.Rating__c',
        'a custom field is named for its object, with the __c the API name has');

    $scope.selectedMetadata = { value: 'ValidationRule' };
    assert.strictEqual(
        packageMemberName(record('ValidationRule', {
            ValidationName: 'Close_Date_In_Future',
            EntityDefinition: { QualifiedApiName: 'Opportunity' }
        })),
        'Opportunity.Close_Date_In_Future',
        'a validation rule is named for its object - it used to go out bare');

    $scope.selectedMetadata = { value: 'WebLink' };
    assert.strictEqual(
        packageMemberName(record('WebLink', {
            Name: 'Send_To_ERP',
            EntityDefinition: { QualifiedApiName: 'Invoice__c' }
        })),
        'Invoice__c.Send_To_ERP',
        'a button on a custom object keeps the object API name as it stands');

    /*
     * Layout is the exception the platform itself makes: a hyphen, not a dot.
     */
    $scope.selectedMetadata = { value: 'Layout' };
    assert.strictEqual(
        packageMemberName(record('Layout', {
            Name: 'Account Layout',
            EntityDefinition: { QualifiedApiName: 'Account' }
        })),
        'Account-Account Layout',
        'a layout uses a hyphen');

    /* ------------------------------------------------------------------ */
    /* Where the object name comes from                                    */
    /* ------------------------------------------------------------------ */
    $scope.selectedMetadata = { value: 'CustomField' };
    assert.strictEqual(
        packageMemberName(record('CustomField', {
            DeveloperName: 'Status', SobjectType: 'Case'
        })),
        'Case.Status__c',
        'SobjectType serves when EntityDefinition was not queried');

    /*
     * TableEnumOrId may be an 01I id. It is deliberately left as-is: the
     * id-to-name query answers later and buildPkgXmlString substitutes it
     * then, so resolving here would only race that.
     */
    $scope.entityIdMap.clear();
    assert.strictEqual(
        packageMemberName(record('CustomField', {
            DeveloperName: 'Ref', TableEnumOrId: '01I5j000000abcdEAA'
        })),
        '01I5j000000abcdEAA.Ref__c',
        'an entity id is left for the later substitution');
    assert.ok($scope.entityIdMap.has('01I5j000000abcdEAA'),
        'and is registered so the name lookup knows to ask for it');

    // EntityDefinition wins over the id when both are present - no lookup
    // needed, and no chance of the substitution not having run yet.
    assert.strictEqual(
        packageMemberName(record('CustomField', {
            DeveloperName: 'Ref',
            TableEnumOrId: '01I5j000000abcdEAA',
            EntityDefinition: { QualifiedApiName: 'Account' }
        })),
        'Account.Ref__c',
        'a resolved object name beats an id that still needs resolving');

    /* ------------------------------------------------------------------ */
    /* WebLink is two metadata types wearing one object                    */
    /*                                                                     */
    /* Buttons and links on an sObject retrieve as WebLink and are named   */
    /* for the object. Custom links on the home page come back from the    */
    /* same query but are CustomPageWebLink, with no object at all - filed */
    /* as a bare WebLink they are silently left out of the package.        */
    /* ------------------------------------------------------------------ */
    $scope.selectedMetadata = { value: 'WebLink' };

    const objectLink = record('WebLink', {
        Name: 'Send_To_ERP',
        PageOrSobjectType: 'Invoice__c',
        EntityDefinition: { QualifiedApiName: 'Invoice__c' }
    });
    assert.strictEqual(packageMetadataType(objectLink), 'WebLink',
        'a button on an object is a WebLink');
    assert.strictEqual(packageMemberName(objectLink), 'Invoice__c.Send_To_ERP',
        'and is named for that object');

    const homeLink = record('WebLink', { Name: 'Intranet', PageOrSobjectType: 'HomePage' });
    assert.strictEqual(packageMetadataType(homeLink), 'CustomPageWebLink',
        'a home page link is a different metadata type');
    assert.strictEqual(packageMemberName(homeLink), 'Intranet',
        'and takes no object prefix');

    // Orgs that will not return PageOrSobjectType: no owning object is the
    // next best evidence, and gets the same answer.
    const homeLinkNoColumn = record('WebLink', { Name: 'Intranet' });
    assert.strictEqual(packageMetadataType(homeLinkNoColumn), 'CustomPageWebLink',
        'without the column, a link with no object is still a home page link');
    assert.strictEqual(packageMemberName(homeLinkNoColumn), 'Intranet',
        'and still takes no prefix');

    // Custom labels keep their existing remapping.
    assert.strictEqual(packageMetadataType(record('ExternalString', { Name: 'Greeting' })),
        'CustomLabel', 'a label is still remapped to CustomLabel');

    /* ------------------------------------------------------------------ */
    /* Everything else stays unprefixed                                    */
    /* ------------------------------------------------------------------ */
    $scope.selectedMetadata = { value: 'ApexClass' };
    assert.strictEqual(
        packageMemberName(record('ApexClass', { Name: 'AccountService' })),
        'AccountService',
        'an Apex class does not belong to an object and must not gain a prefix');

    assert.strictEqual(
        packageMemberName(record('ApexClass', {
            Name: 'AccountService', EntityDefinition: { QualifiedApiName: 'Account' }
        })),
        'AccountService',
        'and must not gain one even if the record happens to carry an object');

    /* ------------------------------------------------------------------ */
    /* Namespaces and already-qualified names                              */
    /* ------------------------------------------------------------------ */
    $scope.selectedMetadata = { value: 'CustomField' };
    assert.strictEqual(
        packageMemberName(record('CustomField', {
            DeveloperName: 'Score', NamespacePrefix: 'acme',
            EntityDefinition: { QualifiedApiName: 'Account' }
        })),
        'Account.acme__Score__c',
        'a managed field keeps its namespace inside the object prefix');

    assert.strictEqual(
        packageMemberName(record('CustomField', {
            DeveloperName: 'Account.Rating',
            EntityDefinition: { QualifiedApiName: 'Account' }
        })),
        'Account.Rating__c',
        'a name that already carries an object must not be prefixed twice');

    /* ------------------------------------------------------------------ */
    /* Custom objects                                                      */
    /* ------------------------------------------------------------------ */
    $scope.selectedMetadata = { value: 'CustomObject' };
    assert.strictEqual(
        packageMemberName(record('CustomObject', { DeveloperName: 'Invoice' })),
        'Invoice__c',
        'a custom object gets the __c its API name has, and no prefix');

    /* ------------------------------------------------------------------ */
    /* A flow names itself through its definition                          */
    /*                                                                     */
    /* The Tooling Flow object is one row per version, carrying MasterLabel */
    /* - the human label, with spaces - and no Name or DeveloperName. So    */
    /* the member came out empty, empty members are dropped, and the        */
    /* manifest showed no flows at all rather than wrong ones. That reads   */
    /* as "flows cannot be packaged", which is not true: Flow is a valid    */
    /* Metadata API type and its member is the flow's API name.            */
    /* ------------------------------------------------------------------ */

    $scope.selectedMetadata = { value: 'Flow' };

    assert.strictEqual(
        packageMemberName(record('Flow', {
            MasterLabel: 'My Screen Flow',
            VersionNumber: 3,
            Definition: { DeveloperName: 'My_Screen_Flow' }
        })),
        'My_Screen_Flow',
        'a flow is named by its definition, not by its label');

    /*
     * The label is not a fallback. "My Screen Flow" is not a member any org
     * can resolve - the spaces alone make it invalid - so producing nothing is
     * better than producing that, and the panel can then say the row could not
     * be named.
     */
    assert.strictEqual(
        packageMemberName(record('Flow', { MasterLabel: 'My Screen Flow', VersionNumber: 3 })),
        '',
        'without the definition there is no member, rather than a label with spaces');

    // Version numbers do not belong in the member: deploying a flow creates a
    // new version in the target, it does not overwrite the one numbered here.
    assert.ok(!/-3$/.test(packageMemberName(record('Flow', {
        MasterLabel: 'My Screen Flow',
        VersionNumber: 3,
        Definition: { DeveloperName: 'My_Screen_Flow' }
    }))), 'the version number is not part of the member');

    console.log('package member name regression test passed');
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
