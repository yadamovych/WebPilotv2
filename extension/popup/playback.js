// WebPilot popup — playback
(function (WP) {
  'use strict';
  // ---------------------------------------------------------------------------
  // Play panel
  // ---------------------------------------------------------------------------
  function templateNeedsAiPrompt(tpl) {
    const templateVars = new Set();
    const extractStepVars = new Set();
    for (const step of tpl?.steps ?? []) {
      for (const [, name] of (step.value ?? '').matchAll(/\{\{(\w+)\}\}/g)) {
        templateVars.add(name);
      }
      if (step.action === 'extract' && step.variable) {
        extractStepVars.add(step.variable);
      }
    }
    for (const v of extractStepVars) {
      templateVars.delete(v);
    }
    return templateVars.size > 0;
  }

  WP.openPlayPanel = function(tpl) {
    WP.state.selectedTemplateId = tpl.id;
    WP.dom.playName.textContent = tpl.name;
    WP.dom.playPanel.classList.remove('hidden');
    WP.dom.playStatus.className = 'status-msg hidden';
    WP.dom.playRunReport?.classList.add('hidden');
    WP.dom.userRequest.value = '';

    // Extract both TEMPLATE VARIABLES {{var}} and EXTRACTED VARIABLES [[extracted.var]] from steps
    const templateVars = new Set();
    const extractedVars = new Set();
    for (const step of tpl.steps ?? []) {
      // TEMPLATE VARIABLES {{varName}} - for AI generation
      for (const [, name] of (step.value ?? '').matchAll(/\{\{(\w+)\}\}/g)) {
        templateVars.add(name);
      }
      // EXTRACTED VARIABLES [[extracted.varName]] - from page/DOM extraction
      for (const [, name] of (step.value ?? '').matchAll(/\[\[extracted\.(\w+)\]\]/g)) {
        extractedVars.add(name);
      }
    }

    let hint = document.getElementById('play-vars-hint');
    if (!hint) {
      hint = document.createElement('p');
      hint.id = 'play-vars-hint';
      hint.className = 'play-vars-hint';
      WP.dom.userRequest.parentElement.after(hint);
    }

    let hintText = '';
    if (templateVars.size > 0) {
      hintText += `Template variables: ${[...templateVars].map(v => `{{${v}}}`).join(', ')}`;
    }
    if (extractedVars.size > 0) {
      if (hintText) {
        hintText += ' | ';
      }
      hintText += `Extracted variables: ${[...extractedVars].map(v => `[[extracted.${v}]]`).join(', ')}`;
    }

    if (hintText) {
      hint.textContent = '⚠ ' + hintText + ' — Mention template variables in your prompt';
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
    }

    WP.dom.userRequest.focus();
  }

  WP.closePlayPanel = function() {
    WP.dom.playPanel.classList.add('hidden');
    WP.state.selectedTemplateId = null;
  }

  WP.previewVariables = async function() {
    if (!WP.state.selectedTemplateId) {
      return;
    }
    const userRequest = WP.dom.userRequest.value.trim();
    if (!userRequest) {
      WP.dom.userRequest.focus();
      return;
    }
    if (!templateNeedsAiPrompt(WP.state.templates[WP.state.selectedTemplateId])) {
      WP.setStatus(WP.dom.playStatus, 'No {{variables}} to preview for this workflow.', 'error');
      return;
    }
    WP.dom.btnPreviewVars.disabled = true;
    WP.setStatus(WP.dom.playStatus, 'Previewing AI variables…', '');
    try {
      const res = await WP.sendMsg({
        type: 'PREVIEW_VARIABLES',
        templateId: WP.state.selectedTemplateId,
        userRequest,
      });
      if (res?.success) {
        const filled = Object.entries(res.variables ?? {})
          .map(([k, v]) => `${k}: "${v}"`)
          .join('\n');
        WP.setStatus(WP.dom.playStatus, `Preview:\n${filled}`, 'success');
      } else {
        throw new Error(res?.error ?? 'Preview failed');
      }
    } catch (err) {
      WP.setStatus(WP.dom.playStatus, `✗ ${err.message}`, 'error');
    } finally {
      WP.dom.btnPreviewVars.disabled = false;
    }
  }

  WP.importTemplateFromFile = async function(ev) {
    const file = ev.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const template = JSON.parse(await file.text());
      if (!Array.isArray(template.steps) || template.steps.length === 0) {
        throw new Error('JSON must include a non-empty "steps" array');
      }
      const res = await WP.sendMsg({ type: 'IMPORT_TEMPLATE', template });
      if (res?.success) {
        WP.state.templates[res.id] = { ...template, id: res.id };
        WP.renderTemplates();
        WP.switchTab('templates');
      } else {
        throw new Error(res?.error ?? 'Import failed');
      }
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      ev.target.value = '';
    }
  }

  WP.showRunReport = function(report) {
    if (!WP.dom.playRunReport || !report) {
      return;
    }
    const lines = [];
    if (report.error) {
      lines.push(`Failed: ${report.error}`);
    } else if (report.success) {
      lines.push('All steps completed');
    }
    for (const s of report.steps ?? []) {
      const icon = s.status === 'ok' ? '✓' : '✗';
      const retry = s.retryAttempt ? ` (retry ${s.retryAttempt})` : '';
      const desc = s.description ? `: ${s.description}` : '';
      const err = s.error ? ` — ${s.error}` : '';
      lines.push(`${icon} ${s.index + 1}. ${s.action}${desc}${retry}${err}`);
    }
    WP.dom.playRunReport.textContent = lines.join('\n');
    WP.dom.playRunReport.className = `run-report ${report.success && !report.error ? 'success' : 'error'}`;
    WP.dom.playRunReport.classList.remove('hidden');
  }

  WP.executeTemplate = async function() {
    if (!WP.state.selectedTemplateId) {
      return;
    }

    const tpl = WP.state.templates[WP.state.selectedTemplateId];
    const userRequest = WP.dom.userRequest.value.trim();
    if (!userRequest && templateNeedsAiPrompt(tpl)) {
      WP.dom.userRequest.focus();
      return;
    }

    WP.dom.btnExecute.disabled = true;
    if (WP.dom.btnStop) {
      WP.dom.btnStop.disabled = false;
      WP.dom.btnStop.classList.remove('hidden');
    }
    const needsAi = templateNeedsAiPrompt(tpl);
    WP.dom.executeLabel.textContent = 'Running…';
    WP.setStatus(
      WP.dom.playStatus,
      needsAi ? 'Asking AI to fill variables…' : 'Running workflow…',
      '',
    );
    WP.dom.playRunReport?.classList.add('hidden');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      const res = await WP.sendMsg({
        type: 'PLAY_TEMPLATE',
        templateId: WP.state.selectedTemplateId,
        userRequest,
        tabId: tab.id,
      });

      if (res?.success) {
        const filled = Object.entries(res.variables ?? {})
          .map(([k, v]) => `${k}: "${v}"`)
          .join('\n');
        WP.setStatus(WP.dom.playStatus, `✓ Done!\n${filled}`, 'success');
        WP.showRunReport(res.report);
      } else {
        WP.showRunReport(res?.report);
        throw new Error(res?.error ?? 'Unknown error');
      }
    } catch (err) {
      WP.setStatus(WP.dom.playStatus, `✗ ${err.message}`, 'error');
    } finally {
      WP.dom.btnExecute.disabled = false;
      if (WP.dom.btnStop) {
        WP.dom.btnStop.disabled = false;
        WP.dom.btnStop.classList.add('hidden');
      }
      WP.dom.executeLabel.textContent = '▶ Execute with AI';
    }

  }

  WP.stopPlayback = async function() {
    if (WP.dom.btnStop) {
      WP.dom.btnStop.disabled = true;
    }
    WP.setStatus(WP.dom.playStatus, 'Stopping…', '');
    await WP.sendMsg({ type: 'STOP_PLAYBACK' });
    if (WP.dom.btnStop) {
      WP.dom.btnStop.classList.add('hidden');
    }
    WP.dom.btnExecute.disabled = false;
    WP.dom.executeLabel.textContent = '▶ Execute with AI';
  }

  WP.deleteTemplate = async function(id) {
    await WP.sendMsg({ type: 'DELETE_TEMPLATE', id });
    delete WP.state.templates[id];
    if (WP.state.selectedTemplateId === id) {
      WP.closePlayPanel();
    }
    WP.renderTemplates();
  }

})(window.WebPilotPopup);
