"""
Local vLLM backend.
vLLM exposes an OpenAI-compatible API, so we reuse the openai SDK
pointed at the local endpoint.

Default target: http://vllm:8000/v1  (Docker Compose service name).
For bare-metal: http://localhost:8080/v1
"""

from __future__ import annotations

from openai import AsyncOpenAI

from .base import BaseBackend, CompletionResult
from .pricing import compute_cost


class VLLMBackend(BaseBackend):
    def __init__(
        self,
        base_url: str = "http://vllm:8000/v1",
        model: str | None = None,
        api_key: str = "token-abc123",
    ) -> None:
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        self._model = model  # resolved lazily if None

    async def _resolve_model(self) -> str:
        if self._model:
            return self._model
        models = await self._client.models.list()
        if not models.data:
            raise RuntimeError("vLLM reported no loaded models")
        self._model = models.data[0].id
        return self._model

    async def complete(self, system_prompt: str, user_prompt: str) -> CompletionResult:
        model = await self._resolve_model()
        response = await self._client.chat.completions.create(
            model=model,
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
        return CompletionResult(
            text=response.choices[0].message.content or "",
            model=model,
            input_tokens=in_tok,
            output_tokens=out_tok,
            cost_usd=compute_cost(model, in_tok, out_tok),
        )
