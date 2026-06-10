// WebPilot popup — templates
(function (WP) {
  'use strict';
  // ---------------------------------------------------------------------------
  // Templates — load & render
  // ---------------------------------------------------------------------------
  WP.loadTemplates = async function() {
    const res = await WP.sendMsg({ type: 'GET_TEMPLATES' });
    WP.state.templates = res?.templates ?? {};
  }

  WP.renderTemplates = function() {
    const list = Object.values(WP.state.templates).sort(
      (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
    );

    WP.dom.templatesList.innerHTML = '';
    WP.dom.emptyTemplates.classList.toggle('hidden', list.length > 0);

    for (const tpl of list) {
      WP.dom.templatesList.appendChild(WP.buildTemplateItem(tpl));
    }
  }

  WP.buildTemplateItem = function(tpl) {
    const li = document.createElement('li');
    li.className = 'template-item';
    li.dataset.id = tpl.id;

    const date = new Date(tpl.createdAt ?? Date.now()).toLocaleDateString();
    const stepWord = tpl.steps.length !== 1 ? 'steps' : 'step';

    li.innerHTML = `
      <div class="template-card-top">
        <div class="template-card-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0067b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
        </div>
        <div class="template-body">
          <div class="template-name">${WP.esc(tpl.name)}</div>
          <div class="template-meta">${tpl.steps.length} ${stepWord} &middot; ${date}</div>
        </div>
      </div>
      <div class="template-actions">
        <button class="btn-play">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Run
        </button>
        <button class="btn-edit-tpl" title="Edit workflow">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
        ${`<button class="btn-json-tpl" title="Export / edit JSON">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          JSON
        </button>`}
        <button class="btn-danger">Delete</button>
      </div>
    `;

    li.querySelector('.btn-play').addEventListener('click', () => WP.openPlayPanel(tpl));
    li.querySelector('.btn-edit-tpl').addEventListener('click', () => WP.toggleTemplateEditor(tpl, li));
    li.querySelector('.btn-json-tpl')?.addEventListener('click', () => WP.openJsonModal(tpl));
    li.querySelector('.btn-danger').addEventListener('click', (e) => WP.confirmDeleteTemplate(tpl.id, e.currentTarget));
    return li;
  }

  // ---------------------------------------------------------------------------
  // JSON modal
  // ---------------------------------------------------------------------------
  WP.openJsonModal = function(tpl) {
    const modal  = document.getElementById('json-modal');
    const body   = document.getElementById('json-modal-body');
    const errMsg = document.getElementById('json-modal-error');
    if (!modal || !body) {
      alert('JSON viewer unavailable — please reload the extension in chrome://extensions');
      return;
    }

    body.value = JSON.stringify(tpl, null, 2);
    errMsg.classList.add('hidden');
    errMsg.textContent = '';
    modal.classList.remove('hidden');
    body.focus();

    const close = () => modal.classList.add('hidden');
    document.getElementById('json-modal-close').onclick  = close;
    document.getElementById('json-modal-close2').onclick = close;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        close();
      }
    }, { once: true });

    document.getElementById('json-modal-copy').onclick = async () => {
      await navigator.clipboard.writeText(body.value);
      const btn = document.getElementById('json-modal-copy');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = orig;
      }, 1500);
    };

    document.getElementById('json-modal-save').onclick = async () => {
      errMsg.classList.add('hidden');
      let parsed;
      try {
        parsed = JSON.parse(body.value);
      } catch (e) {
        errMsg.textContent = 'Invalid JSON: ' + e.message;
        errMsg.classList.remove('hidden');
        return;
      }
      if (!parsed.id || !Array.isArray(parsed.steps)) {
        errMsg.textContent = 'JSON must have "id" and "steps" fields.';
        errMsg.classList.remove('hidden');
        return;
      }
      await WP.saveEditedTemplate(parsed);
      close();
    };
  }

  // ---------------------------------------------------------------------------
  // Inline template editor
  // ---------------------------------------------------------------------------
  WP.toggleTemplateEditor = function(tpl, li) {
    const existing = li.querySelector('.tpl-editor');
    if (existing) {
      existing.remove(); li.classList.remove('editing'); return;
    }
    li.classList.add('editing');
    WP.openTemplateEditor(tpl, li);
  }

  WP.openTemplateEditor = function(tpl, li) {
    // Work on a deep copy so cancelling discards changes
    const draft = { ...tpl, steps: tpl.steps.map(s => ({ ...s })) };

    const editor = document.createElement('div');
    editor.className = 'tpl-editor';

    const renderEditorSteps = () => {
      stepsList.innerHTML = '';
      draft.steps.forEach((step, i) => stepsList.appendChild(WP.buildEditorStep(step, i, draft, renderEditorSteps)));
      emptyHint.classList.toggle('hidden', draft.steps.length > 0);
    };

    editor.innerHTML = `
      <div class="tpl-editor-header">
        <label class="edit-label">Workflow name</label>
        <input class="tpl-name-input" type="text" value="${WP.esc(draft.name)}" maxlength="80" />
      </div>
      <div class="tpl-editor-steps-header">
        <span class="edit-label">Steps</span>
        <div class="tpl-step-btns">
          <button class="btn-record-step tpl-rec-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            <span class="tpl-rec-label">Record Step</span>
          </button>
          <button class="btn-add-manual tpl-add-manual-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Step
          </button>
        </div>
      </div>
      <div class="tpl-rec-banner hidden">
        <span class="pulse-ring"></span>
        <span>Recording active — interact with the page, then click <strong>⏹ Stop</strong></span>
      </div>
      <ul class="tpl-steps-list"></ul>
      <div class="tpl-add-form hidden">
        <select class="add-form-action">
          <option value="click">click</option>
          <option value="type">type</option>
          <option value="select">select</option>
          <option value="key">key</option>
          <option value="navigate">navigate</option>
          <option value="wait">wait</option>
        </select>
        <input class="add-form-selector" placeholder="CSS selector" />
        <input class="add-form-value" placeholder="Value…" style="display:none" />
        <input class="add-form-label" placeholder="Label (optional)" />
        <button class="btn-gradient btn-xs add-form-ok">Add</button>
        <button class="btn-ghost-xs add-form-cancel">✕</button>
      </div>
      <div class="tpl-steps-empty hidden"><p>No steps yet — record or add steps manually.</p></div>
      <div class="tpl-editor-footer">
        <button class="btn-gradient btn-sm tpl-save">Save workflow</button>
        <button class="btn-ghost-sm tpl-cancel">Cancel</button>
      </div>
    `;

    const stepsList   = editor.querySelector('.tpl-steps-list');
    const emptyHint   = editor.querySelector('.tpl-steps-empty');
    const recBtn      = editor.querySelector('.tpl-rec-btn');
    const recLabel    = editor.querySelector('.tpl-rec-label');
    const recBanner   = editor.querySelector('.tpl-rec-banner');

    // ---- Add Step form ----
    const addBtn         = editor.querySelector('.tpl-add-manual-btn');
    const addForm        = editor.querySelector('.tpl-add-form');
    const addFormAction  = addForm.querySelector('.add-form-action');
    const addFormSel     = addForm.querySelector('.add-form-selector');
    const addFormVal     = addForm.querySelector('.add-form-value');
    const addFormLabel   = addForm.querySelector('.add-form-label');

    const NO_SELECTOR = new Set(['navigate', 'wait']);
    const NO_VALUE    = new Set(['click']);
    const VAL_PLACEHOLDERS = {
      type:     'Value, {{template}} (AI), or [[extracted.var]]…',
      select:   'Option text to select…',
      key:      'Key name (Enter, Tab, Escape, Space, Backspace…)',
      navigate: 'URL (https://…)',
      wait:     'Delay in ms (e.g. 1000)',
    };

    const syncAddFormFields = () => {
      const a = addFormAction.value;
      addFormSel.style.display = NO_SELECTOR.has(a) ? 'none' : '';
      addFormSel.placeholder   = a === 'key' ? 'CSS selector (optional)' : 'CSS selector';
      addFormVal.style.display = NO_VALUE.has(a) ? 'none' : '';
      addFormVal.placeholder   = VAL_PLACEHOLDERS[a] ?? 'Value…';
    };
    addFormAction.addEventListener('change', syncAddFormFields);
    syncAddFormFields();

    addBtn.addEventListener('click', () => {
      addForm.classList.toggle('hidden');
      if (!addForm.classList.contains('hidden')) {
        addFormSel.focus();
      }
    });

    addForm.querySelector('.add-form-cancel').addEventListener('click', () => {
      addForm.classList.add('hidden');
    });

    addForm.querySelector('.add-form-ok').addEventListener('click', () => {
      const action   = addFormAction.value;
      const selector = addFormSel.value.trim();
      const value    = addFormVal.value.trim();
      const label    = addFormLabel.value.trim();

      if (!NO_SELECTOR.has(action) && action !== 'key' && !selector) {
        addFormSel.focus(); return;
      }
      if (!NO_VALUE.has(action) && !value) {
        addFormVal.focus(); return;
      }

      const step = {
        action,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        description: label || [action, selector, value].filter(Boolean).join(' → '),
      };
      if (label)    {
        step.label    = label;
      }
      if (selector) {
        step.selector = selector;
      }
      if (value)    {
        step.value    = value;
      }

      draft.steps.push(step);
      addFormSel.value = ''; addFormVal.value = ''; addFormLabel.value = '';
      addForm.classList.add('hidden');
      syncAddFormFields();
      renderEditorSteps();
    });
    // ----------------------

    let editorRecording = false;

    recBtn.addEventListener('click', async () => {
      if (!editorRecording) {
        // Clear any leftover steps from the Record tab, then start recording.
        // noAutoNavigate=true prevents background from inserting a navigate step
        // just because STATE.steps was cleared — this is an edit, not a new recording.
        await WP.sendMsg({ type: 'CLEAR_STEPS' });
        WP.state.steps = [];
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const res = await WP.sendMsg({ type: 'START_RECORDING', tabId: tab.id, noAutoNavigate: true });
        if (!res?.success) {
          WP.showStatus(WP.dom.recordError, res?.error ?? 'Could not start recording', false);
          return;
        }
        editorRecording = true;
        WP.state.recording = true;
        recBtn.classList.add('recording');
        recLabel.textContent = '⏹ Stop Recording';
        recBanner.classList.remove('hidden');
      } else {
        // Stop and harvest the new steps into the draft
        const res = await WP.sendMsg({ type: 'STOP_RECORDING' });
        editorRecording = false;
        WP.state.recording = false;
        recBtn.classList.remove('recording');
        recLabel.textContent = 'Record Step';
        recBanner.classList.add('hidden');

        const newSteps = res?.steps ?? [];
        // Replace the tail of draft.steps with the final recorded steps.
        // Do NOT append — live updates via _onStepsUpdated already kept draft in
        // sync, so appending would duplicate every step.
        const origCount = tpl.steps.length;
        draft.steps = draft.steps.slice(0, origCount).concat(newSteps.map(s => ({ ...s })));
        // Clear from background so Record tab is clean
        await WP.sendMsg({ type: 'CLEAR_STEPS' });
        WP.state.steps = [];
        renderEditorSteps();
      }
    });

    // Live step updates while recording: append to draft as they come in
    editor._onStepsUpdated = (steps) => {
      if (!editorRecording) {
        return;
      }
      // Replace draft steps beyond original count with fresh background steps
      const origCount = tpl.steps.length;
      draft.steps = draft.steps.slice(0, origCount).concat(steps);
      renderEditorSteps();
    };

    editor.querySelector('.tpl-name-input').addEventListener('input', (e) => {
      draft.name = e.target.value;
    });

    editor.querySelector('.tpl-save').addEventListener('click', async () => {
      // Stop any active recording before saving
      if (editorRecording) {
        recBtn.click();
      }
      draft.name = editor.querySelector('.tpl-name-input').value.trim();
      if (!draft.name) {
        editor.querySelector('.tpl-name-input').focus(); return;
      }
      await WP.saveEditedTemplate(draft);
      editor.remove();
      li.classList.remove('editing');
    });

    editor.querySelector('.tpl-cancel').addEventListener('click', async () => {
      if (editorRecording) {
        await WP.sendMsg({ type: 'STOP_RECORDING' });
        await WP.sendMsg({ type: 'CLEAR_STEPS' });
        WP.state.recording = false;
        WP.state.steps = [];
      }
      editor.remove();
      li.classList.remove('editing');
    });

    li.appendChild(editor);
    renderEditorSteps();
    editor.querySelector('.tpl-name-input').focus();
  }

  WP.buildEditorStep = function(step, index, draft, refresh) {
    const li = document.createElement('li');
    li.className = 'tpl-step-row';
    li.dataset.index = index;

    const isType   = step.action === 'type';
    const isSelect = step.action === 'select';
    const isKey    = step.action === 'key';
    const isExtract = step.action === 'extract';
    const isNavigate = step.action === 'navigate';
    const isWait = step.action === 'wait';
    const isWaitFor = step.action === 'wait_for';
    const isAssert = step.action === 'assert' || step.action === 'assert_text';
    const actionBadge = step.action ?? 'action';
    const selectorHint = step.selector ?? '';
    const varName = step.suggestedVar;
    const alreadyVar = isType && step.value?.startsWith('{{');
    const isDate = step.fieldType === 'date';
    const ALL_EDITOR_ACTIONS = ['click', 'type', 'select', 'navigate', 'wait', 'wait_for', 'assert', 'assert_text', 'key', 'extract'];
    li.innerHTML = `
      <span class="tpl-drag-handle" title="Drag to reorder">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg>
      </span>
      <span class="tpl-step-num">${index + 1}</span>
      <div class="tpl-step-fields">
        <div class="tpl-step-action-row">
          <select class="tpl-action-select tpl-action-${WP.esc(actionBadge)}" title="Change action type">
            ${ALL_EDITOR_ACTIONS.map(a => `<option value="${a}"${a === actionBadge ? ' selected' : ''}>${a}</option>`).join('')}
          </select>
          ${isDate ? '<span class="tpl-date-badge" title="Calendar / date field">📅</span>' : ''}
          <input class="tpl-step-desc" type="text" value="${WP.esc(step.description ?? '')}" placeholder="Describe this step…" />
        </div>
        ${selectorHint ? `<div class="tpl-selector-chip" title="CSS selector — hover this step to highlight the element on the page"><code>${WP.esc(WP.shortSelector(selectorHint))}</code></div>` : ''}
        ${isType ? `
          <div class="tpl-val-row">
            <input class="tpl-step-val" type="text" value="${WP.esc(step.value ?? '')}" placeholder="${isDate ? 'Date value or {{template}} or [[extracted.var]] (e.g. YYYY-MM-DD)' : 'Value ({{template}} for AI or [[extracted.var]] for extraction)'}" />
            ${varName && !alreadyVar
      ? `<button class="var-suggest-btn tpl-var-btn" data-var="${WP.esc(varName)}">{{${WP.esc(varName)}}}</button>`
      : ''}
          </div>
        ` : ''}
        ${isSelect ? `
          <div class="tpl-val-row">
            <span class="tpl-select-icon">▾</span>
            <input class="tpl-step-val" type="text" value="${WP.esc(step.value ?? '')}" placeholder="Option to select…" />
          </div>
        ` : ''}
        ${isKey ? `
          <div class="tpl-val-row">
            <span class="tpl-key-icon" title="Key to press">⌨</span>
            <input class="tpl-step-val" type="text" value="${WP.esc(step.value ?? 'Enter')}" placeholder="Key name (Enter, Tab, Escape, Space…)" />
          </div>
        ` : ''}
        ${isNavigate ? `
          <div class="tpl-val-row">
            <span class="tpl-nav-icon" title="URL to navigate to">🔗</span>
            <input class="tpl-step-val" type="url" value="${WP.esc(step.value ?? '')}" placeholder="https://example.com" />
          </div>
        ` : ''}
        ${isWait ? `
          <div class="tpl-val-row">
            <input class="tpl-step-val" type="number" min="0" step="100" value="${WP.esc(step.value ?? '1000')}" placeholder="Delay ms" />
          </div>
        ` : ''}
        ${isWaitFor ? `
          <div class="tpl-val-row">
            <input class="tpl-step-val" type="number" min="0" step="100" value="${WP.esc(step.value ?? '15000')}" placeholder="Timeout ms (optional)" />
          </div>
        ` : ''}
        ${isAssert ? `
          <div class="tpl-val-row">
            <input class="tpl-step-val" type="text" value="${WP.esc(step.value ?? '')}" placeholder="${step.action === 'assert_text' ? 'Expected text' : 'Optional expected value'}" />
          </div>
        ` : ''}
        ${isExtract ? `
          <div class="tpl-extract-row">
            <div class="tpl-extract-field">
              <label class="tpl-extract-label">Variable</label>
              <input class="tpl-extract-var" type="text" value="${WP.esc(step.variable ?? '')}" placeholder="e.g. vehicle_title" />
            </div>
            <div class="tpl-extract-field">
              <label class="tpl-extract-label">Type</label>
              <select class="tpl-extract-type">
                <option value="text"${!step.extractType || step.extractType === 'text' ? ' selected' : ''}>Text</option>
                <option value="value"${step.extractType === 'value' ? ' selected' : ''}>Value</option>
              </select>
            </div>
          </div>
        ` : ''}
        ${selectorHint || step.elementHint ? `
          <div class="tpl-hint-wrap">
            <button type="button" class="tpl-hint-btn" tabindex="-1" aria-label="Element info">ⓘ</button>
            <div class="tpl-hint-popup">
              ${selectorHint ? `<div class="tpl-hint-row"><span class="tpl-hint-label">Selector</span><code>${WP.esc(selectorHint)}</code></div>` : ''}
              ${step.elementHint ? `<div class="tpl-hint-row"><span class="tpl-hint-label">DOM</span><code>${WP.esc(step.elementHint)}</code></div>` : ''}
            </div>
          </div>
        ` : ''}
        <div class="tpl-delay-row">
          <label class="tpl-delay-label">Delay after</label>
          <input class="tpl-step-delay" type="number" min="0" step="100" value="${step.delayMs ?? 600}" />
          <span class="tpl-delay-unit">ms</span>
        </div>
      </div>
      <div class="tpl-step-move-btns">
        <button class="btn-icon tpl-move-up" title="Move up" ${index === 0 ? 'disabled' : ''}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="btn-icon tpl-move-down" title="Move down" ${index === draft.steps.length - 1 ? 'disabled' : ''}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <button class="btn-icon tpl-step-del" title="Remove step">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    `;

    // Hover the step row → highlight the corresponding element on the active tab
    let _hlTab = null;
    li.addEventListener('mouseenter', async () => {
      if (!step.selector) {
        return;
      }
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          return;
        }
        _hlTab = tab.id;
        chrome.tabs.sendMessage(tab.id, {
          type: 'HIGHLIGHT_STEP_ELEMENT',
          selector: step.selector,
          action: step.action,
          description: step.description || step.label || '',
        }).catch(() => {});
      } catch (_) {}
    });
    li.addEventListener('mouseleave', () => {
      if (_hlTab === null) {
        return;
      }
      try {
        chrome.tabs.sendMessage(_hlTab, { type: 'UNHIGHLIGHT_STEP_ELEMENT' }).catch(() => {});
      } catch (_) {}
      _hlTab = null;
    });

    li.querySelector('.tpl-step-desc').addEventListener('input', (e) => {
      draft.steps[index].description = e.target.value;
    });
    const valInput = li.querySelector('.tpl-step-val');
    if (valInput) {
      valInput.addEventListener('input', (e) => {
        draft.steps[index].value = e.target.value;
      });
    }
    li.querySelector('.tpl-action-select').addEventListener('change', (e) => {
      draft.steps[index].action = e.target.value;
      if (!['type', 'select', 'navigate', 'key', 'wait', 'wait_for', 'assert', 'assert_text'].includes(e.target.value)) {
        delete draft.steps[index].value;
      }
      if (e.target.value !== 'extract') {
        delete draft.steps[index].variable;
        delete draft.steps[index].extractType;
      }
      refresh();
    });

    li.querySelector('.tpl-step-delay').addEventListener('change', (e) => {
      const v = parseInt(e.target.value, 10);
      draft.steps[index].delayMs = isNaN(v) || v < 0 ? 0 : v;
    });

    // Extract field listeners
    const extractVarInput = li.querySelector('.tpl-extract-var');
    if (extractVarInput) {
      extractVarInput.addEventListener('input', (e) => {
        draft.steps[index].variable = e.target.value;
      });
    }
    const extractTypeSelect = li.querySelector('.tpl-extract-type');
    if (extractTypeSelect) {
      extractTypeSelect.addEventListener('change', (e) => {
        draft.steps[index].extractType = e.target.value;
      });
    }

    // Variable suggestion button in editor
    li.querySelector('.tpl-var-btn')?.addEventListener('click', () => {
      const v = `{{${draft.steps[index].suggestedVar}}}`;
      draft.steps[index].value = v;
      draft.steps[index].description = `Type ${v} into "${draft.steps[index].label ?? draft.steps[index].selector}"`;
      refresh();
    });

    li.querySelector('.tpl-move-up').addEventListener('click', () => {
      if (index === 0) {
        return;
      }
      [draft.steps[index - 1], draft.steps[index]] = [draft.steps[index], draft.steps[index - 1]];
      refresh();
    });

    li.querySelector('.tpl-move-down').addEventListener('click', () => {
      if (index === draft.steps.length - 1) {
        return;
      }
      [draft.steps[index], draft.steps[index + 1]] = [draft.steps[index + 1], draft.steps[index]];
      refresh();
    });

    li.querySelector('.tpl-step-del').addEventListener('click', () => {
      draft.steps.splice(index, 1);
      refresh();
    });

    // Drag-to-reorder — only via the drag handle
    const handle = li.querySelector('.tpl-drag-handle');
    handle.addEventListener('mousedown', () => {
      li.draggable = true;
    });
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(index));
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => {
      li.draggable = false; li.classList.remove('dragging');
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault(); li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (from !== index) {
        const [moved] = draft.steps.splice(from, 1);
        draft.steps.splice(index, 0, moved);
        refresh();
      }
    });

    return li;
  }

  WP.saveEditedTemplate = async function(tpl) {
    const updated = { ...tpl, updatedAt: Date.now() };
    const res = await WP.sendMsg({ type: 'SAVE_TEMPLATE', template: updated });
    if (res?.success) {
      WP.state.templates[updated.id] = updated;
      WP.renderTemplates();
    }
  }
})(window.WebPilotPopup);
