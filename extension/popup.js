// WebPilot — Popup controller
'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  recording: false,
  steps: [],      // live recorded steps (with id/timestamp metadata)
  templates: {},  // { [id]: templateObject }
  selectedTemplateId: null,
  devMode: false,
};

// ---------------------------------------------------------------------------
// DOM references (resolved once on DOMContentLoaded)
// ---------------------------------------------------------------------------
let dom = {};

function resolveDOM() {
  dom = {
    // Tabs
    tabBtns:        document.querySelectorAll('.tab-btn'),
    tabPanels:      document.querySelectorAll('.tab-content'),

    // Record tab
    btnRecord:       document.getElementById('btn-record'),
    recordLabel:     document.getElementById('record-label'),
    recordingStatus: document.getElementById('recording-status'),
    stepsContainer:  document.getElementById('steps-container'),
    stepsCount:      document.getElementById('steps-count'),
    stepsList:       document.getElementById('steps-list'),
    btnClear:        document.getElementById('btn-clear-steps'),
    templateName:    document.getElementById('template-name'),
    btnSave:         document.getElementById('btn-save-template'),
    emptyRecord:     document.getElementById('empty-record'),
    recordError:     document.getElementById('record-error'),

    // Templates tab
    playPanel:       document.getElementById('play-panel'),
    playName:        document.getElementById('play-template-name'),
    btnCancelPlay:   document.getElementById('btn-cancel-play'),
    userRequest:     document.getElementById('user-request'),
    btnExecute:      document.getElementById('btn-execute'),
    executeLabel:    document.getElementById('execute-label'),
    playStatus:      document.getElementById('play-status'),
    templatesList:   document.getElementById('templates-list'),
    emptyTemplates:  document.getElementById('empty-templates'),

    // Settings tab
    serverUrl:       document.getElementById('server-url'),
    backendSelect:   document.getElementById('backend-select'),
    apiKeyGroup:     document.getElementById('api-key-group'),
    apiKey:          document.getElementById('api-key'),
    toggleKey:       document.getElementById('toggle-key'),
    modelName:       document.getElementById('model-name'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnCheckServer:  document.getElementById('btn-check-server'),
    settingsStatus:  document.getElementById('settings-status'),
    devMode:         document.getElementById('dev-mode'),

    // Header status indicator
    serverStatus:    document.getElementById('server-status'),
    statusDot:       document.querySelector('#server-status .status-dot'),
    statusLabel:     document.querySelector('#server-status .status-label'),
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  resolveDOM();
  bindStaticEvents();
  await Promise.all([loadSettings(), loadTemplates(), syncRecordingState()]);
  renderSteps();
  renderTemplates();
  checkServerHealth();
});

// ---------------------------------------------------------------------------
// Event bindings
// ---------------------------------------------------------------------------
function bindStaticEvents() {
  // Tab switching
  dom.tabBtns.forEach((btn) =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  // Record tab
  dom.btnRecord.addEventListener('click', toggleRecording);
  dom.btnClear.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_STEPS' }).catch(() => {});
    state.steps = [];
    renderSteps();
  });
  dom.btnSave.addEventListener('click', saveTemplate);

  // Templates tab
  dom.btnCancelPlay.addEventListener('click', closePlayPanel);
  dom.btnExecute.addEventListener('click', executeTemplate);

  // Settings tab
  dom.backendSelect.addEventListener('change', refreshApiKeyVisibility);
  dom.toggleKey.addEventListener('click', () => {
    dom.apiKey.type = dom.apiKey.type === 'password' ? 'text' : 'password';
  });
  dom.btnSaveSettings.addEventListener('click', saveSettings);
  dom.btnCheckServer?.addEventListener('click', () => checkServerHealth(true));

  // Background → popup messages (e.g. live step updates while popup is open)
  chrome.runtime.onMessage.addListener(onBackgroundMessage);
}

// ---------------------------------------------------------------------------
// Tab management
// ---------------------------------------------------------------------------
function switchTab(name) {
  dom.tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  dom.tabPanels.forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function loadSettings() {
  const { serverConfig = {} } = await chrome.storage.local.get('serverConfig');
  dom.serverUrl.value = serverConfig.url ?? 'http://localhost:8000';
  dom.backendSelect.value = serverConfig.backend ?? 'groq';
  dom.apiKey.value = serverConfig.apiKey ?? '';
  dom.modelName.value = serverConfig.model ?? '';
  dom.devMode.checked = serverConfig.devMode ?? false;
  state.devMode = dom.devMode.checked;
  refreshApiKeyVisibility();
}

function refreshApiKeyVisibility() {
  dom.apiKeyGroup.classList.toggle('hidden', dom.backendSelect.value === 'vllm');
}

async function saveSettings() {
  const config = {
    url:     dom.serverUrl.value.trim() || 'http://localhost:8000',
    backend: dom.backendSelect.value,
    apiKey:  dom.apiKey.value.trim(),
    model:   dom.modelName.value.trim(),
    devMode: dom.devMode.checked,
  };
  const res = await sendMsg({ type: 'SET_SERVER_CONFIG', config });
  if (res?.success) {
    state.devMode = config.devMode;
    renderTemplates();
    checkServerHealth();
  }
  showStatus(dom.settingsStatus, res?.success ? 'Settings saved.' : 'Save failed.', !!res?.success);
}

// ---------------------------------------------------------------------------
// Server health check
// ---------------------------------------------------------------------------
async function checkServerHealth(showResult = false) {
  const url = (dom.serverUrl?.value || 'http://localhost:8000').replace(/\/$/, '');

  if (dom.serverStatus) {
    dom.serverStatus.className = 'server-status checking';
    dom.statusLabel.textContent = '…';
  }

  try {
    const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
    const ok = resp.ok;
    if (dom.serverStatus) {
      dom.serverStatus.className = `server-status ${ok ? 'online' : 'offline'}`;
      dom.statusLabel.textContent = ok ? 'Online' : `${resp.status}`;
    }
    if (showResult) {
      showStatus(
        dom.settingsStatus,
        ok ? `Server online (${url})` : `Server returned ${resp.status}`,
        ok
      );
    }
  } catch {
    if (dom.serverStatus) {
      dom.serverStatus.className = 'server-status offline';
      dom.statusLabel.textContent = 'Offline';
    }
    if (showResult) {
      showStatus(dom.settingsStatus, `Cannot reach server at ${url}`, false);
    }
  }
}

// ---------------------------------------------------------------------------
// Templates — load & render
// ---------------------------------------------------------------------------
async function loadTemplates() {
  const res = await sendMsg({ type: 'GET_TEMPLATES' });
  state.templates = res?.templates ?? {};
}

function renderTemplates() {
  const list = Object.values(state.templates).sort(
    (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)
  );

  dom.templatesList.innerHTML = '';
  dom.emptyTemplates.classList.toggle('hidden', list.length > 0);

  for (const tpl of list) {
    dom.templatesList.appendChild(buildTemplateItem(tpl));
  }
}

function buildTemplateItem(tpl) {
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
        <div class="template-name">${esc(tpl.name)}</div>
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
      ${state.devMode ? `<button class="btn-json-tpl" title="View JSON">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        JSON
      </button>` : ''}
      <button class="btn-danger">Delete</button>
    </div>
  `;

  li.querySelector('.btn-play').addEventListener('click', () => openPlayPanel(tpl));
  li.querySelector('.btn-edit-tpl').addEventListener('click', () => toggleTemplateEditor(tpl, li));
  li.querySelector('.btn-json-tpl')?.addEventListener('click', () => openJsonModal(tpl));
  li.querySelector('.btn-danger').addEventListener('click', (e) => confirmDeleteTemplate(tpl.id, e.currentTarget));
  return li;
}

// ---------------------------------------------------------------------------
// JSON modal
// ---------------------------------------------------------------------------
function openJsonModal(tpl) {
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
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); }, { once: true });

  document.getElementById('json-modal-copy').onclick = async () => {
    await navigator.clipboard.writeText(body.value);
    const btn = document.getElementById('json-modal-copy');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
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
    await saveEditedTemplate(parsed);
    close();
  };
}

// ---------------------------------------------------------------------------
// Inline template editor
// ---------------------------------------------------------------------------
function toggleTemplateEditor(tpl, li) {
  const existing = li.querySelector('.tpl-editor');
  if (existing) { existing.remove(); li.classList.remove('editing'); return; }
  li.classList.add('editing');
  openTemplateEditor(tpl, li);
}

function openTemplateEditor(tpl, li) {
  // Work on a deep copy so cancelling discards changes
  const draft = { ...tpl, steps: tpl.steps.map(s => ({ ...s })) };

  const editor = document.createElement('div');
  editor.className = 'tpl-editor';

  const renderEditorSteps = () => {
    stepsList.innerHTML = '';
    draft.steps.forEach((step, i) => stepsList.appendChild(buildEditorStep(step, i, draft, renderEditorSteps)));
    emptyHint.classList.toggle('hidden', draft.steps.length > 0);
  };

  editor.innerHTML = `
    <div class="tpl-editor-header">
      <label class="edit-label">Workflow name</label>
      <input class="tpl-name-input" type="text" value="${esc(draft.name)}" maxlength="80" />
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
    type:     'Value or {{variable}}…',
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
    if (!addForm.classList.contains('hidden')) addFormSel.focus();
  });

  addForm.querySelector('.add-form-cancel').addEventListener('click', () => {
    addForm.classList.add('hidden');
  });

  addForm.querySelector('.add-form-ok').addEventListener('click', () => {
    const action   = addFormAction.value;
    const selector = addFormSel.value.trim();
    const value    = addFormVal.value.trim();
    const label    = addFormLabel.value.trim();

    if (!NO_SELECTOR.has(action) && action !== 'key' && !selector) { addFormSel.focus(); return; }
    if (!NO_VALUE.has(action) && !value) { addFormVal.focus(); return; }

    const step = {
      action,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      description: label || [action, selector, value].filter(Boolean).join(' → '),
    };
    if (label)    step.label    = label;
    if (selector) step.selector = selector;
    if (value)    step.value    = value;

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
      // Clear any leftover steps from the Record tab, then start recording
      await sendMsg({ type: 'CLEAR_STEPS' });
      state.steps = [];
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const res = await sendMsg({ type: 'START_RECORDING', tabId: tab.id });
      if (!res?.success) {
        showStatus(dom.recordError, res?.error ?? 'Could not start recording', false);
        return;
      }
      editorRecording = true;
      state.recording = true;
      recBtn.classList.add('recording');
      recLabel.textContent = '⏹ Stop Recording';
      recBanner.classList.remove('hidden');
    } else {
      // Stop and harvest the new steps into the draft
      const res = await sendMsg({ type: 'STOP_RECORDING' });
      editorRecording = false;
      state.recording = false;
      recBtn.classList.remove('recording');
      recLabel.textContent = 'Record Step';
      recBanner.classList.add('hidden');

      const newSteps = res?.steps ?? [];
      newSteps.forEach(s => draft.steps.push({ ...s }));
      // Clear from background so Record tab is clean
      await sendMsg({ type: 'CLEAR_STEPS' });
      state.steps = [];
      renderEditorSteps();
    }
  });

  // Live step updates while recording: append to draft as they come in
  editor._onStepsUpdated = (steps) => {
    if (!editorRecording) return;
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
    if (editorRecording) recBtn.click();
    draft.name = editor.querySelector('.tpl-name-input').value.trim();
    if (!draft.name) { editor.querySelector('.tpl-name-input').focus(); return; }
    await saveEditedTemplate(draft);
    editor.remove();
    li.classList.remove('editing');
  });

  editor.querySelector('.tpl-cancel').addEventListener('click', async () => {
    if (editorRecording) {
      await sendMsg({ type: 'STOP_RECORDING' });
      await sendMsg({ type: 'CLEAR_STEPS' });
      state.recording = false;
      state.steps = [];
    }
    editor.remove();
    li.classList.remove('editing');
  });

  li.appendChild(editor);
  renderEditorSteps();
  editor.querySelector('.tpl-name-input').focus();
}

function buildEditorStep(step, index, draft, refresh) {
  const li = document.createElement('li');
  li.className = 'tpl-step-row';
  li.dataset.index = index;

  const isType   = step.action === 'type';
  const isSelect = step.action === 'select';
  const isKey    = step.action === 'key';
  const actionBadge = step.action ?? 'action';
  const selectorHint = step.selector ?? '';
  const varName = step.suggestedVar;
  const alreadyVar = isType && step.value?.startsWith('{{');
  const isDate = step.fieldType === 'date';
  li.innerHTML = `
    <span class="tpl-drag-handle" title="Drag to reorder">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg>
    </span>
    <span class="tpl-step-num">${index + 1}</span>
    <div class="tpl-step-fields">
      <div class="tpl-step-action-row">
        <span class="tpl-action-badge tpl-action-${esc(actionBadge)}">${esc(actionBadge)}</span>
        ${isDate ? '<span class="tpl-date-badge" title="Calendar / date field">📅</span>' : ''}
        <input class="tpl-step-desc" type="text" value="${esc(step.description ?? '')}" placeholder="Describe this step…" />
      </div>
      ${isType ? `
        <div class="tpl-val-row">
          <input class="tpl-step-val" type="text" value="${esc(step.value ?? '')}" placeholder="${isDate ? 'Date value or {{var}} (e.g. YYYY-MM-DD)' : 'Value ({{var}} for AI)'}" />
          ${varName && !alreadyVar
            ? `<button class="var-suggest-btn tpl-var-btn" data-var="${esc(varName)}">{{${esc(varName)}}}</button>`
            : ''}
        </div>
      ` : ''}
      ${isSelect ? `
        <div class="tpl-val-row">
          <span class="tpl-select-icon">▾</span>
          <input class="tpl-step-val" type="text" value="${esc(step.value ?? '')}" placeholder="Option to select…" />
        </div>
      ` : ''}
      ${isKey ? `
        <div class="tpl-val-row">
          <span class="tpl-key-icon" title="Key to press">⌨</span>
          <input class="tpl-step-val" type="text" value="${esc(step.value ?? 'Enter')}" placeholder="Key name (Enter, Tab, Escape, Space…)" />
        </div>
      ` : ''}
      ${selectorHint || step.elementHint ? `
        <div class="tpl-hint-wrap">
          <button type="button" class="tpl-hint-btn" tabindex="-1" aria-label="Element info">ⓘ</button>
          <div class="tpl-hint-popup">
            ${selectorHint ? `<div class="tpl-hint-row"><span class="tpl-hint-label">Selector</span><code>${esc(selectorHint)}</code></div>` : ''}
            ${step.elementHint ? `<div class="tpl-hint-row"><span class="tpl-hint-label">DOM</span><code>${esc(step.elementHint)}</code></div>` : ''}
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

  li.querySelector('.tpl-step-desc').addEventListener('input', (e) => {
    draft.steps[index].description = e.target.value;
  });
  const valInput = li.querySelector('.tpl-step-val');
  if (valInput) {
    valInput.addEventListener('input', (e) => {
      draft.steps[index].value = e.target.value;
    });
  }

  li.querySelector('.tpl-step-delay').addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    draft.steps[index].delayMs = isNaN(v) || v < 0 ? 0 : v;
  });

  // Variable suggestion button in editor
  li.querySelector('.tpl-var-btn')?.addEventListener('click', () => {
    const v = `{{${draft.steps[index].suggestedVar}}}`;
    draft.steps[index].value = v;
    draft.steps[index].description = `Type ${v} into "${draft.steps[index].label ?? draft.steps[index].selector}"`;
    refresh();
  });

  li.querySelector('.tpl-move-up').addEventListener('click', () => {
    if (index === 0) return;
    [draft.steps[index - 1], draft.steps[index]] = [draft.steps[index], draft.steps[index - 1]];
    refresh();
  });

  li.querySelector('.tpl-move-down').addEventListener('click', () => {
    if (index === draft.steps.length - 1) return;
    [draft.steps[index], draft.steps[index + 1]] = [draft.steps[index + 1], draft.steps[index]];
    refresh();
  });

  li.querySelector('.tpl-step-del').addEventListener('click', () => {
    draft.steps.splice(index, 1);
    refresh();
  });

  // Drag-to-reorder — only via the drag handle
  const handle = li.querySelector('.tpl-drag-handle');
  handle.addEventListener('mousedown', () => { li.draggable = true; });
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(index));
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => { li.draggable = false; li.classList.remove('dragging'); });
  li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drag-over'); });
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

async function saveEditedTemplate(tpl) {
  const updated = { ...tpl, updatedAt: Date.now() };
  const res = await sendMsg({ type: 'SAVE_TEMPLATE', template: updated });
  if (res?.success) {
    state.templates[updated.id] = updated;
    renderTemplates();
  }
}

// ---------------------------------------------------------------------------
// Play panel
// ---------------------------------------------------------------------------
function openPlayPanel(tpl) {
  state.selectedTemplateId = tpl.id;
  dom.playName.textContent = tpl.name;
  dom.playPanel.classList.remove('hidden');
  dom.playStatus.className = 'status-msg hidden';
  dom.userRequest.value = '';

  // Extract {{variable}} names from template steps and show as a hint
  const vars = new Set();
  for (const step of tpl.steps ?? []) {
    for (const [, name] of (step.value ?? '').matchAll(/\{\{(\w+)\}\}/g)) {
      vars.add(name);
    }
  }
  let hint = document.getElementById('play-vars-hint');
  if (!hint) {
    hint = document.createElement('p');
    hint.id = 'play-vars-hint';
    hint.className = 'play-vars-hint';
    dom.userRequest.parentElement.after(hint);
  }
  if (vars.size > 0) {
    hint.textContent = `⚠ Mention in your prompt: ${[...vars].map(v => `{{${v}}}`).join(', ')}`;
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }

  dom.userRequest.focus();
}

function closePlayPanel() {
  dom.playPanel.classList.add('hidden');
  state.selectedTemplateId = null;
}

async function executeTemplate() {
  if (!state.selectedTemplateId) return;

  const userRequest = dom.userRequest.value.trim();
  if (!userRequest) { dom.userRequest.focus(); return; }

  dom.btnExecute.disabled = true;
  dom.executeLabel.textContent = 'Running…';
  setStatus(dom.playStatus, 'Asking AI to fill variables…', '');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const res = await sendMsg({
      type: 'PLAY_TEMPLATE',
      templateId: state.selectedTemplateId,
      userRequest,
      tabId: tab.id,
    });

    if (res?.success) {
      const filled = Object.entries(res.variables ?? {})
        .map(([k, v]) => `${k}: "${v}"`)
        .join('\n');
      setStatus(dom.playStatus, `✓ Done!\n${filled}`, 'success');
    } else {
      throw new Error(res?.error ?? 'Unknown error');
    }
  } catch (err) {
    setStatus(dom.playStatus, `✗ ${err.message}`, 'error');
  } finally {
    dom.btnExecute.disabled = false;
    dom.executeLabel.textContent = '▶ Execute with AI';
  }
}

async function deleteTemplate(id) {
  await sendMsg({ type: 'DELETE_TEMPLATE', id });
  delete state.templates[id];
  if (state.selectedTemplateId === id) closePlayPanel();
  renderTemplates();
}

/** Show an inline confirm row on the template card before deleting. */
function confirmDeleteTemplate(id, btnEl) {
  const li = btnEl.closest('.template-item');
  // If confirm row already visible, cancel it (toggle behaviour)
  const existing = li.querySelector('.delete-confirm-row');
  if (existing) { existing.remove(); return; }

  const row = document.createElement('div');
  row.className = 'delete-confirm-row';
  row.innerHTML = `
    <span>Delete this workflow?</span>
    <button class="btn-danger btn-sm confirm-yes">Yes, delete</button>
    <button class="btn-ghost-sm confirm-no">Cancel</button>
  `;
  li.appendChild(row);
  row.querySelector('.confirm-yes').addEventListener('click', () => deleteTemplate(id));
  row.querySelector('.confirm-no').addEventListener('click', () => row.remove());
}

// ---------------------------------------------------------------------------
// Recording — manual toggle
// ---------------------------------------------------------------------------
async function syncRecordingState() {
  try {
    const res = await sendMsg({ type: 'GET_STATE' });
    if (!res?.state) return;
    state.recording = res.state.recording ?? false;
    state.steps = res.state.steps ?? [];
    applyRecordingUI();
    renderSteps();
  } catch (_) { /* popup opened before background ready */ }
}

async function toggleRecording() {
  state.recording ? await stopRecording() : await startRecording();
}

async function startRecording() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await sendMsg({ type: 'START_RECORDING', tabId: tab.id });
    if (!res?.success) throw new Error(res?.error ?? 'Failed to start');
    state.recording = true;
    applyRecordingUI();
  } catch (err) {
    showStatus(dom.recordError, err.message, false);
  }
}

async function stopRecording() {
  const res = await sendMsg({ type: 'STOP_RECORDING' });
  state.recording = false;
  state.steps = res?.steps ?? state.steps;
  applyRecordingUI();
  renderSteps();
}

function applyRecordingUI() {
  const rec = state.recording;
  dom.btnRecord.classList.toggle('recording', rec);
  dom.recordLabel.textContent = rec ? '⏹ Stop Recording' : 'Record Step';
  dom.recordingStatus.classList.toggle('hidden', !rec);
}

// ---------------------------------------------------------------------------
// Steps rendering
// ---------------------------------------------------------------------------
function renderSteps() {
  const hasSteps = state.steps.length > 0;

  dom.stepsCount.textContent = `${state.steps.length} step${state.steps.length !== 1 ? 's' : ''}`;
  dom.emptyRecord.classList.toggle('hidden', hasSteps);
  dom.stepsList.innerHTML = '';
  state.steps.forEach((step, i) => dom.stepsList.appendChild(buildStepItem(step, i)));
}

function buildStepItem(step, index) {
  const li = document.createElement('li');
  li.className = 'step-item';
  li.dataset.index = index;

  const isType   = step.action === 'type';
  const isSelect = step.action === 'select';
  const varName = step.suggestedVar;
  const alreadyVar = isType && step.value?.startsWith('{{');
  const isDate = step.fieldType === 'date';
  const hint = step.elementHint ?? step.selector ?? '';

  li.innerHTML = `
    <span class="step-drag-handle" title="Drag to reorder">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg>
    </span>
    <div class="step-num">${index + 1}</div>
    <div class="step-info">
      <span class="step-action step-action-${esc(step.action ?? 'action')} ${isDate ? 'step-action-date' : ''}">${esc(step.action)}</span>
      ${isDate ? '<span class="step-field-badge date-badge" title="Calendar / date field">📅</span>' : ''}
      ${isSelect && step.value ? `<span class="step-select-badge">▾ ${esc(step.value)}</span>` : ''}
      <div class="step-desc" title="${esc(step.description ?? step.selector ?? '')}">${esc(step.description ?? step.selector ?? '')}</div>
      ${hint ? `<div class="step-element-hint" title="${esc(hint)}">${esc(hint)}</div>` : ''}
      ${isType && varName && !alreadyVar ? `<button class="var-suggest-btn" data-var="${esc(varName)}" title="Use as AI variable">Use <strong>{{${esc(varName)}}}</strong></button>` : ''}
      ${isType && alreadyVar ? `<span class="var-active-badge">${esc(step.value)}</span>` : ''}
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
    state.steps[index].value = `{{${varName}}}`;
    state.steps[index].description = `Type {{${varName}}} into "${step.label ?? step.selector}"`;
    renderSteps();
    // Persist to background
    chrome.runtime.sendMessage({ type: 'UPDATE_STEPS', steps: state.steps }).catch(() => {});
  });

  li.querySelector('[data-action="edit"]').addEventListener('click', () => editStep(index, li));
  li.querySelector('[data-action="delete"]').addEventListener('click', () => {
    state.steps.splice(index, 1);
    chrome.runtime.sendMessage({ type: 'UPDATE_STEPS', steps: state.steps }).catch(() => {});
    renderSteps();
  });

  // Drag-to-reorder — only via the drag handle
  const handle = li.querySelector('.step-drag-handle');
  handle.addEventListener('mousedown', () => { li.draggable = true; });
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(index));
  });
  li.addEventListener('dragend', () => { li.draggable = false; });
  li.addEventListener('dragover',  (e) => { e.preventDefault(); li.classList.add('drag-over'); });
  li.addEventListener('dragleave', ()  => li.classList.remove('drag-over'));
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    li.classList.remove('drag-over');
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (from !== index) {
      const [moved] = state.steps.splice(from, 1);
      state.steps.splice(index, 0, moved);
      chrome.runtime.sendMessage({ type: 'UPDATE_STEPS', steps: state.steps }).catch(() => {});
      renderSteps();
    }
  });

  return li;
}

function editStep(index, liEl) {
  const step = state.steps[index];

  // Toggle: if form already open, close it
  const existing = liEl.querySelector('.step-edit-form');
  if (existing) { existing.remove(); return; }

  const isType = step.action === 'type';
  const form = document.createElement('div');
  form.className = 'step-edit-form';
  form.innerHTML = `
    <label class="edit-label">Description</label>
    <input class="edit-desc" type="text" value="${esc(step.description ?? '')}" />
    ${isType ? `
    <label class="edit-label">Value <span class="label-hint">(use {{var}} for AI placeholders)</span></label>
    <input class="edit-val" type="text" value="${esc(step.value ?? '')}" />
    ` : ''}
    <div class="edit-btns">
      <button class="btn-gradient btn-sm save-edit">Save</button>
      <button class="btn-ghost-sm cancel-edit">Cancel</button>
    </div>
  `;
  liEl.appendChild(form);
  form.querySelector('.edit-desc').focus();

  form.querySelector('.cancel-edit').addEventListener('click', () => form.remove());
  form.querySelector('.save-edit').addEventListener('click', () => {
    const desc = form.querySelector('.edit-desc').value;
    state.steps[index] = { ...step, description: desc };
    if (isType) {
      const val = form.querySelector('.edit-val')?.value;
      if (val !== undefined) state.steps[index].value = val;
    }
    renderSteps();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') form.querySelector('.save-edit').click();
    if (e.key === 'Escape') form.remove();
  });
}

// ---------------------------------------------------------------------------
// Save template
// ---------------------------------------------------------------------------
async function saveTemplate() {
  const name = dom.templateName.value.trim();
  if (!name) { dom.templateName.focus(); return; }
  if (state.steps.length === 0) return;

  // Stop recording automatically when saving
  if (state.recording) await stopRecording();

  // Strip internal metadata before saving
  const cleanSteps = state.steps.map(({ id: _id, timestamp: _ts, ...rest }) => rest);

  // Reuse the existing template's ID if one with the same name already exists
  const existing = Object.values(state.templates).find(t => t.name === name);
  const template = existing
    ? { ...existing, steps: cleanSteps, updatedAt: Date.now() }
    : { name, steps: cleanSteps, createdAt: Date.now() };

  const res = await sendMsg({ type: 'SAVE_TEMPLATE', template });

  if (res?.success) {
    state.templates[res.id] = { ...template, id: res.id };
    state.steps = [];
    dom.templateName.value = '';
    renderSteps();
    renderTemplates();
    switchTab('templates');
  }
}

// ---------------------------------------------------------------------------
// Background → popup message bridge
// ---------------------------------------------------------------------------
function onBackgroundMessage(message) {
  if (message.type === 'STEPS_UPDATED') {
    state.steps = message.steps;
    // Forward live steps to any open template editor that is recording
    const openEditor = document.querySelector('.tpl-editor');
    if (openEditor?._onStepsUpdated) {
      openEditor._onStepsUpdated(message.steps);
    } else {
      renderSteps();
    }
  } else if (message.type === 'PLAYBACK_PROGRESS') {
    if (!dom.playStatus.classList.contains('error')) {
      const retry = message.retryAttempt
        ? ` (retry ${message.retryAttempt}/${message.retryMax})`
        : '';
      setStatus(
        dom.playStatus,
        `Running step ${message.currentIndex + 1} / ${message.total}${retry}…`,
        ''
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sendMsg(msg) {
  return chrome.runtime.sendMessage(msg).catch((err) => {
    console.error('sendMessage error:', err);
    return null;
  });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function setStatus(el, text, cls) {
  el.textContent = text;
  el.className = `status-msg${cls ? ' ' + cls : ''}`;
}

function showStatus(el, text, success) {
  setStatus(el, text, success ? 'success' : 'error');
  setTimeout(() => { el.className = 'status-msg hidden'; }, 3000);
}

// Expose key symbols so sidepanel.js (loaded after this file) can reach them
window.__webpilotState          = state;
window.__webpilotExecuteTemplate = executeTemplate;
