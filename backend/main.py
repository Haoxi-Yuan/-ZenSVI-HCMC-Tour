"""
HCMC Street View Tour Platform — FastAPI Backend

Serves pre-processed data and street view images.
"""

import json
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

# Paths
PROJECT_ROOT = Path("/data2/shared/haoxi/projects/ZenSVI")
DATA_DIR = PROJECT_ROOT / "HCMC_Tour" / "data"
IMAGE_DIR = PROJECT_ROOT / "gsv_streetlevel_full"
LAYERS_DIR = DATA_DIR / "layers"
BACKEND_DIR = PROJECT_ROOT / "HCMC_Tour" / "backend"


def _load_env_file(env_path: Path) -> None:
    """Load KEY=VALUE pairs from a local .env file into process env."""
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if (
            (value.startswith('"') and value.endswith('"'))
            or (value.startswith("'") and value.endswith("'"))
        ):
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


_load_env_file(BACKEND_DIR / ".env")

app = FastAPI(title="HCMC Street View Tour", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ DATA LOADING (at startup) ============

_streets_summary: dict = {}
_streets_full: dict = {}
_city_stats: dict = {}
_points_by_district: dict = {}
_layer_manifest: dict = {}


def load_data():
    """Load all pre-processed data into memory at startup."""
    global _streets_summary, _streets_full, _city_stats, _layer_manifest

    print("Loading pre-processed data...")

    # Streets summary (2.4 MB — lightweight)
    with open(DATA_DIR / "streets_summary.json") as f:
        _streets_summary.update(json.load(f))
    print(f"  Streets summary: {len(_streets_summary)} streets")

    # City stats (3.5 MB)
    with open(DATA_DIR / "city_stats.json") as f:
        _city_stats.update(json.load(f))
    print(f"  City stats loaded")

    # Layer manifest
    manifest_path = LAYERS_DIR / "layer_manifest.json"
    if manifest_path.exists():
        with open(manifest_path) as f:
            _layer_manifest.update(json.load(f))
    print(f"  Layer manifest: {len(_layer_manifest.get('layers', []))} layers")

    # NOTE: streets_full (89 MB) is loaded on-demand per street to save memory
    # NOTE: points are loaded on-demand per district

    print("Data loading complete.")


@app.on_event("startup")
async def startup():
    load_data()


# ============ STREET ENDPOINTS ============

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


@app.get("/api/streets/featured")
async def get_featured_streets():
    """Return curated list of streets with notable walkability gradients."""
    result = []
    for entry in FEATURED_STREETS:
        summary = _streets_summary.get(entry["name"])
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


@app.get("/api/streets")
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
        for name, data in _streets_summary.items()
        if data.get("points", 0) >= min_points
    ]

    reverse = order == "desc"
    if sort in ("walkability", "safety", "accessibility", "comfort", "points", "segments"):
        items.sort(key=lambda x: x.get(sort, 0), reverse=reverse)

    total = len(items)
    items = items[offset:offset + limit]
    return {"total": total, "streets": items}


@app.get("/api/streets/search")
async def search_streets(q: str = Query(..., min_length=1)):
    """Autocomplete street name search."""
    query = q.lower()
    results = []
    for name, data in _streets_summary.items():
        if query in name.lower():
            results.append({"name": name, **data})
            if len(results) >= 20:
                break
    results.sort(key=lambda x: x.get("walkability", 0), reverse=True)
    return {"results": results}


@app.get("/api/streets/{street_name}")
async def get_street(street_name: str):
    """Get full street data including all segments and point references."""
    # Load from full streets.json on demand
    if not _streets_full:
        streets_path = DATA_DIR / "streets.json"
        if not streets_path.exists():
            raise HTTPException(404, "Streets data not found")
        with open(streets_path) as f:
            _streets_full.update(json.load(f))

    if street_name not in _streets_full:
        raise HTTPException(404, f"Street '{street_name}' not found")

    return _streets_full[street_name]


# ============ POINT ENDPOINTS ============

def _load_district_points(district: str) -> list:
    """Load points for a district (cached)."""
    if district not in _points_by_district:
        path = DATA_DIR / "points" / f"{district}.json"
        if not path.exists():
            return []
        with open(path) as f:
            _points_by_district[district] = json.load(f)
    return _points_by_district[district]


@app.get("/api/points/{point_id}")
async def get_point(point_id: str):
    """Get full data for a single sampling point."""
    # point_id format: lat10.792615_lon106.697350
    # Need to find which district it's in — check all loaded districts or use index
    # First try the points index
    index_path = DATA_DIR / "points" / "points_index.json"
    if not hasattr(get_point, "_index"):
        with open(index_path) as f:
            get_point._index = {p["id"]: p["district"] for p in json.load(f)}

    district = get_point._index.get(point_id)
    if not district:
        raise HTTPException(404, f"Point '{point_id}' not found")

    points = _load_district_points(district)
    for p in points:
        if p["id"] == point_id:
            return p

    raise HTTPException(404, f"Point '{point_id}' not found in district data")


@app.get("/api/points/by-street/{street_name}")
async def get_points_by_street(street_name: str):
    """Get all points data for a street (for tour mode)."""
    # Get the street's segment data first
    if not _streets_full:
        streets_path = DATA_DIR / "streets.json"
        with open(streets_path) as f:
            _streets_full.update(json.load(f))

    street = _streets_full.get(street_name)
    if not street:
        raise HTTPException(404, f"Street '{street_name}' not found")

    # Collect all point IDs from all segments
    all_point_ids = []
    for seg in street["segments"]:
        all_point_ids.extend(seg.get("points", []))

    if not all_point_ids:
        return {"street": street_name, "points": []}

    # Load point index to find districts
    if not hasattr(get_points_by_street, "_index"):
        index_path = DATA_DIR / "points" / "points_index.json"
        with open(index_path) as f:
            get_points_by_street._index = {p["id"]: p["district"] for p in json.load(f)}

    # Group by district and load
    point_ids_set = set(all_point_ids)
    districts_needed = set()
    for pid in point_ids_set:
        d = get_points_by_street._index.get(pid)
        if d:
            districts_needed.add(d)

    points_data = []
    for district in districts_needed:
        district_points = _load_district_points(district)
        for p in district_points:
            if p["id"] in point_ids_set:
                points_data.append(p)

    # Order points along the street (match segment order)
    point_order = {pid: i for i, pid in enumerate(all_point_ids)}
    points_data.sort(key=lambda p: point_order.get(p["id"], 999999))

    return {"street": street_name, "points": points_data}


# ============ IMAGE ENDPOINTS ============

# Map district folder names for lookup
DISTRICT_FOLDERS = {d.name: d for d in IMAGE_DIR.iterdir() if d.is_dir()} if IMAGE_DIR.exists() else {}


@app.get("/api/images/{district}/{point_folder}/{image_name}")
async def get_image(district: str, point_folder: str, image_name: str):
    """Serve a street view image."""
    image_path = IMAGE_DIR / district / point_folder / image_name
    if not image_path.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(image_path, media_type="image/jpeg")


@app.get("/api/images/by-point/{point_id}")
async def get_images_by_point(point_id: str):
    """Get image URLs for a sampling point."""
    # Load point index
    if not hasattr(get_images_by_point, "_index"):
        index_path = DATA_DIR / "points" / "points_index.json"
        with open(index_path) as f:
            get_images_by_point._index = {p["id"]: p["district"] for p in json.load(f)}

    district = get_images_by_point._index.get(point_id)
    if not district:
        raise HTTPException(404, f"Point '{point_id}' not found")

    # Find the point folder
    district_path = IMAGE_DIR / district
    if not district_path.exists():
        raise HTTPException(404, "District not found")

    # Search for point folder matching the point_id
    # point_id is like "lat10.792615_lon106.697350"
    for point_dir in district_path.iterdir():
        if not point_dir.is_dir():
            continue
        if point_id in point_dir.name:
            images = sorted([
                f.name for f in point_dir.iterdir()
                if f.suffix == ".jpg" and f.name.startswith("lat")
            ])
            urls = [
                f"/api/images/{district}/{point_dir.name}/{img}"
                for img in images
            ]
            return {"point_id": point_id, "district": district, "images": urls}

    raise HTTPException(404, "Point folder not found")


# ============ LAYER ENDPOINTS ============

@app.get("/api/layers")
async def list_layers():
    """List all available map layers."""
    return _layer_manifest


@app.get("/api/layers/segmentation/{filename}")
async def get_segmentation_layer(filename: str):
    """Serve a segmentation hex map image."""
    path = LAYERS_DIR / "segmentation" / filename
    if not path.exists():
        raise HTTPException(404, "Layer not found")
    return FileResponse(path, media_type="image/png")


@app.get("/api/layers/streets-geojson")
async def get_streets_geojson():
    """Serve the streets GeoJSON for map rendering."""
    path = DATA_DIR / "streets_geojson.json"
    if not path.exists():
        raise HTTPException(404, "GeoJSON not found")
    return FileResponse(path, media_type="application/json")


@app.get("/api/layers/hex-grid")
async def get_hex_grid():
    """Serve the hex grid GeoJSON for thematic layers."""
    path = LAYERS_DIR / "hex_grid_slim.json"
    if not path.exists():
        raise HTTPException(404, "Hex grid not found")
    return FileResponse(path, media_type="application/json")


# ============ CITY STATS ============

@app.get("/api/city/stats")
async def get_city_stats():
    """City-wide statistics for landing page."""
    # Return summary without full distributions
    return {
        "total_districts": _city_stats.get("total_districts"),
        "total_sampling_points": _city_stats.get("total_sampling_points"),
        "total_images": _city_stats.get("total_images"),
        "total_streets": _city_stats.get("total_streets"),
        "walkability": _city_stats.get("walkability", {}).get("stats"),
        "safety": _city_stats.get("safety", {}).get("stats"),
        "accessibility": _city_stats.get("accessibility", {}).get("stats"),
        "comfort": _city_stats.get("comfort", {}).get("stats"),
    }


@app.get("/api/city/distribution/{dimension}")
async def get_distribution(dimension: str):
    """Get distribution of scores for scatter plots."""
    if dimension not in ("walkability", "safety", "accessibility", "comfort"):
        raise HTTPException(400, f"Invalid dimension: {dimension}")
    dist = _city_stats.get(dimension, {}).get("distribution", [])
    return {"dimension": dimension, "data": dist}
