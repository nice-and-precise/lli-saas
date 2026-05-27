"""Daily metrics for the obituary pipeline — the measure-progress layer.

Records how many obituaries are scanned each day (and, over time, leads), so the
pilot's growth and success are observable and trendable. Backed by the same
Upstash KV as state/corpus (KV_REST_API_URL / KV_REST_API_TOKEN); degrades to a
no-op when KV is unconfigured (local dev) so nothing breaks.

Shape (KV key `obituary-engine:metrics:daily`):
    { "2026-05-27": {date, obituaries, by_source, kind, leads_delivered, ...}, ... }
"""

from __future__ import annotations

import json
import logging
import os
from collections import Counter
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

METRICS_KEY = os.getenv("OBITUARY_METRICS_KEY", "obituary-engine:metrics:daily")


def _kv_configured() -> bool:
    return bool(os.getenv("KV_REST_API_URL") and os.getenv("KV_REST_API_TOKEN"))


def _command(command: list) -> dict:
    import requests

    url = os.environ["KV_REST_API_URL"].rstrip("/")
    token = os.environ["KV_REST_API_TOKEN"]
    response = requests.post(url, headers={"Authorization": f"Bearer {token}"}, json=command, timeout=15)
    response.raise_for_status()
    return response.json()


def read_all() -> dict:
    """Return the {date: metrics} map. Empty dict if KV is unconfigured/unreadable."""
    if not _kv_configured():
        return {}
    try:
        result = _command(["GET", METRICS_KEY]).get("result")
        return json.loads(result) if result else {}
    except Exception as error:  # noqa: BLE001 - metrics must never break a scan
        logger.warning("Could not read metrics: %s: %s", type(error).__name__, error)
        return {}


def record_daily(
    date_str: str,
    *,
    obituaries: int,
    by_source: dict | None = None,
    kind: str = "run",
    leads_delivered: int | None = None,
    sources_ok: int | None = None,
    sources_failed: int | None = None,
) -> dict:
    """Upsert one day's metrics. No-op (returns {}) if KV unconfigured. A real
    "run" entry is never clobbered by a "backfill" estimate for the same day."""
    if not _kv_configured():
        return {}
    metrics = read_all()
    existing = metrics.get(date_str, {})
    if kind == "backfill" and existing.get("kind") == "run":
        return metrics

    entry = {
        "date": date_str,
        "obituaries": int(obituaries),
        "by_source": by_source if by_source is not None else existing.get("by_source", {}),
        "kind": kind,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    if leads_delivered is not None:
        entry["leads_delivered"] = int(leads_delivered)
    if sources_ok is not None:
        entry["sources_ok"] = sources_ok
    if sources_failed is not None:
        entry["sources_failed"] = sources_failed

    metrics[date_str] = entry
    _command(["SET", METRICS_KEY, json.dumps(metrics)])
    return metrics


def backfill_from_records(records, *, days: int = 7) -> dict:
    """Seed per-day obituary counts from records' published_at over the last `days`
    days as "backfill" entries (won't overwrite real "run" records). Returns the
    {date: count} it wrote."""
    today = datetime.now(timezone.utc).date()
    counts: Counter = Counter()
    for record in records:
        published = getattr(record, "published_at", None)
        if not published:
            continue
        try:
            published_date = datetime.fromisoformat(published.replace("Z", "+00:00")).date()
        except (ValueError, AttributeError):
            continue
        delta = (today - published_date).days
        if 0 <= delta < days:
            counts[published_date.isoformat()] += 1
    for date_str, count in counts.items():
        record_daily(date_str, obituaries=count, kind="backfill")
    return dict(counts)
