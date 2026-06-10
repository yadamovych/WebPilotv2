"""
WebPilot AI Inference Server
FastAPI application exposing a REST + WebSocket API consumed by the Chrome extension.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import defaultdict
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backends import get_backend
from backends.base import CompletionResult
from config import Settings

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
settings = Settings()
logger = logging.getLogger("webpilot")
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")

_rate_buckets: dict[str, list[float]] = defaultdict(list)
_playback_logs: list[dict] = []
RATE_LIMIT_PER_MINUTE = 30
RATE_WINDOW_SEC = 60


def _check_rate_limit(client_id: str) -> None:
    now = time.time()
    bucket = [t for t in _rate_buckets[client_id] if now - t < RATE_WINDOW_SEC]
    if len(bucket) >= RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Rate limit exceeded — try again shortly")
    bucket.append(now)
    _rate_buckets[client_id] = bucket

app = FastAPI(
    title="WebPilot AI Server",
    version="1.0.0",
    description="AI inference backend for the WebPilot browser automation extension.",
)

# CORS: the extension origin is chrome-extension://<id>. Allow * for local dev.
# In production, restrict allow_origins to your extension's origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class FillTemplateRequest(BaseModel):
    userRequest: str = Field(
        ...,
        description="Natural language task description from the user",
    )
    variables: list[str] = Field(
        ...,
        description=("List of TEMPLATE VARIABLES {{varName}} to generate " "(not extracted variables)"),
    )
    templateName: str = Field(
        ...,
        description="Name of the automation template",
    )
    templateDescription: Optional[str] = Field(
        default="",
        description="Optional template description",
    )
    backend: Optional[str] = Field(
        default=None,
        description="AI backend to use",
    )
    # API key can be supplied by the extension for convenience; for production
    # deployments configure keys via server-side environment variables instead.
    apiKey: Optional[str] = Field(
        default=None,
        description="API key (optional if set server-side)",
    )
    model: Optional[str] = Field(
        default=None,
        description="Model override (optional)",
    )


class FillTemplateResponse(BaseModel):
    variables: dict[str, str]
    usage: Optional["UsageInfo"] = None


class PromptResponse(BaseModel):
    response: str
    usage: Optional["UsageInfo"] = None


class UsageInfo(BaseModel):
    model: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cost_usd: Optional[float] = None
    cost_display: str  # e.g. "$0.000123" or "unknown"


class PromptRequest(BaseModel):
    prompt: str
    backend: Optional[str] = None
    apiKey: Optional[str] = None
    model: Optional[str] = None
    systemPrompt: Optional[str] = None


class ExtensionErrorRecord(BaseModel):
    timestamp: str
    message: str
    stack: str
    context: dict
    url: str
    type: str


class ExtensionErrorReport(BaseModel):
    exportDate: str
    extensionVersion: str
    errorCount: int
    errors: list[ExtensionErrorRecord]


class PlaybackLogRequest(BaseModel):
    templateId: str = ""
    templateName: str = ""
    success: bool = False
    steps: list[dict] = Field(default_factory=list)
    startedAt: Optional[int] = None
    finishedAt: Optional[int] = None
    variables: dict[str, str] = Field(default_factory=dict)
    error: Optional[str] = None


class SelectorAnalysisRequest(BaseModel):
    failingSelector: str = Field(..., description="CSS selector that failed to match any elements")
    elementDescription: Optional[str] = Field(None, description="Human-readable description of what element to target")
    pageUrl: Optional[str] = Field(None, description="URL where the selector failed")
    extractionType: Optional[str] = Field(None, description="Type of extraction: text, attribute, html, etc.")


class SelectorAlternative(BaseModel):
    selector: str = Field(..., description="Alternative CSS selector")
    flexibility: str = Field(
        ...,
        description="Flexibility level: rigid, moderate, flexible",
    )
    explanation: str = Field(..., description="Why this selector is more robust")


class SelectorAnalysisResponse(BaseModel):
    original: str
    alternatives: list[SelectorAlternative]
    recommended: str = Field(..., description="Most flexible/robust alternative")
    confidence: float = Field(..., ge=0, le=1, description="Confidence in the recommendation")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_usage(result: "CompletionResult") -> "UsageInfo":
    total = result.input_tokens + result.output_tokens
    if result.cost_usd is not None:
        cost_display = f"${result.cost_usd:.6f}"
    else:
        cost_display = "unknown"
    return UsageInfo(
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        total_tokens=total,
        cost_usd=result.cost_usd,
        cost_display=cost_display,
    )


def _log_usage(endpoint: str, result: "CompletionResult") -> None:
    total = result.input_tokens + result.output_tokens
    cost_str = f"${result.cost_usd:.6f}" if result.cost_usd is not None else "n/a"
    logger.info(
        "[%s] model=%s  in=%d  out=%d  total=%d  cost=%s",
        endpoint,
        result.model,
        result.input_tokens,
        result.output_tokens,
        total,
        cost_str,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok"}


@app.post("/api/fill-template", response_model=FillTemplateResponse, tags=["ai"])
async def fill_template(request: FillTemplateRequest, req: Request) -> FillTemplateResponse:
    """
    Given a natural language user request and a list of TEMPLATE VARIABLE names,
    ask the AI to generate appropriate string values for each variable.

    Note: This endpoint handles TEMPLATE VARIABLES ({{varName}}) only.
    EXTRACTED VARIABLES ([[extracted.varName]]) are resolved client-side during playback.
    """
    client_id = req.client.host if req.client else "unknown"
    _check_rate_limit(client_id)

    if not request.variables:
        return FillTemplateResponse(variables={})

    backend = get_backend(
        request.backend or "openai",
        api_key=request.apiKey,
        model=request.model,
    )

    system_prompt = (
        "You are an AI assistant that helps automate web tasks.\n"
        "Given a user request and a list of template variable names, generate appropriate "
        "string values for each variable that would fulfill the user's intent.\n"
        "Return ONLY a valid JSON object — no prose, no markdown fences.\n\n"
        "IMPORTANT: For any variable that will be inserted into a rich text editor (like Jira), output HTML for formatting. "
        "Use <b>bold</b>, <i>italic</i>, <ul><li>lists</li></ul>, <a href>links</a>, and <br> for newlines. "
        "Do NOT use markdown, code fences, or blockquotes.\n"
        "If unsure, use plain text.\n\n"
        "Example:\n"
        'User request: "Create Jira ticket for PR-Agent deployment"\n'
        'Variables: ["title", "description"]\n'
        'Response: {"title": "Deploy PR-Agent to Production", '
        '"description": "<b>Track the end-to-end deployment of PR-Agent:</b><ul><li>build</li><li>push</li><li>rollout</li></ul>"}'
    )

    parts = [
        f'User request: "{request.userRequest}"',
        f'Template: "{request.templateName}"',
    ]
    if request.templateDescription:
        parts.append(f'Description: "{request.templateDescription}"')
    parts.append(f"Variables to fill: {json.dumps(request.variables)}")

    user_prompt = "\n".join(parts)

    try:
        result = await backend.complete(system_prompt, user_prompt)
        _log_usage("fill-template", result)
        variables = _extract_json(result.text)
        # Ensure all requested variables have a string value
        for var in request.variables:
            variables.setdefault(var, "")
        # Convert all values to strings (AI may return numbers, booleans, etc.)
        variables = {k: str(v) for k, v in variables.items()}
        return FillTemplateResponse(variables=variables, usage=_build_usage(result))
    except Exception as exc:
        logger.exception("fill-template error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/prompt", response_model=PromptResponse, tags=["ai"])
async def prompt_endpoint(request: PromptRequest) -> PromptResponse:
    """Generic single-turn prompt endpoint."""
    backend = get_backend(
        request.backend or "openai",
        api_key=request.apiKey,
        model=request.model,
    )
    system = request.systemPrompt or "You are a helpful assistant."
    try:
        result = await backend.complete(system, request.prompt)
        _log_usage("prompt", result)
        return PromptResponse(response=result.text, usage=_build_usage(result))
    except Exception as exc:
        logger.exception("prompt error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/extension-errors", tags=["extension"])
async def report_extension_errors(report: ExtensionErrorReport) -> dict:
    """
    Receive error reports from the WebPilot extension.
    Logs errors for investigation and monitoring.
    """
    logger.error(
        "[Extension Error Report] version=%s errorCount=%d url_samples=%s",
        report.extensionVersion,
        report.errorCount,
        [e.url for e in report.errors[:3]],  # Log first 3 URLs
    )

    # Log each error with full context for debugging
    for error in report.errors:
        logger.error(
            "[Extension Error] timestamp=%s type=%s message=%s context=%s url=%s",
            error.timestamp,
            error.type,
            error.message,
            error.context,
            error.url,
        )
        if error.stack:
            logger.debug("[Extension Error Stack]\n%s", error.stack)

    return {"success": True, "message": f"Received {report.errorCount} errors"}


@app.post("/api/playback-logs", tags=["extension"])
async def report_playback_log(report: PlaybackLogRequest) -> dict:
    """Receive structured playback run reports from the extension."""
    entry = report.model_dump()
    entry["receivedAt"] = int(time.time() * 1000)
    _playback_logs.append(entry)
    if len(_playback_logs) > 200:
        _playback_logs.pop(0)
    logger.info(
        "[Playback] template=%s success=%s steps=%d error=%s",
        report.templateName or report.templateId,
        report.success,
        len(report.steps),
        report.error,
    )
    return {"success": True}


@app.get("/api/playback-logs", tags=["extension"])
async def list_playback_logs(limit: int = 20) -> dict:
    """Return recent playback logs (dev/debug)."""
    return {"logs": _playback_logs[-limit:]}


@app.post("/api/analyze-selector", tags=["extension"])
async def analyze_selector_error(request: SelectorAnalysisRequest) -> SelectorAnalysisResponse:
    """
    Analyze failing CSS selectors and suggest alternatives using AI.

    Disabled by default in the extension (aiSelectorRecovery setting) because
    each failed step/retry can trigger a separate LLM call. Enable only when
    recorded selectors are frequently stale.
    """
    try:
        # Build analysis prompt
        prompt = f"""Analyze this failing CSS selector and suggest 3 more robust alternatives.

Original selector: {request.failingSelector}
Element target: {request.elementDescription or "Unknown"}
Extraction type: {request.extractionType or "text"}
Page: {request.pageUrl or "Unknown"}

For each alternative, provide:
1. The CSS selector
2. Flexibility level (rigid/moderate/flexible)
3. Why it's more robust

Focus on:
- Using nth-child instead of nth-of-type when possible
- Using class names or data attributes if available
- Fallback to parent element + descendant selectors
- Using more general selectors that survive DOM changes

Return ONLY valid JSON with this structure:
{{
  "alternatives": [
    {{"selector": "...", "flexibility": "...", "explanation": "..."}},
    ...
  ],
  "recommended_index": 0
}}"""

        # Use Groq backend for fast inference
        backend = get_backend(
            "groq",
            api_key=settings.groq_api_key,
            model=settings.groq_model,
        )

        result = await backend.complete(
            system_prompt="You are an expert CSS selector specialist. Return only valid JSON.",
            user_prompt=prompt,
        )

        # Parse response
        try:
            response_data = json.loads(result.text)
        except json.JSONDecodeError:
            # Fallback: extract JSON from response
            match = re.search(r"\{.*\}", result.text, re.DOTALL)
            if not match:
                raise ValueError(f"Failed to parse Groq response: {result.text}")
            response_data = json.loads(match.group(0))

        alternatives = [
            SelectorAlternative(
                selector=alt["selector"],
                flexibility=alt.get("flexibility", "moderate"),
                explanation=alt.get("explanation", "More robust selector"),
            )
            for alt in response_data.get("alternatives", [])
        ]

        recommended_idx = response_data.get("recommended_index", 0)
        recommended = (
            alternatives[recommended_idx].selector if recommended_idx < len(alternatives) else request.failingSelector
        )

        logger.info(
            "[Selector Analysis] original=%s recommended=%s alternatives=%d",
            request.failingSelector,
            recommended,
            len(alternatives),
        )

        return SelectorAnalysisResponse(
            original=request.failingSelector,
            alternatives=alternatives,
            recommended=recommended,
            confidence=0.85,
        )

    except Exception as exc:
        logger.exception("selector analysis error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """
    WebSocket interface for streaming / multiplexed use.

    Accepted message types:
      • { "type": "fill_template", "payload": FillTemplateRequest }
      • { "type": "prompt",        "payload": PromptRequest }
      • { "type": "ping" }
    """
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg_type == "fill_template":
                try:
                    req = FillTemplateRequest(**data.get("payload", {}))
                    result = await fill_template(req)
                    await websocket.send_json({"type": "fill_template_result", "data": result.model_dump()})
                except Exception as exc:
                    await websocket.send_json({"type": "error", "message": str(exc)})

            elif msg_type == "prompt":
                try:
                    req = PromptRequest(**data.get("payload", {}))
                    result = await prompt_endpoint(req)
                    await websocket.send_json({"type": "prompt_result", "data": result.model_dump()})
                except Exception as exc:
                    await websocket.send_json({"type": "error", "message": str(exc)})

            else:
                await websocket.send_json({"type": "error", "message": f"Unknown type: {msg_type}"})

    except WebSocketDisconnect:
        pass


# ---------------------------------------------------------------------------
# JSON extraction helper
# ---------------------------------------------------------------------------


def _extract_json(text: str) -> dict:
    """Robustly extract a JSON object from an AI response string."""
    text = text.strip()

    # 0. Strip reasoning/thinking tags that some models include (e.g., <think>...</think>, <analysis>...</analysis>)
    text = re.sub(
        r"<(think|analysis|reasoning|reflection)>.*?</\1>",
        "",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    ).strip()

    # 1. Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Strip markdown code fences
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 3. Find first {...} block
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse JSON from AI response: {text[:300]!r}")


# ---------------------------------------------------------------------------
# Entry point (for `python app.py`)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
