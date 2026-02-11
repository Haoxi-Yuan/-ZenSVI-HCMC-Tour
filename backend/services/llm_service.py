"""LLM orchestrator: gathers analytics data, calls provider, manages cache."""

import json
import traceback

from backend.config import LLM_PROVIDER
from backend.services.llm_providers import get_provider
from backend.services.cache_service import cache_get, cache_set
from backend.services.prompts import build_insight_prompt
from backend.services.analytics import get_street_rank, get_similar_streets, get_street_drivers


async def generate_street_insight(street_name: str) -> dict:
    """Generate LLM insight for a street. Uses cache if available.

    Returns:
        {
            "street": str,
            "insight": str,
            "model": str,
            "cached": bool,
        }
    """
    # 1. Check cache
    cache_key = f"insight:{street_name}"
    cached = cache_get(cache_key)
    if cached:
        return {**json.loads(cached), "cached": True}

    # 2. Gather analytics data
    rank_info = get_street_rank(street_name)
    if not rank_info:
        return {
            "street": street_name,
            "insight": "Insight unavailable: street data not found.",
            "model": "none",
            "cached": False,
        }

    similar = get_similar_streets(street_name, "combined", top_k=3)
    drivers = get_street_drivers(street_name)
    if not drivers:
        drivers = {"safety": {"score": 0, "drivers": []},
                   "accessibility": {"score": 0, "drivers": []},
                   "comfort": {"score": 0, "drivers": []}}

    # 3. Build prompt
    system_prompt, user_prompt = build_insight_prompt(
        street_name=street_name,
        rank_info=rank_info,
        similar_streets=similar,
        drivers=drivers,
    )

    # 4. Call LLM
    try:
        provider = get_provider(LLM_PROVIDER)
        response = await provider.generate(
            system_prompt, user_prompt, max_tokens=400, temperature=0.3,
        )
        insight_text = response.content.strip()
        model_name = response.model
    except Exception:
        traceback.print_exc()
        return {
            "street": street_name,
            "insight": "Insight generation temporarily unavailable.",
            "model": "error",
            "cached": False,
        }

    # 5. Cache result
    result = {
        "street": street_name,
        "insight": insight_text,
        "model": model_name,
    }
    cache_set(cache_key, json.dumps(result))

    return {**result, "cached": False}
