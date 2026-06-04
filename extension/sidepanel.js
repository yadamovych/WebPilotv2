// sidepanel.js — Side Panel extras
// Runs after popup.js; wires up the Copilot-style quick-prompt bar
// at the top of the Workflows tab.

(function () {
  'use strict';

  const spPrompt = document.getElementById('sp-quick-prompt');
  const spRunBtn = document.getElementById('sp-quick-run');

  if (!spPrompt || !spRunBtn) {
    return;
  }   // not the side panel

  // Convenience accessors for symbols exported by popup.js
  const getState = () => window.__webpilotState;
  const execTemplate = () => {
    if (typeof window.__webpilotExecuteTemplate === 'function') {
      window.__webpilotExecuteTemplate();
    }
  };

  // Keep the quick-prompt in sync with the play-panel textarea.
  spPrompt.addEventListener('input', () => {
    const userRequest = document.getElementById('user-request');
    if (userRequest) {
      userRequest.value = spPrompt.value;
    }
    refreshRunBtn();
  });

  // Run button triggers the same executeTemplate() from popup.js
  spRunBtn.addEventListener('click', () => {
    const userRequest = document.getElementById('user-request');
    if (userRequest) {
      userRequest.value = spPrompt.value;
    }
    execTemplate();
  });

  function refreshRunBtn() {
    const hasText = spPrompt.value.trim().length > 0;
    const hasTemplate = !!(getState()?.selectedTemplateId);
    spRunBtn.disabled = !(hasText && hasTemplate);
  }

  // When the play panel opens/closes, update the run button state
  const playPanel = document.getElementById('play-panel');
  if (playPanel) {
    const observer = new MutationObserver(() => {
      const active = !playPanel.classList.contains('hidden');
      if (active) {
        spPrompt.focus();
      }
      refreshRunBtn();
    });
    observer.observe(playPanel, { attributes: true, attributeFilter: ['class'] });
  }
})();
