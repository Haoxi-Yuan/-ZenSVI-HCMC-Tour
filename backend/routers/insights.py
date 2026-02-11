"""Insight endpoints: rank, similar streets, drivers, LLM insight."""

from fastapi import APIRouter, HTTPException, Query

from backend.data_store import streets_summary
from backend.services.analytics import get_street_rank, get_similar_streets, get_street_drivers
from backend.services.llm_service import generate_street_insight
from backend.services.story_service import get_story_shots, generate_story_narrations

router = APIRouter(prefix="/api/insights", tags=["insights"])


def _check_street(street_name: str):
    if street_name not in streets_summary:
        raise HTTPException(404, f"Street '{street_name}' not found")


@router.get("/rank/{street_name}")
async def street_rank(street_name: str):
    """Return rank and percentile for a street across all 4 dimensions."""
    _check_street(street_name)
    return get_street_rank(street_name)


@router.get("/similar/{street_name}")
async def similar_streets(
    street_name: str,
    dimension: str = Query("combined", pattern="^(walkability|safety|accessibility|comfort|combined)$"),
    top_k: int = Query(5, ge=1, le=10),
    w_safety: float = Query(1.0, ge=0, le=5),
    w_accessibility: float = Query(1.0, ge=0, le=5),
    w_comfort: float = Query(1.0, ge=0, le=5),
):
    """Find the most similar streets by a given dimension or combined profile."""
    _check_street(street_name)
    weights = {"safety": w_safety, "accessibility": w_accessibility, "comfort": w_comfort}
    return {
        "street": street_name,
        "dimension": dimension,
        "similar": get_similar_streets(street_name, dimension, top_k, weights),
    }


@router.get("/drivers/{street_name}")
async def street_drivers(street_name: str):
    """Return walkability driver breakdown from formula intermediate variables."""
    _check_street(street_name)
    result = get_street_drivers(street_name)
    if result is None:
        raise HTTPException(404, f"Driver data not available for '{street_name}'")
    return result


@router.get("/llm/{street_name}")
async def llm_insight(street_name: str, refresh: bool = Query(False)):
    """Generate an LLM-powered walkability insight for a street."""
    _check_street(street_name)
    return await generate_street_insight(street_name, refresh=refresh)


@router.get("/story/shots")
async def story_shots():
    """Return 7 pre-selected story shots with LLM narrations."""
    shots = get_story_shots()
    return {"shots": await generate_story_narrations(shots)}


@router.post("/story/warm-cache")
async def warm_story_cache():
    """Pre-generate all story narrations for caching."""
    shots = get_story_shots()
    results = await generate_story_narrations(shots)
    return {"cached": len(results), "shots": [s["id"] for s in results]}
