/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
const assert = require('assert');
const fs = require('fs');

/*
 * Standard & custom objects - the describe, as a tree.
 *
 * Object Manager shows a curated few of these properties. The rest -
 * controllerName, cascadeDelete, which compound field a component belongs to,
 * whether a picklist is dependent - are only in the describe, which otherwise
 * means reading a few thousand lines of JSON in a browser tab.
 */

const controller = fs.readFileSync('./js/angular/controllers/MenuAndDetailsCtrl.js', 'utf8');
const view = fs.readFileSync('./js/angular/services/ViewService.js', 'utf8');
const container = fs.readFileSync('./js/angular/services/MetaDataContainer.js', 'utf8');
const directives = fs.readFileSync('./js/angular/directives.js', 'utf8');
const css = fs.readFileSync('./css/styles.css', 'utf8');

function lift(signature) {
    const start = controller.indexOf(signature);
    assert.notStrictEqual(start, -1, 'could not find ' + signature);
    let depth = 0;
    for (let i = controller.indexOf('{', start); i < controller.length; i++) {
        if (controller[i] === '{') { depth++; }
        else if (controller[i] === '}') { depth--; if (depth === 0) { return controller.slice(start, i + 1); } }
    }
    throw new Error('unbalanced braces in ' + signature);
}

/* The tree builder needs its helpers in scope. */
const build = new Function(
    lift('function humaniseKey(key){') + '\n' +
    lift('function itemLabel(item, index){') + '\n' +
    lift('function isSystemField(item){') + '\n' +
    lift('function describeEntries(item){') + '\n' +
    lift('function describeGroups(raw){') +
    ';return { describeGroups: describeGroups, humaniseKey: humaniseKey, ' +
    'itemLabel: itemLabel, isSystemField: isSystemField, describeEntries: describeEntries };')();

const DESCRIBE = {
    name: 'Account',
    label: 'Account',
    custom: false,
    createable: true,
    fields: [
        { name: 'Id', label: 'Account ID', type: 'id', custom: false,
          createable: false, updateable: false },
        { name: 'Name', label: 'Account Name', type: 'string', custom: false,
          createable: true, updateable: true },
        { name: 'Rating__c', label: 'Rating', type: 'picklist', custom: true,
          createable: true, updateable: true,
          picklistValues: [{ value: 'Hot' }, { value: 'Cold' }] }
    ],
    childRelationships: [
        { childSObject: 'Contact', field: 'AccountId', relationshipName: 'Contacts',
          cascadeDelete: true }
    ],
    recordTypeInfos: [{ name: 'Master', available: true }],
    supportedScopes: [{ label: 'All accounts', name: 'everything' }],
    urls: { sobject: '/services/data/v60.0/sobjects/Account' }
};

function main() {

    const groups = build.describeGroups(DESCRIBE);
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, g]));

    /* ------------------------------------------------------------------ */
    /* Facts about the object, then the lists                              */
    /* ------------------------------------------------------------------ */

    assert.strictEqual(groups[0].label, 'Attributes',
        'the object\'s own facts come first - the lists are about its parts');
    const attrKeys = groups[0].entries.map((e) => e.key);
    assert.ok(attrKeys.includes('name') && attrKeys.includes('custom'),
        'scalars are attributes: ' + attrKeys.join(', '));
    assert.ok(attrKeys.includes('urls'),
        'and so is a nested object - it is a fact about the object, not a list');
    assert.ok(!attrKeys.includes('fields'), 'while an array is not');

    /*
     * Groups are derived from the response, not from a list of known keys: a
     * release that adds an array gets a group without anything here changing,
     * and one that removes it leaves no empty heading.
     */
    assert.ok(byLabel['Child Relationships'], 'childRelationships becomes a folder');
    assert.strictEqual(byLabel['Child Relationships'].count, 1, 'with its count');
    assert.ok(byLabel['Record Type Infos'] && byLabel['Supported Scopes'],
        'as does every other array');
    assert.strictEqual(byLabel.Fields.count, 3, 'and the field count is the field count');

    assert.strictEqual(build.humaniseKey('childRelationships'), 'Child Relationships');
    assert.strictEqual(build.humaniseKey('urls'), 'Urls');

    /* Nothing to describe is empty, not a crash. */
    assert.deepStrictEqual(build.describeGroups(null), []);
    assert.deepStrictEqual(build.describeGroups('x'), []);
    assert.deepStrictEqual(build.describeGroups({}), [],
        'an object with no properties has no Attributes folder either');

    /* ------------------------------------------------------------------ */
    /* What a row is called before it is opened                            */
    /* ------------------------------------------------------------------ */

    assert.strictEqual(build.itemLabel({ name: 'Id' }, 0), 'Id', 'a field by its name');
    assert.strictEqual(build.itemLabel({ relationshipName: 'Contacts' }, 0), 'Contacts',
        'a relationship by its relationship name');
    assert.strictEqual(build.itemLabel({ childSObject: 'Case' }, 0), 'Case',
        'and by its child object when it has no relationship name');
    assert.strictEqual(build.itemLabel('everything', 3), 'everything',
        'a bare string is its own label');
    assert.strictEqual(build.itemLabel(null, 7), '(7)',
        'and something with no name at all falls back to its position');
    assert.strictEqual(build.itemLabel({}, 5), '(5)',
        'including an object that simply has none of those keys - which is the ' +
        'case the fallback exists for, since null never reaches it');

    /*
     * Precedence, on an item that has several. A field's own name is what it
     * is called everywhere else; a relationship name on the same row would be
     * a different thing entirely.
     */
    assert.strictEqual(
        build.itemLabel({ name: 'AccountId', relationshipName: 'Account',
                          childSObject: 'Account', label: 'Account ID' }, 0),
        'AccountId', 'the name wins when there is one');
    assert.strictEqual(
        build.itemLabel({ relationshipName: 'Contacts', childSObject: 'Contact' }, 0),
        'Contacts', 'then the relationship name');
    assert.strictEqual(build.itemLabel({ childSObject: 'Case' }, 0), 'Case', 'then the child');

    /* ------------------------------------------------------------------ */
    /* Custom and system fields                                            */
    /* ------------------------------------------------------------------ */

    const fields = byLabel.Fields.items;
    const id = fields.find((f) => f.label === 'Id');
    const name = fields.find((f) => f.label === 'Name');
    const rating = fields.find((f) => f.label === 'Rating__c');

    assert.strictEqual(rating.custom, true, 'a custom field is marked custom');
    assert.strictEqual(rating.system, false, 'and is not a system field');

    /*
     * Neither creatable nor updateable is what "system field" actually means -
     * CreatedDate, SystemModstamp, Id, the rollups. Guessing from the name
     * would miss every formula and catch every custom field ending in Id.
     */
    assert.strictEqual(id.system, true, 'Id is maintained by the org, not filled in');
    assert.strictEqual(name.system, false, 'while Name is an ordinary editable field');

    assert.strictEqual(build.isSystemField({ name: 'X__c', custom: true,
        createable: false, updateable: false }), false,
        'a custom field is never a system field, whatever its permissions');
    assert.strictEqual(build.isSystemField('a string'), false, 'and a scalar is not a field');

    /*
     * The two a name rule gets wrong, in both directions. Guessing from the
     * name catches every ordinary lookup that ends in Id, and misses every
     * system field that does not.
     */
    assert.strictEqual(build.isSystemField({ name: 'AccountId', custom: false,
        createable: true, updateable: true }), false,
        'an editable lookup is not a system field just because it ends in Id');
    assert.strictEqual(build.isSystemField({ name: 'IsDeleted', custom: false,
        createable: false, updateable: false }), true,
        'and a system field is one whatever it is called');

    /* ------------------------------------------------------------------ */
    /* Properties, including the nested ones                               */
    /* ------------------------------------------------------------------ */

    const ratingEntries = Object.fromEntries(
        build.describeEntries(DESCRIBE.fields[2]).map((e) => [e.key, e.value]));

    assert.strictEqual(ratingEntries.type, 'picklist', 'scalars are shown as they are');
    assert.ok(/Hot/.test(ratingEntries.picklistValues),
        'and a nested array is flattened rather than dropped - picklistValues is ' +
        'often the reason the describe was opened: ' + ratingEntries.picklistValues);
    assert.strictEqual(
        Object.fromEntries(build.describeEntries({ a: [] }).map((e) => [e.key, e.value])).a,
        '[]', 'an empty array says it is empty rather than showing nothing');

    assert.deepStrictEqual(build.describeEntries(null), [], 'nothing has no properties');
    assert.deepStrictEqual(build.describeEntries('everything'),
        [{ key: 'value', value: 'everything' }],
        'and a bare string is one property, not a character each');

    /* ------------------------------------------------------------------ */
    /* Wiring                                                              */
    /* ------------------------------------------------------------------ */

    assert.ok(/label: "Standard & Custom Objects"/.test(container), 'the menu entry exists');
    assert.ok(/value: "ObjectDescribe"/.test(container), 'with a value');
    assert.ok(/'ObjectDescribe': \d/.test(controller), 'pinned to the utility bar');
    assert.ok(/objectdescribe: 'objectdescribe'/.test(directives), 'the directive is registered');
    assert.ok(/<objectdescribe><\/objectdescribe>/.test(view), 'and the page is mounted');

    /* Both catalogues, or the Tooling objects are invisible. */
    const loadObjects = lift('$scope.loadDescribeObjects = function(){');
    assert.ok(/globalDescribe\(\)/.test(loadObjects) && /toolingDescribe\(\)/.test(loadObjects),
        'the picker lists both catalogues - a Tooling object\'s describe is the ' +
        'hardest to come by any other way');
    assert.ok(/if\(seen\[name\]\)\{ return; \}/.test(loadObjects),
        'and an object in both appears once');

    const chosen = lift('$scope.describeChosen = function(){');
    assert.ok(/\/sobjects\/' \+ name \+ '\/describe/.test(chosen), 'the data API is asked first');
    assert.ok(/\/tooling\/sobjects\//.test(chosen),
        'and Tooling second, for the objects that only exist there');
    /*
     * Present, then ordered. indexOf returns -1 for a call that is not there,
     * and -1 is less than any index - so this passed with both fetches
     * pointed at Tooling.
     */
    const dataAt = chosen.indexOf("'/sobjects/' + name");
    const toolingAt = chosen.indexOf("'/tooling/sobjects/' + name");
    assert.notStrictEqual(dataAt, -1, 'the data API describe must be there');
    assert.notStrictEqual(toolingAt, -1, 'and the Tooling one');
    assert.ok(dataAt < toolingAt,
        'in that order - most objects are not Tooling objects');
    assert.ok(/describeState\.open = \{\}/.test(chosen),
        'and the tree is collapsed for the new object rather than keeping the ' +
        'previous one\'s open folders');

    /* Each row opens on its own. */
    const page = view.slice(view.indexOf('this.objectdescribe ='),
                            view.indexOf('\nthis.', view.indexOf('this.objectdescribe =') + 10));
    assert.ok(/toggleDescribeNode\(group\.key \+ \\':\\' \+ \$index\)/.test(page),
        'an item is keyed by its group and position, so opening one field does ' +
        'not open the same position in every other folder');
    assert.ok(/expandDescribeAll\(true\)/.test(page) && /expandDescribeAll\(false\)/.test(page),
        'expand all and collapse all are both offered');

    /* The legend keys something real. */
    for (const key of ['is-true', 'is-false', 'is-custom', 'is-system']) {
        assert.ok(new RegExp('\\.theme-lightning \\.' + key + '\\s*\\{').test(css),
            key + ' needs a rule, or the legend keys a colour nothing has');
        assert.ok(page.includes(key), key + ' must be used on the page');
    }

    console.log('object describe test passed');
}

main();
