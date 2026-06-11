'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '../fixtures');
const WORKFLOWS_DIR = path.join(__dirname, '../workflows');
const PORT = Number(process.env.WEBPILOT_TEST_PORT || 8765);

const BASE_MOCK_VARIABLES = {
  username: 'testuser',
  password: 'secret123',
  odometerSliderMaxValue: process.env.WEBPILOT_MOCK_ODOMETER || '50000',
};

function loadMockVariables() {
  const mocks = { ...BASE_MOCK_VARIABLES };

  const defaultsPath = path.join(WORKFLOWS_DIR, '_defaults.mock.json');
  if (fs.existsSync(defaultsPath)) {
    Object.assign(mocks, JSON.parse(fs.readFileSync(defaultsPath, 'utf8')));
  }

  if (process.env.WEBPILOT_MOCK_FILE && fs.existsSync(process.env.WEBPILOT_MOCK_FILE)) {
    Object.assign(mocks, JSON.parse(fs.readFileSync(process.env.WEBPILOT_MOCK_FILE, 'utf8')));
  }

  if (process.env.WEBPILOT_MOCK_JSON) {
    try {
      Object.assign(mocks, JSON.parse(process.env.WEBPILOT_MOCK_JSON));
    } catch (_) { /* ignore bad JSON */ }
  }

  return mocks;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders() });
  res.end(JSON.stringify(body));
}

function serveFixture(req, res) {
  const rel = req.url === '/' ? '/simple-form.html' : req.url.split('?')[0];
  const safeName = path.basename(rel);
  const filePath = path.join(FIXTURES_DIR, safeName);

  if (!filePath.startsWith(FIXTURES_DIR)) {
    res.writeHead(403, corsHeaders());
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, corsHeaders());
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html' : 'text/plain';
    res.writeHead(200, { 'Content-Type': type, ...corsHeaders() });
    res.end(data);
  });
}

function handleFillTemplate(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(body || '{}');
    } catch (_) {
      sendJson(res, 400, { detail: 'Invalid JSON' });
      return;
    }

    const requested = Array.isArray(payload.variables) ? payload.variables : [];
    const mocks = loadMockVariables();
    const variables = {};

    for (const name of requested) {
      variables[name] = mocks[name] ?? `test-${name}`;
    }

    if (requested.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[test-server] fill-template → ${JSON.stringify(variables)}`);
    }

    sendJson(res, 200, { variables });
  });
}

function createTestServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    const pathOnly = req.url.split('?')[0];

    if (req.method === 'POST' && pathOnly === '/api/fill-template') {
      handleFillTemplate(req, res);
      return;
    }
    if (req.method === 'GET') {
      serveFixture(req, res);
      return;
    }
    res.writeHead(405, corsHeaders());
    res.end('Method not allowed');
  });

  return { server, port: PORT, baseUrl: `http://127.0.0.1:${PORT}` };
}

if (require.main === module) {
  const { server, baseUrl } = createTestServer();
  server.listen(PORT, '127.0.0.1', () => {
    process.stdout.write(`${baseUrl}\n`);
  });
}

module.exports = { createTestServer, loadMockVariables, PORT, BASE_MOCK_VARIABLES };
