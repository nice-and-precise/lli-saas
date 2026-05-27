"""GitHub Actions entrypoint: build the statewide Iowa obituary corpus and write
it to KV for the engine to read at scan time.

Runs off the 60s Vercel clock, so it can sweep every RSS feed thoroughly AND walk
Legacy.com's Iowa regional pages (100+ funeral-home detail pages). The engine
then merges this corpus with its quick live RSS pull (see collector.collect()).

Run from the service directory: `python prefetch_obituaries.py`.
Requires KV_REST_API_URL / KV_REST_API_TOKEN in the environment.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

# This job WRITES the corpus; it must not try to read+merge it while collecting.
os.environ["OBITUARY_USE_PREFETCH"] = "0"

from src.collector import ObituaryCollector  # noqa: E402
from src.legacy_collector import LegacyObituaryCollector  # noqa: E402
from src.prefetch_store import write_prefetched  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("prefetch")


def main() -> None:
    lookback = int(os.getenv("PREFETCH_LOOKBACK_DAYS", "10"))

    rss = ObituaryCollector().collect(source_ids=[], lookback_days=lookback)
    logger.info("RSS feeds yielded %d obituaries", len(rss))

    legacy = LegacyObituaryCollector().collect()
    logger.info("Legacy.com yielded %d obituaries", len(legacy))

    # Dedupe by fingerprint (URL, or name+death_date fallback). RSS wins ties by
    # insertion order; both already produce clean ObituaryRecords.
    by_fingerprint: dict[str, object] = {}
    for record in [*rss, *legacy]:
        by_fingerprint.setdefault(record.fingerprint, record)
    records = list(by_fingerprint.values())

    count = write_prefetched(records, collected_at=datetime.now(timezone.utc).isoformat())
    logger.info("Wrote %d deduped obituaries to KV (rss=%d legacy=%d)", count, len(rss), len(legacy))
    print(f"prefetch complete: wrote {count} obituaries (rss={len(rss)} legacy={len(legacy)})")


if __name__ == "__main__":
    main()
