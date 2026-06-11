'use strict';

const fs = require('fs');
const path = require('path');

function resolveWorkflowPath(nameOrPath) {
  const input = nameOrPath || process.env.WEBPILOT_WORKFLOW;
  if (!input) {
    throw new Error('No workflow file specified');
  }
  if (path.isAbsolute(input)) {
    return input;
  }
  if (input.startsWith('./') || input.startsWith('../')) {
    return path.resolve(process.cwd(), input);
  }
  return path.join(__dirname, '../workflows', input);
}

function loadWorkflow(nameOrPath) {
  const filePath = resolveWorkflowPath(nameOrPath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadWorkflowMeta(nameOrPath) {
  const workflowPath = resolveWorkflowPath(nameOrPath);
  const base = path.basename(workflowPath).replace(/\.workflow\.json$/i, '').replace(/\.json$/i, '');
  const metaPath = path.join(path.dirname(workflowPath), `${base}.meta.json`);
  if (!fs.existsSync(metaPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
}

function loadWorkflowMock(nameOrPath) {
  const workflowPath = resolveWorkflowPath(nameOrPath);
  const base = path.basename(workflowPath).replace(/\.workflow\.json$/i, '').replace(/\.json$/i, '');
  const mockPath = path.join(path.dirname(workflowPath), `${base}.mock.json`);
  if (!fs.existsSync(mockPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(mockPath, 'utf8'));
}

function getTemplateVariableNames(template) {
  const names = new Set();
  const re = /\{\{(\w+)\}\}/g;
  for (const step of template.steps) {
    if (step.value) {
      for (const [, name] of step.value.matchAll(re)) {
        names.add(name);
      }
    }
  }
  return names;
}

function workflowUsesTemplateVariables(template) {
  return getTemplateVariableNames(template).size > 0;
}

async function seedTemplate(serviceWorker, template) {
  await serviceWorker.evaluate(async (tpl) => {
    const { templates = {} } = await chrome.storage.local.get('templates');
    templates[tpl.id] = tpl;
    await chrome.storage.local.set({ templates });
  }, template);
}

async function setServerConfig(serviceWorker, serverUrl) {
  await serviceWorker.evaluate(async (url) => {
    await chrome.storage.local.set({
      serverConfig: { url, backend: 'groq' },
    });
  }, serverUrl);
}

async function clearSessionStorage(serviceWorker) {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.session.clear();
  });
}

async function getTabIdForPage(serviceWorker, pageUrl) {
  return serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url && t.url.startsWith(url));
    return tab?.id ?? null;
  }, pageUrl);
}

async function getServerConfig(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    const { serverConfig = {} } = await chrome.storage.local.get('serverConfig');
    return serverConfig;
  });
}

async function playTemplate(context, extensionId, { templateId, tabId, userRequest = '' }) {
  const extPage = await context.newPage();
  await extPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const result = await extPage.evaluate(
    async ({ templateId: id, tabId: tid, userRequest: req }) => new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'PLAY_TEMPLATE', templateId: id, tabId: tid, userRequest: req },
        resolve,
      );
    }),
    { templateId, tabId, userRequest },
  );
  await extPage.close();
  return result;
}

async function applyAssertions(page, expect, assertions) {
  if (!assertions) {
    return;
  }

  if (assertions.urlIncludes) {
    const pattern = assertions.urlIncludes;
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    await expect(page).toHaveURL(re, { timeout: assertions.urlTimeoutMs ?? 30_000 });
  }

  if (assertions.selectorVisible) {
    await expect(page.locator(assertions.selectorVisible)).toBeVisible();
  }

  if (assertions.selectorNotEmpty) {
    const loc = page.locator(assertions.selectorNotEmpty);
    const tag = await loc.evaluate((el) => el.tagName).catch(() => '');
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const value = await loc.inputValue();
      expect(value.length).toBeGreaterThan(0);
      if (assertions.selectorNotContains) {
        expect(value).not.toContain(assertions.selectorNotContains);
      }
    } else {
      const text = (await loc.textContent()) ?? '';
      expect(text.trim().length).toBeGreaterThan(0);
    }
  }

  if (assertions.selectorValue) {
    const { selector, value } = assertions.selectorValue;
    await expect(page.locator(selector)).toHaveValue(value);
  }
}

module.exports = {
  resolveWorkflowPath,
  loadWorkflow,
  loadWorkflowMeta,
  loadWorkflowMock,
  getTemplateVariableNames,
  workflowUsesTemplateVariables,
  seedTemplate,
  setServerConfig,
  getServerConfig,
  clearSessionStorage,
  getTabIdForPage,
  playTemplate,
  applyAssertions,
};
