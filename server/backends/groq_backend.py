"""Groq backend — ultra-fast Llama / Mixtral inference."""

from __future__ import annotations

from groq import AsyncGroq

from .base import BaseBackend, CompletionResult
from .pricing import compute_cost


class GroqBackend(BaseBackend):
    # llama-3.3-70b-versatile offers best quality/speed on Groq
    DEFAULT_MODEL = "llama-3.3-70b-versatile"

    def __init__(self, api_key: str, model: str | None = None) -> None:
        self._client = AsyncGroq(api_key=api_key)
        self._model = model or self.DEFAULT_MODEL

    async def complete(self, system_prompt: str, user_prompt: str) -> CompletionResult:
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=2048,
        )
        usage = response.usage
        in_tok  = usage.prompt_tokens     if usage else 0
        out_tok = usage.completion_tokens if usage else 0
        model   = response.model or self._model
        return CompletionResult(
            text=response.choices[0].message.content or "",
            model=model,
            input_tokens=in_tok,
            output_tokens=out_tok,
            cost_usd=compute_cost(model, in_tok, out_tok),
        )
