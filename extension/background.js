// WebPilot — Background Service Worker (Manifest V3)
// Manages recording/playback state and AI API communication.

'use strict';

// ---------------------------------------------------------------------------
// Open the side panel instead of a popup when the toolbar icon is clicked
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // API unavailable in older Chrome versions — gracefully ignore.
  });
});

/** @type {{ recording: boolean, recordingTabId: number|null, steps: object[] }} */
const STATE = {
  recording: false,
  recordingTabId: null,
  steps: [],
  playback: {
    active: false,
    tabId: null,
    currentIndex: 0,
  },
};

const DEFAULT_SERVER_URL = 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Message dispatcher
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? null;

  switch (message.type) {
    case 'START_RECORDING':
      handleStartRecording(message.tabId).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      break;
    case 'STOP_RECORDING':
      handleStopRecording().then(sendResponse).catch(err => sendResponse({ error: err.message }));
      break;
    case 'CLEAR_STEPS':
      STATE.steps = [];
      chrome.runtime.sendMessage({ type: 'STEPS_UPDATED', steps: [] }).catch(() => {});
      sendResponse({ success: true });
      break;
    case 'UPDATE_STEPS':
      STATE.steps = message.steps ?? STATE.steps;
      sendResponse({ success: true });
      break;
    case 'RECORD_ACTION':
      handleRecordAction(message.action, tabId, sendResponse);
      break;
    case 'GET_STATE':
      sendResponse({ state: STATE });
      break;
    case 'SAVE_TEMPLATE':
      handleSaveTemplate(message.template).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      break;
    case 'GET_TEMPLATES':
      handleGetTemplates().then(sendResponse).catch(err => sendResponse({ error: err.message }));
      break;
    case 'DELETE_TEMPLATE':
      handleDeleteTemplate(message.id).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      break;
    case 'PLAY_TEMPLATE':
      handlePlayTemplate(message.templateId, message.userRequest, message.tabId)
        .then(sendResponse).catch(err => sendResponse({ error: err.message }));
      break;
    case 'STOP_PLAYBACK':
      STATE.playback.active = false;
      sendResponse({ success: true });
      break;
    case 'GET_SERVER_CONFIG':
      chrome.storage.local.get('serverConfig')
        .then(({ serverConfig = {} }) => sendResponse({ success: true, config: serverConfig }))
        .catch(err => sendResponse({ error: err.message }));
      break;
    case 'SET_SERVER_CONFIG':
      chrome.storage.local.set({ serverConfig: message.config })
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ error: err.message }));
      break;
    default:
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }

  return true; // keep message channel open for async sendResponse
});

// ---------------------------------------------------------------------------
// Re-inject content script after page navigation while recording is active
// ---------------------------------------------------------------------------
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Only care about the recording tab reaching a fully loaded state
  if (!STATE.recording || tabId !== STATE.recordingTabId) return;
  if (changeInfo.status !== 'complete') return;

  // Re-inject and resume recording on the freshly-loaded page
  ensureContentScript(tabId)
    .then(() => chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' }))
    .catch(() => {
      // Silently ignore restricted pages (chrome://, etc.)
    });
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
async function handleStartRecording(tabId) {
  try {
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab.id;
    }

    // Ensure content script is alive — inject it if this is a freshly-opened
    // tab or a page that predates the extension install.
    await ensureContentScript(tabId);

    STATE.recording = true;
    STATE.recordingTabId = tabId;
    // Do NOT clear steps here — user may be adding more steps to an existing session

    await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
    return { success: true, tabId };
  } catch (err) {
    STATE.recording = false;
    return { error: err.message };
  }
}

async function handleStopRecording() {
  try {
    if (STATE.recordingTabId) {
      await chrome.tabs.sendMessage(STATE.recordingTabId, { type: 'STOP_RECORDING' }).catch(() => {});
    }
  } finally {
    STATE.recording = false;
    STATE.recordingTabId = null;
  }
  return { success: true, steps: STATE.steps };
}

function handleRecordAction(action, tabId, sendResponse) {
  if (STATE.recording && tabId === STATE.recordingTabId) {
    const last = STATE.steps[STATE.steps.length - 1];
    const now = Date.now();

    // For type actions on the same element, replace the last step instead of
    // appending — this way only the final typed value is recorded, not every
    // debounce snapshot.
    if (
      action.action === 'type' &&
      last &&
      last.action === 'type' &&
      last.selector === action.selector
    ) {
      STATE.steps[STATE.steps.length - 1] = {
        ...last,
        ...action,
        id: last.id,          // keep stable ID
        timestamp: now,
      };
      chrome.runtime.sendMessage({ type: 'STEPS_UPDATED', steps: STATE.steps }).catch(() => {});
      sendResponse({ success: true });
      return;
    }

    // Generic deduplication: skip exact duplicate within 1 s
    if (
      last &&
      last.action   === action.action &&
      last.selector === action.selector &&
      last.value    === action.value &&
      now - last.timestamp < 1000
    ) {
      sendResponse({ success: true, deduplicated: true });
      return;
    }

    STATE.steps.push({
      ...action,
      id: crypto.randomUUID(),
      timestamp: now,
    });
    chrome.runtime.sendMessage({ type: 'STEPS_UPDATED', steps: STATE.steps }).catch(() => {});
  }
  sendResponse({ success: true });
}

// ---------------------------------------------------------------------------
// Template storage
// ---------------------------------------------------------------------------
async function handleSaveTemplate(template) {
  try {
    const { templates = {} } = await chrome.storage.local.get('templates');
    const id = template.id ?? crypto.randomUUID();
    templates[id] = { ...template, id, updatedAt: Date.now() };
    await chrome.storage.local.set({ templates });
    return { success: true, id };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleGetTemplates() {
  try {
    const { templates = {} } = await chrome.storage.local.get('templates');
    return { success: true, templates };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleDeleteTemplate(id) {
  try {
    const { templates = {} } = await chrome.storage.local.get('templates');
    delete templates[id];
    await chrome.storage.local.set({ templates });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
async function handlePlayTemplate(templateId, userRequest, tabId) {
  try {
    const { templates = {} } = await chrome.storage.local.get('templates');
    const template = templates[templateId];
    if (!template) throw new Error('Template not found');

    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab.id;
    }

    // Ensure content script is present before playback starts
    await ensureContentScript(tabId);

    // Ask the AI server to fill template variables
    const variables = await fillTemplateVariables(template, userRequest);

    // Substitute {{variable}} placeholders in step values
    const resolvedSteps = substituteVariables(template.steps, variables);

    STATE.playback = { active: true, tabId, currentIndex: 0 };

    const { serverConfig = {} } = await chrome.storage.local.get('serverConfig');
    await executeSteps(tabId, resolvedSteps, !!serverConfig.devMode);

    STATE.playback.active = false;
    return { success: true, variables };
  } catch (err) {
    STATE.playback.active = false;
    return { error: err.message };
  }
}

async function executeSteps(tabId, steps, devMode = false) {
  for (let i = 0; i < steps.length; i++) {
    if (!STATE.playback.active) break;

    STATE.playback.currentIndex = i;

    // Broadcast progress to popup (may be closed — ignore errors)
    chrome.runtime.sendMessage({
      type: 'PLAYBACK_PROGRESS',
      currentIndex: i,
      total: steps.length,
      step: steps[i],
    }).catch(() => {});

    const result = await chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_STEP',
      step: steps[i],
      index: i,
      total: steps.length,
      devMode,
    });

    if (result?.error) {
      throw new Error(`Step ${i + 1} failed: ${result.error}`);
    }

    // After a navigate step the page unloads — wait for it to fully reload
    // then re-inject the content script before executing further steps.
    if (steps[i].action === 'navigate') {
      await waitForTabLoad(tabId);
      await ensureContentScript(tabId);
    } else {
      // Per-step delay (default 600 ms if not set)
      await delay(steps[i].delayMs ?? 600);
    }
  }
}

// ---------------------------------------------------------------------------
// AI variable resolution
// ---------------------------------------------------------------------------
async function fillTemplateVariables(template, userRequest) {
  // Extract {{varName}} placeholders from all step values
  const variableNames = new Set();
  const varRe = /\{\{(\w+)\}\}/g;
  for (const step of template.steps) {
    if (step.value) {
      for (const [, name] of step.value.matchAll(varRe)) {
        variableNames.add(name);
      }
    }
  }

  if (variableNames.size === 0) return {};

  const { serverConfig = {} } = await chrome.storage.local.get('serverConfig');
  const serverUrl = serverConfig.url ?? DEFAULT_SERVER_URL;

  const response = await fetch(`${serverUrl}/api/fill-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userRequest,
      variables: Array.from(variableNames),
      templateName: template.name,
      templateDescription: template.description ?? '',
      backend: serverConfig.backend ?? 'openai',
      // API key is sent only when the user has opted to pass it from the extension.
      // For production deployments, configure keys server-side via environment variables
      // and omit apiKey here.
      apiKey: serverConfig.apiKey ?? '',
      model: serverConfig.model ?? '',
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `Server error ${response.status}`);
  }

  const data = await response.json();
  return data.variables ?? {};
}

function substituteVariables(steps, variables) {
  return steps.map((step) => {
    if (!step.value) return step;
    let value = step.value;
    for (const [key, val] of Object.entries(variables)) {
      value = value.replaceAll(`{{${key}}}`, val);
    }
    return { ...step, value };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the given tab fires status==='complete', with a 15 s safety timeout.
 * Resolves early if the tab is already complete.
 */
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    // Check immediately in case the tab already finished loading
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (tab.status === 'complete') { resolve(); return; }

      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(); // soft-resolve on timeout so playback can continue
      }, timeoutMs);

      function listener(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId) return;
        if (changeInfo.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

/**
 * Ensure content.js is running in the given tab.
 *
 * Strategy:
 *  1. Ping the tab — if it responds, the content script is already alive.
 *  2. If ping times out or the port is closed, inject content.js via
 *     chrome.scripting.executeScript (requires "scripting" permission).
 *  3. Wait briefly for the injected script to initialise, then ping again.
 *
 * The content script guards against double-injection with window.__webpilotLoaded.
 */
async function ensureContentScript(tabId) {
  // First check the tab URL — scripting is blocked on chrome:// and edge:// pages
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error('Tab not found');

  const url = tab.url ?? '';
  if (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('data:')
  ) {
    throw new Error(`WebPilot cannot run on this page (${url.split('://')[0]}:// pages are restricted).`);
  }

  // Ping with a 600 ms timeout
  const alive = await Promise.race([
    chrome.tabs.sendMessage(tabId, { type: 'GET_RECORDING_STATE' })
      .then(() => true)
      .catch(() => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 600)),
  ]);

  if (alive) return; // content script already running

  // Inject the content script programmatically
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });

  // Give the script ~200 ms to initialise
  await delay(200);
}
