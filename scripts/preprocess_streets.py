"""
Preprocess street-level data into a unified street index.

Reads:
- walkability_streets.csv (scores + street names)
- walkability_streets.gpkg (LineString geometries)
- Pre-processed points data (from preprocess_points.py)

Output:
- data/streets.json — full street index: name -> segments -> points
- data/streets_summary.json — lightweight: name -> summary scores (for search/list)
- data/streets_geojson.json — GeoJSON FeatureCollection for map rendering
- data/city_stats.json — city-wide statistics for landing page + scatter plots
"""

import csv
import json
import math
import sqlite3
import struct
import sys
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path("/data2/shared/haoxi/projects/ZenSVI")
OUTPUT_DIR = PROJECT_ROOT / "HCMC_Tour" / "data"
POINTS_DIR = OUTPUT_DIR / "points"
STREETS_CSV = PROJECT_ROOT / "output" / "walkability_results" / "walkability_streets.csv"
STREETS_GPKG = PROJECT_ROOT / "output" / "walkability_results" / "walkability_streets.gpkg"

SCORE_COLS = [
    "safety_score", "accessibility_score", "comfort_score", "walkability_score",
    "S_perc", "S_expo", "S_ctrl", "A_side", "A_encr",
    "C_gvi", "C_vis", "C_svf", "C_thermal", "C_shade",
]
PERCEPTION_COLS_CSV = ["safer", "more_beautiful", "more_boring", "more_depressing"]
DETECTION_COLS = ["car_y", "motorbike", "person_y", "tree"]
ENV_COLS = ["lst_dry", "lst_rainy", "lst_avg", "avg_building_height"]


def parse_gpkg_linestring(blob):
    """Parse GeoPackage geometry blob (Standard GeoPackage Binary) to coordinate list."""
    if blob is None or len(blob) < 8:
        return None
    # GeoPackage binary header
    magic = blob[0:2]
    if magic != b"GP":
        return None
    flags = blob[3]
    envelope_type = (flags >> 1) & 0x07
    byte_order = blob[2]

    # Envelope sizes: 0=none, 1=xy(32), 2=xyz(48), 3=xym(48), 4=xyzm(64)
    envelope_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    env_size = envelope_sizes.get(envelope_type, 0)
    header_size = 8 + env_size

    wkb = blob[header_size:]
    if len(wkb) < 9:
        return None

    # Parse WKB LineString
    wkb_order = "<" if wkb[0] == 1 else ">"
    geom_type = struct.unpack(wkb_order + "I", wkb[1:5])[0]
    if geom_type != 2:  # Not a LineString
        return None
    num_points = struct.unpack(wkb_order + "I", wkb[5:9])[0]
    coords = []
    offset = 9
    for _ in range(num_points):
        if offset + 16 > len(wkb):
            break
        x, y = struct.unpack(wkb_order + "dd", wkb[offset:offset + 16])
        coords.append([round(x, 6), round(y, 6)])
        offset += 16
    return coords


# ============ GEOMETRY DISTANCE HELPERS ============

def haversine_dist(lat1, lon1, lat2, lon2):
    """Approximate distance in meters between two lat/lon points."""
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def point_to_segment_dist(plat, plon, alat, alon, blat, blon):
    """Distance from point P to line segment AB in meters (flat-earth approx)."""
    cos_lat = math.cos(math.radians(plat))
    M = 111320  # meters per degree
    px = (plon - alon) * cos_lat * M
    py = (plat - alat) * M
    bx = (blon - alon) * cos_lat * M
    by = (blat - alat) * M

    len_sq = bx * bx + by * by
    if len_sq == 0:
        return math.sqrt(px * px + py * py)

    t = max(0.0, min(1.0, (px * bx + py * by) / len_sq))
    proj_x = t * bx
    proj_y = t * by
    return math.sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)


def point_to_line_dist(plat, plon, coords):
    """Min distance from point to polyline. coords = [[lon, lat], ...]."""
    min_d = float('inf')
    for i in range(len(coords) - 1):
        d = point_to_segment_dist(
            plat, plon,
            coords[i][1], coords[i][0],
            coords[i + 1][1], coords[i + 1][0],
        )
        if d < min_d:
            min_d = d
    return min_d


# ============ SPATIAL CLUSTERING ============

def cluster_by_proximity(segments, max_dist=500):
    """Split segments into spatially connected clusters using Union-Find.
    Two segments are in the same cluster if their centroids are within max_dist meters."""
    n = len(segments)
    if n <= 1:
        return [segments]

    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(n):
        for j in range(i + 1, n):
            d = haversine_dist(
                segments[i]["lat"], segments[i]["lon"],
                segments[j]["lat"], segments[j]["lon"],
            )
            if d < max_dist:
                union(i, j)

    groups = defaultdict(list)
    for i in range(n):
        groups[find(i)].append(segments[i])

    # Sort clusters by size (largest first) for stable numbering
    return sorted(groups.values(), key=len, reverse=True)


# ============ DATA LOADING ============

def load_street_geometries():
    """Load street geometries from GeoPackage."""
    print("Loading street geometries from GeoPackage...")
    conn = sqlite3.connect(str(STREETS_GPKG))
    cur = conn.cursor()
    cur.execute("SELECT street_id, geom, name FROM walkability_streets")

    geom_map = {}
    for row in cur.fetchall():
        street_id = row[0]
        geom_blob = row[1]
        name = row[2] or ""
        coords = parse_gpkg_linestring(geom_blob)
        if coords and len(coords) >= 2:
            geom_map[street_id] = {"coords": coords, "name": name.strip()}
    conn.close()
    print(f"  Loaded {len(geom_map)} geometries")
    return geom_map


def load_gpkg_geometries_with_centroids():
    """Load named segments from GeoPackage with geometry and centroid."""
    print("Loading geometries from GeoPackage...")
    conn = sqlite3.connect(str(STREETS_GPKG))
    cur = conn.cursor()
    cur.execute("""
        SELECT street_id, geom, name
        FROM walkability_streets
        WHERE name IS NOT NULL AND name != ''
    """)

    segments = []
    for row in cur.fetchall():
        street_id = row[0]
        geom_blob = row[1]
        name = (row[2] or "").strip()
        if not name:
            continue
        coords = parse_gpkg_linestring(geom_blob)
        if not coords or len(coords) < 2:
            continue
        clat = sum(c[1] for c in coords) / len(coords)
        clon = sum(c[0] for c in coords) / len(coords)
        segments.append({
            "street_id": street_id,
            "name": name,
            "geometry": coords,
            "lat": clat,
            "lon": clon,
        })
    conn.close()
    print(f"  Loaded {len(segments)} named segments with geometry")
    return segments


def load_streets_csv():
    """Load walkability street data from CSV."""
    print("Loading street walkability data...")
    streets = {}
    with open(STREETS_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            sid = row["street_id"]
            name = row.get("name", "").strip()
            if not name:
                continue  # Skip unnamed streets

            try:
                lat = float(row["lat"])
                lon = float(row["lon"])
                point_count = int(float(row["point_count"]))
            except (ValueError, TypeError):
                continue

            scores = {}
            for col in SCORE_COLS + PERCEPTION_COLS_CSV + DETECTION_COLS + ENV_COLS:
                try:
                    scores[col] = round(float(row.get(col, 0) or 0), 4)
                except (ValueError, TypeError):
                    scores[col] = 0.0

            # Segmentation data
            seg_cols = [
                "road", "sidewalk", "building", "fence", "pole", "traffic sign",
                "vegetation", "sky", "person_x", "rider", "car_x", "truck",
                "bicycle", "wall", "terrain", "bus", "motorcycle", "train", "traffic light"
            ]
            segmentation = {}
            for col in seg_cols:
                try:
                    segmentation[col] = round(float(row.get(col, 0) or 0), 6)
                except (ValueError, TypeError):
                    segmentation[col] = 0.0

            streets[sid] = {
                "name": name,
                "lat": lat,
                "lon": lon,
                "point_count": point_count,
                "scores": scores,
                "segmentation": segmentation,
            }
    print(f"  Loaded {len(streets)} named street segments")
    return streets


def load_points_index():
    """Load the pre-processed points index for matching points to streets."""
    index_path = POINTS_DIR / "points_index.json"
    if not index_path.exists():
        print("  WARNING: points_index.json not found. Run preprocess_points.py first.")
        return []
    with open(index_path) as f:
        return json.load(f)


# ============ MATCHING ============

def match_points_to_segments(streets, geom_map, points_index, max_dist=80):
    """Match sampling points to their nearest street segment using line geometry."""
    print("Matching points to street segments...")

    # Build spatial index using line vertices (not just centroids)
    grid = defaultdict(set)
    grid_size = 0.001  # ~111m

    for seg_id, seg in streets.items():
        coords = geom_map.get(seg_id, {}).get("coords")
        if coords:
            for c in coords:
                gx = int(c[0] / grid_size)
                gy = int(c[1] / grid_size)
                for dx in range(-1, 2):
                    for dy in range(-1, 2):
                        grid[(gx + dx, gy + dy)].add(seg_id)
        else:
            gx = int(seg["lon"] / grid_size)
            gy = int(seg["lat"] / grid_size)
            for dx in range(-1, 2):
                for dy in range(-1, 2):
                    grid[(gx + dx, gy + dy)].add(seg_id)

    segment_points = defaultdict(list)
    matched = 0
    for point in points_index:
        gx = int(point["lon"] / grid_size)
        gy = int(point["lat"] / grid_size)
        candidates = grid.get((gx, gy), set())

        best_dist = max_dist
        best_seg = None
        for seg_id in candidates:
            coords = geom_map.get(seg_id, {}).get("coords")
            if coords:
                d = point_to_line_dist(point["lat"], point["lon"], coords)
            else:
                seg = streets[seg_id]
                d = haversine_dist(point["lat"], point["lon"], seg["lat"], seg["lon"])
            if d < best_dist:
                best_dist = d
                best_seg = seg_id

        if best_seg:
            segment_points[best_seg].append(point["id"])
            matched += 1

    print(f"  Matched {matched}/{len(points_index)} points to segments")
    return segment_points


def order_segments_along_street(segments_with_geom):
    """Order segments along a street by geographic proximity (greedy nearest neighbor)."""
    if len(segments_with_geom) <= 1:
        return segments_with_geom

    remaining = list(segments_with_geom)
    ordered = [remaining.pop(0)]

    while remaining:
        last = ordered[-1]
        last_lat, last_lon = last["lat"], last["lon"]

        best_idx = 0
        best_dist = float("inf")
        for i, seg in enumerate(remaining):
            d = haversine_dist(last_lat, last_lon, seg["lat"], seg["lon"])
            if d < best_dist:
                best_dist = d
                best_idx = i
        ordered.append(remaining.pop(best_idx))

    return ordered


def build_geojson_with_scores(gpkg_segments, csv_streets, seg_id_to_cluster):
    """Match GPKG geometries to CSV scores by name + nearest lat/lon.
    Uses seg_id_to_cluster to assign cluster names to GeoJSON features."""
    print("Matching GPKG geometries to CSV scores...")

    # Index CSV segments by original name for fast lookup
    csv_by_name = defaultdict(list)
    for sid, sdata in csv_streets.items():
        csv_by_name[sdata["name"]].append((sid, sdata))

    features = []
    matched = 0
    unmatched = 0

    for seg in gpkg_segments:
        name = seg["name"]
        candidates = csv_by_name.get(name, [])

        if not candidates:
            unmatched += 1
            continue

        # Find nearest CSV segment by lat/lon
        best_sid = None
        best_data = None
        best_dist = float("inf")
        for sid, sdata in candidates:
            d = (seg["lat"] - sdata["lat"]) ** 2 + (seg["lon"] - sdata["lon"]) ** 2
            if d < best_dist:
                best_dist = d
                best_sid = sid
                best_data = sdata

        if best_data and best_data["scores"].get("walkability_score", 0) > 0:
            # Use cluster name if available, otherwise original name
            display_name = seg_id_to_cluster.get(best_sid, name)
            features.append({
                "type": "Feature",
                "properties": {
                    "name": display_name,
                    "street_id": seg["street_id"],
                    "walkability": round(best_data["scores"].get("walkability_score", 0), 2),
                    "safety": round(best_data["scores"].get("safety_score", 0), 2),
                    "accessibility": round(best_data["scores"].get("accessibility_score", 0), 2),
                    "comfort": round(best_data["scores"].get("comfort_score", 0), 2),
                    "point_count": best_data["point_count"],
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": seg["geometry"],
                },
            })
            matched += 1
        else:
            unmatched += 1

    print(f"  Matched: {matched}, Unmatched: {unmatched}")
    return {"type": "FeatureCollection", "features": features}


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load data
    streets_csv = load_streets_csv()
    geom_map = load_street_geometries()
    points_index = load_points_index()

    # Match points to segments (improved: uses line geometry distance)
    segment_points = match_points_to_segments(streets_csv, geom_map, points_index)

    # Group segments by street name
    print("Grouping segments by street name...")
    name_groups = defaultdict(list)
    for seg_id, seg_data in streets_csv.items():
        geom = geom_map.get(seg_id, {}).get("coords")
        seg_obj = {
            "id": seg_id,
            "lat": seg_data["lat"],
            "lon": seg_data["lon"],
            "point_count": seg_data["point_count"],
            "geometry": geom,
            "points": segment_points.get(seg_id, []),
            "scores": seg_data["scores"],
            "segmentation": seg_data["segmentation"],
        }
        name_groups[seg_data["name"]].append(seg_obj)

    print(f"  {len(name_groups)} unique street names")

    # Spatial clustering: split same-name streets in different areas
    print("Spatial clustering (500m threshold)...")
    streets_index = {}
    seg_id_to_cluster = {}  # CSV seg_id -> cluster street name
    split_count = 0

    for name, segments in name_groups.items():
        clusters = cluster_by_proximity(segments, max_dist=500)

        if len(clusters) == 1:
            # Single cluster — keep original name
            street_key = name
            ordered = order_segments_along_street(clusters[0])
            streets_index[street_key] = _build_street_entry(ordered)
            for seg in ordered:
                seg_id_to_cluster[seg["id"]] = street_key
        else:
            # Multiple clusters — append number suffix
            split_count += 1
            for ci, cluster in enumerate(clusters, 1):
                street_key = f"{name} #{ci}"
                ordered = order_segments_along_street(cluster)
                streets_index[street_key] = _build_street_entry(ordered)
                for seg in ordered:
                    seg_id_to_cluster[seg["id"]] = street_key

    print(f"  {split_count} street names split into multiple clusters")
    print(f"  {len(streets_index)} total streets after clustering")

    # Save full street index
    streets_path = OUTPUT_DIR / "streets.json"
    with open(streets_path, "w") as f:
        json.dump(streets_index, f, separators=(",", ":"))
    size_mb = streets_path.stat().st_size / 1024 / 1024
    print(f"Saved streets.json ({size_mb:.1f} MB)")

    # Save lightweight summary (for search + listing)
    summary = {}
    for name, data in streets_index.items():
        summary[name] = {
            "segments": data["segment_count"],
            "points": data["total_points"],
            "lat": data["center_lat"],
            "lon": data["center_lon"],
            "walkability": data["avg_scores"].get("walkability_score", 0),
            "safety": data["avg_scores"].get("safety_score", 0),
            "accessibility": data["avg_scores"].get("accessibility_score", 0),
            "comfort": data["avg_scores"].get("comfort_score", 0),
        }
    summary_path = OUTPUT_DIR / "streets_summary.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, separators=(",", ":"))
    print(f"Saved streets_summary.json ({summary_path.stat().st_size / 1024:.0f} KB)")

    # Build GeoJSON for map rendering — uses cluster names
    print("Building GeoJSON for map...")
    gpkg_segments = load_gpkg_geometries_with_centroids()
    geojson = build_geojson_with_scores(gpkg_segments, streets_csv, seg_id_to_cluster)
    geojson_path = OUTPUT_DIR / "streets_geojson.json"
    with open(geojson_path, "w") as f:
        json.dump(geojson, f, separators=(",", ":"))
    size_mb = geojson_path.stat().st_size / 1024 / 1024
    print(f"Saved streets_geojson.json ({size_mb:.1f} MB, {len(geojson['features'])} features)")

    # Build city-wide statistics
    print("Computing city-wide statistics...")
    all_walkability = []
    all_safety = []
    all_accessibility = []
    all_comfort = []
    all_perception = defaultdict(list)

    for name, data in streets_index.items():
        ws = data["avg_scores"].get("walkability_score", 0)
        if ws > 0:
            all_walkability.append({"name": name, "value": ws})
            all_safety.append({"name": name, "value": data["avg_scores"].get("safety_score", 0)})
            all_accessibility.append({"name": name, "value": data["avg_scores"].get("accessibility_score", 0)})
            all_comfort.append({"name": name, "value": data["avg_scores"].get("comfort_score", 0)})

        # Perception averages from segment-level CSV data
        for dim in PERCEPTION_COLS_CSV:
            vals = [s["scores"].get(dim, 0) for s in data["segments"] if s["scores"].get(dim, 0) > 0]
            if vals:
                all_perception[dim].append({"name": name, "value": round(sum(vals) / len(vals), 4)})

    def stats(arr):
        vals = [x["value"] for x in arr]
        if not vals:
            return {"mean": 0, "min": 0, "max": 0, "count": 0}
        return {
            "mean": round(sum(vals) / len(vals), 4),
            "min": round(min(vals), 4),
            "max": round(max(vals), 4),
            "count": len(vals),
        }

    city_stats = {
        "total_districts": 24,
        "total_sampling_points": 267455,
        "total_images": 1070000,
        "total_streets": len(streets_index),
        "total_named_segments": len(streets_csv),
        "walkability": {"stats": stats(all_walkability), "distribution": all_walkability},
        "safety": {"stats": stats(all_safety), "distribution": all_safety},
        "accessibility": {"stats": stats(all_accessibility), "distribution": all_accessibility},
        "comfort": {"stats": stats(all_comfort), "distribution": all_comfort},
    }

    city_path = OUTPUT_DIR / "city_stats.json"
    with open(city_path, "w") as f:
        json.dump(city_stats, f, separators=(",", ":"))
    size_mb = city_path.stat().st_size / 1024 / 1024
    print(f"Saved city_stats.json ({size_mb:.1f} MB)")

    print("\nDone!")


def _build_street_entry(ordered_segments):
    """Build a street index entry from ordered segments."""
    n = len(ordered_segments)
    avg_scores = {}
    for key in SCORE_COLS:
        vals = [s["scores"].get(key, 0) for s in ordered_segments if s["scores"].get(key, 0) > 0]
        avg_scores[key] = round(sum(vals) / len(vals), 4) if vals else 0.0

    total_points = sum(s["point_count"] for s in ordered_segments)
    center_seg = ordered_segments[len(ordered_segments) // 2]

    return {
        "segment_count": n,
        "total_points": total_points,
        "center_lat": center_seg["lat"],
        "center_lon": center_seg["lon"],
        "avg_scores": avg_scores,
        "segments": ordered_segments,
    }


if __name__ == "__main__":
    main()
