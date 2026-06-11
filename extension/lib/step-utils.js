/**
 * WebPilot step utilities — shared by background service worker and tests.
 */
(function (global) {
  'use strict';

  function scoreSelectorQuality(selector) {
    if (!selector || typeof selector !== 'string') {
      return { score: 'unknown', level: 0 };
    }
    if (/\[data-testid=|\[data-cy=|#([a-zA-Z][\w-]*)$/.test(selector) && !/:nth-of-type|:nth-child/.test(selector)) {
      return { score: 'stable', level: 3 };
    }
    if (/\[aria-label=|\[name=/.test(selector) && !/:nth-of-type/.test(selector)) {
      return { score: 'good', level: 2 };
    }
    if (/:nth-of-type|:nth-child|\s>\s/.test(selector)) {
      return { score: 'fragile', level: 0 };
    }
    return { score: 'medium', level: 1 };
  }

  function isCheckboxHint(step) {
    const hint = `${step.elementHint || ''} ${step.selector || ''}`.toLowerCase();
    return hint.includes('checkbox') || hint.includes('type=checkbox') || hint.includes('type=radio');
  }

  function isNativeSelectStep(step) {
    if (!step) {
      return false;
    }
    if (step.action === 'select') {
      return true;
    }
    const hint = (step.elementHint || '').toUpperCase();
    return hint.startsWith('SELECT');
  }

  const INSTRUCTIONAL_LABEL_RE = /\b(start typing|click to (enter|edit|type)|enter text|type here|please enter)\b/i;
  const VAR_STOP_WORDS = new Set([
    'start', 'typing', 'to', 'enter', 'text', 'click', 'here', 'type', 'your', 'the',
    'a', 'an', 'please', 'optional', 'required', 'area',
  ]);

  function isInstructionalLabel(label) {
    if (!label || typeof label !== 'string') {
      return false;
    }
    const trimmed = label.trim();
    return INSTRUCTIONAL_LABEL_RE.test(trimmed) || trimmed.length > 45;
  }

  function simplifyLabelText(label) {
    if (!label) {
      return '';
    }
    let text = label.trim().replace(/\s+/g, ' ');
    text = text.replace(
      /\b(start typing to enter text|click to enter|enter text here|type here|start typing)\b/gi,
      '',
    );
    return text.replace(/[*:]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function labelToVarName(label) {
    const simplified = simplifyLabelText(label);
    const words = simplified
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => !VAR_STOP_WORDS.has(w.toLowerCase()));

    if (words.length === 0) {
      return 'value';
    }
    if (words.length === 1 || label.length > 28 || words.length > 2) {
      return words[0].toLowerCase();
    }
    return words
      .slice(0, 2)
      .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
      .join('');
  }

  function shortStepLabel(step) {
    const raw = step?.label ?? step?.description ?? step?.selector ?? 'field';
    const simplified = simplifyLabelText(String(raw));
    return simplified.slice(0, 40) || 'field';
  }

  function stepDescriptionForType(step) {
    return `Type into "${shortStepLabel(step)}"`;
  }

  function normalizeTemplateVariable(step) {
    if (step.action !== 'type' || !step.suggestedVar) {
      return step;
    }
    const value = String(step.value ?? '');
    const varMatch = value.match(/^\{\{(\w+)\}\}$/);
    if (varMatch && varMatch[1] !== step.suggestedVar) {
      const varName = step.suggestedVar;
      return {
        ...step,
        value: `{{${varName}}}`,
        description: stepDescriptionForType(step),
      };
    }
    return step;
  }

  function shouldDropRecordedAction(action, last) {
    if (!action) {
      return false;
    }
    if (action.action === 'type' && isNativeSelectStep(action)) {
      return true;
    }
    if (action.action === 'type' && isCheckboxHint(action)) {
      return true;
    }
    if (action.action === 'click' && isNativeSelectStep(action)) {
      return true;
    }
    if (
      action.action === 'click' &&
      last &&
      last.action === 'select' &&
      last.selector === action.selector
    ) {
      return true;
    }
    return false;
  }

  function sanitizeRecordedSteps(steps) {
    const out = [];
    for (const raw of steps) {
      const step = normalizeTemplateVariable(raw);

      if (step.action === 'type' && (step.value === '' || step.value === null || step.value === undefined)) {
        continue;
      }
      if (step.action === 'type' && isNativeSelectStep(step)) {
        continue;
      }
      if (step.action === 'type' && isCheckboxHint(step)) {
        continue;
      }
      if (step.action === 'click' && isNativeSelectStep(step)) {
        continue;
      }

      const last = out[out.length - 1];
      if (
        step.action === 'click' &&
        last &&
        last.action === 'select' &&
        last.selector === step.selector
      ) {
        continue;
      }

      if (
        step.action === 'select' &&
        last &&
        last.action === 'select' &&
        last.selector === step.selector
      ) {
        out[out.length - 1] = {
          ...last,
          ...step,
          id: last.id,
          timestamp: step.timestamp ?? last.timestamp,
          selectorQuality: scoreSelectorQuality(step.selector).score,
        };
        continue;
      }

      if (
        last &&
        last.action === step.action &&
        last.selector === step.selector &&
        last.value === step.value
      ) {
        continue;
      }

      const quality = scoreSelectorQuality(step.selector);
      out.push({ ...step, selectorQuality: quality.score });
    }
    return out;
  }

  function getStepSelectors(step) {
    if (Array.isArray(step.selectors) && step.selectors.length > 0) {
      return step.selectors;
    }
    return step.selector ? [step.selector] : [];
  }

  global.WebPilotStepUtils = {
    scoreSelectorQuality,
    sanitizeRecordedSteps,
    getStepSelectors,
    isCheckboxHint,
    isNativeSelectStep,
    shouldDropRecordedAction,
    normalizeTemplateVariable,
    isInstructionalLabel,
    simplifyLabelText,
    labelToVarName,
    shortStepLabel,
    stepDescriptionForType,
  };
})(typeof self !== 'undefined' ? self : globalThis);
