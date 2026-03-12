from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

import feedparser
import requests

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
)


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
    def __init__(self, *, http_timeout_seconds: float = 10.0, session: requests.Session | None = None) -> None:
        self.http_timeout_seconds = http_timeout_seconds
        self.session = session or requests.Session()

    def collect(self, *, source_ids: list[str], lookback_days: int) -> list[ObituaryRecord]:
        sources = resolve_sources(source_ids)
        collected: list[ObituaryRecord] = []
        cutoff_date = None
        if lookback_days:
            from src.normalization import utcnow

            cutoff_date = (utcnow() - timedelta(days=lookback_days)).date()
        for source in sources:
            collected.extend(self._collect_source(source, cutoff_date=cutoff_date))
        return self._dedupe(collected)

    def _collect_source(self, source: RSSSource, *, cutoff_date=None) -> list[ObituaryRecord]:
        response = self.session.get(source.feed_url, timeout=self.http_timeout_seconds)
        response.raise_for_status()
        feed = feedparser.parse(response.text)
        items: list[ObituaryRecord] = []

        for entry in feed.entries:
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
        response = self.session.get(url, timeout=self.http_timeout_seconds)
        response.raise_for_status()
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
