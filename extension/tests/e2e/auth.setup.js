#!/usr/bin/env node
'use strict';

/**
 * One-time (or occasional) login setup for workflows that need Google SSO (e.g. Jira).
 *
 * Usage:
 *   npm run test:e2e:auth -- https://yourcompany.atlassian.net
 *
 * A Chrome window opens with WebPilot loaded. Sign in with Google manually,
 * then press Enter in the terminal. The session is saved to tests/.auth/chrome-profile/
 * and reused when WEBPILOT_AUTH_PROFILE is set (workflow runner sets this automatically).
 */

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const pathToExtension = path.join(__dirname, '../..');
const profileDir = path.join(__dirname, '../.auth/chrome-profile');
const loginUrl = process.argv[2] || process.env.WEBPILOT_AUTH_URL || 'https://id.atlassian.com/login';

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  fs.mkdirSync(path.dirname(profileDir), { recursive: true });

  process.stdout.write(`\nOpening browser with saved profile: ${profileDir}\n`);
  process.stdout.write(`Navigate to: ${loginUrl}\n\n`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(loginUrl);

  process.stdout.write(
    '1. Complete Google / Atlassian login in the browser window\n'
    + '2. Confirm you can reach Jira (not stuck on login)\n'
    + '3. Press Enter here to save the session and exit\n\n',
  );

  await waitForEnter('Press Enter when login is complete… ');

  await context.close();
  process.stdout.write('\nAuth profile saved. Run workflows with:\n  npm run test:e2e:workflow -- your-jira.workflow.json\n\n');
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
