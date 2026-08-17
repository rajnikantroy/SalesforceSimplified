/* Author: Rajni Kant Roy(Salesforce Technical Architect) */
var app = window.app || angular.module("SalesforceSimplifiedApp");
app.controller('MyViewGridCtrl', function($scope, MetaDataContainer, sfdc, $q, $timeout, $filter, UserId) {
	/************************************************DEBUG LOGS START***************************************************/
	$scope.dataList = [];
	$scope.clsSecurity = 'clsSecurity';
	$scope.edit = 'Edit';
	$scope.download = 'Download';
	$scope.baseUrl = SS_ORIGIN;
	$scope.loadingDebug = true;
	$scope.uname = "My";
	$scope.userFullName = "";
	$scope.loading = false;
	$scope.nodataavailable = false;
	if(readCookie('SFDCSimplified_uname') && readCookie('SFDCSimplified_uname').split(" ")[0]){
		$scope.uname = readCookie('SFDCSimplified_uname').split(" ")[0]+"'s";
		$scope.userFullName = readCookie('SFDCSimplified_uname');
	}

	$scope.DebugLogClose = function(){
		// Closing a panel is not a reason to reload Salesforce underneath the
		// user. It used to, which threw away whatever page they were on.
		$("#debuglogGridModal").css({"display": "none"});
	}

	/*
	 * Whose logs these are.
	 *
	 * The query filters on the uid cookie, which "View as different user"
	 * rewrites - so this panel shows the selected user's logs, not
	 * necessarily the signed-in user's. It used to say "My" and "Delete My
	 * Logs" either way, which is a poor label to read just before deleting
	 * somebody else's logs.
	 */
	$scope.logOwner = function(){
		return $scope.userFullName || 'the current user';
	};

	$scope.gridError = '';

	$scope.queryForDebugLogs = function(){
		try{
			$scope.loading = true;
			$scope.gridError = '';
			$("#debuglogGridModal").css({"display": "block"});
			var DebugLogObject = MetaDataContainer.byValue('DebugLogs');
			$scope.querySFDC(DebugLogObject.query, DebugLogObject.url);
		}catch(error){
			$scope.loading = false;
			$scope.gridError = 'Could not load debug logs: ' + (error && error.message ? error.message : error);
		}
	}

	/*
	 * The rows actually on screen.
	 *
	 * The table renders `dataList | filter:search`, and Delete used to work
	 * from dataList - so narrowing the search to one log and pressing Delete
	 * removed every log the query had returned. Deleting what is shown is the
	 * only reading of that button anyone would expect.
	 */
	$scope.visibleLogs = function(){
		return $filter('filter')($scope.dataList || [], $scope.search);
	};

	$scope.deleteBtn = 'Delete';

	// Deleting logs cannot be undone, so the count and the owner are put in
	// front of the user before anything is removed.
	$scope.deleteMyLogs = function(){
		var logs = $scope.visibleLogs();
		$scope.gridError = '';

		if(!logs.length){
			$scope.gridError = 'There are no debug logs here to delete.';
			return;
		}
		if(!ssSessionId()){
			$scope.gridError = sfdc.noSessionMessage;
			return;
		}
		var shown = logs.length === ($scope.dataList || []).length
			? logs.length + ' debug log' + (logs.length === 1 ? '' : 's')
			: logs.length + ' of ' + $scope.dataList.length + ' debug logs (the ones matching your search)';
		if(!confirm('Delete ' + shown + ' for ' + $scope.logOwner() + '?\n\nThis cannot be undone.')){
			return;
		}
		removeLogs(logs);
	};

	// One row, for when the point is to clear a single noisy log.
	$scope.deleteOneLog = function(log){
		if(!log || !log.Id){ return; }
		$scope.gridError = '';
		if(!ssSessionId()){
			$scope.gridError = sfdc.noSessionMessage;
			return;
		}
		removeLogs([log]);
	};

	function removeLogs(logs){
		$scope.loading = true;

		// Each delete used to re-run the full log query in its own success
		// handler, so deleting N logs fired N deletes *and* N queries. Wait
		// for all of them, then refresh once.
		var failures = 0;
		var deletions = logs.map(function(log) {
			return sfdc.remove(ssToolingSobjectUrl('ApexLog', log.Id)).then(null, function (rejection) {
				// Counted rather than swallowed: a partial failure used to
				// look exactly like a clean sweep, and the logs that would
				// not delete came back on the refresh with no explanation.
				failures++;
				$scope.gridError = sfdc.errorMessage(rejection) ||
					'Some logs could not be deleted.';
			});
		});

		$q.all(deletions).finally(function(){
			$scope.loading = false;
			if(failures){
				$scope.gridError = failures + ' of ' + logs.length +
					' log' + (logs.length === 1 ? '' : 's') + ' could not be deleted. ' +
					($scope.gridError || '');
			}
			var DebugLogObject = MetaDataContainer.byValue('DebugLogs');
			if(DebugLogObject && DebugLogObject.query){
				$scope.querySFDC(DebugLogObject.query, DebugLogObject.url);
			}
		});
	}

	
	$scope.querySFDC = function(query, url){
		return sfdc.query(query, url).then(function(data){
			var records = data.records || [];
			$scope.dataList = records;
			$scope.dataLength = records.length;
			$scope.nodataavailable = records.length === 0;
			$scope.loading = false;
		}, function(rejection){
			if (rejection && rejection.cancelled) { return; }
			console.log(sfdc.errorMessage(rejection));
			$scope.loading = false;
		});
	}

	$scope.objectNameRowTemplateMap = new Map();
	$scope.objectPrefixRowTemplateMap = new Map();
	$scope.objectPrefixRowTemplate = null;
	
	$scope.recordCompareMap = new Map();
	$scope.recordCompareList = [];

	/*
	 * Puts text on the clipboard, and reports whether it actually got there.
	 *
	 * This is reached from a click, but only after two chained HTTP calls (the
	 * global describe, then the record), so by the time it runs the click's
	 * user activation has expired. document.execCommand('copy') is refused
	 * without that activation and returns false - which the previous version
	 * discarded, then announced "Copied..." and reloaded the page regardless.
	 * Nothing reached the clipboard and the reload threw away the context.
	 *
	 * navigator.clipboard.writeText has no activation requirement given the
	 * clipboardWrite permission in the manifest, so it is the real path here;
	 * execCommand stays as a fallback for a focus-less document.
	 */
	function copyText (textToCopy) {
	  function legacyCopy() {
		var textarea = document.createElement('textarea');
		textarea.value = textToCopy;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'absolute';
		textarea.style.left = '-9999px';
		document.body.appendChild(textarea);
		textarea.select();
		var ok = false;
		try {
		  ok = document.execCommand('copy');
		} catch (err) {
		  ok = false;
		}
		textarea.remove();
		return ok;
	  }

	  if (navigator.clipboard && navigator.clipboard.writeText) {
		return navigator.clipboard.writeText(textToCopy).then(function(){
		  return true;
		}, function(){
		  return legacyCopy();
		});
	  }
	  return $q.when(legacyCopy());
	}

	$scope.compareObject = function(url) {
		$scope.recordCompareList = [];
		return sfdc.get(ssApiUrl(url)).then(function(data){
			if(!data){ return; }
			for (const [key, value] of Object.entries(data)) {
				$scope.recordCompareMap.set(key, value);
				$scope.recordCompareList.push({ fieldName: key, record1Value: value });
			}
			$scope.loading = false;
		}, function(){
			$scope.loading = false;
		});
	}

	/*
	 * Compare the record you are on with another of the same type.
	 *
	 * The button used to call deleteMyLogs() - a control labelled "Compare"
	 * that deleted debug logs. The two records are fetched through the same
	 * rowTemplate the copy path uses, so they are the same shape and the
	 * fields line up without any guessing.
	 */
	$scope.compareRecords = function(){
		var other = ($scope.recordId2 || '').trim();
		$scope.gridError = '';

		if(!$scope.recordId1){
			$scope.gridError = 'Open a record first - there is nothing here to compare.';
			return;
		}
		if(!other){
			$scope.gridError = 'Enter the id of a record to compare with.';
			return;
		}
		if(other.slice(0, 3) !== $scope.recordId1.slice(0, 3)){
			$scope.gridError = 'Those are two different kinds of record, so their fields do not line up.';
			return;
		}

		$scope.loading = true;
		return $scope.loadAllObjectForCompareRecord($scope.recordId1.slice(0, 3)).then(function(){
			var template = $scope.objectPrefixRowTemplateForRecordComparison;
			if(!template){
				$scope.loading = false;
				$scope.gridError = 'Could not work out how to read this kind of record.';
				return;
			}
			return $q.all([
				sfdc.get(ssApiUrl(template.replace('{ID}', $scope.recordId1))),
				sfdc.get(ssApiUrl(template.replace('{ID}', other)))
			]).then(function(results){
				var first = results[0] || {};
				var second = results[1] || {};
				var names = Object.keys(first);
				Object.keys(second).forEach(function(key){
					if(names.indexOf(key) === -1){ names.push(key); }
				});
				$scope.recordCompareList = names.map(function(key){
					return {
						fieldName: key,
						record1Value: first[key],
						record2Value: second[key],
						differs: String(first[key]) !== String(second[key])
					};
				});
				$scope.loading = false;
			}, function(rejection){
				$scope.loading = false;
				$scope.gridError = sfdc.errorMessage(rejection) ||
					'One of those records could not be read.';
			});
		});
	};

	// Leaves the button showing what actually happened, and puts it back a
	// couple of seconds later. It used to reset to 'Copy' immediately and
	// claim success even when the clipboard write had been refused.
	function reportCopy(label){
		$scope.copyBtn = label;
		$scope.loading = false;
		$timeout(function(){ $scope.copyBtn = 'Copy'; }, 2000);
	}

	$scope.copyObject = function(url) {
		return sfdc.get(ssApiUrl(url)).then(function(data){
			if(!data){
				reportCopy('Nothing to copy');
				return;
			}
			return $q.when(copyText(JSON.stringify(data, null, 2))).then(function(copied){
				reportCopy(copied ? 'Copied!' : 'Copy failed');
			});
		}, function(){
			reportCopy('Copy failed');
		});
	}

	// Both callers wanted the same thing: the rowTemplate URL for the sObject
	// owning a 3-character key prefix. Two identical request blocks before.
	function rowTemplateForPrefix(prefix){
		return sfdc.get(ssSobjectsUrl()).then(function(data){
			var sobjects = (data && data.sobjects) || [];
			for (var i = 0; i < sobjects.length; i++) {
				if(sobjects[i] && sobjects[i].keyPrefix === prefix){
					return sobjects[i].urls.rowTemplate;
				}
			}
			return null;
		}, function(){
			$scope.loading = false;
			return null;
		});
	}

	$scope.loadAllObjectForCompareRecord = function(prefix) {
		return rowTemplateForPrefix(prefix).then(function(template){
			if(template){ $scope.objectPrefixRowTemplateForRecordComparison = template; }
		});
	}

	$scope.loadAllObject = function(prefix) {
		return rowTemplateForPrefix(prefix).then(function(template){
			if(template){ $scope.objectPrefixRowTemplate = template; }
			return template;
		});
	}

	$scope.$watch('objectPrefixRowTemplateForRecordComparison', function(value) {
		if(value && $scope.recordId1){
			var value1 = value.replace('{ID}', $scope.recordId1);
			$scope.compareObject(value1);
		}
	  });
	
	/*
	 * Copying is driven straight from the click rather than by watching
	 * objectPrefixRowTemplate. A $watch only fires when the value changes, so
	 * copying a second record of the same object type re-assigned the same
	 * template, the watch stayed quiet, and the button sat on "Copying..."
	 * forever. The template is still published on the scope for anything else
	 * that reads it, but nothing depends on the assignment to trigger work.
	 */
	
	//getRecordId
	function getRecordId(href) {
	  let url = new URL(href);
	  // Find record ID from URL
	  let searchParams = new URLSearchParams(url.search.substring(1));
	  // Salesforce Classic and Console
	  if (url.hostname.endsWith(".salesforce.com")) {
		let match = url.pathname.match(/\/([a-zA-Z0-9]{3}|[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})(?:\/|$)/);
		if (match) {
		  let res = match[1];
		  if (res.includes("0000") || res.length == 3) {
			return match[1];
		  }
		}
	  }

	  // Lightning Experience and Salesforce1
	  if (url.hostname.endsWith(".lightning.force.com")) {
		let match;

		if (url.pathname == "/one/one.app") {
		  // Pre URL change: https://docs.releasenotes.salesforce.com/en-us/spring18/release-notes/rn_general_enhanced_urls_cruc.htm
		  match = url.hash.match(/\/sObject\/([a-zA-Z0-9]+)(?:\/|$)/);
		} else {
		  match = url.pathname.match(/\/lightning\/[r|o]\/[a-zA-Z0-9_]+\/([a-zA-Z0-9]+)/);
		}
		if (match) {
		  return match[1];
		}
	  }
	  // Visualforce
	  {
		let idParam = searchParams.get("id");
		if (idParam) {
		  return idParam;
		}
	  }
	  // Visualforce page that does not follow standard Visualforce naming
	  for (let [, p] of searchParams) {
		if (p.match(/^([a-zA-Z0-9]{3}|[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/) && p.includes("0000")) {
		  return p;
		}
	  }
	  return null;
	}
	
	/************************************************DEBUG LOGS END***************************************************/
	
	/************************************************CLASS START******************************************************/
	$scope.closeClassModal = function(){
		$("#classGridModal").css({"display": "none"});
	}
	/*
	 * 'ApexClass', not 'Classes'.
	 *
	 * Nothing is registered under 'Classes' - the menu entry is built by
	 * DynamicMetadataService and keyed on the API name - so the lookup came
	 * back empty and reading .query off it threw. The button opened a modal
	 * that then sat empty forever.
	 */
	$scope.openClassModal = function(){
			$scope.gridError = '';
			var ClassObject = MetaDataContainer.byValue('ApexClass');
			if(!ClassObject || !ClassObject.query){
				$scope.gridError = 'Apex classes are not available in this org.';
				$("#classGridModal").css({"display": "block"});
				return;
			}
			$scope.loading = true;
			$("#classGridModal").css({"display": "block"});
			$scope.querySFDC(ClassObject.query, ClassObject.url);
	}
	/************************************************CLASS END******************************************************/
	
	/************************************************COPY START******************************************************/
	$scope.copyBtn = 'Copy';
	$scope.CopyModal = function(){
			$scope.loading = true;
			$scope.copyBtn = 'Copying...';
			// No modal: this copies the record to the clipboard and reports
			// through the button. It used to open the Apex classes grid,
			// which has nothing to do with copying a record.
			$scope.recordId = getRecordId(window.location.href);
			// getRecordId returns undefined off a record page, and slicing that
			// used to throw before anything else could report the problem.
			if(!$scope.recordId){
				reportCopy('No record here');
				return;
			}
			var prefix = $scope.recordId.slice(0, 3);
			return $scope.loadAllObject(prefix).then(function(template){
				if(!template){
					reportCopy('Copy failed');
					return;
				}
				return $scope.copyObject(template.replace('{ID}', $scope.recordId));
			});
	}
	/************************************************COPY END******************************************************/
	/************************************************COMPARE START******************************************************/
	$scope.CompareModal = function(){
			$scope.loading = true;
			$scope.gridError = '';
			$("#compareModal").css({"display": "block"});
			$scope.recordId1 = getRecordId(window.location.href);
			// The same guard the copy path already had: off a record page
			// getRecordId returns undefined, and slicing that threw before
			// anything could report the problem.
			if(!$scope.recordId1){
				$scope.loading = false;
				$scope.gridError = 'Open a record first - there is nothing here to compare.';
				return;
			}
			var prefix = $scope.recordId1.slice(0, 3);
			$scope.loadAllObjectForCompareRecord(prefix);
	}
	$scope.CompareClose = function(){
		$("#compareModal").css({"display": "none"});
		//location.reload();
	}
	/************************************************COMPARE END******************************************************/
});
