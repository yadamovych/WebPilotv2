"""Abstract base class for AI inference backends."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class CompletionResult:
    """Returned by every backend's complete() call."""
    text: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None   # None = pricing unknown for this model


class BaseBackend(ABC):
    @abstractmethod
    async def complete(self, system_prompt: str, user_prompt: str) -> CompletionResult:
        """
        Send a single-turn chat completion request.

        Args:
            system_prompt: Instructions / persona for the model.
            user_prompt:   The user's message.

        Returns:
            CompletionResult with the model reply and token usage.
        """
        ...
