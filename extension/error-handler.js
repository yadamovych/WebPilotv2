/**
 * WebPilot — Global Error Handler
 * Centralized error logging, recovery, and telemetry
 */

'use strict';

class ErrorTracker {
  constructor() {
    this.errors = [];
    this.maxErrors = 50;
    const hasRuntime = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
    const hasWindow = typeof window !== 'undefined';
    // Service worker: extension runtime available, no DOM window.
    this.isSW = hasRuntime && !hasWindow;
    // Content script: extension runtime available AND a DOM window present.
    this.isContentScript = hasRuntime && hasWindow;
  }

  /**
   * Log an error with context
   */
  track(error, context = {}) {
    const errorRecord = {
      timestamp: new Date().toISOString(),
      message: error?.message || String(error),
      stack: error?.stack || '',
      context,
      url: typeof window !== 'undefined' ? window.location?.href : 'N/A',
      type: error?.name || 'Unknown',
    };

    this.errors.push(errorRecord);

    // Keep memory bounded
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    // Log to console in dev mode
    if (context.devMode) {
      console.error('[WebPilot Error]', errorRecord);
    }

    // Store to chrome.storage for later retrieval
    if (this.isSW || this.isContentScript) {
      this.persistError(errorRecord);
    }

    return errorRecord;
  }

  /**
   * Persist errors to chrome.storage (SW) or forward to the SW (content script)
   */
  persistError(errorRecord) {
    try {
      if (this.isSW) {
        chrome.storage.local.get(['webpilot_errors'], (result) => {
          const errors = result.webpilot_errors || [];
          errors.push(errorRecord);
          // Keep last 100 errors
          if (errors.length > 100) {
            errors.shift();
          }
          chrome.storage.local.set({ webpilot_errors: errors });
        });
      } else if (this.isContentScript) {
        // Content scripts lack storage permissions; forward the record to the
        // service worker, which owns chrome.storage.local.
        chrome.runtime.sendMessage(
          { type: 'TRACK_ERROR', errorRecord },
          () => {
            // Swallow lastError (e.g. SW asleep); the in-memory log still holds it.
            void chrome.runtime.lastError;
          },
        );
      }
    } catch (e) {
      // Silently fail if storage/messaging unavailable
    }
  }

  /**
   * Retrieve all tracked errors
   */
  async getErrors() {
    return new Promise((resolve) => {
      try {
        if (this.isSW) {
          chrome.storage.local.get(['webpilot_errors'], (result) => {
            resolve(result.webpilot_errors || []);
          });
        } else {
          resolve(this.errors);
        }
      } catch (e) {
        resolve(this.errors);
      }
    });
  }

  /**
   * Clear error logs
   */
  async clearErrors() {
    this.errors = [];
    if (this.isSW) {
      chrome.storage.local.remove(['webpilot_errors']);
    }
  }

  /**
   * Export errors for reporting
   */
  async exportErrors() {
    const errors = await this.getErrors();
    return {
      exportDate: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version,
      errorCount: errors.length,
      errors,
    };
  }
}

// Global instance
const errorTracker = new ErrorTracker();

/**
 * Safe wrapper for chrome API calls
 */
function safeChrome(operation, fallback = null) {
  try {
    if (!chrome.runtime?.id) {
      throw new Error('Extension context invalidated');
    }
    return operation();
  } catch (error) {
    errorTracker.track(error, { operation: 'chrome-api' });
    return fallback;
  }
}

/**
 * Safe messaging with timeout
 */
function sendMessageSafe(message, options = {}) {
  const { timeout = 5000, fallback = null } = options;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      errorTracker.track(
        new Error(`Message timeout: ${JSON.stringify(message)}`),
        { type: 'message-timeout' },
      );
      resolve(fallback);
    }, timeout);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        clearTimeout(timeoutId);
        if (chrome.runtime.lastError) {
          errorTracker.track(
            new Error(chrome.runtime.lastError.message),
            { message, type: 'message-error' },
          );
          resolve(fallback);
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      clearTimeout(timeoutId);
      errorTracker.track(error, { message, type: 'message-exception' });
      resolve(fallback);
    }
  });
}

/**
 * Safe storage operations
 */
const safeStor = {
  async get(keys) {
    try {
      return await chrome.storage.session.get(keys);
    } catch (error) {
      errorTracker.track(error, { operation: 'storage.get', keys });
      return {};
    }
  },

  async set(items) {
    try {
      return await chrome.storage.session.set(items);
    } catch (error) {
      errorTracker.track(error, { operation: 'storage.set' });
    }
  },

  async remove(keys) {
    try {
      return await chrome.storage.session.remove(keys);
    } catch (error) {
      errorTracker.track(error, { operation: 'storage.remove' });
    }
  },
};

/**
 * Report errors to backend (optional)
 */
let errorReportIntervalId = null;
let errorReportInFlight = false;

function stopErrorReporting() {
  if (errorReportIntervalId !== null) {
    clearInterval(errorReportIntervalId);
    errorReportIntervalId = null;
  }
}

async function reportErrorsToBackend(backendUrl) {
  if (errorReportInFlight) {
    return { success: false, error: 'Report already in progress' };
  }

  errorReportInFlight = true;
  try {
    const report = await errorTracker.exportErrors();

    // Don't report if no errors
    if (report.errorCount === 0) {
      return { success: true, message: 'No errors to report' };
    }

    const response = await fetch(`${backendUrl}/api/extension-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    await errorTracker.clearErrors();
    return { success: true, message: `Reported ${report.errorCount} errors` };
  } catch (error) {
    // Do not track reporting failures — that creates a feedback loop where each
    // failed report adds another error and the queue never drains.
    console.warn('[WebPilot] Error reporting failed:', error?.message || error);
    return { success: false, error: error?.message || String(error) };
  } finally {
    errorReportInFlight = false;
  }
}

/**
 * Get AI-powered alternative selectors for failed selector
 * NOTE: This function is now handled by the background service worker
 * to reduce content script permissions. See background.js GET_SELECTOR_ALTERNATIVES handler.
 */

/**
 * Start periodic error reporting (call from background.js)
 */
function startErrorReporting(backendUrl, intervalMinutes = 5) {
  stopErrorReporting();

  // Report once on startup when there are queued errors.
  reportErrorsToBackend(backendUrl).catch(() => {});

  errorReportIntervalId = setInterval(() => {
    reportErrorsToBackend(backendUrl).catch(() => {});
  }, intervalMinutes * 60 * 1000);
}

// Export for use in other scripts
// eslint-disable-next-line no-undef
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  // eslint-disable-next-line no-undef
  module.exports = {
    errorTracker,
    safeChrome,
    sendMessageSafe,
    safeStor,
    reportErrorsToBackend,
    startErrorReporting,
    stopErrorReporting,
  };
}
