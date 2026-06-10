// WebPilot popup — messages
(function (WP) {
  'use strict';
  // ---------------------------------------------------------------------------
  // Background → popup message bridge
  // ---------------------------------------------------------------------------
  WP.onBackgroundMessage = function(message) {
    if (message.type === 'STEPS_UPDATED') {
      WP.state.steps = message.steps;
      // Forward live steps to any open template editor that is recording
      const openEditor = document.querySelector('.tpl-editor');
      if (openEditor?._onStepsUpdated) {
        openEditor._onStepsUpdated(message.steps);
      } else {
        WP.renderSteps();
      }
    } else if (message.type === 'PLAYBACK_PROGRESS') {
      if (!WP.dom.playStatus.classList.contains('error')) {
        const retry = message.retryAttempt
          ? ` (retry ${message.retryAttempt}/${message.retryMax})`
          : '';
        WP.setStatus(
          WP.dom.playStatus,
          `Running step ${message.currentIndex + 1} / ${message.total}${retry}…`,
          '',
        );
      }
    } else if (message.type === 'PLAYBACK_COMPLETE') {
      WP.showRunReport(message.report);
      if (message.report?.success && !message.report?.error) {
        WP.setStatus(WP.dom.playStatus, '✓ Playback finished', 'success');
      } else if (message.report?.error) {
        WP.setStatus(WP.dom.playStatus, `✗ ${message.report.error}`, 'error');
      }
      WP.dom.btnExecute.disabled = false;
      if (WP.dom.btnStop) {
        WP.dom.btnStop.disabled = false;
        WP.dom.btnStop.classList.add('hidden');
      }
      WP.dom.executeLabel.textContent = '▶ Execute with AI';
    }
  }
})(window.WebPilotPopup);
