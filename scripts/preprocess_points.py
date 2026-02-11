"""
Preprocess image-level data into per-sampling-point JSON files.

Merges:
- Stage 2: Semantic segmentation pixel ratios
- Stage 3: Perception scores (6 dimensions)
- Stage 4: Object detection counts
- Image metadata (headings, district)

Output: data/points/{district}.json — one file per district, array of point objects.
Also: data/points_index.json — lightweight index of all points with coordinates.
"""

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

# Paths
PROJECT_ROOT = Path("/data2/shared/haoxi/projects/ZenSVI")
OUTPUT_ROOT = PROJECT_ROOT / "HCMC_Tour" / "data" / "points"
STAGE2_DIR = PROJECT_ROOT / "output" / "stage2_segmentation"
STAGE3_DIR = PROJECT_ROOT / "output" / "stage3_perception"
STAGE4_DIR = PROJECT_ROOT / "output" / "stage4_detection"
IMAGE_DIR = PROJECT_ROOT / "gsv_streetlevel_full"
CLEAN_IMAGES = PROJECT_ROOT / "output" / "clean_images.csv"

PERCEPTION_DIMS = ["safer", "livelier", "wealthier", "more_beautiful", "more_boring", "more_depressing"]
PERCEPTION_COLS = ["safer", "livelier", "wealthier", "more beautiful", "more boring", "more depressing"]

SEGMENTATION_CLASSES = [
    "road", "sidewalk", "building", "wall", "fence", "pole",
    "traffic sign", "vegetation", "terrain", "sky", "person",
    "rider", "car", "motorcycle", "bicycle", "bus", "traffic light", "truck", "train"
]

DETECTION_OBJECTS = ["motorbike", "tree", "car", "person"]

# District folder name mapping
DISTRICT_MAP = {
    "Bnh_Chnh": "Binh Chanh", "Bnh_Thnh": "Binh Thanh", "Bnh_Tn": "Binh Tan",
    "C_Chi": "Cu Chi", "Cn_Gi": "Can Gio", "G_Vp": "Go Vap",
    "Hc_Mn": "Hoc Mon", "Nh_B": "Nha Be", "Ph_Nhun": "Phu Nhuan",
    "Qun_1": "Quan 1", "Qun_10": "Quan 10", "Qun_11": "Quan 11",
    "Qun_12": "Quan 12", "Qun_2": "Quan 2", "Qun_3": "Quan 3",
    "Qun_4": "Quan 4", "Qun_5": "Quan 5", "Qun_6": "Quan 6",
    "Qun_7": "Quan 7", "Qun_8": "Quan 8", "Qun_9": "Quan 9",
    "Th_c": "Thu Duc", "Tn_Bnh": "Tan Binh", "Tn_Ph": "Tan Phu"
}


def parse_filename(filename_key):
    """Extract lat, lon, heading from filename_key."""
    m = re.match(r"lat([\d.]+)_lon([\d.]+)_head(\d+)_pitchp0_640x640", filename_key)
    if not m:
        return None
    return {
        "lat": float(m.group(1)),
        "lon": float(m.group(2)),
        "heading": int(m.group(3)),
    }


def point_id_from_filename(filename_key):
    """Extract point ID (lat_lon) from filename."""
    m = re.match(r"(lat[\d.]+_lon[\d.]+)_head", filename_key)
    return m.group(1) if m else None


def load_clean_images():
    """Load set of clean image filenames."""
    clean = set()
    with open(CLEAN_IMAGES) as f:
        reader = csv.DictReader(f)
        for row in reader:
            clean.add(row["filename"].strip())
    print(f"  Loaded {len(clean)} clean images")
    return clean


def load_segmentation(district_folder):
    """Load segmentation data for a district. Returns dict: filename_key -> {class: ratio}."""
    path = STAGE2_DIR / district_folder / "pixel_ratios.csv"
    if not path.exists():
        print(f"  WARNING: No segmentation data for {district_folder}")
        return {}
    data = {}
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            fk = row["filename_key"]
            seg = {}
            for cls in SEGMENTATION_CLASSES:
                val = row.get(cls, "0")
                try:
                    seg[cls] = round(float(val), 6)
                except (ValueError, TypeError):
                    seg[cls] = 0.0
            data[fk] = seg
    return data


def load_perception(district_folder):
    """Load all 6 perception dimensions. Returns dict: filename_key -> {dim: score}."""
    data = defaultdict(dict)
    for dim_folder, col_name in zip(PERCEPTION_DIMS, PERCEPTION_COLS):
        path = STAGE3_DIR / district_folder / dim_folder / "results.csv"
        if not path.exists():
            print(f"  WARNING: No perception data for {district_folder}/{dim_folder}")
            continue
        with open(path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                fk = row["filename_key"]
                try:
                    data[fk][dim_folder] = round(float(row[col_name]), 4)
                except (ValueError, KeyError, TypeError):
                    pass
    return dict(data)


def load_detection(district_folder):
    """Load object detection counts. Returns dict: filename_key -> {object: count}."""
    path = STAGE4_DIR / district_folder / "detection_summary.csv"
    if not path.exists():
        print(f"  WARNING: No detection data for {district_folder}")
        return {}
    data = defaultdict(lambda: {obj: 0 for obj in DETECTION_OBJECTS})
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            fk = row["filename_key"]
            obj = row["object"].strip()
            try:
                count = int(row["count"])
            except (ValueError, TypeError):
                count = 0
            if obj in DETECTION_OBJECTS:
                data[fk][obj] = count
    return dict(data)


def discover_points(district_folder):
    """Discover all sampling points and their images from filesystem."""
    district_path = IMAGE_DIR / district_folder
    if not district_path.exists():
        return {}

    points = {}
    for point_dir in sorted(district_path.iterdir()):
        if not point_dir.is_dir():
            continue
        # Extract point_id from folder name: pt_XXXX_lat{lat}_lon{lon}
        m = re.match(r"pt_\d+_(lat[\d.]+_lon[\d.]+)", point_dir.name)
        if not m:
            continue
        point_id = m.group(1)
        images = sorted([
            f.name for f in point_dir.iterdir()
            if f.suffix == ".jpg" and f.name.startswith("lat")
        ])
        if images:
            parsed = parse_filename(images[0])
            if parsed:
                points[point_id] = {
                    "lat": parsed["lat"],
                    "lon": parsed["lon"],
                    "folder": point_dir.name,
                    "images": images,
                }
    return points


def process_district(district_folder, clean_images):
    """Process a single district: merge all data sources into point objects."""
    print(f"\nProcessing {district_folder} ({DISTRICT_MAP.get(district_folder, district_folder)})...")

    # Load all data sources
    seg_data = load_segmentation(district_folder)
    print(f"  Segmentation: {len(seg_data)} images")

    perc_data = load_perception(district_folder)
    print(f"  Perception: {len(perc_data)} images")

    det_data = load_detection(district_folder)
    print(f"  Detection: {len(det_data)} images")

    points = discover_points(district_folder)
    print(f"  Points from filesystem: {len(points)}")

    # Build point objects
    result = []
    for point_id, point_info in points.items():
        # Check if any images passed cleaning
        clean_count = sum(1 for img in point_info["images"]
                         if img.replace(".jpg", "") in clean_images)
        if clean_count == 0:
            continue

        # Aggregate image-level data to point level (mean across headings)
        seg_agg = defaultdict(list)
        perc_agg = defaultdict(list)
        det_agg = defaultdict(list)

        for img_name in point_info["images"]:
            fk = img_name.replace(".jpg", "")
            if fk not in clean_images:
                continue

            if fk in seg_data:
                for cls, val in seg_data[fk].items():
                    seg_agg[cls].append(val)

            if fk in perc_data:
                for dim, val in perc_data[fk].items():
                    perc_agg[dim].append(val)

            if fk in det_data:
                for obj, count in det_data[fk].items():
                    det_agg[obj].append(count)

        # Compute means
        segmentation = {cls: round(sum(vals) / len(vals), 6) if vals else 0.0
                        for cls, vals in seg_agg.items()}
        perception = {dim: round(sum(vals) / len(vals), 4) if vals else 0.0
                      for dim, vals in perc_agg.items()}
        detection = {obj: round(sum(vals) / len(vals), 2) if vals else 0.0
                     for obj, vals in det_agg.items()}

        # Ensure all expected keys exist
        for cls in SEGMENTATION_CLASSES:
            segmentation.setdefault(cls, 0.0)
        for dim in PERCEPTION_DIMS:
            perception.setdefault(dim, 0.0)
        for obj in DETECTION_OBJECTS:
            detection.setdefault(obj, 0.0)

        point_obj = {
            "id": point_id,
            "lat": point_info["lat"],
            "lon": point_info["lon"],
            "district": district_folder,
            "district_name": DISTRICT_MAP.get(district_folder, district_folder),
            "folder": point_info["folder"],
            "images": point_info["images"],
            "segmentation": segmentation,
            "perception": perception,
            "detection": detection,
        }
        result.append(point_obj)

    print(f"  Result: {len(result)} valid points")
    return result


def main():
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

    print("Loading clean images list...")
    clean_images = load_clean_images()

    districts = sorted([d.name for d in STAGE2_DIR.iterdir() if d.is_dir()])
    print(f"Found {len(districts)} districts")

    all_points_index = []
    total_points = 0

    for district_folder in districts:
        points = process_district(district_folder, clean_images)
        total_points += len(points)

        # Save per-district JSON
        out_path = OUTPUT_ROOT / f"{district_folder}.json"
        with open(out_path, "w") as f:
            json.dump(points, f, separators=(",", ":"))
        print(f"  Saved {out_path.name} ({len(points)} points, {out_path.stat().st_size / 1024 / 1024:.1f} MB)")

        # Build index entries
        for p in points:
            all_points_index.append({
                "id": p["id"],
                "lat": p["lat"],
                "lon": p["lon"],
                "district": p["district"],
            })

    # Save global index
    index_path = OUTPUT_ROOT / "points_index.json"
    with open(index_path, "w") as f:
        json.dump(all_points_index, f, separators=(",", ":"))
    print(f"\nTotal: {total_points} points across {len(districts)} districts")
    print(f"Index saved: {index_path} ({index_path.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
