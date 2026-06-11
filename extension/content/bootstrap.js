// WebPilot content — bootstrap
(function (WP) {
  'use strict';
  if (window.__webpilotSkipModules) {
    return;
  }
  document.addEventListener('contextmenu', (e) => {
    if (WP.isWebPilotEl?.(e.target)) {
      return;
    }
    WP.state.lastRightClickedEl = e.target;
  }, true);

  // If recording was already active when this frame loaded (e.g. a TinyMCE
  // iframe that opened after broadcastToFrames was already called), join the
  // session immediately so input events are captured.
  WP.safeSend({ type: 'GET_STATE' }, (res) => {
    if (res?.state?.recording) {
      WP.startRecording();
    }
  });

  // Resume recording when tab becomes visible again (user switches back to this tab)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      WP.stopRecording();
    } else {
      // Check recording state when tab becomes visible again
      WP.safeSend({ type: 'GET_STATE' }, (res) => {
        if (res?.state?.recording && !WP.state.isRecording) {
          WP.startRecording();
        }
      });
    }
  });
})(window.WebPilotContent);
