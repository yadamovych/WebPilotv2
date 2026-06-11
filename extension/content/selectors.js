// WebPilot content — selectors
(function (WP) {
  'use strict';
  if (window.__webpilotSkipModules) {
    return;
  }
  /** Returns true for native date/time input types handled by the browser's date picker. */
  WP.isDateField = function(el) {
    if (!el || el.tagName !== 'INPUT') {
      return false;
    }
    const t = (el.type || '').toLowerCase();
    return ['date', 'datetime-local', 'time', 'month', 'week'].includes(t);
  };

  WP.isComboBoxInput = function(el) {
    if (!el) {
      return false;
    }
    const role = (el.getAttribute?.('role') || '').toLowerCase();
    const ariaAutocomplete = (el.getAttribute?.('aria-autocomplete') || '').toLowerCase();
    const hasListboxPopup = (el.getAttribute?.('aria-haspopup') || '').toLowerCase() === 'listbox';
    const tag = el.tagName;
    const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    return role === 'combobox' || (isEditable && (ariaAutocomplete === 'list' || hasListboxPopup));
  };

  /**
     * Walk up the DOM to find a calendar popup container.
     * Deliberately narrow: only matches elements whose class name or aria-label
     * explicitly mentions a calendar/datepicker library, plus role="grid" which
     * is used by calendar month grids. We intentionally exclude role="dialog"
     * and role="listbox" because those appear on many non-calendar overlays.
     */
  WP.getCalendarContainer = function(el) {
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
  };

  /**
     * Given a calendar popup container, find the input that receives the chosen date.
     * Checks aria-controls / aria-owns first, then walks up ancestors looking for
     * a date-type input or an input whose value looks like a date string.
     */
  WP.findDateInputNear = function(calendarEl) {
    for (const attr of ['aria-controls', 'aria-owns']) {
      const refs = calendarEl.getAttribute?.(attr);
      if (refs) {
        for (const id of refs.trim().split(/\s+/)) {
          const el = document.getElementById(id);
          if (el?.tagName === 'INPUT') {
            return el;
          }
        }
      }
    }
    let container = calendarEl.parentElement;
    for (let i = 0; i < 6 && container; i++, container = container.parentElement) {
      for (const inp of container.querySelectorAll('input')) {
        if (WP.isDateField(inp)) {
          return inp;
        }
        const hint = (inp.name || inp.id || inp.className || '').toLowerCase();
        if (/date|calendar|picker/.test(hint)) {
          return inp;
        }
        if (inp.value && /^\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(inp.value)) {
          return inp;
        }
      }
    }
    return null;
  };

  /** Record a date-pick action (native or custom calendar). */
  WP.sendDateAction = function(el, selector) {
    const value = el.value ?? '';
    const label = WP.getLabel(el) || WP.labelFromSelector(selector);
    const suggestedVar = WP.labelToVarName(label);
    WP.safeSend({
      type: 'RECORD_ACTION',
      action: {
        action: 'type',
        selector,
        value,
        label: WebPilotStepUtils.simplifyLabelText(label) || label,
        fieldType: 'date',
        description: WebPilotStepUtils.shortStepLabel({ label }),
        suggestedVar,
        elementHint: WP.elementHint(el),
      },
    });
  };

  // ---------------------------------------------------------------------------
  // CSS selector builder
  // ---------------------------------------------------------------------------
  /**
     * Walk up from a contenteditable / textarea / input element looking for the
     * nearest ancestor that has a stable, unique identifier (id, data-field-id,
     * data-testid, aria-label, aria-labelledby).  Returns null if none found
     * within 6 levels.
     */
  WP.findStableFieldAncestor = function(el) {
    let node = el.parentElement;
    for (let i = 0; i < 6 && node && node !== document.body; i++, node = node.parentElement) {
      if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) {
        return node;
      }
      if (node.dataset?.fieldId) {
        return node;
      }
      if (node.dataset?.testid) {
        return node;
      }
      if (node.dataset?.cy) {
        return node;
      }
      if (node.getAttribute('aria-label')) {
        return node;
      }
      if (node.getAttribute('aria-labelledby')) {
        return node;
      }
    }
    return null;
  };

  WP.buildSelector = function(el) {
    if (!el) {
      return 'body';
    }

    // Stable id check FIRST — even document.body can have a meaningful id.
    // e.g. TinyMCE renders <body id="tinymce" contenteditable="true"> inside
    // an iframe; we must return '#tinymce' rather than 'body' in that case.
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
      return `#${el.id}`;
    }

    if (el === document.body) {
      return 'body';
    }
    if (el.dataset?.testid) {
      return `[data-testid="${CSS.escape(el.dataset.testid)}"]`;
    }
    if (el.dataset?.cy) {
      return `[data-cy="${CSS.escape(el.dataset.cy)}"]`;
    }
    if (el.dataset?.fieldId) {
      return `[data-field-id="${CSS.escape(el.dataset.fieldId)}"]`;
    }
    if (el.name) {
      return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    }
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      return `[aria-label="${CSS.escape(ariaLabel)}"]`;
    }

    // For editable elements with no own stable identifier, try anchoring on a
    // stable ancestor (e.g. the wrapping div.jira-wikifield with an id or
    // data-field-id).  This avoids fragile nth-child paths for rich editors.
    const isEditable = el.isContentEditable ||
        el.tagName === 'TEXTAREA' ||
        (el.tagName === 'INPUT' && el.type !== 'hidden');
    if (isEditable) {
      const anchor = WP.findStableFieldAncestor(el);
      if (anchor) {
        // Build the anchor's selector (will hit one of the stable checks above)
        const anchorSel = WP.buildSelector(anchor);
        // If there is exactly one matching typeable descendant use a qualified
        // selector; otherwise the anchor alone is enough (playback will find
        // the first editable child).
        const qualified = `${anchorSel} ${el.tagName.toLowerCase()}`;
        if (document.querySelectorAll(qualified).length === 1) {
          return qualified;
        }
        return anchorSel;
      }
    }

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
            !/^(is-|has-|active|open|closed|focused|hover|selected|disabled)/.test(c),
        )
        .slice(0, 2);
      if (stableClasses.length) {
        seg += '.' + stableClasses.map(CSS.escape).join('.');
      }

      // Disambiguate siblings of the same tag
      const parent = node.parentElement;
      if (parent) {
        const sameTags = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sameTags.length > 1) {
          seg += `:nth-of-type(${sameTags.indexOf(node) + 1})`;
        }
      }

      path.unshift(seg);

      // Stop once uniquely identifiable
      if (document.querySelectorAll(path.join(' > ')).length === 1) {
        break;
      }

      node = node.parentElement;
    }

    return path.join(' > ') || el.tagName.toLowerCase();
  };

  WP.getLabel = function(el) {
    // 1. Explicit accessible name on the element itself
    const ariaLabel = el.getAttribute('aria-label')?.trim();
    if (ariaLabel) {
      return ariaLabel;
    }

    // 2. aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean).join(' ');
      if (text) {
        return text;
      }
    }

    // 3. Associated <label for="id">
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) {
        return label.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
      }
    }

    // 4. Wrapping <label>
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const text = parentLabel.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60);
      if (text) {
        return text;
      }
    }

    // 5. Standard HTML attributes
    const title       = el.getAttribute('title')?.trim();
    if (title) {
      return title;
    }
    const name        = el.getAttribute('name')?.trim();
    if (name) {
      return name.replace(/[-_]+/g, ' ');
    }
    if (el.id) {
      const idLabel = el.id
        .replace(/[-_]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();
      if (idLabel && !WebPilotStepUtils.isInstructionalLabel(idLabel)) {
        return idLabel.slice(0, 60);
      }
    }
    const placeholder = el.getAttribute('placeholder')?.trim();
    if (placeholder && !WebPilotStepUtils.isInstructionalLabel(placeholder)) {
      return placeholder;
    }

    // 6. Element's own visible text (buttons, links, etc.)
    const ownText = el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (ownText) {
      return ownText;
    }

    // 7. Walk up the DOM tree looking for a nearby human-readable label.
    //    Stops at BODY / our overlay root / after 6 levels.
    const nearbyLabel = WP._findNearbyLabel(el);
    if (nearbyLabel) {
      return nearbyLabel;
    }

    // 8. value attribute (submit buttons)
    const val = el.getAttribute('value')?.trim();
    if (val) {
      return val;
    }

    return '';
  };

  /**
     * Generate a valid variable name from element label or content.
     * Converts label text to snake_case and removes invalid characters.
     */
  WP.generateVariableName = function(el) {
    const label = WP.getLabel(el);
    if (!label) {
      return 'extracted_value';
    }
    const varName = WebPilotStepUtils.labelToVarName(label);
    return varName && varName !== 'value' ? varName : 'extracted_value';
  };

  WP.labelToVarName = function(label) {
    return WebPilotStepUtils.labelToVarName(label);
  };

  /**
     * Look for visible label text near `el` by walking up the DOM.
     * At each ancestor level check:
     *   - an immediately preceding sibling with text
     *   - a child element whose role/tag suggests it is a label
     *   - the ancestor's own aria-label / title
     */
  WP._findNearbyLabel = function(el) {
    const OUR_IDS = new Set(['webpilot-overlay', 'webpilot-progress', 'webpilot-dev-hl']);

    let node = el.parentElement;
    for (let depth = 0; depth < 8 && node && node !== document.body; depth++, node = node.parentElement) {
      if (OUR_IDS.has(node.id)) {
        break;
      }

      // Ancestor's own aria-label / title
      const al = node.getAttribute('aria-label')?.trim();
      if (al) {
        return al;
      }
      const ti = node.getAttribute('title')?.trim();
      if (ti) {
        return ti;
      }

      // Preceding siblings with short visible text (labels, headings, <p>, <span>)
      let sib = node.previousElementSibling;
      for (let s = 0; s < 3 && sib; s++, sib = sib.previousElementSibling) {
        const t = sib.textContent?.trim().replace(/\s+/g, ' ');
        if (t && t.length > 1 && t.length < 80) {
          return t.slice(0, 60);
        }
      }

      // Children of this ancestor that look like labels
      for (const child of node.querySelectorAll('label, [class*="label"], [class*="title"], legend, h1, h2, h3, h4, h5, h6, p')) {
        if (child === el || child.contains(el)) {
          continue;
        }
        const t = child.textContent?.trim().replace(/\s+/g, ' ');
        if (t && t.length > 1 && t.length < 80) {
          return t.slice(0, 60);
        }
      }
    }
    return '';
  };

  /**
     * Extract a human-readable label from a CSS selector string.
     * Priority: aria-label attr > #id > last meaningful tag/class segment > raw selector (truncated).
     */
  WP.labelFromSelector = function(selector) {
    // aria-label attribute in the selector string
    const ariaM = selector.match(/\[aria-label=["']?([^"'\]]+)["']?\]/);
    if (ariaM) {
      return ariaM[1].replace(/\\/g, '').trim();
    }

    // #id in the selector
    const idM = selector.match(/#([\w-]+)/);
    if (idM) {
      return idM[1].replace(/-/g, ' ');
    }

    // Walk the path segments right-to-left looking for a meaningful tag/class
    // e.g. "search-slide-toggle" → "search slide toggle"
    const segments = selector.split(/\s*>\s*/);
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i].trim();
      // Strip pseudo/nth selectors
      const base = seg.replace(/:[\w-]+(\([^)]*\))?/g, '').replace(/\[.*?\]/g, '').trim();
      // Prefer custom element names (contain a hyphen) or class names that look semantic
      const tagM = base.match(/^([a-z][\w-]*)(?:\..*)?$/);
      if (tagM) {
        const tag = tagM[1];
        // Skip purely structural tags
        if (/^(div|span|ul|ol|li|section|article|main|aside|nav|header|footer|form)$/.test(tag)) {
          continue;
        }
        // Convert kebab-case to words
        return tag.replace(/-/g, ' ');
      }
      // Fallback: first meaningful class on this segment
      const clsM = base.match(/\.([\w-]{4,})/);
      if (clsM) {
        return clsM[1].replace(/-/g, ' ').replace(/ng\w*/i, '').trim();
      }
    }

    // Last resort: truncate the raw selector
    return selector.length > 50 ? selector.slice(selector.lastIndexOf('>') + 1).trim().slice(0, 50) : selector;
  };
})(window.WebPilotContent);
