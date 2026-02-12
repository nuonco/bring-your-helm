"""Simple TTL dict cache for generated configs."""

import time

_TTL_SECONDS = 3600  # 1 hour
_cache: dict[str, tuple[float, list[dict]]] = {}


def get_cached(key: str) -> list[dict] | None:
    """Return cached files_data if key exists and not expired, else None."""
    entry = _cache.get(key)
    if entry is None:
        return None
    ts, data = entry
    if time.monotonic() - ts > _TTL_SECONDS:
        del _cache[key]
        return None
    return data


def set_cached(key: str, files_data: list[dict]) -> None:
    """Store files_data in cache with current timestamp."""
    _cache[key] = (time.monotonic(), files_data)
