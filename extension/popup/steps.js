// WebPilot popup — steps
(function (WP) {
  'use strict';
  // ---------------------------------------------------------------------------
  // Steps rendering
  // ---------------------------------------------------------------------------
  WP.renderSteps = function() {
    const hasSteps = WP.state.steps.length > 0;

    WP.dom.stepsCount.textContent = `${WP.state.steps.length} step${WP.state.steps.length !== 1 ? 's' : ''}`;
    WP.dom.emptyRecord.classList.toggle('hidden', hasSteps);
    WP.dom.stepsList.innerHTML = '';
    WP.state.steps.forEach((step, i) => WP.dom.stepsList.appendChild(WP.buildStepItem(step, i)));
  };

  WP.buildStepItem = function(step, index) {
    const li = document.createElement('li');
    li.className = 'step-item';
    li.dataset.index = index;

    const isType   = step.action === 'type';
    const isSelect = step.action === 'select';
    const isExtract = step.action === 'extract';
    const hasExtractedVal = step.value && /\[\[extracted\.\w+\]\]/.test(step.value);
    const varName = step.suggestedVar;
    const alreadyVar = isType && step.value?.startsWith('{{');
    const quality = step.selectorQuality;
    const isDate = step.fieldType === 'date';
    const hint = step.elementHint ?? step.selector ?? '';
    const isAutoNav = step.auto === true;

    li.innerHTML = `
      <span class="step-drag-handle" title="Drag to reorder">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg>
      </span>
      <div class="step-num">${index + 1}</div>
      <div class="step-info">
        <span class="step-action step-action-${WP.esc(step.action ?? 'action')} ${isDate ? 'step-action-date' : ''}">${WP.esc(step.action)}</span>
        ${isAutoNav ? '<span class="step-auto-badge" title="Auto-recorded (navigate on start or tab switch)">auto</span>' : ''}
        ${isDate ? '<span class="step-field-badge date-badge" title="Calendar / date field">📅</span>' : ''}
        ${isExtract ? `<span class="step-extract-badge" title="Extract to variable">📋 {{${WP.esc(step.variable ?? 'var')}}}</span>` : ''}
        ${hasExtractedVal ? '<span class="step-var-badge extracted">extracted</span>' : ''}
        ${alreadyVar ? '<span class="step-var-badge ai">AI var</span>' : ''}
        ${quality === 'fragile' ? '<span class="step-quality-badge fragile" title="Fragile selector">⚠ fragile</span>' : ''}
        ${quality === 'stable' ? '<span class="step-quality-badge stable" title="Stable selector">✓ stable</span>' : ''}
        ${isSelect && step.value ? `<span class="step-select-badge">▾ ${WP.esc(step.value)}</span>` : ''}
        <div class="step-desc" title="${WP.esc(step.description ?? step.selector ?? '')}">${WP.esc(step.description ?? step.selector ?? '')}</div>
        ${hint ? `<div class="step-element-hint" title="${WP.esc(hint)}">${WP.esc(hint)}</div>` : ''}
        ${isType && varName && !alreadyVar ? `<button class="var-suggest-btn" data-var="${WP.esc(varName)}" title="Use as AI variable">Use <strong>{{${WP.esc(varName)}}}</strong></button>` : ''}
        ${isType && alreadyVar ? `<span class="var-active-badge">${WP.esc(step.value)}</span>` : ''}
      </div>
      <div class="step-btns">
        <button class="btn-icon" data-action="edit" title="Edit step">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon" data-action="delete" title="Delete step">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    `;

    // Accept variable suggestion
    li.querySelector('.var-suggest-btn')?.addEventListener('click', () => {
      WP.state.steps[index].value = `{{${varName}}}`;
      WP.state.steps[index].description = `Type {{${varName}}} into "${step.label ?? step.selector}"`;
      WP.renderSteps();
      // Persist to background
      WP.sendMsgSafe({ type: 'UPDATE_STEPS', steps: WP.state.steps });
    });

    li.querySelector('[data-action="edit"]').addEventListener('click', () => WP.editStep(index, li));
    li.querySelector('[data-action="delete"]').addEventListener('click', () => {
      WP.state.steps.splice(index, 1);
      WP.sendMsgSafe({ type: 'UPDATE_STEPS', steps: WP.state.steps });
      WP.renderSteps();
    });

    // Drag-to-reorder — only via the drag handle
    const handle = li.querySelector('.step-drag-handle');
    handle.addEventListener('mousedown', () => {
      li.draggable = true;
    });
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(index));
    });
    li.addEventListener('dragend', () => {
      li.draggable = false;
    });
    li.addEventListener('dragover',  (e) => {
      e.preventDefault(); li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', ()  => li.classList.remove('drag-over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (from !== index) {
        const [moved] = WP.state.steps.splice(from, 1);
        WP.state.steps.splice(index, 0, moved);
        WP.sendMsgSafe({ type: 'UPDATE_STEPS', steps: WP.state.steps });
        WP.renderSteps();
      }
    });

    return li;
  };

  WP.editStep = function(index, liEl) {
    const step = WP.state.steps[index];

    // Toggle: if form already open, close it
    const existing = liEl.querySelector('.step-edit-form');
    if (existing) {
      existing.remove(); return;
    }

    const ALL_ACTIONS = ['click', 'type', 'select', 'navigate', 'wait', 'wait_for', 'assert', 'assert_text', 'key', 'extract'];
    const actionHasValue = (a) => ['type', 'select', 'navigate', 'wait', 'wait_for', 'key', 'assert', 'assert_text'].includes(a);
    const actionHasVariable = (a) => a === 'extract';
    const getValueLabel = (a) => {
      if (a === 'navigate') {
        return 'URL';
      }
      if (a === 'key')      {
        return 'Key';
      }
      if (a === 'select')   {
        return 'Option';
      }
      if (a === 'wait') {
        return 'Delay (ms)';
      }
      if (a === 'wait_for') {
        return 'Timeout (ms)';
      }
      if (a === 'assert_text') {
        return 'Expected text';
      }
      if (a === 'assert') {
        return 'Expected value (optional)';
      }
      return 'Value <span class="label-hint">({{template}} for AI variables or [[extracted.var]] for page extraction)</span>';
    };
    const getValuePlaceholder = (a) => {
      if (a === 'navigate') {
        return 'https://example.com';
      }
      if (a === 'key')      {
        return 'Enter, Tab, Escape, Space…';
      }
      if (a === 'select')   {
        return 'Option to select…';
      }
      if (a === 'wait') {
        return '1000';
      }
      if (a === 'wait_for') {
        return '15000';
      }
      if (a === 'assert_text') {
        return 'Expected visible text';
      }
      return '';
    };

    const curAction = step.action ?? 'click';
    const form = document.createElement('div');
    form.className = 'step-edit-form';
    form.innerHTML = `
      <label class="edit-label">Action</label>
      <select class="edit-action">
        ${ALL_ACTIONS.map(a => `<option value="${a}"${a === curAction ? ' selected' : ''}>${a}</option>`).join('')}
      </select>
      <label class="edit-label">Description</label>
      <input class="edit-desc" type="text" value="${WP.esc(step.description ?? '')}" />
      <div class="edit-val-group"${actionHasValue(curAction) ? '' : ' style="display:none"'}>
        <label class="edit-label edit-val-label">${getValueLabel(curAction)}</label>
        <input class="edit-val" type="${curAction === 'navigate' ? 'url' : 'text'}" placeholder="${getValuePlaceholder(curAction)}" value="${WP.esc(step.value ?? '')}" />
      </div>
      <div class="edit-var-group"${actionHasVariable(curAction) ? '' : ' style="display:none"'}>
        <label class="edit-label">Variable Name</label>
        <input class="edit-var" type="text" placeholder="e.g., vehicle_title" value="${WP.esc(step.variable ?? '')}" />
        <label class="edit-label">Extract Type</label>
        <select class="edit-extract-type">
          <option value="text"${!step.extractType || step.extractType === 'text' ? ' selected' : ''}>Text Content</option>
          <option value="value"${step.extractType === 'value' ? ' selected' : ''}>Input Value</option>
        </select>
      </div>
      <div class="edit-btns">
        <button class="btn-gradient btn-sm save-edit">Save</button>
        <button class="btn-ghost-sm cancel-edit">Cancel</button>
      </div>
    `;
    liEl.appendChild(form);

    const actionSel = form.querySelector('.edit-action');
    const valGroup  = form.querySelector('.edit-val-group');
    const valLabel  = form.querySelector('.edit-val-label');
    const valInput  = form.querySelector('.edit-val');
    const varGroup  = form.querySelector('.edit-var-group');
    const varInput  = form.querySelector('.edit-var');
    const extractTypeSelect = form.querySelector('.edit-extract-type');

    actionSel.addEventListener('change', () => {
      const a = actionSel.value;
      const showVal = actionHasValue(a);
      const showVar = actionHasVariable(a);
      valGroup.style.display = showVal ? '' : 'none';
      varGroup.style.display = showVar ? '' : 'none';
      if (showVal) {
        valLabel.innerHTML = getValueLabel(a);
        valInput.placeholder = getValuePlaceholder(a);
        valInput.type = a === 'navigate' ? 'url' : 'text';
      }
    });

    form.querySelector('.edit-desc').focus();

    form.querySelector('.cancel-edit').addEventListener('click', () => form.remove());
    form.querySelector('.save-edit').addEventListener('click', () => {
      const action = actionSel.value;
      const desc   = form.querySelector('.edit-desc').value;
      const val    = actionHasValue(action) ? (valInput.value ?? '') : undefined;
      const variable = actionHasVariable(action) ? (varInput.value ?? '') : undefined;
      const extractType = actionHasVariable(action) ? (extractTypeSelect.value ?? 'text') : undefined;

      WP.state.steps[index] = { ...step, action, description: desc };
      if (val !== undefined) {
        WP.state.steps[index].value = val;
      }
      if (variable !== undefined) {
        WP.state.steps[index].variable = variable;
      }
      if (extractType !== undefined) {
        WP.state.steps[index].extractType = extractType;
      }
      WP.sendMsgSafe({ type: 'UPDATE_STEPS', steps: WP.state.steps });
      WP.renderSteps();
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        form.querySelector('.save-edit').click();
      }
      if (e.key === 'Escape') {
        form.remove();
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Save template
  // ---------------------------------------------------------------------------
  WP.saveTemplate = async function() {
    const name = WP.dom.templateName.value.trim();
    if (!name) {
      WP.dom.templateName.focus(); return;
    }
    if (WP.state.steps.length === 0) {
      return;
    }

    // Stop recording automatically when saving
    if (WP.state.recording) {
      await WP.stopRecording();
    }

    // Strip internal metadata before saving
    const cleanSteps = WP.state.steps.map(({ id: _id, timestamp: _ts, ...rest }) => rest);

    const startUrl = WP.dom.templateStartUrl?.value.trim() || undefined;
    const requiresAuth = WP.dom.templateRequiresAuth?.checked ?? false;

    // Reuse the existing template's ID if one with the same name already exists
    const existing = Object.values(WP.state.templates).find(t => t.name === name);
    const template = existing
      ? {
        ...existing,
        steps: cleanSteps,
        updatedAt: Date.now(),
        startUrl: startUrl ?? existing.startUrl,
        requiresAuth,
      }
      : {
        name,
        steps: cleanSteps,
        createdAt: Date.now(),
        startUrl,
        requiresAuth: requiresAuth || undefined,
      };

    const res = await WP.sendMsg({ type: 'SAVE_TEMPLATE', template });

    if (res?.success) {
      WP.state.templates[res.id] = { ...template, id: res.id };
      WP.state.steps = [];
      WP.dom.templateName.value = '';
      if (WP.dom.templateStartUrl) {
        WP.dom.templateStartUrl.value = '';
      }
      if (WP.dom.templateRequiresAuth) {
        WP.dom.templateRequiresAuth.checked = false;
      }
      WP.renderSteps();
      WP.renderTemplates();
      WP.switchTab('templates');
    }
  };
})(window.WebPilotPopup);
