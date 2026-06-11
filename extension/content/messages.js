// WebPilot content — messages
(function (WP) {
  'use strict';
  if (window.__webpilotSkipModules) {
    return;
  }
  // ---------------------------------------------------------------------------
  // Message listener (from background)
  // ---------------------------------------------------------------------------
  // Wrap in try/catch so a stale listener on an invalidated context doesn't
  // surface as an uncaught error to the page.
  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      switch (message.type) {
      case 'START_RECORDING':
        WP.startRecording();
        sendResponse({ success: true });
        break;

      case 'STOP_RECORDING':
        WP.stopRecording();
        sendResponse({ success: true });
        break;

      case 'EXECUTE_STEP':
        WP.state.aiSelectorRecovery = message.aiSelectorRecovery === true;
        WP.executeStep(message.step, message.index, message.total, message.devMode, message.afterNavigate)
          .then((result) => sendResponse({ success: true, result }))
          .catch((err) => sendResponse({ error: err.message }));
        return true; // async

      case 'GET_RECORDING_STATE':
        sendResponse({ isRecording: WP.state.isRecording });
        break;

      case 'HIGHLIGHT_STEP_ELEMENT': {
        document.getElementById('webpilot-step-hl')?.remove();
        const sel = message.selector;
        if (!sel) {
          sendResponse({ success: true }); break;
        }
        let found = false;
        try {
          const el = document.querySelector(sel);
          if (el) {
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            WP.showStepHighlight(el, message.action, message.description);
            found = true;
          }
        } catch (_) {}
        sendResponse({ found });
        break;
      }

      case 'UNHIGHLIGHT_STEP_ELEMENT':
        document.getElementById('webpilot-step-hl')?.remove();
        sendResponse({ success: true });
        break;

      case 'SHOW_EXTRACT_MODAL': {
        // Triggered by the browser's native context menu ("WebPilot: Extract…" /
        // "WebPilot: Fill…").  Use the element stored by the capture-phase
        // contextmenu listener; fall back to document.body if nothing was stored.
        const target = WP.state.lastRightClickedEl || document.body;
        WP.showExtractModal(target, message.mode ?? 'extract');
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ error: `Unknown type: ${message.type}` });
      }
    });
  } catch (_) { /* extension context was invalidated before listener could be added */ }
})(window.WebPilotContent);
