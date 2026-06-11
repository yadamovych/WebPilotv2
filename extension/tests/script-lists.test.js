'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..');

function loadScriptLists() {
  const sandbox = { self: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'lib/script-lists.js'), 'utf8'), sandbox);
  return sandbox.self.WebPilotScripts;
}

function scriptSrcsFromHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const re = /<script\s+src="([^"]+)"><\/script>/g;
  const srcs = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    srcs.push(match[1]);
  }
  return srcs;
}

test('manifest content_scripts.js matches CONTENT_SCRIPT_FILES', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const { CONTENT_SCRIPT_FILES } = loadScriptLists();
  const manifestJs = manifest.content_scripts[0].js;
  assert.deepEqual([...manifestJs], [...CONTENT_SCRIPT_FILES]);
});

test('popup.html scripts match POPUP_SCRIPT_FILES', () => {
  const { POPUP_SCRIPT_FILES } = loadScriptLists();
  const popupScripts = scriptSrcsFromHtml(path.join(EXT, 'popup.html'));
  assert.deepEqual([...popupScripts], [...POPUP_SCRIPT_FILES]);
  assert.equal(popupScripts[0], 'lib/step-utils.js');
});

test('sidepanel.html loads POPUP_SCRIPT_FILES before sidepanel.js', () => {
  const { POPUP_SCRIPT_FILES } = loadScriptLists();
  const sidepanelScripts = scriptSrcsFromHtml(path.join(EXT, 'sidepanel.html'));
  assert.deepEqual(
    [...sidepanelScripts.slice(0, POPUP_SCRIPT_FILES.length)],
    [...POPUP_SCRIPT_FILES],
  );
  assert.equal(sidepanelScripts[POPUP_SCRIPT_FILES.length], 'sidepanel.js');
});

test('all listed script files exist on disk', () => {
  const { CONTENT_SCRIPT_FILES, POPUP_SCRIPT_FILES } = loadScriptLists();
  for (const file of [...CONTENT_SCRIPT_FILES, ...POPUP_SCRIPT_FILES]) {
    assert.ok(fs.existsSync(path.join(EXT, file)), `missing script file: ${file}`);
  }
});
