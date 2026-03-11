"""
verify_embedding.py — Validate sphere embedding quality

Tests three hypotheses:
  1. Topology preservation: street-adjacent points remain neighbors on sphere
  2. Perception clustering: similar perception scores cluster on sphere (Moran's I)
  3. Distribution uniformity: points spread reasonably across the sphere

Run after preprocess_embedding.py completes.
"""

import json
import time
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

SPHERE_DIR = Path("/data2/shared/haoxi/projects/ZenSVI/HCMC_Tour/data/sphere")

PERCEPTION_DIMS = [
    "safer", "livelier", "wealthier",
    "more_beautiful", "more_boring", "more_depressing",
]


def morans_i(values, coords, k=10, sample_size=5000):
    """Compute Moran's I spatial autocorrelation on a sample."""
    N = len(values)
    rng = np.random.RandomState(42)
    sample_idx = rng.choice(N, min(sample_size, N), replace=False)

    vals = values[sample_idx]
    pts = coords[sample_idx]
    n = len(vals)

    tree = cKDTree(pts)
    mean_val = vals.mean()
    denom = np.sum((vals - mean_val) ** 2)
    if denom == 0:
        return 0.0

    numer = 0.0
    W = 0.0
    for i in range(n):
        dists, idxs = tree.query(pts[i], k=k + 1)
        for d, j in zip(dists[1:], idxs[1:]):
            if d > 0:
                w = 1.0 / d
                numer += w * (vals[i] - mean_val) * (vals[j] - mean_val)
                W += w

    if W == 0:
        return 0.0
    return (n / W) * (numer / denom)


def main():
    start = time.time()
    print("=" * 60)
    print("PerceptionSphere Embedding Verification")
    print("=" * 60)

    # Load data
    print("\nLoading data...")
    xyz = np.load(SPHERE_DIR / "embedding_cartesian.npy")
    spherical = np.load(SPHERE_DIR / "embedding.npy")
    perception = np.load(SPHERE_DIR / "perception_scores.npy")

    with open(SPHERE_DIR / "adjacency_graph.json") as f:
        adj_list = json.load(f)

    with open(SPHERE_DIR / "point_metadata.json") as f:
        metadata = json.load(f)

    N = len(xyz)
    print(f"  Points: {N}")

    # === Test 1: Topology Preservation ===
    print(f"\n{'─' * 50}")
    print(f"  TEST 1: Topology Preservation")
    print(f"{'─' * 50}")

    tree = cKDTree(xyz)
    K_VALUES = [5, 10, 20, 50]

    for K in K_VALUES:
        preserved = 0
        total = 0
        sample_size = min(5000, N)
        rng = np.random.RandomState(42)
        sample_idx = rng.choice(N, sample_size, replace=False)

        for i in sample_idx:
            neighbors = adj_list.get(str(i), [])
            if not neighbors:
                continue
            _, knn = tree.query(xyz[i], k=K + 1)
            knn_set = set(knn[1:].tolist())
            for n in neighbors:
                total += 1
                if n in knn_set:
                    preserved += 1

        recall = preserved / max(total, 1)
        status = "PASS" if recall > 0.3 else ("WARN" if recall > 0.1 else "FAIL")
        print(f"  Adjacency recall@{K:2d}: {recall:.4f} ({preserved}/{total}) [{status}]")

    # === Test 2: Perception Clustering (Moran's I) ===
    print(f"\n{'─' * 50}")
    print(f"  TEST 2: Perception Clustering (Moran's I)")
    print(f"{'─' * 50}")

    for dim_idx, dim_name in enumerate(PERCEPTION_DIMS):
        values = perception[:, dim_idx]
        mi = morans_i(values, xyz, k=10, sample_size=5000)
        status = "PASS" if mi > 0.3 else ("WARN" if mi > 0.1 else "FAIL")
        print(f"  {dim_name:20s}: I = {mi:.4f} [{status}]")

    # === Test 3: Distribution Uniformity ===
    print(f"\n{'─' * 50}")
    print(f"  TEST 3: Distribution Uniformity")
    print(f"{'─' * 50}")

    theta = spherical[:, 0]
    phi = spherical[:, 1]

    # Check theta distribution (should span [0, pi])
    theta_coverage = (theta.max() - theta.min()) / np.pi
    print(f"  Theta coverage: {theta_coverage:.4f} (target: >0.8)")

    # Check phi distribution (should span [0, 2*pi])
    phi_coverage = (phi.max() - phi.min()) / (2 * np.pi)
    print(f"  Phi coverage:   {phi_coverage:.4f} (target: >0.8)")

    # Check for degenerate clustering (all points in a small patch)
    nn_dists, _ = tree.query(xyz, k=2)
    nn_dists = nn_dists[:, 1]  # nearest neighbor distance
    print(f"  NN distance: min={nn_dists.min():.6f}, median={np.median(nn_dists):.6f}, "
          f"max={nn_dists.max():.6f}")
    print(f"  NN dist CV:  {nn_dists.std() / nn_dists.mean():.4f} (lower = more uniform)")

    # District coherence check
    print(f"\n{'─' * 50}")
    print(f"  BONUS: District Spatial Coherence")
    print(f"{'─' * 50}")

    districts = [p["district"] for p in metadata]
    unique_districts = sorted(set(districts))
    district_to_idx = {d: i for i, d in enumerate(unique_districts)}
    district_labels = np.array([district_to_idx[d] for d in districts])

    # For each district, compute the average intra-district distance vs inter-district
    rng = np.random.RandomState(42)
    sample_districts = rng.choice(unique_districts, min(5, len(unique_districts)), replace=False)
    for d in sample_districts:
        mask = np.array([dd == d for dd in districts])
        n_in = mask.sum()
        if n_in < 10:
            continue
        pts_in = xyz[mask]
        centroid = pts_in.mean(axis=0)
        centroid /= np.linalg.norm(centroid)
        intra_dist = np.linalg.norm(pts_in - centroid, axis=1).mean()
        # Sample some out-of-district points
        out_idx = rng.choice(np.where(~mask)[0], min(n_in, 500), replace=False)
        inter_dist = np.linalg.norm(xyz[out_idx] - centroid, axis=1).mean()
        ratio = intra_dist / max(inter_dist, 1e-8)
        print(f"  {d:15s}: n={n_in:>6d}, intra={intra_dist:.4f}, inter={inter_dist:.4f}, "
              f"ratio={ratio:.4f} (lower = more cohesive)")

    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"Verification done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()