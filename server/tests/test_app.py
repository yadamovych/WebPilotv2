"""
Tests for the WebPilot FastAPI server.
Run: pytest server/ -v
"""
from __future__ import annotations

import json
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch

from app import app, _extract_json
from backends.base import CompletionResult
from backends.pricing import compute_cost


# ---------------------------------------------------------------------------
# _extract_json unit tests
# ---------------------------------------------------------------------------

class TestExtractJson:
    def test_plain_json(self):
        assert _extract_json('{"a": "1"}') == {"a": "1"}

    def test_with_markdown_fence(self):
        text = '```json\n{"key": "value"}\n```'
        assert _extract_json(text) == {"key": "value"}

    def test_with_prose_before(self):
        text = 'Here is the result:\n{"title": "foo", "desc": "bar"}'
        assert _extract_json(text) == {"title": "foo", "desc": "bar"}

    def test_with_multiline_values(self):
        data = {"title": "Deploy", "description": "Line 1\nLine 2\nLine 3"}
        assert _extract_json(json.dumps(data)) == data

    def test_raises_on_garbage(self):
        with pytest.raises(ValueError, match="Could not parse JSON"):
            _extract_json("this is not json at all")

    def test_truncated_json_raises(self):
        truncated = '{"subject": "Deploy PR-Agent", "description": "### Overview\nThis ticket tracks'
        with pytest.raises((ValueError, json.JSONDecodeError)):
            _extract_json(truncated)


# ---------------------------------------------------------------------------
# Pricing unit tests
# ---------------------------------------------------------------------------

class TestComputeCost:
    def test_known_model(self):
        cost = compute_cost("gpt-4o-mini", 1_000_000, 0)
        assert cost == pytest.approx(0.15)

    def test_output_tokens(self):
        cost = compute_cost("gpt-4o-mini", 0, 1_000_000)
        assert cost == pytest.approx(0.60)

    def test_unknown_model_returns_none(self):
        assert compute_cost("unknown-model-xyz", 100, 100) is None

    def test_model_prefix_matching(self):
        # "llama-3.3-70b-versatile" should match "llama-3.3-70b"
        cost = compute_cost("llama-3.3-70b-versatile", 1_000_000, 0)
        assert cost == pytest.approx(0.59)


# ---------------------------------------------------------------------------
# HTTP endpoint tests (mocked backend)
# ---------------------------------------------------------------------------

MOCK_RESULT = CompletionResult(
    text='{"title": "Deploy PR-Agent", "description": "Track deployment."}',
    model="gpt-4o-mini",
    input_tokens=50,
    output_tokens=20,
    cost_usd=0.000020,
)


@pytest.fixture
def mock_backend():
    """Patch get_backend to return a mock that yields MOCK_RESULT."""
    backend = AsyncMock()
    backend.complete = AsyncMock(return_value=MOCK_RESULT)
    with patch("app.get_backend", return_value=backend):
        yield backend


@pytest.mark.asyncio
async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_fill_template_success(mock_backend):
    payload = {
        "userRequest": "Create Jira ticket for PR-Agent deployment",
        "variables": ["title", "description"],
        "templateName": "Create Jira Ticket",
        "backend": "openai",
        "apiKey": "sk-test",
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/fill-template", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["variables"]["title"] == "Deploy PR-Agent"
    assert "description" in body["variables"]


@pytest.mark.asyncio
async def test_fill_template_empty_variables():
    payload = {
        "userRequest": "anything",
        "variables": [],
        "templateName": "Empty",
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/fill-template", json=payload)
    assert r.status_code == 200
    assert r.json()["variables"] == {}


@pytest.mark.asyncio
async def test_fill_template_missing_vars_get_empty_string(mock_backend):
    """Variables not present in AI response must default to ''."""
    mock_backend.complete.return_value = CompletionResult(
        text='{"title": "only title here"}',
        model="gpt-4o-mini",
        input_tokens=10,
        output_tokens=5,
    )
    payload = {
        "userRequest": "x",
        "variables": ["title", "description"],
        "templateName": "T",
        "backend": "openai",
        "apiKey": "sk-test",
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/fill-template", json=payload)
    assert r.status_code == 200
    assert r.json()["variables"]["description"] == ""


@pytest.mark.asyncio
async def test_prompt_endpoint(mock_backend):
    mock_backend.complete.return_value = CompletionResult(
        text="Hello!", model="gpt-4o-mini", input_tokens=5, output_tokens=2
    )
    payload = {"prompt": "Say hello", "backend": "openai", "apiKey": "sk-test"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/prompt", json=payload)
    assert r.status_code == 200
    assert r.json()["response"] == "Hello!"
