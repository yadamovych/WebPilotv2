// WebPilot — Content Script
// Runs in the context of every web page.
// Responsibilities:
//   • Capture user actions during recording (click / type / select / navigate)
//   • Show a recording overlay with step highlights
//   • Execute playback steps injected by the background service worker

(function () {
  'use strict';

  // Guard against double-injection on dynamic page navigations
  if (window.__webpilotLoaded) return;
  window.__webpilotLoaded = true;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let isRecording = false;
  let overlayRoot = null;
  let hoveredEl = null;

  // Map<selector, { tid: number, el: Element }> — debounce timers for input events
  const inputTimers = new Map();

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
        executeStep(message.step, message.index, message.total)
          .then((result) => sendResponse({ success: true, result }))
          .catch((err) => sendResponse({ error: err.message }));
        return true; // async

      case 'GET_RECORDING_STATE':
        sendResponse({ isRecording });
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

    // Use bubble phase (false) so we observe without blocking any page interaction
    document.addEventListener('click',     handlers.click,     false);
    document.addEventListener('mouseover', handlers.mouseover, false);
    document.addEventListener('mouseout',  handlers.mouseout,  false);
    document.addEventListener('input',     handlers.input,     false);
    document.addEventListener('change',    handlers.change,    false);
  }

  function detachListeners() {
    document.removeEventListener('click',     handlers.click,     false);
    document.removeEventListener('mouseover', handlers.mouseover, false);
    document.removeEventListener('mouseout',  handlers.mouseout,  false);
    document.removeEventListener('input',     handlers.input,     false);
    document.removeEventListener('change',    handlers.change,    false);
  }

  function isWebPilotEl(el) {
    return el === overlayRoot || overlayRoot?.contains(el);
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

  /** Returns true for native date/time input types handled by the browser's date picker. */
  function isDateField(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const t = (el.type || '').toLowerCase();
    return ['date', 'datetime-local', 'time', 'month', 'week'].includes(t);
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
  function buildSelector(el) {
    if (!el || el === document.body) return 'body';

    // Stable attribute priority list
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return `#${el.id}`;
    if (el.dataset?.testid) return `[data-testid="${CSS.escape(el.dataset.testid)}"]`;
    if (el.dataset?.cy) return `[data-cy="${CSS.escape(el.dataset.cy)}"]`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `[aria-label="${CSS.escape(ariaLabel)}"]`;

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
    // Prefer explicit accessible names first
    const ariaLabel = el.getAttribute('aria-label')?.trim();
    if (ariaLabel) return ariaLabel;

    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
      if (text) return text;
    }

    // Associated <label> element
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent.trim().slice(0, 60);
    }

    // Parent <label> wrapping this element
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const text = parentLabel.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60);
      if (text) return text;
    }

    const title = el.getAttribute('title')?.trim();
    if (title) return title;

    const placeholder = el.getAttribute('placeholder')?.trim();
    if (placeholder) return placeholder;

    const name = el.getAttribute('name')?.trim();
    if (name) return name;

    // Button / link / element text content
    const text = el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (text && text.length > 0) return text;

    // value attribute (e.g. submit buttons)
    const val = el.getAttribute('value')?.trim();
    if (val) return val;

    return '';
  }

  /**
   * Extract a label from an already-built CSS selector string.
   * E.g. `[aria-label="Search inventory"]` → "Search inventory"
   * Used as a last-resort fallback when getLabel() returns empty.
   */
  function labelFromSelector(selector) {
    // Try aria-label attribute in the selector
    const m = selector.match(/\[aria-label=["']?([^"'\]]+)["']?\]/);
    if (m) return m[1].replace(/\\/g, '').trim();
    // Try #id
    const id = selector.match(/#([\w-]+)/);
    if (id) return id[1].replace(/-/g, ' ');
    return selector;
  }

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------
  async function executeStep(step, index, total) {
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

    const el = await waitForElement(selector, 6000);
    if (!el) throw new Error(`Element not found: ${selector}`);

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(200);

    switch (action) {
      case 'click':
        el.click();
        break;

      case 'type': {
        el.focus();
        await delay(50);

        if (el.isContentEditable) {
          // contenteditable (e.g. Jira rich-text editor, ProseMirror, Quill)
          // Select all existing content and replace with typed value
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          selection.removeAllRanges();
          selection.addRange(range);
          // Use execCommand for broad framework compatibility
          document.execCommand('insertText', false, value ?? '');
          // Fallback: set textContent if execCommand had no effect
          if (el.textContent !== (value ?? '')) {
            el.textContent = value ?? '';
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value ?? '' }));
          }
        } else {
          // Regular <input> / <textarea>
          const nativeSetter =
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeSetter && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
            nativeSetter.call(el, value ?? '');
          } else {
            el.value = value ?? '';
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        break;
      }

      case 'select':
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        break;

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
