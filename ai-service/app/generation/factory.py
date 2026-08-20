"""Builds the configured GenerationClient.

The single place a provider name becomes a concrete client. Everything else in
the codebase depends on the `GenerationClient` interface, so adding a provider
means adding a branch here and nothing else.

Falls back to `DisabledGenerationClient` whenever the active provider has no
credential — which makes generation refuse honestly instead of the service
failing to start. Retrieval, search and JD mapping never touch this.
"""

from __future__ import annotations

from app.common.logging import get_logger
from app.config import Settings
from app.generation.client import (
    AnthropicGenerationClient,
    DisabledGenerationClient,
    GenerationClient,
)
from app.generation.gemini_client import GeminiGenerationClient

logger = get_logger(__name__)


def build_generation_client(settings: Settings) -> GenerationClient:
    provider = settings.llm_provider
    api_key = settings.resolved_api_key
    model = settings.resolved_llm_model

    if provider == "none":
        logger.info("Generation provider is 'none'; generation is disabled")
        return DisabledGenerationClient()

    if not api_key:
        # Names only — never the value, and never a partial value.
        logger.warning(
            "Generation provider has no credential; generation is disabled",
            extra={
                "provider": provider,
                "expectedVariable": _KEY_VARIABLE.get(provider, "LLM_API_KEY"),
            },
        )
        return DisabledGenerationClient()

    if provider == "gemini":
        logger.info(
            "Generation provider configured",
            extra={"provider": "gemini", "model": model},
        )
        return GeminiGenerationClient(
            api_key=api_key,
            model=model,
            max_tokens=settings.llm_max_tokens,
            timeout_seconds=settings.llm_timeout_seconds,
            temperature=settings.llm_temperature,
            thinking_budget=settings.llm_thinking_budget,
            max_attempts=settings.llm_max_attempts,
        )

    if provider == "anthropic":
        logger.info(
            "Generation provider configured",
            extra={"provider": "anthropic", "model": model},
        )
        return AnthropicGenerationClient(
            api_key=api_key,
            model=model,
            max_tokens=settings.llm_max_tokens,
            timeout_seconds=settings.llm_timeout_seconds,
        )

    logger.error("Unknown generation provider", extra={"provider": provider})
    return DisabledGenerationClient()


_KEY_VARIABLE = {"gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}
