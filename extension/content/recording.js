// WebPilot content — recording
(function (WP) {
  'use strict';
  if (window.__webpilotSkipModules) {
    return;
  }
    WP.startRecording = function() {
      if (WP.state.isRecording) {
        return;
      }
      WP.state.isRecording = true;
      WP.mountOverlay('WebPilot · Recording — interact with the page');
      WP.attachListeners();
    }

    WP.stopRecording = function() {
      if (!WP.state.isRecording) {
        return;
      }
      WP.state.isRecording = false;
      WP.detachListeners();
      // Flush any pending input timers so the last typed value is captured
      for (const [, { tid, el, selector }] of WP.state.inputTimers) {
        clearTimeout(tid);
        if (el) {
          WP.sendInputAction(el, selector);
        }
      }
      WP.state.inputTimers.clear();
      WP.unmountOverlay();
    }
})(window.WebPilotContent);
