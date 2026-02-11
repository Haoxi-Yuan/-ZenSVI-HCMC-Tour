"""Street endpoints."""

from fastapi import APIRouter, HTTPException, Query

from backend.data_store import streets_summary, get_streets_full

router = APIRouter(prefix="/api", tags=["streets"])

FEATURED_STREETS = [
    {
        "name": "Trần Quốc Thảo",
        "tag": "All dimensions rising",
        "description": "All 4 walkability dimensions rise from low to high across 25 segments",
        "gradient": "ascending",
    },
    {
        "name": "Đường Nguyễn Văn Quỳ",
        "tag": "All dimensions falling",
        "description": "Walkability descends from moderate to very low across 28 segments (67 pts)",
        "gradient": "descending",
    },
    {
        "name": "Đường D5 #1",
        "tag": "Dramatic improvement",
        "description": "Dramatic rise from unwalkable to highly walkable across 17 segments",
        "gradient": "ascending",
    },
    {
        "name": "Bùi Minh Trực",
        "tag": "Accessibility drop",
        "description": "Accessibility score drops dramatically from 6.7 to 1.7 along 32 segments",
        "gradient": "descending",
    },
    {
        "name": "Hai Bà Trưng",
        "tag": "Comfort decline",
        "description": "Comfort deteriorates from 6.5 to 4.1 along this iconic street (58 pts)",
        "gradient": "descending",
    },
]


@router.get("/streets/featured")
async def get_featured_streets():
    """Return curated list of streets with notable walkability gradients."""
    result = []
    for entry in FEATURED_STREETS:
        summary = streets_summary.get(entry["name"])
        if summary:
            result.append({
                **entry,
                "segments": summary.get("segments", 0),
                "points": summary.get("points", 0),
                "walkability": summary.get("walkability", 0),
                "safety": summary.get("safety", 0),
                "accessibility": summary.get("accessibility", 0),
                "comfort": summary.get("comfort", 0),
            })
    return {"featured": result}


@router.get("/streets")
async def list_streets(
    sort: str = Query("walkability", description="Sort field"),
    order: str = Query("desc", description="asc or desc"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    min_points: int = Query(0, ge=0, description="Minimum number of sampling points"),
):
    """List all streets with summary scores."""
    items = [
        {"name": name, **data}
        for name, data in streets_summary.items()
        if data.get("points", 0) >= min_points
    ]

    reverse = order == "desc"
    if sort in ("walkability", "safety", "accessibility", "comfort", "points", "segments"):
        items.sort(key=lambda x: x.get(sort, 0), reverse=reverse)

    total = len(items)
    items = items[offset:offset + limit]
    return {"total": total, "streets": items}


@router.get("/streets/search")
async def search_streets(q: str = Query(..., min_length=1)):
    """Autocomplete street name search."""
    query = q.lower()
    results = []
    for name, data in streets_summary.items():
        if query in name.lower():
            results.append({"name": name, **data})
            if len(results) >= 20:
                break
    results.sort(key=lambda x: x.get("walkability", 0), reverse=True)
    return {"results": results}


@router.get("/streets/{street_name}")
async def get_street(street_name: str):
    """Get full street data including all segments and point references."""
    full = get_streets_full()
    if street_name not in full:
        raise HTTPException(404, f"Street '{street_name}' not found")
    return full[street_name]
