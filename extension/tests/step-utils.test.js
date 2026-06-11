'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const vm = require('node:vm');

const MODULE_PATH = path.resolve(__dirname, '../lib/step-utils.js');

function loadStepUtils() {
  const code = require('fs').readFileSync(MODULE_PATH, 'utf8');
  const sandbox = { self: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.self.WebPilotStepUtils;
}

test('scoreSelectorQuality marks data-testid as stable', () => {
  const utils = loadStepUtils();
  const result = utils.scoreSelectorQuality('[data-testid="submit"]');
  assert.strictEqual(result.score, 'stable');
});

test('scoreSelectorQuality marks nth-child as fragile', () => {
  const utils = loadStepUtils();
  const result = utils.scoreSelectorQuality('div > span:nth-child(2)');
  assert.strictEqual(result.score, 'fragile');
});

test('sanitizeRecordedSteps drops empty type steps', () => {
  const utils = loadStepUtils();
  const out = utils.sanitizeRecordedSteps([
    { action: 'click', selector: '#a' },
    { action: 'type', selector: '#a', value: '' },
    { action: 'type', selector: '#b', value: 'hello' },
  ]);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[1].value, 'hello');
});

test('sanitizeRecordedSteps removes duplicate consecutive steps', () => {
  const utils = loadStepUtils();
  const step = { action: 'click', selector: '#btn', value: null };
  const out = utils.sanitizeRecordedSteps([step, { ...step }]);
  assert.strictEqual(out.length, 1);
});

test('sanitizeRecordedSteps skips checkbox type after click', () => {
  const utils = loadStepUtils();
  const out = utils.sanitizeRecordedSteps([
    { action: 'click', selector: '#cb' },
    { action: 'type', selector: '#cb', value: 'on', elementHint: 'input type=checkbox' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].action, 'click');
});

test('sanitizeRecordedSteps drops all checkbox type steps', () => {
  const utils = loadStepUtils();
  const out = utils.sanitizeRecordedSteps([
    { action: 'type', selector: '#cb', value: 'on', elementHint: 'INPUT[type=checkbox]' },
  ]);
  assert.strictEqual(out.length, 0);
});

test('sanitizeRecordedSteps collapses native select noise to one select', () => {
  const utils = loadStepUtils();
  const selectHint = 'SELECT[name=currentLow][#currentLow]';
  const out = utils.sanitizeRecordedSteps([
    { action: 'click', selector: '#currentLow', elementHint: selectHint },
    { action: 'select', selector: '#currentLow', value: 'number:2018', elementHint: selectHint },
    { action: 'click', selector: '#currentLow', elementHint: selectHint },
    { action: 'type', selector: '#currentLow', value: '2018', elementHint: selectHint, suggestedVar: 'year_from' },
    { action: 'select', selector: '#currentLow', value: 'number:2020', elementHint: selectHint },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].action, 'select');
  assert.strictEqual(out[0].value, 'number:2020');
});

test('sanitizeRecordedSteps normalizes {{var}} to match suggestedVar', () => {
  const utils = loadStepUtils();
  const out = utils.sanitizeRecordedSteps([
    {
      action: 'type',
      selector: '#input-search',
      value: '{{search}}',
      suggestedVar: 'searchInventory',
      label: 'Search inventory',
    },
  ]);
  assert.strictEqual(out[0].value, '{{searchInventory}}');
});

test('shouldDropRecordedAction blocks select clicks and types', () => {
  const utils = loadStepUtils();
  const hint = 'SELECT[name=currentLow][#currentLow]';
  assert.strictEqual(utils.shouldDropRecordedAction({
    action: 'click',
    selector: '#currentLow',
    elementHint: hint,
  }, null), true);
  assert.strictEqual(utils.shouldDropRecordedAction({
    action: 'type',
    selector: '#currentLow',
    elementHint: hint,
    value: '2018',
  }, null), true);
  assert.strictEqual(utils.shouldDropRecordedAction({
    action: 'click',
    selector: '#currentLow',
    elementHint: hint,
  }, { action: 'select', selector: '#currentLow' }), true);
});

test('sanitizeRecordedSteps collapses copart-style year dropdown recording', () => {
  const utils = loadStepUtils();
  const lowHint = 'SELECT[name=currentLow][#currentLow]';
  const highHint = 'SELECT[name=currentHigh][#currentHigh]';
  const noisy = [
    { action: 'navigate', value: 'https://www.copart.com/' },
    { action: 'type', selector: '#input-search', value: '{{search}}', suggestedVar: 'searchInventory' },
    { action: 'click', selector: '#title_group_code_TITLEGROUP_C', elementHint: 'INPUT[type=checkbox]' },
    { action: 'click', selector: '#currentLow', elementHint: lowHint },
    { action: 'select', selector: '#currentLow', value: 'number:{{year_from}}', elementHint: lowHint },
    { action: 'click', selector: '#currentLow', elementHint: lowHint },
    { action: 'type', selector: '#currentLow', value: '{{year_from}}', elementHint: lowHint, suggestedVar: 'year_from' },
    { action: 'click', selector: '#currentHigh', elementHint: highHint },
    { action: 'select', selector: '#currentHigh', value: 'number:{{year_to}}', elementHint: highHint },
    { action: 'click', selector: '#currentHigh', elementHint: highHint },
    { action: 'type', selector: '#currentHigh', value: '{{year_to}}', elementHint: highHint, suggestedVar: 'year_to' },
  ];
  const out = utils.sanitizeRecordedSteps(noisy);
  assert.strictEqual(out.length, 5);
  assert.strictEqual(out[1].value, '{{searchInventory}}');
  assert.strictEqual(out[3].action, 'select');
  assert.strictEqual(out[3].selector, '#currentLow');
  assert.strictEqual(out[4].action, 'select');
  assert.strictEqual(out[4].selector, '#currentHigh');
});

test('getStepSelectors prefers selectors array', () => {
  const utils = loadStepUtils();
  const selectors = ['#a', '[data-testid="b"]'];
  assert.deepStrictEqual(
    utils.getStepSelectors({ selector: '#fallback', selectors }),
    selectors,
  );
});
