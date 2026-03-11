"""
preprocess_volunteers.py — Parse volunteer fieldwork GeoJSON and match to sampling points

Reads volunteer data from /data2/shared/haoxi/projects/ATTENTION/fieldwork/data/
  - 10 session folders, each with a GeoJSON + photos
  - GeoJSON contains Point features (photos with GPS + optional notes)
    and LineString features (walking trajectories)

For each volunteer photo point, finds the nearest HCMC_Tour sampling point
within 100m using a KD-tree.

Output to data/sphere/:
  - volunteers.json       matched photo points + notes + trajectory info
  - volunteers/images/    copied volunteer photos for backend serving
"""

import json
import math
import shutil
import time
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

VOLUNTEER_DIR = Path("/data2/shared/haoxi/projects/ATTENTION/fieldwork/data")
SPHERE_DIR = Path("/data2/shared/haoxi/projects/ZenSVI/HCMC_Tour/data/sphere")
VOL_IMG_DIR = SPHERE_DIR / "volunteers" / "images"

# Earth radius in meters for haversine
EARTH_R = 6371000

MAX_MATCH_DISTANCE_M = 100


def haversine_m(lat1, lon1, lat2, lon2):
    """Haversine distance in meters between two (lat, lon) points."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return EARTH_R * 2 * math.asin(math.sqrt(a))


def load_sampling_points():
    """Load all sampling points and build a KD-tree for spatial matching."""
    with open(SPHERE_DIR / "point_metadata.json") as f:
        metadata = json.load(f)

    coords = np.array([[p["lat"], p["lon"]] for p in metadata])

    # KD-tree on (lat, lon) — approximate but fine for <100m matching at HCMC latitude
    tree = cKDTree(coords)
    return metadata, tree, coords


def parse_geojson(filepath):
    """Parse a GeoJSON file. Returns (photo_points, trajectories)."""
    with open(filepath) as f:
        data = json.load(f)

    photos = []
    trajectories = []

    for feature in data.get("features", []):
        geom = feature.get("geometry", {})
        props = feature.get("properties", {})

        if geom.get("type") == "Point":
            lon, lat = geom["coordinates"][:2]
            photos.append({
                "lat": lat,
                "lon": lon,
                "image": props.get("image", ""),
                "timestamp": props.get("timestamp", ""),
                "note": props.get("note", ""),
            })
        elif geom.get("type") == "LineString":
            trajectories.append({
                "name": props.get("name", ""),
                "coordinates": geom["coordinates"],
            })

    return photos, trajectories


def main():
    start = time.time()
    print("=" * 60)
    print("PerceptionSphere Volunteer Data Processing")
    print("=" * 60)

    # Load sampling points
    print("\nLoading sampling points for spatial matching...")
    metadata, tree, coords = load_sampling_points()
    N = len(metadata)
    print(f"  Sampling points: {N}")

    # Create output dir
    VOL_IMG_DIR.mkdir(parents=True, exist_ok=True)

    # Find all volunteer session folders
    session_dirs = sorted([d for d in VOLUNTEER_DIR.iterdir() if d.is_dir()])
    print(f"\nFound {len(session_dirs)} volunteer session folders")

    all_matches = []
    all_trajectories = []
    total_photos = 0
    total_matched = 0
    total_with_notes = 0

    for session_dir in session_dirs:
        session_name = session_dir.name
        # Infer volunteer name from folder name (prefix before first _site or _point)
        parts = session_name.split("_")
        volunteer = parts[0]

        # Find GeoJSON files in this session
        geojson_files = list(session_dir.glob("*.geojson"))
        if not geojson_files:
            print(f"  {session_name}: no GeoJSON found, skipping")
            continue

        for gj_file in geojson_files:
            photos, trajectories = parse_geojson(gj_file)
            total_photos += len(photos)

            print(f"  {session_name}/{gj_file.name}: {len(photos)} photos, "
                  f"{len(trajectories)} trajectories")

            # Match each photo to nearest sampling point
            for photo in photos:
                # Query KD-tree (approximate: uses Euclidean on lat/lon, fine for <100m)
                query = np.array([photo["lat"], photo["lon"]])
                dist_deg, nearest_idx = tree.query(query)

                # Compute actual haversine distance
                matched = metadata[nearest_idx]
                dist_m = haversine_m(
                    photo["lat"], photo["lon"],
                    matched["lat"], matched["lon"]
                )

                if dist_m > MAX_MATCH_DISTANCE_M:
                    continue

                total_matched += 1
                if photo.get("note"):
                    total_with_notes += 1

                # Copy volunteer image if it exists
                img_rel = photo.get("image", "")
                img_src = session_dir / img_rel
                img_dest_name = ""
                if img_src.exists() and img_src.is_file():
                    img_dest_name = f"{session_name}_{img_src.name}"
                    img_dest = VOL_IMG_DIR / img_dest_name
                    if not img_dest.exists():
                        shutil.copy2(img_src, img_dest)

                all_matches.append({
                    "volunteer": volunteer,
                    "session": session_name,
                    "volunteer_lat": photo["lat"],
                    "volunteer_lon": photo["lon"],
                    "timestamp": photo["timestamp"],
                    "note": photo.get("note", ""),
                    "volunteer_image": img_dest_name,
                    "matched_point_idx": nearest_idx,
                    "matched_point_id": matched["id"],
                    "match_distance_m": round(dist_m, 1),
                })

            # Store trajectories
            for traj in trajectories:
                all_trajectories.append({
                    "volunteer": volunteer,
                    "session": session_name,
                    "name": traj["name"],
                    "coordinates": traj["coordinates"],
                })

    # Save
    output = {
        "total_photos": total_photos,
        "total_matched": total_matched,
        "total_with_notes": total_with_notes,
        "max_match_distance_m": MAX_MATCH_DISTANCE_M,
        "volunteers": list(set(m["volunteer"] for m in all_matches)),
        "matches": all_matches,
        "trajectories": all_trajectories,
    }
    out_path = SPHERE_DIR / "volunteers.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    # Count copied images
    copied_images = len(list(VOL_IMG_DIR.glob("*.jpg")))

    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"Results:")
    print(f"  Total volunteer photos:  {total_photos}")
    print(f"  Matched to sampling pts: {total_matched} (within {MAX_MATCH_DISTANCE_M}m)")
    print(f"  With text notes:         {total_with_notes}")
    print(f"  Images copied:           {copied_images}")
    print(f"  Trajectories:            {len(all_trajectories)}")
    print(f"  Unique volunteers:       {len(output['volunteers'])}")
    print(f"\nSaved: {out_path.name} ({out_path.stat().st_size / 1e3:.1f} KB)")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()