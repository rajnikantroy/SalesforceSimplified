/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Bootstrap for simplified.html.
 *
 * The content-script bootstrap in js/bootstrap.js deliberately returns early
 * when ssIsOrgPage() is false, which this page is - so it needs its own, and
 * for the same structural reason it must run last: angular.bootstrap compiles
 * the markup, and compiling it requires every directive, service and
 * controller to already be registered.
 *
 * The order of what follows matters. Nothing may query the org until
 * ssAuthReady() has resolved, because that is what picks the org and fetches
 * its session - before then SS_ORIGIN still points at chrome-extension://.
 * Angular is bootstrapped first anyway, so the page paints its shell
 * immediately rather than showing a blank tab while a cookie is fetched; the
 * panels themselves already wait on ssAuthReady().
 */
(function () {
    'use strict';

    function bootstrap() {
        var root = document.getElementById('SalesforceSimplified');
        if (!root) {
            console.error('Salesforce Simplified: page root missing.');
            return;
        }
        try {
            angular.bootstrap(root, ['SalesforceSimplifiedApp']);
        } catch (e) {
            console.error('Salesforce Simplified: failed to bootstrap the page.', e);
            return;
        }

        stripTooltips(root);

        // The sidenav is a panel concept and does not exist here, so the
        // "did it compile" signal used on an org page does not apply. The
        // menu is the equivalent: if it never rendered, nothing else will.
        if (!document.querySelector('.mainmenuSidebar')) {
            console.error('Salesforce Simplified: the metadata menu failed to compile.');
        }
    }

    /*
     * No tooltips on this page.
     *
     * The custom ones are CSS generated content and are switched off in the
     * stylesheet. The browser's own title="" tooltips cannot be reached that
     * way - they are drawn by the browser, not the page - so the attributes
     * have to go.
     *
     * An observer rather than a one-off sweep because the markup is Angular
     * templates: title and data-title are interpolated, so they reappear on
     * every render, every filter and every panel switch. Scoped to the app
     * root and to those two attributes so it is not watching the document.
     */
    function stripTooltips(root) {
        var ATTRS = ['title', 'data-title'];

        function clean(node) {
            if (!node || node.nodeType !== 1) { return; }
            /*
             * One exception: a name the grid shortened to 30 characters. Its
             * full value is nowhere else on the page, so removing the tooltip
             * does not remove a repetition, it removes the only copy. The
             * stylesheet lets these through too - see "except where the name
             * was shortened".
             *
             * Only data-title survives, and only here. The browser's own
             * title= is still stripped: keeping both would draw the panel's
             * tooltip and the browser's own, one over the other.
             */
            var keepDataTitle = node.classList && node.classList.contains('ss-truncated');
            ATTRS.forEach(function (attr) {
                if (attr === 'data-title' && keepDataTitle) { return; }
                if (node.hasAttribute && node.hasAttribute(attr)) { node.removeAttribute(attr); }
            });
            if (node.querySelectorAll) {
                node.querySelectorAll('[title],[data-title]').forEach(clean);
            }
        }

        clean(root);

        try {
            new MutationObserver(function (mutations) {
                mutations.forEach(function (mutation) {
                    if (mutation.type === 'attributes') {
                        clean(mutation.target);
                    } else {
                        mutation.addedNodes.forEach(clean);
                    }
                });
            }).observe(root, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ATTRS
            });
        } catch (e) {
            // No MutationObserver: the initial sweep still stands.
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
