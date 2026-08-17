/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * error.html, built from the catalogue in ss-errors.js.
 *
 * The page is a view, not a second copy: an entry added to the catalogue
 * appears here without anybody editing this file, and an entry removed from
 * it cannot linger here explaining something that no longer happens.
 */
(function() {
    'use strict';

    var GROUPS = [
        { prefix: 'SS-1', label: 'The extension itself',
          note: 'Nothing reached your orgs. These are about the extension and the browser.' },
        { prefix: 'SS-2', label: 'Sessions',
          note: 'A pipeline needs a live session for both orgs at once.' },
        { prefix: 'SS-3', label: 'Pipelines and where you are standing',
          note: 'A job always starts from the org you are in.' },
        { prefix: 'SS-4', label: 'What was selected',
          note: 'The job was refused before it reached an org, so nothing was written.' },
        { prefix: 'SS-5', label: 'What the org said',
          note: 'The org was reached and answered. Deploys roll back on error.' }
    ];

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        if (text != null) { node.textContent = text; }
        return node;
    }

    var codes = Object.keys(SS_ERRORS).sort();
    var list = document.getElementById('list');
    var nav = document.getElementById('groups');
    var cards = [];

    GROUPS.forEach(function(group) {
        var mine = codes.filter(function(code) { return code.indexOf(group.prefix) === 0; });
        if (!mine.length) { return; }

        var link = el('a', 'group-link', group.label + ' (' + mine.length + ')');
        link.href = '#' + group.prefix;
        nav.appendChild(link);

        var section = el('section', 'group');
        section.id = group.prefix;
        section.appendChild(el('h2', null, group.label));
        section.appendChild(el('p', 'group-note', group.note));

        mine.forEach(function(code) {
            var entry = SS_ERRORS[code];
            var card = el('article', 'card');
            card.id = code;

            var head = el('div', 'card-head');
            head.appendChild(el('span', 'code', code));
            head.appendChild(el('h3', null, entry.title));
            card.appendChild(head);

            [['When you see it', entry.when], ['Why it happens', entry.why]]
                .forEach(function(pair) {
                    card.appendChild(el('h4', null, pair[0]));
                    card.appendChild(el('p', null, pair[1]));
                });

            card.appendChild(el('h4', null, 'What to do'));
            var steps = el('ol', 'steps');
            (entry.steps || []).forEach(function(step) {
                steps.appendChild(el('li', null, step));
            });
            card.appendChild(steps);

            section.appendChild(card);
            /* Kept for the filter, with its text folded once rather than on
             * every keystroke. */
            cards.push({
                node: card,
                section: section,
                haystack: (code + ' ' + entry.title + ' ' + entry.when + ' ' +
                           entry.why + ' ' + (entry.steps || []).join(' ')).toLowerCase()
            });
        });

        list.appendChild(section);
    });

    /* Filtering, and a section hidden when nothing in it matched - a heading
     * over an empty space reads as a bug in the filter. */
    var filter = document.getElementById('filter');
    filter.addEventListener('input', function() {
        var wanted = filter.value.trim().toLowerCase();
        var shown = Object.create(null);

        cards.forEach(function(card) {
            var match = !wanted || card.haystack.indexOf(wanted) !== -1;
            card.node.hidden = !match;
            if (match) { shown[card.section.id] = true; }
        });

        GROUPS.forEach(function(group) {
            var section = document.getElementById(group.prefix);
            if (section) { section.hidden = !shown[group.prefix]; }
        });

        document.body.classList.toggle('is-empty',
            !cards.some(function(card) { return !card.node.hidden; }));
    });

    /* Arrived at with a code in the address: mark it, so the page does not
     * merely scroll somewhere and leave you to find which one it meant. */
    function highlight() {
        var wanted = decodeURIComponent((window.location.hash || '').replace(/^#/, ''));
        cards.forEach(function(card) {
            card.node.classList.toggle('is-target', card.node.id === wanted);
        });
    }
    window.addEventListener('hashchange', highlight);
    highlight();
})();
