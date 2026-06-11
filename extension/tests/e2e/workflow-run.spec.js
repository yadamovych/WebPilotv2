'use strict';

const path = require('path');
const { test, expect } = require('./extension.fixture');
const {
  loadWorkflow,
  loadWorkflowMeta,
  getTemplateVariableNames,
  seedTemplate,
  setServerConfig,
  getServerConfig,
  clearSessionStorage,
  getTabIdForPage,
  playTemplate,
  applyAssertions,
} = require('./helpers');

const TEST_SERVER = process.env.WEBPILOT_TEST_SERVER || 'http://127.0.0.1:8765';
const workflowArg = process.env.WEBPILOT_WORKFLOW;

test.describe('workflow runner', () => {
  test.skip(!workflowArg, 'Pass a workflow JSON: npm run test:e2e:workflow -- my.workflow.json');

  test('runs workflow from JSON', async ({ context, serviceWorker, extensionId }) => {
    const meta = loadWorkflowMeta(workflowArg);
    test.setTimeout((meta.timeoutMs ?? Number(process.env.WEBPILOT_TIMEOUT_MS)) || 120_000);

    const template = loadWorkflow(workflowArg);
    const templateVars = getTemplateVariableNames(template);
    const mockServer = meta.serverUrl || TEST_SERVER;

    await clearSessionStorage(serviceWorker);
    await seedTemplate(serviceWorker, template);

    // Always point at the mock AI server during workflow tests — overrides side-panel
    // settings that may still reference localhost:8000 (real backend without API keys).
    await setServerConfig(serviceWorker, mockServer);

    const serverConfig = await getServerConfig(serviceWorker);
    expect(serverConfig.url).toBe(mockServer);

    const page = await context.newPage();
    const startUrl = meta.startUrl || 'about:blank';
    await page.goto(startUrl);
    await page.bringToFront();

    const tabId = await getTabIdForPage(serviceWorker, startUrl);
    expect(tabId).toBeTruthy();

    const userRequest = process.env.WEBPILOT_USER_REQUEST || meta.userRequest || '';
    const result = await playTemplate(context, extensionId, {
      templateId: template.id,
      tabId,
      userRequest,
    });

    if (result?.error) {
      throw new Error(`Playback failed: ${result.error}`);
    }
    expect(result).toMatchObject({ success: true });

    if (templateVars.size > 0) {
      expect(result.variables, 'fill-template returned no variables').toBeTruthy();
      for (const name of templateVars) {
        expect(
          result.variables[name],
          `AI variable {{${name}}} was not resolved — add it to ${path.basename(workflowArg).replace(/\.workflow\.json$/i, '')}.mock.json`,
        ).toBeTruthy();
        expect(String(result.variables[name])).not.toMatch(/^\{\{/);
      }
    }

    await applyAssertions(page, expect, meta.assertions);
  });
});
