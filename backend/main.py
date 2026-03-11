"""
HCMC Street View Tour Platform — FastAPI Backend

Serves pre-processed data, street view images, and LLM-powered insights.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from backend.data_store import load_data
from backend.services.analytics import compute_ranks
from backend.routers import streets, points, images, layers, city, insights, sphere

app = FastAPI(title="HCMC Street View Tour", version="2.0.0")

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(streets.router)
app.include_router(points.router)
app.include_router(images.router)
app.include_router(layers.router)
app.include_router(city.router)
app.include_router(insights.router)
app.include_router(sphere.router)


@app.on_event("startup")
async def startup():
    load_data()
    compute_ranks()
