// WebPilot content — injection guard and shared namespace
(function (global) {
  'use strict';
  if (global.__webpilotContentLoaded) {
    global.__webpilotSkipModules = true;
    return;
  }
  global.__webpilotContentLoaded = true;
  if (global.__webpilotLoaded) {
    global.__webpilotSkipModules = true;
    return;
  }
  global.__webpilotLoaded = true;

  global.WebPilotContent = { state: {}, fn: {} };
  const WP = global.WebPilotContent;
  WP.state = {
    isRecording: false,
    overlayRoot: null,
    hoveredEl: null,
    // Set while we programmatically write a resolved extracted-variable preview
    // back into a field, so the synthetic 'input' event it dispatches is ignored
    // by the recorder (otherwise the template reference would be overwritten by
    // the resolved literal).
    previewApplying: false,
    inputTimers: new Map(),
    extractedValues: new Map(),
    extractedValuesInitialized: false,
    lastRightClickedEl: null,
    handlers: {},
  };
  WP.state.extractedValuesReady = new Promise((resolve) => {
    global.__webpilotResolveExtractedValues = resolve;
  });
})(window);
