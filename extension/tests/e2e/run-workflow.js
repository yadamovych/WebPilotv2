#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  resolveWorkflowPath,
  loadWorkflowMeta,
  loadWorkflowMock,
} = require('./helpers');

const workflow = process.argv[2];

if (!workflow) {
  process.stderr.write(`Usage: npm run test:e2e:workflow -- <workflow.json> ["user request for AI vars"]

Examples:
  npm run test:e2e:workflow -- copart-test.workflow.json
  npm run test:e2e:workflow -- ./exports/my-template.json "fill in the form"

Mock {{variables}} (pick one):
  my-workflow.mock.json          — same folder as workflow JSON
  _defaults.mock.json            — shared defaults in tests/workflows/
  meta.mockVariables in .meta.json

Optional env:
  WEBPILOT_MOCK_ODOMETER=50000
  WEBPILOT_TEST_SERVER=http://127.0.0.1:8765

Jira / Google SSO:
  npm run test:e2e:auth -- https://yourcompany.atlassian.net
  npm run test:e2e:workflow -- jira.workflow.json
`);
  process.exit(1);
}

const userRequest = process.argv[3] || '';
const extensionDir = path.resolve(__dirname, '../..');

const meta = loadWorkflowMeta(workflow);
const mockVars = {
  ...loadWorkflowMock(workflow),
  ...(meta.mockVariables || {}),
};

const workflowPath = resolveWorkflowPath(workflow);
const mockFile = path.join(
  path.dirname(workflowPath),
  `${path.basename(workflowPath).replace(/\.workflow\.json$/i, '').replace(/\.json$/i, '')}.mock.json`,
);

const env = {
  ...process.env,
  WEBPILOT_WORKFLOW: workflow,
};
if (userRequest) {
  env.WEBPILOT_USER_REQUEST = userRequest;
}
if (Object.keys(mockVars).length > 0) {
  env.WEBPILOT_MOCK_JSON = JSON.stringify(mockVars);
}
if (fs.existsSync(mockFile)) {
  env.WEBPILOT_MOCK_FILE = mockFile;
}

const result = spawnSync(
  'npx',
  ['playwright', 'test', '--config', 'tests/e2e/playwright.config.js', 'tests/e2e/workflow-run.spec.js'],
  { cwd: extensionDir, env, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
