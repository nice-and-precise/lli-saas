"""Legacy.com statewide obituary discovery collector.

Legacy.com aggregates Iowa obituaries from funeral homes and newspapers. Its
regional browse pages (e.g. /us/obituaries/local/iowa) are robots-allowed and
render a list of links to individual obituary pages (mostly funeral-home sites,
plus legacy.com/us/obituaries/name/<slug> detail pages). We extract those links,
fetch each detail page, and normalize it into the same ObituaryRecord shape the
RSS collector produces.

This is intentionally NOT run inside the Vercel function (100+ detail fetches
blow the 60s budget). It runs in the GitHub Actions prefetch job, which writes
the corpus to KV for the engine to read. It uses curl_cffi Chrome impersonation
on robots-allowed pages only — no anti-bot bypass, no robots-disallowed APIs.
"""

from __future__ import annotations

import logging
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from curl_cffi import requests as cffi_requests

from src.collector import ObituaryRecord
from src.normalization import (
    canonicalize_url,
    detect_out_of_state_survivor_states,
    extract_death_date,
    extract_iowa_location,
    has_survivor_signal,
    html_to_text,
    is_iowa_relevant,
    normalize_whitespace,
)

logger = logging.getLogger(__name__)

# Robots-allowed Legacy.com Iowa regional browse pages (no /api/, no disallowed paths).
DEFAULT_LEGACY_PAGES = [
    "https://www.legacy.com/us/obituaries/local/iowa",
    "https://www.legacy.com/us/obituaries/local/iowa/des-moines-area",
    "https://www.legacy.com/us/obituaries/local/iowa/iowa-city-area",
    "https://www.legacy.com/us/obituaries/local/iowa/council-bluffs",
    "https://www.legacy.com/us/obituaries/local/iowa/story-county",
]

_NAME_SLUG_RE = re.compile(r"/obituaries/(?:name/)?([^/?#]+)")


def _name_from_url(url: str) -> str:
    match = _NAME_SLUG_RE.search(url)
    if not match:
        return ""
    slug = re.sub(r"-?obituary$", "", match.group(1))
    return " ".join(part.capitalize() for part in re.split(r"[-_]", slug) if part)


class LegacyObituaryCollector:
    def __init__(
        self,
        *,
        pages: list[str] | None = None,
        http_timeout_seconds: float = 15.0,
        max_per_page: int = 60,
        session=None,
        impersonate: str = "chrome",
    ) -> None:
        self.pages = pages or DEFAULT_LEGACY_PAGES
        self.http_timeout_seconds = http_timeout_seconds
        self.max_per_page = max_per_page
        self.session = session or cffi_requests.Session(impersonate=impersonate)

    def collect(self) -> list[ObituaryRecord]:
        records: list[ObituaryRecord] = []
        seen_urls: set[str] = set()
        for page in self.pages:
            try:
                records.extend(self._collect_page(page, seen_urls))
            except Exception as error:  # noqa: BLE001 - one bad regional page must not abort the run
                logger.warning("Skipping Legacy page %s: %s: %s", page, type(error).__name__, error)
        return records

    def _detail_links(self, listing_html: str, base_url: str) -> list[tuple[str, str]]:
        soup = BeautifulSoup(listing_html, "html.parser")
        pairs: list[tuple[str, str]] = []
        seen: set[str] = set()
        for anchor in soup.find_all("a", href=True):
            href = anchor["href"].strip()
            if "/obituaries/" not in href:
                continue
            # Skip regional/listing links (e.g. /us/obituaries/local/iowa/ames) and
            # the bare section root; keep individual obituary detail pages only.
            if "/local/" in href or href.rstrip("/").endswith("/obituaries"):
                continue
            # Resolve relative legacy.com links to absolute, then strip tracking params.
            url = canonicalize_url(urljoin(base_url, href))
            if not url or url in seen:
                continue
            seen.add(url)
            name = _name_from_url(url)
            if name:
                pairs.append((name, url))
        return pairs

    def _collect_page(self, page_url: str, seen_urls: set[str]) -> list[ObituaryRecord]:
        listing = self.session.get(page_url, timeout=self.http_timeout_seconds)
        listing.raise_for_status()
        items: list[ObituaryRecord] = []
        for name, url in self._detail_links(listing.text, page_url)[: self.max_per_page]:
            if url in seen_urls:
                continue
            seen_urls.add(url)
            record = self._build_record(name, url)
            if record is not None:
                items.append(record)
        return items

    def _build_record(self, name: str, url: str) -> ObituaryRecord | None:
        try:
            detail = self.session.get(url, timeout=self.http_timeout_seconds)
            detail.raise_for_status()
        except Exception as error:  # noqa: BLE001 - skip an unreachable detail page
            logger.warning("Failed to fetch Legacy detail %s: %s", url, error)
            return None

        raw_text = normalize_whitespace(html_to_text(detail.text))[:5000]
        if len(raw_text) < 30:
            return None
        city, state = extract_iowa_location(raw_text)
        if not is_iowa_relevant(raw_text, city, state):
            return None

        out_of_state_flag, out_of_state_states, evidence = detect_out_of_state_survivor_states(raw_text)
        return ObituaryRecord(
            source_id="legacy_com",
            source_label="Legacy.com (Iowa)",
            full_name=name,
            obituary_url=url,
            raw_text=raw_text,
            death_date=extract_death_date(raw_text, None),
            city=city,
            state=state,
            has_survivor_text=has_survivor_signal(raw_text),
            out_of_state_heir_likely=out_of_state_flag,
            out_of_state_heir_states=out_of_state_states,
            out_of_state_heir_evidence=evidence,
            published_at=None,
        )
