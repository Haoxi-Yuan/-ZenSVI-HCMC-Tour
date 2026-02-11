"""SQLite-based cache for LLM responses."""

import sqlite3
import time

from backend.config import CACHE_DIR, LLM_CACHE_TTL_SECONDS

_DB_PATH = CACHE_DIR / "insights_cache.db"
_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
        _conn.execute("""
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at REAL NOT NULL,
                ttl_seconds INTEGER NOT NULL
            )
        """)
        _conn.commit()
    return _conn


def cache_get(key: str) -> str | None:
    """Get a cached value. Returns None if missing or expired."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT value, created_at, ttl_seconds FROM cache WHERE key = ?", (key,)
    ).fetchone()
    if row is None:
        return None
    value, created_at, ttl = row
    if time.time() - created_at > ttl:
        conn.execute("DELETE FROM cache WHERE key = ?", (key,))
        conn.commit()
        return None
    return value


def cache_set(key: str, value: str, ttl: int | None = None) -> None:
    """Set a cache value with TTL."""
    conn = _get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO cache (key, value, created_at, ttl_seconds) VALUES (?, ?, ?, ?)",
        (key, value, time.time(), ttl or LLM_CACHE_TTL_SECONDS),
    )
    conn.commit()


def cache_clear() -> None:
    """Clear all cached entries."""
    conn = _get_conn()
    conn.execute("DELETE FROM cache")
    conn.commit()
