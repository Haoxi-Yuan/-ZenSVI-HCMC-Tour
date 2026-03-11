"""
preprocess_problems.py — Rule-based walkability problem detection

Applies spatial overlap rules using segmentation ratios and detection counts
to flag walkability problems at each sampling point.

Rules:
  1. sidewalk_encroachment: motorcycle pixels + sidewalk pixels co-occur
  2. low_shade:             low vegetation + high sky exposure
  3. pedestrian_space_deficit: very low sidewalk ratio
  4. vehicle_dominance:     high total vehicle pixel ratio
  5. visual_clutter:        high object detection counts
  6. low_safety_perception: bottom-quartile safer score

Output to data/sphere/:
  - problems.json   per-point problem flags + city-wide statistics
"""

import json
import time
from pathlib import Path

import numpy as np

SPHERE_DIR = Path("/data2/shared/haoxi/projects/ZenSVI/HCMC_Tour/data/sphere")


# Rule definitions: (rule_id, name, description, condition_fn)
# Each condition_fn takes (features[i], perception[i]) and returns bool
# Feature order matches feature_names.json

def load_feature_index():
    """Load feature name -> column index mapping."""
    with open(SPHERE_DIR / "feature_names.json") as f:
        data = json.load(f)
    fnames = data["feature_names"]
    return {name: idx for idx, name in enumerate(fnames)}


RULES = [
    {
        "id": "sidewalk_encroachment",
        "name": "Sidewalk Encroachment",
        "description": "Motorcycle/vehicle pixels co-occur with sidewalk area, suggesting sidewalk occupation",
    },
    {
        "id": "low_shade",
        "name": "Insufficient Shade/Vegetation",
        "description": "Low vegetation coverage combined with high sky exposure",
    },
    {
        "id": "pedestrian_space_deficit",
        "name": "Pedestrian Space Deficit",
        "description": "Very low sidewalk pixel ratio, indicating inadequate pedestrian infrastructure",
    },
    {
        "id": "vehicle_dominance",
        "name": "Vehicle Dominance",
        "description": "High proportion of vehicle pixels in the streetscape",
    },
    {
        "id": "visual_clutter",
        "name": "Visual Clutter / High Object Density",
        "description": "High density of detected objects (motorbikes or cars)",
    },
    {
        "id": "low_safety_perception",
        "name": "Low Safety Perception",
        "description": "Perception 'safer' score in the bottom quartile (<3.0)",
    },
]


def evaluate_rules(features, perception, fidx):
    """Evaluate all rules for all points. Returns dict of point_idx -> [rule_indices]."""
    N = features.shape[0]

    # Pre-extract columns
    seg_motorcycle = features[:, fidx["seg_motorcycle"]]
    seg_sidewalk = features[:, fidx["seg_sidewalk"]]
    seg_vegetation = features[:, fidx["seg_vegetation"]]
    seg_sky = features[:, fidx["seg_sky"]]
    seg_car = features[:, fidx["seg_car"]]
    seg_bus = features[:, fidx["seg_bus"]]
    seg_truck = features[:, fidx["seg_truck"]]
    det_motorbike = features[:, fidx["det_motorbike"]]
    det_car = features[:, fidx["det_car"]]
    safer = perception[:, 0]  # col 0 = safer

    # Evaluate each rule as vectorized boolean mask
    masks = [
        # Rule 0: sidewalk_encroachment
        (seg_motorcycle > 0.02) & (seg_sidewalk > 0.03),
        # Rule 1: low_shade
        (seg_vegetation < 0.05) & (seg_sky > 0.3),
        # Rule 2: pedestrian_space_deficit
        seg_sidewalk < 0.02,
        # Rule 3: vehicle_dominance
        (seg_car + seg_motorcycle + seg_bus + seg_truck) > 0.3,
        # Rule 4: visual_clutter
        (det_motorbike > 5) | (det_car > 5),
        # Rule 5: low_safety_perception
        safer < 3.0,
    ]

    # Build per-point problem list
    point_problems = {}
    for i in range(N):
        triggered = [r for r, mask in enumerate(masks) if mask[i]]
        if triggered:
            point_problems[str(i)] = triggered

    # City-wide statistics
    summary = {}
    for r, rule in enumerate(RULES):
        count = int(masks[r].sum())
        summary[rule["id"]] = {
            "count": count,
            "pct": round(100 * count / N, 2),
        }

    return point_problems, summary


def main():
    start = time.time()
    print("=" * 60)
    print("PerceptionSphere Problem Detection")
    print("=" * 60)

    # Load data
    print("\nLoading features and perception scores...")
    features = np.load(SPHERE_DIR / "features.npy")
    perception = np.load(SPHERE_DIR / "perception_scores.npy")
    fidx = load_feature_index()
    N = features.shape[0]
    print(f"  Points: {N}, Features: {features.shape[1]}")

    # Evaluate rules
    print("\nEvaluating problem rules...")
    point_problems, summary = evaluate_rules(features, perception, fidx)

    # Count points with at least one problem
    n_with_problems = len(point_problems)
    print(f"\n  Points with at least one problem: {n_with_problems} ({100*n_with_problems/N:.1f}%)")

    print(f"\n  Problem Summary:")
    print(f"  {'Rule':35s} {'Count':>8s} {'Pct':>7s}")
    print(f"  {'─'*35} {'─'*8} {'─'*7}")
    for rule in RULES:
        s = summary[rule["id"]]
        print(f"  {rule['name']:35s} {s['count']:>8d} {s['pct']:>6.1f}%")

    # Save
    output = {
        "rules": RULES,
        "point_problems": point_problems,
        "summary": summary,
        "total_points": N,
    }
    out_path = SPHERE_DIR / "problems.json"
    with open(out_path, "w") as f:
        json.dump(output, f)

    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"Saved: {out_path.name} ({out_path.stat().st_size / 1e6:.1f} MB)")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()