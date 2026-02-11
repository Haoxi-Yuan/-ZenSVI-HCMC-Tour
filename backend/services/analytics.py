"""Analytics service: rank, percentile, similar streets, driver extraction."""

import math

from backend import data_store

DIMENSIONS = ("walkability", "safety", "accessibility", "comfort")
COMBINED_DIMS = ("safety", "accessibility", "comfort")

DRIVER_METADATA = {
    "S_perc": {"label": "Perceived safety", "dim": "safety",
               "desc": "Pedestrian perception of street safety (0-1)"},
    "S_expo": {"label": "Traffic exposure", "dim": "safety",
               "desc": "Degree of exposure to vehicular traffic (0=low, 1=high)"},
    "S_ctrl": {"label": "Traffic control", "dim": "safety",
               "desc": "Presence of traffic lights and signs (0-1)"},
    "A_side": {"label": "Sidewalk quality", "dim": "accessibility",
               "desc": "Proportion of usable sidewalk space (0-1)"},
    "A_encr": {"label": "Encroachment", "dim": "accessibility",
               "desc": "Sidewalk obstruction by vehicles/vendors (0=none, 1=severe)"},
    "C_gvi":  {"label": "Green view index", "dim": "comfort",
               "desc": "Proportion of visible vegetation (0-1)"},
    "C_vis":  {"label": "Visual quality", "dim": "comfort",
               "desc": "Visual richness and appeal of the streetscape (0-1)"},
    "C_svf":  {"label": "Sky view factor", "dim": "comfort",
               "desc": "Openness to sky, affecting wind and light (0-1)"},
    "C_thermal": {"label": "Thermal comfort", "dim": "comfort",
                  "desc": "Inverse land surface temperature (0=hot, 1=cool)"},
    "C_shade": {"label": "Shade coverage", "dim": "comfort",
                "desc": "Tree canopy and building shade coverage (0-1)"},
}


def compute_ranks():
    """Pre-compute rank/percentile/z-scores for all streets. Called at startup."""
    summary = data_store.streets_summary
    if not summary:
        print("  Warning: streets_summary empty, skipping rank computation")
        return

    print("Computing ranks and z-scores...")
    rd = data_store.rank_data

    # Per-dimension rank computation
    for dim in DIMENSIONS:
        scores = [(name, data.get(dim, 0)) for name, data in summary.items()]
        scores.sort(key=lambda x: x[1])
        count = len(scores)

        name_to_rank = {}
        name_to_percentile = {}
        values = [s[1] for s in scores]

        # Mean and std
        mean = sum(values) / count
        variance = sum((v - mean) ** 2 for v in values) / count
        std = math.sqrt(variance) if variance > 0 else 1.0

        for i, (name, val) in enumerate(scores):
            rank = i + 1  # 1-based, 1 = lowest
            percentile = (i / (count - 1)) * 100 if count > 1 else 50.0
            name_to_rank[name] = rank
            name_to_percentile[name] = percentile

        rd[dim] = {
            "name_to_rank": name_to_rank,
            "name_to_percentile": name_to_percentile,
            "count": count,
            "mean": mean,
            "std": std,
        }

    # Z-scores for all streets (used by similar streets)
    z_scores = {}
    for name in summary:
        z = {}
        for dim in DIMENSIONS:
            score = summary[name].get(dim, 0)
            z[dim] = (score - rd[dim]["mean"]) / rd[dim]["std"]
        z_scores[name] = z
    rd["z_scores"] = z_scores

    print(f"  Ranks computed for {rd[DIMENSIONS[0]]['count']} streets across {len(DIMENSIONS)} dimensions")


def _percentile_label(pct: float) -> str:
    if pct >= 90:
        return "Top 10%"
    if pct >= 75:
        return "Above average"
    if pct >= 50:
        return "Average"
    if pct >= 25:
        return "Below average"
    return "Bottom quartile"


def get_street_rank(street_name: str) -> dict:
    """Return rank and percentile for a street across all dimensions."""
    summary = data_store.streets_summary
    rd = data_store.rank_data

    if street_name not in summary:
        return None

    dims = {}
    for dim in DIMENSIONS:
        score = summary[street_name].get(dim, 0)
        rank = rd[dim]["name_to_rank"].get(street_name, 0)
        pct = rd[dim]["name_to_percentile"].get(street_name, 0)
        dims[dim] = {
            "score": round(score, 2),
            "rank": rank,
            "percentile": round(pct, 1),
            "label": _percentile_label(pct),
        }

    return {
        "street": street_name,
        "total_streets": rd[DIMENSIONS[0]]["count"],
        "dimensions": dims,
    }


def get_similar_streets(
    street_name: str,
    dimension: str = "combined",
    top_k: int = 5,
    weights: dict | None = None,
) -> list:
    """Find top_k most similar streets by score proximity.

    dimension: one of walkability/safety/accessibility/comfort (single-dim)
               or "combined" (weighted Euclidean on safety+accessibility+comfort)
    weights: for combined mode, e.g. {"safety": 1.0, "accessibility": 1.0, "comfort": 1.0}
    """
    summary = data_store.streets_summary
    rd = data_store.rank_data

    if street_name not in summary:
        return []

    if dimension in DIMENSIONS:
        # Single-dimension similarity: sort by absolute score difference
        target_score = summary[street_name].get(dimension, 0)
        candidates = []
        for name, data in summary.items():
            if name == street_name:
                continue
            cand_score = data.get(dimension, 0)
            diff = abs(cand_score - target_score)
            signed_diff = cand_score - target_score
            candidates.append({
                "name": name,
                "scores": {d: round(data.get(d, 0), 2) for d in DIMENSIONS},
                "distance": round(diff, 4),
                "deltas": {dimension: f"{signed_diff:+.2f}"},
            })
        candidates.sort(key=lambda x: x["distance"])
        return candidates[:top_k]

    # Combined mode: weighted Euclidean on z-scores of safety+accessibility+comfort
    if weights is None:
        weights = {"safety": 1.0, "accessibility": 1.0, "comfort": 1.0}

    z_scores = rd.get("z_scores", {})
    target_z = z_scores.get(street_name)
    if not target_z:
        return []

    candidates = []
    for name, z in z_scores.items():
        if name == street_name:
            continue
        dist_sq = sum(
            weights.get(d, 1.0) * (z[d] - target_z[d]) ** 2
            for d in COMBINED_DIMS
        )
        dist = math.sqrt(dist_sq)
        data = summary[name]
        deltas = {}
        for d in COMBINED_DIMS:
            delta = data.get(d, 0) - summary[street_name].get(d, 0)
            deltas[d] = f"{delta:+.2f}"
        candidates.append({
            "name": name,
            "scores": {d: round(data.get(d, 0), 2) for d in DIMENSIONS},
            "distance": round(dist, 4),
            "deltas": deltas,
        })

    candidates.sort(key=lambda x: x["distance"])
    return candidates[:top_k]


def get_street_drivers(street_name: str) -> dict | None:
    """Extract driver breakdown from pre-computed avg_scores intermediate variables."""
    full = data_store.get_streets_full()
    street = full.get(street_name)
    if not street:
        return None

    avg = street.get("avg_scores", {})
    result = {}

    for dim in ("safety", "accessibility", "comfort"):
        drivers = []
        for key, meta in DRIVER_METADATA.items():
            if meta["dim"] == dim:
                drivers.append({
                    "key": key,
                    "label": meta["label"],
                    "value": round(avg.get(key, 0), 4),
                    "description": meta["desc"],
                })
        dim_score_key = f"{dim}_score"
        result[dim] = {
            "score": round(avg.get(dim_score_key, 0), 2),
            "drivers": drivers,
        }

    return result
