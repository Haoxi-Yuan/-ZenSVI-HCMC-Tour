"""
preprocess_sphere_features.py — Extract feature vectors for PerceptionSphere

Reads all per-district point JSON files, extracts:
  - 23-dim feature vectors (19 segmentation ratios + 4 detection counts)
  - 6-dim perception scores
  - Point metadata (idx, id, lat, lon, district, folder)

Output to data/sphere/:
  - features.npy        float32 (N, 23)
  - perception_scores.npy  float32 (N, 6)
  - point_metadata.json    [{idx, id, lat, lon, district, district_name, folder}, ...]
"""

import json
import sys
import time
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path("/data2/shared/haoxi/projects/ZenSVI")
DATA_DIR = PROJECT_ROOT / "HCMC_Tour" / "data"
POINTS_DIR = DATA_DIR / "points"
SPHERE_DIR = DATA_DIR / "sphere"

# Canonical feature names — order matters, must be consistent across all scripts
SEGMENTATION_KEYS = [
    "road", "sidewalk", "building", "wall", "fence",
    "pole", "traffic sign", "vegetation", "terrain", "sky",
    "person", "rider", "car", "motorcycle", "bicycle",
    "bus", "traffic light", "truck", "train",
]
DETECTION_KEYS = ["motorbike", "tree", "car", "person"]

FEATURE_NAMES = [f"seg_{k.replace(' ', '_')}" for k in SEGMENTATION_KEYS] + \
                [f"det_{k}" for k in DETECTION_KEYS]

PERCEPTION_DIMS = [
    "safer", "livelier", "wealthier",
    "more_beautiful", "more_boring", "more_depressing",
]


def load_points_index():
    """Load the canonical point ordering from points_index.json."""
    index_path = POINTS_DIR / "points_index.json"
    with open(index_path) as f:
        index = json.load(f)
    # Build id -> idx mapping for fast lookup
    id_to_idx = {p["id"]: i for i, p in enumerate(index)}
    return index, id_to_idx


def load_district_points():
    """Load all points from all district JSON files."""
    all_points = {}
    district_files = sorted(POINTS_DIR.glob("*.json"))
    for fpath in district_files:
        if fpath.name == "points_index.json":
            continue
        print(f"  Loading {fpath.name}...", end=" ", flush=True)
        with open(fpath) as f:
            points = json.load(f)
        for p in points:
            all_points[p["id"]] = p
        print(f"{len(points)} points")
    return all_points


def extract_features(point):
    """Extract 23-dim feature vector from a point dict."""
    seg = point.get("segmentation", {})
    det = point.get("detection", {})

    features = []
    for key in SEGMENTATION_KEYS:
        features.append(float(seg.get(key, 0.0)))
    for key in DETECTION_KEYS:
        features.append(float(det.get(key, 0.0)))

    return features


def extract_perception(point):
    """Extract 6-dim perception score vector from a point dict."""
    perc = point.get("perception", {})
    return [float(perc.get(dim, 0.0)) for dim in PERCEPTION_DIMS]


def main():
    start = time.time()
    print("=" * 60)
    print("PerceptionSphere Feature Extraction")
    print("=" * 60)

    # Load canonical ordering
    print("\n[1/4] Loading points index...")
    index, id_to_idx = load_points_index()
    N = len(index)
    print(f"  Total points in index: {N}")

    # Load all district data
    print(f"\n[2/4] Loading district point data...")
    all_points = load_district_points()
    print(f"  Total points loaded from districts: {len(all_points)}")

    # Check coverage
    missing = [p["id"] for p in index if p["id"] not in all_points]
    if missing:
        print(f"  WARNING: {len(missing)} points in index have no district data")

    # Extract features and perception scores
    print(f"\n[3/4] Extracting feature vectors ({len(FEATURE_NAMES)} features)...")
    features = np.zeros((N, len(FEATURE_NAMES)), dtype=np.float32)
    perception_scores = np.zeros((N, len(PERCEPTION_DIMS)), dtype=np.float32)
    metadata = []

    missing_perception_count = 0
    for i, entry in enumerate(index):
        pid = entry["id"]
        point = all_points.get(pid)

        if point is None:
            # Point in index but not in district files — leave as zeros
            metadata.append({
                "idx": i,
                "id": pid,
                "lat": entry["lat"],
                "lon": entry["lon"],
                "district": entry.get("district", ""),
                "district_name": entry.get("district_name", ""),
                "folder": "",
            })
            continue

        features[i] = extract_features(point)
        perc = extract_perception(point)
        perception_scores[i] = perc

        # Track points with all-zero perception (likely missing data)
        if all(v == 0.0 for v in perc):
            missing_perception_count += 1

        metadata.append({
            "idx": i,
            "id": pid,
            "lat": point["lat"],
            "lon": point["lon"],
            "district": point.get("district", ""),
            "district_name": point.get("district_name", ""),
            "folder": point.get("folder", ""),
        })

    # Save
    print(f"\n[4/4] Saving outputs to {SPHERE_DIR}/...")
    SPHERE_DIR.mkdir(parents=True, exist_ok=True)

    features_path = SPHERE_DIR / "features.npy"
    np.save(features_path, features)
    print(f"  features.npy: shape={features.shape}, size={features_path.stat().st_size / 1e6:.1f} MB")

    perception_path = SPHERE_DIR / "perception_scores.npy"
    np.save(perception_path, perception_scores)
    print(f"  perception_scores.npy: shape={perception_scores.shape}, size={perception_path.stat().st_size / 1e6:.1f} MB")

    metadata_path = SPHERE_DIR / "point_metadata.json"
    with open(metadata_path, "w") as f:
        json.dump(metadata, f)
    print(f"  point_metadata.json: {len(metadata)} entries, size={metadata_path.stat().st_size / 1e6:.1f} MB")

    # Save feature name mapping for downstream scripts
    names_path = SPHERE_DIR / "feature_names.json"
    with open(names_path, "w") as f:
        json.dump({
            "feature_names": FEATURE_NAMES,
            "perception_dims": PERCEPTION_DIMS,
            "segmentation_keys": SEGMENTATION_KEYS,
            "detection_keys": DETECTION_KEYS,
        }, f, indent=2)

    # Summary statistics
    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"Done in {elapsed:.1f}s")
    print(f"  Points:    {N}")
    print(f"  Features:  {len(FEATURE_NAMES)}")
    print(f"  Missing perception (all zeros): {missing_perception_count} ({100*missing_perception_count/N:.1f}%)")
    print(f"  Feature ranges:")
    for i, name in enumerate(FEATURE_NAMES):
        col = features[:, i]
        nonzero = np.count_nonzero(col)
        print(f"    {name:25s}  min={col.min():.4f}  max={col.max():.4f}  mean={col.mean():.4f}  nonzero={nonzero}")
    print(f"  Perception ranges:")
    for i, dim in enumerate(PERCEPTION_DIMS):
        col = perception_scores[:, i]
        nonzero = np.count_nonzero(col)
        print(f"    {dim:20s}  min={col.min():.2f}  max={col.max():.2f}  mean={col.mean():.2f}  nonzero={nonzero}")


if __name__ == "__main__":
    main()
