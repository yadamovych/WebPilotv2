/**
 * Shared script load order for content scripts and popup modules.
 * Keep manifest.json content_scripts.js in sync with CONTENT_SCRIPT_FILES.
 */
(function (global) {
  'use strict';

  global.WebPilotScripts = {
    CONTENT_SCRIPT_FILES: [
      'error-handler.js',
      'lib/selector-alternatives.js',
      'lib/step-utils.js',
      'content/guard.js',
      'content/context.js',
      'content/variables.js',
      'content/messages.js',
      'content/recording.js',
      'content/overlay.js',
      'content/recording-events.js',
      'content/selectors.js',
      'content/playback.js',
      'content/bootstrap.js',
    ],
    POPUP_SCRIPT_FILES: [
      'lib/step-utils.js',
      'popup/core.js',
      'popup/utils.js',
      'popup/tabs.js',
      'popup/settings.js',
      'popup/templates.js',
      'popup/playback.js',
      'popup/recording.js',
      'popup/steps.js',
      'popup/messages.js',
      'popup/events.js',
      'popup/init-bootstrap.js',
      'popup/init-exports.js',
    ],
  };
})(typeof self !== 'undefined' ? self : globalThis);
