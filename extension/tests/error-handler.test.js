'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { makeChromeMock } = require('./chrome-mock');

const MODULE_PATH = path.resolve(__dirname, '..', 'error-handler.js');

/**
 * Load a fresh copy of error-handler.js with a freshly-mocked chrome global.
 * The module instantiates a singleton ErrorTracker on load and reads `chrome`
 * in its constructor, so we must (1) set global.chrome first and (2) bust the
 * require cache to get clean state per test.
 *
 * Pass `context: 'content'` to emulate a content script (chrome.runtime + window)
 * or the default service-worker context (chrome.runtime, no window).
 */
function loadHandler(chromeMockOpts = {}) {
  const { context, ...mockOpts } = chromeMockOpts;
  const chrome = makeChromeMock(mockOpts);
  global.chrome = chrome;
  if (context === 'content') {
    global.window = { location: { href: 'https://example.com/page' } };
  } else {
    delete global.window;
  }
  delete require.cache[MODULE_PATH];
  // eslint-disable-next-line global-require
  const mod = require(MODULE_PATH);
  return { mod, chrome };
}

test('track() builds a record matching the server schema', () => {
  const { mod } = loadHandler();
  const rec = mod.errorTracker.track(new Error('boom'), { foo: 'bar' });

  // Fields required by server ExtensionErrorRecord model
  for (const field of ['timestamp', 'message', 'stack', 'context', 'url', 'type']) {
    assert.ok(field in rec, `record missing field: ${field}`);
  }
  assert.strictEqual(rec.message, 'boom');
  assert.strictEqual(rec.type, 'Error');
  assert.deepStrictEqual(rec.context, { foo: 'bar' });
});

test('track() accepts a non-Error value', () => {
  const { mod } = loadHandler();
  const rec = mod.errorTracker.track('plain string error');
  assert.strictEqual(rec.message, 'plain string error');
  assert.strictEqual(rec.type, 'Unknown');
});

test('in-memory error log is bounded to maxErrors', () => {
  const { mod } = loadHandler();
  const tracker = mod.errorTracker;
  for (let i = 0; i < tracker.maxErrors + 20; i += 1) {
    tracker.track(new Error(`e${i}`));
  }
  assert.strictEqual(tracker.errors.length, tracker.maxErrors);
  // Oldest dropped, newest kept
  assert.strictEqual(tracker.errors[tracker.errors.length - 1].message, `e${tracker.maxErrors + 19}`);
});

test('persistError() writes to chrome.storage.local in SW context', async () => {
  const { mod, chrome } = loadHandler();
  mod.errorTracker.track(new Error('persist me'));
  // persistError uses a callback; give microtasks a tick
  await new Promise((r) => setTimeout(r, 0));
  const stored = chrome.__data.localData.webpilot_errors;
  assert.ok(Array.isArray(stored));
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(stored[0].message, 'persist me');
});

test('context detection: SW context (chrome.runtime, no window)', () => {
  const { mod } = loadHandler();
  assert.strictEqual(mod.errorTracker.isSW, true);
  assert.strictEqual(mod.errorTracker.isContentScript, false);
});

test('context detection: content-script context (chrome.runtime + window)', () => {
  const { mod } = loadHandler({ context: 'content' });
  assert.strictEqual(mod.errorTracker.isSW, false);
  assert.strictEqual(mod.errorTracker.isContentScript, true);
});

test('content-script track() forwards the record to the SW via TRACK_ERROR', () => {
  let forwarded = null;
  const { mod } = loadHandler({
    context: 'content',
    sendMessage: (msg, cb) => { forwarded = msg; if (cb) cb({ success: true }); },
  });
  mod.errorTracker.track(new Error('from content script'), { area: 'dom' });

  assert.ok(forwarded, 'expected a message to be forwarded to the SW');
  assert.strictEqual(forwarded.type, 'TRACK_ERROR');
  assert.strictEqual(forwarded.errorRecord.message, 'from content script');
  assert.strictEqual(forwarded.errorRecord.url, 'https://example.com/page');
});

test('content-script persistError() swallows lastError when SW is asleep', () => {
  const { mod, chrome } = loadHandler({
    context: 'content',
    sendMessage: (msg, cb) => {
      chrome.runtime.lastError = { message: 'Receiving end does not exist' };
      cb(undefined);
      chrome.runtime.lastError = null;
    },
  });
  // Should not throw despite lastError being set.
  assert.doesNotThrow(() => mod.errorTracker.track(new Error('sw asleep')));
  // In-memory log still retains the error.
  assert.strictEqual(mod.errorTracker.errors.length, 1);
});

test('getErrors() returns persisted errors in SW context', async () => {
  const { mod } = loadHandler();
  mod.errorTracker.track(new Error('a'));
  mod.errorTracker.track(new Error('b'));
  await new Promise((r) => setTimeout(r, 0));
  const errors = await mod.errorTracker.getErrors();
  assert.strictEqual(errors.length, 2);
});

test('clearErrors() empties in-memory and storage', async () => {
  const { mod, chrome } = loadHandler();
  mod.errorTracker.track(new Error('x'));
  await new Promise((r) => setTimeout(r, 0));
  await mod.errorTracker.clearErrors();
  assert.strictEqual(mod.errorTracker.errors.length, 0);
  assert.ok(!('webpilot_errors' in chrome.__data.localData));
});

test('exportErrors() returns server-report shape', async () => {
  const { mod } = loadHandler({ version: '2.3.4' });
  mod.errorTracker.track(new Error('one'));
  await new Promise((r) => setTimeout(r, 0));
  const report = await mod.errorTracker.exportErrors();
  for (const field of ['exportDate', 'extensionVersion', 'errorCount', 'errors']) {
    assert.ok(field in report, `report missing field: ${field}`);
  }
  assert.strictEqual(report.extensionVersion, '2.3.4');
  assert.strictEqual(report.errorCount, report.errors.length);
});

test('safeChrome() returns operation result on success', () => {
  const { mod } = loadHandler();
  const result = mod.safeChrome(() => 42, 'fallback');
  assert.strictEqual(result, 42);
});

test('safeChrome() returns fallback and tracks error when context invalidated', () => {
  const { mod } = loadHandler({ runtimeId: undefined }); // no runtime.id
  const before = mod.errorTracker.errors.length;
  const result = mod.safeChrome(() => 'never', 'fallback');
  assert.strictEqual(result, 'fallback');
  assert.strictEqual(mod.errorTracker.errors.length, before + 1);
});

test('sendMessageSafe() resolves with the response on success', async () => {
  const { mod } = loadHandler({
    sendMessage: (msg, cb) => cb({ ok: true, echo: msg.type }),
  });
  const res = await mod.sendMessageSafe({ type: 'PING' });
  assert.deepStrictEqual(res, { ok: true, echo: 'PING' });
});

test('sendMessageSafe() resolves fallback and tracks error on lastError', async () => {
  const { mod, chrome } = loadHandler({
    sendMessage: (msg, cb) => {
      chrome.runtime.lastError = { message: 'no receiver' };
      cb(undefined);
      chrome.runtime.lastError = null;
    },
  });
  const res = await mod.sendMessageSafe({ type: 'PING' }, { fallback: 'FB' });
  assert.strictEqual(res, 'FB');
  assert.ok(mod.errorTracker.errors.some((e) => e.message === 'no receiver'));
});

test('sendMessageSafe() resolves fallback on timeout', async () => {
  const { mod } = loadHandler({
    sendMessage: () => { /* never calls back */ },
  });
  const res = await mod.sendMessageSafe({ type: 'SLOW' }, { timeout: 20, fallback: 'TO' });
  assert.strictEqual(res, 'TO');
  assert.ok(mod.errorTracker.errors.some((e) => e.context.type === 'message-timeout'));
});

test('safeStor.get/set/remove operate on chrome.storage.session', async () => {
  const { mod, chrome } = loadHandler();
  await mod.safeStor.set({ k: 'v' });
  assert.strictEqual(chrome.__data.sessionData.k, 'v');
  const got = await mod.safeStor.get(['k']);
  assert.deepStrictEqual(got, { k: 'v' });
  await mod.safeStor.remove(['k']);
  assert.ok(!('k' in chrome.__data.sessionData));
});

test('reportErrorsToBackend() short-circuits when there are no errors', async () => {
  const { mod } = loadHandler();
  global.fetch = () => { throw new Error('fetch should not be called'); };
  const result = await mod.reportErrorsToBackend('http://localhost:8000');
  assert.strictEqual(result.success, true);
  assert.match(result.message, /No errors/);
  delete global.fetch;
});

test('reportErrorsToBackend() posts the report and clears on success', async () => {
  const { mod } = loadHandler();
  mod.errorTracker.track(new Error('report me'));
  await new Promise((r) => setTimeout(r, 0));

  let captured = null;
  global.fetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 200, text: async () => '' };
  };

  const result = await mod.reportErrorsToBackend('http://localhost:8000');
  assert.strictEqual(result.success, true);
  assert.strictEqual(captured.url, 'http://localhost:8000/api/extension-errors');
  assert.strictEqual(captured.body.errorCount, captured.body.errors.length);
  // Errors cleared after a successful report
  const remaining = await mod.errorTracker.getErrors();
  assert.strictEqual(remaining.length, 0);
  delete global.fetch;
});

test('reportErrorsToBackend() returns failure on non-OK response', async () => {
  const { mod } = loadHandler();
  mod.errorTracker.track(new Error('report me'));
  await new Promise((r) => setTimeout(r, 0));

  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'internal error' });
  const result = await mod.reportErrorsToBackend('http://localhost:8000');
  assert.strictEqual(result.success, false);
  assert.match(result.error, /500/);
  delete global.fetch;
});

test('reportErrorsToBackend() does not enqueue a reporting failure', async () => {
  const { mod } = loadHandler();
  mod.errorTracker.track(new Error('original'));
  await new Promise((r) => setTimeout(r, 0));

  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'fail' });
  await mod.reportErrorsToBackend('http://localhost:8000');

  const remaining = await mod.errorTracker.getErrors();
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].message, 'original');
  delete global.fetch;
});

test('startErrorReporting() replaces an existing interval', () => {
  const { mod } = loadHandler();
  const calls = [];
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  global.setInterval = (fn, ms) => {
    calls.push(['set', ms]);
    return 101;
  };
  global.clearInterval = (id) => {
    calls.push(['clear', id]);
  };

  mod.startErrorReporting('http://localhost:8000', 5);
  mod.startErrorReporting('http://localhost:8000', 10);

  assert.deepStrictEqual(calls, [
    ['set', 5 * 60 * 1000],
    ['clear', 101],
    ['set', 10 * 60 * 1000],
  ]);

  mod.stopErrorReporting();
  assert.deepStrictEqual(calls.at(-1), ['clear', 101]);

  global.setInterval = originalSetInterval;
  global.clearInterval = originalClearInterval;
});
