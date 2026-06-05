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
    const response = await fetch(`${backendUrl}/api/extension-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await errorTracker.clearErrors();
    return { success: true };
  } catch (error) {
    errorTracker.track(error, { operation: 'report-to-backend' });
    return { success: false, error: error.message };
  }
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
  };
}
