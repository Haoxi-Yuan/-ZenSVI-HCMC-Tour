"""Image serving endpoints."""

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend.config import DATA_DIR, IMAGE_DIR

router = APIRouter(prefix="/api", tags=["images"])

_points_index: dict | None = None


def _get_points_index() -> dict:
    global _points_index
    if _points_index is None:
        with open(DATA_DIR / "points" / "points_index.json") as f:
            _points_index = {p["id"]: p["district"] for p in json.load(f)}
    return _points_index


@router.get("/images/{district}/{point_folder}/{image_name}")
async def get_image(district: str, point_folder: str, image_name: str):
    """Serve a street view image."""
    image_path = IMAGE_DIR / district / point_folder / image_name
    if not image_path.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(image_path, media_type="image/jpeg")


@router.get("/images/by-point/{point_id}")
async def get_images_by_point(point_id: str):
    """Get image URLs for a sampling point."""
    index = _get_points_index()
    district = index.get(point_id)
    if not district:
        raise HTTPException(404, f"Point '{point_id}' not found")

    district_path = IMAGE_DIR / district
    if not district_path.exists():
        raise HTTPException(404, "District not found")

    for point_dir in district_path.iterdir():
        if not point_dir.is_dir():
            continue
        if point_id in point_dir.name:
            images = sorted([
                f.name for f in point_dir.iterdir()
                if f.suffix == ".jpg" and f.name.startswith("lat")
            ])
            urls = [
                f"/api/images/{district}/{point_dir.name}/{img}"
                for img in images
            ]
            return {"point_id": point_id, "district": district, "images": urls}

    raise HTTPException(404, "Point folder not found")
