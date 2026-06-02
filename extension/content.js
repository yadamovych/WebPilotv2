// WebPilot — Content Script
// Runs in the context of every web page.
// Responsibilities:
//   • Capture user actions during recording (click / type / select / navigate)
//   • Show a recording overlay with step highlights
//   • Execute playback steps injected by the background service worker

(function () {
  'use strict';

  // Guard against double-injection (manifest + programmatic ensureContentScript both active).
  if (window.__webpilotContentLoaded) return;
  window.__webpilotContentLoaded = true;


  // Guard against double-injection on dynamic page navigations
  if (window.__webpilotLoaded) return;
  window.__webpilotLoaded = true;

  // If recording was already active when this frame loaded (e.g. a TinyMCE
  // iframe that opened after broadcastToFrames was already called), join the
  // session immediately so input events are captured.
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (chrome.runtime.lastError) return; // background not ready yet
    if (res?.state?.recording) startRecording();
  });

  // Resume recording when tab becomes visible again (user switches back to this tab)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopRecording();
    } else {
      // Check recording state when tab becomes visible again
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res?.state?.recording && !isRecording) {
          startRecording();
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let isRecording = false;
  let overlayRoot = null;
  let hoveredEl = null;

  // Map<selector, { tid: number, el: Element }> — debounce timers for input events
  const inputTimers = new Map();

  // Map<variableName, value> — extracted values from elements during playback
  const extractedValues = new Map();

  // Store extracted values in chrome.storage for cross-frame/page access
  function storeExtractedValue(varName, value) {
    extractedValues.set(varName, value);
    chrome.storage.session.set({ [`extracted_${varName}`]: value }).catch(() => {});
  }

  function getExtractedValue(varName) {
    return extractedValues.get(varName);
  }

  function getAllExtractedVariables() {
    return Array.from(extractedValues.entries());
  }

  function getAvailableVariablesForFilling(callback) {
    // Get extracted values first
    const extracted = Array.from(extractedValues.entries());
    
    // Also get recorded extract steps from background (for recording phase variables)
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
      if (chrome.runtime.lastError) {
        callback(extracted);
        return;
      }
      
      const steps = res?.state?.steps || [];
      const extractSteps = steps.filter(step => step.action === 'extract');
      
      // Combine: show extracted values first, then recorded variables with 'pending' prefix
      const combined = [
        ...extracted,
        ...extractSteps
          .filter(step => !extractedValues.has(step.variable))
          .map(step => [step.variable, null]) // null value = not yet extracted
      ];
      
      callback(combined);
    });
  }

  // Load extracted values from storage on initialization
  chrome.storage.session.get(null, (items) => {
    Object.entries(items || {}).forEach(([key, value]) => {
      if (key.startsWith('extracted_')) {
        const varName = key.replace('extracted_', '');
        extractedValues.set(varName, value);
      }
    });
  });

  // Extract text/value from element by selector
  function extractFromElement(selector, extractType = 'text') {
    if (!selector) return '';
    const el = document.querySelector(selector);
    if (!el) return '';

    if (extractType === 'value') {
      // Get value from input/textarea
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        return el.value || '';
      }
      // Try data attributes
      if (el.hasAttribute('data-value')) {
        return el.getAttribute('data-value') || '';
      }
      return el.textContent?.trim() || '';
    }

    // Default: extract text content
    if (el.isContentEditable) {
      return el.textContent?.trim() || '';
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return el.value || '';
    }
    return el.textContent?.trim() || '';
  }

  // ---------------------------------------------------------------------------
  // Utility: strip Markdown syntax so rich-text editors (Jira, Confluence, etc.)
  // receive plain text instead of literal **bold** / ## heading characters.
  // ---------------------------------------------------------------------------
  function stripMarkdown(text) {
    return text
      .replace(/^#{1,6}\s+/gm, '')            // ## headings
      .replace(/(\*\*|__)(.*?)\1/g, '$2')      // **bold** / __bold__
      .replace(/(\*|_)(.*?)\1/g, '$2')         // *italic* / _italic_
      .replace(/~~(.*?)~~/g, '$1')             // ~~strikethrough~~
      .replace(/`{1,3}[^`]*`{1,3}/g, (m) =>   // `code` / ```block```
        m.replace(/`/g, '').trim())
      .replace(/^\s*[-*+]\s+/gm, '')           // - / * / + unordered list bullets
      .replace(/^\s*\d+\.\s+/gm, '')           // 1. ordered list
      .replace(/^\s*>\s*/gm, '')               // > blockquote
      .replace(/^-{3,}$/gm, '')               // --- horizontal rules
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link text](url) → link text
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // ![alt](url) → alt
      .trim();
  }

  // ---------------------------------------------------------------------------
  // Message listener (from background)
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'START_RECORDING':
        startRecording();
        sendResponse({ success: true });
        break;

      case 'STOP_RECORDING':
        stopRecording();
        sendResponse({ success: true });
        break;

      case 'EXECUTE_STEP':
        executeStep(message.step, message.index, message.total, message.devMode, message.afterNavigate)
          .then((result) => sendResponse({ success: true, result }))
          .catch((err) => sendResponse({ error: err.message }));
        return true; // async

      case 'GET_RECORDING_STATE':
        sendResponse({ isRecording });
        break;

      case 'HIGHLIGHT_STEP_ELEMENT': {
        document.getElementById('webpilot-step-hl')?.remove();
        const sel = message.selector;
        if (!sel) { sendResponse({ success: true }); break; }
        let found = false;
        try {
          const el = document.querySelector(sel);
          if (el) {
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            showStepHighlight(el, message.action, message.description);
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

      default:
        sendResponse({ error: `Unknown type: ${message.type}` });
    }
  });

  // ---------------------------------------------------------------------------
  // Recording — start / stop (continuous mode)
  // ---------------------------------------------------------------------------
  function startRecording() {
    if (isRecording) return;
    isRecording = true;
    mountOverlay('WebPilot · Recording — interact with the page');
    attachListeners();
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    detachListeners();
    // Flush any pending input timers so the last typed value is captured
    for (const [, { tid, el, selector }] of inputTimers) {
      clearTimeout(tid);
      if (el) sendInputAction(el, selector);
    }
    inputTimers.clear();
    unmountOverlay();
  }

  // ---------------------------------------------------------------------------
  // Overlay
  // ---------------------------------------------------------------------------
  function mountOverlay(label = 'WebPilot · Recording') {
    if (overlayRoot) {
      // Update label if already mounted
      const badge = document.getElementById('webpilot-badge');
      if (badge) badge.querySelector('span:last-child').textContent = label;
      return;
    }

    injectStyles();

    overlayRoot = document.createElement('div');
    overlayRoot.id = 'webpilot-overlay';

    const badge = document.createElement('div');
    badge.id = 'webpilot-badge';
    badge.innerHTML =
      '<span class="wp-dot"></span><span>WebPilot · Recording</span>';

    overlayRoot.appendChild(badge);
    document.documentElement.appendChild(overlayRoot);
  }

  function unmountOverlay() {
    overlayRoot?.remove();
    overlayRoot = null;
    clearHighlight();
  }

  function injectStyles() {
    if (document.getElementById('webpilot-styles')) return;
    const style = document.createElement('style');
    style.id = 'webpilot-styles';
    style.textContent = `
      #webpilot-overlay {
        position: fixed; inset: 0;
        z-index: 2147483646;
        pointer-events: none;
        border: 3px solid #dc2626;
        background: rgba(220,38,38,0.04);
      }
      #webpilot-badge {
        position: absolute; top: 8px; right: 8px;
        background: #dc2626; color: #fff;
        padding: 4px 12px; border-radius: 9999px;
        font: 600 12px/1.5 system-ui,sans-serif;
        display: flex; align-items: center; gap: 6px;
        pointer-events: none;
      }
      .wp-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #fff; flex-shrink: 0;
        animation: wp-pulse 1s ease-in-out infinite;
      }
      @keyframes wp-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
      .wp-hover {
        outline: 2px dashed #f59e0b !important;
        outline-offset: 2px !important;
      }
      .wp-recorded {
        outline: 2px solid #3b82f6 !important;
        outline-offset: 2px !important;
        background: rgba(59,130,246,.08) !important;
        animation: wp-flash .4s ease-out;
      }
      .wp-playback {
        outline: 2px solid #10b981 !important;
        outline-offset: 2px !important;
        background: rgba(16,185,129,.12) !important;
      }
      @keyframes wp-flash {
        0% { background: rgba(59,130,246,.35) !important; }
        100% { background: rgba(59,130,246,.08) !important; }
      }
      #webpilot-progress {
        position: fixed; bottom: 20px; right: 20px;
        background: #1e293b; color: #f1f5f9;
        padding: 10px 14px; border-radius: 8px;
        font: 13px/1.5 system-ui,sans-serif;
        z-index: 2147483647;
        max-width: 280px;
        box-shadow: 0 4px 24px rgba(0,0,0,.35);
        pointer-events: none;
      }
      #webpilot-progress .wp-step-num { color: #10b981; font-weight: 700; }
      #webpilot-progress .wp-step-desc {
        font-size: 12px; opacity: .8;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      
      /* Extract Modal */
      #webpilot-extract-modal {
        position: fixed; inset: 0;
        z-index: 2147483648;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,.5);
        font-family: system-ui, -apple-system, sans-serif;
      }
      .wp-extract-overlay {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex; align-items: center; justify-content: center;
      }
      .wp-extract-panel {
        background: #fff; border-radius: 8px;
        box-shadow: 0 10px 40px rgba(0,0,0,.3);
        width: 90%; max-width: 360px;
        overflow: hidden;
      }
      .wp-extract-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid #e5e7eb;
        font: 700 14px/1.4 inherit;
      }
      .wp-extract-close {
        background: none; border: none; font-size: 24px;
        cursor: pointer; color: #6b7280;
        padding: 0; width: 28px; height: 28px;
        display: flex; align-items: center; justify-content: center;
      }
      .wp-extract-close:hover { color: #111; }
      .wp-extract-body {
        padding: 14px 16px;
        display: flex; flex-direction: column; gap: 12px;
      }
      .wp-extract-field {
        display: flex; flex-direction: column; gap: 4px;
      }
      .wp-extract-label {
        font-size: 12px; font-weight: 600; color: #4b5563;
        text-transform: uppercase; letter-spacing: 0.3px;
      }
      .wp-extract-var-input {
        padding: 8px 10px; border: 1.5px solid #d1d5db;
        border-radius: 4px; font-size: 13px; font: inherit;
        box-sizing: border-box; transition: border-color .15s;
      }
      .wp-extract-var-input:focus {
        outline: none; border-color: #3b82f6;
      }
      .wp-extract-type-group {
        display: flex; flex-direction: column; gap: 6px;
      }
      .wp-extract-radio {
        display: flex; align-items: center; gap: 6px;
        cursor: pointer; font-size: 13px; user-select: none;
      }
      .wp-extract-radio input[type="radio"] {
        cursor: pointer;
      }
      .wp-extract-footer {
        display: flex; gap: 8px; padding: 12px 16px;
        border-top: 1px solid #e5e7eb;
        justify-content: flex-end;
      }
      .wp-extract-btn-cancel,
      .wp-extract-btn-extract {
        padding: 6px 14px; border-radius: 4px;
        font-size: 13px; font-weight: 500; border: none;
        cursor: pointer; transition: all .15s;
      }
      .wp-extract-btn-cancel {
        background: #f3f4f6; color: #374151;
      }
      .wp-extract-btn-cancel:hover { background: #e5e7eb; }
      .wp-extract-btn-extract {
        background: #3b82f6; color: #fff;
      }
      .wp-extract-btn-extract:hover { background: #2563eb; }
      
      /* Extracted variables list */
      .wp-extract-vars-list {
        display: flex; flex-direction: column; gap: 6px;
      }
      .wp-extract-var-btn {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 10px; background: #f0f9ff; border: 1.5px solid #bfdbfe;
        border-radius: 4px; cursor: pointer; text-align: left;
        font-size: 12px; transition: all .15s;
      }
      .wp-extract-var-btn:hover {
        background: #e0f2fe; border-color: #7dd3fc;
      }
      .wp-var-name {
        font-weight: 600; color: #0369a1; font-family: monospace;
        flex-shrink: 0; margin-right: 8px;
      }
      .wp-var-value {
        color: #64748b; font-size: 11px; flex: 1;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .wp-extract-divider {
        display: flex; align-items: center; gap: 8px;
        color: #9ca3af; font-size: 12px; font-weight: 500;
        margin: 4px 0;
      }
      .wp-extract-divider::before,
      .wp-extract-divider::after {
        content: ''; flex: 1; height: 1px; background: #d1d5db;
      }
      .wp-no-vars {
        display: block; text-align: center;
        padding: 12px 8px; color: #9ca3af; font-size: 12px;
        font-style: italic;
      }

    `;
    document.head.appendChild(style);
  }

  function setHoverHighlight(el) {
    clearHighlight();
    if (el && el !== overlayRoot && !overlayRoot?.contains(el)) {
      hoveredEl = el;
      el.classList.add('wp-hover');
    }
  }

  function clearHighlight() {
    hoveredEl?.classList.remove('wp-hover');
    hoveredEl = null;
  }

  function flashRecorded(el) {
    el.classList.remove('wp-hover');
    el.classList.add('wp-recorded');
    setTimeout(() => el.classList.remove('wp-recorded'), 600);
  }

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------
  const handlers = {};

  function attachListeners() {
    handlers.click = onCapturingClick;
    handlers.mouseover = onMouseOver;
    handlers.mouseout = onMouseOut;
    handlers.input = onInput;
    handlers.change = onChange;
    handlers.contextmenu = onRecordingContextMenu;

    // Use bubble phase (false) so we observe without blocking any page interaction
    document.addEventListener('click',        handlers.click,        false);
    document.addEventListener('mouseover',    handlers.mouseover,    false);
    document.addEventListener('mouseout',     handlers.mouseout,     false);
    document.addEventListener('input',        handlers.input,        false);
    document.addEventListener('change',       handlers.change,       false);
    document.addEventListener('contextmenu',  handlers.contextmenu,  false);
  }

  function detachListeners() {
    document.removeEventListener('click',        handlers.click,        false);
    document.removeEventListener('mouseover',    handlers.mouseover,    false);
    document.removeEventListener('mouseout',     handlers.mouseout,     false);
    document.removeEventListener('input',        handlers.input,        false);
    document.removeEventListener('change',       handlers.change,       false);
    document.removeEventListener('contextmenu',  handlers.contextmenu,  false);
  }

  function isWebPilotEl(el) {
    if (!el) return false;
    // Check overlay
    if (el === overlayRoot || overlayRoot?.contains(el)) return true;
    // Check extract modal
    const modal = document.getElementById('webpilot-extract-modal');
    if (el === modal || modal?.contains(el)) return true;
    return false;
  }

  /**
   * Returns true for elements where the expected interaction is typing,
   * so a click on them should not immediately finish single-step capture.
   */
  function isTypeable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    // Also catch clicks on children inside a contenteditable (e.g. <p> inside Jira editor)
    if (el.closest?.('[contenteditable="true"]')) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      return ['text', 'email', 'password', 'search', 'tel', 'url',
              'number', 'date', 'datetime-local', 'time', 'month', 'week'].includes(t);
    }
    // Container divs that wrap a rich-text editor (e.g. Jira's div.jira-wikifield):
    // clicking them should not produce a 'click' step — the inner editor will capture typing.
    if (tag === 'DIV' || tag === 'SPAN' || tag === 'SECTION' || tag === 'ARTICLE') {
      if (el.querySelector?.('[contenteditable="true"]')) return true;
      if (el.querySelector?.('textarea')) return true;
    }
    return false;
  }

  function onMouseOver(e) {
    if (!isRecording || isWebPilotEl(e.target)) return;
    setHoverHighlight(e.target);
  }

  function onMouseOut(e) {
    if (!isRecording) return;
    e.target.classList.remove('wp-hover');
    if (hoveredEl === e.target) hoveredEl = null;
  }

  function onCapturingClick(e) {
    if (!isRecording || isWebPilotEl(e.target)) return;
    // Never block — let the click reach the page normally

    const el = e.target;

    // Remove highlight classes before building selector so they're never captured
    clearHighlight();
    el.classList.remove('wp-hover', 'wp-recorded');

    const selector = buildSelector(el);
    const label = getLabel(el);

    // Clicking a typeable field is just a focus action — typing will be captured via onInput
    if (isTypeable(el)) {
      flashRecorded(el);
      return;
    }

    // Detect a click inside a calendar/date-picker popup (e.g. clicking a day cell)
    const calendarCtx = getCalendarContainer(el);
    if (calendarCtx) {
      flashRecorded(el);
      // Let the click land, then capture whatever date value was written to the input
      setTimeout(() => {
        const dateEl = findDateInputNear(calendarCtx);
        if (dateEl) {
          sendDateAction(dateEl, buildSelector(dateEl));
        } else {
          // Fallback: record as a plain click
          const name = label || labelFromSelector(selector);
          chrome.runtime.sendMessage({
            type: 'RECORD_ACTION',
            action: { action: 'click', selector, label: name, description: name },
          });
        }
      }, 100);
      return;
    }

    // Detect a click on a dropdown option (Jira/AUI combobox, custom selects).
    // Covers both ARIA-standard [role="listbox"] containers and Atlassian AUI
    // .aui-list containers which do NOT use role="listbox".
    const optionEl =
      el.closest?.('[role="option"]') ||
      el.closest?.('.aui-list-item')  ||
      (el.tagName === 'A' && el.closest?.('[class*="aui-list"]') ? el : null);
    if (optionEl) {
      // Accept any recognisable dropdown container
      const dropdown =
        optionEl.closest?.('[role="listbox"]') ||
        optionEl.closest?.('[class*="aui-list"]') ||
        optionEl.closest?.('[class*="dropdown"]') ||
        optionEl.closest?.('[class*="suggestions"]') ||
        optionEl.closest?.('[data-role="listbox"]');
      if (dropdown) {
        // Try to find the trigger/combobox that opened this dropdown
        let triggerEl = null;
        const dropdownId = dropdown.id;
        if (dropdownId) {
          triggerEl =
            document.querySelector(`[aria-controls="${dropdownId}"]`) ||
            document.querySelector(`[aria-owns="${dropdownId}"]`);
        }
        // Also try: look for the nearest preceding combobox/input sibling
        if (!triggerEl) {
          const parent = dropdown.parentElement;
          if (parent) {
            triggerEl =
              parent.querySelector('input[role="combobox"]') ||
              parent.querySelector('input[aria-autocomplete]') ||
              parent.querySelector('input[aria-haspopup]');
          }
        }
        const targetEl = triggerEl || dropdown;
        const sel = buildSelector(targetEl);
        // Get the option text — prefer the element's own trimmed text,
        // but for AUI list-items the anchor child holds the visible text.
        const optionText =
          (optionEl.tagName === 'A' ? optionEl : optionEl.querySelector('a'))?.textContent?.trim() ||
          optionEl.textContent?.trim() ||
          '';
        // Cancel any pending debounced type step for this combobox so we don't
        // get both a 'type' step (from user filtering) and a 'select' step.
        const existingTimer = inputTimers.get(sel);
        if (existingTimer) {
          clearTimeout(existingTimer.tid);
          inputTimers.delete(sel);
        }
        const lbl = getLabel(targetEl) || labelFromSelector(sel);
        flashRecorded(optionEl);
        chrome.runtime.sendMessage({
          type: 'RECORD_ACTION',
          action: {
            action: 'select',
            selector: sel,
            value: optionText,
            label: lbl,
            description: `Select "${optionText}" in ${lbl}`,
            elementHint: elementHint(targetEl),
          },
        });
        return;
      }
    }

    flashRecorded(el);

    const name = label || labelFromSelector(selector);
    chrome.runtime.sendMessage({
      type: 'RECORD_ACTION',
      action: { action: 'click', selector, label: name, description: name, elementHint: elementHint(el) },
    });
  }

  /**
   * Send a TYPE action to the background with the current field value.
   * Extracted so stopRecording() can flush pending timers with the live value.
   */
  function sendInputAction(el, selector) {
    // For contenteditable elements use textContent; for inputs use .value
    const value = el.isContentEditable
      ? (el.textContent ?? '')
      : (el.value ?? '');
    const label = getLabel(el) || labelFromSelector(selector);
    // Derive a {{variableName}} suggestion from the field label
    const suggestedVar = labelToVarName(label);
    chrome.runtime.sendMessage({
      type: 'RECORD_ACTION',
      action: {
        action: 'type',
        selector,
        value,
        label,
        description: label,
        suggestedVar,
        elementHint: elementHint(el),
        isContentEditable: el.isContentEditable || undefined,
      },
    });
  }

  /**
   * Build a short, human-readable description of a DOM element for display in the step list.
   * Examples:  BUTTON  |  INPUT[type=text][name=summary]  |  A[href=/issues]  |  DIV[role=button]
   */
  function elementHint(el) {
    if (!el) return '';
    const tag = el.tagName.toUpperCase();
    const attrs = [];
    if (el.type && el.tagName === 'INPUT') attrs.push(`type=${el.type}`);
    if (el.name)  attrs.push(`name=${el.name}`);
    if (el.id)    attrs.push(`#${el.id}`);
    const role = el.getAttribute('role');
    if (role)     attrs.push(`role=${role}`);
    if (el.isContentEditable) attrs.push('contenteditable');
    return attrs.length ? `${tag}[${attrs.join('][')}]` : tag;
  }

  /**
   * Convert a human-readable field label into a camelCase variable name.
   * E.g. "Summary *" → "summary", "Issue Description" → "issueDescription"
   */
  function labelToVarName(label) {
    return label
      .replace(/[^a-zA-Z0-9 ]/g, '')   // strip special chars / asterisks
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join('') || 'value';
  }

  function onInput(e) {
    if (!isRecording || isWebPilotEl(e.target)) return;
    // Native date fields emit 'change' (not 'input') when picked — skip here to avoid duplicates
    if (isDateField(e.target)) return;
    // For contenteditable children, target the root editable element
    const el = e.target.isContentEditable
      ? e.target
      : (e.target.closest?.('[contenteditable="true"]') ?? e.target);
    const selector = buildSelector(el);

    const existing = inputTimers.get(selector);
    if (existing) clearTimeout(existing.tid);

    const tid = setTimeout(() => {
      inputTimers.delete(selector);
      sendInputAction(el, selector);
    }, 700);

    inputTimers.set(selector, { tid, el, selector });
  }

  function onChange(e) {
    if (!isRecording || isWebPilotEl(e.target)) return;
    const el = e.target;

    if (el.tagName === 'SELECT') {
      const selector = buildSelector(el);
      const value = el.value;
      const label = getLabel(el) || labelFromSelector(selector);
      chrome.runtime.sendMessage({
        type: 'RECORD_ACTION',
        action: { action: 'select', selector, value, label, description: label, elementHint: elementHint(el) },
      });
      return;
    }

    // Jira/Atlassian and other modern UIs often use combobox widgets instead of
    // native <select>. Record these as 'select' too so variable substitution can
    // target them just like normal dropdowns.
    if (isComboBoxInput(el)) {
      const selector = buildSelector(el);
      if (inputTimers.has(selector)) {
        clearTimeout(inputTimers.get(selector).tid);
        inputTimers.delete(selector);
      }
      const value = (el.value ?? el.textContent ?? '').trim();
      const label = getLabel(el) || labelFromSelector(selector);
      chrome.runtime.sendMessage({
        type: 'RECORD_ACTION',
        action: { action: 'select', selector, value, label, description: label, elementHint: elementHint(el) },
      });
      return;
    }

    // Native date/time inputs fire 'change' when the user picks from the browser date picker
    if (isDateField(el)) {
      const selector = buildSelector(el);
      // Cancel any pending debounced input for this element to avoid duplicates
      if (inputTimers.has(selector)) {
        clearTimeout(inputTimers.get(selector).tid);
        inputTimers.delete(selector);
      }
      sendDateAction(el, selector);
    }
  }

  function onRecordingContextMenu(e) {
    if (!isRecording) return;
    
    const targetEl = e.target;
    if (isWebPilotEl(targetEl)) return;
    
    e.preventDefault();
    showExtractModal(targetEl);
  }

  function showExtractModal(targetEl) {
    // Remove any existing modal
    const existingModal = document.getElementById('webpilot-extract-modal');
    if (existingModal) existingModal.remove();

    // Generate a suggested variable name from the element
    const suggestedVarName = generateVariableName(targetEl);

    // Get all available variables (extracted + recorded extract steps)
    getAvailableVariablesForFilling((availableVars) => {
      const hasVars = availableVars.length > 0;

      const modal = document.createElement('div');
      modal.id = 'webpilot-extract-modal';
      modal.innerHTML = `
        <div class="wp-extract-overlay">
          <div class="wp-extract-panel">
            <div class="wp-extract-header">
              <span>Extract or Fill Element</span>
              <button class="wp-extract-close" type="button">×</button>
            </div>
            <div class="wp-extract-body">
              <div class="wp-extract-field">
                <label class="wp-extract-label">Use Existing Variable</label>
                <div class="wp-extract-vars-list">
                  ${hasVars 
                    ? availableVars.map(([varName, value]) => `
                      <button class="wp-extract-var-btn" type="button" data-var="${varName}">
                        <span class="wp-var-name">{{${varName}}}</span>
                        <span class="wp-var-value">${value === null ? '(pending extraction)' : (value ?? '').slice(0, 30)}</span>
                      </button>
                    `).join('')
                    : '<span class="wp-no-vars">No variables defined yet</span>'
                  }
                </div>
              </div>
              ${hasVars ? '<div class="wp-extract-divider">OR</div>' : ''}
              <div class="wp-extract-field">
                <label class="wp-extract-label">Extract New Variable</label>
                <input class="wp-extract-var-input" type="text" placeholder="e.g., product_title" value="${suggestedVarName}" />
              </div>
              <div class="wp-extract-field">
                <label class="wp-extract-label">Extract Type</label>
                <div class="wp-extract-type-group">
                  <label class="wp-extract-radio">
                    <input type="radio" name="extractType" value="text" checked />
                    <span>Text Content</span>
                  </label>
                  <label class="wp-extract-radio">
                    <input type="radio" name="extractType" value="value" />
                    <span>Input Value</span>
                  </label>
                </div>
              </div>
            </div>
            <div class="wp-extract-footer">
              <button class="wp-extract-btn-cancel" type="button">Cancel</button>
              <button class="wp-extract-btn-extract" type="button">${hasVars ? 'Extract New' : 'Extract'}</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const varInput = modal.querySelector('.wp-extract-var-input');
      const extractTypeRadios = modal.querySelectorAll('input[name="extractType"]');
      const btnCancel = modal.querySelector('.wp-extract-btn-cancel');
      const btnExtract = modal.querySelector('.wp-extract-btn-extract');
      const closeBtn = modal.querySelector('.wp-extract-close');

      // Prevent any events inside the modal from bubbling up to recording handlers
      modal.addEventListener('click', (e) => e.stopPropagation());
      modal.addEventListener('input', (e) => e.stopPropagation());
      modal.addEventListener('change', (e) => e.stopPropagation());

      const cleanup = () => modal.remove();
      const doExtract = () => {
        const varName = varInput.value.trim();
        if (!varName) {
          alert('Please enter a variable name');
          return;
        }

        const extractType = Array.from(extractTypeRadios).find(r => r.checked)?.value || 'text';
        const selector = buildSelector(targetEl);
        const label = getLabel(targetEl) || labelFromSelector(selector);
        const description = `Extract ${extractType} to {{${varName}}}`;

        chrome.runtime.sendMessage({
          type: 'RECORD_ACTION',
          action: {
            action: 'extract',
            selector,
            variable: varName,
            extractType,
            label,
            description,
            elementHint: elementHint(targetEl),
          },
        });

        flashRecorded(targetEl);
        cleanup();
      };

      btnCancel.addEventListener('click', cleanup);
      closeBtn.addEventListener('click', cleanup);
      btnExtract.addEventListener('click', doExtract);
      
      // Handle clicking on existing variables to auto-fill
      const varBtns = modal.querySelectorAll('.wp-extract-var-btn');
      varBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const varName = btn.getAttribute('data-var');
          const selector = buildSelector(targetEl);
          const label = getLabel(targetEl) || labelFromSelector(selector);
          const description = `Fill with {{${varName}}}`;

          chrome.runtime.sendMessage({
            type: 'RECORD_ACTION',
            action: {
              action: 'type',
              selector,
              value: `{{${varName}}}`,
              label,
              description,
              elementHint: elementHint(targetEl),
            },
          });

          flashRecorded(targetEl);
          cleanup();
        });
      });

      varInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doExtract();
        if (e.key === 'Escape') cleanup();
      });

      // Auto-focus and select the input
      varInput.focus();
      varInput.select();
    });
  }

  /** Returns true for native date/time input types handled by the browser's date picker. */
  function isDateField(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const t = (el.type || '').toLowerCase();
    return ['date', 'datetime-local', 'time', 'month', 'week'].includes(t);
  }

  function isComboBoxInput(el) {
    if (!el) return false;
    const role = (el.getAttribute?.('role') || '').toLowerCase();
    const ariaAutocomplete = (el.getAttribute?.('aria-autocomplete') || '').toLowerCase();
    const hasListboxPopup = (el.getAttribute?.('aria-haspopup') || '').toLowerCase() === 'listbox';
    const tag = el.tagName;
    const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    return role === 'combobox' || (isEditable && (ariaAutocomplete === 'list' || hasListboxPopup));
  }

  /**
   * Walk up the DOM to find a calendar popup container.
   * Deliberately narrow: only matches elements whose class name or aria-label
   * explicitly mentions a calendar/datepicker library, plus role="grid" which
   * is used by calendar month grids. We intentionally exclude role="dialog"
   * and role="listbox" because those appear on many non-calendar overlays.
   */
  function getCalendarContainer(el) {
    let node = el;
    while (node && node !== document.body) {
      const role = node.getAttribute?.('role') || '';
      const cls  = (typeof node.className === 'string' ? node.className : '').toLowerCase();
      const aria = (node.getAttribute?.('aria-label') || '').toLowerCase();
      if (
        role === 'grid' ||
        /calendar|datepicker|date-picker|flatpickr|daypicker|\brdp\b|date-range/.test(cls) ||
        aria.includes('calendar') || aria.includes('date picker')
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Given a calendar popup container, find the input that receives the chosen date.
   * Checks aria-controls / aria-owns first, then walks up ancestors looking for
   * a date-type input or an input whose value looks like a date string.
   */
  function findDateInputNear(calendarEl) {
    for (const attr of ['aria-controls', 'aria-owns']) {
      const refs = calendarEl.getAttribute?.(attr);
      if (refs) {
        for (const id of refs.trim().split(/\s+/)) {
          const el = document.getElementById(id);
          if (el?.tagName === 'INPUT') return el;
        }
      }
    }
    let container = calendarEl.parentElement;
    for (let i = 0; i < 6 && container; i++, container = container.parentElement) {
      for (const inp of container.querySelectorAll('input')) {
        if (isDateField(inp)) return inp;
        const hint = (inp.name || inp.id || inp.className || '').toLowerCase();
        if (/date|calendar|picker/.test(hint)) return inp;
        if (inp.value && /^\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(inp.value)) return inp;
      }
    }
    return null;
  }

  /** Record a date-pick action (native or custom calendar). */
  function sendDateAction(el, selector) {
    const value = el.value ?? '';
    const label = getLabel(el) || labelFromSelector(selector);
    const suggestedVar = labelToVarName(label);
    chrome.runtime.sendMessage({
      type: 'RECORD_ACTION',
      action: {
        action: 'type',
        selector,
        value,
        label,
        fieldType: 'date',
        description: label,
        suggestedVar,
        elementHint: elementHint(el),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // CSS selector builder
  // ---------------------------------------------------------------------------
  /**
   * Walk up from a contenteditable / textarea / input element looking for the
   * nearest ancestor that has a stable, unique identifier (id, data-field-id,
   * data-testid, aria-label, aria-labelledby).  Returns null if none found
   * within 6 levels.
   */
  function findStableFieldAncestor(el) {
    let node = el.parentElement;
    for (let i = 0; i < 6 && node && node !== document.body; i++, node = node.parentElement) {
      if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) return node;
      if (node.dataset?.fieldId) return node;
      if (node.dataset?.testid) return node;
      if (node.dataset?.cy) return node;
      if (node.getAttribute('aria-label')) return node;
      if (node.getAttribute('aria-labelledby')) return node;
    }
    return null;
  }

  function buildSelector(el) {
    if (!el) return 'body';

    // Stable id check FIRST — even document.body can have a meaningful id.
    // e.g. TinyMCE renders <body id="tinymce" contenteditable="true"> inside
    // an iframe; we must return '#tinymce' rather than 'body' in that case.
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return `#${el.id}`;

    if (el === document.body) return 'body';
    if (el.dataset?.testid) return `[data-testid="${CSS.escape(el.dataset.testid)}"]`;
    if (el.dataset?.cy) return `[data-cy="${CSS.escape(el.dataset.cy)}"]`;
    if (el.dataset?.fieldId) return `[data-field-id="${CSS.escape(el.dataset.fieldId)}"]`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `[aria-label="${CSS.escape(ariaLabel)}"]`;

    // For editable elements with no own stable identifier, try anchoring on a
    // stable ancestor (e.g. the wrapping div.jira-wikifield with an id or
    // data-field-id).  This avoids fragile nth-child paths for rich editors.
    const isEditable = el.isContentEditable ||
      el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && el.type !== 'hidden');
    if (isEditable) {
      const anchor = findStableFieldAncestor(el);
      if (anchor) {
        // Build the anchor's selector (will hit one of the stable checks above)
        const anchorSel = buildSelector(anchor);
        // If there is exactly one matching typeable descendant use a qualified
        // selector; otherwise the anchor alone is enough (playback will find
        // the first editable child).
        const qualified = `${anchorSel} ${el.tagName.toLowerCase()}`;
        if (document.querySelectorAll(qualified).length === 1) return qualified;
        return anchorSel;
      }
    }

    // Walk up and build a short CSS path
    const path = [];
    let node = el;

    while (node && node !== document.body && node.nodeType === Node.ELEMENT_NODE) {
      let seg = node.tagName.toLowerCase();

      // Append up to two stable class names — exclude dynamic/state and our own injected classes
      const OUR_CLASSES = new Set(['wp-hover', 'wp-recorded', 'wp-playback', 'drag-over', 'dragging']);
      const stableClasses = Array.from(node.classList)
        .filter((c) =>
          !OUR_CLASSES.has(c) &&
          !/^(is-|has-|active|open|closed|focused|hover|selected|disabled)/.test(c)
        )
        .slice(0, 2);
      if (stableClasses.length) seg += '.' + stableClasses.map(CSS.escape).join('.');

      // Disambiguate siblings of the same tag
      const parent = node.parentElement;
      if (parent) {
        const sameTags = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sameTags.length > 1) seg += `:nth-of-type(${sameTags.indexOf(node) + 1})`;
      }

      path.unshift(seg);

      // Stop once uniquely identifiable
      if (document.querySelectorAll(path.join(' > ')).length === 1) break;

      node = node.parentElement;
    }

    return path.join(' > ') || el.tagName.toLowerCase();
  }

  function getLabel(el) {
    // 1. Explicit accessible name on the element itself
    const ariaLabel = el.getAttribute('aria-label')?.trim();
    if (ariaLabel) return ariaLabel;

    // 2. aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean).join(' ');
      if (text) return text;
    }

    // 3. Associated <label for="id">
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
    }

    // 4. Wrapping <label>
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const text = parentLabel.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60);
      if (text) return text;
    }

    // 5. Standard HTML attributes
    const title       = el.getAttribute('title')?.trim();
    if (title) return title;
    const placeholder = el.getAttribute('placeholder')?.trim();
    if (placeholder) return placeholder;
    const name        = el.getAttribute('name')?.trim();
    if (name) return name;

    // 6. Element's own visible text (buttons, links, etc.)
    const ownText = el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (ownText) return ownText;

    // 7. Walk up the DOM tree looking for a nearby human-readable label.
    //    Stops at BODY / our overlay root / after 6 levels.
    const nearbyLabel = _findNearbyLabel(el);
    if (nearbyLabel) return nearbyLabel;

    // 8. value attribute (submit buttons)
    const val = el.getAttribute('value')?.trim();
    if (val) return val;

    return '';
  }

  /**
   * Generate a valid variable name from element label or content.
   * Converts label text to snake_case and removes invalid characters.
   */
  function generateVariableName(el) {
    const label = getLabel(el);
    if (!label) return 'extracted_value';
    
    // Convert to snake_case:
    // 1. Lowercase
    // 2. Replace spaces and hyphens with underscores
    // 3. Remove any other special characters
    // 4. Collapse multiple underscores
    let varName = label
      .toLowerCase()
      .trim()
      .slice(0, 40)  // Limit length
      .replace(/\s+/g, '_')  // Spaces to underscores
      .replace(/-+/g, '_')   // Hyphens to underscores
      .replace(/[^a-z0-9_]/g, '')  // Remove non-alphanumeric/underscore
      .replace(/_+/g, '_')   // Collapse multiple underscores
      .replace(/^_+|_+$/g, '')  // Remove leading/trailing underscores
      .replace(/^[0-9]/, '');  // Remove leading digits
    
    // Ensure it's not empty and doesn't start with number
    if (!varName || /^\d/.test(varName)) {
      varName = 'extracted_value';
    }
    
    return varName;
  }

  /**
   * Look for visible label text near `el` by walking up the DOM.
   * At each ancestor level check:
   *   - an immediately preceding sibling with text
   *   - a child element whose role/tag suggests it is a label
   *   - the ancestor's own aria-label / title
   */
  function _findNearbyLabel(el) {
    const OUR_IDS = new Set(['webpilot-overlay', 'webpilot-progress', 'webpilot-dev-hl']);

    let node = el.parentElement;
    for (let depth = 0; depth < 8 && node && node !== document.body; depth++, node = node.parentElement) {
      if (OUR_IDS.has(node.id)) break;

      // Ancestor's own aria-label / title
      const al = node.getAttribute('aria-label')?.trim();
      if (al) return al;
      const ti = node.getAttribute('title')?.trim();
      if (ti) return ti;

      // Preceding siblings with short visible text (labels, headings, <p>, <span>)
      let sib = node.previousElementSibling;
      for (let s = 0; s < 3 && sib; s++, sib = sib.previousElementSibling) {
        const t = sib.textContent?.trim().replace(/\s+/g, ' ');
        if (t && t.length > 1 && t.length < 80) return t.slice(0, 60);
      }

      // Children of this ancestor that look like labels
      for (const child of node.querySelectorAll('label, [class*="label"], [class*="title"], legend, h1, h2, h3, h4, h5, h6, p')) {
        if (child === el || child.contains(el)) continue;
        const t = child.textContent?.trim().replace(/\s+/g, ' ');
        if (t && t.length > 1 && t.length < 80) return t.slice(0, 60);
      }
    }
    return '';
  }

  /**
   * Extract a human-readable label from a CSS selector string.
   * Priority: aria-label attr > #id > last meaningful tag/class segment > raw selector (truncated).
   */
  function labelFromSelector(selector) {
    // aria-label attribute in the selector string
    const ariaM = selector.match(/\[aria-label=["']?([^"'\]]+)["']?\]/);
    if (ariaM) return ariaM[1].replace(/\\/g, '').trim();

    // #id in the selector
    const idM = selector.match(/#([\w-]+)/);
    if (idM) return idM[1].replace(/-/g, ' ');

    // Walk the path segments right-to-left looking for a meaningful tag/class
    // e.g. "search-slide-toggle" → "search slide toggle"
    const segments = selector.split(/\s*>\s*/);
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i].trim();
      // Strip pseudo/nth selectors
      const base = seg.replace(/:[\w-]+(\([^)]*\))?/g, '').replace(/\[.*?\]/g, '').trim();
      // Prefer custom element names (contain a hyphen) or class names that look semantic
      const tagM = base.match(/^([a-z][\w-]*)(?:\..*)?$/);
      if (tagM) {
        const tag = tagM[1];
        // Skip purely structural tags
        if (/^(div|span|ul|ol|li|section|article|main|aside|nav|header|footer|form)$/.test(tag)) continue;
        // Convert kebab-case to words
        return tag.replace(/-/g, ' ');
      }
      // Fallback: first meaningful class on this segment
      const clsM = base.match(/\.([\w-]{4,})/);
      if (clsM) return clsM[1].replace(/-/g, ' ').replace(/ng\w*/i, '').trim();
    }

    // Last resort: truncate the raw selector
    return selector.length > 50 ? selector.slice(selector.lastIndexOf('>') + 1).trim().slice(0, 50) : selector;
  }

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  /**
   * Persistent highlight shown while the user hovers a step row in the
   * workflow editor.  Distinct from the dev-mode playback highlight:
   *  • dashed violet border (vs solid blue)
   *  • stays until UNHIGHLIGHT_STEP_ELEMENT is received
   */
  function showStepHighlight(el, action, description) {
    document.getElementById('webpilot-step-hl')?.remove();

    const rect    = el.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const overlay = document.createElement('div');
    overlay.id = 'webpilot-step-hl';

    const color = '#6d28d9'; // violet — distinct from recording (red) and playback (green/blue)

    Object.assign(overlay.style, {
      position:      'absolute',
      top:           `${rect.top  + scrollY - 4}px`,
      left:          `${rect.left + scrollX - 4}px`,
      width:         `${rect.width  + 8}px`,
      height:        `${rect.height + 8}px`,
      border:        `2px dashed ${color}`,
      borderRadius:  '5px',
      boxShadow:     `0 0 0 3px ${color}22, 0 0 10px ${color}33`,
      zIndex:        '2147483645',
      pointerEvents: 'none',
      boxSizing:     'border-box',
    });

    // Label chip
    const chip = document.createElement('div');
    const actionLabel = (action || 'step').toUpperCase();
    const desc = description ? ` — ${description}` : '';
    chip.textContent = `${actionLabel}${desc}`;
    Object.assign(chip.style, {
      position:     'absolute',
      bottom:       '100%',
      left:         '0',
      marginBottom: '4px',
      padding:      '2px 8px',
      background:   color,
      color:        '#fff',
      fontSize:     '11px',
      fontFamily:   'ui-monospace, monospace',
      fontWeight:   '600',
      borderRadius: '4px',
      whiteSpace:   'nowrap',
      maxWidth:     '280px',
      overflow:     'hidden',
      textOverflow: 'ellipsis',
    });
    overlay.appendChild(chip);
    document.documentElement.appendChild(overlay);
  }

  /**
   * In dev mode, surround the target element with a labelled highlight overlay
   * for `durationMs` before executing the action.
   */
  function showDevHighlight(el, step, durationMs = 900) {
    // Remove any existing highlight
    document.getElementById('webpilot-dev-hl')?.remove();

    const rect = el.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const overlay = document.createElement('div');
    overlay.id = 'webpilot-dev-hl';

    const actionColors = {
      click:    '#2563eb',
      type:     '#16a34a',
      select:   '#d97706',
      navigate: '#7c3aed',
      wait:     '#6b7280',
    };
    const color = actionColors[step.action] || '#2563eb';

    Object.assign(overlay.style, {
      position:     'absolute',
      top:          `${rect.top + scrollY - 4}px`,
      left:         `${rect.left + scrollX - 4}px`,
      width:        `${rect.width + 8}px`,
      height:       `${rect.height + 8}px`,
      border:       `2.5px solid ${color}`,
      borderRadius: '5px',
      boxShadow:    `0 0 0 3px ${color}33, 0 0 12px ${color}55`,
      zIndex:       '2147483646',
      pointerEvents:'none',
      boxSizing:    'border-box',
      transition:   'opacity 0.15s',
    });

    // Label chip above the element
    const label = document.createElement('div');
    const actionLabel = step.action.toUpperCase();
    const desc = step.description ? ` — ${step.description}` : '';
    label.textContent = `${actionLabel}${desc}`;
    Object.assign(label.style, {
      position:       'absolute',
      bottom:         '100%',
      left:           '0',
      marginBottom:   '4px',
      padding:        '3px 8px',
      background:     color,
      color:          '#fff',
      fontSize:       '11px',
      fontFamily:     'ui-monospace, monospace',
      fontWeight:     '600',
      borderRadius:   '4px',
      whiteSpace:     'nowrap',
      maxWidth:       '260px',
      overflow:       'hidden',
      textOverflow:   'ellipsis',
      lineHeight:     '1.4',
      pointerEvents:  'none',
    });
    overlay.appendChild(label);

    document.documentElement.appendChild(overlay);

    return new Promise(resolve => {
      setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.remove(); resolve(); }, 150);
      }, durationMs);
    });
  }

  async function executeStep(step, index, total, devMode = false, afterNavigate = false) {
    const { action, selector, value } = step;

    showProgress(index, total, step.description ?? `${action}: ${selector}`);

    if (action === 'navigate') {
      window.location.href = value;
      return { success: true };
    }

    if (action === 'wait') {
      await delay(parseInt(value, 10) || 1000);
      return { success: true };
    }

    if (action === 'extract') {
      const extractedValue = extractFromElement(selector, step.extractType || 'text');
      const varName = step.variable || 'extracted';
      storeExtractedValue(varName, extractedValue);
      showProgress(index, total, `Extracted "${varName}" = "${extractedValue.substring(0, 50)}${extractedValue.length > 50 ? '...' : ''}"`);
      return { success: true, extracted: { [varName]: extractedValue } };
    }

    // key with no selector — dispatch on currently focused element
    if (action === 'key' && !selector) {
      const keyTarget = document.activeElement || document.body;
      const keyName = value ?? 'Enter';
      const init = { key: keyName, bubbles: true, cancelable: true };
      keyTarget.dispatchEvent(new KeyboardEvent('keydown', init));
      keyTarget.dispatchEvent(new KeyboardEvent('keypress', init));
      keyTarget.dispatchEvent(new KeyboardEvent('keyup', init));
      return { success: true };
    }

    // After a navigate the new page may still be rendering — use a longer timeout
    const waitTimeout = afterNavigate ? 20000 : 6000;
    const el = await waitForElement(selector, waitTimeout);
    if (!el) throw new Error(`Element not found: ${selector}`);

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(200);

    if (devMode) await showDevHighlight(el, step);

    switch (action) {
      case 'click': {
        // Suppress HTML5 form validation so clicks on submit/search buttons
        // proceed even if a sibling input holds a type-incompatible value.
        const form = el.closest('form');
        const addedNoValidate = form && !form.hasAttribute('novalidate');
        if (addedNoValidate) form.setAttribute('novalidate', '');
        el.click();
        if (addedNoValidate) form.removeAttribute('novalidate');
        break;
      }

      case 'type': {
        // If the selector resolved to a container (not directly editable),
        // look for the actual editable descendant inside it.
        // This handles wrappers like div.jira-wikifield that contain a
        // contenteditable or textarea child.
        let typeEl = el;
        if (!el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
          typeEl = el.querySelector('[contenteditable="true"]') ??
                   el.querySelector('textarea') ??
                   el.querySelector('input:not([type="hidden"])') ??
                   el;
        }

        typeEl.focus();
        await delay(50);

        // Replace {{variableName}} with extracted values
        let finalValue = value ?? '';
        const varMatches = finalValue.match(/{{\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*}}/g) || [];
        varMatches.forEach((match) => {
          const varName = match.replace(/[{}\\s]/g, '');
          const extracted = getExtractedValue(varName);
          if (extracted !== undefined) {
            finalValue = finalValue.replace(match, extracted);
          }
        });

        if (typeEl.isContentEditable) {
          // contenteditable (e.g. Jira rich-text editor, ProseMirror, Quill)
          // Accept HTML for formatting (from AI output) — Jira will render <b>, <ul>, <a>, etc.
          const htmlValue = finalValue;
          // Select all existing content and replace with typed value
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(typeEl);
          selection.removeAllRanges();
          selection.addRange(range);
          // Use execCommand for broad framework compatibility
          document.execCommand('insertHTML', false, htmlValue);
          // Fallback: set innerHTML if execCommand had no effect
          if (typeEl.innerHTML !== htmlValue) {
            typeEl.innerHTML = htmlValue;
            typeEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: htmlValue }));
          }
        } else {
          // Regular <input> / <textarea>
          // For constrained input types (number, date, etc.) temporarily relax
          // the type to 'text' so the browser accepts any string value without
          // logging a validation warning or silently clearing the field.
          const CONSTRAINED = ['number','date','datetime-local','time','month','week','range','color'];
          const savedType = (typeEl instanceof HTMLInputElement && CONSTRAINED.includes(typeEl.type.toLowerCase()))
            ? typeEl.type : null;
          if (savedType) { try { typeEl.type = 'text'; } catch (_) {} }

          const nativeSetter =
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeSetter && (typeEl instanceof HTMLInputElement || typeEl instanceof HTMLTextAreaElement)) {
            nativeSetter.call(typeEl, finalValue ?? '');
          } else {
            typeEl.value = finalValue ?? '';
          }

          if (savedType) { try { typeEl.type = savedType; } catch (_) {} }

          typeEl.dispatchEvent(new Event('input', { bubbles: true }));
          typeEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        break;
      }

      case 'select': {
        if (el.tagName === 'SELECT') {
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }

        // Combobox/listbox widgets (e.g. Jira issue type)
        await selectComboOption(el, value ?? '');
        break;
      }

      case 'key': {
        const keyName = value ?? 'Enter';
        const init = { key: keyName, bubbles: true, cancelable: true };
        el.focus();
        await delay(50);
        el.dispatchEvent(new KeyboardEvent('keydown', init));
        el.dispatchEvent(new KeyboardEvent('keypress', init));
        el.dispatchEvent(new KeyboardEvent('keyup', init));
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Visual confirmation flash
    el.classList.add('wp-playback');
    setTimeout(() => el.classList.remove('wp-playback'), 700);

    return { success: true };
  }

  function showProgress(index, total, description) {
    let bar = document.getElementById('webpilot-progress');
    if (!bar) {
      injectStyles();
      bar = document.createElement('div');
      bar.id = 'webpilot-progress';
      document.documentElement.appendChild(bar);
    }
    bar.innerHTML = `
      <div class="wp-step-num">Step ${index + 1} / ${total}</div>
      <div class="wp-step-desc">${description}</div>
    `;
    clearTimeout(bar._hideTimer);
    bar._hideTimer = setTimeout(() => bar.remove(), 2500);
  }

  async function selectComboOption(rootEl, optionText) {
    const text = String(optionText ?? '').trim();
    if (!text) return;

    // Focus + click to open the dropdown
    rootEl.focus?.();
    rootEl.click();
    await delay(100);

    const inputEl =
      (rootEl.matches('input,textarea,[role="combobox"]') ? rootEl : null) ??
      rootEl.querySelector('input,textarea,[role="combobox"],[contenteditable="true"]');

    const keyTarget = inputEl || rootEl;

    // Type the option text to filter the list
    if (inputEl) {
      if (inputEl.isContentEditable) {
        inputEl.textContent = text;
        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      } else {
        const setter =
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ??
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter && (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement)) {
          setter.call(inputEl, text);
        } else {
          inputEl.value = text;
        }
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // Wait for the dropdown to filter/render — AUI can be slow
    await delay(400);

    const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const target = normalize(text);

    // Search order:
    // 1. Standard [role="option"] (visible)
    // 2. AUI .aui-list-item anchor text (the visible label inside <a>)
    // 3. Broader li inside any aui-list
    const findOption = () => {
      // Standard ARIA options
      const ariaOption = Array.from(document.querySelectorAll('[role="option"]'))
        .find((n) => n.offsetParent !== null && normalize(n.textContent) === target);
      if (ariaOption) return ariaOption;

      // AUI list items — the clickable element is the <a> inside <li>
      const auiAnchor = Array.from(document.querySelectorAll('.aui-list-item a, [class*="aui-list"] li a'))
        .find((n) => n.offsetParent !== null && normalize(n.textContent) === target);
      if (auiAnchor) return auiAnchor;

      // AUI: partial match fallback (in case displayed text has extra whitespace)
      const auiPartial = Array.from(document.querySelectorAll('.aui-list-item a, [class*="aui-list"] li a'))
        .find((n) => n.offsetParent !== null && normalize(n.textContent).includes(target));
      if (auiPartial) return auiPartial;

      return null;
    };

    let option = findOption();

    // If still not visible, wait a bit longer (slow AUI XHR autocomplete)
    if (!option) {
      await delay(600);
      option = findOption();
    }

    if (option) {
      option.click();
      return;
    }

    // Last resort: press Enter on the filtered input
    const init = { key: 'Enter', bubbles: true, cancelable: true };
    keyTarget.dispatchEvent(new KeyboardEvent('keydown', init));
    keyTarget.dispatchEvent(new KeyboardEvent('keypress', init));
    keyTarget.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  function waitForElement(selector, timeoutMs) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.documentElement, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
})();
