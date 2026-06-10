/**
 * Build ranked fallback selectors during recording (content script only).
 */
(function (global) {
  'use strict';

  function alternativesFromElement(el, primary) {
    if (!el) {
      return primary ? [primary] : [];
    }
    const alts = [];
    const add = (sel) => {
      if (sel && !alts.includes(sel)) {
        alts.push(sel);
      }
    };

    add(primary);
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
      add(`#${CSS.escape(el.id)}`);
    }
    if (el.dataset?.testid) {
      add(`[data-testid="${CSS.escape(el.dataset.testid)}"]`);
    }
    if (el.dataset?.cy) {
      add(`[data-cy="${CSS.escape(el.dataset.cy)}"]`);
    }
    if (el.name) {
      add(`${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`);
    }
    const aria = el.getAttribute('aria-label');
    if (aria) {
      add(`[aria-label="${CSS.escape(aria)}"]`);
    }

    return alts;
  }

  global.WebPilotSelectors = { alternativesFromElement };
})(typeof window !== 'undefined' ? window : globalThis);
