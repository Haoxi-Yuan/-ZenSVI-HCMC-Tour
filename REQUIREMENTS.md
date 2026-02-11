# HCMC Street View Virtual Tour Platform — Requirements Specification

> Project: **Buoc Chan Sai Gon** (Walking Ho Chi Minh City)
> Created: 2026-02-10
> Status: Approved

---

## 1. Platform Overview

| Property | Value |
|----------|-------|
| Type | Public exhibition platform |
| Authentication | None (no login/register) |
| Max concurrent users | 50 |
| Primary language | English (Vietnamese for decorative place names only) |
| Emoji usage | Strictly prohibited across entire platform |

### Visual Identity (inherited from walkability.html)

- **Color palette**: Dark warm tones
  - `--bg-deep: #0F0D0A` (base background)
  - `--bg-warm: #1A1714`
  - `--bg-card: #242019`
  - `--text-primary: #F5F0E8`
  - `--text-secondary: #A89F91`
  - `--text-muted: #6B6358`
  - `--accent-green: #3DBB78` (walkable / positive)
  - `--accent-orange: #E8734A` (unwalkable / negative)
  - `--accent-gold: #D4A855` (moderate / highlight)
- **Typography**: Be Vietnam Pro (body) + Playfair Display (headings)
- **Border radius**: 0 everywhere (sharp edges only)
- **UI style**: Minimalist, data-dense, editorial feel

---

## 2. Data Foundation

### Source Data (from ZenSVI Pipeline)

| Data | Path | Scale |
|------|------|-------|
| Raw street view images | `gsv_streetlevel_full/{district}/{point_folder}/` | ~1.07M images, 91GB |
| Image format | 640x640 JPG, ~88KB each | 4 per sampling point (90deg intervals) |
| Point metadata | `metadata.json` in each point folder | lat, lon, panorama_id, date |
| Clean image list | `output/clean_images.csv` | Filtered image filenames |
| Semantic segmentation | `output/stage2_segmentation/{district}/pixel_ratios.csv` | 19 Cityscapes classes, pixel ratios |
| Perception scores | `output/stage3_perception/{district}/{dim}/results.csv` | 6 dimensions, 0-10 scale |
| Object detection | `output/stage4_detection/{district}/detection_summary_grouped.csv` | 4 object types (motorbike, tree, car, person) |
| Depth maps | `output/stage5_depth/{district}/depth_maps/*.tiff` | 32-bit float TIFF |
| Walkability (street) | `output/walkability_results/walkability_streets.csv` | 141,812 segments, 88,264 named |
| Walkability (street geo) | `output/walkability_results/walkability_streets.gpkg` | LineString geometries |
| Segmentation hex maps | `output/vis_segmentation/hexmap_*_dark.png` | 19 PNG maps |
| LST rasters | `output/tempe/FINAL_CLIPED_LST&NVDI/` | DRY SEASON.tif, RAINY SEASON.tif |
| NDVI raster | `output/tempe/FINAL_CLIPED_LST&NVDI/NVDI.tif` | Float32 GeoTIFF |
| Building height | `output/Build_Height/build_H_simplify.geojson` | 2.87M features |
| Hexagon grid | `output/hexagon_grid.geojson` | H3 resolution 8 |

### Key Data Characteristics

- **Filename encodes coordinates**: `lat{lat}_lon{lon}_head{heading}_pitchp0_640x640`
- **Headings**: 4 directions per point, separated by ~90deg
- **Street ID format**: `{osm_node_u}_{osm_node_v}` (e.g., `10001038052.0_10001038054.0`)
- **Street names**: 13,569 unique names, median 2 segments per name, max 486 segments
- **District folder naming**: URL-encoded Vietnamese (e.g., `Qun_1` = Quan 1)

---

## 3. Page Structure

### 3.1 Landing Page (Home)

Reference design: `walkability.html` — same section structure, all data replaced with real values.

| Section | Content |
|---------|---------|
| Hero | Title "Walking Sai Gon" + Vietnamese subtitle + description + CTA to explore |
| Data Impact | Real statistics: 24 districts, 267K sampling points, 1.07M images, etc. |
| Interactive Map | Full-screen Mapbox map with walkability-colored streets, entry point to tour |
| Street Comparison | Real street comparisons using actual walkability data |
| Key Findings | Insights derived from actual analysis results |
| Footer | Project info, methodology links, institutional logos |

### 3.2 Map View (Tour Entry)

- Full city map showing all named streets colored by `walkability_score` (orange -> gold -> green)
- **Enter tour via**:
  - Click a highlighted street on map
  - Search box with street name autocomplete
- **Mini-map layer switcher** (all available as toggleable layers):
  - 19 semantic segmentation hex maps (road, building, vegetation, car, person, etc.)
  - Walkability score heatmaps (safety, accessibility, comfort, overall)
  - Land Surface Temperature (LST)
  - NDVI vegetation index
  - Building height

### 3.3 Street View Tour Mode

**Layout**: Street view fullscreen + floating collapsible sidebar (Dashboard) + mini-map (bottom-right)

#### Panoramic Viewer
- Three.js sphere with 4 images mapped as equirectangular-style panorama
- Images are edge-aligned and continuous (no visible seams)
- Mouse drag to look around, scroll to zoom

#### Navigation
- Ground-level arrows to advance to next sampling point (Google Maps style)
- Mini-map click to jump to any point on current street
- Street unit = complete named street (concatenate all segments with same name)
- Also support: user clicks any point on map to start free routing along road network

#### Dashboard (Floating Sidebar)

Updates in real-time as user advances through sampling points:

| Module | Visualization | Data Source |
|--------|--------------|-------------|
| Perception (6D) | Radar chart + sparkline, previous point faded overlay on radar | Stage 3: safer, livelier, wealthier, more beautiful, more boring, more depressing |
| Walkability (3D) | Radar chart (safety / accessibility / comfort) | Pre-computed from walkability formulas |
| Semantic Segmentation (19 classes) | Treemap (proportional area) | Stage 2: pixel_ratios |
| Object Detection | Progress bars (no border-radius) | Stage 4: motorbike, tree, car, person counts |
| Temperature (LST) | Progress bar (no border-radius) | lst_dry, lst_rainy, lst_avg |
| Building Height | Progress bar (no border-radius) | avg_building_height |

### 3.4 Tour Summary (End of Street)

Displayed when user reaches end of street or manually ends tour:

| Component | Description |
|-----------|-------------|
| Walkability radar chart | 3 axes (safety, accessibility, comfort) + overall score display |
| Perception radar chart | 6 axes, showing street average |
| Sparkline overview | Full-journey line chart of all indicators over sampling points |
| City-level scatter plots | One per dimension: all streets as dots, current street highlighted |

---

## 4. Walkability Score Formulas (Pre-computed)

### Safety Score (0-10)
```
safety_score = 10 * (0.5 * S_perc + 0.3 * (1 - S_expo) + 0.2 * S_ctrl)

S_perc = safer / 10.0                                    (clipped [0,1])
S_expo = normalize(log(1 + motorbike + car) / (road + e)) (min-max [0,1])
S_ctrl = (I[traffic_light > 0] + I[traffic_sign > 0]) / 2
```

### Accessibility Score (0-10)
```
accessibility_score = 10 * (0.6 * normalize(A_side) + 0.4 * (1 - A_encr))

A_side = sidewalk / (sidewalk + road + e)
A_encr = normalize((motorcycle + car) / (sidewalk + e))   (min-max [0,1])
```

### Comfort Score (0-10)
```
comfort_score = 10 * (0.25*C_gvi + 0.25*C_vis + 0.15*C_svf + 0.20*C_thermal + 0.15*C_shade)

C_gvi = normalize(0.5 * normalize(tree_count) + 0.5 * vegetation_ratio)
C_vis = (beautiful + (10 - boring) + (10 - depressing)) / 30  (clipped [0,1])
C_svf = sky_ratio
C_thermal = 1 - normalize(lst_avg)
C_shade = normalize(avg_building_height)
```

### Overall
```
walkability_score = (safety_score + accessibility_score + comfort_score) / 3
```

---

## 5. Data Architecture

### Principle
- **All heavy computation is pre-processed** — backend serves pre-computed results
- **Real-time computation** only for user interaction state (viewport, panel toggle, etc.)
- **No traditional database** — static JSON/GeoJSON files suffice for 50 concurrent users

### Pre-processing Pipeline (to be built)

**Step 1**: Merge all image-level data into unified per-point JSON
- Input: segmentation CSVs + perception CSVs + detection CSVs + metadata
- Output: `data/points/{district}.json` — array of point objects:
```json
{
  "id": "lat10.792615_lon106.697350",
  "lat": 10.792615,
  "lon": 106.697350,
  "district": "Quan_1",
  "images": [
    "lat10.792615_lon106.697350_head009_pitchp0_640x640.jpg",
    "lat10.792615_lon106.697350_head099_pitchp0_640x640.jpg",
    "lat10.792615_lon106.697350_head189_pitchp0_640x640.jpg",
    "lat10.792615_lon106.697350_head279_pitchp0_640x640.jpg"
  ],
  "segmentation": { "road": 0.404, "building": 0.005, ... },
  "perception": { "safer": 6.23, "livelier": 4.89, ... },
  "detection": { "motorbike": 5, "tree": 12, "car": 3, "person": 8 },
  "walkability": { "safety_score": 7.2, "accessibility_score": 5.5, "comfort_score": 4.1, "walkability_score": 5.6 },
  "lst_avg": 38.5,
  "avg_building_height": 12.3
}
```

**Step 2**: Build street index JSON
- Input: `walkability_streets.csv` + GeoPackage geometry
- Output: `data/streets.json` — street name -> array of ordered segments with geometry:
```json
{
  "Nguyen Hue": {
    "segments": [ { "id": "...", "geometry": [...], "points": ["lat10.77_lon106.70", ...] } ],
    "stats": { "walkability_score": 5.99, "safety_score": 8.01, ... }
  }
}
```

**Step 3**: Convert layer maps to web-friendly tiles or static overlays
- Segmentation hex maps: serve as image overlays
- LST/NDVI: pre-render as PNG overlays or vector tiles

### Image Serving
- Backend reads directly from filesystem: `gsv_streetlevel_full/{district}/{point_folder}/{image}.jpg`
- API endpoint: `GET /api/images/{district}/{point_id}/{heading}`
- No tiling needed (640x640, ~88KB per image, ~350KB for full panorama)

---

## 6. Technical Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend framework | React (Vite) | Component-based, rich ecosystem |
| Panorama viewer | Three.js | Sphere geometry + texture mapping for 360 view |
| Map | Mapbox GL JS | Already used in reference design, vector tiles, flyTo, layers |
| Charts | D3.js | Full control for radar, treemap, sparkline, scatter |
| Backend | FastAPI (Python) | Reuse existing Python data ecosystem, async, fast |
| Data format | Static JSON + GeoJSON | No DB needed for 50 users |
| Image serving | FastAPI static files / FileResponse | Direct filesystem access |
| Deployment | Single server | Sufficient for 50 concurrent users |

---

## 7. API Endpoints (Draft)

| Method | Endpoint | Response |
|--------|----------|----------|
| GET | `/api/streets` | List of all street names with summary scores |
| GET | `/api/streets/{name}` | Full street data: ordered points, geometries, all metrics |
| GET | `/api/streets/search?q={query}` | Autocomplete street name search |
| GET | `/api/points/{point_id}` | Single point full data |
| GET | `/api/images/{district}/{point_id}/{heading}` | Street view image file |
| GET | `/api/layers/{layer_name}` | Map overlay layer data |
| GET | `/api/city/stats` | City-wide statistics for landing page + scatter plots |
| GET | `/api/city/distribution/{dimension}` | All street scores for a dimension (scatter plot data) |

---

## 8. File Structure (Target)

```
HCMC_Tour/
├── REQUIREMENTS.md          # This document
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── LandingPage.jsx
│   │   │   ├── MapView.jsx
│   │   │   ├── TourMode.jsx
│   │   │   └── TourSummary.jsx
│   │   ├── components/
│   │   │   ├── Navbar.jsx
│   │   │   ├── PanoramaViewer.jsx     # Three.js sphere
│   │   │   ├── MiniMap.jsx            # Mapbox mini-map with layers
│   │   │   ├── Dashboard.jsx          # Floating sidebar
│   │   │   ├── RadarChart.jsx         # D3 radar (perception + walkability)
│   │   │   ├── Treemap.jsx            # D3 treemap (segmentation)
│   │   │   ├── ProgressBar.jsx        # No-radius progress bar
│   │   │   ├── Sparkline.jsx          # D3 line chart
│   │   │   ├── ScatterPlot.jsx        # D3 scatter (city comparison)
│   │   │   ├── StreetSearch.jsx       # Autocomplete search
│   │   │   └── LayerSwitcher.jsx      # Mini-map layer toggle
│   │   ├── hooks/
│   │   │   ├── useTourState.js        # Tour navigation state
│   │   │   └── useStreetData.js       # Data fetching
│   │   ├── styles/
│   │   │   └── globals.css            # CSS variables, base styles
│   │   └── utils/
│   │       └── walkability.js         # Score calculation formulas
│   └── public/
├── backend/
│   ├── requirements.txt
│   ├── main.py                        # FastAPI app
│   ├── routers/
│   │   ├── streets.py
│   │   ├── points.py
│   │   ├── images.py
│   │   └── layers.py
│   └── services/
│       ├── data_loader.py             # Load pre-processed JSON at startup
│       └── image_service.py           # Image file resolution
├── scripts/
│   ├── preprocess_points.py           # Merge image-level data -> per-point JSON
│   ├── preprocess_streets.py          # Build street index with geometry
│   └── preprocess_layers.py           # Convert rasters to web overlays
└── data/                              # Pre-processed output (gitignored)
    ├── points/
    ├── streets.json
    └── layers/
```

---

## 9. Implementation Priority

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| Phase 1 | Data pre-processing scripts | Unified point JSON + street index |
| Phase 2 | Backend API scaffold | FastAPI with all endpoints serving pre-processed data |
| Phase 3 | Frontend skeleton | React app with routing, landing page (real data), map view |
| Phase 4 | Panorama viewer | Three.js sphere + image loading + navigation arrows |
| Phase 5 | Dashboard components | Radar, treemap, progress bars, sparklines |
| Phase 6 | Tour flow | Street tour lifecycle: start -> navigate -> summary |
| Phase 7 | Mini-map + layers | Layer switching, real-time position tracking |
| Phase 8 | Polish | Animations, transitions, responsive, performance |
