// WebPilot — Background Service Worker (Manifest V3)
// Manages recording/playback state and AI API communication.

'use strict';

// Import centralized error tracking and safe utilities
// eslint-disable-next-line no-undef
importScripts('error-handler.js');

// ---------------------------------------------------------------------------
// Open the side panel instead of a popup when the toolbar icon is clicked
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((_err) => {
    // API unavailable in older Chrome versions — gracefully ignore.
    console.warn('[WebPilot] sidePanel.setPanelBehavior not available:', _err.message);
  });

  // Context menu items — shown on every page element.
  // Two entries: one to extract text/value into a new {{variable}},
  // one to fill the element with an existing variable.
  chrome.contextMenus.removeAll((_err) => {
    if (chrome.runtime.lastError) {
      console.warn('[WebPilot] Failed to remove context menus:', chrome.runtime.lastError.message);
      return;
    }
    chrome.contextMenus.create({
      id:       'webpilot-extract',
      title:    'WebPilot: Extract as variable…',
      contexts: ['all'],
    }, (_err) => {
      if (chrome.runtime.lastError) {
        console.error('[WebPilot] Failed to create extract menu:', chrome.runtime.lastError.message);
      }
    });
    chrome.contextMenus.create({
      id:       'webpilot-fill',
      title:    'WebPilot: Fill with variable…',
      contexts: ['all'],
    }, (_err) => {
      if (chrome.runtime.lastError) {
        console.error('[WebPilot] Failed to create fill menu:', chrome.runtime.lastError.message);
      }
    });
  });
});

// Forward context-menu clicks to the content script of the active tab.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) {
    return;
  }
  const mode = info.menuItemId === 'webpilot-extract' ? 'extract' : 'fill';
  chrome.tabs.sendMessage(tab.id, {
    type: 'SHOW_EXTRACT_MODAL',
    mode,
    // selectionText is populated by Chrome when text is highlighted
    selectionText: info.selectionText ?? '',
  }).catch((err) => {
    console.warn('[WebPilot] Failed to send context menu message:', err.message);
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
    // Allow content scripts to read/write chrome.storage.session (needed for
    // extract step results to be stored by the content script and read back
    // by the background during playback).
    await chrome.storage.session.setAccessLevel({
      accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
    });
  } catch (_) { /* older Chrome — ignore */ }
  try {
    const { recordingState } = await chrome.storage.session.get('recordingState');
    if (recordingState) {
      STATE.recording      = recordingState.recording      ?? false;
      STATE.recordingTabId = recordingState.recordingTabId ?? null;
      STATE.steps          = recordingState.steps          ?? [];
    }
  } catch (_) { /* storage.session unavailable on very old Chrome — ignore */ }

  // Start periodic error reporting to backend
  try {
    const { serverConfig = {} } = await chrome.storage.local.get('serverConfig');
    const backendUrl = serverConfig.url || DEFAULT_SERVER_URL;
    // eslint-disable-next-line no-undef, no-console
    console.log('[WebPilot] Starting error reporter to:', backendUrl);
    // eslint-disable-next-line no-undef
    startErrorReporting(backendUrl, 1); // Report every 1 minute for testing
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[WebPilot] Error reporting setup failed:', err?.message || err);
  }
})();

function persistState() {
  safeStor.set({
    recordingState: {
      recording:      STATE.recording,
      recordingTabId: STATE.recordingTabId,
      steps:          STATE.steps,
    },
  }).catch((err) => {
    errorTracker.track(err, { context: 'persistState' });
  });
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
    chrome.runtime.sendMessage({ type: 'STEPS_UPDATED', steps: [] }).catch((err) => {
      errorTracker.track(err, { context: 'notifyStepsCleared' });
    });
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
  case 'REPORT_ERRORS':
    // Manual error reporting for debugging
    (async () => {
      try {
        const { serverConfig = {} } = await chrome.storage.local.get('serverConfig');
        const backendUrl = serverConfig.url || DEFAULT_SERVER_URL;
        // eslint-disable-next-line no-undef
        const result = await reportErrorsToBackend(backendUrl);
        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err?.message || err });
      }
    })();
    break;
  case 'GET_ERRORS':
    // Get all tracked errors for debugging
    // eslint-disable-next-line no-undef
    errorTracker.getErrors().then((errors) => {
      sendResponse({ success: true, errors, count: errors.length });
    }).catch(err => sendResponse({ success: false, error: err?.message || err }));
    break;
  case 'TRACK_ERROR':
    // Persist an error forwarded from a content script (which lacks storage
    // permissions). The record is already in the content-script schema.
    // eslint-disable-next-line no-undef
    if (message.errorRecord) {
      // eslint-disable-next-line no-undef
      errorTracker.persistError(message.errorRecord);
    }
    sendResponse({ success: true });
    break;
  case 'GET_SELECTOR_ALTERNATIVES':
    // Get AI-powered selector alternatives from backend
    (async () => {
      try {
        const { serverConfig = {} } = await chrome.storage.local.get('serverConfig');
        const backendUrl = serverConfig.url || DEFAULT_SERVER_URL;
        // eslint-disable-next-line no-console
        console.log('[WebPilot] Requesting selector alternatives:', message.selector);

        const response = await fetch(`${backendUrl}/api/analyze-selector`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            failingSelector: message.selector,
            elementDescription: message.description || 'Unknown',
            extractionType: message.extractType || 'text',
            pageUrl: message.pageUrl,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text}`);
        }

        const analysis = await response.json();
        // eslint-disable-next-line no-console
        console.log('[WebPilot] Got selector alternatives:', {
          recommended: analysis.recommended,
          count: analysis.alternatives.length,
        });

        sendResponse({
          success: true,
          recommended: analysis.recommended,
          alternatives: analysis.alternatives,
          confidence: analysis.confidence,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[WebPilot] Failed to get alternatives:', err?.message);
        // eslint-disable-next-line no-undef
        errorTracker.track(err, { operation: 'get-selector-alternatives' });
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();
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
  if (!STATE.recording || tabId !== STATE.recordingTabId) {
    return;
  }
  if (changeInfo.status !== 'complete') {
    return;
  }

  // Re-inject and resume recording on the freshly-loaded page
  ensureContentScript(tabId)
    .then(() => broadcastToFrames(tabId, { type: 'START_RECORDING' }))
    .catch(() => {
      // Silently ignore restricted pages (chrome://, etc.)
    });
});

// ---------------------------------------------------------------------------
// Auto-record navigate steps when switching tabs during recording
// ---------------------------------------------------------------------------
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!STATE.recording) {
    return;
  }

  // If switching to a different tab while recording, add navigate step
  if (tabId !== STATE.recordingTabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab?.url;

      // Skip restricted URLs (chrome://, about:, extension pages, etc.)
      if (!url ||
          url.startsWith('chrome') ||
          url.startsWith('about:') ||
          url.startsWith('edge:') ||
          url.startsWith('data:')) {
        return;
      }

      // Add navigate step to record the tab switch
      const label = `Navigate to ${url}`;
      STATE.steps.push({
        action: 'navigate',
        value: url,
        label,
        description: label,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        auto: true, // Mark as auto-generated
      });

      // Notify popup that steps have changed
      chrome.runtime.sendMessage({ type: 'STEPS_UPDATED', steps: STATE.steps }).catch((err) => {
        console.warn('[WebPilot] Failed to notify steps updated:', err.message);
      });

      // Update recording tab to the new tab
      STATE.recordingTabId = tabId;
      persistState();

      // Ensure content script is present and start recording on the new tab
      await ensureContentScript(tabId);
      await broadcastToFrames(tabId, { type: 'START_RECORDING' });
    } catch (err) {
      console.error('[WebPilot] Error handling tab switch during recording:', err.message);
    }
  }
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

    // If recording was stopped (not just paused), clear old steps for a fresh workflow
    if (!wasRecording && STATE.steps.length > 0) {
      STATE.steps = [];
    }

    STATE.recording = true;
    STATE.recordingTabId = tabId;

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
      chrome.runtime.sendMessage({ type: 'STEPS_UPDATED', steps: STATE.steps }).catch((err) => {
        console.warn('[WebPilot] Failed to notify steps updated:', err?.message || err);
      });
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
    // Broadcast STOP_RECORDING to ALL tabs — not just the original recording
    // tab — because other tabs may have joined the recording session via the
    // visibilitychange GET_STATE check and now show the recording overlay.
    const tabs = await chrome.tabs.query({}).catch(() => []);
    const stopPromises = (tabs || []).map((t) =>
      broadcastToFrames(t.id, { type: 'STOP_RECORDING' }).catch(() => {}),
    );
    await Promise.allSettled(stopPromises);
  } finally {
    STATE.recording = false;
    STATE.recordingTabId = null;
    persistState();
  }
  return { success: true, steps: STATE.steps };
}

function handleRecordAction(action, tabId, sendResponse) {
  // Allow recording from the active recording tab.  Also allow explicit
  // extract / fill actions from ANY tab — the user triggered these
  // intentionally via the context menu, possibly on a different tab.
  const isExplicitAction = action.action === 'extract' ||
    (action.action === 'type' && /^\{\{.+\}\}$/.test(action.value));
  const tabAllowed = tabId === STATE.recordingTabId || isExplicitAction;

  if (STATE.recording && tabAllowed) {
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
      chrome.runtime.sendMessage({ type: 'STEPS_UPDATED', steps: STATE.steps }).catch((err) => {
        console.warn('[WebPilot] Failed to notify steps updated:', err?.message || err);
      });
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
    chrome.runtime.sendMessage({ type: 'STEPS_UPDATED', steps: STATE.steps }).catch((err) => {
      console.warn('[WebPilot] Failed to notify steps updated:', err?.message || err);
    });
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
    if (!template) {
      throw new Error('Template not found');
    }

    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab.id;
    }

    // Ask the AI server to fill TEMPLATE VARIABLES (before navigation so we don't lose context)
    const variables = await fillTemplateVariables(template, userRequest);

    // Collect EXTRACTED VARIABLES from session storage
    const extractedVariables = {};
    try {
      const sessionItems = await chrome.storage.session.get(null);
      for (const [key, value] of Object.entries(sessionItems || {})) {
        if (key.startsWith('extracted_')) {
          const varName = key.replace('extracted_', '');
          extractedVariables[varName] = value;
        }
      }
    } catch (_) {}

    // Substitute both TEMPLATE and EXTRACTED variables
    const resolvedSteps = substituteVariables(template.steps, variables, extractedVariables);

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
          'Open a webpage first, then run the workflow.',
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
    if (!STATE.playback.active) {
      break;
    }

    STATE.playback.currentIndex = i;

    // Resolve any remaining placeholders from extracted values at runtime:
    // 1. TEMPLATE VARIABLES {{var}} from AI (pre-filled in handlePlayTemplate)
    // 2. EXTRACTED VARIABLES [[extracted.var]] from page/DOM extraction (resolved at each step)
    let currentStep = steps[i];
    if (currentStep.value && (/\{\{\w+\}\}/.test(currentStep.value) || /\[\[extracted\.\w+\]\]/.test(currentStep.value))) {
      try {
        const sessionItems = await chrome.storage.session.get(null);
        let resolved = currentStep.value;

        // Resolve [[extracted.varName]] from session storage (values stored by previous extract steps)
        if (/\[\[extracted\.\w+\]\]/.test(resolved)) {
          for (const [key, val] of Object.entries(sessionItems || {})) {
            if (key.startsWith('extracted_')) {
              const varName = key.replace('extracted_', '');
              const pattern = `[[extracted.${varName}]]`;
              if (resolved.includes(pattern)) {
                resolved = resolved.replaceAll(pattern, String(val ?? ''));
              }
            }
          }
        }

        if (resolved !== currentStep.value) {
          currentStep = { ...currentStep, value: resolved };
        }
      } catch (err) {
        console.error('[WebPilot] Error resolving step value placeholders:', err.message);
      }
    }

    // Broadcast progress to popup (may be closed — ignore errors)
    chrome.runtime.sendMessage({
      type: 'PLAYBACK_PROGRESS',
      currentIndex: i,
      total: steps.length,
      step: currentStep,
    }).catch((_err) => {
      // Popup may be closed; gracefully ignore
    });

    // Handle navigate actions directly in background (don't send to content script)
    // This avoids "Receiving end does not exist" error when the page unloads
    if (currentStep.action === 'navigate') {

      // Update the tab URL directly
      await chrome.tabs.update(tabId, { url: currentStep.value });

      // Wait for the new page to load completely
      await waitForTabLoad(tabId);

      // Inject content script on the new page
      await ensureContentScript(tabId);

      // Small settling delay for SPAs that render after the load event
      await delay(300);
    } else {
      // For non-navigate actions, send to content script with retries
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 1000;
      // Record the URL before the action so we can detect navigations it triggers.
      const tabBefore = await chrome.tabs.get(tabId).catch(() => null);
      const urlBeforeStep = tabBefore?.url ?? '';
      let result;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // Execution logging removed - comment out if needed for debugging

        result = await chrome.tabs.sendMessage(tabId, {
          type: 'EXECUTE_STEP',
          step: currentStep,
          index: i,
          total: steps.length,
          devMode,
          afterNavigate: attempt > 1 || (i > 0 && steps[i - 1].action === 'navigate'),
        }).catch(err => ({ error: err.message }));
        if (!result?.error) {
          break;
        }
        if (attempt < MAX_RETRIES) {
          chrome.runtime.sendMessage({
            type: 'PLAYBACK_PROGRESS',
            currentIndex: i,
            total: steps.length,
            step: currentStep,
            retryAttempt: attempt,
            retryMax: MAX_RETRIES,
          }).catch((_err) => {
            // Popup may be closed; gracefully ignore
          });
          await delay(RETRY_DELAY_MS);
        }
      }

      if (result?.error) {
        throw new Error(`Step ${i + 1} failed after ${MAX_RETRIES} attempts: ${result.error}`);
      }

      // If the step extracted a variable, persist it in session storage from the
      // background (trusted context) so later steps can resolve [[extracted.var]] reliably.
      if (result?.extracted) {
        const storageItems = {};
        for (const [varName, val] of Object.entries(result.extracted)) {
          // Only store non-empty extracted values to avoid overwriting good values with empty extractions
          const valStr = String(val).trim();
          if (valStr.length > 0) {
            storageItems[`extracted_${varName}`] = val;
          }
        }

        if (Object.keys(storageItems).length > 0) {
          try {
            await chrome.storage.session.set(storageItems);
          } catch (err) {
            console.error('[WebPilot] Failed to store extracted variables:', err);
          }
        }
      }

      // If the action may have triggered a navigation (e.g. clicking a link or
      // submit button, or pressing Enter), wait for the page to settle before
      // advancing — otherwise the next step runs against a half-loaded page.
      if (currentStep.action === 'click' || currentStep.action === 'key') {
        const navigated = await waitForPossibleNavigation(tabId, urlBeforeStep);
        if (navigated) {
          await ensureContentScript(tabId);
          await delay(300);
        }
      }

      // Per-step delay (default 600 ms if not set)
      await delay(currentStep.delayMs ?? 600);
    }
  }
}

// ---------------------------------------------------------------------------
// AI variable resolution
// ---------------------------------------------------------------------------
async function fillTemplateVariables(template, userRequest) {
  // Extract TEMPLATE VARIABLES: {{varName}} placeholders from all step values
  // These are for AI generation only.
  const templateVariableNames = new Set();
  const templateVarRe = /\{\{(\w+)\}\}/g;
  for (const step of template.steps) {
    if (step.value) {
      for (const [, name] of step.value.matchAll(templateVarRe)) {
        templateVariableNames.add(name);
      }
    }
  }

  if (templateVariableNames.size === 0) {
    return {};
  }

  // ---------------------------------------------------------------------------
  // Check for variables already extracted during a previous recording/playback
  // session (stored in chrome.storage.session by the content script).
  // Also collect variables that will be produced by extract steps in THIS
  // template — those don't need AI filling since they'll be resolved at runtime.
  // ---------------------------------------------------------------------------
  const extractedFromStorage = {};
  try {
    const sessionItems = await chrome.storage.session.get(null);
    for (const [key, value] of Object.entries(sessionItems || {})) {
      if (key.startsWith('extracted_')) {
        const varName = key.replace('extracted_', '');
        if (templateVariableNames.has(varName)) {
          extractedFromStorage[varName] = value;
        }
      }
    }
  } catch (_) {}

  // Variables produced by extract steps in this template — they will be
  // resolved at runtime, so we should NOT ask the AI for them.
  const extractStepVars = new Set();
  for (const step of template.steps) {
    if (step.action === 'extract' && step.variable) {
      extractStepVars.add(step.variable);
    }
  }

  // Determine which TEMPLATE VARIABLES still need AI resolution
  const needsAI = Array.from(templateVariableNames).filter(
    (v) => !(v in extractedFromStorage) && !extractStepVars.has(v),
  );

  let aiVariables = {};
  if (needsAI.length > 0) {
    const { serverConfig = {} } = await chrome.storage.local.get('serverConfig');
    const serverUrl = serverConfig.url ?? DEFAULT_SERVER_URL;

    const response = await fetch(`${serverUrl}/api/fill-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRequest,
        variables: needsAI,
        templateName: template.name,
        templateDescription: template.description ?? '',
        backend: serverConfig.backend ?? 'groq',
        apiKey: serverConfig.apiKey ?? '',
        model: serverConfig.model ?? '',
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail ?? `Server error ${response.status}`);
    }

    const data = await response.json();
    aiVariables = data.variables ?? {};
  }

  // Merge: extracted values take precedence over AI-generated ones.
  // Extract-step vars are left as {{var}} — they'll be resolved at runtime.
  return { ...aiVariables, ...extractedFromStorage };
}

/**
 * Substitute both {{variable}} (template/AI) and [[extracted.variable]] (DOM/page extraction)
 * placeholders with their resolved values.
 *
 * TEMPLATE VARIABLES {{varName}}: AI-generated values
 * EXTRACTED VARIABLES [[extracted.varName]]: Values from page/DOM extraction
 */
function substituteVariables(steps, variables, extractedVariables = {}) {
  return steps.map((step) => {
    if (!step.value) {
      return step;
    }
    let value = step.value;

    // Replace TEMPLATE VARIABLES {{varName}} with AI-generated values
    for (const [key, val] of Object.entries(variables)) {
      if (val !== null && val !== undefined) {
        value = value.replaceAll(`{{${key}}}`, String(val));
      }
    }

    // Replace EXTRACTED VARIABLES [[extracted.varName]] with page/DOM values
    for (const [key, val] of Object.entries(extractedVariables)) {
      if (val !== null && val !== undefined) {
        value = value.replaceAll(`[[extracted.${key}]]`, String(val));
      }
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
      chrome.tabs.sendMessage(tabId, message, { frameId }).catch(() => {}),
    ),
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
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message)); return;
      }
      if (tab.status === 'complete') {
        resolve(); return;
      }

      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(); // soft-resolve on timeout so playback can continue
      }, timeoutMs);

      function listener(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId) {
          return;
        }
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
 * After an action step (click/key), detect whether it triggered a navigation
 * and, if so, wait for the new page to finish loading.
 *
 * Detection: poll the tab briefly. If within ~1.2 s the tab enters the
 * 'loading' state or its URL changes, treat it as a navigation and wait for
 * status 'complete'. Returns true if a navigation was awaited, false otherwise.
 */
async function waitForPossibleNavigation(tabId, urlBefore, detectMs = 1200) {
  const start = Date.now();
  while (Date.now() - start < detectMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      return false;
    }
    if (tab.status === 'loading' || (tab.url && tab.url !== urlBefore)) {
      await waitForTabLoad(tabId);
      await delay(300); // settling delay for SPAs that render after load
      return true;
    }
    await delay(150);
  }
  return false;
}

/**
 * Ensure content.js is running in the given tab.
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
  if (!tab) {
    throw new Error('Tab not found');
  }

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

  if (alive) {
    return;
  } // content script already running

  // Inject the content script programmatically
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['content.js'],
  });

  // Give the script ~200 ms to initialise
  await delay(200);
}
