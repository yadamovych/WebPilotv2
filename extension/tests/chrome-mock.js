'use strict';

/**
 * Minimal in-memory mock of the chrome.* APIs used by error-handler.js.
 * Returned by makeChromeMock() so each test gets a clean instance.
 */
function makeChromeMock(opts = {}) {
  const localData = {};
  const sessionData = {};
  let lastError = null;

  const store = (data) => ({
    get(keys, cb) {
      const out = {};
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) {
        if (k in data) out[k] = data[k];
      }
      // chrome storage.local.get uses callbacks
      if (typeof cb === 'function') {
        cb(out);
        return undefined;
      }
      // storage.session.get is awaited (promise) in error-handler.js
      return Promise.resolve(out);
    },
    set(items, cb) {
      Object.assign(data, items);
      if (typeof cb === 'function') { cb(); return undefined; }
      return Promise.resolve();
    },
    remove(keys, cb) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete data[k];
      if (typeof cb === 'function') { cb(); return undefined; }
      return Promise.resolve();
    },
  });

  return {
    runtime: {
      id: 'runtimeId' in opts ? opts.runtimeId : 'mock-extension-id',
      get lastError() { return lastError; },
      set lastError(v) { lastError = v; },
      getManifest: () => ({ version: opts.version || '1.0.0' }),
      sendMessage: opts.sendMessage
        || ((message, cb) => { if (cb) cb({ ok: true }); }),
    },
    storage: {
      local: store(localData),
      session: store(sessionData),
    },
    __data: { localData, sessionData },
    __setLastError(v) { lastError = v; },
  };
}

module.exports = { makeChromeMock };
