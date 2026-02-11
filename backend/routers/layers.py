"""Map layer endpoints."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend.config import DATA_DIR, LAYERS_DIR
from backend.data_store import layer_manifest

router = APIRouter(prefix="/api", tags=["layers"])


@router.get("/layers")
async def list_layers():
    """List all available map layers."""
    return layer_manifest


@router.get("/layers/segmentation/{filename}")
async def get_segmentation_layer(filename: str):
    """Serve a segmentation hex map image."""
    path = LAYERS_DIR / "segmentation" / filename
    if not path.exists():
        raise HTTPException(404, "Layer not found")
    return FileResponse(path, media_type="image/png")


@router.get("/layers/streets-geojson")
async def get_streets_geojson():
    """Serve the streets GeoJSON for map rendering."""
    path = DATA_DIR / "streets_geojson.json"
    if not path.exists():
        raise HTTPException(404, "GeoJSON not found")
    return FileResponse(path, media_type="application/json")


@router.get("/layers/hex-grid")
async def get_hex_grid():
    """Serve the hex grid GeoJSON for thematic layers."""
    path = LAYERS_DIR / "hex_grid_slim.json"
    if not path.exists():
        raise HTTPException(404, "Hex grid not found")
    return FileResponse(path, media_type="application/json")
