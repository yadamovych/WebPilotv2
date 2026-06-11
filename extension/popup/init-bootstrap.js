// WebPilot popup — bootstrap
(function (WP) {
  'use strict';
  document.addEventListener('DOMContentLoaded', async () => {
    WP.resolveDOM();
    WP.bindStaticEvents();
    await Promise.all([WP.loadSettings(), WP.loadTemplates(), WP.syncRecordingState()]);
    WP.renderSteps();
    WP.renderTemplates();
    WP.checkServerHealth();
  });
})(window.WebPilotPopup);
