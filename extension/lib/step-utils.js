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
        description: step.description?.includes('{{')
          ? step.description.replace(/\{\{\w+\}\}/, `{{${varName}}}`)
          : `Type {{${varName}}} into "${step.label ?? step.selector ?? 'field'}"`,
      };
    }
    return step;
  }

  function isEmptyTypeStep(step) {
    return (
      step.action === 'type' &&
      (step.value === '' || step.value === null || step.value === undefined)
    );
  }

  // Shared drop rules used both live (per recorded action) and during the final
  // sanitize pass. Empty-type steps are intentionally NOT dropped here so that
  // clearing a field during recording can still update/remove the prior step;
  // they are pruned separately inside sanitizeRecordedSteps.
  function isDroppableAction(step, prev) {
    if (!step) {
      return false;
    }
    if (step.action === 'type' && isNativeSelectStep(step)) {
      return true;
    }
    if (step.action === 'type' && isCheckboxHint(step)) {
      return true;
    }
    if (step.action === 'click' && isNativeSelectStep(step)) {
      return true;
    }
    if (
      step.action === 'click' &&
      prev &&
      prev.action === 'select' &&
      prev.selector === step.selector
    ) {
      return true;
    }
    return false;
  }

  function shouldDropRecordedAction(action, last) {
    return isDroppableAction(action, last);
  }

  function sanitizeRecordedSteps(steps) {
    const out = [];
    for (const raw of steps) {
      const step = normalizeTemplateVariable(raw);

      if (isEmptyTypeStep(step)) {
        continue;
      }
      if (isDroppableAction(step, out[out.length - 1])) {
        continue;
      }

      const last = out[out.length - 1];

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
    isEmptyTypeStep,
    isDroppableAction,
    shouldDropRecordedAction,
    normalizeTemplateVariable,
  };
})(typeof self !== 'undefined' ? self : globalThis);
