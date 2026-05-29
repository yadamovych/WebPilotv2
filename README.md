# WebPilot

Browser automation powered by AI — record workflows once, replay them with natural language.

## Architecture

```
extension/          Chrome/Edge extension (Manifest V3)
  manifest.json
  background.js     Service worker: state, AI requests, playback orchestration
  content.js        Page-level: event capture, overlay, step execution
  popup.html/js/css Extension UI (Record · Templates · Settings)
  icons/

server/             FastAPI AI inference server
  app.py            REST + WebSocket API
  config.py         Environment-based configuration
  backends/
    openai_backend.py
    groq_backend.py
    anthropic_backend.py
    vllm_backend.py

docker-compose.yml           Cloud AI backends (OpenAI / Groq / Anthropic)
docker-compose.vllm.yml      Local vLLM on NVIDIA GPU
```

---

## Quick Start

### 1 — Extension

```bash
cd extension/icons && python3 generate_icons.py   # generate placeholder PNGs
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. The WebPilot icon appears in the toolbar

### 2 — Server (cloud backends)

```bash
cd server
cp .env.example .env          # fill in at least one API key
python3 -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload      # http://localhost:8000
```

Or with Docker:

```bash
docker compose up -d
```

### 3 — Server (local vLLM, RTX 3080 Ti)

> Requires Docker, NVIDIA Container Toolkit, and 16 GB+ VRAM.

```bash
cp server/.env.example server/.env
# Optional: add HUGGING_FACE_HUB_TOKEN for gated models
docker compose -f docker-compose.vllm.yml up -d
```

The vLLM OpenAI-compatible API is available on `http://localhost:8080`.
The WebPilot server (port 8000) auto-discovers the loaded model.

---

## Extension UI

| Tab | Purpose |
|---|---|
| **Record** | Start/stop recording, view & edit steps, save as template |
| **Templates** | List saved templates; play with a natural language prompt |
| **Settings** | Server URL, backend selection, API key, model override |

### Recording workflow

1. Open the target webpage.
2. Open the extension popup → **Start Recording**.
3. Perform the actions you want to automate (clicks, typing, selects).
4. **Stop Recording** — edit/rename/reorder steps as needed.
5. Name the template and click **Save**.

### Playback workflow

1. Open the target webpage.
2. Open the popup → **Templates** tab → click **▶ Play** on a template.
3. Type a natural language description, e.g.:
   > `Create a Jira ticket for PR-Agent deployment`
4. Click **Execute with AI**.
   - The AI server extracts `{{title}}` and `{{description}}` values from the request.
   - The extension executes each step with the substituted values.

---

## Template format

Templates are stored in `chrome.storage.local`:

```json
{
  "id": "uuid",
  "name": "Create Jira Ticket",
  "createdAt": 1700000000000,
  "steps": [
    { "action": "click",     "selector": "#create-ticket",  "label": "Create" },
    { "action": "type",      "selector": "#title",          "value": "{{title}}" },
    { "action": "type",      "selector": "#description",    "value": "{{description}}" },
    { "action": "click",     "selector": "[type=submit]",   "label": "Submit" }
  ]
}
```

Supported step actions: `click`, `type`, `select`, `navigate`, `wait`.

---

## Server API

| Method | Path | Description |
|---|---|---|
| `GET`  | `/health` | Health check |
| `POST` | `/api/fill-template` | Fill `{{variable}}` placeholders with AI |
| `POST` | `/api/prompt` | Generic single-turn prompt |
| `WS`   | `/ws` | WebSocket multiplex interface |

### `POST /api/fill-template`

```json
{
  "userRequest": "Create Jira ticket for PR-Agent deployment",
  "variables": ["title", "description"],
  "templateName": "Create Jira Ticket",
  "backend": "groq",
  "apiKey": "gsk_...",
  "model": "llama-3.3-70b-versatile"
}
```

Response:

```json
{
  "variables": {
    "title": "Deploy PR-Agent to Production",
    "description": "This ticket tracks the full deployment of PR-Agent..."
  }
}
```

---

## Supported AI backends

| Backend | Key env var | Default model |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` |
| Groq | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-3-haiku-20240307` |
| Local vLLM | *(none)* | auto-detected from loaded model |

API keys can be configured server-side (`.env`) or passed per-request from the extension Settings tab.

---

## Security notes

- API keys stored in the extension are kept in `chrome.storage.local` (isolated per-extension, not accessible to web pages).
- For team or production deployments, configure keys server-side only and leave the extension API key field blank.
- The server's CORS policy allows `*` origins for local development. Restrict `allow_origins` in `app.py` for any internet-facing deployment.
- The server runs as a non-root user inside Docker.

---

## Development

```bash
# Server with auto-reload
cd server && uvicorn app:app --reload

# Run tests (add pytest to requirements-dev.txt as needed)
pytest server/
```
