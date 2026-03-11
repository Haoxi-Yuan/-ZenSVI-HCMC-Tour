#!/usr/bin/env python3
"""
preprocess_topology.py — Generate road network topology + district boundaries
for sphere overlay.

Uses streets_geojson.json LineStrings (real OSM road geometry) to build
street-level edges, then filters by sphere surface distance, prunes
degree-1 endpoints, removes small components and sharp-angle edges.

Also projects HCMC district boundaries (hochiminh_districts.geojson) onto
the sphere by mapping each boundary coordinate to its nearest sphere point.

Outputs (into data/sphere/):
  - topology_edges.bin     Float32 pairs [idx_a, idx_b, ...] — clean street edges
  - road_network.json      Major roads with cleaned edge pairs
  - city_landmarks.json    HCMC landmarks mapped to nearest sphere points
  - district_boundaries.json  District polygons projected onto sphere point indices
"""

import json
import struct
import re
from pathlib import Path
from collections import defaultdict

import numpy as np
from scipy.spatial import cKDTree

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SPHERE_DIR = DATA_DIR / "sphere"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# Max distance (meters) to snap a GeoJSON coordinate to a sphere point
SNAP_THRESHOLD_M = 50
# Approximate meters per degree at HCMC latitude (~10.8°N)
DEG_TO_M_LAT = 111_320
DEG_TO_M_LON = 111_320 * np.cos(np.radians(10.8))

# Max chord distance on unit sphere to keep an edge.
CHORD_THRESHOLD = 0.15


def load_point_index():
    """Build KD-tree from point_metadata for fast coord→idx lookup."""
    print("  Loading point_metadata ...")
    with open(SPHERE_DIR / "point_metadata.json") as f:
        meta = json.load(f)

    n = len(meta)
    coords = np.empty((n, 2), dtype=np.float64)
    lats = np.empty(n, dtype=np.float64)
    lons = np.empty(n, dtype=np.float64)
    for p in meta:
        i = p["idx"]
        coords[i, 0] = p["lat"] * DEG_TO_M_LAT
        coords[i, 1] = p["lon"] * DEG_TO_M_LON
        lats[i] = p["lat"]
        lons[i] = p["lon"]

    tree = cKDTree(coords)
    print(f"  KD-tree built: {n:,} points")
    return tree, coords, n, lats, lons


def load_sphere_positions():
    """Load unit sphere positions for distance filtering."""
    pos = np.load(SPHERE_DIR / "embedding_cartesian.npy")  # (N, 3)
    print(f"  Sphere positions loaded: {len(pos):,} points")
    return pos


def snap_coord_to_idx(tree, lon, lat):
    """Snap a (lon, lat) coordinate to the nearest point index. Returns -1 if too far."""
    query = [lat * DEG_TO_M_LAT, lon * DEG_TO_M_LON]
    dist, idx = tree.query(query)
    if dist > SNAP_THRESHOLD_M:
        return -1
    return int(idx)


def chord_dist(pos, a, b):
    """Chord distance between two points on the unit sphere."""
    d = pos[a] - pos[b]
    return float(np.sqrt(d[0]**2 + d[1]**2 + d[2]**2))


def prune_degree1(edges):
    """Iteratively remove edges that leave degree-1 (dangling) endpoints."""
    edge_set = set(edges)
    changed = True
    iteration = 0
    while changed:
        changed = False
        iteration += 1
        deg = defaultdict(int)
        for a, b in edge_set:
            deg[a] += 1
            deg[b] += 1
        to_remove = set()
        for edge in edge_set:
            a, b = edge
            if deg[a] == 1 or deg[b] == 1:
                to_remove.add(edge)
        if to_remove:
            edge_set -= to_remove
            changed = True
        if iteration > 200:
            break
    return edge_set


def _remove_sharp_angles(edges, sphere_pos, min_cos=-0.3):
    """Remove edges at degree-2 nodes where the angle is too sharp.

    At each node with exactly 2 neighbors, compute the cosine of the angle
    formed by the two incident edge vectors. If cos(angle) > min_cos
    (angle < ~107°), remove the shorter edge to break the sharp bend.
    """
    adj = defaultdict(set)
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)

    to_remove = set()
    for node, neighbors in adj.items():
        if len(neighbors) != 2:
            continue
        n1, n2 = list(neighbors)
        v1 = sphere_pos[n1] - sphere_pos[node]
        v2 = sphere_pos[n2] - sphere_pos[node]
        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)
        if norm1 < 1e-10 or norm2 < 1e-10:
            continue
        cos_angle = float(np.dot(v1, v2) / (norm1 * norm2))
        if cos_angle > min_cos:  # Sharp angle
            e1 = (min(node, n1), max(node, n1))
            e2 = (min(node, n2), max(node, n2))
            to_remove.add(e1 if norm1 < norm2 else e2)

    result = edges - to_remove
    print(f"    Removed {len(to_remove)} sharp-angle edges")
    return result


def _remove_small_components(edges, min_edges=10):
    """Remove connected components with fewer than min_edges edges."""
    adj = defaultdict(set)
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)

    visited = set()
    components = []
    for node in adj:
        if node in visited:
            continue
        comp_nodes = set()
        queue = [node]
        while queue:
            n = queue.pop()
            if n in visited:
                continue
            visited.add(n)
            comp_nodes.add(n)
            for nb in adj[n]:
                if nb not in visited:
                    queue.append(nb)
        components.append(comp_nodes)

    result = set()
    for comp_nodes in components:
        comp_edges = {(a, b) for a, b in edges if a in comp_nodes}
        if len(comp_edges) >= min_edges:
            result |= comp_edges

    return result


# ---------------------------------------------------------------------------
# 1. Street edges + road network
# ---------------------------------------------------------------------------

def build_street_edges_and_roads(tree, sphere_pos):
    print("[1/3] Building street edges from GeoJSON LineStrings ...")

    with open(DATA_DIR / "streets_geojson.json") as f:
        geojson = json.load(f)

    features = geojson["features"]
    print(f"  {len(features):,} LineString features")

    KNOWN_MAJOR = {
        "Võ Văn Kiệt", "Nguyễn Văn Linh", "Cách Mạng Tháng 8",
        "Trần Hưng Đạo", "Lê Lợi", "Đồng Khởi", "Nam Kỳ Khởi Nghĩa",
        "Nguyễn Trãi", "Điện Biên Phủ", "Xa lộ Hà Nội",
        "Nguyễn Huệ", "Lê Duẩn", "Hai Bà Trưng", "Pasteur",
        "Phạm Ngũ Lão", "Nguyễn Thị Minh Khai", "3 Tháng 2",
        "Lý Tự Trọng", "Phạm Văn Đồng", "Nguyễn Văn Trỗi",
        "Cộng Hòa", "Hoàng Văn Thụ", "Quốc lộ 1A", "Quốc lộ 13",
        "Đại lộ Đông Tây", "Nguyễn Hữu Thọ", "Lê Văn Lương",
        "Nguyễn Văn Cừ", "Tôn Đức Thắng", "Hùng Vương",
        "Trường Chinh", "Lạc Long Quân", "Âu Cơ",
        "Phan Đăng Lưu", "Hoàng Sa", "Trường Sa",
        "Đỗ Mười", "Đường Phan Văn Khải",
        "Tỉnh lộ 8", "Tỉnh lộ 10", "Tỉnh lộ 15",
        "Nguyễn Tất Thành", "Bùi Viện",
    }

    # ─── Step 1: Build raw edges from GeoJSON ────────────────
    all_edges_raw = set()
    road_edges_raw = defaultdict(set)
    snapped = 0
    missed = 0

    for feat in features:
        coords = feat.get("geometry", {}).get("coordinates", [])
        name = feat.get("properties", {}).get("name", "")
        base_name = re.sub(r"\s*#\d+$", "", name) if name else ""

        if len(coords) < 2:
            continue

        idx_seq = []
        for lon, lat in coords:
            idx = snap_coord_to_idx(tree, lon, lat)
            if idx >= 0:
                snapped += 1
                if not idx_seq or idx_seq[-1] != idx:
                    idx_seq.append(idx)
            else:
                missed += 1

        for i in range(len(idx_seq) - 1):
            a, b = idx_seq[i], idx_seq[i + 1]
            if a == b:
                continue
            edge = (min(a, b), max(a, b))
            all_edges_raw.add(edge)
            if base_name:
                road_edges_raw[base_name].add(edge)

    total_snap = snapped + missed
    print(f"  Snapped: {snapped:,}/{total_snap:,} ({100*snapped/total_snap:.1f}%)")
    print(f"  Raw unique street edges: {len(all_edges_raw):,}")

    # ─── Step 2: Filter by sphere chord distance ─────────────
    print(f"  Filtering by chord distance < {CHORD_THRESHOLD} ...")
    all_edges_filtered = set()
    for a, b in all_edges_raw:
        if chord_dist(sphere_pos, a, b) < CHORD_THRESHOLD:
            all_edges_filtered.add((a, b))

    print(f"  After distance filter: {len(all_edges_filtered):,} edges "
          f"({100*len(all_edges_filtered)/len(all_edges_raw):.1f}%)")

    # ─── Step 3: Prune degree-1 dangling endpoints ───────────
    print("  Pruning degree-1 endpoints ...")
    all_edges_clean = prune_degree1(all_edges_filtered)
    print(f"  After pruning: {len(all_edges_clean):,} edges")

    # ─── Step 4: Remove small connected components ──────────
    print("  Removing small connected components ...")
    all_edges_clean = _remove_small_components(all_edges_clean, min_edges=10)
    print(f"  After component filter: {len(all_edges_clean):,} edges")

    # ─── Step 5: Remove sharp-angle edges ─────────────────────
    print("  Filtering sharp-angle edges ...")
    all_edges_clean = _remove_sharp_angles(all_edges_clean, sphere_pos, min_cos=-0.3)
    # Re-prune + re-filter after angle removal
    all_edges_clean = prune_degree1(all_edges_clean)
    all_edges_clean = _remove_small_components(all_edges_clean, min_edges=10)
    print(f"  After angle filter + cleanup: {len(all_edges_clean):,} edges")

    # Verify
    deg = defaultdict(int)
    for a, b in all_edges_clean:
        deg[a] += 1
        deg[b] += 1
    d1 = sum(1 for v in deg.values() if v == 1)
    print(f"  Remaining degree-1 nodes: {d1}")

    # ─── Write topology_edges.bin (AFTER all filtering) ───────
    sorted_edges = sorted(all_edges_clean)
    buf = bytearray(len(sorted_edges) * 2 * 4)
    for i, (a, b) in enumerate(sorted_edges):
        struct.pack_into("ff", buf, i * 8, float(a), float(b))

    out_path = SPHERE_DIR / "topology_edges.bin"
    with open(out_path, "wb") as f:
        f.write(buf)
    print(f"  Written {out_path} ({len(buf)/1024/1024:.1f} MB)")

    # ─── Build road_network.json ──────────────────────────────
    road_network = []
    roads_by_edges = sorted(road_edges_raw.items(), key=lambda x: -len(x[1]))
    selected = set()
    for name in KNOWN_MAJOR:
        if name in road_edges_raw:
            selected.add(name)
    for name, _ in roads_by_edges:
        if len(selected) >= 120:
            break
        selected.add(name)

    for name in sorted(selected):
        raw = road_edges_raw[name]
        clean = raw & all_edges_clean
        if len(clean) < 3:
            continue

        points = set()
        for a, b in clean:
            points.add(a)
            points.add(b)

        is_major = name in KNOWN_MAJOR

        road_deg = defaultdict(int)
        for a, b in clean:
            road_deg[a] += 1
            road_deg[b] += 1
        label_idx = max(road_deg, key=road_deg.get)

        road_network.append({
            "name": name,
            "edges": [list(e) for e in sorted(clean)],
            "point_count": len(points),
            "is_major": is_major,
            "label_idx": label_idx,
        })

    road_network.sort(key=lambda r: (not r["is_major"], -len(r["edges"])))

    out_path = SPHERE_DIR / "road_network.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(road_network, f, ensure_ascii=False, separators=(",", ":"))

    major_count = sum(1 for r in road_network if r["is_major"])
    total_road_edges = sum(len(r["edges"]) for r in road_network)
    print(f"  {len(road_network)} roads ({major_count} major), {total_road_edges:,} road edges")
    print(f"  Written {out_path}")


# ---------------------------------------------------------------------------
# 2. City landmarks
# ---------------------------------------------------------------------------

def build_landmarks(lats, lons):
    print("[2/3] Building city_landmarks.json ...")

    landmarks = [
        {"name": "Ben Thanh Market", "name_vi": "Chợ Bến Thành", "lat": 10.7725, "lon": 106.6980, "type": "landmark"},
        {"name": "Notre-Dame Cathedral", "name_vi": "Nhà thờ Đức Bà", "lat": 10.7798, "lon": 106.6990, "type": "landmark"},
        {"name": "Central Post Office", "name_vi": "Bưu điện Trung tâm", "lat": 10.7800, "lon": 106.6997, "type": "landmark"},
        {"name": "Independence Palace", "name_vi": "Dinh Độc Lập", "lat": 10.7769, "lon": 106.6953, "type": "landmark"},
        {"name": "War Remnants Museum", "name_vi": "Bảo tàng Chứng tích Chiến tranh", "lat": 10.7794, "lon": 106.6922, "type": "landmark"},
        {"name": "Bitexco Financial Tower", "name_vi": "Tháp Tài chính Bitexco", "lat": 10.7717, "lon": 106.7042, "type": "landmark"},
        {"name": "Landmark 81", "name_vi": "Landmark 81", "lat": 10.7955, "lon": 106.7220, "type": "landmark"},
        {"name": "Jade Emperor Pagoda", "name_vi": "Chùa Ngọc Hoàng", "lat": 10.7901, "lon": 106.6861, "type": "landmark"},
        {"name": "Tân Sơn Nhất Airport", "name_vi": "Sân bay Tân Sơn Nhất", "lat": 10.8184, "lon": 106.6588, "type": "transport"},
        {"name": "Saigon Railway Station", "name_vi": "Ga Sài Gòn", "lat": 10.7828, "lon": 106.6786, "type": "transport"},
        {"name": "Nguyễn Huệ Walking Street", "name_vi": "Phố đi bộ Nguyễn Huệ", "lat": 10.7740, "lon": 106.7035, "type": "landmark"},
        {"name": "Saigon Zoo", "name_vi": "Thảo Cầm Viên", "lat": 10.7875, "lon": 106.7053, "type": "park"},
        {"name": "Tao Đàn Park", "name_vi": "Công viên Tao Đàn", "lat": 10.7753, "lon": 106.6928, "type": "park"},
        {"name": "23/9 Park", "name_vi": "Công viên 23 tháng 9", "lat": 10.7688, "lon": 106.6903, "type": "park"},
        {"name": "Thu Thiem Bridge", "name_vi": "Cầu Thủ Thiêm", "lat": 10.7862, "lon": 106.7163, "type": "transport"},
        {"name": "Phú Mỹ Bridge", "name_vi": "Cầu Phú Mỹ", "lat": 10.7287, "lon": 106.7420, "type": "transport"},
        {"name": "Chợ Lớn (Chinatown)", "name_vi": "Chợ Lớn", "lat": 10.7510, "lon": 106.6610, "type": "landmark"},
        {"name": "City Hall", "name_vi": "Ủy ban Nhân dân TP.HCM", "lat": 10.7764, "lon": 106.7009, "type": "landmark"},
        {"name": "Saigon Opera House", "name_vi": "Nhà hát Thành phố", "lat": 10.7765, "lon": 106.7032, "type": "landmark"},
        {"name": "Phú Mỹ Hưng", "name_vi": "Phú Mỹ Hưng", "lat": 10.7285, "lon": 106.7190, "type": "district"},
        {"name": "Thủ Đức Technology Hub", "name_vi": "Khu Công nghệ cao Thủ Đức", "lat": 10.8575, "lon": 106.7883, "type": "district"},
        {"name": "Bình Chánh", "name_vi": "Bình Chánh", "lat": 10.7400, "lon": 106.5950, "type": "district"},
        {"name": "Cần Giờ", "name_vi": "Cần Giờ", "lat": 10.4115, "lon": 106.9530, "type": "district"},
    ]

    result = []
    for lm in landmarks:
        dlat = lats - lm["lat"]
        dlon = lons - lm["lon"]
        dist2 = dlat ** 2 + (dlon * np.cos(np.radians(lm["lat"]))) ** 2
        nearest_idx = int(np.argmin(dist2))
        dist_m = float(np.sqrt(dist2[nearest_idx])) * 111320

        result.append({
            "name": lm["name"],
            "name_vi": lm["name_vi"],
            "lat": lm["lat"],
            "lon": lm["lon"],
            "type": lm["type"],
            "nearest_point_idx": nearest_idx,
            "distance_m": round(dist_m, 1),
        })

    out_path = SPHERE_DIR / "city_landmarks.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"  {len(result)} landmarks, written {out_path}")


# ---------------------------------------------------------------------------
# 3. District boundaries → sphere projection
# ---------------------------------------------------------------------------

def build_district_boundaries(tree, lats, lons):
    """Project HCMC district boundary polygons onto the sphere.

    For each polygon boundary coordinate, find the nearest sphere point.
    This maps geographic district outlines onto the perception sphere,
    maintaining alignment with road network and image points.
    """
    print("[3/3] Building district_boundaries.json ...")

    geojson_path = PROJECT_ROOT / "hochiminh_districts.geojson"
    if not geojson_path.exists():
        # Fallback: check in data dir
        geojson_path = DATA_DIR / "hochiminh_districts.geojson"
    if not geojson_path.exists():
        print("  WARNING: hochiminh_districts.geojson not found, skipping")
        return

    with open(geojson_path) as f:
        geojson = json.load(f)

    n_points = len(lats)
    districts = []

    for feat in geojson["features"]:
        props = feat["properties"]
        name = props.get("NAME_2", "")
        name_vn = props.get("NL_NAME_2") or props.get("VARNAME_2", name)
        district_type = props.get("TYPE_2", "")
        eng_type = props.get("ENGTYPE_2", "")

        geom = feat["geometry"]
        if geom["type"] == "Polygon":
            rings = geom["coordinates"]
        elif geom["type"] == "MultiPolygon":
            # Flatten: take all outer rings
            rings = [poly[0] for poly in geom["coordinates"]]
        else:
            continue

        # For each ring, snap boundary coords to sphere point indices
        boundary_rings = []
        for ring in rings:
            idx_seq = []
            for lon, lat_coord in ring:
                # Use larger snap threshold for boundaries (they may be
                # outside the densely-sampled area)
                query = [lat_coord * DEG_TO_M_LAT, lon * DEG_TO_M_LON]
                dist, idx = tree.query(query)
                # Use 500m threshold for district boundaries (much larger area)
                if dist < 500:
                    idx = int(idx)
                    # Deduplicate consecutive
                    if not idx_seq or idx_seq[-1] != idx:
                        idx_seq.append(idx)

            if len(idx_seq) >= 3:
                # Close the ring
                if idx_seq[0] != idx_seq[-1]:
                    idx_seq.append(idx_seq[0])
                boundary_rings.append(idx_seq)

        if not boundary_rings:
            continue

        # Find which sphere points are inside this district (geographic containment)
        # Use a simple point-in-polygon test on lat/lon
        member_indices = _points_in_polygon(lats, lons, rings[0])

        # Centroid point for label placement
        centroid_lat = np.mean([c[1] for c in rings[0]])
        centroid_lon = np.mean([c[0] for c in rings[0]])
        dlat = lats - centroid_lat
        dlon = lons - centroid_lon
        dist2 = dlat ** 2 + (dlon * np.cos(np.radians(centroid_lat))) ** 2
        centroid_idx = int(np.argmin(dist2))

        districts.append({
            "name": name,
            "name_vn": name_vn,
            "type": district_type,
            "eng_type": eng_type,
            "boundary_rings": boundary_rings,
            "member_count": len(member_indices),
            "centroid_idx": centroid_idx,
        })

    districts.sort(key=lambda d: d["name"])

    out_path = SPHERE_DIR / "district_boundaries.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(districts, f, ensure_ascii=False, separators=(",", ":"))

    total_boundary_pts = sum(
        sum(len(r) for r in d["boundary_rings"]) for d in districts
    )
    print(f"  {len(districts)} districts, {total_boundary_pts:,} boundary points")
    print(f"  Written {out_path}")


def _points_in_polygon(lats, lons, polygon_ring):
    """Simple ray-casting point-in-polygon for geographic coordinates.
    Returns list of point indices inside the polygon.
    """
    # polygon_ring: list of [lon, lat] pairs
    poly_x = np.array([c[0] for c in polygon_ring])
    poly_y = np.array([c[1] for c in polygon_ring])
    n_poly = len(poly_x)

    # Bounding box filter first
    min_x, max_x = poly_x.min(), poly_x.max()
    min_y, max_y = poly_y.min(), poly_y.max()

    candidates = np.where(
        (lons >= min_x) & (lons <= max_x) &
        (lats >= min_y) & (lats <= max_y)
    )[0]

    inside = []
    for idx in candidates:
        px, py = float(lons[idx]), float(lats[idx])
        crossings = 0
        for i in range(n_poly):
            j = (i + 1) % n_poly
            yi, yj = poly_y[i], poly_y[j]
            xi, xj = poly_x[i], poly_x[j]
            if (yi <= py < yj) or (yj <= py < yi):
                x_cross = xi + (py - yi) * (xj - xi) / (yj - yi)
                if px < x_cross:
                    crossings += 1
        if crossings % 2 == 1:
            inside.append(int(idx))

    return inside


# ---------------------------------------------------------------------------

def main():
    print("=== preprocess_topology.py ===")
    tree, coords, n, lats, lons = load_point_index()
    sphere_pos = load_sphere_positions()
    build_street_edges_and_roads(tree, sphere_pos)
    build_landmarks(lats, lons)
    build_district_boundaries(tree, lats, lons)
    print("Done.")


if __name__ == "__main__":
    main()
