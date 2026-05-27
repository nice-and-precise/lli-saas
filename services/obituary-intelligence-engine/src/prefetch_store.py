"""Shared KV store for the pre-collected obituary corpus.

The GitHub Actions prefetch job writes a large statewide obituary corpus here
(it can run far longer than the 60s Vercel function), and the engine reads it at
scan time and merges it with its quick live RSS pull. Backed by the same Upstash
KV the engine uses for state (KV_REST_API_URL / KV_REST_API_TOKEN).
"""

from __future__ import annotations

import dataclasses
import json
import logging
import os

from src.collector import ObituaryRecord

logger = logging.getLogger(__name__)

PREFETCH_KEY = os.getenv("OBITUARY_PREFETCH_KEY", "obituary-engine:prefetched")


def _command(command: list) -> dict:
    """Run a single Upstash Redis REST command. Raises if KV is not configured."""
    import requests

    url = os.environ["KV_REST_API_URL"].rstrip("/")
    token = os.environ["KV_REST_API_TOKEN"]
    response = requests.post(url, headers={"Authorization": f"Bearer {token}"}, json=command, timeout=15)
    response.raise_for_status()
    return response.json()


def write_prefetched(records: list[ObituaryRecord], *, collected_at: str, ttl_seconds: int = 259200) -> int:
    """Serialize and store the corpus with a TTL (default 3 days). Returns the count written."""
    payload = json.dumps(
        {"collected_at": collected_at, "records": [dataclasses.asdict(record) for record in records]}
    )
    _command(["SET", PREFETCH_KEY, payload, "EX", str(ttl_seconds)])
    return len(records)


def read_prefetched() -> list[ObituaryRecord]:
    """Read the corpus. Returns [] if KV is unconfigured, empty, or unreadable
    (the engine must degrade gracefully to live RSS only)."""
    if not (os.getenv("KV_REST_API_URL") and os.getenv("KV_REST_API_TOKEN")):
        return []
    try:
        result = _command(["GET", PREFETCH_KEY]).get("result")
        if not result:
            return []
        data = json.loads(result)
        return [ObituaryRecord(**record) for record in data.get("records", [])]
    except Exception as error:  # noqa: BLE001 - never let a KV hiccup break a scan
        logger.warning("Could not read prefetched obituary corpus: %s: %s", type(error).__name__, error)
        return []
