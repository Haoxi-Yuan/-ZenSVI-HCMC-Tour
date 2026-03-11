"""PerceptionSphere API — serves sphere embedding, SHAP, FAISS, and binary data."""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response

from backend.config import IMAGE_DIR
from backend.services import sphere_data

router = APIRouter(prefix="/api/sphere", tags=["sphere"])

# Binary responses: immutable data, cache aggressively
_BINARY_HEADERS = {"Cache-Control": "public, max-age=86400, immutable"}


# ──────────────────────────────────────────────
#  Metadata
# ──────────────────────────────────────────────

@router.get("/metadata")
async def metadata():
    """Sphere metadata: point count, dims, feature names, binary data URLs."""
    meta = sphere_data.get_metadata()
    if meta is None:
        raise HTTPException(404, "Sphere data not found. Run preprocessing first.")
    return meta


# ──────────────────────────────────────────────
#  Binary data endpoints (ArrayBuffer for frontend)
# ──────────────────────────────────────────────

@router.get("/binary/embedding")
async def binary_embedding():
    """Spherical coordinates: float32 (N, 2) — (theta, phi)."""
    arr = sphere_data.get_embedding()
    if arr is None:
        raise HTTPException(404, "Embedding not found. Run preprocess_embedding.py first.")
    return Response(
        content=bytes(arr.data),
        media_type="application/octet-stream",
        headers=_BINARY_HEADERS,
    )


@router.get("/binary/embedding_cartesian")
async def binary_embedding_cartesian():
    """Cartesian coordinates: float32 (N, 3) — (x, y, z) unit sphere."""
    arr = sphere_data.get_embedding_cartesian()
    if arr is None:
        raise HTTPException(404, "Cartesian embedding not found. Run preprocess_embedding.py first.")
    return Response(
        content=bytes(arr.data),
        media_type="application/octet-stream",
        headers=_BINARY_HEADERS,
    )


@router.get("/binary/color_blocks")
async def binary_color_blocks():
    """Pre-computed face colors: uint8 (N, 3) RGB."""
    data = sphere_data.get_color_blocks()
    if data is None:
        raise HTTPException(404, "Color blocks not found.")
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers=_BINARY_HEADERS,
    )


@router.get("/binary/perception_scores")
async def binary_perception_scores():
    """Perception scores: float32 (N, 6)."""
    arr = sphere_data.get_perception_scores()
    if arr is None:
        raise HTTPException(404, "Perception scores not found.")
    return Response(
        content=bytes(arr.data),
        media_type="application/octet-stream",
        headers=_BINARY_HEADERS,
    )


@router.get("/binary/cell_radii")
async def binary_cell_radii():
    """Per-cell adaptive radius: float32 (N,) — world-space hex radius per point."""
    path = _Path("/data2/shared/haoxi/projects/ZenSVI/HCMC_Tour/data/sphere/cell_radii.bin")
    if not path.exists():
        raise HTTPException(404, "Cell radii not found.")
    return FileResponse(str(path), media_type="application/octet-stream", headers=_BINARY_HEADERS)


@router.get("/binary/features")
async def binary_features():
    """Feature matrix: float32 (N, 23)."""
    arr = sphere_data.get_features()
    if arr is None:
        raise HTTPException(404, "Features not found.")
    return Response(
        content=bytes(arr.data),
        media_type="application/octet-stream",
        headers=_BINARY_HEADERS,
    )


@router.get("/binary/shap/{dim}")
async def binary_shap(dim: str):
    """SHAP values for one perception dimension: float32 (N, 23)."""
    if dim not in sphere_data.PERCEPTION_DIMS:
        raise HTTPException(400, f"Unknown dimension: {dim}")
    arr = sphere_data.get_shap_values(dim)
    if arr is None:
        raise HTTPException(404, f"SHAP values for '{dim}' not found.")
    return Response(
        content=bytes(arr.data),
        media_type="application/octet-stream",
        headers=_BINARY_HEADERS,
    )


# ──────────────────────────────────────────────
#  Atlas texture data (LOD mosaic)
# ──────────────────────────────────────────────

import json as _json
from pathlib import Path as _Path

_ATLAS_DIR = _Path("/data2/shared/haoxi/projects/ZenSVI/HCMC_Tour/data/sphere/atlas")


@router.get("/atlas/metadata")
async def atlas_metadata():
    """Atlas configuration metadata."""
    meta_path = _ATLAS_DIR / "atlas_metadata.json"
    if not meta_path.exists():
        raise HTTPException(404, "Atlas not generated. Run preprocess_atlas.py first.")
    with open(meta_path) as f:
        return _json.load(f)


@router.get("/atlas/{atlas_idx}")
async def atlas_texture(atlas_idx: int):
    """Serve atlas JPEG texture by index."""
    path = _ATLAS_DIR / f"atlas_{atlas_idx}.jpg"
    if not path.exists():
        raise HTTPException(404, f"Atlas {atlas_idx} not found.")
    return FileResponse(
        str(path), media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )


@router.get("/binary/atlas_uv_offsets")
async def binary_atlas_uv_offsets():
    """UV offset per point: float32 (N, 2)."""
    path = _ATLAS_DIR / "atlas_uv_offsets.bin"
    if not path.exists():
        raise HTTPException(404, "Atlas UV offsets not found.")
    return FileResponse(
        str(path), media_type="application/octet-stream",
        headers=_BINARY_HEADERS,
    )


@router.get("/binary/atlas_index")
async def binary_atlas_index():
    """Atlas index per point: uint8 (N,)."""
    path = _ATLAS_DIR / "atlas_index.bin"
    if not path.exists():
        raise HTTPException(404, "Atlas index not found.")
    return FileResponse(
        str(path), media_type="application/octet-stream",
        headers=_BINARY_HEADERS,
    )


# ──────────────────────────────────────────────
#  Per-point data
# ──────────────────────────────────────────────

@router.get("/point/{point_idx}")
async def point_detail(point_idx: int):
    """Full detail for a single point: metadata + perception scores + features."""
    point_meta = sphere_data.get_point_metadata()
    if point_meta is None or point_idx < 0 or point_idx >= len(point_meta):
        raise HTTPException(404, f"Point {point_idx} not found.")

    info = dict(point_meta[point_idx])
    info["idx"] = point_idx

    # Image filenames from per-point metadata
    district = info.get("district", "")
    folder = info.get("folder", "")
    if district and folder:
        pt_meta_path = IMAGE_DIR / district / folder / "metadata.json"
        if pt_meta_path.exists():
            import json as _json2
            with open(pt_meta_path) as _f:
                pt_fs_meta = _json2.load(_f)
            info["image_filenames"] = pt_fs_meta.get("outputs", [])

    # Perception scores
    scores = sphere_data.get_perception_scores()
    if scores is not None:
        info["perception"] = {
            dim: float(scores[point_idx, i])
            for i, dim in enumerate(sphere_data.PERCEPTION_DIMS)
        }

    # Features
    features = sphere_data.get_features()
    if features is not None and sphere_data.FEATURE_NAMES:
        info["features"] = {
            name: float(features[point_idx, i])
            for i, name in enumerate(sphere_data.FEATURE_NAMES)
        }

    return info


@router.get("/shap/{point_idx}")
async def shap_values(
    point_idx: int,
    dim: str = Query("safer", description="Perception dimension"),
):
    """SHAP values for a single point on one perception dimension."""
    if dim not in sphere_data.PERCEPTION_DIMS:
        raise HTTPException(400, f"Unknown dimension: {dim}. Valid: {sphere_data.PERCEPTION_DIMS}")

    shap = sphere_data.get_shap_values(dim)
    if shap is None:
        raise HTTPException(404, f"SHAP values for '{dim}' not found.")

    if point_idx < 0 or point_idx >= shap.shape[0]:
        raise HTTPException(404, f"Point {point_idx} out of range.")

    values = shap[point_idx]
    feature_names = sphere_data.FEATURE_NAMES

    # Build sorted contribution list
    contributions = []
    for i, name in enumerate(feature_names):
        contributions.append({"feature": name, "shap_value": float(values[i])})
    contributions.sort(key=lambda x: abs(x["shap_value"]), reverse=True)

    # Get base value
    meta = sphere_data.get_metadata()
    base_value = meta["shap_base_values"].get(dim, 0) if meta else 0

    return {
        "point_idx": point_idx,
        "dimension": dim,
        "base_value": base_value,
        "contributions": contributions,
    }


@router.get("/shap-all/{point_idx}")
async def shap_all_dims(point_idx: int):
    """SHAP values for all 6 perception dimensions at once."""
    meta = sphere_data.get_metadata()
    feature_names = sphere_data.FEATURE_NAMES
    result = {"point_idx": point_idx, "dimensions": {}}

    for dim in sphere_data.PERCEPTION_DIMS:
        shap = sphere_data.get_shap_values(dim)
        if shap is None or point_idx < 0 or point_idx >= shap.shape[0]:
            continue
        values = shap[point_idx]
        contributions = [
            {"feature": feature_names[i], "shap_value": float(values[i])}
            for i in range(len(feature_names))
        ]
        contributions.sort(key=lambda x: abs(x["shap_value"]), reverse=True)
        base_value = meta["shap_base_values"].get(dim, 0) if meta else 0
        result["dimensions"][dim] = {
            "base_value": base_value,
            "contributions": contributions,
        }

    return result


# ──────────────────────────────────────────────
#  Similarity & neighbors
# ──────────────────────────────────────────────

@router.get("/similar/{point_idx}")
async def similar_points(
    point_idx: int,
    dim: str = Query("safer", description="Perception dimension or 'concatenated'"),
    k: int = Query(20, ge=1, le=2000),
):
    """Find K most similar points by SHAP profile."""
    if dim != "concatenated" and dim not in sphere_data.PERCEPTION_DIMS:
        raise HTTPException(400, f"Unknown dimension: {dim}")

    result = sphere_data.search_similar(point_idx, dim, k)
    if result is None:
        raise HTTPException(404, "FAISS index or SHAP data not available.")
    return result


@router.get("/neighbors/{point_idx}")
async def neighbors(point_idx: int):
    """Street-adjacent points from the adjacency graph."""
    adj = sphere_data.get_adjacency_graph()
    if adj is None:
        raise HTTPException(404, "Adjacency graph not found. Run preprocess_embedding.py first.")

    neighbor_list = adj.get(str(point_idx), [])
    return {"point_idx": point_idx, "neighbors": neighbor_list}


# ──────────────────────────────────────────────
#  Problems & volunteers
# ──────────────────────────────────────────────

@router.get("/problems/{point_idx}")
async def point_problems(point_idx: int):
    """Problem flags for a single point."""
    problems = sphere_data.get_problems()
    if problems is None:
        raise HTTPException(404, "Problems data not found.")

    point_problems_list = problems.get("point_problems", {}).get(str(point_idx), [])
    return {"point_idx": point_idx, "problems": point_problems_list}


@router.get("/problems-summary")
async def problems_summary():
    """City-wide problem statistics."""
    problems = sphere_data.get_problems()
    if problems is None:
        raise HTTPException(404, "Problems data not found.")
    # Return everything except per-point data (too large)
    return {k: v for k, v in problems.items() if k != "point_problems"}


@router.get("/volunteers")
async def volunteers():
    """All volunteer data: matched photos, notes, trajectories."""
    data = sphere_data.get_volunteers()
    if data is None:
        raise HTTPException(404, "Volunteer data not found.")
    return data


# ──────────────────────────────────────────────
#  Topology / Road network
# ──────────────────────────────────────────────

_TOPOLOGY_DIR = _Path("/data2/shared/haoxi/projects/ZenSVI/HCMC_Tour/data/sphere")


@router.get("/binary/topology_edges")
async def binary_topology_edges():
    """Adjacency edges: float32 pairs [idx_a, idx_b, ...]."""
    path = _TOPOLOGY_DIR / "topology_edges.bin"
    if not path.exists():
        raise HTTPException(404, "Topology edges not found. Run preprocess_topology.py first.")
    return FileResponse(
        str(path), media_type="application/octet-stream",
        headers=_BINARY_HEADERS,
    )


@router.get("/road_network")
async def road_network():
    """Major roads with point indices for sphere overlay."""
    path = _TOPOLOGY_DIR / "road_network.json"
    if not path.exists():
        raise HTTPException(404, "Road network not found. Run preprocess_topology.py first.")
    with open(path, encoding="utf-8") as f:
        return _json.load(f)


@router.get("/landmarks")
async def landmarks():
    """City landmarks mapped to nearest sphere points."""
    path = _TOPOLOGY_DIR / "city_landmarks.json"
    if not path.exists():
        raise HTTPException(404, "Landmarks not found. Run preprocess_topology.py first.")
    with open(path, encoding="utf-8") as f:
        return _json.load(f)


@router.get("/district_boundaries")
async def district_boundaries():
    """District boundary polygons projected onto sphere point indices."""
    path = _TOPOLOGY_DIR / "district_boundaries.json"
    if not path.exists():
        raise HTTPException(404, "District boundaries not found. Run preprocess_topology.py first.")
    with open(path, encoding="utf-8") as f:
        return _json.load(f)


# ──────────────────────────────────────────────
#  Voronoi tessellation data
# ──────────────────────────────────────────────

_VORONOI_DIR = _Path("/data2/shared/haoxi/projects/ZenSVI/HCMC_Tour/data/sphere/voronoi")


@router.get("/voronoi/metadata")
async def voronoi_metadata():
    """Voronoi tessellation metadata: vertex/triangle counts."""
    path = _VORONOI_DIR / "voronoi_metadata.json"
    if not path.exists():
        raise HTTPException(404, "Voronoi data not found. Run preprocess_voronoi.py first.")
    with open(path) as f:
        return _json.load(f)


@router.get("/binary/voronoi_positions")
async def binary_voronoi_positions():
    """Voronoi vertex positions: float32 (V, 3) — unit sphere coords."""
    path = _VORONOI_DIR / "voronoi_positions.bin"
    if not path.exists():
        raise HTTPException(404, "Voronoi positions not found.")
    return FileResponse(str(path), media_type="application/octet-stream", headers=_BINARY_HEADERS)


@router.get("/binary/voronoi_indices")
async def binary_voronoi_indices():
    """Voronoi triangle indices: uint32 (T, 3)."""
    path = _VORONOI_DIR / "voronoi_indices.bin"
    if not path.exists():
        raise HTTPException(404, "Voronoi indices not found.")
    return FileResponse(str(path), media_type="application/octet-stream", headers=_BINARY_HEADERS)


@router.get("/binary/voronoi_cell_ids")
async def binary_voronoi_cell_ids():
    """Cell ID per vertex: uint32 (V,)."""
    path = _VORONOI_DIR / "voronoi_cell_ids.bin"
    if not path.exists():
        raise HTTPException(404, "Voronoi cell IDs not found.")
    return FileResponse(str(path), media_type="application/octet-stream", headers=_BINARY_HEADERS)


@router.get("/binary/voronoi_local_uvs")
async def binary_voronoi_local_uvs():
    """Local UV per vertex: float32 (V, 2) — for atlas texture sampling."""
    path = _VORONOI_DIR / "voronoi_local_uvs.bin"
    if not path.exists():
        raise HTTPException(404, "Voronoi local UVs not found.")
    return FileResponse(str(path), media_type="application/octet-stream", headers=_BINARY_HEADERS)


# ──────────────────────────────────────────────
#  Static file serving
# ──────────────────────────────────────────────

@router.get("/thumbnails/{idx}/{size}")
async def thumbnail(idx: int, size: int = 128):
    """Serve a point's thumbnail image."""
    path = sphere_data.get_thumbnail_path(idx, size)
    if path is None:
        raise HTTPException(404, f"Thumbnail {idx} not found.")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )


@router.get("/volunteers/image/{filename}")
async def volunteer_image(filename: str):
    """Serve a volunteer photo."""
    path = sphere_data.get_volunteer_image_path(filename)
    if path is None:
        raise HTTPException(404, f"Volunteer image '{filename}' not found.")
    return FileResponse(path, media_type="image/jpeg")