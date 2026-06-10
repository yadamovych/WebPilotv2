#!/usr/bin/env node
/**
 * Replay a WebPilot workflow JSON with Playwright (no extension required).
 * Useful for CI smoke tests against static fixtures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  process.stderr.write(`Usage: node tests/headless-runner/run-workflow.mjs <workflow.json> [baseUrl]

Resolves {{variables}} from:
  - WEBPILOT_MOCK_<NAME>=value env vars
  - sibling .mock.json or _defaults.mock.json

Example:
  node tests/headless-runner/run-workflow.mjs tests/workflows/extract-fill.workflow.json http://127.0.0.1:8765/fixtures/extract-fill.html
`);
}

function resolveWorkflowPath(input) {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(process.cwd(), input);
}

function loadMockVars(workflowPath) {
  const dir = path.dirname(workflowPath);
  const base = path.basename(workflowPath).replace(/\.workflow\.json$/i, '').replace(/\.json$/i, '');
  const candidates = [
    path.join(dir, `${base}.mock.json`),
    path.join(dir, '_defaults.mock.json'),
  ];
  let mock = {};
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      mock = { ...mock, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
    }
  }
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith('WEBPILOT_MOCK_')) {
      mock[key.slice('WEBPILOT_MOCK_'.length).toLowerCase()] = val;
    }
  }
  return mock;
}

function resolvePlaceholders(value, mockVars, extracted) {
  if (!value || typeof value !== 'string') {
    return value;
  }
  let out = value.replace(/\{\{(\w+)\}\}/g, (_, name) => mockVars[name] ?? `test-${name}`);
  out = out.replace(/\[\[extracted\.(\w+)\]\]/g, (_, name) => extracted[name] ?? '');
  return out;
}

function getSelectors(step) {
  if (Array.isArray(step.selectors) && step.selectors.length) {
    return step.selectors;
  }
  return step.selector ? [step.selector] : [];
}

async function waitForSelector(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        return { el, selector: sel };
      }
    }
    await page.waitForTimeout(100);
  }
  return null;
}

async function runStep(page, step, index, extracted, mockVars) {
  const action = step.action;
  const value = resolvePlaceholders(step.value, mockVars, extracted);
  const selectors = getSelectors(step);

  if (action === 'navigate') {
    await page.goto(value, { waitUntil: 'domcontentloaded' });
    return;
  }

  if (action === 'wait') {
    await page.waitForTimeout(parseInt(value, 10) || 1000);
    return;
  }

  if (action === 'wait_for') {
    const timeout = step.timeoutMs || parseInt(value, 10) || 15000;
    const found = await waitForSelector(page, selectors, timeout);
    if (!found) {
      throw new Error(`wait_for timed out: ${selectors.join(', ')}`);
    }
    return;
  }

  if (action === 'extract') {
    const found = await waitForSelector(page, selectors, step.timeoutMs || 10000);
    if (!found) {
      throw new Error(`extract: element not found — ${selectors.join(', ')}`);
    }
    const varName = step.variable || 'extracted';
    const text = step.extractType === 'value'
      ? await found.el.inputValue().catch(() => '')
      : await found.el.textContent().then((t) => t?.trim() ?? '');
    extracted[varName] = text;
    return;
  }

  if (action === 'assert' || action === 'assert_text') {
    const found = await waitForSelector(page, selectors, step.timeoutMs || 10000);
    if (!found) {
      throw new Error(`${action}: element not found — ${selectors.join(', ')}`);
    }
    const tag = await found.el.evaluate((n) => n.tagName);
    const actual = tag === 'INPUT' || tag === 'TEXTAREA'
      ? await found.el.inputValue()
      : await found.el.textContent().then((t) => t?.trim() ?? '');
    if (action === 'assert_text' && actual !== String(value ?? '')) {
      throw new Error(`${action} failed: expected "${value}", got "${actual}"`);
    }
    return;
  }

  const found = await waitForSelector(page, selectors, step.timeoutMs || 10000);
  if (!found) {
    throw new Error(`${action}: element not found — ${selectors.join(', ')}`);
  }
  const { el } = found;

  switch (action) {
    case 'click':
      await el.click();
      break;
    case 'type':
      await el.fill(String(value ?? ''));
      break;
    case 'select':
      await el.selectOption(String(value ?? ''));
      break;
    case 'key':
      await page.keyboard.press(String(value ?? 'Enter'));
      break;
    default:
      throw new Error(`Unsupported action: ${action}`);
  }

  if (step.delayMs) {
    await page.waitForTimeout(step.delayMs);
  }

  void index;
}

async function main() {
  const workflowArg = process.argv[2];
  const baseUrl = process.argv[3];
  if (!workflowArg) {
    usage();
    process.exit(1);
  }

  const workflowPath = resolveWorkflowPath(workflowArg);
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const mockVars = loadMockVars(workflowPath);
  const extracted = {};
  const steps = workflow.steps ?? [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    if (baseUrl && steps[0]?.action !== 'navigate') {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    }

    for (let i = 0; i < steps.length; i++) {
      const step = { ...steps[i] };
      if (step.action === 'navigate' && baseUrl && !step.value?.startsWith('http')) {
        step.value = baseUrl;
      }
      process.stdout.write(`Step ${i + 1}/${steps.length}: ${step.action}\n`);
      try {
        await runStep(page, step, i, extracted, mockVars);
      } catch (err) {
        throw new Error(`step ${i + 1} (${step.action}): ${err.message}`);
      }
    }
    process.stdout.write('Workflow completed successfully.\n');
  } catch (err) {
    process.stderr.write(`Workflow failed: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
