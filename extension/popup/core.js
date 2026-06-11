// WebPilot popup — state and DOM
window.WebPilotPopup = window.WebPilotPopup || {};
(function (WP) {
  'use strict';
  WP.state = {
    recording: false,
    steps: [],
    templates: {},
    selectedTemplateId: null,
    devMode: false,
  };
  WP.dom = {};

  WP.resolveDOM = function () {
    WP.dom = {
      tabBtns: document.querySelectorAll('.tab-btn'),
      tabPanels: document.querySelectorAll('.tab-content'),
      btnRecord: document.getElementById('btn-record'),
      recordLabel: document.getElementById('record-label'),
      recordingStatus: document.getElementById('recording-status'),
      stepsContainer: document.getElementById('steps-container'),
      stepsCount: document.getElementById('steps-count'),
      stepsList: document.getElementById('steps-list'),
      btnClear: document.getElementById('btn-clear-steps'),
      templateName: document.getElementById('template-name'),
      btnSave: document.getElementById('btn-save-template'),
      templateStartUrl: document.getElementById('template-start-url'),
      templateRequiresAuth: document.getElementById('template-requires-auth'),
      emptyRecord: document.getElementById('empty-record'),
      recordError: document.getElementById('record-error'),
      playPanel: document.getElementById('play-panel'),
      playName: document.getElementById('play-template-name'),
      btnCancelPlay: document.getElementById('btn-cancel-play'),
      userRequest: document.getElementById('user-request'),
      btnExecute: document.getElementById('btn-execute'),
      btnPreviewVars: document.getElementById('btn-preview-vars'),
      btnStop: document.getElementById('btn-stop'),
      executeLabel: document.getElementById('execute-label'),
      playStatus: document.getElementById('play-status'),
      playRunReport: document.getElementById('play-run-report'),
      templatesList: document.getElementById('templates-list'),
      btnImportTemplate: document.getElementById('btn-import-template'),
      importTemplateFile: document.getElementById('import-template-file'),
      emptyTemplates: document.getElementById('empty-templates'),
      serverUrl: document.getElementById('server-url'),
      backendSelect: document.getElementById('backend-select'),
      apiKeyGroup: document.getElementById('api-key-group'),
      apiKey: document.getElementById('api-key'),
      toggleKey: document.getElementById('toggle-key'),
      modelName: document.getElementById('model-name'),
      btnSaveSettings: document.getElementById('btn-save-settings'),
      btnCheckServer: document.getElementById('btn-check-server'),
      settingsStatus: document.getElementById('settings-status'),
      devMode: document.getElementById('dev-mode'),
      aiSelectorRecovery: document.getElementById('ai-selector-recovery'),
      serverStatus: document.getElementById('server-status'),
      statusDot: document.querySelector('#server-status .status-dot'),
      statusLabel: document.querySelector('#server-status .status-label'),
    };
  };
})(window.WebPilotPopup);
