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
// Session-storage persistence
// chrome.storage.session survives service-worker restarts within the same
// browser session, so recording state (steps, tabId, flag) is not lost when
// Chrome suspends the SW mid-recording.
// ---------------------------------------------------------------------------
(async () => {
  try {
    const { recordingState } = await chrome.storage.session.get('recordingState');
    if (recordingState) {
      STATE.recording      = recordingState.recording      ?? false;
      STATE.recordingTabId = recordingState.recordingTabId ?? null;
      STATE.steps          = recordingState.steps          ?? [];
    }
  } catch (_) { /* storage.session unavailable on very old Chrome — ignore */ }
})();

function persistState() {
  chrome.storage.session.set({
    recordingState: {
      recording:      STATE.recording,
      recordingTabId: STATE.recordingTabId,
      steps:          STATE.steps,
    },
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Message dispatcher
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? null;

  switch (message.type) {
    case 'START_RECORDING':
      handleStartRecording(message.tabId, { noAutoNavigate: message.noAutoNavigate ?? false })
        .then(sendResponse).catch(err => sendResponse({ error: err.message }));
      break;
    case 'STOP_RECORDING':
      handleStopRecording().then(sendResponse).catch(err => sendResponse({ error: err.message }));
      break;
    case 'CLEAR_STEPS':
      STATE.steps = [];
      persistState();
      chrome.runtime.sendMessage({ type: 'STEPS_UPDATED', steps: [] }).catch(() => {});
      sendResponse({ success: true });
      break;
    case 'UPDATE_STEPS':
      STATE.steps = message.steps ?? STATE.steps;
      persistState();
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
    .then(() => broadcastToFrames(tabId, { type: 'START_RECORDING' }))
    .catch(() => {
      // Silently ignore restricted pages (chrome://, etc.)
    });
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
async function handleStartRecording(tabId, { noAutoNavigate = false } = {}) {
  try {
    let tab;
    if (!tabId) {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab.id;
    } else {
      tab = await chrome.tabs.get(tabId);
    }

    // Ensure content script is alive — inject it if this is a freshly-opened
    // tab or a page that predates the extension install.
    await ensureContentScript(tabId);

    const wasRecording = STATE.recording;
    STATE.recording = true;
    STATE.recordingTabId = tabId;
    // Do NOT clear steps here — user may be adding more steps to an existing session

    // Only add navigate step if this is the very first start of a new session
    // (not after clear, not after stop/start, not after resume)
    // noAutoNavigate suppresses this when called from the workflow editor.
    if (
      !noAutoNavigate &&
      STATE.steps.length === 0 &&
      tab?.url &&
      !tab.url.startsWith('chrome') &&
      !wasRecording // only on real start, not resume
    ) {
      const url = tab.url;
      const label = `Navigate to ${url}`;
      STATE.steps.push({
        action: 'navigate',
        value: url,
        label,
        description: label,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        auto: true,
      });
      chrome.runtime.sendMessage({ type: 'STEPS_UPDATED', steps: STATE.steps }).catch(() => {});
    }

    persistState();
    await broadcastToFrames(tabId, { type: 'START_RECORDING' });
    return { success: true, tabId };
  } catch (err) {
    STATE.recording = false;
    persistState();
    return { error: err.message };
  }
}

async function handleStopRecording() {
  try {
    if (STATE.recordingTabId) {
      await broadcastToFrames(STATE.recordingTabId, { type: 'STOP_RECORDING' }).catch(() => {});
    }
  } finally {
    STATE.recording = false;
    STATE.recordingTabId = null;
    persistState();
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
      persistState();
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
    persistState();
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

    // Ask the AI server to fill template variables (before navigation so we don't
    // lose the current context)
    const variables = await fillTemplateVariables(template, userRequest);
    const resolvedSteps = substituteVariables(template.steps, variables);

    // If the current tab is a restricted page (edge://, chrome://, about:, …),
    // we can't inject a content script into it.  However, if the first step is a
    // navigate action we can just redirect the tab to that URL right now and let
    // the normal post-navigate logic take over.
    const currentTab = await chrome.tabs.get(tabId).catch(() => null);
    const currentUrl = currentTab?.url ?? '';
    const isRestricted =
      currentUrl.startsWith('chrome://') ||
      currentUrl.startsWith('chrome-extension://') ||
      currentUrl.startsWith('edge://') ||
      currentUrl.startsWith('about:') ||
      currentUrl.startsWith('data:');

    let startIndex = 0;

    if (isRestricted) {
      const firstNav = resolvedSteps.findIndex(s => s.action === 'navigate');
      if (firstNav === -1) {
        throw new Error(
          `WebPilot cannot run on this page (${currentUrl.split('://')[0]}:// pages are restricted). ` +
          `Open a webpage first, then run the workflow.`
        );
      }
      // Navigate the current tab to the target URL directly
      await chrome.tabs.update(tabId, { url: resolvedSteps[firstNav].value });
      await waitForTabLoad(tabId);
      await ensureContentScript(tabId);
      await delay(300);
      startIndex = firstNav + 1; // first navigate step already done
    } else {
      // Ensure content script is present before playback starts
      await ensureContentScript(tabId);
    }

    STATE.playback = { active: true, tabId, currentIndex: startIndex };

    const { serverConfig = {} } = await chrome.storage.local.get('serverConfig');
    await executeSteps(tabId, resolvedSteps, !!serverConfig.devMode, startIndex);

    STATE.playback.active = false;
    return { success: true, variables };
  } catch (err) {
    STATE.playback.active = false;
    return { error: err.message };
  }
}

async function executeSteps(tabId, steps, devMode = false, startIndex = 0) {
  for (let i = startIndex; i < steps.length; i++) {
    if (!STATE.playback.active) break;

    STATE.playback.currentIndex = i;

    // Broadcast progress to popup (may be closed — ignore errors)
    chrome.runtime.sendMessage({
      type: 'PLAYBACK_PROGRESS',
      currentIndex: i,
      total: steps.length,
      step: steps[i],
    }).catch(() => {});

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;
    let result;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      result = await chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_STEP',
        step: steps[i],
        index: i,
        total: steps.length,
        devMode,
        afterNavigate: attempt > 1 || (i > 0 && steps[i - 1].action === 'navigate'),
      });
      if (!result?.error) break;
      if (attempt < MAX_RETRIES) {
        chrome.runtime.sendMessage({
          type: 'PLAYBACK_PROGRESS',
          currentIndex: i,
          total: steps.length,
          step: steps[i],
          retryAttempt: attempt,
          retryMax: MAX_RETRIES,
        }).catch(() => {});
        await delay(RETRY_DELAY_MS);
      }
    }

    if (result?.error) {
      throw new Error(`Step ${i + 1} failed after ${MAX_RETRIES} attempts: ${result.error}`);
    }

    // After a navigate step the page unloads — wait for it to fully reload
    // then re-inject the content script before executing further steps.
    if (steps[i].action === 'navigate') {
      await waitForTabLoad(tabId);
      await ensureContentScript(tabId);
      // Small settling delay for SPAs that render after the load event
      await delay(300);
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
      backend: serverConfig.backend ?? 'groq',
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
 * Broadcast a message to every frame in a tab (top + all iframes).
 * Errors from individual frames (e.g. sandboxed iframes) are silently ignored.
 */
async function broadcastToFrames(tabId, message) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  await Promise.allSettled(
    (frames ?? []).map(({ frameId }) =>
      chrome.tabs.sendMessage(tabId, message, { frameId }).catch(() => {})
    )
  );
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
    target: { tabId, allFrames: true },
    files: ['content.js'],
  });

  // Give the script ~200 ms to initialise
  await delay(200);
}
