// WebPilot popup — static event bindings
(function (WP) {
  'use strict';

  WP.bindStaticEvents = function () {
    WP.dom.btnStop?.addEventListener('click', WP.stopPlayback);
    WP.dom.tabBtns.forEach((btn) =>
      btn.addEventListener('click', () => WP.switchTab(btn.dataset.tab)),
    );

    WP.dom.btnRecord.addEventListener('click', WP.toggleRecording);
    WP.dom.btnClear.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ type: 'CLEAR_STEPS' }).catch(() => {});
      } catch (_) {}
      WP.state.steps = [];
      WP.renderSteps();
    });
    WP.dom.btnSave.addEventListener('click', WP.saveTemplate);
    WP.dom.btnImportTemplate?.addEventListener('click', () => WP.dom.importTemplateFile?.click());
    WP.dom.importTemplateFile?.addEventListener('change', WP.importTemplateFromFile);
    WP.dom.btnPreviewVars?.addEventListener('click', WP.previewVariables);

    WP.dom.btnCancelPlay.addEventListener('click', WP.closePlayPanel);
    WP.dom.btnExecute.addEventListener('click', WP.executeTemplate);

    WP.dom.backendSelect.addEventListener('change', WP.refreshApiKeyVisibility);
    WP.dom.toggleKey.addEventListener('click', () => {
      WP.dom.apiKey.type = WP.dom.apiKey.type === 'password' ? 'text' : 'password';
    });
    WP.dom.btnSaveSettings.addEventListener('click', WP.saveSettings);

    WP.dom.btnCheckServer?.addEventListener('click', () => WP.checkServerHealth(true));
    WP.dom.serverStatus?.addEventListener('click', (e) => {
      e.preventDefault();
      WP.checkServerHealth(true);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') {
        return;
      }
      if (WP.state.recording) {
        WP.stopRecording();
      } else {
        document.querySelector('.tpl-rec-btn.recording')?.click();
      }
    });

    try {
      chrome.runtime.onMessage.addListener(WP.onBackgroundMessage);
    } catch (_) {}
  };
})(window.WebPilotPopup);
