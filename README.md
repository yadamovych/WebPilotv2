# WebPilot

Browser automation powered by AI — record workflows once, replay them with natural language.

---

## Getting Started: Installing and Using WebPilot

### 1. Download and Install the Extension

1. Download the latest release of the extension as a ZIP file (or clone the repo).
2. Unzip the archive. You should see a folder named `extension/` with files like `manifest.json`, `popup.html`, etc.
3. Open Chrome or Edge and go to `chrome://extensions` (or `edge://extensions`).
4. Enable **Developer mode** (toggle in the top right).
5. Click **Load unpacked** and select the `extension/` folder.
6. The WebPilot icon will appear in your browser toolbar.

### 2. Configure the Extension

1. Click the WebPilot icon to open the popup.
2. Go to the **Settings** tab.
3. Set the **Server URL** to your production server:  
   `http://webpilot.duckdns.org:8000`
4. Choose your **AI Backend** (e.g., Groq, OpenAI, Anthropic, or Local vLLM).
5. Enter your **API Key** if required (for OpenAI, Groq, or Anthropic).
6. (Optional) Set a model name or enable Dev Mode.
7. Click **Save Settings**.

### 3. Using WebPilot

- **Record a workflow:**  
  1. Open the page you want to automate.
  2. Click the WebPilot icon → **Record** tab → **Start Recording**.
  3. Perform your actions (clicks, typing, etc.).
  4. Click **Stop Recording**. Edit steps if needed.
  5. Name and **Save** the workflow as a template.

- **Run a workflow:**  
  1. Go to the **Templates** tab.
  2. Click **Play** on a saved template.
  3. Enter your prompt (e.g., “Create Jira ticket for PR-Agent deployment”).
  4. Click **Execute with AI**.
  5. WebPilot will fill variables and run the steps automatically.

### 4. Troubleshooting

- If the server status shows **Offline**, check your Server URL and network.
- Make sure your API keys are valid and the backend is running.
- For production, use the stable URL:  
  `http://webpilot.duckdns.org:8000`

---

## Roadmap & Improvements

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for:
- Detailed comparison with Selenium IDE
- Recommended enhancements (multi-locator fallback, assertions, control flow, etc.)
- Headless execution & CI/CD integration
- Phase-based implementation roadmap

---

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
  requirements.txt          Runtime dependencies
  requirements-dev.txt      Dev/CI dependencies (pytest, black, mypy, …)
  backends/
    openai_backend.py
    groq_backend.py
    anthropic_backend.py
    vllm_backend.py
  tests/
    conftest.py
    test_app.py

infra/              Terraform — AWS infrastructure as code
  main.tf           Provider config + optional S3 backend
  variables.tf      All inputs (region, instance type, …)
  network.tf        VPC, public subnet, security groups
  ecr.tf            ECR repository + lifecycle policy
  iam.tf            EC2 role, ECS task execution role, GitHub OIDC role
  ssm.tf            SSM SecureString parameters for API keys
  ecs.tf            ECS cluster, t3.micro launch template, task def, service
  outputs.tf        Values to copy into GitHub Actions variables

.github/workflows/
  ci.yml            CI: lint, type-check, test, Docker build check, security scan
  cd.yml            CD: build → push to ECR → rolling deploy to ECS

docker-compose.yml           Local dev with cloud AI backends (OpenAI / Groq / Anthropic)
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
   - The AI server generates `{{title}}` and `{{description}}` TEMPLATE VARIABLES from your request.
   - EXTRACTED VARIABLES like `[[extracted.ticketId]]` are resolved from the page during playback.
   - The extension executes each step with the substituted values.

---

## Template format

Templates are stored in `chrome.storage.local`. Steps can use two types of variables:

1. **TEMPLATE VARIABLES `{{varName}}`** — AI-generated values filled based on the user request
2. **EXTRACTED VARIABLES `[[extracted.varName]]`** — Values extracted from the page/DOM during playback

Example:

```json
{
  "id": "uuid",
  "name": "Create Jira Ticket",
  "createdAt": 1700000000000,
  "steps": [
    { "action": "click",     "selector": "#create-ticket",  "label": "Create" },
    { "action": "type",      "selector": "#title",          "value": "{{title}}" },
    { "action": "type",      "selector": "#description",    "value": "{{description}}" },
    { "action": "extract",   "selector": ".ticket-id",     "variable": "ticketId", "extractType": "text", "label": "Extract ticket ID" },
    { "action": "type",      "selector": "#related",        "value": "[[extracted.ticketId]]" },
    { "action": "click",     "selector": "[type=submit]",   "label": "Submit" }
  ]
}
```

**Variable types:**
- `{{title}}`, `{{description}}` — AI will generate these based on the user request "Create Jira ticket for PR-Agent deployment"
- `[[extracted.ticketId]]` — Extracted from the page after the ticket is created

Supported step actions: `click`, `type`, `select`, `navigate`, `wait`, `extract`.

---

## Server API

| Method | Path | Description |
|---|---|---|
| `GET`  | `/health` | Health check |
| `POST` | `/api/fill-template` | Fill `{{template}}` placeholders with AI-generated values |
| `POST` | `/api/prompt` | Generic single-turn prompt |
| `WS`   | `/ws` | WebSocket multiplex interface |

### `POST /api/fill-template`

Fills TEMPLATE VARIABLES (`{{varName}}`) with AI-generated values based on the user request.

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

Note: EXTRACTED VARIABLES (`[[extracted.varName]]`) are resolved at runtime during playback; they are not sent to the AI server.

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

# Install dev dependencies
cd server && pip install -r requirements-dev.txt

# Run tests
pytest server/

# Run tests with coverage
pytest server/ --cov=server --cov-report=term-missing

# Lint + format check
flake8 server/
black --check server/ --line-length=120

# Type check
mypy server/ --ignore-missing-imports
```

---

## Infrastructure (AWS — free tier)

All AWS resources are defined in `infra/` using Terraform. The setup uses:

| Resource | Free tier |  |
|---|---|---|
| EC2 t3.micro | 750 h/month (12 months) | ECS container host |
| ECR | 500 MB/month | Docker image registry |
| SSM Parameter Store (standard) | Free | API key storage |
| CloudWatch Logs | 5 GB/month | Container logs |
| VPC / Subnet / IGW / SG | Free | Networking |

> No ALB, no NAT gateway, no Fargate — all kept within free-tier limits.

### Prerequisites

- [Terraform ≥ 1.5](https://developer.hashicorp.com/terraform/install)
- AWS CLI configured (`aws configure`) with an IAM user that has admin access

### First-time setup

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set github_repo to "your-org/WebPilotv2"

terraform init
terraform plan
terraform apply
```

After apply, Terraform prints all values you need to configure GitHub Actions:

```
Outputs:
  ecr_repository_name        → ECR_REPOSITORY
  aws_region                 → AWS_REGION
  ecs_cluster_name           → ECS_CLUSTER
  ecs_service_name           → ECS_SERVICE
  ecs_task_definition_family → ECS_TASK_DEFINITION
  container_name             → CONTAINER_NAME
  github_actions_role_arn    → AWS_ROLE_TO_ASSUME (secret)
```

### Set API keys in SSM

API keys are stored as SSM SecureString parameters — never in code or GitHub secrets.

```bash
aws ssm put-parameter --name "/webpilot/openai_api_key" \
  --value "sk-..." --type SecureString --overwrite

aws ssm put-parameter --name "/webpilot/groq_api_key" \
  --value "gsk_..." --type SecureString --overwrite

aws ssm put-parameter --name "/webpilot/anthropic_api_key" \
  --value "sk-ant-..." --type SecureString --overwrite
```

### Tear down

```bash
cd infra && terraform destroy
```

---

## CI/CD (GitHub Actions)

| Workflow | Trigger | What it does |
|---|---|---|
| **CI** (`.github/workflows/ci.yml`) | Push / PR to `main`, `develop` | Lint, type-check, test (Python 3.10–3.12), Docker build, security scan |
| **CD** (`.github/workflows/cd.yml`) | Push to `main` or `v*.*.*` tag | Build image → push to ECR → rolling deploy to ECS |

### GitHub Actions setup

After running `terraform apply`, copy the outputs into your repository
(**Settings → Secrets and Variables → Actions**):

**Variables** (non-secret):

| Name | Source |
|---|---|
| `AWS_REGION` | `terraform output aws_region` |
| `ECR_REPOSITORY` | `terraform output ecr_repository_name` |
| `ECS_CLUSTER` | `terraform output ecs_cluster_name` |
| `ECS_SERVICE` | `terraform output ecs_service_name` |
| `ECS_TASK_DEFINITION` | `terraform output ecs_task_definition_family` |
| `CONTAINER_NAME` | `terraform output container_name` |

**Secrets**:

| Name | Source |
|---|---|
| `AWS_ROLE_TO_ASSUME` | `terraform output github_actions_role_arn` |

The CD workflow authenticates to AWS using **OIDC** (no long-lived access keys stored in GitHub).

---

## Production deployment

### Live endpoints

| URL | Description |
|---|---|
| `http://webpilot.duckdns.org:8000/health` | Health check |
| `http://webpilot.duckdns.org:8000/api/fill-template` | Fill template |
| `http://webpilot.duckdns.org:8000/ws` | WebSocket |

> **Note:** DNS auto-updates on instance restart via DuckDNS (configured in EC2 user_data). If the domain stops resolving, get the current IP with the command below and update DuckDNS manually.

### Stable DNS options (free)

**Option A — DuckDNS** (`webpilot.duckdns.org`)
1. Go to [duckdns.org](https://www.duckdns.org) → log in with GitHub
2. Create subdomain and point it to the EC2 public IP
3. To auto-update on instance restart, add to EC2 user_data in `infra/ecs.tf`:
```bash
curl -s "https://www.duckdns.org/update?domains=webpilot&token=<YOUR_TOKEN>&ip=" > /dev/null
```

**Option B — Elastic IP** (same IP survives restarts, free while attached)
```bash
EIP=$(aws ec2 allocate-address --domain vpc --profile webpilot --query AllocationId --output text)
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=webpilot-ecs-host" "Name=instance-state-name,Values=running" \
  --profile webpilot --query "Reservations[0].Instances[0].InstanceId" --output text)
aws ec2 associate-address --instance-id $INSTANCE_ID --allocation-id $EIP --profile webpilot
```

### Useful ops commands

```bash
# Check ECS service health
aws ecs describe-services \
  --cluster webpilot-cluster --services webpilot-service \
  --profile webpilot \
  --query "services[0].{running:runningCount,desired:desiredCount,status:status}"

# Tail live container logs
aws logs tail /ecs/webpilot --follow --profile webpilot

# Last 1 hour of logs
aws logs tail /ecs/webpilot --since 1h --profile webpilot

# Filter errors only
aws logs filter-log-events \
  --log-group-name /ecs/webpilot \
  --filter-pattern "ERROR" \
  --profile webpilot \
  --query "events[].message" --output text

# Force a new deployment (e.g. after manual ECR push)
aws ecs update-service \
  --cluster webpilot-cluster \
  --service webpilot-service \
  --force-new-deployment \
  --profile webpilot

# Get EC2 public IP
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=webpilot-ecs-host" "Name=instance-state-name,Values=running" \
  --profile webpilot \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text

# Manual first image push (before CD pipeline has run)
aws ecr get-login-password --region eu-north-1 --profile webpilot \
  | docker login --username AWS --password-stdin \
    637423363284.dkr.ecr.eu-north-1.amazonaws.com
docker build -t webpilot-server ./server
docker tag webpilot-server:latest \
  637423363284.dkr.ecr.eu-north-1.amazonaws.com/webpilot-server:latest
docker push 637423363284.dkr.ecr.eu-north-1.amazonaws.com/webpilot-server:latest
```
