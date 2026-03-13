from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from time import sleep
from typing import Any, cast
from urllib.parse import urljoin

import feedparser
import requests
from bs4 import BeautifulSoup

from src.feed_sources import (
    DEFAULT_PROOF_TARGET_COUNT,
    SUPPLEMENTAL_IOWA_SOURCES,
    SourceDefinition,
    resolve_sources,
)
from src.normalization import (
    canonicalize_url,
    detect_out_of_state_survivor_states,
    extract_content_text,
    extract_death_date,
    extract_iowa_location,
    has_survivor_signal,
    html_to_text,
    is_iowa_relevant,
    is_obituary_listing_text,
    isoformat_or_none,
    normalize_whitespace,
    parse_optional_datetime,
)

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}
BOT_CHALLENGE_MARKERS = (
    "just a moment...",
    "cf-browser-verification",
    "cf_chl_opt",
    "challenge-platform",
    "enable javascript and cookies to continue",
)
DEFAULT_FIXTURE_SOURCE_PATH = (
    Path(__file__).resolve().parents[3] / "infra" / "charts" / "lli-saas" / "files" / "obituary-proof-source.json"
)

ScraplingFetcher: Any
ScraplingPlayWrightFetcher: Any
ScraplingStealthyFetcher: Any

try:
    from scrapling.fetchers import Fetcher as _ScraplingFetcher
    from scrapling.fetchers import PlayWrightFetcher as _ScraplingPlayWrightFetcher
    from scrapling.fetchers import StealthyFetcher as _ScraplingStealthyFetcher
except Exception:  # pragma: no cover - optional dependency
    ScraplingFetcher = None
    ScraplingPlayWrightFetcher = None
    ScraplingStealthyFetcher = None
else:
    ScraplingFetcher = _ScraplingFetcher
    ScraplingPlayWrightFetcher = _ScraplingPlayWrightFetcher
    ScraplingStealthyFetcher = _ScraplingStealthyFetcher


def scrapling_enabled() -> bool:
    return os.getenv("OBITUARY_ENGINE_ENABLE_SCRAPLING", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


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


@dataclass
class SourceReportRecord:
    source_id: str
    label: str
    strategy: str
    listing_url: str
    status: str
    http_status: int | None = None
    candidate_count: int = 0
    obituary_count: int = 0
    latest_published_at: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    region: str | None = None
    supplemental: bool = False


@dataclass
class SourceIssueRecord:
    stage: str
    code: str
    message: str
    source_id: str | None = None
    details: dict[str, object] | None = None


@dataclass
class CollectionResult:
    records: list[ObituaryRecord]
    source_reports: list[SourceReportRecord]
    errors: list[SourceIssueRecord]
    successful_source_ids: list[str]


@dataclass
class SourceHealthResult:
    generated_at: str
    proof_target_count: int
    healthy_source_count: int
    source_reports: list[SourceReportRecord]
    errors: list[SourceIssueRecord]


class SourceFetchError(Exception):
    def __init__(self, code: str, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class ObituaryCollector:
    def __init__(
        self,
        *,
        http_timeout_seconds: float = 10.0,
        session: requests.Session | None = None,
        html_fetcher: Callable[[str, SourceDefinition, bool], str] | None = None,
    ) -> None:
        self.http_timeout_seconds = http_timeout_seconds
        self.session = session or requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)
        self.html_fetcher = html_fetcher or self._fetch_html
        self._browser_playwright: Any | None = None
        self._browser_instance: Any | None = None

    def collect(
        self,
        *,
        source_ids: list[str],
        lookback_days: int,
        include_supplemental: bool = False,
        max_links_per_source: int = 25,
        detail_delay_seconds: float = 1.5,
    ) -> CollectionResult:
        sources = resolve_sources(source_ids, include_supplemental=include_supplemental)
        collected: list[ObituaryRecord] = []
        reports: list[SourceReportRecord] = []
        errors: list[SourceIssueRecord] = []
        successful_source_ids: list[str] = []
        cutoff_date: date | None = None
        if lookback_days:
            from src.normalization import utcnow

            cutoff_date = (utcnow() - timedelta(days=lookback_days)).date()

        try:
            for source in sources:
                try:
                    records, report = self._collect_source(
                        source,
                        cutoff_date=cutoff_date,
                        max_links_per_source=max_links_per_source,
                        detail_delay_seconds=detail_delay_seconds,
                    )
                    collected.extend(records)
                    reports.append(report)
                    if report.status not in {"blocked", "error"}:
                        successful_source_ids.append(source.source_id)
                    if report.error_code:
                        errors.append(
                            SourceIssueRecord(
                                stage="collection",
                                code=report.error_code,
                                message=report.error_message or "Source collection issue",
                                source_id=source.source_id,
                                details={
                                    "status": report.status,
                                    "http_status": report.http_status,
                                    "listing_url": report.listing_url,
                                },
                            )
                        )
                except SourceFetchError as exc:
                    status = "blocked" if exc.code == "source_fetch_blocked" else "error"
                    reports.append(
                        SourceReportRecord(
                            source_id=source.source_id,
                            label=source.label,
                            strategy=source.strategy,
                            listing_url=source.listing_url,
                            status=status,
                            http_status=exc.status_code,
                            error_code=exc.code,
                            error_message=exc.message,
                            region=source.region,
                            supplemental=source in SUPPLEMENTAL_IOWA_SOURCES,
                        )
                    )
                    errors.append(
                        SourceIssueRecord(
                            stage="collection",
                            code=exc.code,
                            message=exc.message,
                            source_id=source.source_id,
                            details={"status_code": exc.status_code, "listing_url": source.listing_url},
                        )
                    )
                except Exception as exc:  # pragma: no cover - defensive last resort
                    reports.append(
                        SourceReportRecord(
                            source_id=source.source_id,
                            label=source.label,
                            strategy=source.strategy,
                            listing_url=source.listing_url,
                            status="error",
                            error_code="source_collection_unhandled_error",
                            error_message=str(exc),
                            region=source.region,
                            supplemental=source in SUPPLEMENTAL_IOWA_SOURCES,
                        )
                    )
                    errors.append(
                        SourceIssueRecord(
                            stage="collection",
                            code="source_collection_unhandled_error",
                            message=str(exc),
                            source_id=source.source_id,
                            details={"listing_url": source.listing_url},
                        )
                    )
        finally:
            self._close_browser()

        return CollectionResult(
            records=self._dedupe(collected),
            source_reports=reports,
            errors=errors,
            successful_source_ids=successful_source_ids,
        )

    def source_health(
        self,
        *,
        source_ids: list[str],
        lookback_days: int,
        include_supplemental: bool = False,
    ) -> SourceHealthResult:
        from src.normalization import utcnow

        result = self.collect(
            source_ids=source_ids,
            lookback_days=lookback_days,
            include_supplemental=include_supplemental,
            max_links_per_source=5,
            detail_delay_seconds=0.0,
        )
        healthy_source_count = sum(1 for report in result.source_reports if report.status == "healthy")
        return SourceHealthResult(
            generated_at=isoformat_or_none(utcnow()) or "",
            proof_target_count=DEFAULT_PROOF_TARGET_COUNT,
            healthy_source_count=healthy_source_count,
            source_reports=result.source_reports,
            errors=result.errors,
        )

    def _collect_source(
        self,
        source: SourceDefinition,
        *,
        cutoff_date: date | None,
        max_links_per_source: int,
        detail_delay_seconds: float,
    ) -> tuple[list[ObituaryRecord], SourceReportRecord]:
        if source.listing_url.startswith("fixture://"):
            return self._collect_fixture_source(source, cutoff_date=cutoff_date)
        if source.strategy == "rss_feed":
            return self._collect_rss_source(source, cutoff_date=cutoff_date)
        return self._collect_html_source(
            source,
            cutoff_date=cutoff_date,
            max_links_per_source=max_links_per_source,
            detail_delay_seconds=detail_delay_seconds,
        )

    def _collect_fixture_source(
        self,
        source: SourceDefinition,
        *,
        cutoff_date: date | None,
    ) -> tuple[list[ObituaryRecord], SourceReportRecord]:
        fixture_path = Path(
            os.environ.get(
                "OBITUARY_ENGINE_FIXTURE_SOURCE_PATH",
                str(DEFAULT_FIXTURE_SOURCE_PATH),
            )
        )

        try:
            payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise SourceFetchError(
                "source_fixture_missing",
                f"Fixture source file not found at {fixture_path}",
            ) from exc
        except json.JSONDecodeError as exc:
            raise SourceFetchError(
                "source_fixture_invalid",
                f"Fixture source file is invalid JSON at {fixture_path}",
            ) from exc

        items: list[ObituaryRecord] = []
        latest_published_at = None
        entries = payload.get("obituaries", [])
        if not isinstance(entries, list):
            raise SourceFetchError(
                "source_fixture_invalid",
                f"Fixture source payload must contain an 'obituaries' array at {fixture_path}",
            )

        for entry in entries:
            if not isinstance(entry, dict):
                continue
            published_at = parse_optional_datetime(entry.get("published_at"))
            if published_at:
                iso_published_at = isoformat_or_none(published_at)
                if iso_published_at and (latest_published_at is None or iso_published_at > latest_published_at):
                    latest_published_at = iso_published_at
            if cutoff_date and published_at and published_at.date() < cutoff_date:
                continue
            record = self._build_record(
                source=source,
                title=normalize_whitespace(str(entry.get("title", ""))),
                link=canonicalize_url(str(entry.get("url", "")).strip()),
                raw_text=str(entry.get("raw_text", "")),
                published_at=published_at,
            )
            if record:
                items.append(record)

        report = SourceReportRecord(
            source_id=source.source_id,
            label=source.label,
            strategy=source.strategy,
            listing_url=source.listing_url,
            status=self._resolve_status(items, len(entries), latest_published_at),
            candidate_count=len(entries),
            obituary_count=len(items),
            latest_published_at=latest_published_at,
            region=source.region,
            supplemental=False,
        )
        return items, report

    def _collect_rss_source(
        self,
        source: SourceDefinition,
        *,
        cutoff_date: date | None,
    ) -> tuple[list[ObituaryRecord], SourceReportRecord]:
        response = self._request_with_retries(source.feed_url or source.listing_url)
        feed = feedparser.parse(response.text)
        items: list[ObituaryRecord] = []
        latest_published_at = None
        candidate_count = 0

        for entry in feed.entries:
            title = normalize_whitespace(html_to_text(getattr(entry, "title", "")))
            summary_text = html_to_text(getattr(entry, "summary", None) or getattr(entry, "description", None) or "")
            if source.keyword_filters and not is_obituary_listing_text(title, summary_text):
                continue
            candidate_count += 1
            link = canonicalize_url(getattr(entry, "link", "").strip())
            if not link or not title:
                continue

            published_at = parse_optional_datetime(
                getattr(entry, "published", None) or getattr(entry, "updated", None),
            )
            if published_at:
                iso_published_at = isoformat_or_none(published_at)
                if iso_published_at and (latest_published_at is None or iso_published_at > latest_published_at):
                    latest_published_at = iso_published_at
            if cutoff_date and published_at and published_at.date() < cutoff_date:
                continue

            raw_text = summary_text
            if source.always_fetch_full_page or len(summary_text) < 250:
                fetched_text = self._fetch_page_text(link, source)
                if len(fetched_text) > len(raw_text):
                    raw_text = fetched_text
            record = self._build_record(
                source=source,
                title=title,
                link=link,
                raw_text=raw_text,
                published_at=published_at,
            )
            if record:
                items.append(record)

        report = SourceReportRecord(
            source_id=source.source_id,
            label=source.label,
            strategy=source.strategy,
            listing_url=source.listing_url,
            status=self._resolve_status(items, candidate_count, latest_published_at),
            http_status=response.status_code,
            candidate_count=candidate_count,
            obituary_count=len(items),
            latest_published_at=latest_published_at,
            region=source.region,
            supplemental=source in SUPPLEMENTAL_IOWA_SOURCES,
        )
        return items, report

    def _collect_html_source(
        self,
        source: SourceDefinition,
        *,
        cutoff_date: date | None,
        max_links_per_source: int,
        detail_delay_seconds: float,
    ) -> tuple[list[ObituaryRecord], SourceReportRecord]:
        html = self.html_fetcher(source.listing_url, source, True)
        soup = BeautifulSoup(html, "lxml")
        links = self._extract_listing_links(source, soup)
        items: list[ObituaryRecord] = []
        latest_published_at = None

        for title, link in links[:max_links_per_source]:
            detail_html = self.html_fetcher(link, source, False)
            detail_text = extract_content_text(detail_html, selectors=source.content_selectors)
            published_at = self._extract_published_datetime(detail_html)
            if published_at:
                iso_published_at = isoformat_or_none(published_at)
                if iso_published_at and (latest_published_at is None or iso_published_at > latest_published_at):
                    latest_published_at = iso_published_at
            if cutoff_date and published_at and published_at.date() < cutoff_date:
                continue
            record = self._build_record(
                source=source,
                title=title,
                link=link,
                raw_text=detail_text,
                published_at=published_at,
            )
            if record:
                items.append(record)
            if detail_delay_seconds and source.strategy in {"html_listing_blox", "html_listing_gannett"}:
                sleep(detail_delay_seconds)

        report = SourceReportRecord(
            source_id=source.source_id,
            label=source.label,
            strategy=source.strategy,
            listing_url=source.listing_url,
            status=self._resolve_status(items, len(links), latest_published_at),
            candidate_count=len(links),
            obituary_count=len(items),
            latest_published_at=latest_published_at,
            region=source.region,
            supplemental=source in SUPPLEMENTAL_IOWA_SOURCES,
        )
        return items, report

    def _build_record(
        self,
        *,
        source: SourceDefinition,
        title: str,
        link: str,
        raw_text: str,
        published_at: datetime | None,
    ) -> ObituaryRecord | None:
        normalized_text = normalize_whitespace(raw_text)[:5000]
        if len(normalized_text) < 30:
            return None

        city, state = extract_iowa_location(normalized_text)
        if not is_iowa_relevant(normalized_text, city, state):
            return None

        death_date = extract_death_date(normalized_text, published_at)
        out_of_state_flag, out_of_state_states, evidence = detect_out_of_state_survivor_states(normalized_text)
        return ObituaryRecord(
            source_id=source.source_id,
            source_label=source.label,
            full_name=title,
            obituary_url=link,
            raw_text=normalized_text,
            death_date=death_date,
            city=city,
            state=state,
            has_survivor_text=has_survivor_signal(normalized_text),
            out_of_state_heir_likely=out_of_state_flag,
            out_of_state_heir_states=out_of_state_states,
            out_of_state_heir_evidence=evidence,
            published_at=isoformat_or_none(published_at),
        )

    def _extract_listing_links(self, source: SourceDefinition, soup: BeautifulSoup) -> list[tuple[str, str]]:
        selectors = source.listing_link_selectors or ("a[href*='/obituaries/']",)
        discovered: list[tuple[str, str]] = []
        seen_urls: set[str] = set()

        for selector in selectors:
            for node in soup.select(selector):
                href = normalize_whitespace(str(node.get("href", "")))
                title = normalize_whitespace(node.get_text(" ", strip=True))
                if not href or not title or len(title) < 4:
                    continue
                absolute_href = canonicalize_url(urljoin(source.homepage_url, href))
                if absolute_href in seen_urls or absolute_href.rstrip("/") == source.listing_url.rstrip("/"):
                    continue
                seen_urls.add(absolute_href)
                discovered.append((title, absolute_href))
            if discovered:
                break

        return discovered

    def _fetch_page_text(self, url: str, source: SourceDefinition) -> str:
        html = self.html_fetcher(url, source, False)
        return extract_content_text(html, selectors=source.content_selectors)

    def _coerce_html_payload(self, payload: object) -> str:
        if payload is None:
            return ""
        if isinstance(payload, bytes):
            return payload.decode("utf-8", errors="ignore")

        text = str(payload)
        return "" if text.strip().lower() == "none" else text

    def _extract_scrapling_html(self, response: object) -> str:
        for attribute in ("content", "body", "html_content", "text"):
            candidate = getattr(response, attribute, None)
            html = self._coerce_html_payload(candidate)
            if html:
                return html

        return self._coerce_html_payload(response)

    def _looks_like_bot_challenge(self, html: str) -> bool:
        normalized = html.lower()
        return any(marker in normalized for marker in BOT_CHALLENGE_MARKERS)

    def _should_browser_render(self, source: SourceDefinition, is_listing: bool) -> bool:
        return source.browser_render_listing if is_listing else source.browser_render_detail

    def _get_browser(self) -> Any:
        if self._browser_instance is not None:
            return self._browser_instance

        try:
            from rebrowser_playwright.sync_api import sync_playwright
        except Exception as exc:  # pragma: no cover - optional dependency
            raise ValueError("rebrowser_playwright is not available for obituary browser rendering") from exc

        self._browser_playwright = sync_playwright().start()
        self._browser_instance = self._browser_playwright.chromium.launch(
            headless=True,
            chromium_sandbox=False,
        )
        return self._browser_instance

    def _close_browser(self) -> None:
        if self._browser_instance is not None:
            try:
                self._browser_instance.close()
            finally:
                self._browser_instance = None

        if self._browser_playwright is not None:
            try:
                self._browser_playwright.stop()
            finally:
                self._browser_playwright = None

    def _fetch_browser_html(self, url: str, *, is_listing: bool) -> str:
        browser_timeout_ms = max(int(self.http_timeout_seconds * 1000), 30000)
        browser = self._get_browser()
        page = browser.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=browser_timeout_ms)
            try:
                page.wait_for_load_state("networkidle", timeout=browser_timeout_ms)
            except Exception:
                pass
            page.wait_for_timeout(3000 if is_listing else 1500)
            html = cast(str, page.content())
        finally:
            page.close()

        if not html or self._looks_like_bot_challenge(html):
            raise ValueError(f"Browser fetch returned a blocked or empty HTML payload for {url}")

        return html

    def _fetch_scrapling_browser_html(self, url: str) -> str:
        browser_timeout_ms = max(int(self.http_timeout_seconds * 1000), 30000)

        if ScraplingPlayWrightFetcher is not None:
            page = cast(Any, ScraplingPlayWrightFetcher).fetch(
                url,
                headless=True,
                stealth=True,
                network_idle=True,
                timeout=browser_timeout_ms,
                wait=2000,
            )
            html = self._extract_scrapling_html(page)
            if html and not self._looks_like_bot_challenge(html):
                return html

        if ScraplingStealthyFetcher is not None:
            page = cast(Any, ScraplingStealthyFetcher).fetch(
                url,
                headless=True,
                network_idle=True,
                timeout=browser_timeout_ms,
            )
            html = self._extract_scrapling_html(page)
            if html and not self._looks_like_bot_challenge(html):
                return html

        raise ValueError(f"Scrapling browser fetch returned a blocked or empty HTML payload for {url}")

    def _fetch_html(self, url: str, source: SourceDefinition, is_listing: bool) -> str:
        if is_listing and source.requires_session_warmup:
            self._warm_session(source.homepage_url)

        if self._should_browser_render(source, is_listing):
            try:
                return self._fetch_browser_html(url, is_listing=is_listing)
            except Exception as exc:
                raise SourceFetchError(
                    "source_browser_render_error",
                    f"Browser render failed while fetching {url}: {exc}",
                ) from exc

        if scrapling_enabled() and ScraplingFetcher is not None:
            try:
                response = cast(Any, ScraplingFetcher).get(url, stealthy_headers=True)
                html = self._extract_scrapling_html(response)
                if html and not self._looks_like_bot_challenge(html):
                    return html
                raise ValueError(f"Scrapling returned a blocked or empty HTML payload for {url}")
            except Exception:
                if source.requires_session_warmup and scrapling_enabled():
                    try:
                        return self._fetch_scrapling_browser_html(url)
                    except Exception:
                        pass

        response = self._request_with_retries(url)
        return str(response.text)

    def _request_with_retries(self, url: str) -> requests.Response:
        last_exception: Exception | None = None
        for attempt, delay_seconds in enumerate((0, 1.5, 4.0), start=1):
            if delay_seconds:
                sleep(delay_seconds)
            try:
                response = self.session.get(url, timeout=self.http_timeout_seconds)
            except requests.RequestException as exc:
                last_exception = exc
                continue

            if response.status_code in RETRYABLE_STATUS_CODES and attempt < 3:
                continue
            if response.status_code == 429:
                raise SourceFetchError(
                    "source_fetch_blocked",
                    f"Rate limited while fetching {url}",
                    status_code=response.status_code,
                )
            if response.status_code >= 400:
                raise SourceFetchError(
                    "source_fetch_http_error",
                    f"HTTP {response.status_code} while fetching {url}",
                    status_code=response.status_code,
                )
            return response

        if last_exception is not None:
            raise SourceFetchError("source_fetch_transport_error", str(last_exception)) from last_exception
        raise SourceFetchError("source_fetch_transport_error", f"Failed to fetch {url}")

    def _warm_session(self, homepage_url: str) -> None:
        try:
            self.session.get(homepage_url, timeout=self.http_timeout_seconds)
        except requests.RequestException:
            return

    def _extract_published_datetime(self, html: str) -> datetime | None:
        soup = BeautifulSoup(html, "lxml")
        candidates = [
            *[node.get("content") for node in soup.select("meta[property='article:published_time']")],
            *[node.get("content") for node in soup.select("meta[name='parsely-pub-date']")],
            *[node.get("content") for node in soup.select("meta[name='pubdate']")],
            *[node.get("datetime") for node in soup.select("time[datetime]")],
        ]
        for candidate in candidates:
            if not candidate:
                continue
            candidate_str = str(candidate)
            parsed = parse_optional_datetime(candidate_str)
            if parsed:
                return parsed
            try:
                return parsedate_to_datetime(candidate_str)
            except (TypeError, ValueError, IndexError):
                continue
        return None

    def _resolve_status(
        self,
        items: list[ObituaryRecord],
        candidate_count: int,
        latest_published_at: str | None,
    ) -> str:
        if items:
            return "healthy"
        if candidate_count == 0:
            return "empty"
        if latest_published_at and latest_published_at < "2025-01-01T00:00:00Z":
            return "stale"
        return "stale" if latest_published_at else "empty"

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
