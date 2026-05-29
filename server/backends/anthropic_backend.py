"""Anthropic backend (Claude 3 Haiku / Sonnet / Opus)."""

from __future__ import annotations

import anthropic

from .base import BaseBackend, CompletionResult
from .pricing import compute_cost


class AnthropicBackend(BaseBackend):
    DEFAULT_MODEL = "claude-3-haiku-20240307"

    def __init__(self, api_key: str, model: str | None = None) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model or self.DEFAULT_MODEL

    async def complete(self, system_prompt: str, user_prompt: str) -> CompletionResult:
        message = await self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        block = message.content[0]
        text = block.text if hasattr(block, "text") else ""
        in_tok  = message.usage.input_tokens  if message.usage else 0
        out_tok = message.usage.output_tokens if message.usage else 0
        return CompletionResult(
            text=text,
            model=message.model or self._model,
            input_tokens=in_tok,
            output_tokens=out_tok,
            cost_usd=compute_cost(message.model or self._model, in_tok, out_tok),
        )
