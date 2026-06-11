'use strict';

const path = require('path');

const config = {
  testDir: path.join(__dirname),
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  webServer: {
    command: 'node tests/helpers/test-server.js',
    cwd: path.join(__dirname, '../..'),
    url: 'http://127.0.0.1:8765/simple-form.html',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
  use: {
    trace: 'on-first-retry',
  },
};

module.exports = config;
