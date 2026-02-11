"""Global data stores and loading logic."""

import json

from backend.config import DATA_DIR, LAYERS_DIR


streets_summary: dict = {}
streets_full: dict = {}
city_stats: dict = {}
points_by_district: dict = {}
layer_manifest: dict = {}

# Populated by analytics.compute_ranks() at startup
rank_data: dict = {}


def load_data():
    """Load all pre-processed data into memory at startup."""
    global streets_summary, city_stats, layer_manifest

    print("Loading pre-processed data...")

    with open(DATA_DIR / "streets_summary.json") as f:
        streets_summary.update(json.load(f))
    print(f"  Streets summary: {len(streets_summary)} streets")

    with open(DATA_DIR / "city_stats.json") as f:
        city_stats.update(json.load(f))
    print("  City stats loaded")

    manifest_path = LAYERS_DIR / "layer_manifest.json"
    if manifest_path.exists():
        with open(manifest_path) as f:
            layer_manifest.update(json.load(f))
    print(f"  Layer manifest: {len(layer_manifest.get('layers', []))} layers")

    print("Data loading complete.")


def get_streets_full() -> dict:
    """Lazy-load the 92MB streets.json on first access."""
    global streets_full
    if not streets_full:
        streets_path = DATA_DIR / "streets.json"
        if streets_path.exists():
            with open(streets_path) as f:
                streets_full.update(json.load(f))
    return streets_full


def load_district_points(district: str) -> list:
    """Load points for a district (cached in memory)."""
    if district not in points_by_district:
        path = DATA_DIR / "points" / f"{district}.json"
        if not path.exists():
            return []
        with open(path) as f:
            points_by_district[district] = json.load(f)
    return points_by_district[district]
