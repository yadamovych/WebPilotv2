// WebPilot content — variables
(function (WP) {
  'use strict';
  if (window.__webpilotSkipModules) {
    return;
  }
  // Wait for extracted values to be loaded before using them
  WP.waitForExtractedValues = async function() {
    if (WP.state.extractedValuesInitialized) {
      return;
    }
    await WP.state.extractedValuesReady;
  };

  // Store extracted values in chrome.storage for cross-frame/page access
  WP.storeExtractedValue = function(varName, value) {
    WP.state.extractedValues.set(varName, value);
    WP.safeStorageSet({ [`extracted_${varName}`]: value });
  };

  WP.getExtractedValue = function(varName) {
    return WP.state.extractedValues.get(varName);
  };

  WP.getAvailableVariablesForFilling = function(callback) {
    // Get extracted values first
    const extracted = Array.from(WP.state.extractedValues.entries());

    // Also get recorded extract steps from background (for recording phase variables)
    WP.safeSend({ type: 'GET_STATE' }, (res) => {
      const steps = res?.state?.steps || [];
      const extractSteps = steps.filter(step => step.action === 'extract');

      // Combine: show extracted values first, then recorded variables with 'pending' prefix
      const combined = [
        ...extracted,
        ...extractSteps
          .filter(step => !WP.state.extractedValues.has(step.variable))
          .map(step => [step.variable, null]), // null value = not yet extracted
      ];

      callback(combined);
    });
  };

  // Load extracted values from storage on initialization
  WP.safeStorageGet(null, (items) => {
    let loadedCount = 0;
    Object.entries(items || {}).forEach(([key, value]) => {
      if (key.startsWith('extracted_')) {
        const varName = key.replace('extracted_', '');
        WP.state.extractedValues.set(varName, value);
        loadedCount++;
        // eslint-disable-next-line no-console
        console.log(
          `[WebPilot] Loaded extracted value from storage: ${varName} = ${String(value).substring(0, 50)}`,
        );
      }
    });
    // eslint-disable-next-line no-console
    console.log(`[WebPilot] Loaded ${loadedCount} extracted values from chrome.storage.local`);
    // Mark initialization as complete and resolve the promise
    WP.state.extractedValuesInitialized = true;
    if (window.__webpilotResolveExtractedValues) {
      window.__webpilotResolveExtractedValues();
    }
  });

  // Listen for storage changes from other tabs/frames (real-time sync for parallel execution)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    // Update WP.state.extractedValues when any tab/frame changes them
    Object.entries(changes).forEach(([key, change]) => {
      if (key.startsWith('extracted_')) {
        const varName = key.replace('extracted_', '');
        const newValue = change.newValue;

        if (newValue !== undefined) {
          WP.state.extractedValues.set(varName, newValue);
          // eslint-disable-next-line no-console
          console.log(
            `[WebPilot] Synced extracted value from another tab: ${varName} = ${String(newValue).substring(0, 50)}`,
          );
        } else {
          // Value was cleared/deleted
          WP.state.extractedValues.delete(varName);
          // eslint-disable-next-line no-console
          console.log(`[WebPilot] Cleared extracted value from another tab: ${varName}`);
        }
      }
    });
  });

  // Extract text/value from element by selector
  WP.extractFromElement = function(selector, extractType = 'text') {
    if (!selector) {
      return '';
    }
    const el = document.querySelector(selector);
    const matchCount = document.querySelectorAll(selector).length;
    if (!el) {
      const msg = `Selector "${selector}" matched 0 elements`;
      // Track this warning for error reporting (silent - no console output)
      if (typeof errorTracker !== 'undefined') {
        errorTracker.track(
          new Error(msg),
          { context: 'extractFromElement', extractType, selector },
        );
      }
      return '';
    }

    try {
      if (extractType === 'value') {
        // Get value from input/textarea
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          const val = String(el.value || '');
          // eslint-disable-next-line no-console
          console.log(`[WebPilot] Extract by value from ${selector}: matched ${matchCount} element(s), got: "${val.substring(0, 50)}${val.length > 50 ? '...' : ''}"`);
          return val;
        }
        // Try data attributes
        if (el.hasAttribute('data-value')) {
          const val = String(el.getAttribute('data-value') || '');
          // eslint-disable-next-line no-console
          console.log(`[WebPilot] Extract data-value from ${selector}: matched ${matchCount} element(s), got: "${val.substring(0, 50)}${val.length > 50 ? '...' : ''}"`);
          return val;
        }
        const val = String(el.textContent?.trim() || '');
        // eslint-disable-next-line no-console
        console.log(`[WebPilot] Extract textContent from ${selector}: matched ${matchCount} element(s), got: "${val.substring(0, 50)}${val.length > 50 ? '...' : ''}"`);
        return val;
      }

      // Default: extract text content
      let val;
      if (el.isContentEditable) {
        val = String(el.textContent?.trim() || '');
      } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        val = String(el.value || '');
      } else {
        val = String(el.textContent?.trim() || '');
      }
      // eslint-disable-next-line no-console
      console.log(`[WebPilot] Extract text from ${selector}: matched ${matchCount} element(s), got: "${val.substring(0, 50)}${val.length > 50 ? '...' : ''}"`);
      return val;
    } catch (err) {
      // Track extraction errors (silent - no console output)
      if (typeof errorTracker !== 'undefined') {
        errorTracker.track(err, { context: 'extractFromElement', selector });
      }
      return '';
    }
  };

  /**
     * Request AI-powered alternative selectors from the backend for a failing
     * selector. Returns an array of { selector, flexibility, ... } (possibly empty).
     * Shared by extract recovery and action (click/type/select) recovery.
     */
  WP.getSelectorAlternatives = async function(selector, { extractType = 'text', description = 'Element not found or not ready' } = {}) {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'GET_SELECTOR_ALTERNATIVES',
            selector,
            extractType,
            description,
            pageUrl: window.location.href,
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(resp);
            }
          },
        );
      });

      if (!response?.success || !response.alternatives?.length) {
        return [];
      }
      return response.alternatives;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WebPilot] Error fetching selector alternatives:', err);
      return [];
    }
  };

  /**
     * Resolve an element for an action step (click/type/select/key), with the
     * same AI-powered selector recovery used for extraction.
     * Returns the resolved Element, or null if neither the original selector nor
     * any alternative matched.
     */
  WP.resolveElementWithRetry = async function(selector, timeoutMs, description, extraSelectors) {
    const candidates = [...new Set([...(extraSelectors || []), selector].filter(Boolean))];
    for (const sel of candidates) {
      const el = await WP.waitForElement(sel, Math.min(timeoutMs, 5000));
      if (el) {
        if (sel !== selector) {
          // eslint-disable-next-line no-console
          console.log(`[WebPilot] Matched fallback selector: ${sel}`);
        }
        el.__wpSelectorUsed = sel;
        return el;
      }
    }

    // eslint-disable-next-line no-console
    console.warn(`[WebPilot] Selector not found: ${selector}`);
    if (!WP.state.aiSelectorRecovery) {
      return null;
    }

    // eslint-disable-next-line no-console
    console.warn(`[WebPilot] Requesting AI selector alternatives: ${selector}`);
    const alternatives = await WP.getSelectorAlternatives(selector, { description });

    for (const alt of alternatives) {
      const altEl = await WP.waitForElement(alt.selector, 3000);
      if (altEl) {
        // eslint-disable-next-line no-console
        console.log(
          `[WebPilot] ✅ Action selector recovery succeeded!\nOriginal: ${selector}\nRecovered with: ${alt.selector}\nFlexibility: ${alt.flexibility}`,
        );
        if (typeof errorTracker !== 'undefined') {
          errorTracker.track(
            new Error('Selector Recovery Success'),
            { context: 'resolveElementWithRetry', original: selector, recovered: alt.selector, flexibility: alt.flexibility },
          );
        }
        altEl.__wpSelectorUsed = alt.selector;
        return altEl;
      }
    }

    return null;
  };

  /**
     * Extract from element with automatic selector retry/recovery
     * If the original selector fails, requests AI-powered alternatives from backend
     */
  WP.extractFromElementWithRetry = async function(selector, extractType = 'text') {
    // First wait for element to exist (page may still be loading)
    const waitTimeout = 6000; // 6 second timeout for element to appear
    try {
      const el = await WP.waitForElement(selector, waitTimeout);
      if (el) {
        // Element exists, now extract from it
        const result = WP.extractFromElement(selector, extractType);
        if (result) {
          // eslint-disable-next-line no-console
          console.log('[WebPilot] Extraction succeeded with original selector');
          return result;
        }
      }
    } catch (err) {
      // waitForElement timeout or error — element still not found
      // eslint-disable-next-line no-console
      console.log('[WebPilot] Element not found or still loading, requesting alternatives...');
    }

    // Element not available or extraction failed — try AI alternatives only when enabled
    if (!WP.state.aiSelectorRecovery) {
      return '';
    }

    try {
      const alternativesList = await WP.getSelectorAlternatives(selector, {
        extractType,
        description: 'Element not found or not ready',
      });

      if (!alternativesList.length) {
        // eslint-disable-next-line no-console
        console.warn('[WebPilot] No alternatives available');
        return '';
      }

      // Try each alternative selector in order of flexibility
      for (const alt of alternativesList) {
        try {
          // Wait for alternative selector too
          const altEl = await WP.waitForElement(alt.selector, 3000);
          if (altEl) {
            const altResult = WP.extractFromElement(alt.selector, extractType);
            if (altResult) {
              // eslint-disable-next-line no-console
              console.log(
                `[WebPilot] ✅ Selector recovery succeeded!\nOriginal: ${selector}\nRecovered with: ${alt.selector}\nFlexibility: ${alt.flexibility}`,
              );

              // Track successful recovery
              if (typeof errorTracker !== 'undefined') {
                errorTracker.track(
                  new Error('Selector Recovery Success'),
                  {
                    context: 'extractFromElementWithRetry',
                    original: selector,
                    recovered: alt.selector,
                    flexibility: alt.flexibility,
                    extractType,
                  },
                );
              }

              return altResult;
            }
          }
        } catch (altErr) {
          // This alternative selector also not found, try next one
          continue;
        }
      }

      // None of the alternatives worked
      // eslint-disable-next-line no-console
      console.warn('[WebPilot] No alternative selectors matched');
      return '';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WebPilot] Error during selector recovery:', err);
      if (typeof errorTracker !== 'undefined') {
        errorTracker.track(err, {
          context: 'extractFromElementWithRetry',
          selector,
          stage: 'recovery-attempt',
        });
      }
      return '';
    }
  };
})(window.WebPilotContent);
