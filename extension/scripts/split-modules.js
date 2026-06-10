#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '..');

const CONTENT_SPLITS = [
  { file: 'content/guard.js', start: 0, end: 0, custom: 'guard' },
  { file: 'content/context.js', start: 31, end: 92 },
  { file: 'content/variables.js', start: 117, end: 470 },
  { file: 'content/messages.js', start: 476, end: 542 },
  { file: 'content/recording.js', start: 547, end: 571 },
  { file: 'content/overlay.js', start: 576, end: 832 },
  { file: 'content/recording-events.js', start: 834, end: 1412 },
  { file: 'content/selectors.js', start: 1414, end: 1842 },
  { file: 'content/playback.js', start: 1844, end: 2396 },
  { file: 'content/bootstrap.js', start: 94, end: 115 },
];

const CONTENT_STATE_VARS = [
  'extractedValuesInitialized',
  'lastRightClickedEl',
  'isRecording',
  'overlayRoot',
  'hoveredEl',
  'inputTimers',
  'extractedValues',
  'handlers',
];

const CONTENT_FUNCTIONS = [
  'handleContextInvalidated', 'safeSend', 'safeStorageSet', 'safeStorageGet', 'recordAction',
  'waitForExtractedValues', 'storeExtractedValue', 'getExtractedValue', 'getAvailableVariablesForFilling',
  'extractFromElement', 'getSelectorAlternatives', 'resolveElementWithRetry', 'extractFromElementWithRetry',
  'startRecording', 'stopRecording', 'mountOverlay', 'unmountOverlay', 'injectStyles',
  'setHoverHighlight', 'clearHighlight', 'flashRecorded', 'attachListeners', 'detachListeners',
  'isWebPilotEl', 'isTypeable', 'onMouseOver', 'onMouseOut', 'onCapturingClick', 'sendInputAction',
  'resolveAndApplyExtractedVariables', 'elementHint', 'labelToVarName', 'onInput', 'onChange',
  'onRecordingContextMenu', 'showExtractModal', 'isDateField', 'isComboBoxInput', 'getCalendarContainer',
  'findDateInputNear', 'sendDateAction', 'findStableFieldAncestor', 'buildSelector', 'getLabel',
  'generateVariableName', '_findNearbyLabel', 'labelFromSelector', 'showStepHighlight', 'showDevHighlight',
  'executeStep', 'showProgress', 'selectComboOption', 'waitForElement', 'delay',
];

const POPUP_SPLITS = [
  { file: 'popup/core.js', start: 1, end: 74 },
  { file: 'popup/utils.js', start: 1481, end: 1553 },
  { file: 'popup/tabs.js', start: 150, end: 156 },
  { file: 'popup/settings.js', start: 158, end: 231 },
  { file: 'popup/templates.js', start: 233, end: 845 },
  { file: 'popup/playback.js', start: 847, end: 1058 },
  { file: 'popup/recording.js', start: 1080, end: 1131 },
  { file: 'popup/steps.js', start: 1133, end: 1436 },
  { file: 'popup/messages.js', start: 1438, end: 1476 },
  { file: 'popup/init.js', start: 76, end: 148, custom: 'init-start' },
  { file: 'popup/init.js', start: 1555, end: 1558, custom: 'init-end', append: true },
];

const POPUP_FUNCTIONS = [
  'resolveDOM', 'bindStaticEvents', 'switchTab', 'loadSettings', 'refreshApiKeyVisibility',
  'saveSettings', 'checkServerHealth', 'loadTemplates', 'renderTemplates', 'buildTemplateItem',
  'openJsonModal', 'toggleTemplateEditor', 'openTemplateEditor', 'buildEditorStep', 'saveEditedTemplate',
  'openPlayPanel', 'closePlayPanel', 'previewVariables', 'importTemplateFromFile', 'showRunReport',
  'executeTemplate', 'stopPlayback', 'deleteTemplate', 'confirmDeleteTemplate', 'syncRecordingState',
  'toggleRecording', 'startRecording', 'stopRecording', 'applyRecordingUI', 'renderSteps',
  'buildStepItem', 'editStep', 'saveTemplate', 'onBackgroundMessage', 'sendMsg', 'sendMsgSafe',
  'esc', 'shortSelector', 'setStatus', 'showStatus',
];

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split('\n');
}

function extractLines(lines, start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function transformContentBody(body) {
  let out = body;
  for (const v of CONTENT_STATE_VARS) {
    out = out.replace(new RegExp(`\\b${v}\\b`, 'g'), `WP.state.${v}`);
  }
  out = out.replace(/\bextractedValuesReady\b/g, 'WP.state.extractedValuesReady');
  out = out.replace(/let extractedValuesReady = new Promise\(\(resolve\) => \{[\s\S]*?\}\);/g, '');
  out = out.replace(/let isRecording = false;[\s\S]*?const handlers = \{\};/g, '');
  out = out.replace(/let lastRightClickedEl = null;[\s\S]*?true\); \/\/ capture phase[\s\S]*?\n/g, '');

  for (const fn of [...CONTENT_FUNCTIONS].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`async function ${fn}\\s*\\(`, 'g'), `WP.${fn} = async function(`);
    out = out.replace(new RegExp(`function ${fn}\\s*\\(`, 'g'), `WP.${fn} = function(`);
  }
  for (const fn of CONTENT_FUNCTIONS) {
    out = out.replace(new RegExp(`(?<!WP\\.)\\b${fn}\\s*\\(`, 'g'), `WP.${fn}(`);
  }
  return out;
}

function wrapContentModule(body, label) {
  if (!body.trim()) {
    return '';
  }
  return `// WebPilot content — ${label}\n(function (WP) {\n  'use strict';\n  if (window.__webpilotSkipModules) {\n    return;\n  }\n${body.split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}\n})(window.WebPilotContent);\n`;
}

function guardContent() {
  return `// WebPilot content — injection guard and shared namespace
(function (global) {
  'use strict';
  if (global.__webpilotContentLoaded) {
    global.__webpilotSkipModules = true;
    return;
  }
  global.__webpilotContentLoaded = true;
  if (global.__webpilotLoaded) {
    global.__webpilotSkipModules = true;
    return;
  }
  global.__webpilotLoaded = true;

  global.WebPilotContent = { state: {}, fn: {} };
  const WP = global.WebPilotContent;
  WP.state = {
    isRecording: false,
    overlayRoot: null,
    hoveredEl: null,
    inputTimers: new Map(),
    extractedValues: new Map(),
    extractedValuesInitialized: false,
    lastRightClickedEl: null,
    handlers: {},
  };
  WP.state.extractedValuesReady = new Promise((resolve) => {
    global.__webpilotResolveExtractedValues = resolve;
  });
})(window);
`;
}

function transformPopupBody(body) {
  let out = body;
  out = out.replace(/^const state = \{[\s\S]*?\};\n\n/m, '');
  out = out.replace(/^let dom = \{\};\n\n/m, '');
  out = out.replace(/document\.addEventListener\('DOMContentLoaded'[\s\S]*?checkServerHealth\(\);\n\}\);/m, '');

  for (const fn of [...POPUP_FUNCTIONS].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`async function ${fn}\\s*\\(`, 'g'), `WP.${fn} = async function(`);
    out = out.replace(new RegExp(`function ${fn}\\s*\\(`, 'g'), `WP.${fn} = function(`);
  }

  const refs = [
    ['\\bstate\\.', 'WP.state.'],
    ['\\bdom\\.', 'WP.dom.'],
  ];
  for (const [pat, rep] of refs) {
    out = out.replace(new RegExp(pat, 'g'), rep);
  }
  for (const fn of POPUP_FUNCTIONS) {
    out = out.replace(new RegExp(`(?<!WP\\.)\\b${fn}\\s*\\(`, 'g'), `WP.${fn}(`);
  }
  return out;
}

function wrapPopupModule(body, label) {
  if (!body.trim()) {
    return '';
  }
  return `// WebPilot popup — ${label}\n(function (WP) {\n  'use strict';\n${body.split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}\n})(window.WebPilotPopup);\n`;
}

function popupCore() {
  return `// WebPilot popup — state and DOM
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
})(window.WebPilotPopup);
`;
}

function popupInitStart() {
  return `// WebPilot popup — bootstrap
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
`;
}

function popupInitEnd() {
  return `// WebPilot popup — sidepanel exports
(function (WP) {
  'use strict';
  window.__webpilotState = WP.state;
  window.__webpilotExecuteTemplate = WP.executeTemplate;
})(window.WebPilotPopup);
`;
}

function splitContent() {
  const lines = readLines(path.join(EXT, 'content.js'));
  fs.mkdirSync(path.join(EXT, 'content'), { recursive: true });
  fs.writeFileSync(path.join(EXT, 'content/guard.js'), guardContent());

  for (const split of CONTENT_SPLITS) {
    if (split.custom === 'guard') {
      continue;
    }
    const body = transformContentBody(extractLines(lines, split.start, split.end));
    const wrapped = wrapContentModule(body, path.basename(split.file, '.js'));
    fs.writeFileSync(path.join(EXT, split.file), wrapped);
  }
}

function splitPopup() {
  const lines = readLines(path.join(EXT, 'popup.js'));
  fs.mkdirSync(path.join(EXT, 'popup'), { recursive: true });
  fs.writeFileSync(path.join(EXT, 'popup/core.js'), popupCore());
  fs.writeFileSync(path.join(EXT, 'popup/init-bootstrap.js'), popupInitStart());
  fs.writeFileSync(path.join(EXT, 'popup/init-exports.js'), popupInitEnd());

  const written = new Set(['popup/core.js', 'popup/init-bootstrap.js', 'popup/init-exports.js']);
  for (const split of POPUP_SPLITS) {
    if (split.custom) {
      continue;
    }
    const outPath = path.join(EXT, split.file);
    const body = transformPopupBody(extractLines(lines, split.start, split.end));
    const wrapped = wrapPopupModule(body, path.basename(split.file, '.js'));
    if (split.append && fs.existsSync(outPath)) {
      fs.appendFileSync(outPath, `\n${wrapped}`);
    } else {
      fs.writeFileSync(outPath, wrapped);
      written.add(split.file);
    }
  }

  // resolveDOM stays in core - extract from original lines 20-74 manually via core append
  const resolveDomBody = transformPopupBody(extractLines(lines, 20, 74));
  fs.appendFileSync(path.join(EXT, 'popup/core.js'), wrapPopupModule(resolveDomBody, 'resolveDOM').replace(/^\/\/ WebPilot popup — resolveDOM\n/, ''));
}

splitContent();
splitPopup();
console.log('Split complete.');
