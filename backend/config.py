"""Centralized configuration for the HCMC Tour backend."""

import os
from pathlib import Path


PROJECT_ROOT = Path("/data2/shared/haoxi/projects/ZenSVI")
DATA_DIR = PROJECT_ROOT / "HCMC_Tour" / "data"
IMAGE_DIR = PROJECT_ROOT / "gsv_streetlevel_full"
LAYERS_DIR = DATA_DIR / "layers"
BACKEND_DIR = PROJECT_ROOT / "HCMC_Tour" / "backend"
CACHE_DIR = BACKEND_DIR / "cache"


def _load_env_file(env_path: Path) -> None:
    """Load KEY=VALUE pairs from a local .env file into process env."""
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if (
            (value.startswith('"') and value.endswith('"'))
            or (value.startswith("'") and value.endswith("'"))
        ):
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


_load_env_file(BACKEND_DIR / ".env")

# LLM configuration
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "openai")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o-mini")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
LLM_CACHE_TTL_SECONDS = int(os.environ.get("LLM_CACHE_TTL", str(7 * 24 * 3600)))

# PerceptionSphere data directories
SPHERE_DATA_DIR = DATA_DIR / "sphere"
VOLUNTEER_DATA_DIR = Path("/data2/shared/haoxi/projects/ATTENTION/fieldwork/data")
