"""Story service: selects 7 narrative shots and generates LLM narrations."""

import hashlib
import json
import re
import traceback

from backend import data_store
from backend.config import LLM_PROVIDER, LLM_MODEL
from backend.services.llm_providers import get_provider
from backend.services.cache_service import cache_get, cache_set
from backend.services.prompts import build_story_prompt, STORY_PROMPT_VERSION
from backend.services.analytics import get_street_rank
from backend.services.scene_evidence import get_scene_evidence

MIN_STORY_POINTS = 80
POINTS_FALLBACKS = (80, 60, 40, 20, 0)
SHRINKAGE_K = 120.0


def _is_valid_name(name: str) -> bool:
    """Filter out garbage street names (stringified Python lists, etc.)."""
    if name.startswith("[") or name.startswith("'") or name.startswith('"'):
        return False
    if len(name) < 2 or len(name) > 80:
        return False
    return True


def _base_name(name: str) -> str:
    """Normalize split street names, e.g. 'Foo #3' -> 'Foo'."""
    return re.sub(r"\s+#\d+$", "", name).strip()


def _city_mean(city: dict, dim: str) -> float:
    return float(city.get(dim, {}).get("stats", {}).get("mean", 0.0))


def _adjusted_score(raw: float, points: int, city_mean: float, k: float = SHRINKAGE_K) -> float:
    """Empirical-Bayes style shrinkage to reduce small-sample extremes."""
    n = max(points, 0)
    return (n / (n + k)) * raw + (k / (n + k)) * city_mean


def _dimension_candidates(summary: dict, city: dict, dim: str, reverse: bool, min_points: int):
    """Rank candidates by adjusted score with a minimum points threshold."""
    mean = _city_mean(city, dim)
    candidates = []
    for name, data in summary.items():
        if not _is_valid_name(name):
            continue
        points = int(data.get("points", 0))
        if points < min_points:
            continue
        raw = float(data.get(dim, 0))
        adjusted = _adjusted_score(raw, points, mean)
        candidates.append((name, data, adjusted))

    candidates.sort(
        key=lambda x: (x[2], float(x[1].get(dim, 0)), int(x[1].get("points", 0))),
        reverse=reverse,
    )
    return candidates


def _pick_unique_by_base(candidates: list, used_bases: set[str]):
    for name, data, _ in candidates:
        base = _base_name(name)
        if base in used_bases:
            continue
        used_bases.add(base)
        return name, data
    return None, None


def _select_dimension_shot(summary: dict, city: dict, used_bases: set[str], dim: str, reverse: bool):
    """Select one representative street for a dimension with fallback thresholds."""
    for min_points in POINTS_FALLBACKS:
        picked = _pick_unique_by_base(
            _dimension_candidates(summary, city, dim=dim, reverse=reverse, min_points=min_points),
            used_bases,
        )
        if picked[0]:
            return picked
    return None, None


def _select_hidden_danger(summary: dict, used_bases: set[str]):
    """Pick a representative street with high safety but low overall walkability."""
    criteria = [
        lambda d: d.get("safety", 0) >= 7.0 and d.get("walkability", 0) < 5.0,
        lambda d: d.get("safety", 0) >= 6.8 and d.get("walkability", 0) < 5.2,
        lambda d: d.get("safety", 0) >= 6.5 and d.get("walkability", 0) < 5.5,
    ]
    for min_points in POINTS_FALLBACKS:
        for cond in criteria:
            candidates = []
            for name, data in summary.items():
                if not _is_valid_name(name):
                    continue
                if int(data.get("points", 0)) < min_points:
                    continue
                if not cond(data):
                    continue
                candidates.append((name, data))
            candidates.sort(key=lambda x: (
                float(x[1].get("walkability", 0)),
                -float(x[1].get("safety", 0)),
                -int(x[1].get("points", 0)),
            ))
            for name, data in candidates:
                base = _base_name(name)
                if base in used_bases:
                    continue
                used_bases.add(base)
                return name, data
    return None, None


def get_story_shots() -> list[dict]:
    """Select 7 narrative shots from the data.

    Returns a list of shot dicts without narrations (narrations added separately).
    """
    summary = data_store.streets_summary
    city = data_store.city_stats

    shots = []
    used_bases: set[str] = set()

    # Shot 1: City Overview (fixed camera, zoomed out)
    shots.append({
        "id": 1,
        "theme": "City Overview",
        "street_name": None,
        "camera": {
            "center": [106.695, 10.775],
            "zoom": 11.5,
            "pitch": 45,
            "bearing": -15,
        },
        "duration_ms": 8000,
        "focus_property": "walkability",
        "data_context": {
            "total_streets": len(summary),
            "avg_walkability": _city_mean(city, "walkability"),
            "total_districts": city.get("total_districts", 24),
            "min_points_threshold": MIN_STORY_POINTS,
        },
    })

    # Shot 2: Best Walkability (representative)
    name, data = _select_dimension_shot(
        summary=summary, city=city, used_bases=used_bases, dim="walkability", reverse=True,
    )
    if name and data:
        shots.append({
            "id": 2,
            "theme": "Most Walkable Street",
            "street_name": name,
            "camera": {
                "center": [data["lon"], data["lat"]],
                "zoom": 15.5,
                "pitch": 50,
                "bearing": 20,
            },
            "duration_ms": 8000,
            "focus_property": "walkability",
            "data_context": {
                "walkability": round(data.get("walkability", 0), 2),
                "safety": round(data.get("safety", 0), 2),
                "accessibility": round(data.get("accessibility", 0), 2),
                "comfort": round(data.get("comfort", 0), 2),
                "points": int(data.get("points", 0)),
                "segments": int(data.get("segments", 0)),
                "min_points_threshold": MIN_STORY_POINTS,
            },
        })

    # Shot 3: Safest Street (representative)
    name, data = _select_dimension_shot(
        summary=summary, city=city, used_bases=used_bases, dim="safety", reverse=True,
    )
    if name and data:
        shots.append({
            "id": 3,
            "theme": "Safest Street",
            "street_name": name,
            "camera": {
                "center": [data["lon"], data["lat"]],
                "zoom": 15.5,
                "pitch": 40,
                "bearing": -30,
            },
            "duration_ms": 7000,
            "focus_property": "safety",
            "data_context": {
                "walkability": round(data.get("walkability", 0), 2),
                "safety": round(data.get("safety", 0), 2),
                "accessibility": round(data.get("accessibility", 0), 2),
                "comfort": round(data.get("comfort", 0), 2),
                "points": int(data.get("points", 0)),
                "segments": int(data.get("segments", 0)),
                "min_points_threshold": MIN_STORY_POINTS,
            },
        })

    # Shot 4: Most Accessible (representative)
    name, data = _select_dimension_shot(
        summary=summary, city=city, used_bases=used_bases, dim="accessibility", reverse=True,
    )
    if name and data:
        shots.append({
            "id": 4,
            "theme": "Most Accessible Street",
            "street_name": name,
            "camera": {
                "center": [data["lon"], data["lat"]],
                "zoom": 15.5,
                "pitch": 45,
                "bearing": 60,
            },
            "duration_ms": 7000,
            "focus_property": "accessibility",
            "data_context": {
                "walkability": round(data.get("walkability", 0), 2),
                "safety": round(data.get("safety", 0), 2),
                "accessibility": round(data.get("accessibility", 0), 2),
                "comfort": round(data.get("comfort", 0), 2),
                "points": int(data.get("points", 0)),
                "segments": int(data.get("segments", 0)),
                "min_points_threshold": MIN_STORY_POINTS,
            },
        })

    # Shot 5: Hidden Danger — high safety but low overall walkability
    name, data = _select_hidden_danger(summary=summary, used_bases=used_bases)
    if name and data:
        shots.append({
            "id": 5,
            "theme": "Hidden Danger",
            "street_name": name,
            "camera": {
                "center": [data["lon"], data["lat"]],
                "zoom": 15.5,
                "pitch": 55,
                "bearing": -60,
            },
            "duration_ms": 8000,
            "focus_property": "safety",
            "data_context": {
                "walkability": round(data.get("walkability", 0), 2),
                "safety": round(data.get("safety", 0), 2),
                "accessibility": round(data.get("accessibility", 0), 2),
                "comfort": round(data.get("comfort", 0), 2),
                "points": int(data.get("points", 0)),
                "segments": int(data.get("segments", 0)),
                "min_points_threshold": MIN_STORY_POINTS,
            },
        })

    # Shot 6: Worst Walkability (representative)
    name, data = _select_dimension_shot(
        summary=summary, city=city, used_bases=used_bases, dim="walkability", reverse=False,
    )
    if name and data:
        shots.append({
            "id": 6,
            "theme": "Least Walkable Street",
            "street_name": name,
            "camera": {
                "center": [data["lon"], data["lat"]],
                "zoom": 15.5,
                "pitch": 50,
                "bearing": 45,
            },
            "duration_ms": 8000,
            "focus_property": "walkability",
            "data_context": {
                "walkability": round(data.get("walkability", 0), 2),
                "safety": round(data.get("safety", 0), 2),
                "accessibility": round(data.get("accessibility", 0), 2),
                "comfort": round(data.get("comfort", 0), 2),
                "points": int(data.get("points", 0)),
                "segments": int(data.get("segments", 0)),
                "min_points_threshold": MIN_STORY_POINTS,
            },
        })

    # Shot 7: Call to Action (zoom back out)
    shots.append({
        "id": 7,
        "theme": "Call to Action",
        "street_name": None,
        "camera": {
            "center": [106.70, 10.78],
            "zoom": 12,
            "pitch": 30,
            "bearing": 0,
        },
        "duration_ms": 6000,
        "focus_property": "walkability",
        "data_context": {
            "total_streets": len(summary),
        },
    })

    return shots


async def generate_story_narrations(shots: list[dict]) -> list[dict]:
    """Add LLM-generated narrations to each shot. Uses cache per shot."""
    city = data_store.city_stats
    results = []

    for shot in shots:
        # Get rank info and scene evidence for streets with names
        rank_info = None
        shot_evidence = None
        if shot["street_name"]:
            rank_info = get_street_rank(shot["street_name"])
            # Get best + worst evidence points for street-based shots
            full_evidence = get_scene_evidence(shot["street_name"])
            if full_evidence:
                # Take first best and first worst (up to 2 points)
                best = [e for e in full_evidence if e["label"] == "best"][:1]
                worst = [e for e in full_evidence if e["label"] == "worst"][:1]
                shot_evidence = best + worst
                if not shot_evidence:
                    shot_evidence = full_evidence[:2]

        system_prompt, user_prompt = build_story_prompt(
            shot=shot,
            city_stats=city,
            rank_info=rank_info,
            scene_evidence=shot_evidence,
        )
        prompt_hash = hashlib.sha256(f"{system_prompt}\n{user_prompt}".encode("utf-8")).hexdigest()[:16]
        cache_key = f"story:shot:{shot['id']}:{STORY_PROMPT_VERSION}:{LLM_MODEL}:{prompt_hash}"
        cached = cache_get(cache_key)

        if cached:
            shot_with_narration = {**shot, "narration": json.loads(cached)["narration"]}
            shot_with_narration.pop("data_context", None)
            if shot_evidence:
                shot_with_narration["scene_evidence"] = shot_evidence
            results.append(shot_with_narration)
            continue

        try:
            provider = get_provider(LLM_PROVIDER)
            response = await provider.generate(
                system_prompt, user_prompt, max_tokens=100, temperature=0.4,
            )
            narration = response.content.strip()
        except Exception:
            traceback.print_exc()
            narration = _fallback_narration(shot)

        # Cache narration
        cache_set(cache_key, json.dumps({"narration": narration}))

        shot_with_narration = {**shot, "narration": narration}
        shot_with_narration.pop("data_context", None)
        if shot_evidence:
            shot_with_narration["scene_evidence"] = shot_evidence
        results.append(shot_with_narration)

    return results


def _fallback_narration(shot: dict) -> str:
    """Generate a static fallback narration when LLM is unavailable."""
    ctx = shot.get("data_context", {})
    theme = shot["theme"]
    name = shot["street_name"]

    if theme == "City Overview":
        return (
            f"Ho Chi Minh City, a metropolis of {ctx.get('total_districts', 24)} districts "
            f"and {ctx.get('total_streets', 16243):,} surveyed streets, "
            f"scores an average walkability of {ctx.get('avg_walkability', 5.0):.1f} out of 10."
        )
    if theme == "Call to Action":
        return (
            f"Across {ctx.get('total_streets', 16243):,} streets, every corner tells a story. "
            "Click any street to begin your own exploration."
        )
    if name:
        walk = ctx.get("walkability", 0)
        return f"{name} scores {walk:.1f} for walkability across safety, accessibility, and comfort."
    return "Exploring the walkability landscape of Ho Chi Minh City."
