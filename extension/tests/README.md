# WebPilot extension tests

## Code layout

| Area | Modules |
|------|---------|
| Content script | `content/guard.js` → `context.js` → `variables.js` → `messages.js` → `recording.js` → `overlay.js` → `recording-events.js` → `selectors.js` → `playback.js` → `bootstrap.js` |
| Popup / side panel | `popup/core.js`, `utils.js`, `tabs.js`, `settings.js`, `templates.js`, `playback.js`, `recording.js`, `steps.js`, `messages.js`, `events.js`, `init-*.js` |
| Shared | `lib/step-utils.js`, `lib/selector-alternatives.js`, `lib/script-lists.js` |

Load order is defined in `lib/script-lists.js` (content) and `popup.html` / `sidepanel.html` (UI).

## Unit tests

```bash
cd extension
npm test
```

Covers error reporting and `lib/step-utils.js` (selector scoring, step sanitization).

## E2E tests (extension + Playwright)

Install browser once:

```bash
npm run test:e2e:setup
```

Run fixture-based E2E (no external sites):

```bash
npm run test:e2e
```

### Run any workflow JSON

Place workflow files under `tests/workflows/` or pass a path:

```bash
npm run test:e2e:workflow -- extract-fill.workflow.json
npm run test:e2e:workflow -- ./exports/my-template.json "user prompt for AI vars"
```

**Mock AI variables** (no real backend):

| Source | File / env |
|--------|------------|
| Per-workflow | `my-workflow.mock.json` next to the JSON |
| Shared defaults | `tests/workflows/_defaults.mock.json` |
| Env override | `WEBPILOT_MOCK_ODOMETER=50000` |

The test harness points the extension at the local mock server (`tests/helpers/test-server.js` on port 8765).

### SSO / Google login (Jira, etc.)

Log in once and reuse the saved Chrome profile:

```bash
npm run test:e2e:auth -- https://yourcompany.atlassian.net
npm run test:e2e:workflow -- jira.workflow.json
```

Profile is stored in `tests/.auth/chrome-profile/` (gitignored).

## Headless runner (no extension)

Replay exported workflow JSON with Playwright only — useful for static HTML fixtures in CI:

```bash
npm run test:headless -- extract-fill.workflow.json http://127.0.0.1:8765/fixtures/extract-fill.html
```

Start the fixture server in another terminal:

```bash
node tests/helpers/test-server.js
```

Resolves `{{variables}}` from `.mock.json` / `WEBPILOT_MOCK_*` and `[[extracted.var]]` at runtime.
