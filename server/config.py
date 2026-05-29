"""
Server configuration — values are read from environment variables or a .env file.
"""

from __future__ import annotations

from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Cloud provider keys (set server-side; the extension may also pass them per-request)
    openai_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None

    # Optional server-side model overrides (take priority over each backend's DEFAULT_MODEL)
    openai_model: Optional[str] = None
    groq_model: Optional[str] = None
    anthropic_model: Optional[str] = None

    # Local vLLM
    vllm_base_url: str = "http://vllm:8000/v1"
    vllm_model: Optional[str] = None
    vllm_api_key: str = "token-abc123"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
