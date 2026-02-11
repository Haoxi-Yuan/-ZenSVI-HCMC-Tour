"""Pluggable LLM provider interface."""

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class LLMResponse:
    content: str
    model: str
    prompt_tokens: int
    completion_tokens: int


class BaseLLMProvider(ABC):
    @abstractmethod
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 1024,
        temperature: float = 0.3,
    ) -> LLMResponse:
        """Generate a completion from the LLM."""
        ...


def get_provider(provider_name: str) -> BaseLLMProvider:
    """Factory function returning the configured provider."""
    if provider_name == "openai":
        from .openai_provider import OpenAIProvider
        return OpenAIProvider()
    elif provider_name == "claude":
        from .claude_provider import ClaudeProvider
        return ClaudeProvider()
    else:
        raise ValueError(f"Unknown LLM provider: {provider_name}")
