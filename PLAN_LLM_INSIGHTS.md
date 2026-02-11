# Implementation Plan: LLM-Powered Insights for Summary Page

## Confirmed Decisions

| Decision | Choice |
|----------|--------|
| LLM Provider | Pluggable architecture (OpenAI default, Claude stub) |
| Default Model | gpt-4o-mini |
| Interaction | Auto-insights only (no chat UI) |
| Cache | SQLite file-based, 7-day TTL |
| Backend | Split into modules |
| Similar Streets | Weighted Euclidean distance, z-score normalized |
| Similarity Dimensions | 4 per-dimension + combined (safety+accessibility+comfort, adjustable weights) |
| Drivers | Extract from pre-computed avg_scores intermediate variables |
| Computation | Pre-compute rank/percentile at startup; similar streets on-demand |
| Language | English only |
| Git | Init repo + feature branch |

---

## Step 0: Git Setup

- `git init` in `/data2/shared/haoxi/projects/ZenSVI/HCMC_Tour`
- Create `.gitignore` (node_modules, __pycache__, cache/, logs/, .env, data/)
- Initial commit with existing code
- Create branch `feature/llm-insights`

---

## Step 1: Backend Module Restructuring

Refactor the 408-line `main.py` into a clean module structure. The `routers/` and `services/` dirs already exist (empty).

### New/Modified Files

```
backend/
  __init__.py              # NEW (empty)
  main.py                  # MODIFY → slim app factory (~40 lines)
  config.py                # NEW → paths, env loading, LLM config
  data_store.py            # NEW → global data stores + load_data()
  routers/
    __init__.py            # NEW (empty)
    streets.py             # NEW → /api/streets/* (moved from main.py)
    points.py              # NEW → /api/points/* (moved from main.py)
    images.py              # NEW → /api/images/* (moved from main.py)
    layers.py              # NEW → /api/layers/* (moved from main.py)
    city.py                # NEW → /api/city/* (moved from main.py)
    insights.py            # NEW → /api/insights/* (new endpoints)
  services/
    __init__.py            # NEW (empty)
    analytics.py           # NEW → rank, percentile, similar, drivers
    llm_service.py         # NEW → LLM orchestrator
    cache_service.py       # NEW → SQLite cache
    prompts.py             # NEW → prompt templates
    llm_providers/
      __init__.py          # NEW → BaseLLMProvider + factory
      openai_provider.py   # NEW → OpenAI implementation
      claude_provider.py   # NEW → Claude stub
  requirements.txt         # MODIFY → add openai, httpx
```

### main.py (after refactoring)

Slim entry point: create FastAPI app, add middleware, include all routers, startup event calls `load_data()` then `compute_ranks()`.

Note: `start.sh` already uses `backend.main:app` — no change needed.

### config.py

- Move path constants (PROJECT_ROOT, DATA_DIR, IMAGE_DIR, etc.)
- Move `_load_env_file()` function
- Add new config: `LLM_PROVIDER`, `LLM_MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_CACHE_TTL_SECONDS`, `CACHE_DIR`

### data_store.py

- Move global dicts: `streets_summary`, `streets_full`, `city_stats`, `points_by_district`, `layer_manifest`
- Move `load_data()` function
- Add `rank_data` dict (populated by analytics.compute_ranks)
- Add `get_streets_full()` for lazy-loading the 92MB file

### Router files (streets.py, points.py, images.py, layers.py, city.py)

Each uses `APIRouter(prefix="/api/...")`, endpoints moved verbatim from main.py, importing data from `backend.data_store`.

**Verification**: After this step, all existing endpoints must still work.

---

## Step 2: Analytics Service

**File**: `backend/services/analytics.py`

### 2a. `compute_ranks()` — called at startup

Input: `streets_summary` (16,243 entries with `walkability`, `safety`, `accessibility`, `comfort`)

Algorithm:
1. For each of 4 dimensions, sort all streets by score ascending
2. Assign 1-based rank (1 = lowest). Handle ties with average rank.
3. Compute `percentile = (rank - 1) / (count - 1) * 100`
4. Compute per-dimension mean and std for z-score normalization
5. Store z-scores for all streets (used by similar streets)

Stored in `rank_data`:
```python
{
  "walkability": {
    "name_to_rank": {"street_name": rank, ...},
    "name_to_percentile": {"street_name": pct, ...},
    "count": 16243,
    "mean": 4.57,
    "std": 1.02,
  },
  # same for safety, accessibility, comfort
  "z_scores": {
    "street_name": {"walkability": 1.54, "safety": 0.82, ...},
    ...
  }
}
```

### 2b. `get_street_rank(street_name) -> dict`

O(1) lookup into pre-computed data. Returns:
```json
{
  "street": "Hai Bà Trưng",
  "total_streets": 16243,
  "dimensions": {
    "walkability": {"score": 5.23, "rank": 8924, "percentile": 54.9, "label": "Average"},
    "safety": {"score": 4.10, "rank": 5200, "percentile": 32.0, "label": "Below average"},
    "accessibility": {"score": 6.80, "rank": 14100, "percentile": 86.8, "label": "Above average"},
    "comfort": {"score": 4.78, "rank": 7300, "percentile": 44.9, "label": "Average"}
  }
}
```

Label mapping: >=90 "Top 10%" / >=75 "Above average" / >=50 "Average" / >=25 "Below average" / else "Bottom quartile"

### 2c. `get_similar_streets(street_name, dimension, top_k, weights) -> list`

On-demand, O(n) scan over 16,243 streets (~5ms).

**Single dimension** (walkability/safety/accessibility/comfort):
- Sort by `|candidate_score - target_score|` ascending
- Exclude target street
- Return top_k with `delta` per dimension

**Combined** (safety+accessibility+comfort, adjustable weights):
- Use z-scores: `dist = sqrt(w_s*(Δz_s)² + w_a*(Δz_a)² + w_c*(Δz_c)²)`
- Default weights: `{safety: 1.0, accessibility: 1.0, comfort: 1.0}`
- Walkability excluded (it's avg of the three)

Each result includes:
```json
{
  "name": "Nguyễn Huệ",
  "scores": {"walkability": 5.1, "safety": 4.8, "accessibility": 5.5, "comfort": 5.0},
  "distance": 0.21,
  "deltas": {"safety": "+0.3", "accessibility": "-0.2", "comfort": "+0.1"}
}
```

### 2d. `get_street_drivers(street_name) -> dict`

Extracts from `streets_full[name]["avg_scores"]` which already contains all 10 intermediate variables:

| Variable | Label | Dimension | Range |
|----------|-------|-----------|-------|
| S_perc | Perceived safety | safety | [0, 1] |
| S_expo | Traffic exposure | safety | [0, 1] |
| S_ctrl | Traffic control | safety | [0, 1] |
| A_side | Sidewalk quality | accessibility | [0, 1] |
| A_encr | Encroachment | accessibility | [0, 1] |
| C_gvi | Green view index | comfort | [0, 1] |
| C_vis | Visual quality | comfort | [0, 1] |
| C_svf | Sky view factor | comfort | [0, 1] |
| C_thermal | Thermal comfort | comfort | [0, 1] |
| C_shade | Shade coverage | comfort | [0, 1] |

Returns structured dict grouped by dimension with each driver's value, label, and description.

---

## Step 3: Cache Service

**File**: `backend/services/cache_service.py`

SQLite database at `backend/cache/insights_cache.db`.

Schema:
```sql
CREATE TABLE cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at REAL NOT NULL,
    ttl_seconds INTEGER NOT NULL DEFAULT 604800
);
```

Functions: `cache_get(key)`, `cache_set(key, value, ttl)`, `cache_clear()`.

Cache key: `"insight:{street_name}"` — keyed by street name only (data is static).

---

## Step 4: LLM Service (Pluggable)

### 4a. Provider Interface (`llm_providers/__init__.py`)

```python
class BaseLLMProvider(ABC):
    async def generate(self, system_prompt, user_prompt, max_tokens, temperature) -> LLMResponse

@dataclass
class LLMResponse:
    content: str
    model: str
    prompt_tokens: int
    completion_tokens: int

def get_provider(name: str) -> BaseLLMProvider  # factory
```

### 4b. OpenAI Provider (`openai_provider.py`)

Uses `openai.AsyncOpenAI`. Model from config (default `gpt-4o-mini`).

### 4c. Claude Provider (`claude_provider.py`)

Uses `httpx.AsyncClient` to call Anthropic Messages API. Stub implementation.

### 4d. LLM Orchestrator (`llm_service.py`)

`generate_street_insight(street_name)`:
1. Check SQLite cache → return if hit
2. Gather: `get_street_rank()` + `get_similar_streets("combined", 3)` + `get_street_drivers()`
3. Build prompt via `prompts.py`
4. Call LLM provider
5. Cache result, return

### 4e. Prompt Templates (`prompts.py`)

System prompt rules:
- 3-4 sentences max
- Reference exact scores, percentiles, driver names
- No emojis, no markdown
- Compare to city averages
- Mention strongest and weakest driver

User prompt: structured data block with scores, rankings, drivers, similar streets.

---

## Step 5: New API Endpoints

**File**: `backend/routers/insights.py`

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/insights/rank/{street_name}` | Rank + percentile for all 4 dims |
| GET | `/api/insights/similar/{street_name}?dimension=&top_k=&w_safety=&w_accessibility=&w_comfort=` | Top-k similar streets |
| GET | `/api/insights/drivers/{street_name}` | Driver breakdown by dimension |
| GET | `/api/insights/llm/{street_name}` | LLM-generated insight text |

All return 404 for unknown street names.

---

## Step 6: Frontend Hooks

**File**: `frontend/src/hooks/useInsights.js`

4 hooks following existing pattern (`useState` + `useEffect` + `fetch` + `AbortController`):

- `useStreetRank(streetName)` → `{ data, loading }`
- `useSimilarStreets(streetName, dimension, topK)` → `{ data, loading }`
- `useStreetDrivers(streetName)` → `{ data, loading }`
- `useLLMInsight(streetName)` → `{ data, loading, error }`

---

## Step 7: Frontend Components

### 7a. `PercentileBar.jsx`

Props: `label, score, rank, percentile, total, rankLabel`

Visual: horizontal bar (no border-radius), filled to percentile%, marker line at position, rank text on right side. Color: green (>=75th), gold (>=40th), orange (<40th).

### 7b. `SimilarStreets.jsx`

Props: `streets, dimension, currentScores, loading`

Visual: list of similar streets, each row shows name + per-dimension delta values + clickable link to `/summary/{name}`. Dimension tab switcher at top (walkability / safety / accessibility / comfort / combined).

### 7c. `InsightPanel.jsx`

Props: `insight, model, cached, loading, error`

Visual: card with green left border, "AI Insight" label, text body, "Generated by {model}" footer. Loading state shows "Analyzing street data...". Error state shows graceful fallback.

---

## Step 8: TourSummary.jsx Modifications

### New imports
```javascript
import PercentileBar from '../components/PercentileBar'
import SimilarStreets from '../components/SimilarStreets'
import InsightPanel from '../components/InsightPanel'
import { useStreetRank, useSimilarStreets, useLLMInsight } from '../hooks/useInsights'
```

### New hooks (after existing hooks, ~line 15)
```javascript
const { data: rankData } = useStreetRank(decodedName)
const { data: similarData, loading: similarLoading } = useSimilarStreets(decodedName, selectedDim, 5)
const { data: insightData, loading: insightLoading, error: insightError } = useLLMInsight(decodedName)
```

### Page section order (after modifications)

1. Header (existing)
2. Street Preview Gallery (existing)
3. Overall Score (existing, lines 208-260)
4. **NEW: City Ranking** — 4 PercentileBar in 2x2 grid (after line 260)
5. **NEW: AI Insight** — InsightPanel (below ranking)
6. Radar Charts (existing, lines 262-275)
7. Journey Sparklines (existing, lines 277-338)
8. Scatter Plots (existing, lines 340-362)
9. **NEW: Similar Streets** — with dimension tab switcher (after line 362)
10. Return button (existing)

---

## Step 9: Implementation Order

```
Step 0: Git init + .gitignore + initial commit + feature branch
    ↓
Step 1: Backend module restructuring
    ↓  (verify: all existing endpoints still work)
    ↓
Step 2: Analytics service (analytics.py)
    ↓  (verify: rank/similar/drivers endpoints return correct data)
    ↓
Step 3: Cache service (cache_service.py)
    ↓  (verify: get/set/clear work)
    ↓
Step 4: LLM service + providers
    ↓  (verify: /api/insights/llm/{name} returns text, second call is cached)
    ↓
Step 5: Insights router (all 4 endpoints)
    ↓  (verify: curl all endpoints, check 404 handling)
    ↓
Step 6: Frontend hooks (useInsights.js)
    ↓
Step 7: Frontend components (PercentileBar, SimilarStreets, InsightPanel)
    ↓
Step 8: TourSummary.jsx integration
    ↓  (verify: visual check, loading states, edge cases)
    ↓
Step 9: End-to-end testing + polish
```

---

## Step 10: Verification Checklist

### Backend
- [ ] All existing endpoints still work after restructure
- [ ] `compute_ranks()` completes in < 2s at startup
- [ ] `/api/insights/rank/{name}`: percentile [0,100], rank [1,16243]
- [ ] `/api/insights/similar/{name}`: excludes self, respects top_k
- [ ] `/api/insights/similar/{name}?dimension=combined&w_safety=2`: weight adjustment works
- [ ] `/api/insights/drivers/{name}`: all 10 intermediate variables present, values [0,1]
- [ ] `/api/insights/llm/{name}`: returns 3-4 sentences, no emoji, no markdown
- [ ] Second LLM call returns `"cached": true`
- [ ] 404 for non-existent street name

### Frontend
- [ ] PercentileBar renders correctly for top-ranked / bottom-ranked / average streets
- [ ] InsightPanel shows loading → text transition
- [ ] InsightPanel shows graceful error state when LLM unavailable
- [ ] SimilarStreets dimension tabs switch correctly
- [ ] Similar street links navigate to correct summary page
- [ ] All existing sections unaffected (radar charts, sparklines, scatter plots)

---

## File Summary

| File | Action | Lines (est.) |
|------|--------|-------------|
| `backend/__init__.py` | NEW | 0 |
| `backend/config.py` | NEW | ~40 |
| `backend/data_store.py` | NEW | ~60 |
| `backend/main.py` | MODIFY | ~40 (from 408) |
| `backend/routers/__init__.py` | NEW | 0 |
| `backend/routers/streets.py` | NEW | ~80 |
| `backend/routers/points.py` | NEW | ~80 |
| `backend/routers/images.py` | NEW | ~50 |
| `backend/routers/layers.py` | NEW | ~40 |
| `backend/routers/city.py` | NEW | ~30 |
| `backend/routers/insights.py` | NEW | ~50 |
| `backend/services/__init__.py` | NEW | 0 |
| `backend/services/analytics.py` | NEW | ~200 |
| `backend/services/llm_service.py` | NEW | ~60 |
| `backend/services/cache_service.py` | NEW | ~60 |
| `backend/services/prompts.py` | NEW | ~80 |
| `backend/services/llm_providers/__init__.py` | NEW | ~40 |
| `backend/services/llm_providers/openai_provider.py` | NEW | ~35 |
| `backend/services/llm_providers/claude_provider.py` | NEW | ~35 |
| `backend/requirements.txt` | MODIFY | 4 |
| `frontend/src/hooks/useInsights.js` | NEW | ~90 |
| `frontend/src/components/PercentileBar.jsx` | NEW | ~60 |
| `frontend/src/components/SimilarStreets.jsx` | NEW | ~120 |
| `frontend/src/components/InsightPanel.jsx` | NEW | ~60 |
| `frontend/src/pages/TourSummary.jsx` | MODIFY | +~80 |
| **Total** | 21 new, 4 modified | ~1,350 |
