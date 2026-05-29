"""
Backend factory — returns the correct BaseBackend implementation.
API keys are resolved in priority order:
  1. Supplied explicitly by the caller (from the extension request)
  2. Server-side environment variables in config.Settings
"""

from __future__ import annotations

from config import Settings
from .base import BaseBackend
from .anthropic_backend import AnthropicBackend
from .groq_backend import GroqBackend
from .openai_backend import OpenAIBackend
from .vllm_backend import VLLMBackend

_settings = Settings()


def get_backend(
    name: str,
    *,
    api_key: str | None = None,
    model: str | None = None,
) -> BaseBackend:
    """
    Args:
        name:    One of "openai", "groq", "anthropic", "vllm".
        api_key: Optional key override from the request.
        model:   Optional model override from the request.
    """
    name = (name or _settings.default_backend or "openai").lower().strip()

    # Treat blank strings the same as None so the backend uses its DEFAULT_MODEL
    model = model.strip() if model else None
    model = model or None

    # Reject models that are clearly not chat/completion models (e.g. Whisper)
    _NON_CHAT_PREFIXES = ("whisper", "tts-", "dall-e", "text-embedding")
    if model and any(model.lower().startswith(p) for p in _NON_CHAT_PREFIXES):
        raise ValueError(
            f"Model '{model}' is not a chat-completion model. "
            "Clear the model override in the extension Settings tab."
        )

    if name == "openai":
        key = api_key or _settings.openai_api_key
        if not key:
            raise ValueError("OpenAI API key is required (set OPENAI_API_KEY or pass apiKey)")
        return OpenAIBackend(api_key=key, model=model or _settings.openai_model)

    if name == "groq":
        key = api_key or _settings.groq_api_key
        if not key:
            raise ValueError("Groq API key is required (set GROQ_API_KEY or pass apiKey)")
        return GroqBackend(api_key=key, model=model or _settings.groq_model)

    if name == "anthropic":
        key = api_key or _settings.anthropic_api_key
        if not key:
            raise ValueError("Anthropic API key is required (set ANTHROPIC_API_KEY or pass apiKey)")
        return AnthropicBackend(api_key=key, model=model or _settings.anthropic_model)

    if name == "vllm":
        return VLLMBackend(
            base_url=_settings.vllm_base_url,
            model=model or _settings.vllm_model,
            api_key=api_key or _settings.vllm_api_key,
        )

    raise ValueError(f"Unknown backend: {name!r}. Choose from: openai, groq, anthropic, vllm")
