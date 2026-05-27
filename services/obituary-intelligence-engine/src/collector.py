from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from datetime import timedelta

import feedparser
from curl_cffi import requests as cffi_requests

from src.feed_sources import RSSSource, resolve_sources
from src.normalization import (
    canonicalize_url,
    detect_out_of_state_survivor_states,
    extract_death_date,
    extract_iowa_location,
    has_survivor_signal,
    html_to_text,
    isoformat_or_none,
    is_iowa_relevant,
    normalize_whitespace,
    parse_optional_datetime,
    utcnow,
)

logger = logging.getLogger(__name__)


@dataclass
class ObituaryRecord:
    source_id: str
    source_label: str
    full_name: str
    obituary_url: str
    raw_text: str
    death_date: str | None
    city: str | None
    state: str | None
    has_survivor_text: bool
    out_of_state_heir_likely: bool
    out_of_state_heir_states: list[str]
    out_of_state_heir_evidence: str | None
    published_at: str | None

    @property
    def fallback_key(self) -> tuple[str, str | None]:
        return (self.full_name.lower(), self.death_date)

    @property
    def fingerprint(self) -> str:
        return self.obituary_url or f"{self.full_name.lower()}::{self.death_date or 'unknown'}"


class ObituaryCollector:
    def __init__(self, *, http_timeout_seconds: float = 10.0, session=None, impersonate: str = "chrome") -> None:
        self.http_timeout_seconds = http_timeout_seconds
        # curl_cffi with TLS/JA3 browser impersonation. The Lee Enterprises BLOX
        # feeds (Waterloo Courier, Quad-City Times, Sioux City Journal, Globe
        # Gazette, Muscatine Journal) return 429 to a default client but serve
        # 200 under Chrome impersonation — the fingerprint, not just the UA, is
        # what their anti-bot checks. (Tests inject a duck-typed fake session.)
        self.session = session or cffi_requests.Session(impersonate=impersonate)
        # Impersonation defeats the burst-429s, so only a light politeness delay.
        self._inter_source_delay = float(os.getenv("OBITUARY_INTER_SOURCE_DELAY_SECONDS", "0.15"))
        # Cap entries parsed per source so a high-volume feed (e.g. Carroll
        # Broadcasting publishes ~200) can't blow the serverless time budget.
        self._max_entries_per_source = int(os.getenv("OBITUARY_MAX_ENTRIES_PER_SOURCE", "6"))
        # Hard cap on total obituaries per scan. Each obituary may trigger a
        # full-page fetch (~1s), so this keeps a run well under Vercel's 60s cap
        # while still spreading coverage across many sources.
        self._max_total = int(os.getenv("OBITUARY_MAX_TOTAL_OBITUARIES", "36"))

    def collect(self, *, source_ids: list[str], lookback_days: int) -> list[ObituaryRecord]:
        sources = resolve_sources(source_ids)
        collected: list[ObituaryRecord] = []
        cutoff_date = None
        if lookback_days:
            cutoff_date = (utcnow() - timedelta(days=lookback_days)).date()
        for index, source in enumerate(sources):
            if len(collected) >= self._max_total:
                break
            if index > 0 and self._inter_source_delay > 0:
                time.sleep(self._inter_source_delay)
            # One dead/blocked feed must not abort the whole scan. Skip sources
            # that fail for any reason (404/429/timeout/network/parse) and continue.
            try:
                collected.extend(self._collect_source(source, cutoff_date=cutoff_date))
            except Exception as error:  # noqa: BLE001 - resilience: never let one source crash the scan
                logger.warning("Skipping obituary source %s (%s): %s: %s", source.source_id, source.feed_url, type(error).__name__, error)

        # Merge the statewide corpus pre-collected by the GitHub Actions job
        # (Legacy.com + full feed sweep) from KV. Heavy collection runs there,
        # off the 60s function clock; here we just add the records and match.
        if os.getenv("OBITUARY_USE_PREFETCH", "1").lower() not in ("0", "false", "no"):
            from src.prefetch_store import read_prefetched

            prefetched = read_prefetched()
            if prefetched:
                logger.info("Merged %d prefetched obituaries from KV corpus", len(prefetched))
                collected.extend(prefetched)

        return self._dedupe(collected)

    def _collect_source(self, source: RSSSource, *, cutoff_date=None) -> list[ObituaryRecord]:
        response = self.session.get(source.feed_url, timeout=self.http_timeout_seconds)
        response.raise_for_status()
        feed = feedparser.parse(response.text)
        items: list[ObituaryRecord] = []

        for entry in feed.entries[: self._max_entries_per_source]:
            link = canonicalize_url(getattr(entry, "link", "").strip())
            title = normalize_whitespace(html_to_text(getattr(entry, "title", "")))
            if not link or not title:
                continue

            published_at = parse_optional_datetime(
                getattr(entry, "published", None) or getattr(entry, "updated", None),
            )
            if cutoff_date and published_at and published_at.date() < cutoff_date:
                continue
            summary_text = html_to_text(getattr(entry, "summary", None) or getattr(entry, "description", None) or "")
            raw_text = summary_text
            if source.always_fetch_full_page or len(summary_text) < 250:
                fetched_text = self._fetch_page_text(link)
                if len(fetched_text) > len(raw_text):
                    raw_text = fetched_text
            raw_text = normalize_whitespace(raw_text)[:5000]
            if len(raw_text) < 30:
                continue

            city, state = extract_iowa_location(raw_text)
            if not is_iowa_relevant(raw_text, city, state):
                continue

            death_date = extract_death_date(raw_text, published_at)
            out_of_state_flag, out_of_state_states, evidence = detect_out_of_state_survivor_states(raw_text)
            items.append(
                ObituaryRecord(
                    source_id=source.source_id,
                    source_label=source.label,
                    full_name=title,
                    obituary_url=link,
                    raw_text=raw_text,
                    death_date=death_date,
                    city=city,
                    state=state,
                    has_survivor_text=has_survivor_signal(raw_text),
                    out_of_state_heir_likely=out_of_state_flag,
                    out_of_state_heir_states=out_of_state_states,
                    out_of_state_heir_evidence=evidence,
                    published_at=isoformat_or_none(published_at),
                )
            )
        return items

    def _fetch_page_text(self, url: str) -> str:
        # A single unreachable article page should not drop the obituary; fall
        # back to the RSS summary text by returning an empty string on error.
        try:
            response = self.session.get(url, timeout=self.http_timeout_seconds)
            response.raise_for_status()
        except Exception as error:  # noqa: BLE001 - fall back to RSS summary on any page-fetch error
            logger.warning("Failed to fetch obituary page %s: %s", url, error)
            return ""
        return html_to_text(response.text)

    def _dedupe(self, records: list[ObituaryRecord]) -> list[ObituaryRecord]:
        canonical: dict[str, ObituaryRecord] = {}
        fallback: dict[tuple[str, str | None], ObituaryRecord] = {}

        for record in records:
            existing = canonical.get(record.obituary_url)
            if existing is None or len(record.raw_text) > len(existing.raw_text):
                canonical[record.obituary_url] = record

        for record in canonical.values():
            existing = fallback.get(record.fallback_key)
            if existing is None or len(record.raw_text) > len(existing.raw_text):
                fallback[record.fallback_key] = record

        return list(fallback.values())
