"""
preprocess_atlas.py — Generate mosaic texture atlas for LOD sphere rendering.

Takes 178,078 thumbnails (128px) and tiles them at 16x16px onto 4096x4096
atlas textures. Generates UV offset mapping for GPU shader consumption.

Output to data/sphere/atlas/:
  - atlas_0.jpg, atlas_1.jpg, atlas_2.jpg   ~4 MB each
  - atlas_uv_offsets.bin                     Float32 (N, 2) ~1.4 MB
  - atlas_index.bin                          Uint8 (N,)     ~174 KB
  - atlas_metadata.json                      Atlas config
"""

import json
import struct
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
from PIL import Image

# ─── Configuration ───────────────────────────────────────────────────────────

PROJECT_ROOT = Path("/data2/shared/haoxi/projects/ZenSVI")
SPHERE_DIR = PROJECT_ROOT / "HCMC_Tour" / "data" / "sphere"
THUMB_DIR = SPHERE_DIR / "thumbnails" / "128"
ATLAS_DIR = SPHERE_DIR / "atlas"

ATLAS_SIZE = 4096      # px per atlas dimension
TILE_PX = 16           # px per tile (each thumbnail downsampled to this)
TILE_PAD = 1           # px padding between tiles to prevent mipmap bleed
TILE_STEP = TILE_PX + TILE_PAD  # actual step per tile in atlas
TILES_PER_ROW = ATLAS_SIZE // TILE_STEP  # 240 tiles per row (4096/17)
TILES_PER_ATLAS = TILES_PER_ROW * TILES_PER_ROW  # 57,600 tiles per atlas
JPEG_QUALITY = 85

N_POINTS = 178078


def load_and_resize(idx):
    """Load thumbnail and resize to TILE_PX × TILE_PX."""
    path = THUMB_DIR / f"{idx:06d}.jpg"
    try:
        img = Image.open(path)
        img = img.resize((TILE_PX, TILE_PX), Image.LANCZOS)
        return idx, img
    except Exception as e:
        # Return a placeholder (dark gray tile)
        placeholder = Image.new('RGB', (TILE_PX, TILE_PX), (30, 28, 24))
        return idx, placeholder


def main():
    ATLAS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Atlas generation: {N_POINTS} thumbnails → {TILE_PX}×{TILE_PX} tiles")
    print(f"Atlas size: {ATLAS_SIZE}×{ATLAS_SIZE}, tiles/row: {TILES_PER_ROW}, tiles/atlas: {TILES_PER_ATLAS}")

    n_atlases = (N_POINTS + TILES_PER_ATLAS - 1) // TILES_PER_ATLAS
    print(f"Number of atlases: {n_atlases}")

    # Allocate UV offset and atlas index arrays
    uv_offsets = np.zeros((N_POINTS, 2), dtype=np.float32)
    atlas_indices = np.zeros(N_POINTS, dtype=np.uint8)

    # Tile UV size in normalized [0,1] coordinates
    tile_uv_size = TILE_PX / ATLAS_SIZE  # 16/4096 = 0.00390625
    tile_step_uv = TILE_STEP / ATLAS_SIZE  # 17/4096

    # Precompute UV offsets for each point
    for idx in range(N_POINTS):
        atlas_idx = idx // TILES_PER_ATLAS
        local_idx = idx % TILES_PER_ATLAS
        row = local_idx // TILES_PER_ROW
        col = local_idx % TILES_PER_ROW

        # UV offset: top-left corner of this tile in the atlas
        u = col * tile_step_uv
        v = row * tile_step_uv

        uv_offsets[idx] = [u, v]
        atlas_indices[idx] = atlas_idx

    # Process each atlas
    t0 = time.time()

    for atlas_idx in range(n_atlases):
        start_idx = atlas_idx * TILES_PER_ATLAS
        end_idx = min(start_idx + TILES_PER_ATLAS, N_POINTS)
        n_tiles = end_idx - start_idx

        print(f"\nAtlas {atlas_idx}: points {start_idx}–{end_idx - 1} ({n_tiles} tiles)")

        # Create atlas canvas
        atlas = Image.new('RGB', (ATLAS_SIZE, ATLAS_SIZE), (15, 13, 10))  # Match bg color

        # Load and place tiles with parallel I/O
        indices = list(range(start_idx, end_idx))
        placed = 0

        with ThreadPoolExecutor(max_workers=16) as executor:
            futures = {executor.submit(load_and_resize, idx): idx for idx in indices}

            for future in as_completed(futures):
                idx, tile = future.result()
                local_idx = idx % TILES_PER_ATLAS
                row = local_idx // TILES_PER_ROW
                col = local_idx % TILES_PER_ROW

                x = col * TILE_STEP
                y = row * TILE_STEP
                atlas.paste(tile, (x, y))

                placed += 1
                if placed % 10000 == 0:
                    elapsed = time.time() - t0
                    pct = (start_idx + placed) / N_POINTS * 100
                    print(f"  [{pct:.1f}%] Placed {placed}/{n_tiles} tiles ({elapsed:.1f}s)")

        # Save atlas JPEG
        atlas_path = ATLAS_DIR / f"atlas_{atlas_idx}.jpg"
        atlas.save(str(atlas_path), "JPEG", quality=JPEG_QUALITY)
        file_size = atlas_path.stat().st_size / 1024 / 1024
        print(f"  Saved {atlas_path.name} ({file_size:.1f} MB)")

    # Save UV offsets binary
    uv_path = ATLAS_DIR / "atlas_uv_offsets.bin"
    uv_offsets.tofile(str(uv_path))
    print(f"\nSaved atlas_uv_offsets.bin ({uv_path.stat().st_size / 1024:.0f} KB)")

    # Save atlas indices binary
    idx_path = ATLAS_DIR / "atlas_index.bin"
    atlas_indices.tofile(str(idx_path))
    print(f"Saved atlas_index.bin ({idx_path.stat().st_size / 1024:.0f} KB)")

    # Save metadata JSON
    metadata = {
        "atlas_size": ATLAS_SIZE,
        "tile_px": TILE_PX,
        "tile_pad": TILE_PAD,
        "tile_step": TILE_STEP,
        "tiles_per_row": TILES_PER_ROW,
        "tiles_per_atlas": TILES_PER_ATLAS,
        "n_atlases": n_atlases,
        "n_points": N_POINTS,
        "tile_uv_size": tile_uv_size,
        "tile_step_uv": tile_step_uv,
        "jpeg_quality": JPEG_QUALITY,
    }
    meta_path = ATLAS_DIR / "atlas_metadata.json"
    with open(meta_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved atlas_metadata.json")

    total_time = time.time() - t0
    print(f"\nDone in {total_time:.1f}s")


if __name__ == "__main__":
    main()
