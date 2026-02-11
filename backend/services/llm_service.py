"""LLM orchestrator: gathers analytics data, calls provider, manages cache."""

import hashlib
import json
import traceback

from backend.config import LLM_PROVIDER, LLM_MODEL
from backend.services.llm_providers import get_provider
from backend.services.cache_service import cache_get, cache_set
from backend.services.prompts import build_insight_prompt, PROMPT_VERSION
from backend.services.analytics import get_street_rank, get_similar_streets, get_street_drivers
from backend.services.scene_evidence import get_scene_evidence


def _build_structured_input(
    street_name: str,
    rank_info: dict,
    similar: list,
    drivers: dict,
    scene_evidence: list | None = None,
) -> dict:
    dims = rank_info.get("dimensions", {})
    total = rank_info.get("total_streets", 0)

    core_dims = ("safety", "accessibility", "comfort")
    available_core = [(d, dims[d]) for d in core_dims if d in dims]

    overall = dims.get("walkability", {"score": 0, "rank": 0, "percentile": 0, "label": "unknown"})
    overall_judgement = {
        "score": overall.get("score", 0),
        "rank": overall.get("rank", 0),
        "percentile": overall.get("percentile", 0),
        "label": overall.get("label", "unknown"),
        "total_streets": total,
    }

    best_dim, best_dim_data = (available_core[0] if available_core else ("walkability", overall))
    worst_dim, worst_dim_data = (available_core[0] if available_core else ("walkability", overall))
    if available_core:
        best_dim, best_dim_data = max(available_core, key=lambda x: x[1].get("score", 0))
        worst_dim, worst_dim_data = min(available_core, key=lambda x: x[1].get("score", 0))

    best_driver = {}
    best_driver_candidates = drivers.get(best_dim, {}).get("drivers", [])
    if best_driver_candidates:
        best_driver = max(best_driver_candidates, key=lambda d: d.get("value", 0))

    bottleneck_driver = {}
    bottleneck_candidates = drivers.get(worst_dim, {}).get("drivers", [])
    if bottleneck_candidates:
        bottleneck_driver = min(bottleneck_candidates, key=lambda d: d.get("value", 0))

    top_strength = {
        "dimension": best_dim,
        "score": best_dim_data.get("score", 0),
        "percentile": best_dim_data.get("percentile", 0),
        "driver": {
            "key": best_driver.get("key"),
            "label": best_driver.get("label"),
            "value": best_driver.get("value"),
            "description": best_driver.get("description"),
        },
    }

    main_bottleneck = {
        "dimension": worst_dim,
        "score": worst_dim_data.get("score", 0),
        "percentile": worst_dim_data.get("percentile", 0),
        "driver": {
            "key": bottleneck_driver.get("key"),
            "label": bottleneck_driver.get("label"),
            "value": bottleneck_driver.get("value"),
            "description": bottleneck_driver.get("description"),
        },
    }

    city_gap = {
        "vs_median_percentile_gap": {
            dim: round(dims[dim].get("percentile", 0) - 50, 1)
            for dim in ("walkability", "safety", "accessibility", "comfort")
            if dim in dims
        },
        "dimension_snapshot": {
            dim: {
                "score": dims[dim].get("score", 0),
                "rank": dims[dim].get("rank", 0),
                "percentile": dims[dim].get("percentile", 0),
                "label": dims[dim].get("label", "unknown"),
            }
            for dim in ("walkability", "safety", "accessibility", "comfort")
            if dim in dims
        },
    }

    similar_compact = []
    for s in similar[:3]:
        similar_compact.append({
            "name": s.get("name"),
            "distance": s.get("distance"),
            "deltas": s.get("deltas", {}),
        })

    # Strip thumbnail URLs from evidence for LLM (it doesn't need image paths)
    llm_evidence = []
    for ev in (scene_evidence or []):
        llm_evidence.append({
            "id": ev["id"],
            "label": ev["label"],
            "segmentation_top": ev["segmentation_top"],
            "detection": ev["detection"],
            "perception": ev["perception"],
            "visual_tags": ev["visual_tags"],
            "description": ev["description"],
        })

    result = {
        "street": street_name,
        "overall_judgement": overall_judgement,
        "top_strength": top_strength,
        "main_bottleneck": main_bottleneck,
        "city_gap": city_gap,
        "similar_streets": similar_compact,
        "drivers_by_dimension": drivers,
    }
    if llm_evidence:
        result["scene_evidence"] = llm_evidence
    return result


async def generate_street_insight(street_name: str, refresh: bool = False) -> dict:
    """Generate LLM insight for a street. Uses cache if available.

    Returns:
        {
            "street": str,
            "insight": str,
            "model": str,
            "cached": bool,
        }
    """
    # 1. Gather analytics data
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

    scene_evidence = get_scene_evidence(street_name)

    structured_input = _build_structured_input(
        street_name=street_name,
        rank_info=rank_info,
        similar=similar,
        drivers=drivers,
        scene_evidence=scene_evidence,
    )

    # 2. Build prompt
    system_prompt, user_prompt = build_insight_prompt(
        street_name=street_name,
        analysis_payload=structured_input,
    )

    prompt_hash = hashlib.sha256(f"{system_prompt}\n{user_prompt}".encode("utf-8")).hexdigest()[:16]
    cache_key = f"insight:{street_name}:{PROMPT_VERSION}:{LLM_MODEL}:{prompt_hash}"

    # 3. Check cache (unless refresh requested)
    if not refresh:
        cached = cache_get(cache_key)
        if cached:
            return {**json.loads(cached), "cached": True, "scene_evidence": scene_evidence}

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

    return {**result, "cached": False, "scene_evidence": scene_evidence}
