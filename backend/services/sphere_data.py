"""Lazy-loading data service for PerceptionSphere.

All heavy arrays (numpy, FAISS) are loaded on first access and cached.
Binary files use mmap_mode='r' for memory-efficient serving.
"""

import json
from pathlib import Path
from typing import Optional

import numpy as np

from backend.config import SPHERE_DATA_DIR

# Lazy-loaded singletons
_cache: dict = {}
_thumbnail_sizes_cache: list[int] | None = None

PERCEPTION_DIMS = [
    "safer", "livelier", "wealthier",
    "more_beautiful", "more_boring", "more_depressing",
]

FEATURE_NAMES: list[str] = []


def _sphere_path(filename: str) -> Path:
    return SPHERE_DATA_DIR / filename


def _load_json(filename: str) -> Optional[dict | list]:
    p = _sphere_path(filename)
    if not p.exists():
        return None
    with open(p) as f:
        return json.load(f)


def _load_npy(filename: str, mmap: bool = True) -> Optional[np.ndarray]:
    p = _sphere_path(filename)
    if not p.exists():
        return None
    return np.load(p, mmap_mode="r" if mmap else None)


def get_metadata() -> Optional[dict]:
    """Return sphere metadata: point count, dimension info, feature names, data URLs."""
    if "metadata" in _cache:
        return _cache["metadata"]

    point_meta = _load_json("point_metadata.json")
    if point_meta is None:
        return None

    feature_info = _load_json("feature_names.json")
    base_values = _load_json("shap_values/base_values.json")

    # Check which data files exist
    has_embedding = _sphere_path("embedding.npy").exists()
    has_adjacency = _sphere_path("adjacency_graph.json").exists()

    meta = {
        "n_points": len(point_meta),
        "perception_dims": PERCEPTION_DIMS,
        "feature_names": feature_info.get("feature_names", []) if feature_info else [],
        "shap_base_values": base_values or {},
        "has_embedding": has_embedding,
        "has_adjacency": has_adjacency,
        "binary_endpoints": {
            "embedding": "/api/sphere/binary/embedding",
            "color_blocks": "/api/sphere/binary/color_blocks",
            "perception_scores": "/api/sphere/binary/perception_scores",
            "embedding_cartesian": "/api/sphere/binary/embedding_cartesian",
        },
    }
    _cache["metadata"] = meta

    # Cache feature names for SHAP endpoint
    global FEATURE_NAMES
    FEATURE_NAMES = meta["feature_names"]

    return meta


def get_point_metadata() -> Optional[list]:
    if "point_metadata" in _cache:
        return _cache["point_metadata"]
    data = _load_json("point_metadata.json")
    if data is not None:
        _cache["point_metadata"] = data
    return data


def get_embedding() -> Optional[np.ndarray]:
    if "embedding" not in _cache:
        _cache["embedding"] = _load_npy("embedding.npy")
    return _cache["embedding"]


def get_embedding_cartesian() -> Optional[np.ndarray]:
    if "embedding_cartesian" not in _cache:
        _cache["embedding_cartesian"] = _load_npy("embedding_cartesian.npy")
    return _cache["embedding_cartesian"]


def get_perception_scores() -> Optional[np.ndarray]:
    if "perception_scores" not in _cache:
        _cache["perception_scores"] = _load_npy("perception_scores.npy")
    return _cache["perception_scores"]


def get_color_blocks() -> Optional[bytes]:
    if "color_blocks" not in _cache:
        p = _sphere_path("color_blocks.bin")
        if not p.exists():
            _cache["color_blocks"] = None
        else:
            _cache["color_blocks"] = p.read_bytes()
    return _cache["color_blocks"]


def get_features() -> Optional[np.ndarray]:
    if "features" not in _cache:
        _cache["features"] = _load_npy("features.npy")
    return _cache["features"]


def get_shap_values(dim: str) -> Optional[np.ndarray]:
    key = f"shap_{dim}"
    if key not in _cache:
        _cache[key] = _load_npy(f"shap_values/{dim}.npy")
    return _cache[key]


def get_adjacency_graph() -> Optional[dict]:
    if "adjacency" not in _cache:
        _cache["adjacency"] = _load_json("adjacency_graph.json")
    return _cache["adjacency"]


def get_problems() -> Optional[dict]:
    if "problems" not in _cache:
        _cache["problems"] = _load_json("problems.json")
    return _cache["problems"]


def get_volunteers() -> Optional[dict]:
    if "volunteers" not in _cache:
        _cache["volunteers"] = _load_json("volunteers.json")
    return _cache["volunteers"]


def get_faiss_index(dim: str):
    """Load a FAISS index for the given dimension (or 'concatenated')."""
    key = f"faiss_{dim}"
    if key not in _cache:
        import faiss

        p = _sphere_path(f"faiss_indices/{dim}.index")
        if not p.exists():
            _cache[key] = None
        else:
            index = faiss.read_index(str(p))
            _cache[key] = index
    return _cache[key]


def search_similar(point_idx: int, dim: str = "safer", k: int = 20) -> Optional[dict]:
    """Find K most similar points by SHAP profile using FAISS."""
    index = get_faiss_index(dim)
    if index is None:
        return None

    shap = get_shap_values(dim)
    if shap is None:
        return None

    # L2-normalize query vector (indices built with IP metric on L2-normed vectors)
    query = np.array(shap[point_idx], dtype=np.float32).reshape(1, -1)
    norm = np.linalg.norm(query)
    if norm > 1e-8:
        query = query / norm

    distances, indices = index.search(query, k + 1)

    # Filter out self
    results = []
    for d, i in zip(distances[0], indices[0]):
        if int(i) != point_idx and int(i) >= 0:
            results.append({"idx": int(i), "similarity": float(d)})
        if len(results) >= k:
            break

    return {"query_idx": point_idx, "dimension": dim, "neighbors": results}


def get_thumbnail_path(idx: int, size: int = 128) -> Optional[Path]:
    """Return thumbnail path, falling back to available sizes when needed."""
    global _thumbnail_sizes_cache

    # Lazily discover available thumbnail size folders (e.g. 128, 256).
    if _thumbnail_sizes_cache is None:
        sizes: list[int] = []
        thumbs_root = _sphere_path("thumbnails")
        if thumbs_root.exists():
            for d in thumbs_root.iterdir():
                if d.is_dir() and d.name.isdigit():
                    sizes.append(int(d.name))
        _thumbnail_sizes_cache = sorted(sizes)

    # Prefer requested size, then common default, then any discovered size.
    candidates = [size, 128, *(_thumbnail_sizes_cache or [])]
    tried: set[int] = set()
    for s in candidates:
        if s in tried:
            continue
        tried.add(s)
        p = _sphere_path(f"thumbnails/{s}/{idx:06d}.jpg")
        if p.exists():
            return p
    return None


def get_volunteer_image_path(filename: str) -> Optional[Path]:
    p = _sphere_path(f"volunteers/images/{filename}")
    return p if p.exists() else None
