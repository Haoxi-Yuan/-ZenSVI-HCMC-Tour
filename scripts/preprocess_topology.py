#!/usr/bin/env python3
"""
preprocess_topology.py — Generate road network topology for sphere overlay.

Uses streets_geojson.json LineStrings (real OSM road geometry) to build
proper street-level edges, NOT the embedding-based adjacency graph.

Outputs (into data/sphere/):
  - topology_edges.bin     Float32 pairs [idx_a, idx_b, ...] — all street edges
  - road_network.json      Major roads with ordered edge pairs
  - city_landmarks.json    HCMC landmarks mapped to nearest sphere points
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

# Max distance (meters) to snap a GeoJSON coordinate to a sphere point
SNAP_THRESHOLD_M = 50
# Approximate meters per degree at HCMC latitude (~10.8°N)
DEG_TO_M_LAT = 111_320
DEG_TO_M_LON = 111_320 * np.cos(np.radians(10.8))


def load_point_index():
    """Build KD-tree from point_metadata for fast coord→idx lookup."""
    print("  Loading point_metadata ...")
    with open(SPHERE_DIR / "point_metadata.json") as f:
        meta = json.load(f)

    n = len(meta)
    coords = np.empty((n, 2), dtype=np.float64)
    for p in meta:
        i = p["idx"]
        # Store as (lat_m, lon_m) in meters for distance thresholding
        coords[i, 0] = p["lat"] * DEG_TO_M_LAT
        coords[i, 1] = p["lon"] * DEG_TO_M_LON

    tree = cKDTree(coords)
    print(f"  KD-tree built: {n:,} points")
    return tree, coords, n


def snap_coord_to_idx(tree, lon, lat):
    """Snap a (lon, lat) coordinate to the nearest point index. Returns -1 if too far."""
    query = [lat * DEG_TO_M_LAT, lon * DEG_TO_M_LON]
    dist, idx = tree.query(query)
    if dist > SNAP_THRESHOLD_M:
        return -1
    return int(idx)


# ---------------------------------------------------------------------------
# 1 + 2. Build all street edges + road_network.json from GeoJSON LineStrings
# ---------------------------------------------------------------------------

def build_street_edges_and_roads(tree):
    print("[1/2] Building street edges from GeoJSON LineStrings ...")

    with open(DATA_DIR / "streets_geojson.json") as f:
        geojson = json.load(f)

    features = geojson["features"]
    print(f"  {len(features):,} LineString features")

    # Known major road base names
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

    # Collect edges per road name + all edges globally
    all_edges = set()
    road_edges = defaultdict(set)       # base_name → set of (a, b) edge tuples
    road_points = defaultdict(set)      # base_name → set of point indices
    snapped = 0
    missed = 0

    for feat in features:
        coords = feat.get("geometry", {}).get("coordinates", [])
        name = feat.get("properties", {}).get("name", "")
        base_name = re.sub(r"\s*#\d+$", "", name) if name else ""

        if len(coords) < 2:
            continue

        # Snap each coordinate to nearest point index
        idx_seq = []
        for lon, lat in coords:
            idx = snap_coord_to_idx(tree, lon, lat)
            if idx >= 0:
                snapped += 1
                # Deduplicate consecutive same-index
                if not idx_seq or idx_seq[-1] != idx:
                    idx_seq.append(idx)
            else:
                missed += 1

        # Build edges from consecutive pairs
        for i in range(len(idx_seq) - 1):
            a, b = idx_seq[i], idx_seq[i + 1]
            if a == b:
                continue
            edge = (min(a, b), max(a, b))
            all_edges.add(edge)
            if base_name:
                road_edges[base_name].add(edge)
                road_points[base_name].add(a)
                road_points[base_name].add(b)

    total_snap = snapped + missed
    print(f"  Snapped: {snapped:,}/{total_snap:,} ({100*snapped/total_snap:.1f}%)")
    print(f"  Total unique street edges: {len(all_edges):,}")

    # ─── Write topology_edges.bin (ALL street edges) ─────────
    sorted_edges = sorted(all_edges)
    buf = bytearray(len(sorted_edges) * 2 * 4)
    for i, (a, b) in enumerate(sorted_edges):
        struct.pack_into("ff", buf, i * 8, float(a), float(b))

    out_path = SPHERE_DIR / "topology_edges.bin"
    with open(out_path, "wb") as f:
        f.write(buf)
    print(f"  Written {out_path} ({len(buf)/1024/1024:.1f} MB)")

    # ─── Build road_network.json ─────────────────────────────
    # Select major roads + top by edge count
    roads_by_edges = sorted(road_edges.items(), key=lambda x: -len(x[1]))
    selected = set()
    for name in KNOWN_MAJOR:
        if name in road_edges:
            selected.add(name)
    for name, _ in roads_by_edges:
        if len(selected) >= 120:
            break
        selected.add(name)

    road_network = []
    for name in sorted(selected):
        edges = road_edges[name]
        points = road_points[name]
        if len(edges) < 2:
            continue

        is_major = name in KNOWN_MAJOR

        # Pick label anchor: median point by index (rough center of road on sphere)
        sorted_pts = sorted(points)
        label_idx = sorted_pts[len(sorted_pts) // 2]

        road_network.append({
            "name": name,
            "edges": [list(e) for e in sorted(edges)],
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
# 3. City landmarks
# ---------------------------------------------------------------------------

def build_landmarks():
    print("[2/2] Building city_landmarks.json ...")

    with open(SPHERE_DIR / "point_metadata.json") as f:
        point_meta = json.load(f)

    lats = np.array([p["lat"] for p in point_meta], dtype=np.float64)
    lons = np.array([p["lon"] for p in point_meta], dtype=np.float64)

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

def main():
    print("=== preprocess_topology.py ===")
    tree, coords, n = load_point_index()
    build_street_edges_and_roads(tree)
    build_landmarks()
    print("Done.")


if __name__ == "__main__":
    main()
