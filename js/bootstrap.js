/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
/*
 * Angular bootstrap. This file MUST stay last in the manifest's
 * content_scripts list.
 *
 * angular.bootstrap() compiles the markup index.js injected, and compiling it
 * requires every controller, service and directive to already be registered on
 * the module. index.js is 3rd of 11 scripts, so bootstrapping from there raced
 * the eight files after it.
 *
 * That race fails silently: a missing controller throws $controller:ctrlreg
 * during the compile/link phase, inside Angular's $exceptionHandler. It is
 * caught and written to the console, never propagated - so a try/catch around
 * angular.bootstrap() sees nothing, the root ends up with an $injector
 * attached, and the subtree is left uncompiled. <menu> never expands into the
 * sidenav and ng-mouseover is never bound, so hovering the launcher does
 * nothing at all.
 *
 * Running last makes the ordering structural rather than a matter of timing.
 */
(function(){
	'use strict';

	// Classic and Lightning only - index.js mounts nothing anywhere else, so
	// there is nothing here to compile and no warning to give.
	if(!ssIsOrgPage()){
		return;
	}

	/*
	 * This org, counted once.
	 *
	 * Here rather than in ss-core's own load, because this is the file that
	 * already knows the page is an org page and not a login screen - and an
	 * org key taken from a login host would be a fifth org that does not
	 * exist.
	 */
	if(typeof ssNoteOrgUse === 'function'){ ssNoteOrgUse(); }

	// Same reasoning for the login, logout and OAuth pages: index.js
	// deliberately mounts no launcher there, so there is nothing to compile.
	// Without this the missing-sidenav check below fires on every one of them
	// and reports a compile failure for markup that was never injected.
	if(ssIsAuthPage()){
		return;
	}

	// Content scripts default to run_at document_idle, so the DOM is already
	// parsed and this runs immediately; ready() is only a safety net.
	angular.element(document).ready(function(){
		bootstrapAllRoots();

		// The sidenav only exists once the <menu> directive has been compiled,
		// which makes it a reliable "did it actually work" signal.
		if(!document.getElementById('mySidenav')){
			console.error('Salesforce Simplified: menu failed to compile - the '
				+ 'launcher will not respond to hover. Check for earlier Angular '
				+ 'errors from this extension.');
		}
	});
})();
