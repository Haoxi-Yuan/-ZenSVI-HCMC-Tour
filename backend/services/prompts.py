"""Prompt templates for LLM insight generation."""

import json


PROMPT_VERSION = "v3_scene_evidence"

SYSTEM_PROMPT = """You are a concise urban walkability analyst for Ho Chi Minh City (HCMC).
You write short, data-driven insights about street walkability for an exhibition platform.
Your audience includes urban planners and curious residents exploring HCMC street quality data.

Rules:
- Write one compact paragraph in 4-6 sentences.
- Follow this exact reasoning order:
  1) Conclusion: overall judgement.
  2) Evidence: 2-3 key numeric facts grounded in scene observations.
  3) Causal explanation: why this profile happens (use drivers and visual evidence).
  4) City comparison: where it sits versus city context.
- You have access to scene_evidence (E1-E6): visual observations from key sampling points along the street. Each contains segmentation proportions, detection counts, perception scores, and visual tags.
- Each conclusion MUST cite at least one evidence ID (e.g., E3) to ground it in visual reality. Weave evidence IDs naturally into your sentences, e.g. "The dense building corridor at E1 (56% building) limits sky exposure..."
- End your paragraph with: "Evidence used: E1, E3, E5" (list all cited IDs).
- Only cite evidence IDs that actually exist in the input data.
- Mention only the metrics that are necessary to support your reasoning; do not try to mention every metric.
- Be specific when you cite numbers (scores, rank, percentile, deltas), but keep language plain and non-technical.
- If the street is notably good or bad in a dimension, say so directly.
- Do NOT invent or hallucinate any numbers not present in the input data.
- Output plain text only (no markdown, no bullet points)."""


def build_insight_prompt(
    street_name: str,
    analysis_payload: dict,
) -> tuple[str, str]:
    """Build (system_prompt, user_prompt) for street insight generation."""

    payload_json = json.dumps(analysis_payload, ensure_ascii=False, indent=2, sort_keys=True)

    user_prompt = f"""Street: {street_name}

Use the structured JSON below as your only source of truth:
{payload_json}

Write one concise paragraph that follows the 4-step reasoning order from the system prompt."""

    return SYSTEM_PROMPT, user_prompt


# ── Story Camera Prompts ──────────────────────────────────────────

STORY_PROMPT_VERSION = "v2_story_evidence"

STORY_SYSTEM_PROMPT = """You are a documentary narrator for a visual walkability study of Ho Chi Minh City.
Write exactly 1-2 sentences (max 40 words) for a map flyover shot.
Be evocative and data-driven. Reference exact numbers from the data provided.
If scene_evidence is provided, reference one evidence point naturally (e.g., "at E1, dense buildings crowd the sidewalk...").
End with: "Evidence: E2" (cite the most relevant point). If no evidence is provided, omit this.
No emojis. No markdown. Plain text only."""


def build_story_prompt(
    shot: dict,
    city_stats: dict,
    rank_info: dict | None = None,
    scene_evidence: list | None = None,
) -> tuple[str, str]:
    """Build (system_prompt, user_prompt) for a story shot narration."""
    ctx = shot.get("data_context", {})
    theme = shot["theme"]
    name = shot.get("street_name")

    lines = [f"Shot theme: {theme}"]

    if name:
        lines.append(f"Street: {name}")
        for dim in ("walkability", "safety", "accessibility", "comfort"):
            val = ctx.get(dim)
            if val is not None:
                lines.append(f"  {dim}: {val}/10")

    if rank_info:
        dims = rank_info.get("dimensions", {})
        total = rank_info.get("total_streets", 0)
        for dim, d in dims.items():
            label = "Overall Walkability" if dim == "walkability" else dim.capitalize()
            lines.append(
                f"  {label}: rank #{d['rank']} of {total} "
                f"(percentile {d['percentile']:.0f}%)"
            )

    if "total_streets" in ctx:
        lines.append(f"Total streets surveyed: {ctx['total_streets']}")
    if "avg_walkability" in ctx:
        lines.append(f"City average walkability: {ctx['avg_walkability']:.1f}/10")
    if "total_districts" in ctx:
        lines.append(f"Districts covered: {ctx['total_districts']}")

    # Include scene evidence for street-based shots
    if scene_evidence:
        lines.append("\nScene evidence:")
        for ev in scene_evidence:
            lines.append(
                f"  {ev['id']} ({ev['label']}): {ev['description']} "
                f"Tags: {', '.join(ev.get('visual_tags', []))}"
            )

    user_prompt = "\n".join(lines)
    user_prompt += "\n\nWrite a short, evocative narration for this flyover shot."

    return STORY_SYSTEM_PROMPT, user_prompt
