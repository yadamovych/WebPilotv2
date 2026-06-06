/**
 * WebPilot — Global Error Handler
 * Centralized error logging, recovery, and telemetry
 */

'use strict';

class ErrorTracker {
  constructor() {
    this.errors = [];
    this.maxErrors = 50;
    this.isContentScript = typeof window !== 'undefined' && !chrome.runtime;
    this.isSW = typeof chrome !== 'undefined' && chrome.runtime?.id;
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
   * Persist errors to chrome.storage
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
      }
    } catch (e) {
      // Silently fail if storage unavailable
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
async function reportErrorsToBackend(backendUrl) {
  try {
    const report = await errorTracker.exportErrors();

    // Don't report if no errors
    if (report.errorCount === 0) {
      // eslint-disable-next-line no-console
      console.log('[WebPilot] No errors to report');
      return { success: true, message: 'No errors to report' };
    }

    // eslint-disable-next-line no-console
    console.log(`[WebPilot] Reporting ${report.errorCount} errors to ${backendUrl}/api/extension-errors`);

    const response = await fetch(`${backendUrl}/api/extension-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });

    // eslint-disable-next-line no-console
    console.log(`[WebPilot] Server responded with status ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    await errorTracker.clearErrors();
    // eslint-disable-next-line no-console
    console.log(`[WebPilot] Successfully reported ${report.errorCount} errors`);
    return { success: true, message: `Reported ${report.errorCount} errors` };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[WebPilot] Error reporting failed:', error?.message || error);
    errorTracker.track(error, { operation: 'report-to-backend' });
    return { success: false, error: error?.message || String(error) };
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
  // eslint-disable-next-line no-console
  console.log(`[WebPilot] Error reporting started (interval: ${intervalMinutes} min, backend: ${backendUrl})`);

  // Report immediately if there are errors
  reportErrorsToBackend(backendUrl).then((result) => {
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.warn('[WebPilot] Initial error report failed:', result.error);
    }
  });

  // Then schedule periodic reporting
  setInterval(async () => {
    const result = await reportErrorsToBackend(backendUrl);
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.warn('[WebPilot] Error report failed:', result.error);
    }
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
  };
}
