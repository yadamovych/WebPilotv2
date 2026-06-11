// WebPilot content — playback
(function (WP) {
  'use strict';
  if (window.__webpilotSkipModules) {
    return;
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
  WP.showStepHighlight = function(el, action, description) {
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
  };

  /**
     * In dev mode, surround the target element with a labelled highlight overlay
     * for `durationMs` before executing the action.
     */
  WP.showDevHighlight = function(el, step, durationMs = 900) {
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
        setTimeout(() => {
          overlay.remove(); resolve();
        }, 150);
      }, durationMs);
    });
  };

  WP.executeStep = async function(step, index, total, devMode = false, afterNavigate = false) {
    const { action, selector, value } = step;

    WP.showProgress(index, total, step.description ?? `${action}: ${selector}`);

    if (action === 'navigate') {
      window.location.href = value;
      return { success: true };
    }

    if (action === 'wait') {
      await WP.delay(parseInt(value, 10) || 1000);
      return { success: true };
    }

    if (action === 'wait_for') {
      const timeout = step.timeoutMs || parseInt(value, 10) || 15000;
      const waitEl = await WP.waitForElement(selector, timeout);
      if (!waitEl) {
        throw new Error(`wait_for timed out: ${selector}`);
      }
      return { success: true, selectorUsed: selector };
    }

    if (action === 'assert' || action === 'assert_text') {
      const timeout = step.timeoutMs || 10000;
      const assertEl = await WP.waitForElement(selector, timeout);
      if (!assertEl) {
        throw new Error(`${action}: element not found — ${selector}`);
      }
      const actual = (assertEl.tagName === 'INPUT' || assertEl.tagName === 'TEXTAREA')
        ? assertEl.value
        : (assertEl.textContent?.trim() ?? '');
      const expected = String(value ?? step.expected ?? '');
      if (action === 'assert_text' && actual !== expected) {
        throw new Error(`${action} failed: expected "${expected}", got "${actual}"`);
      }
      return { success: true, selectorUsed: selector, actual };
    }

    if (action === 'extract') {
      const extractedValue = await WP.extractFromElementWithRetry(
        selector,
        step.extractType || 'text',
      );
      const varName = step.variable || 'extracted';
      WP.storeExtractedValue(varName, extractedValue);
      const preview = extractedValue.substring(0, 50) + (extractedValue.length > 50 ? '...' : '');
      const statusMsg = `Extract step ${index + 1}/${total}: [[extracted.${varName}]]${extractedValue ? ` = "${preview}"` : ' (empty)'}`;
      // eslint-disable-next-line no-console
      console.log(`[WebPilot] ${statusMsg}`);
      WP.showProgress(index, total, statusMsg);
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
    const el = await WP.resolveElementWithRetry(
      selector,
      waitTimeout,
      step.description || `${action} target`,
      step.selectors,
    );
    if (!el) {
      throw new Error(`Element not found: ${selector}`);
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await WP.delay(200);

    if (devMode) {
      await WP.showDevHighlight(el, step);
    }

    switch (action) {
    case 'click': {
      // Suppress HTML5 form validation so clicks on submit/search buttons
      // proceed even if a sibling input holds a type-incompatible value.
      const form = el.closest('form');
      const addedNoValidate = form && !form.hasAttribute('novalidate');
      if (addedNoValidate) {
        form.setAttribute('novalidate', '');
      }
      el.click();
      if (addedNoValidate) {
        form.removeAttribute('novalidate');
      }
      break;
    }

    case 'type': {
      // Wait for extracted values to be loaded from storage (important for parallel tab execution)
      await WP.waitForExtractedValues();

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
      await WP.delay(50);

      // Use the value as-is (it should already be resolved by background.js)
      // Background resolves both {{template}} and [[extracted.var]] before sending here
      let finalValue = value ?? '';

      // Fallback: if any [[extracted.varName]] patterns remain, resolve them here
      const extractedMatches = finalValue.match(/\[\[extracted\.([a-zA-Z_][a-zA-Z0-9_]*)\]\]/g) || [];
      if (extractedMatches.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[WebPilot] Content script: resolving ${extractedMatches.length} extracted variables`);
        extractedMatches.forEach((match) => {
          try {
            // Extract variable name: [[extracted.varName]] → varName
            const varName = match.replace(/^\[\[extracted\.|\]\]$/g, '');
            const extracted = WP.getExtractedValue(varName);
            if (extracted !== undefined && extracted !== null) {
              const extractedStr = String(extracted);
              // eslint-disable-next-line no-console
              console.log(`[WebPilot] Resolved [[extracted.${varName}]] → ${extractedStr.substring(0, 30)}`);
              finalValue = finalValue.replace(match, extractedStr);
            } else {
              // eslint-disable-next-line no-console
              console.warn(`[WebPilot] Extracted variable not found or undefined: [[extracted.${varName}]]`);
              // Track missing extracted variables
              if (typeof errorTracker !== 'undefined') {
                errorTracker.track(
                  new Error(`Extracted variable not found: ${varName}`),
                  { context: 'resolveExtractedVariables', varName },
                );
              }
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[WebPilot] Error resolving extracted variable ${match}:`, err);
          }
        });
      }

      // eslint-disable-next-line no-console
      console.log(`[WebPilot] Type action: finalValue type=${typeof finalValue}, length=${String(finalValue).length}`);


      if (typeEl.isContentEditable) {
        // contenteditable (e.g. Jira rich-text editor, ProseMirror, Quill)
        // Accept HTML for formatting (from AI output) — Jira will render <b>, <ul>, <a>, etc.
        const htmlValue = String(finalValue ?? '');
        // Select all existing content and replace with typed value
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(typeEl);
        selection.removeAllRanges();
        selection.addRange(range);
        // Use execCommand for broad framework compatibility
        try {
          document.execCommand('insertHTML', false, htmlValue);
          typeEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: htmlValue }));
        } catch (err) {
          console.warn('[WebPilot] execCommand failed, falling back to innerHTML:', err);
          // Track execCommand failures
          if (typeof errorTracker !== 'undefined') {
            errorTracker.track(err, { context: 'typeContentEditable', method: 'execCommand' });
          }
          try {
            typeEl.innerHTML = htmlValue;
            typeEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: htmlValue }));
          } catch (err2) {
            console.error('[WebPilot] Failed to set contenteditable value:', err2);
          }
        }
      } else if (typeEl instanceof HTMLSelectElement) {
        // <select> element
        try {
          typeEl.value = String(finalValue ?? '');
          typeEl.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (err) {
          console.error('[WebPilot] Failed to set select value:', err);
        }
      } else {
        // Regular <input> / <textarea>
        try {
          // For constrained input types (number, date, etc.) temporarily relax
          // the type to 'text' so the browser accepts any string value
          const CONSTRAINED = ['number','date','datetime-local','time','month','week','range','color'];
          const savedType = (typeEl instanceof HTMLInputElement && CONSTRAINED.includes(typeEl.type.toLowerCase()))
            ? typeEl.type : null;

          if (savedType) {
            try {
              typeEl.type = 'text';
            } catch (_) {}
          }

          // Simple direct assignment is most reliable
          try {
            typeEl.value = String(finalValue ?? '');
          } catch (err) {
            // Track assignment failures
            if (typeof errorTracker !== 'undefined') {
              errorTracker.track(err, { context: 'typeElement', method: 'setValue' });
            }
          }

          if (savedType) {
            try {
              typeEl.type = savedType;
            } catch (_) {}
          }

          typeEl.dispatchEvent(new Event('input', { bubbles: true }));
          typeEl.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (err) {
          console.error('[WebPilot] Failed to set input/textarea value:', err);
          throw new Error(`Failed to type value: ${err.message}`);
        }
      }
      break;
    }

    case 'select': {
      try {
        if (el.tagName === 'SELECT') {
          el.value = String(value ?? '');
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }

        // Combobox/listbox widgets (e.g. Jira issue type)
        await WP.selectComboOption(el, String(value ?? ''));
      } catch (err) {
        console.error('[WebPilot] Failed to select option:', err);
        throw new Error(`Failed to select: ${err.message}`);
      }
      break;
    }

    case 'key': {
      try {
        const keyName = String(value ?? 'Enter');
        const init = { key: keyName, bubbles: true, cancelable: true };
        el.focus();
        await WP.delay(50);
        el.dispatchEvent(new KeyboardEvent('keydown', init));
        el.dispatchEvent(new KeyboardEvent('keypress', init));
        el.dispatchEvent(new KeyboardEvent('keyup', init));
      } catch (err) {
        console.error('[WebPilot] Failed to dispatch key event:', err);
        throw new Error(`Failed to dispatch key: ${err.message}`);
      }
      break;
    }

    default:
      throw new Error(`Unknown action: ${action}`);
    }

    // Visual confirmation flash
    el.classList.add('wp-playback');
    setTimeout(() => el.classList.remove('wp-playback'), 700);

    return { success: true, selectorUsed: el.__wpSelectorUsed || selector };
  };

  WP.showProgress = function(index, total, description) {
    let bar = document.getElementById('webpilot-progress');
    if (!bar) {
      WP.injectStyles();
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
  };

  WP.selectComboOption = async function(rootEl, optionText) {
    const text = String(optionText ?? '').trim();
    if (!text) {
      return;
    }

    // Focus + click to open the dropdown
    rootEl.focus?.();
    rootEl.click();
    await WP.delay(100);

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
    await WP.delay(400);

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
      if (ariaOption) {
        return ariaOption;
      }

      // AUI list items — the clickable element is the <a> inside <li>
      const auiAnchor = Array.from(document.querySelectorAll('.aui-list-item a, [class*="aui-list"] li a'))
        .find((n) => n.offsetParent !== null && normalize(n.textContent) === target);
      if (auiAnchor) {
        return auiAnchor;
      }

      // AUI: partial match fallback (in case displayed text has extra whitespace)
      const auiPartial = Array.from(document.querySelectorAll('.aui-list-item a, [class*="aui-list"] li a'))
        .find((n) => n.offsetParent !== null && normalize(n.textContent).includes(target));
      if (auiPartial) {
        return auiPartial;
      }

      return null;
    };

    let option = findOption();

    // If still not visible, wait a bit longer (slow AUI XHR autocomplete)
    if (!option) {
      await WP.delay(600);
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
  };

  WP.waitForElement = function(selector, timeoutMs) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) {
        return resolve(existing);
      }

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
  };

  WP.delay = function(ms) {
    return new Promise((r) => setTimeout(r, ms));
  };
})(window.WebPilotContent);
