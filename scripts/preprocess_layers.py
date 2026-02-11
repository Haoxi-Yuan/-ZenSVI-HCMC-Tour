"""
Preprocess map layer data for the mini-map layer switcher.

Copies/converts:
- 19 semantic segmentation hex maps (PNG) -> layers/segmentation/
- Walkability hex grid (GeoJSON) -> layers/walkability_hex.json (with score fields)
- Building height info -> already in streets data, skip
- LST/NDVI: reference paths for backend to serve

Output:
- data/layers/layer_manifest.json — registry of all available layers
- data/layers/segmentation/*.png — copied hex maps
"""

import json
import shutil
from pathlib import Path

PROJECT_ROOT = Path("/data2/shared/haoxi/projects/ZenSVI")
OUTPUT_DIR = PROJECT_ROOT / "HCMC_Tour" / "data" / "layers"
VIS_SEG_DIR = PROJECT_ROOT / "output" / "vis_segmentation"
HEX_GEOJSON = PROJECT_ROOT / "output" / "hexagon_grid.geojson"
HEX_GPKG = PROJECT_ROOT / "output" / "walkability_results" / "walkability_hexgrid.gpkg"

SEGMENTATION_CLASSES = [
    "road", "sidewalk", "building", "wall", "fence", "pole",
    "traffic_light", "traffic_sign", "vegetation", "terrain", "sky",
    "person", "rider", "car", "motorcycle", "bicycle", "bus", "truck", "train"
]


def copy_segmentation_maps():
    """Copy hex segmentation maps to layers directory."""
    seg_dir = OUTPUT_DIR / "segmentation"
    seg_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    for png in sorted(VIS_SEG_DIR.glob("hexmap_*_dark.png")):
        dest = seg_dir / png.name
        shutil.copy2(png, dest)
        copied += 1
    print(f"Copied {copied} segmentation hex maps")
    return copied


def process_hex_grid():
    """Extract hex grid data from GPKG (geometry + scores) or fallback to old GeoJSON."""
    import sqlite3
    import struct

    HEX_FIELDS = [
        # All 19 segmentation classes
        "road", "sidewalk", "building", "wall", "fence", "pole",
        "traffic light", "traffic sign", "vegetation", "terrain", "sky",
        "person_x", "rider", "car_x", "motorcycle", "bicycle", "bus", "truck", "train",
        # Walkability + environment scores
        "walkability_score", "safety_score", "accessibility_score", "comfort_score",
        "lst_avg", "avg_building_height",
    ]
    # Rename fields for frontend consistency
    RENAME = {"car_x": "car", "person_x": "person", "traffic light": "traffic_light", "traffic sign": "traffic_sign"}

    def parse_gpkg_polygon(blob):
        """Parse GeoPackage geometry blob to GeoJSON polygon coordinates."""
        if blob is None or len(blob) < 8:
            return None
        magic = blob[0:2]
        if magic != b"GP":
            return None
        flags = blob[3]
        envelope_type = (flags >> 1) & 0x07
        byte_order = blob[2]
        envelope_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
        env_size = envelope_sizes.get(envelope_type, 0)
        header_size = 8 + env_size
        wkb = blob[header_size:]
        if len(wkb) < 9:
            return None
        wkb_order = "<" if wkb[0] == 1 else ">"
        geom_type = struct.unpack(wkb_order + "I", wkb[1:5])[0]
        if geom_type != 3:  # Not a Polygon
            return None
        num_rings = struct.unpack(wkb_order + "I", wkb[5:9])[0]
        rings = []
        offset = 9
        for _ in range(num_rings):
            if offset + 4 > len(wkb):
                break
            num_points = struct.unpack(wkb_order + "I", wkb[offset:offset + 4])[0]
            offset += 4
            ring = []
            for _ in range(num_points):
                if offset + 16 > len(wkb):
                    break
                x, y = struct.unpack(wkb_order + "dd", wkb[offset:offset + 16])
                ring.append([round(x, 6), round(y, 6)])
                offset += 16
            rings.append(ring)
        return rings if rings else None

    if HEX_GPKG.exists():
        print("Processing hex grid from GPKG...")
        conn = sqlite3.connect(str(HEX_GPKG))
        cur = conn.cursor()
        cols_sql = ", ".join(f'"{f}"' for f in HEX_FIELDS)
        cur.execute(f"SELECT geom, {cols_sql} FROM walkability_hexgrid")
        slim_features = []
        for row in cur.fetchall():
            geom_blob = row[0]
            rings = parse_gpkg_polygon(geom_blob)
            if not rings:
                continue
            props = {}
            for i, field in enumerate(HEX_FIELDS):
                val = row[i + 1]
                key = RENAME.get(field, field)
                props[key] = round(float(val), 4) if val else 0
            slim_features.append({
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "Polygon", "coordinates": rings},
            })
        conn.close()
    elif HEX_GEOJSON.exists():
        print("Processing hex grid from old GeoJSON (fallback)...")
        with open(HEX_GEOJSON) as f:
            data = json.load(f)
        slim_features = []
        for feat in data.get("features", []):
            props = feat.get("properties", {})
            slim_props = {}
            for cls in ["road", "sidewalk", "building", "vegetation", "sky", "car", "motorcycle", "person"]:
                if cls in props:
                    slim_props[cls] = round(float(props[cls]), 4) if props[cls] else 0
            slim_features.append({
                "type": "Feature",
                "properties": slim_props,
                "geometry": feat["geometry"],
            })
    else:
        print("WARNING: no hex grid data found, skipping")
        return False

    slim_geojson = {"type": "FeatureCollection", "features": slim_features}
    out_path = OUTPUT_DIR / "hex_grid_slim.json"
    with open(out_path, "w") as f:
        json.dump(slim_geojson, f, separators=(",", ":"))
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"Saved hex_grid_slim.json ({size_mb:.1f} MB, {len(slim_features)} hexagons)")
    return True


def build_manifest():
    """Build layer manifest describing all available layers."""
    layers = []

    # Segmentation image overlays
    seg_dir = OUTPUT_DIR / "segmentation"
    for cls in SEGMENTATION_CLASSES:
        png_name = f"hexmap_{cls}_dark.png"
        if (seg_dir / png_name).exists():
            layers.append({
                "id": f"seg_{cls}",
                "name": cls.replace("_", " ").title(),
                "category": "Semantic Segmentation",
                "type": "image_overlay",
                "path": f"/api/layers/segmentation/{png_name}",
            })

    # Walkability score layers (vector from streets_geojson.json)
    for dim in ["walkability", "safety", "accessibility", "comfort"]:
        layers.append({
            "id": f"walk_{dim}",
            "name": dim.title() + " Score",
            "category": "Walkability",
            "type": "street_color",
            "field": dim,
        })

    # Environmental layers
    layers.append({
        "id": "lst",
        "name": "Land Surface Temperature",
        "category": "Environment",
        "type": "raster",
        "path": "/api/layers/lst",
    })
    layers.append({
        "id": "ndvi",
        "name": "NDVI Vegetation Index",
        "category": "Environment",
        "type": "raster",
        "path": "/api/layers/ndvi",
    })
    layers.append({
        "id": "building_height",
        "name": "Building Height",
        "category": "Environment",
        "type": "raster",
        "path": "/api/layers/building_height",
    })

    manifest = {"layers": layers}
    manifest_path = OUTPUT_DIR / "layer_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Saved layer_manifest.json ({len(layers)} layers)")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    copy_segmentation_maps()
    process_hex_grid()
    build_manifest()

    print("\nDone!")


if __name__ == "__main__":
    main()
