// WebPilot content — recording-events
(function (WP) {
  'use strict';
  if (window.__webpilotSkipModules) {
    return;
  }
  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------
  WP.attachListeners = function() {
    WP.state.handlers.click = WP.onCapturingClick;
    WP.state.handlers.mouseover = WP.onMouseOver;
    WP.state.handlers.mouseout = WP.onMouseOut;
    WP.state.handlers.input = WP.onInput;
    WP.state.handlers.change = WP.onChange;
    WP.state.handlers.contextmenu = WP.onRecordingContextMenu;

    // Use bubble phase (false) so we observe without blocking any page interaction
    document.addEventListener('click',        WP.state.handlers.click,        false);
    document.addEventListener('mouseover',    WP.state.handlers.mouseover,    false);
    document.addEventListener('mouseout',     WP.state.handlers.mouseout,     false);
    document.addEventListener('input',        WP.state.handlers.input,        false);
    document.addEventListener('change',       WP.state.handlers.change,       false);
    document.addEventListener('contextmenu',  WP.state.handlers.contextmenu,  false);
  };

  WP.detachListeners = function() {
    document.removeEventListener('click',        WP.state.handlers.click,        false);
    document.removeEventListener('mouseover',    WP.state.handlers.mouseover,    false);
    document.removeEventListener('mouseout',     WP.state.handlers.mouseout,     false);
    document.removeEventListener('input',        WP.state.handlers.input,        false);
    document.removeEventListener('change',       WP.state.handlers.change,       false);
    document.removeEventListener('contextmenu',  WP.state.handlers.contextmenu,  false);
  };

  WP.isWebPilotEl = function(el) {
    if (!el) {
      return false;
    }
    // Check overlay
    if (el === WP.state.overlayRoot || WP.state.overlayRoot?.contains(el)) {
      return true;
    }
    // Check extract modal
    const modal = document.getElementById('webpilot-extract-modal');
    if (el === modal || modal?.contains(el)) {
      return true;
    }
    return false;
  };

  /**
     * Returns true for elements where the expected interaction is typing,
     * so a click on them should not immediately finish single-step capture.
     */
  WP.isTypeable = function(el) {
    if (!el) {
      return false;
    }
    if (el.isContentEditable) {
      return true;
    }
    // Also catch clicks on children inside a contenteditable (e.g. <p> inside Jira editor)
    if (el.closest?.('[contenteditable="true"]')) {
      return true;
    }
    const tag = el.tagName;
    if (tag === 'SELECT') {
      return true;
    }
    if (tag === 'TEXTAREA') {
      return true;
    }
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      return ['text', 'email', 'password', 'search', 'tel', 'url',
        'number', 'date', 'datetime-local', 'time', 'month', 'week'].includes(t);
    }
    // Container divs that wrap a rich-text editor (e.g. Jira's div.jira-wikifield):
    // clicking them should not produce a 'click' step — the inner editor will capture typing.
    if (tag === 'DIV' || tag === 'SPAN' || tag === 'SECTION' || tag === 'ARTICLE') {
      if (el.querySelector?.('[contenteditable="true"]')) {
        return true;
      }
      if (el.querySelector?.('textarea')) {
        return true;
      }
    }
    return false;
  };

  WP.onMouseOver = function(e) {
    if (!WP.state.isRecording || WP.isWebPilotEl(e.target)) {
      return;
    }
    WP.setHoverHighlight(e.target);
  };

  WP.onMouseOut = function(e) {
    if (!WP.state.isRecording) {
      return;
    }
    e.target.classList.remove('wp-hover');
    if (WP.state.hoveredEl === e.target) {
      WP.state.hoveredEl = null;
    }
  };

  WP.onCapturingClick = function(e) {
    if (!WP.state.isRecording || WP.isWebPilotEl(e.target)) {
      return;
    }
    // Never block — let the click reach the page normally

    const el = e.target;

    // Clicks inside native <select> (including options) — only the change event becomes a select step.
    if (el.tagName === 'OPTION' || el.closest?.('select')) {
      WP.flashRecorded(el.closest?.('select') || el);
      return;
    }

    // Remove highlight classes before building selector so they're never captured
    WP.clearHighlight();
    el.classList.remove('wp-hover', 'wp-recorded');

    const selector = WP.buildSelector(el);
    const label = WP.getLabel(el);

    // Clicking a typeable field is just a focus action — typing will be captured via onInput
    if (WP.isTypeable(el)) {
      WP.flashRecorded(el);
      return;
    }

    // Detect a click inside a calendar/date-picker popup (e.g. clicking a day cell)
    const calendarCtx = WP.getCalendarContainer(el);
    if (calendarCtx) {
      WP.flashRecorded(el);
      // Let the click land, then capture whatever date value was written to the input
      setTimeout(() => {
        const dateEl = WP.findDateInputNear(calendarCtx);
        if (dateEl) {
          WP.sendDateAction(dateEl, WP.buildSelector(dateEl));
        } else {
          // Fallback: record as a plain click
          const name = label || WP.labelFromSelector(selector);
          WP.safeSend({
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
        const sel = WP.buildSelector(targetEl);
        // Get the option text — prefer the element's own trimmed text,
        // but for AUI list-items the anchor child holds the visible text.
        const optionText =
            (optionEl.tagName === 'A' ? optionEl : optionEl.querySelector('a'))?.textContent?.trim() ||
            optionEl.textContent?.trim() ||
            '';
          // Cancel any pending debounced type step for this combobox so we don't
          // get both a 'type' step (from user filtering) and a 'select' step.
        const existingTimer = WP.state.inputTimers.get(sel);
        if (existingTimer) {
          clearTimeout(existingTimer.tid);
          WP.state.inputTimers.delete(sel);
        }
        const lbl = WP.getLabel(targetEl) || WP.labelFromSelector(sel);
        WP.flashRecorded(optionEl);
        WP.safeSend({
          type: 'RECORD_ACTION',
          action: {
            action: 'select',
            selector: sel,
            value: optionText,
            label: lbl,
            description: `Select "${optionText}" in ${lbl}`,
            elementHint: WP.elementHint(targetEl),
          },
        });
        return;
      }
    }

    WP.flashRecorded(el);

    const name = label || WP.labelFromSelector(selector);
    WP.recordAction(el, { action: 'click', selector, label: name, description: name, elementHint: WP.elementHint(el) });
  };

  /**
     * Send a TYPE action to the background with the current field value.
     * Extracted so WP.stopRecording() can flush pending timers with the live value.
     */
  WP.sendInputAction = function(el, selector) {
    if (!el || el.tagName === 'SELECT' || el.closest?.('select')) {
      return;
    }
    if (el.type === 'checkbox' || el.type === 'radio') {
      return;
    }
    // For contenteditable elements use textContent; for inputs use .value
    const value = el.isContentEditable
      ? (el.textContent ?? '')
      : (el.value ?? '');
    const label = WP.getLabel(el) || WP.labelFromSelector(selector);
    // Derive a {{variableName}} suggestion from the field label
    const suggestedVar = WP.labelToVarName(label);
    WP.recordAction(el, {
      action: 'type',
      selector,
      value,
      label,
      description: label,
      suggestedVar,
      elementHint: WP.elementHint(el),
      isContentEditable: el.isContentEditable || undefined,
    });

    // If the value contains extracted variable references, resolve and apply them
    // to the element for real-time preview during recording
    if (value && value.includes('[[extracted.')) {
      WP.resolveAndApplyExtractedVariables(el, value);
    }
  };

  /**
     * Resolve extracted variables and apply the resolved value to an element
     * Provides real-time visual feedback during recording
     */
  WP.resolveAndApplyExtractedVariables = async function(el, valueTemplate) {
    try {
      let resolvedValue = valueTemplate;
      const extractedMatches = valueTemplate.match(/\[\[extracted\.([a-zA-Z_][a-zA-Z0-9_]*)\]\]/g) || [];

      // Resolve each extracted variable
      for (const match of extractedMatches) {
        const varName = match.replace(/^\[\[extracted\.|\]\]$/g, '');
        const extractedValue = WP.getExtractedValue(varName);

        if (extractedValue !== undefined && extractedValue !== null) {
          resolvedValue = resolvedValue.replace(match, String(extractedValue));
        }
      }

      // Apply the resolved value to the element
      if (el.isContentEditable) {
        el.textContent = resolvedValue;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value = resolvedValue;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // eslint-disable-next-line no-console
      console.log(`[WebPilot] Resolved and applied extracted variables: ${resolvedValue.substring(0, 50)}`);
    } catch (err) {
      // Silent fail — recording still works with template string
      // eslint-disable-next-line no-console
      console.log('[WebPilot] Could not resolve extracted variables during recording:', err.message);
    }
  };

  /**
     * Build a short, human-readable description of a DOM element for display in the step list.
     * Examples:  BUTTON  |  INPUT[type=text][name=summary]  |  A[href=/issues]  |  DIV[role=button]
     */
  WP.elementHint = function(el) {
    if (!el) {
      return '';
    }
    const tag = el.tagName.toUpperCase();
    const attrs = [];
    if (el.type && el.tagName === 'INPUT') {
      attrs.push(`type=${el.type}`);
    }
    if (el.name)  {
      attrs.push(`name=${el.name}`);
    }
    if (el.id)    {
      attrs.push(`#${el.id}`);
    }
    const role = el.getAttribute('role');
    if (role)     {
      attrs.push(`role=${role}`);
    }
    if (el.isContentEditable) {
      attrs.push('contenteditable');
    }
    return attrs.length ? `${tag}[${attrs.join('][')}]` : tag;
  };

  /**
     * Convert a human-readable field label into a camelCase variable name.
     * E.g. "Summary *" → "summary", "Issue Description" → "issueDescription"
     */
  WP.labelToVarName = function(label) {
    return label
      .replace(/[^a-zA-Z0-9 ]/g, '')   // strip special chars / asterisks
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join('') || 'value';
  };

  WP.onInput = function(e) {
    if (!WP.state.isRecording || WP.isWebPilotEl(e.target)) {
      return;
    }
    // Native date fields emit 'change' (not 'input') when picked — skip here to avoid duplicates
    if (WP.isDateField(e.target)) {
      return;
    }
    // For contenteditable children, target the root editable element
    const el = e.target.isContentEditable
      ? e.target
      : (e.target.closest?.('[contenteditable="true"]') ?? e.target);
    if (el.type === 'checkbox' || el.type === 'radio') {
      return;
    }
    if (el.tagName === 'SELECT' || el.closest?.('select')) {
      return;
    }
    const selector = WP.buildSelector(el);

    const existing = WP.state.inputTimers.get(selector);
    if (existing) {
      clearTimeout(existing.tid);
    }

    const tid = setTimeout(() => {
      WP.state.inputTimers.delete(selector);
      WP.sendInputAction(el, selector);
    }, 700);

    WP.state.inputTimers.set(selector, { tid, el, selector });
  };

  WP.onChange = function(e) {
    if (!WP.state.isRecording || WP.isWebPilotEl(e.target)) {
      return;
    }
    const el = e.target;

    if (el.tagName === 'SELECT') {
      const selector = WP.buildSelector(el);
      const value = el.value;
      const label = WP.getLabel(el) || WP.labelFromSelector(selector);
      WP.recordAction(el, {
        action: 'select',
        selector,
        value,
        label,
        description: label,
        elementHint: WP.elementHint(el),
      });
      return;
    }

    // Jira/Atlassian and other modern UIs often use combobox widgets instead of
    // native <select>. Record these as 'select' too so variable substitution can
    // target them just like normal dropdowns.
    if (WP.isComboBoxInput(el)) {
      const selector = WP.buildSelector(el);
      if (WP.state.inputTimers.has(selector)) {
        clearTimeout(WP.state.inputTimers.get(selector).tid);
        WP.state.inputTimers.delete(selector);
      }
      const value = (el.value ?? el.textContent ?? '').trim();
      const label = WP.getLabel(el) || WP.labelFromSelector(selector);
      WP.safeSend({
        type: 'RECORD_ACTION',
        action: { action: 'select', selector, value, label, description: label, elementHint: WP.elementHint(el) },
      });
      return;
    }

    // Native date/time inputs fire 'change' when the user picks from the browser date picker
    if (WP.isDateField(el)) {
      const selector = WP.buildSelector(el);
      // Cancel any pending debounced input for this element to avoid duplicates
      if (WP.state.inputTimers.has(selector)) {
        clearTimeout(WP.state.inputTimers.get(selector).tid);
        WP.state.inputTimers.delete(selector);
      }
      WP.sendDateAction(el, selector);
    }
  };

  WP.onRecordingContextMenu = function(e) {
    if (!WP.state.isRecording) {
      return;
    }
    const targetEl = e.target;
    if (WP.isWebPilotEl(targetEl)) {
      return;
    }
    // Do NOT preventDefault — let the native browser menu open.
    // The "WebPilot: Extract…" / "WebPilot: Fill…" items are registered via
    // chrome.contextMenus in the background script and will trigger
    // SHOW_EXTRACT_MODAL when clicked.
  };

  WP.showExtractModal = function(targetEl, initialMode = 'extract') {
    // Remove any existing modal
    const existingModal = document.getElementById('webpilot-extract-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // Generate a suggested variable name from the element
    const suggestedVarName = WP.generateVariableName(targetEl);

    // Get all available variables (extracted + recorded extract steps)
    WP.getAvailableVariablesForFilling((availableVars) => {
      const hasVars = availableVars.length > 0;
      // Start on Fill tab when requested AND variables exist; otherwise Extract
      const startTab = (initialMode === 'fill' && hasVars) ? 'fill' : 'extract';

      const modal = document.createElement('div');
      modal.id = 'webpilot-extract-modal';
      modal.innerHTML = `
          <div class="wp-extract-overlay">
            <div class="wp-extract-panel">
              <div class="wp-extract-header">
                <div class="wp-extract-tabs">
                  <button class="wp-tab-btn${startTab === 'extract' ? ' wp-tab-active' : ''}" data-tab="extract">Extract variable</button>
                  <button class="wp-tab-btn${startTab === 'fill'    ? ' wp-tab-active' : ''}" data-tab="fill">Fill with variable</button>
                </div>
                <button class="wp-extract-close" type="button" aria-label="Close">×</button>
              </div>

              <!-- EXTRACT TAB -->
              <div class="wp-tab-pane${startTab === 'extract' ? ' wp-tab-pane-active' : ''}" data-pane="extract">
                <div class="wp-extract-body">
                  <div class="wp-extract-field">
                    <label class="wp-extract-label">Variable name</label>
                    <input class="wp-extract-var-input" type="text" placeholder="e.g., product_title" value="${suggestedVarName}" />
                  </div>
                  <div class="wp-extract-field">
                    <label class="wp-extract-label">Extract type</label>
                    <div class="wp-extract-type-group">
                      <label class="wp-extract-radio"><input type="radio" name="extractType" value="text" checked /><span>Text content</span><span class="wp-tip" data-tip="Reads the visible text rendered inside any element — &lt;div&gt;, &lt;span&gt;, &lt;p&gt;, &lt;button&gt;, etc.">?</span></label>
                      <label class="wp-extract-radio"><input type="radio" name="extractType" value="value" /><span>Input value</span><span class="wp-tip" data-tip="Reads the typed or selected value from a form control — &lt;input&gt;, &lt;textarea&gt;, &lt;select&gt;.">?</span></label>
                    </div>
                  </div>
                </div>
                <div class="wp-extract-footer">
                  <button class="wp-extract-btn-cancel" type="button">Cancel</button>
                  <button class="wp-extract-btn-extract" type="button">Extract</button>
                </div>
              </div>

              <!-- FILL TAB -->
              <div class="wp-tab-pane${startTab === 'fill' ? ' wp-tab-pane-active' : ''}" data-pane="fill">
                <div class="wp-extract-body">
                  <div class="wp-extract-field">
                    <label class="wp-extract-label">Choose EXTRACTED variable to insert</label>
                    <div class="wp-extract-vars-list">
                      ${hasVars
    ? availableVars.map(([varName, value]) => `
                          <button class="wp-extract-var-btn" type="button" data-var="${varName}">
                            <span class="wp-var-name">[[extracted.${varName}]]</span>
                            <span class="wp-var-value">${value === null ? '(pending extraction)' : String(value ?? '').slice(0, 35)}</span>
                          </button>`).join('')
    : '<span class="wp-no-vars">No variables defined yet — extract one first.</span>'
  }
                    </div>
                  </div>
                </div>
                <div class="wp-extract-footer">
                  <button class="wp-extract-btn-cancel" type="button">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        `;

      document.body.appendChild(modal);

      const varInput         = modal.querySelector('.wp-extract-var-input');
      const extractTypeRadios = modal.querySelectorAll('input[name="extractType"]');
      const closeBtn         = modal.querySelector('.wp-extract-close');

      // Prevent events inside the modal from bubbling up to recording WP.state.handlers
      modal.addEventListener('click',  (e) => e.stopPropagation());
      modal.addEventListener('input',  (e) => e.stopPropagation());
      modal.addEventListener('change', (e) => e.stopPropagation());
      modal.addEventListener('keydown',(e) => e.stopPropagation());

      const cleanup = () => modal.remove();

      // Tab switching
      modal.querySelectorAll('.wp-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          modal.querySelectorAll('.wp-tab-btn').forEach(b => b.classList.remove('wp-tab-active'));
          modal.querySelectorAll('.wp-tab-pane').forEach(p => p.classList.remove('wp-tab-pane-active'));
          btn.classList.add('wp-tab-active');
          modal.querySelector(`.wp-tab-pane[data-pane="${btn.dataset.tab}"]`).classList.add('wp-tab-pane-active');
          if (btn.dataset.tab === 'extract') {
            varInput?.focus(); varInput?.select();
          }
        });
      });

      closeBtn.addEventListener('click', cleanup);
      modal.querySelectorAll('.wp-extract-btn-cancel').forEach(b => b.addEventListener('click', cleanup));

      // --- Extract action ---
      const doExtract = () => {
        const varName = varInput.value.trim();
        if (!varName) {
          varInput.focus(); varInput.select(); return;
        }
        const extractType = Array.from(extractTypeRadios).find(r => r.checked)?.value || 'text';
        const selector    = WP.buildSelector(targetEl);
        const label       = WP.getLabel(targetEl) || WP.labelFromSelector(selector);
        WP.safeSend({
          type: 'RECORD_ACTION',
          action: { action: 'extract', selector, variable: varName, extractType, label,
            description: `Extract ${extractType} → {{${varName}}}`,
            elementHint: WP.elementHint(targetEl) },
        });
        WP.flashRecorded(targetEl);
        cleanup();
      };
      modal.querySelector('.wp-extract-btn-extract')?.addEventListener('click', doExtract);
      varInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          doExtract();
        }
        if (e.key === 'Escape') {
          cleanup();
        }
      });

      // --- Fill action ---
      modal.querySelectorAll('.wp-extract-var-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const varName  = btn.getAttribute('data-var');
          const selector = WP.buildSelector(targetEl);
          const label    = WP.getLabel(targetEl) || WP.labelFromSelector(selector);
          WP.safeSend({
            type: 'RECORD_ACTION',
            action: { action: 'type', selector, value: `[[extracted.${varName}]]`, label,
              description: `Fill with [[extracted.${varName}]]`,
              elementHint: WP.elementHint(targetEl) },
          });
          WP.flashRecorded(targetEl);
          cleanup();
        });
      });

      // Keyboard dismiss from overlay background
      modal.querySelector('.wp-extract-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
          cleanup();
        }
      });

      // Auto-focus
      if (startTab === 'extract') {
        varInput?.focus(); varInput?.select();
      }
    });
  };
})(window.WebPilotContent);
