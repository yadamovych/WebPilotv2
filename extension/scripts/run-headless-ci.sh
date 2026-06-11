#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

WORKFLOW="${1:-tests/workflows/extract-fill.workflow.json}"
FIXTURE_URL="${2:-http://127.0.0.1:8765/fixtures/extract-fill.html}"

SERVER_PID=""
if ! curl -sf "http://127.0.0.1:8765/simple-form.html" >/dev/null 2>&1; then
  node tests/helpers/test-server.js &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

  for _ in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:8765/simple-form.html" >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done
fi

node tests/headless-runner/run-workflow.mjs "$WORKFLOW" "$FIXTURE_URL"
