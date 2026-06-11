// WebPilot popup — settings
(function (WP) {
  'use strict';
  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  WP.loadSettings = async function() {
    let serverConfig = {};
    try {
      const result = await chrome.storage.local.get('serverConfig');
      serverConfig = result.serverConfig ?? {};
    } catch (_) {}
    WP.dom.serverUrl.value = serverConfig.url ?? 'http://localhost:8000';
    WP.dom.backendSelect.value = serverConfig.backend ?? 'groq';
    WP.dom.apiKey.value = serverConfig.apiKey ?? '';
    WP.dom.modelName.value = serverConfig.model ?? '';
    WP.dom.devMode.checked = serverConfig.devMode ?? false;
    WP.dom.aiSelectorRecovery.checked = serverConfig.aiSelectorRecovery === true;
    WP.state.devMode = WP.dom.devMode.checked;
    WP.refreshApiKeyVisibility();
  };

  WP.refreshApiKeyVisibility = function() {
    WP.dom.apiKeyGroup.classList.toggle('hidden', WP.dom.backendSelect.value === 'vllm');
  };

  WP.saveSettings = async function() {
    const config = {
      url:     WP.dom.serverUrl.value.trim() || 'http://localhost:8000',
      backend: WP.dom.backendSelect.value,
      apiKey:  WP.dom.apiKey.value.trim(),
      model:   WP.dom.modelName.value.trim(),
      devMode: WP.dom.devMode.checked,
      aiSelectorRecovery: WP.dom.aiSelectorRecovery.checked,
    };
    const res = await WP.sendMsg({ type: 'SET_SERVER_CONFIG', config });
    if (res?.success) {
      WP.state.devMode = config.devMode;
      WP.renderTemplates();
      WP.checkServerHealth();
    }
    WP.showStatus(WP.dom.settingsStatus, res?.success ? 'Settings saved.' : 'Save failed.', !!res?.success);
  };

  // ---------------------------------------------------------------------------
  // Server health check
  // ---------------------------------------------------------------------------
  WP.checkServerHealth = async function(showResult = false) {
    const url = (WP.dom.serverUrl?.value || 'http://localhost:8000').replace(/\/$/, '');

    if (WP.dom.serverStatus) {
      WP.dom.serverStatus.className = 'server-status checking';
      WP.dom.statusLabel.textContent = '…';
    }

    try {
      const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
      const ok = resp.ok;
      if (WP.dom.serverStatus) {
        WP.dom.serverStatus.className = `server-status ${ok ? 'online' : 'offline'}`;
        WP.dom.statusLabel.textContent = ok ? 'Online' : `${resp.status}`;
      }
      if (showResult) {
        WP.showStatus(
          WP.dom.settingsStatus,
          ok ? `Server online (${url})` : `Server returned ${resp.status}`,
          ok,
        );
      }
    } catch {
      if (WP.dom.serverStatus) {
        WP.dom.serverStatus.className = 'server-status offline';
        WP.dom.statusLabel.textContent = 'Offline';
      }
      if (showResult) {
        WP.showStatus(WP.dom.settingsStatus, `Cannot reach server at ${url}`, false);
      }
    }
  };
})(window.WebPilotPopup);
