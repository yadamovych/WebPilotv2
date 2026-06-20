# AGENTS.md

## Cursor Cloud specific instructions

WebPilot has two independently-developed components:

| Component | Path | Stack | Purpose |
|-----------|------|-------|---------|
| AI inference server | `server/` | Python 3.12 / FastAPI / uvicorn | REST + WebSocket API consumed by the extension |
| Browser extension | `extension/` | Chrome MV3 (vanilla JS) + Node tooling | Records/replays browser workflows; Playwright E2E harness |

The cloud update script already creates a Python venv at repo root `.venv/` (with `server/requirements-dev.txt` installed) and runs `npm install` in `extension/` (its `postinstall` downloads the Playwright Chromium browser). Playwright system libraries and `xvfb` are preinstalled in the VM snapshot via `npx playwright install-deps chromium`.

### Python server (`server/`)
- Always use the repo-root venv: `/workspace/.venv/bin/<tool>` (the venv is at the repository root, not inside `server/`).
- Run dev server: `cd server && ../.venv/bin/uvicorn app:app --reload` → http://localhost:8000 (docs at `/docs`).
- Lint/test/format commands are documented in `README.md` (flake8, black `--line-length=120`, mypy, pytest). Run them with the venv binaries, e.g. `cd server && ../.venv/bin/pytest .`.
- Tests mock the AI backends, so no API keys are needed for `pytest`. `/health` and `/api/playback-logs` also work without keys.
- `/api/fill-template`, `/api/prompt`, and `/api/analyze-selector` make real LLM calls and require a provider key (`OPENAI_API_KEY` / `GROQ_API_KEY` / `ANTHROPIC_API_KEY`), set in `server/.env` or passed per-request. Without a key these return HTTP 500 (expected).

### Extension (`extension/`)
- Commands are defined in `extension/package.json` scripts. Key ones: `npm run lint`, `npm test` (Node built-in test runner), `npm run test:headless:ci` (no browser), `npm run test:e2e`.
- E2E requires a virtual display: run `xvfb-run -a npm run test:e2e` (same as CI). Tests load the unpacked extension into Chromium and use a local mock AI server (`tests/helpers/test-server.js`, port 8765) — no external network or API keys needed.
- ESLint reports a pre-existing warning in `scripts/split-modules.js`; CI only fails on errors, so warnings are fine.
- This is an unpacked Chrome extension; there is no build step. To run it manually, load the `extension/` folder via `chrome://extensions` → Developer mode → Load unpacked.
