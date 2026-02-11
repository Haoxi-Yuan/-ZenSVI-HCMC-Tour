"""Story service: selects 7 narrative shots and generates LLM narrations."""

import json
import traceback

from backend import data_store
from backend.config import LLM_PROVIDER
from backend.services.llm_providers import get_provider
from backend.services.cache_service import cache_get, cache_set
from backend.services.prompts import build_story_prompt
from backend.services.analytics import get_street_rank


def _is_valid_name(name: str) -> bool:
    """Filter out garbage street names (stringified Python lists, etc.)."""
    if name.startswith("[") or name.startswith("'") or name.startswith('"'):
        return False
    if len(name) < 2 or len(name) > 80:
        return False
    return True


def _sorted_streets(dim: str, reverse: bool = True, limit: int = 10):
    """Return top or bottom streets by dimension, filtering garbage names."""
    summary = data_store.streets_summary
    valid = [(k, v) for k, v in summary.items() if _is_valid_name(k)]
    valid.sort(key=lambda x: x[1].get(dim, 0), reverse=reverse)
    return valid[:limit]


def get_story_shots() -> list[dict]:
    """Select 7 narrative shots from the data.

    Returns a list of shot dicts without narrations (narrations added separately).
    """
    summary = data_store.streets_summary
    city = data_store.city_stats

    shots = []

    # Shot 1: City Overview (fixed camera, zoomed out)
    shots.append({
        "id": 1,
        "theme": "City Overview",
        "street_name": None,
        "camera": {
            "center": [106.695, 10.775],
            "zoom": 11.5,
            "pitch": 45,
            "bearing": -15,
        },
        "duration_ms": 8000,
        "focus_property": "walkability",
        "data_context": {
            "total_streets": len(summary),
            "avg_walkability": city.get("walkability", {}).get("mean", 0),
            "total_districts": city.get("total_districts", 24),
        },
    })

    # Shot 2: Best Walkability
    top_walk = _sorted_streets("walkability", reverse=True, limit=5)
    if top_walk:
        name, data = top_walk[0]
        shots.append({
            "id": 2,
            "theme": "Most Walkable Street",
            "street_name": name,
            "camera": {
                "center": [data["lon"], data["lat"]],
                "zoom": 15.5,
                "pitch": 50,
                "bearing": 20,
            },
            "duration_ms": 8000,
            "focus_property": "walkability",
            "data_context": {
                "walkability": round(data.get("walkability", 0), 2),
                "safety": round(data.get("safety", 0), 2),
                "accessibility": round(data.get("accessibility", 0), 2),
                "comfort": round(data.get("comfort", 0), 2),
            },
        })

    # Shot 3: Safest Street
    top_safe = _sorted_streets("safety", reverse=True, limit=5)
    if top_safe:
        # Pick one different from shot 2
        for name, data in top_safe:
            if shots[-1]["street_name"] != name:
                break
        shots.append({
            "id": 3,
            "theme": "Safest Street",
            "street_name": name,
            "camera": {
                "center": [data["lon"], data["lat"]],
                "zoom": 15.5,
                "pitch": 40,
                "bearing": -30,
            },
            "duration_ms": 7000,
            "focus_property": "safety",
            "data_context": {
                "walkability": round(data.get("walkability", 0), 2),
                "safety": round(data.get("safety", 0), 2),
                "accessibility": round(data.get("accessibility", 0), 2),
                "comfort": round(data.get("comfort", 0), 2),
            },
        })

    # Shot 4: Most Accessible
    top_acc = _sorted_streets("accessibility", reverse=True, limit=5)
    if top_acc:
        used = {s["street_name"] for s in shots if s["street_name"]}
        for name, data in top_acc:
            if name not in used:
                break
        shots.append({
            "id": 4,
            "theme": "Most Accessible Street",
            "street_name": name,
            "camera": {
                "center": [data["lon"], data["lat"]],
                "zoom": 15.5,
                "pitch": 45,
                "bearing": 60,
            },
            "duration_ms": 7000,
            "focus_property": "accessibility",
            "data_context": {
                "walkability": round(data.get("walkability", 0), 2),
                "safety": round(data.get("safety", 0), 2),
                "accessibility": round(data.get("accessibility", 0), 2),
                "comfort": round(data.get("comfort", 0), 2),
            },
        })

    # Shot 5: Hidden Danger — high safety but low overall walkability
    valid = [(k, v) for k, v in summary.items()
             if _is_valid_name(k) and v.get("safety", 0) >= 7.0]
    valid.sort(key=lambda x: x[1].get("walkability", 0))
    used = {s["street_name"] for s in shots if s["street_name"]}
    for name, data in valid:
        if name not in used:
            break
    else:
        name, data = valid[0] if valid else (None, None)

    if name and data:
        shots.append({
            "id": 5,
            "theme": "Hidden Danger",
            "street_name": name,
            "camera": {
                "center": [data["lon"], data["lat"]],
                "zoom": 15.5,
                "pitch": 55,
                "bearing": -60,
            },
            "duration_ms": 8000,
            "focus_property": "safety",
            "data_context": {
                "walkability": round(data.get("walkability", 0), 2),
                "safety": round(data.get("safety", 0), 2),
                "accessibility": round(data.get("accessibility", 0), 2),
                "comfort": round(data.get("comfort", 0), 2),
            },
        })

    # Shot 6: Worst Walkability
    bot_walk = _sorted_streets("walkability", reverse=False, limit=5)
    if bot_walk:
        used = {s["street_name"] for s in shots if s["street_name"]}
        for name, data in bot_walk:
            if name not in used:
                break
        shots.append({
            "id": 6,
            "theme": "Least Walkable Street",
            "street_name": name,
            "camera": {
                "center": [data["lon"], data["lat"]],
                "zoom": 15.5,
                "pitch": 50,
                "bearing": 45,
            },
            "duration_ms": 8000,
            "focus_property": "walkability",
            "data_context": {
                "walkability": round(data.get("walkability", 0), 2),
                "safety": round(data.get("safety", 0), 2),
                "accessibility": round(data.get("accessibility", 0), 2),
                "comfort": round(data.get("comfort", 0), 2),
            },
        })

    # Shot 7: Call to Action (zoom back out)
    shots.append({
        "id": 7,
        "theme": "Call to Action",
        "street_name": None,
        "camera": {
            "center": [106.70, 10.78],
            "zoom": 12,
            "pitch": 30,
            "bearing": 0,
        },
        "duration_ms": 6000,
        "focus_property": "walkability",
        "data_context": {
            "total_streets": len(summary),
        },
    })

    return shots


async def generate_story_narrations(shots: list[dict]) -> list[dict]:
    """Add LLM-generated narrations to each shot. Uses cache per shot."""
    city = data_store.city_stats
    results = []

    for shot in shots:
        cache_key = f"story:shot:{shot['id']}"
        cached = cache_get(cache_key)

        if cached:
            shot_with_narration = {**shot, "narration": json.loads(cached)["narration"]}
            # Remove internal data_context from response
            shot_with_narration.pop("data_context", None)
            results.append(shot_with_narration)
            continue

        # Get rank info for streets with names
        rank_info = None
        if shot["street_name"]:
            rank_info = get_street_rank(shot["street_name"])

        system_prompt, user_prompt = build_story_prompt(
            shot=shot,
            city_stats=city,
            rank_info=rank_info,
        )

        try:
            provider = get_provider(LLM_PROVIDER)
            response = await provider.generate(
                system_prompt, user_prompt, max_tokens=100, temperature=0.4,
            )
            narration = response.content.strip()
        except Exception:
            traceback.print_exc()
            narration = _fallback_narration(shot)

        # Cache narration
        cache_set(cache_key, json.dumps({"narration": narration}))

        shot_with_narration = {**shot, "narration": narration}
        shot_with_narration.pop("data_context", None)
        results.append(shot_with_narration)

    return results


def _fallback_narration(shot: dict) -> str:
    """Generate a static fallback narration when LLM is unavailable."""
    ctx = shot.get("data_context", {})
    theme = shot["theme"]
    name = shot["street_name"]

    if theme == "City Overview":
        return (
            f"Ho Chi Minh City, a metropolis of {ctx.get('total_districts', 24)} districts "
            f"and {ctx.get('total_streets', 16243):,} surveyed streets, "
            f"scores an average walkability of {ctx.get('avg_walkability', 5.0):.1f} out of 10."
        )
    if theme == "Call to Action":
        return (
            f"Across {ctx.get('total_streets', 16243):,} streets, every corner tells a story. "
            "Click any street to begin your own exploration."
        )
    if name:
        walk = ctx.get("walkability", 0)
        return f"{name} scores {walk:.1f} for walkability across safety, accessibility, and comfort."
    return "Exploring the walkability landscape of Ho Chi Minh City."
