"""
preprocess_faiss.py — Build FAISS similarity indices for SHAP profiles

Creates 7 indices:
  - 6 per-dimension indices: each using 23-dim SHAP vectors (IVFFlat)
  - 1 concatenated index: 138-dim (all 6 SHAP vectors concatenated), IVF-PQ

Each vector is L2-normalized before indexing, so inner product = cosine similarity.

Output to data/sphere/faiss_indices/:
  - {dim}.index × 6       IVFFlat indices (~15 MB each)
  - concatenated.index     IVFPQ index (~30 MB)
"""

import json
import sys
import time
from pathlib import Path

import faiss
import numpy as np

SPHERE_DIR = Path("/data2/shared/haoxi/projects/ZenSVI/HCMC_Tour/data/sphere")
SHAP_DIR = SPHERE_DIR / "shap_values"
FAISS_DIR = SPHERE_DIR / "faiss_indices"

PERCEPTION_DIMS = [
    "safer", "livelier", "wealthier",
    "more_beautiful", "more_boring", "more_depressing",
]

NLIST = 256   # number of Voronoi cells in coarse quantizer
NPROBE = 16   # number of cells to search at query time


def normalize_l2(vectors):
    """L2-normalize each row vector."""
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-8)
    return (vectors / norms).astype(np.float32)


def build_ivf_flat(vectors, name):
    """Build an IVFFlat index for cosine similarity (via inner product on L2-normed vectors)."""
    vectors_normed = normalize_l2(vectors)
    d = vectors_normed.shape[1]

    quantizer = faiss.IndexFlatIP(d)
    index = faiss.IndexIVFFlat(quantizer, d, NLIST, faiss.METRIC_INNER_PRODUCT)

    print(f"  Training {name} (d={d}, nlist={NLIST})...", end=" ", flush=True)
    index.train(vectors_normed)
    print("adding...", end=" ", flush=True)
    index.add(vectors_normed)
    index.nprobe = NPROBE
    print(f"done. ntotal={index.ntotal}")

    return index


def build_ivf_pq(vectors, name):
    """Build an IVF-PQ index for the high-dimensional concatenated vectors."""
    vectors_normed = normalize_l2(vectors)
    d = vectors_normed.shape[1]

    # m must divide d. d=138 -> m=23 (138/23=6) or m=6 (138/6=23)
    m = 23  # 6 bytes per sub-quantizer
    nbits = 8

    quantizer = faiss.IndexFlatIP(d)
    index = faiss.IndexIVFPQ(quantizer, d, NLIST, m, nbits, faiss.METRIC_INNER_PRODUCT)

    print(f"  Training {name} (d={d}, nlist={NLIST}, m={m})...", end=" ", flush=True)
    index.train(vectors_normed)
    print("adding...", end=" ", flush=True)
    index.add(vectors_normed)
    index.nprobe = NPROBE
    print(f"done. ntotal={index.ntotal}")

    return index


def main():
    start = time.time()
    print("=" * 60)
    print("PerceptionSphere FAISS Index Builder")
    print("=" * 60)

    FAISS_DIR.mkdir(parents=True, exist_ok=True)

    # Load all SHAP values
    print("\nLoading SHAP values...")
    shap_data = {}
    for dim in PERCEPTION_DIMS:
        path = SHAP_DIR / f"{dim}.npy"
        if not path.exists():
            print(f"  ERROR: {path} not found. Run preprocess_shap.py first.")
            sys.exit(1)
        shap_data[dim] = np.load(path)
        print(f"  {dim}: {shap_data[dim].shape}")

    N = shap_data[PERCEPTION_DIMS[0]].shape[0]

    # Build per-dimension indices
    print(f"\n[1/2] Building per-dimension indices (IVFFlat)...")
    total = len(PERCEPTION_DIMS) + 1
    for i, dim in enumerate(PERCEPTION_DIMS):
        bar = "#" * int((i / total) * 30) + "-" * (30 - int((i / total) * 30))
        print(f"\n  PROGRESS: [{bar}] {i}/{total}", flush=True)

        index = build_ivf_flat(shap_data[dim], dim)
        path = FAISS_DIR / f"{dim}.index"
        faiss.write_index(index, str(path))
        print(f"  Saved: {path.name} ({path.stat().st_size / 1e6:.1f} MB)")

    # Build concatenated index
    print(f"\n[2/2] Building concatenated index (IVF-PQ)...")
    bar = "#" * int((len(PERCEPTION_DIMS) / total) * 30) + "-" * (30 - int((len(PERCEPTION_DIMS) / total) * 30))
    print(f"\n  PROGRESS: [{bar}] {len(PERCEPTION_DIMS)}/{total}", flush=True)

    concatenated = np.concatenate([shap_data[dim] for dim in PERCEPTION_DIMS], axis=1)
    print(f"  Concatenated shape: {concatenated.shape}")

    index = build_ivf_pq(concatenated, "concatenated")
    path = FAISS_DIR / "concatenated.index"
    faiss.write_index(index, str(path))
    print(f"  Saved: {path.name} ({path.stat().st_size / 1e6:.1f} MB)")

    # Verification: test a query
    print(f"\n  Verification query (point 0, safer)...")
    test_idx = build_ivf_flat(shap_data["safer"], "test")
    query = normalize_l2(shap_data["safer"][:1])
    D, I = test_idx.search(query, 5)
    print(f"  Top-5 neighbors of point 0: {I[0].tolist()}")
    print(f"  Similarities: {D[0].tolist()}")

    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"  PROGRESS: [{'#' * 30}] {total}/{total} | COMPLETE")
    print(f"Done in {elapsed:.1f}s")

    # List all index files
    print(f"\nIndex files:")
    for p in sorted(FAISS_DIR.glob("*.index")):
        print(f"  {p.name}: {p.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()