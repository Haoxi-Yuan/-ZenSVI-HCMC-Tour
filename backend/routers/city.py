"""City-wide statistics endpoints."""

from fastapi import APIRouter, HTTPException

from backend.data_store import city_stats

router = APIRouter(prefix="/api", tags=["city"])


@router.get("/city/stats")
async def get_city_stats():
    """City-wide statistics for landing page."""
    return {
        "total_districts": city_stats.get("total_districts"),
        "total_sampling_points": city_stats.get("total_sampling_points"),
        "total_images": city_stats.get("total_images"),
        "total_streets": city_stats.get("total_streets"),
        "walkability": city_stats.get("walkability", {}).get("stats"),
        "safety": city_stats.get("safety", {}).get("stats"),
        "accessibility": city_stats.get("accessibility", {}).get("stats"),
        "comfort": city_stats.get("comfort", {}).get("stats"),
    }


@router.get("/city/distribution/{dimension}")
async def get_distribution(dimension: str):
    """Get distribution of scores for scatter plots."""
    if dimension not in ("walkability", "safety", "accessibility", "comfort"):
        raise HTTPException(400, f"Invalid dimension: {dimension}")
    dist = city_stats.get(dimension, {}).get("distribution", [])
    return {"dimension": dimension, "data": dist}
