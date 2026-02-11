"""Prompt templates for LLM insight generation."""

SYSTEM_PROMPT = """You are a concise urban walkability analyst for Ho Chi Minh City (HCMC).
You write short, data-driven insights about street walkability for an exhibition platform.
Your audience includes urban planners and curious residents exploring HCMC street quality data.

Rules:
- Write exactly 3-4 sentences.
- Be specific: reference exact scores, percentiles, and driver names from the data provided.
- Use plain language, no jargon. No emojis. No markdown formatting.
- Compare to city averages when relevant.
- Mention the strongest positive driver and the most limiting factor.
- If the street is notably good or bad in a dimension, say so directly.
- Do NOT invent or hallucinate any numbers not present in the input data.
- Output plain text only."""


def build_insight_prompt(
    street_name: str,
    rank_info: dict,
    similar_streets: list,
    drivers: dict,
) -> tuple[str, str]:
    """Build (system_prompt, user_prompt) for street insight generation."""

    dims = rank_info["dimensions"]
    total = rank_info["total_streets"]

    # Format rankings
    rank_lines = []
    for dim, d in dims.items():
        label = "Overall Walkability" if dim == "walkability" else dim.capitalize()
        rank_lines.append(
            f"- {label}: {d['score']:.1f}/10, rank #{d['rank']} of {total} "
            f"(percentile {d['percentile']:.0f}%, {d['label']})"
        )

    # Format drivers
    driver_lines = []
    for dim, info in drivers.items():
        parts = [f"{d['label']}={d['value']:.2f}" for d in info["drivers"]]
        driver_lines.append(f"  {dim.capitalize()} ({info['score']:.1f}/10): {', '.join(parts)}")

    # Format similar streets
    similar_lines = []
    for s in similar_streets[:3]:
        deltas = ", ".join(f"{k}: {v}" for k, v in s["deltas"].items())
        similar_lines.append(f"- {s['name']} (distance: {s['distance']:.2f}, deltas: {deltas})")

    user_prompt = f"""Street: {street_name}
Total streets in HCMC: {total}

Scores and Rankings:
{chr(10).join(rank_lines)}

Key Drivers (intermediate formula variables, each 0-1 scale):
{chr(10).join(driver_lines)}

Most Similar Streets (by combined safety+accessibility+comfort profile):
{chr(10).join(similar_lines) if similar_lines else "  (none)"}

Write a concise insight paragraph about this street's walkability profile."""

    return SYSTEM_PROMPT, user_prompt
