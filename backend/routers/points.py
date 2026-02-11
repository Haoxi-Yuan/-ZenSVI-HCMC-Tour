"""Point endpoints."""

import json

from fastapi import APIRouter, HTTPException

from backend.config import DATA_DIR
from backend.data_store import get_streets_full, load_district_points

router = APIRouter(prefix="/api", tags=["points"])

_points_index: dict | None = None


def _get_points_index() -> dict:
    global _points_index
    if _points_index is None:
        with open(DATA_DIR / "points" / "points_index.json") as f:
            _points_index = {p["id"]: p["district"] for p in json.load(f)}
    return _points_index


@router.get("/points/{point_id}")
async def get_point(point_id: str):
    """Get full data for a single sampling point."""
    index = _get_points_index()
    district = index.get(point_id)
    if not district:
        raise HTTPException(404, f"Point '{point_id}' not found")

    points = load_district_points(district)
    for p in points:
        if p["id"] == point_id:
            return p

    raise HTTPException(404, f"Point '{point_id}' not found in district data")


@router.get("/points/by-street/{street_name}")
async def get_points_by_street(street_name: str):
    """Get all points data for a street (for tour mode)."""
    full = get_streets_full()
    street = full.get(street_name)
    if not street:
        raise HTTPException(404, f"Street '{street_name}' not found")

    all_point_ids = []
    for seg in street["segments"]:
        all_point_ids.extend(seg.get("points", []))

    if not all_point_ids:
        return {"street": street_name, "points": []}

    index = _get_points_index()
    point_ids_set = set(all_point_ids)
    districts_needed = set()
    for pid in point_ids_set:
        d = index.get(pid)
        if d:
            districts_needed.add(d)

    points_data = []
    for district in districts_needed:
        district_points = load_district_points(district)
        for p in district_points:
            if p["id"] in point_ids_set:
                points_data.append(p)

    point_order = {pid: i for i, pid in enumerate(all_point_ids)}
    points_data.sort(key=lambda p: point_order.get(p["id"], 999999))

    return {"street": street_name, "points": points_data}
