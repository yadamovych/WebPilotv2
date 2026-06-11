'use strict';

const { test: base, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const pathToExtension = path.join(__dirname, '../..');
const defaultAuthProfile = path.join(__dirname, '../.auth/chrome-profile');

function resolveUserDataDir() {
  if (process.env.WEBPILOT_AUTH_PROFILE === '0') {
    return '';
  }
  if (process.env.WEBPILOT_AUTH_PROFILE) {
    return path.resolve(process.env.WEBPILOT_AUTH_PROFILE);
  }
  if (fs.existsSync(defaultAuthProfile)) {
    return defaultAuthProfile;
  }
  return '';
}

const test = base.extend({
  context: async (_fixtures, use) => {
    const userDataDir = resolveUserDataDir();
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    }
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const extensionId = serviceWorker.url().split('/')[2];
    await use(extensionId);
  },
});

module.exports = { test, expect: require('@playwright/test').expect };
