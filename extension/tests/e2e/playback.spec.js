'use strict';

const { test, expect } = require('./extension.fixture');
const {
  loadWorkflow,
  seedTemplate,
  setServerConfig,
  clearSessionStorage,
  getTabIdForPage,
  playTemplate,
} = require('./helpers');

const TEST_SERVER = process.env.WEBPILOT_TEST_SERVER || 'http://127.0.0.1:8765';

test.describe('workflow playback', () => {
  test('runs a static login workflow on a fixture page', async ({ context, serviceWorker, extensionId }) => {
    const template = loadWorkflow('login.workflow.json');
    await clearSessionStorage(serviceWorker);
    await seedTemplate(serviceWorker, template);

    const page = await context.newPage();
    const fixtureUrl = `${TEST_SERVER}/simple-form.html`;
    await page.goto(fixtureUrl);
    await page.bringToFront();

    const tabId = await getTabIdForPage(serviceWorker, fixtureUrl);
    expect(tabId).toBeTruthy();

    const result = await playTemplate(context, extensionId, {
      templateId: template.id,
      tabId,
    });

    expect(result).toMatchObject({ success: true });
    await expect(page.locator('[data-testid="success"]')).toBeVisible();
    await expect(page.locator('[data-testid="username"]')).toHaveValue('testuser');
    await expect(page.locator('[data-testid="password"]')).toHaveValue('secret123');
  });

  test('resolves AI template variables via mock server', async ({ context, serviceWorker, extensionId }) => {
    const template = loadWorkflow('variable-login.workflow.json');
    await clearSessionStorage(serviceWorker);
    await setServerConfig(serviceWorker, TEST_SERVER);
    await seedTemplate(serviceWorker, template);

    const page = await context.newPage();
    const fixtureUrl = `${TEST_SERVER}/simple-form.html`;
    await page.goto(fixtureUrl);
    await page.bringToFront();

    const tabId = await getTabIdForPage(serviceWorker, fixtureUrl);
    const result = await playTemplate(context, extensionId, {
      templateId: template.id,
      tabId,
      userRequest: 'log in as test user',
    });

    expect(result).toMatchObject({ success: true });
    await expect(page.locator('[data-testid="success"]')).toBeVisible();
  });

  test('extracts a value and fills a target field', async ({ context, serviceWorker, extensionId }) => {
    const template = loadWorkflow('extract-fill.workflow.json');
    await clearSessionStorage(serviceWorker);
    await seedTemplate(serviceWorker, template);

    const page = await context.newPage();
    const fixtureUrl = `${TEST_SERVER}/extract-fill.html`;
    await page.goto(fixtureUrl);
    await page.bringToFront();

    const tabId = await getTabIdForPage(serviceWorker, fixtureUrl);
    const result = await playTemplate(context, extensionId, {
      templateId: template.id,
      tabId,
    });

    expect(result).toMatchObject({ success: true });
    await expect(page.locator('[data-testid="target-field"]')).toHaveValue('Hello from page');
    await expect(page.locator('[data-testid="result"]')).toBeVisible();
    await expect(page.locator('[data-testid="result"]')).toHaveText('Match!');
  });
});
