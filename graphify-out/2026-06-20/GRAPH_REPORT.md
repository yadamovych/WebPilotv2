# Graph Report - .  (2026-06-20)

## Corpus Check
- Corpus is ~46,241 words - fits in a single context window. You may not need a graph.

## Summary
- 516 nodes · 712 edges · 55 communities (50 shown, 5 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 87 edges (avg confidence: 0.64)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_CompletionResult|CompletionResult]]
- [[_COMMUNITY_helpers.js|helpers.js]]
- [[_COMMUNITY_WebPilot|WebPilot]]
- [[_COMMUNITY_app.py|app.py]]
- [[_COMMUNITY_Extension Lint Fixer Agent|Extension Lint Fixer Agent]]
- [[_COMMUNITY_rules|rules]]
- [[_COMMUNITY_background.js|background.js]]
- [[_COMMUNITY_scripts|scripts]]
- [[_COMMUNITY_manifest.json|manifest.json]]
- [[_COMMUNITY_split-modules.js|split-modules.js]]
- [[_COMMUNITY_Backend Tests and Linting|Backend Tests and Linting]]
- [[_COMMUNITY_error-handler.js|error-handler.js]]
- [[_COMMUNITY_test-server.js|test-server.js]]
- [[_COMMUNITY_icon128.png|icon128.png]]
- [[_COMMUNITY_Extension Test Suite|Extension Test Suite]]
- [[_COMMUNITY_run-workflow.mjs|run-workflow.mjs]]
- [[_COMMUNITY_auth.setup.js|auth.setup.js]]
- [[_COMMUNITY__extract_json|_extract_json]]
- [[_COMMUNITY_error-handler.test.js|error-handler.test.js]]
- [[_COMMUNITY_script-lists.test.js|script-lists.test.js]]
- [[_COMMUNITY_step-utils.js|step-utils.js]]
- [[_COMMUNITY_step-utils.test.js|step-utils.test.js]]
- [[_COMMUNITY_CLAUDE|CLAUDE.md]]
- [[_COMMUNITY_create_solid_png|create_solid_png]]
- [[_COMMUNITY_GitHub Issue Fixer Agent|GitHub Issue Fixer Agent]]
- [[_COMMUNITY_playwright.config.js|playwright.config.js]]
- [[_COMMUNITY_Misc 27|Misc 27]]
- [[_COMMUNITY_Misc 28|Misc 28]]
- [[_COMMUNITY_Misc 29|Misc 29]]
- [[_COMMUNITY_Misc 32|Misc 32]]

## God Nodes (most connected - your core abstractions)
1. `CompletionResult` - 32 edges
2. `BaseBackend` - 17 edges
3. `Settings` - 16 edges
4. `rules` - 15 edges
5. `compute_cost()` - 14 edges
6. `scripts` - 13 edges
7. `fill_template()` - 11 edges
8. `get_backend()` - 10 edges
9. `VLLMBackend` - 10 edges
10. `Extension Lint Fixer Agent` - 10 edges

## Surprising Connections (you probably didn't know these)
- `black formatter` --used_by--> `Backend Tests and Linting`  [INFERRED]
  server/requirements-dev.txt → .github/workflows/ci.yml
- `mypy type checker` --used_by--> `Backend Tests and Linting`  [INFERRED]
  server/requirements-dev.txt → .github/workflows/ci.yml
- `Extension Popup UI` --part_of--> `Chrome Extension`  [INFERRED]
  extension/popup.html → README.md
- `Extension Lint Fixer Agent` --implemented_by--> `Auto-fix Extension Errors Workflow`  [INFERRED]
  .agent.md → .github/workflows/auto-fix-extension-errors.yml
- `Auto-fix Extension Errors Workflow` --runs--> `npm run lint:fix`  [EXTRACTED]
  .github/workflows/auto-fix-extension-errors.yml → .agent.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Extension Error Automation Pipeline** —  [INFERRED 0.85]
- **WebPilot System Architecture** —  [EXTRACTED 1.00]
- **WebPilotv2 extension icon size set** — icons_icon128_file, icons_icon48_file, icons_icon16_file [INFERRED]

## Communities (55 total, 5 thin omitted)

### Community 0 - "CompletionResult"
Cohesion: 0.08
Nodes (33): ABC, AnthropicBackend, Anthropic backend (Claude 3 Haiku / Sonnet / Opus)., BaseBackend, CompletionResult, Abstract base class for AI inference backends., Returned by every backend's complete() call., Send a single-turn chat completion request.          Args:             system_pr (+25 more)

### Community 1 - "helpers.js"
Cohesion: 0.08
Nodes (37): defaultAuthProfile, fs, path, pathToExtension, test, { test: base, chromium }, applyAssertions(), clearSessionStorage() (+29 more)

### Community 2 - "WebPilot"
Cohesion: 0.07
Nodes (32): mistralai/Mistral-7B-Instruct-v0.3, Standard Docker Compose Stack, vllm service, vLLM Docker Compose Stack, webpilot-server service, Extension Error Handling Documentation, Execute with AI, Extension Popup UI (+24 more)

### Community 3 - "app.py"
Cohesion: 0.11
Nodes (35): BaseModel, BaseSettings, Request, analyze_selector_error(), _build_usage(), _check_rate_limit(), ExtensionErrorRecord, ExtensionErrorReport (+27 more)

### Community 4 - "Extension Lint Fixer Agent"
Cohesion: 0.07
Nodes (28): Extension Lint Fixer Agent Config, background.js, content.js, error-handler.js, ESLint Auto-Fix, extension-errors label, Extension Lint Fixer Agent, npm run lint:fix (+20 more)

### Community 5 - "rules"
Cohesion: 0.06
Nodes (31): env, browser, es2021, webextensions, extends, globals, chrome, errorTracker (+23 more)

### Community 6 - "background.js"
Cohesion: 0.16
Nodes (21): broadcastToFrames(), delay(), ensureContentScript(), executeSteps(), fillTemplateVariables(), handleImportTemplate(), handlePlayTemplate(), handlePreviewVariables() (+13 more)

### Community 7 - "scripts"
Cohesion: 0.08
Nodes (23): author, description, devDependencies, eslint, @playwright/test, keywords, license, main (+15 more)

### Community 8 - "manifest.json"
Cohesion: 0.09
Nodes (21): action, default_icon, background, service_worker, content_scripts, 128, 16, 48 (+13 more)

### Community 9 - "split-modules.js"
Cohesion: 0.15
Nodes (20): CONTENT_FUNCTIONS, CONTENT_SPLITS, CONTENT_STATE_VARS, EXT, extractLines(), fs, guardContent(), path (+12 more)

### Community 10 - "Backend Tests and Linting"
Cohesion: 0.13
Nodes (14): black formatter, fastapi dependency, flake8 linter, mypy type checker, pytest dependency, uvicorn dependency, Backend Tests and Linting, CD Pipeline (+6 more)

### Community 11 - "error-handler.js"
Cohesion: 0.22
Nodes (6): ErrorTracker, reportErrorsToBackend(), safeChrome(), safeStor, startErrorReporting(), stopErrorReporting()

### Community 12 - "test-server.js"
Cohesion: 0.16
Nodes (10): BASE_MOCK_VARIABLES, corsHeaders(), FIXTURES_DIR, fs, http, path, PORT, sendJson() (+2 more)

### Community 13 - "icon128.png"
Cohesion: 0.18
Nodes (10): minimalist flat design, solid blue brand color, square canvas, WebPilotv2 extension branding, minimalist flat design, solid blue brand color, browser toolbar favicon, extension management page icon (+2 more)

### Community 14 - "Extension Test Suite"
Cohesion: 0.18
Nodes (10): Extension E2E Tests, Headless Workflow Runner, test-server.js on port 8765, Extension Test Suite, extension tests README, Extension Unit Tests, Extract and Fill Test Page, Extracted Variables [[extracted.var]] (+2 more)

### Community 15 - "run-workflow.mjs"
Cohesion: 0.36
Nodes (9): __dirname, getSelectors(), loadMockVars(), main(), resolvePlaceholders(), resolveWorkflowPath(), runStep(), usage() (+1 more)

### Community 16 - "auth.setup.js"
Cohesion: 0.25
Nodes (8): { chromium }, fs, main(), path, pathToExtension, profileDir, readline, waitForEnter()

### Community 17 - "_extract_json"
Cohesion: 0.36
Nodes (3): _extract_json(), Robustly extract a JSON object from an AI response string., TestExtractJson

### Community 18 - "error-handler.test.js"
Cohesion: 0.28
Nodes (7): makeChromeMock(), assert, loadHandler(), { makeChromeMock }, MODULE_PATH, path, { test }

### Community 19 - "script-lists.test.js"
Cohesion: 0.22
Nodes (6): assert, EXT, fs, path, { test }, vm

### Community 20 - "step-utils.js"
Cohesion: 0.46
Nodes (6): isCheckboxHint(), isNativeSelectStep(), normalizeTemplateVariable(), sanitizeRecordedSteps(), scoreSelectorQuality(), shouldDropRecordedAction()

### Community 21 - "step-utils.test.js"
Cohesion: 0.29
Nodes (5): assert, MODULE_PATH, path, { test }, vm

### Community 22 - "CLAUDE.md"
Cohesion: 0.40
Nodes (4): Goal-Driven Execution, Simplicity First, Surgical Changes, Think Before Coding

### Community 23 - "create_solid_png"
Cohesion: 0.67
Nodes (3): create_solid_png(), main(), Build a minimal valid PNG with a single solid color.

### Community 24 - "GitHub Issue Fixer Agent"
Cohesion: 0.67
Nodes (3): fix/issue-<number>-<slug> branch pattern, GitHub Issue Fixer Agent, GitHub Issue Fixer Agent Config

## Knowledge Gaps
- **183 isolated node(s):** `browser`, `es2021`, `webextensions`, `extends`, `ecmaVersion` (+178 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CI Pipeline` connect `Extension Lint Fixer Agent` to `WebPilot`, `Backend Tests and Linting`, `Extension Test Suite`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `WebPilot` connect `WebPilot` to `Backend Tests and Linting`, `Extension Lint Fixer Agent`, `Extension Test Suite`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `CompletionResult` connect `CompletionResult` to `_extract_json`, `app.py`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Are the 23 inferred relationships involving `CompletionResult` (e.g. with `AnthropicBackend` and `GroqBackend`) actually correct?**
  _`CompletionResult` has 23 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `BaseBackend` (e.g. with `AnthropicBackend` and `GroqBackend`) actually correct?**
  _`BaseBackend` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 14 inferred relationships involving `Settings` (e.g. with `Request` and `ExtensionErrorRecord`) actually correct?**
  _`Settings` has 14 INFERRED edges - model-reasoned connections that need verification._
- **What connects `browser`, `es2021`, `webextensions` to the rest of the system?**
  _209 weakly-connected nodes found - possible documentation gaps or missing edges._