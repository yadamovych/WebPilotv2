// WebPilot popup — recording
(function (WP) {
  'use strict';
  // ---------------------------------------------------------------------------
  // Recording — manual toggle
  // ---------------------------------------------------------------------------
  WP.syncRecordingState = async function() {
    try {
      const res = await WP.sendMsg({ type: 'GET_STATE' });
      if (!res?.state) {
        return;
      }
      WP.state.recording = res.state.recording ?? false;
      WP.state.steps = res.state.steps ?? [];
      WP.applyRecordingUI();
      WP.renderSteps();
    } catch (_) { /* popup opened before background ready */ }
  };

  WP.toggleRecording = async function() {
    WP.state.recording ? await WP.stopRecording() : await WP.startRecording();
  };

  WP.startRecording = async function() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const res = await WP.sendMsg({ type: 'START_RECORDING', tabId: tab.id });
      if (!res?.success) {
        throw new Error(res?.error ?? 'Failed to start');
      }
      WP.state.recording = true;
      WP.applyRecordingUI();
    } catch (err) {
      WP.showStatus(WP.dom.recordError, err.message, false);
    }
  };

  WP.stopRecording = async function() {
    const res = await WP.sendMsg({ type: 'STOP_RECORDING' });
    WP.state.recording = false;
    // Guard: if the service worker was restarted mid-recording its STATE.steps is
    // empty even though we had steps.  Prefer our local copy in that case.
    if (res?.steps?.length > 0) {
      WP.state.steps = res.steps;
    }
    WP.applyRecordingUI();
    WP.renderSteps();
  };

  WP.applyRecordingUI = function() {
    const rec = WP.state.recording;
    WP.dom.btnRecord.classList.toggle('recording', rec);
    WP.dom.recordLabel.textContent = rec ? '⏹ Stop Recording' : 'Record Step';
    WP.dom.recordingStatus.classList.toggle('hidden', !rec);
  };
})(window.WebPilotPopup);
