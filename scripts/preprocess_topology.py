#!/usr/bin/env python3
"""
preprocess_topology.py — Generate topology data files for sphere road network overlay.

Outputs (into data/sphere/):
  - topology_edges.bin        Float32 pairs [idx_a, idx_b, ...] for all adjacency edges
  - road_network.json         Major roads with point indices for sphere rendering
  - city_landmarks.json       Important HCMC landmarks mapped to nearest sphere points
"""

import json
import struct
import re
import sys
from pathlib import Path
import numpy as np

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SPHERE_DIR = DATA_DIR / "sphere"

# ---------------------------------------------------------------------------
# 1. Build topology_edges.bin from adjacency_graph.json
# ---------------------------------------------------------------------------

def build_topology_edges():
    print("[1/3] Building topology_edges.bin ...")
    adj_path = SPHERE_DIR / "adjacency_graph.json"
    with open(adj_path) as f:
        adj = json.load(f)

    edges = set()
    for node_str, neighbors in adj.items():
        node = int(node_str)
        for nb in neighbors:
            a, b = min(node, nb), max(node, nb)
            edges.add((a, b))

    print(f"       {len(edges):,} undirected edges")

    # Write as flat Float32 pairs: [a0, b0, a1, b1, ...]
    buf = bytearray(len(edges) * 2 * 4)
    for i, (a, b) in enumerate(sorted(edges)):
        struct.pack_into("ff", buf, i * 8, float(a), float(b))

    out_path = SPHERE_DIR / "topology_edges.bin"
    with open(out_path, "wb") as f:
        f.write(buf)
    print(f"       Written {out_path} ({len(buf) / 1024 / 1024:.1f} MB)")
    return edges


# ---------------------------------------------------------------------------
# 2. Build road_network.json — major roads with their point indices on sphere
# ---------------------------------------------------------------------------

def build_road_network():
    print("[2/3] Building road_network.json ...")

    # Load point metadata to build id→idx lookup
    with open(SPHERE_DIR / "point_metadata.json") as f:
        point_meta = json.load(f)
    id_to_idx = {p["id"]: p["idx"] for p in point_meta}

    # Load streets data
    with open(DATA_DIR / "streets.json") as f:
        streets = json.load(f)

    # Known major road base names in HCMC
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

    # Aggregate street segments by base name (strip #N suffix)
    road_groups = {}
    for street_name, street_data in streets.items():
        base_name = re.sub(r"\s*#\d+$", "", street_name)
        if base_name not in road_groups:
            road_groups[base_name] = {
                "total_points": 0,
                "segments": [],
                "point_ids": [],
                "center_lats": [],
                "center_lons": [],
            }
        rg = road_groups[base_name]
        rg["total_points"] += street_data.get("total_points", 0)
        rg["center_lats"].append(street_data.get("center_lat", 0))
        rg["center_lons"].append(street_data.get("center_lon", 0))
        for seg in street_data.get("segments", []):
            for pid in seg.get("points", []):
                rg["point_ids"].append(pid)

    # Select major roads: known names + top by point count
    roads_by_points = sorted(road_groups.items(), key=lambda x: -x[1]["total_points"])
    selected_names = set()

    # Always include known major roads (if they exist in data)
    for name in KNOWN_MAJOR:
        if name in road_groups:
            selected_names.add(name)

    # Add top roads by point count (up to 120 total)
    for name, _ in roads_by_points:
        if len(selected_names) >= 120:
            break
        selected_names.add(name)

    # Build output
    road_network = []
    for name in sorted(selected_names):
        rg = road_groups[name]
        # Map point IDs to sphere indices
        point_indices = []
        for pid in rg["point_ids"]:
            idx = id_to_idx.get(pid)
            if idx is not None:
                point_indices.append(idx)

        if not point_indices:
            continue

        # Deduplicate while preserving order
        seen = set()
        unique_indices = []
        for idx in point_indices:
            if idx not in seen:
                seen.add(idx)
                unique_indices.append(idx)

        is_major = name in KNOWN_MAJOR
        center_lat = sum(rg["center_lats"]) / len(rg["center_lats"]) if rg["center_lats"] else 0
        center_lon = sum(rg["center_lons"]) / len(rg["center_lons"]) if rg["center_lons"] else 0

        road_network.append({
            "name": name,
            "point_indices": unique_indices,
            "is_major": is_major,
            "total_points": len(unique_indices),
            "center_lat": round(center_lat, 6),
            "center_lon": round(center_lon, 6),
        })

    # Sort: major roads first, then by point count
    road_network.sort(key=lambda r: (not r["is_major"], -r["total_points"]))

    out_path = SPHERE_DIR / "road_network.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(road_network, f, ensure_ascii=False, indent=None, separators=(",", ":"))
    major_count = sum(1 for r in road_network if r["is_major"])
    print(f"       {len(road_network)} roads ({major_count} major), written {out_path}")
    return road_network


# ---------------------------------------------------------------------------
# 3. Build city_landmarks.json — map landmarks to nearest sphere points
# ---------------------------------------------------------------------------

def build_landmarks():
    print("[3/3] Building city_landmarks.json ...")

    # Load point metadata for lat/lon
    with open(SPHERE_DIR / "point_metadata.json") as f:
        point_meta = json.load(f)

    lats = np.array([p["lat"] for p in point_meta], dtype=np.float64)
    lons = np.array([p["lon"] for p in point_meta], dtype=np.float64)

    # HCMC landmarks with known coordinates
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
        # Find nearest point by Haversine approximation (small area, Euclidean OK)
        dlat = lats - lm["lat"]
        dlon = lons - lm["lon"]
        dist2 = dlat ** 2 + (dlon * np.cos(np.radians(lm["lat"]))) ** 2
        nearest_idx = int(np.argmin(dist2))
        dist_m = float(np.sqrt(dist2[nearest_idx])) * 111320  # rough meters

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
    print(f"       {len(result)} landmarks, written {out_path}")
    return result


# ---------------------------------------------------------------------------

def main():
    print("=== preprocess_topology.py ===")
    build_topology_edges()
    build_road_network()
    build_landmarks()
    print("Done.")


if __name__ == "__main__":
    main()
