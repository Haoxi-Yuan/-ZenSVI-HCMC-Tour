"""Scene evidence extraction: select 6 key sampling points per street with visual descriptions."""

import json

from backend.config import DATA_DIR
from backend.data_store import get_streets_full, load_district_points

# Cache: point_id -> district
_points_index: dict | None = None


def _get_points_index() -> dict:
    global _points_index
    if _points_index is None:
        path = DATA_DIR / "points" / "points_index.json"
        with open(path) as f:
            _points_index = {p["id"]: p["district"] for p in json.load(f)}
    return _points_index


def _load_point_data(point_ids: list[str]) -> dict:
    """Load full point data for a list of point IDs. Returns {point_id: point_data}."""
    index = _get_points_index()
    by_district: dict[str, list[str]] = {}
    for pid in point_ids:
        district = index.get(pid)
        if district:
            by_district.setdefault(district, []).append(pid)

    result = {}
    for district, pids in by_district.items():
        district_points = load_district_points(district)
        needed = set(pids)
        for pt in district_points:
            if pt["id"] in needed:
                result[pt["id"]] = pt
                needed.discard(pt["id"])
                if not needed:
                    break
    return result


# ── Rule-based tag generation ──────────────────────────────────────


def _generate_visual_tags(point_data: dict) -> list[str]:
    """Generate rule-based visual tags from segmentation/detection/perception."""
    tags = []
    seg = point_data.get("segmentation", {})
    det = point_data.get("detection", {})
    perc = point_data.get("perception", {})

    # Segmentation: vegetation
    veg = seg.get("vegetation", 0)
    if veg >= 0.20:
        tags.append("lush_vegetation")
    elif veg >= 0.08:
        tags.append("moderate_greenery")
    elif veg < 0.03:
        tags.append("low_greenery")

    # Segmentation: sky
    sky = seg.get("sky", 0)
    if sky >= 0.25:
        tags.append("open_sky")
    elif sky < 0.08:
        tags.append("enclosed_sky")

    # Segmentation: building
    if seg.get("building", 0) >= 0.40:
        tags.append("dense_building")

    # Segmentation: sidewalk
    sidewalk = seg.get("sidewalk", 0)
    if sidewalk >= 0.05:
        tags.append("clear_sidewalk")
    elif sidewalk < 0.01:
        tags.append("no_sidewalk")

    # Segmentation: road
    if seg.get("road", 0) >= 0.30:
        tags.append("wide_road")

    # Segmentation: vehicle/person class proportions
    if seg.get("motorcycle", seg.get("motorbike", 0)) >= 0.01:
        tags.append("motorbike_present")
    if seg.get("car", 0) >= 0.02:
        tags.append("car_traffic")
    if seg.get("person", 0) >= 0.02:
        tags.append("pedestrian_activity")

    # Detection: count thresholds
    if det.get("motorbike", 0) >= 2:
        tags.append("heavy_motorbike")
    if det.get("person", 0) >= 3:
        tags.append("crowded")
    if det.get("tree", 0) >= 3:
        tags.append("tree_lined")
    if det.get("car", 0) >= 2:
        tags.append("heavy_car_traffic")

    # Perception: score thresholds
    if perc.get("safer", 0) >= 7:
        tags.append("feels_safe")
    elif perc.get("safer", 0) < 4:
        tags.append("feels_unsafe")
    if perc.get("more_beautiful", 0) >= 6:
        tags.append("visually_appealing")
    if perc.get("more_depressing", 0) >= 7:
        tags.append("feels_depressing")
    if perc.get("more_boring", 0) >= 7:
        tags.append("monotonous")

    return tags


# ── Description generation ─────────────────────────────────────────


def _generate_description(point_data: dict, tags: list[str]) -> str:
    """Compose 1-2 sentence description from data and tags."""
    seg = point_data.get("segmentation", {})
    det = point_data.get("detection", {})
    perc = point_data.get("perception", {})

    building_pct = seg.get("building", 0) * 100
    road_pct = seg.get("road", 0) * 100
    sky_pct = seg.get("sky", 0) * 100
    sidewalk_pct = seg.get("sidewalk", 0) * 100
    veg_pct = seg.get("vegetation", 0) * 100

    # Sentence 1: physical environment
    if "dense_building" in tags:
        sw = ("clear sidewalk" if "clear_sidewalk" in tags
              else "narrow sidewalk" if sidewalk_pct > 0
              else "no visible sidewalk")
        sent1 = f"Dense building corridor ({building_pct:.0f}%) with {sw} ({sidewalk_pct:.0f}%)."
    elif "open_sky" in tags:
        sent1 = (f"Open streetscape ({sky_pct:.0f}% sky, {veg_pct:.0f}% vegetation) "
                 f"with {road_pct:.0f}% road surface.")
    elif "wide_road" in tags:
        sent1 = (f"Road-dominant environment ({road_pct:.0f}% road) "
                 f"with {building_pct:.0f}% building coverage.")
    else:
        top_classes = sorted(seg.items(), key=lambda x: x[1], reverse=True)
        top_name = top_classes[0][0] if top_classes else "mixed"
        top_pct = top_classes[0][1] * 100 if top_classes else 0
        sent1 = f"Mixed streetscape led by {top_name} ({top_pct:.0f}%)."

    # Sentence 2: activity + perception
    parts = []
    if "heavy_motorbike" in tags:
        parts.append(f"heavy motorbike traffic ({det.get('motorbike', 0):.1f} avg)")
    if "crowded" in tags:
        parts.append(f"high pedestrian density ({det.get('person', 0):.1f} persons)")
    elif det.get("person", 0) > 0:
        parts.append(f"{det.get('person', 0):.1f} persons detected")

    if "lush_vegetation" in tags:
        parts.append("lush greenery")
    elif "low_greenery" in tags:
        parts.append("minimal vegetation")

    if "feels_safe" in tags:
        parts.append(f"perceived as safe ({perc.get('safer', 0):.1f}/10)")
    elif "feels_unsafe" in tags:
        parts.append(f"low safety perception ({perc.get('safer', 0):.1f}/10)")

    if parts:
        sent2 = parts[0].capitalize()
        if len(parts) > 1:
            sent2 += " with " + " and ".join(parts[1:])
        sent2 += "."
    else:
        sent2 = ""

    return (sent1 + " " + sent2).strip()


# ── Helpers ────────────────────────────────────────────────────────


def _build_thumbnail_url(point_data: dict) -> str:
    district = point_data.get("district", "")
    folder = point_data.get("folder", "")
    images = point_data.get("images", [])
    if district and folder and images:
        return f"/api/images/{district}/{folder}/{images[0]}"
    return ""


def _top_segmentation(point_data: dict, n: int = 5) -> list[dict]:
    seg = point_data.get("segmentation", {})
    top = sorted(seg.items(), key=lambda x: x[1], reverse=True)[:n]
    return [{"class": k, "pct": round(v * 100, 1)} for k, v in top]


# ── Main entry point ───────────────────────────────────────────────


DIM_SCORE_KEY = {
    "safety": "safety_score",
    "accessibility": "accessibility_score",
    "comfort": "comfort_score",
}


def get_scene_evidence(street_name: str) -> list[dict]:
    """Extract 6 key sampling points for a street with visual descriptions.

    Selection: best_2 (strongest dim) + worst_2 (weakest dim) + delta_2 (walkability change).
    Returns list of evidence dicts E1-E6.
    """
    streets = get_streets_full()
    street = streets.get(street_name)
    if not street or not street.get("segments"):
        return []

    segments = street["segments"]
    avg_scores = street.get("avg_scores", {})

    # Determine strongest and weakest dimension
    dims = {
        "safety": avg_scores.get("safety_score", 0),
        "accessibility": avg_scores.get("accessibility_score", 0),
        "comfort": avg_scores.get("comfort_score", 0),
    }
    strongest_dim = max(dims, key=dims.get)
    weakest_dim = min(dims, key=dims.get)

    # Build (point_id, seg_index, segment) tuples
    point_segments = []
    for i, seg in enumerate(segments):
        for pid in seg.get("points", []):
            point_segments.append((pid, i, seg))

    if not point_segments:
        return []

    # Load full point data
    all_pids = [ps[0] for ps in point_segments]
    point_data_map = _load_point_data(all_pids)

    # Filter to points we have data for
    point_segments = [(pid, si, seg) for pid, si, seg in point_segments
                      if pid in point_data_map]
    if not point_segments:
        return []

    used_pids: set[str] = set()
    selected: list[tuple[str, str]] = []  # (point_id, label)

    # best_2: highest score in strongest dimension
    strongest_key = DIM_SCORE_KEY[strongest_dim]
    by_best = sorted(point_segments,
                     key=lambda x: x[2].get("scores", {}).get(strongest_key, 0),
                     reverse=True)
    for pid, _si, _seg in by_best:
        if pid not in used_pids:
            selected.append((pid, "best"))
            used_pids.add(pid)
            if sum(1 for _, l in selected if l == "best") >= 2:
                break

    # worst_2: lowest score in weakest dimension
    weakest_key = DIM_SCORE_KEY[weakest_dim]
    by_worst = sorted(point_segments,
                      key=lambda x: x[2].get("scores", {}).get(weakest_key, 0))
    for pid, _si, _seg in by_worst:
        if pid not in used_pids:
            selected.append((pid, "worst"))
            used_pids.add(pid)
            if sum(1 for _, l in selected if l == "worst") >= 2:
                break

    # delta_2: points where walkability changes most between adjacent segments
    if len(segments) >= 2:
        seg_walk = [s.get("scores", {}).get("walkability_score", 0) for s in segments]
        deltas = [(i, abs(seg_walk[i] - seg_walk[i - 1])) for i in range(1, len(seg_walk))]
        deltas.sort(key=lambda x: x[1], reverse=True)

        for seg_idx, _delta in deltas:
            seg = segments[seg_idx]
            for pid in seg.get("points", []):
                if pid not in used_pids and pid in point_data_map:
                    selected.append((pid, "transition"))
                    used_pids.add(pid)
                    break
            if sum(1 for _, l in selected if l == "transition") >= 2:
                break

    # Fill remaining slots from unused points
    if len(selected) < 6:
        for pid, _si, _seg in by_best:
            if pid not in used_pids:
                selected.append((pid, "transition"))
                used_pids.add(pid)
                if len(selected) >= 6:
                    break

    # Build evidence list
    evidence = []
    for idx, (pid, label) in enumerate(selected[:6]):
        pt = point_data_map[pid]
        tags = _generate_visual_tags(pt)
        desc = _generate_description(pt, tags)
        evidence.append({
            "id": f"E{idx + 1}",
            "label": label,
            "point_id": pid,
            "lat": pt.get("lat"),
            "lon": pt.get("lon"),
            "thumbnail_url": _build_thumbnail_url(pt),
            "segmentation_top": _top_segmentation(pt),
            "detection": pt.get("detection", {}),
            "perception": pt.get("perception", {}),
            "visual_tags": tags,
            "description": desc,
        })

    return evidence
