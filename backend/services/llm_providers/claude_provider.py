"""Anthropic Claude LLM provider (stub — requires ANTHROPIC_API_KEY in .env)."""

import httpx

from backend.config import ANTHROPIC_API_KEY
from . import BaseLLMProvider, LLMResponse


class ClaudeProvider(BaseLLMProvider):
    def __init__(self):
        self.model = "claude-sonnet-4-5-20250929"

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 1024,
        temperature: float = 0.3,
    ) -> LLMResponse:
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY not set in .env")

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": self.model,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_prompt}],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
            return LLMResponse(
                content=data["content"][0]["text"],
                model=data["model"],
                prompt_tokens=data["usage"]["input_tokens"],
                completion_tokens=data["usage"]["output_tokens"],
            )
