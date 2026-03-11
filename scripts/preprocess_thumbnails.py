"""
preprocess_thumbnails.py — Generate multi-resolution thumbnails and color blocks

Smart image selection: for each point's 4 heading images, uses per-image
semantic segmentation data to pick the one with the best "street-facing" score:
    street_score = road + sidewalk - wall * 2
High road+sidewalk = camera looks along the street direction.
High wall = camera faces a wall (penalized).

Output to data/sphere/:
  - thumbnails/128/{000000..178077}.jpg   ~2.5 GB total
  - color_blocks.bin                      uint8 (N, 3) ~534 KB
  - thumbnail_selection.json              which heading was chosen per point
"""

import csv
import json
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from PIL import Image

PROJECT_ROOT = Path("/data2/shared/haoxi/projects/ZenSVI")
IMAGE_DIR = PROJECT_ROOT / "gsv_streetlevel_full"
SEG_DIR = PROJECT_ROOT / "output" / "stage2_segmentation"
SPHERE_DIR = PROJECT_ROOT / "HCMC_Tour" / "data" / "sphere"
THUMB_DIR = SPHERE_DIR / "thumbnails" / "128"


def score_to_rgb(score, vmin=0.0, vmax=10.0):
    """Map a perception score to an RGB color.
    Low (orange #E8734A) -> Mid (gold #D4A855) -> High (green #3DBB78).
    """
    t = max(0.0, min(1.0, (score - vmin) / (vmax - vmin)))
    if t < 0.5:
        s = t / 0.5
        r = int(232 + (212 - 232) * s)
        g = int(115 + (168 - 115) * s)
        b = int(74 + (85 - 74) * s)
    else:
        s = (t - 0.5) / 0.5
        r = int(212 + (61 - 212) * s)
        g = int(168 + (187 - 168) * s)
        b = int(85 + (120 - 85) * s)
    return (r, g, b)


def compute_street_score(row):
    """Compute street-facing score from segmentation ratios.
    Higher = more likely looking along the street direction.
    """
    road = float(row.get("road", 0))
    sidewalk = float(row.get("sidewalk", 0))
    wall = float(row.get("wall", 0))
    # road + sidewalk = looking along street; wall = facing a wall
    return road + sidewalk - wall * 2


def load_segmentation_scores():
    """Load per-image segmentation and compute street-facing scores.
    Returns dict: filename_key -> street_score
    """
    print("  Loading per-image segmentation data for smart selection...")
    scores = {}
    district_dirs = sorted(SEG_DIR.iterdir())
    for ddir in district_dirs:
        csv_path = ddir / "pixel_ratios.csv"
        if not csv_path.exists():
            continue
        with open(csv_path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                fkey = row["filename_key"]
                scores[fkey] = compute_street_score(row)

    print(f"  Loaded segmentation for {len(scores)} images")
    return scores


def select_best_image(images, seg_scores):
    """Given a list of image Paths, select the one with highest street-facing score.
    Falls back to first image if no segmentation data found.
    """
    if len(images) <= 1:
        return images[0] if images else None

    best_img = images[0]
    best_score = -999

    for img_path in images:
        # Extract filename_key (without .jpg extension)
        fkey = img_path.stem
        score = seg_scores.get(fkey, -999)
        if score > best_score:
            best_score = score
            best_img = img_path

    return best_img


def generate_thumbnail(args):
    """Process a single point: generate 128px thumbnail. Returns (idx, success, chosen_heading)."""
    idx, district, folder, output_path, seg_scores = args
    src_dir = IMAGE_DIR / district / folder
    if not src_dir.exists():
        return (idx, False, "dir_missing", "")

    images = sorted(src_dir.glob("*.jpg"))
    if not images:
        return (idx, False, "no_images", "")

    try:
        best = select_best_image(images, seg_scores)
        img = Image.open(best)
        img = img.resize((128, 128), Image.LANCZOS)
        img.save(output_path, "JPEG", quality=75)
        # Extract heading from filename for logging
        m = re.search(r'head(\d+)', best.name)
        heading = m.group(1) if m else "?"
        return (idx, True, "", heading)
    except Exception as e:
        return (idx, False, str(e), "")


def main():
    start = time.time()
    print("=" * 60)
    print("PerceptionSphere Thumbnail Generation (Smart Selection)")
    print("=" * 60)

    # Load metadata
    print("\nLoading point metadata...")
    with open(SPHERE_DIR / "point_metadata.json") as f:
        metadata = json.load(f)
    N = len(metadata)
    print(f"  Points: {N}")

    # Load perception scores for color blocks
    print("Loading perception scores...")
    perception = np.load(SPHERE_DIR / "perception_scores.npy")
    safer_scores = perception[:, 0]

    # Load per-image segmentation for smart selection
    seg_scores = load_segmentation_scores()

    # Create output dir
    THUMB_DIR.mkdir(parents=True, exist_ok=True)

    # --- Phase 1: Color blocks (fast, single-threaded) ---
    print(f"\n[1/2] Generating color blocks for {N} points...")
    color_data = bytearray(N * 3)
    for i in range(N):
        r, g, b = score_to_rgb(safer_scores[i])
        color_data[i * 3] = r
        color_data[i * 3 + 1] = g
        color_data[i * 3 + 2] = b

    cb_path = SPHERE_DIR / "color_blocks.bin"
    with open(cb_path, "wb") as f:
        f.write(color_data)
    print(f"  Saved: color_blocks.bin ({cb_path.stat().st_size / 1e3:.1f} KB)")

    # --- Phase 2: 128px thumbnails (parallel, smart selection) ---
    print(f"\n[2/2] Generating 128px thumbnails with smart heading selection...")
    print(f"  Strategy: pick image with highest (road + sidewalk - wall*2)")
    print(f"  Source: {IMAGE_DIR}")
    print(f"  Output: {THUMB_DIR}")

    # Build task list — force regenerate all to apply smart selection
    tasks = []
    for i, pt in enumerate(metadata):
        output_path = THUMB_DIR / f"{i:06d}.jpg"
        district = pt.get("district", "")
        folder = pt.get("folder", "")
        if not district or not folder:
            continue
        tasks.append((i, district, folder, str(output_path), seg_scores))

    print(f"  Tasks: {len(tasks)} thumbnails to generate")

    if not tasks:
        print("  No tasks!")
        return

    success = 0
    failed = 0
    heading_counts = {}
    workers = 8
    t0 = time.time()

    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(generate_thumbnail, t): t[0] for t in tasks}
        for i, future in enumerate(as_completed(futures)):
            idx, ok, err, heading = future.result()
            if ok:
                success += 1
                heading_counts[heading] = heading_counts.get(heading, 0) + 1
            else:
                failed += 1

            # Progress every 5000
            done = i + 1
            if done % 5000 == 0 or done == len(tasks):
                elapsed = time.time() - t0
                rate = done / elapsed
                eta = (len(tasks) - done) / rate if rate > 0 else 0
                pct = 100 * done / len(tasks)
                bar = "#" * int(pct / 100 * 30) + "-" * (30 - int(pct / 100 * 30))
                print(f"  [{bar}] {done}/{len(tasks)} ({pct:.1f}%) | "
                      f"{rate:.0f} img/s | ETA: {eta:.0f}s | "
                      f"ok={success} fail={failed}", flush=True)

    print(f"\n  Thumbnails: {success} generated, {failed} failed")

    # Show heading distribution (verifies smart selection is diverse)
    print(f"\n  Selected heading distribution:")
    for h in sorted(heading_counts.keys(), key=lambda x: int(x) if x.isdigit() else 999):
        cnt = heading_counts[h]
        print(f"    head{h:>3s}: {cnt:>7d} ({100*cnt/success:.1f}%)")

    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"Done in {elapsed:.1f}s ({elapsed/60:.1f} min)")

    existing = len(list(THUMB_DIR.glob("*.jpg")))
    print(f"  Total thumbnails on disk: {existing}/{N}")


if __name__ == "__main__":
    main()