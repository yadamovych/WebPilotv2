// WebPilot content — context
(function (WP) {
  'use strict';
  if (window.__webpilotSkipModules) {
    return;
  }
  WP.handleContextInvalidated = function() {
    try {
      WP.stopRecording();
    } catch (_) {}
  };

  WP.safeSend = function(msg, cb) {
    if (!chrome.runtime?.id) {
      WP.handleContextInvalidated();
      if (cb) {
        cb(undefined);
      }
      return;
    }
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) { /* SW waking up or gone — ignore */ }
        if (cb) {
          cb(res);
        }
      });
    } catch (e) {
      WP.handleContextInvalidated();
      if (cb) {
        cb(undefined);
      }
    }
  };

  WP.safeStorageSet = function(items) {
    if (!chrome.runtime?.id) {
      return;
    }
    try {
      // Use chrome.storage.local for extracted values so they persist across page navigation
      // (chrome.storage.session gets cleared on navigation)
      chrome.storage.local.set(items).catch(() => {});
    } catch (_) {}
  };

  WP.safeStorageGet = function(keys, cb) {
    if (!chrome.runtime?.id) {
      cb({}); return;
    }
    try {
      // Use chrome.storage.local to retrieve extracted values across page navigation
      chrome.storage.local.get(keys, cb);
    } catch (_) {
      cb({});
    }
  };

  WP.recordAction = function(el, action) {
    const payload = { ...action };
    if (el && window.WebPilotSelectors) {
      payload.selectors = window.WebPilotSelectors.alternativesFromElement(el, action.selector);
    }
    if (window.WebPilotStepUtils && action.selector) {
      payload.selectorQuality = window.WebPilotStepUtils.scoreSelectorQuality(action.selector).score;
    }
    WP.safeSend({ type: 'RECORD_ACTION', action: payload });
  };
})(window.WebPilotContent);
