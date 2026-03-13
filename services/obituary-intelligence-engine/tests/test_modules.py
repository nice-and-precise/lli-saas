import base64
import hashlib
import hmac
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.app import app
from src.auth import DEFAULT_AUDIENCE, DEFAULT_ISSUER
from src.collector import (
    CollectionResult,
    ObituaryCollector,
    ObituaryRecord,
    SourceIssueRecord,
    SourceReportRecord,
)
from src.contracts import ObituaryEngineRunScanRequest, OwnerRecord
from src.extractor import HeirExtractor
from src.feed_sources import SUPPLEMENTAL_IOWA_SOURCES, SourceDefinition
from src.matcher import NameMatcher, NicknameIndex
from src.normalization import (
    canonicalize_url,
    detect_out_of_state_survivor_states,
    extract_content_text,
    extract_death_date,
    extract_iowa_location,
    has_survivor_signal,
    is_iowa_relevant,
)
from src.service import ObituaryIntelligenceService, get_service
from src.state_store import ObituaryStateCorruptionError, ObituaryStateStore

os.environ.setdefault("AUTH_JWT_SECRET", "test-jwt-secret")


def build_access_token(
    *,
    sub: str = "pilot@example.com",
    role: str = "operator",
    tenant_id: str = "pilot",
    issuer: str = DEFAULT_ISSUER,
    audience: str = DEFAULT_AUDIENCE,
    secret: str = "test-jwt-secret",
    exp_offset_seconds: int = 3600,
) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": sub,
        "role": role,
        "tenant_id": tenant_id,
        "aud": audience,
        "iss": issuer,
        "exp": int(time.time()) + exp_offset_seconds,
    }

    def encode(value: dict) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("utf-8")

    header_segment = encode(header)
    payload_segment = encode(payload)
    signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode("utf-8"), f"{header_segment}.{payload_segment}".encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode("utf-8")
    return f"{header_segment}.{payload_segment}.{signature}"


def auth_headers(**claims) -> dict[str, str]:
    return {"Authorization": f"Bearer {build_access_token(**claims)}"}


def build_owner(**overrides) -> OwnerRecord:
    payload = {
        "owner_id": "owner-1",
        "owner_name": "Robert Henderson",
        "county": "Boone",
        "state": "IA",
        "acres": 320.0,
        "parcel_ids": ["parcel-1"],
        "mailing_state": "IA",
        "mailing_city": "Boone",
        "mailing_postal_code": "50036",
        "property_address_line_1": None,
        "property_city": "Boone",
        "property_postal_code": "50036",
        "operator_name": "Johnson Farms LLC",
        "crm_source": "monday",
        "raw_source_ref": "board:clients:item:owner-1",
    }
    payload.update(overrides)
    return OwnerRecord.model_validate(payload)


def build_obituary(**overrides) -> ObituaryRecord:
    payload = {
        "source_id": "kwbg_boone",
        "source_label": "KWBG Radio",
        "full_name": "Bob Henderson",
        "obituary_url": "https://example.com/obit",
        "raw_text": (
            "Bob Henderson passed away on March 5, 2026 in Boone, Iowa. "
            "He is survived by son James Henderson of Phoenix, AZ and daughter Carol Metcalfe of Ames, IA. "
            "Funeral services will be held on Saturday."
        )
        * 2,
        "death_date": "2026-03-05",
        "city": "Boone",
        "state": "IA",
        "has_survivor_text": True,
        "out_of_state_heir_likely": True,
        "out_of_state_heir_states": ["AZ"],
        "out_of_state_heir_evidence": "survived by son James Henderson of Phoenix, AZ",
        "published_at": "2026-03-06T00:00:00Z",
    }
    payload.update(overrides)
    return ObituaryRecord(**payload)


def build_collection_result(
    *,
    records: list[ObituaryRecord] | None = None,
    source_reports: list[SourceReportRecord] | None = None,
    errors: list[SourceIssueRecord] | None = None,
    successful_source_ids: list[str] | None = None,
) -> CollectionResult:
    return CollectionResult(
        records=records or [],
        source_reports=source_reports or [],
        errors=errors or [],
        successful_source_ids=successful_source_ids or ["kwbg_boone"],
    )


def test_url_canonicalization_strips_tracking_params() -> None:
    assert canonicalize_url("https://example.com/obit?utm_source=test&fbclid=abc&id=1") == "https://example.com/obit?id=1"


def test_actionability_gate_requires_survivor_signal_and_length() -> None:
    assert has_survivor_signal("Short obit survived by son") is False
    assert has_survivor_signal("She is survived by her son James of Phoenix, AZ. " * 20) is True


def test_out_of_state_detection_finds_non_iowa_state_codes() -> None:
    flag, states, evidence = detect_out_of_state_survivor_states(
        "She is survived by her son James of Phoenix, AZ and daughter Carol of Ames, IA."
    )

    assert flag is True
    assert states == ["AZ"]
    assert "Phoenix, AZ" in evidence


def test_matcher_uses_nickname_expansion_and_location_bonus() -> None:
    nickname_index = NicknameIndex(Path(__file__).resolve().parent.parent / "nicknames.csv")
    matcher = NameMatcher(nickname_index)

    match = matcher.match_obituary(build_obituary(), [build_owner()])

    assert match is not None
    assert match.score >= 95
    assert match.location_bonus_applied is True
    assert match.status == "auto_confirmed"


def test_extractor_falls_back_to_heuristics_without_provider_keys(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    extractor = HeirExtractor()

    result = extractor.extract(
        "Dorothy Mae Henderson is survived by son James Henderson of Phoenix, AZ and daughter Carol Metcalfe of Ames, IA.",
        "Dorothy Mae Henderson",
    )

    assert result is not None
    assert result.deceased_name == "Dorothy Mae Henderson"
    assert len(result.survivors) >= 2


def test_extractor_heuristics_rejects_narrative_false_positives(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    extractor = HeirExtractor()

    result = extractor.extract(
        (
            "Robert Henderson passed away on March 5, 2026 in Boone, Iowa. "
            "He is survived by son James Henderson of Phoenix, AZ and daughter Carol Metcalfe of Ames, IA. "
            "Robert was known for his kindness, his dedication to the land, and his years supporting local civic groups and church activities. "
            "Funeral services will be held on Saturday."
        ),
        "Robert Henderson",
    )

    assert result is not None
    names = [survivor.full_name for survivor in result.survivors]
    assert "James Henderson" in names
    assert "Carol Metcalfe" in names
    assert "his dedication to the land" not in names
    assert "church activities." not in names


def test_extractor_heuristics_rejects_state_only_false_positive(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    extractor = HeirExtractor()

    result = extractor.extract(
        (
            "William Geveshausen is survived by sister Pam Schell of Belton, SC "
            "and South Carolina; son Kyle Geveshausen of Le Mars, IA."
        ),
        "William Geveshausen",
    )

    assert result is not None
    names = [survivor.full_name for survivor in result.survivors]
    assert "Pam Schell" in names
    assert "Kyle Geveshausen" in names
    assert "South Carolina" not in names


def test_extract_death_date_prefers_recent_explicit_date() -> None:
    assert (
        extract_death_date(
            "Robert Henderson passed away on March 5, 2026 in Boone, Iowa.",
            None,
        )
        == "2026-03-05"
    )


def test_extract_death_date_falls_back_to_published_at_when_explicit_date_is_stale() -> None:
    published_at = __import__("datetime").datetime(2026, 3, 12, tzinfo=__import__("datetime").timezone.utc)

    assert (
        extract_death_date(
            "William Timothy Geveshausen passed away on December 2, 1952 after a long obituary page biography.",
            published_at,
        )
        == "2026-03-12"
    )


def test_extract_content_text_strips_page_chrome_before_iowa_relevance_check() -> None:
    html = """
    <html>
      <body>
        <header>Waterloo-Cedar Falls Courier Read Today's E-edition</header>
        <main>
          <article>
            <p>Harry Jacobs, leader of great Buffalo Bills defenses, dies at age 84.</p>
            <p>By Mark Gaughan, Buffalo News reporter.</p>
          </article>
        </main>
        <footer>Weather in Waterloo, IA</footer>
      </body>
    </html>
    """

    text = extract_content_text(html)
    city, state = extract_iowa_location(text)

    assert "Read Today's E-edition" not in text
    assert city is None
    assert state is None
    assert is_iowa_relevant(text, city, state) is False


class StubCollector:
    def __init__(self, result: CollectionResult | None = None) -> None:
        self.result = result or build_collection_result(
            records=[build_obituary()],
            source_reports=[
                SourceReportRecord(
                    source_id="kwbg_boone",
                    label="KWBG Radio",
                    strategy="rss_feed",
                    listing_url="https://www.kwbg.com/feed/",
                    status="healthy",
                    http_status=200,
                    candidate_count=1,
                    obituary_count=1,
                    latest_published_at="2026-03-06T00:00:00Z",
                    region="Central Iowa",
                )
            ],
        )

    def collect(self, *, source_ids, lookback_days):
        return self.result

    def source_health(self, *, source_ids, lookback_days, include_supplemental=False):
        from src.collector import SourceHealthResult

        return SourceHealthResult(
            generated_at="2026-03-06T00:00:00Z",
            proof_target_count=6,
            healthy_source_count=1,
            source_reports=self.result.source_reports,
            errors=self.result.errors,
        )


def test_service_builds_canonical_leads(tmp_path) -> None:
    state_store = ObituaryStateStore(path=str(tmp_path / "state.json"), retention_days=30)
    service = ObituaryIntelligenceService(
        collector=StubCollector(),
        extractor=HeirExtractor(),
        matcher=NameMatcher(NicknameIndex(Path(__file__).resolve().parent.parent / "nicknames.csv")),
        state_store=state_store,
    )

    result = service.run_scan(
        ObituaryEngineRunScanRequest(
            scan_id="scan-1",
            owner_records=[build_owner()],
            lookback_days=7,
        )
    )

    assert result.source == "obituary_intelligence_engine"
    assert len(result.leads) == 1
    assert result.source_reports[0].status == "healthy"
    lead = result.leads[0]
    assert lead.owner_id == "owner-1"
    assert lead.tier == "hot"
    assert lead.out_of_state_states == ["AZ"]
    assert lead.match.status == "auto_confirmed"


def test_fixture_source_is_opt_in_and_builds_structured_heirs(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    state_store = ObituaryStateStore(path=str(tmp_path / "state.json"), retention_days=30)
    service = ObituaryIntelligenceService(
        collector=ObituaryCollector(),
        extractor=HeirExtractor(),
        matcher=NameMatcher(NicknameIndex(Path(__file__).resolve().parent.parent / "nicknames.csv")),
        state_store=state_store,
    )

    result = service.run_scan(
        ObituaryEngineRunScanRequest(
            scan_id="scan-fixture",
            owner_records=[build_owner(owner_name="Robert Henderson", property_city="Boone")],
            lookback_days=30,
            source_ids=["fixture_proof"],
        )
    )

    assert result.source_reports[0].source_id == "fixture_proof"
    assert result.source_reports[0].status == "healthy"
    assert len(result.leads) == 1
    assert result.leads[0].heirs
    assert result.leads[0].heirs[0].name == "James Henderson"


def test_source_health_does_not_include_fixture_source_by_default(tmp_path) -> None:
    state_store = ObituaryStateStore(path=str(tmp_path / "state.json"), retention_days=30)
    service = ObituaryIntelligenceService(
        collector=StubCollector(),
        extractor=HeirExtractor(),
        matcher=NameMatcher(NicknameIndex(Path(__file__).resolve().parent.parent / "nicknames.csv")),
        state_store=state_store,
    )

    result = service.source_health()

    assert all(report.source_id != "fixture_proof" for report in result.source_reports)


def test_service_only_records_matched_fingerprints(tmp_path) -> None:
    state_store = ObituaryStateStore(path=str(tmp_path / "state.json"), retention_days=30)
    service = ObituaryIntelligenceService(
        collector=StubCollector(),
        extractor=HeirExtractor(),
        matcher=NameMatcher(NicknameIndex(Path(__file__).resolve().parent.parent / "nicknames.csv")),
        state_store=state_store,
    )

    first = service.run_scan(
        ObituaryEngineRunScanRequest(
            scan_id="scan-1",
            owner_records=[],
            lookback_days=7,
        )
    )
    second = service.run_scan(
        ObituaryEngineRunScanRequest(
            scan_id="scan-2",
            owner_records=[build_owner()],
            lookback_days=7,
        )
    )

    assert len(first.leads) == 0
    assert len(second.leads) == 1


def test_state_store_rejects_corrupt_json_and_quarantines(tmp_path) -> None:
    state_path = tmp_path / "state.json"
    state_path.write_text("{broken-json", encoding="utf-8")
    store = ObituaryStateStore(path=str(state_path), retention_days=30)

    with pytest.raises(ObituaryStateCorruptionError):
        store.load()

    quarantine_files = list(tmp_path.glob("state.json.corrupt-*"))
    assert quarantine_files
    assert state_path.read_text(encoding="utf-8") == "{broken-json"


def test_state_store_preserves_original_when_atomic_replace_fails(tmp_path, monkeypatch) -> None:
    state_path = tmp_path / "state.json"
    store = ObituaryStateStore(path=str(state_path), retention_days=30)
    store.save({"feed_checkpoints": {"kwbg_boone": "2026-03-06T00:00:00Z"}, "processed_obituaries": []})

    def raise_replace(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr("src.state_store.os.replace", raise_replace)

    with pytest.raises(OSError):
        store.save(
            {
                "feed_checkpoints": {"the_gazette": "2026-03-07T00:00:00Z"},
                "processed_obituaries": [],
            }
        )

    persisted = json.loads(state_path.read_text(encoding="utf-8"))
    assert persisted["feed_checkpoints"] == {"kwbg_boone": "2026-03-06T00:00:00Z"}
    assert list(tmp_path.glob("state.json.tmp-*")) == []


def test_state_store_serializes_concurrent_record_scan_calls(tmp_path) -> None:
    state_path = tmp_path / "state.json"
    store_a = ObituaryStateStore(path=str(state_path), retention_days=30)
    store_b = ObituaryStateStore(path=str(state_path), retention_days=30)

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(
            executor.map(
                lambda store_and_payload: store_and_payload[0].record_scan(**store_and_payload[1]),
                [
                    (
                        store_a,
                        {
                            "source_ids": ["kwbg_boone"],
                            "fingerprints": ["fingerprint-1"],
                            "processed_at": "2026-03-06T00:00:00Z",
                        },
                    ),
                    (
                        store_b,
                        {
                            "source_ids": ["the_gazette"],
                            "fingerprints": ["fingerprint-2"],
                            "processed_at": "2026-03-07T00:00:00Z",
                        },
                    ),
                ],
            )
        )

    persisted = ObituaryStateStore(path=str(state_path), retention_days=30).load()
    assert persisted["feed_checkpoints"]["kwbg_boone"] == "2026-03-06T00:00:00Z"
    assert persisted["feed_checkpoints"]["the_gazette"] == "2026-03-07T00:00:00Z"
    assert {entry["fingerprint"] for entry in persisted["processed_obituaries"]} == {
        "fingerprint-1",
        "fingerprint-2",
    }


def test_service_surfaces_source_errors_without_throwing(tmp_path) -> None:
    state_store = ObituaryStateStore(path=str(tmp_path / "state.json"), retention_days=30)
    service = ObituaryIntelligenceService(
        collector=StubCollector(
            build_collection_result(
                records=[],
                source_reports=[
                    SourceReportRecord(
                        source_id="the_gazette",
                        label="The Gazette",
                        strategy="html_listing_custom",
                        listing_url="https://www.thegazette.com/obituaries/",
                        status="blocked",
                        http_status=429,
                        candidate_count=0,
                        obituary_count=0,
                        error_code="source_fetch_blocked",
                        error_message="Rate limited while fetching https://www.thegazette.com/obituaries/",
                        region="Eastern Iowa",
                    )
                ],
                errors=[
                    SourceIssueRecord(
                        stage="collection",
                        code="source_fetch_blocked",
                        message="Rate limited while fetching https://www.thegazette.com/obituaries/",
                        source_id="the_gazette",
                        details={"status_code": 429},
                    )
                ],
                successful_source_ids=[],
            )
        ),
        extractor=HeirExtractor(),
        matcher=NameMatcher(NicknameIndex(Path(__file__).resolve().parent.parent / "nicknames.csv")),
        state_store=state_store,
    )

    result = service.run_scan(
        ObituaryEngineRunScanRequest(
            scan_id="scan-1",
            owner_records=[build_owner()],
            lookback_days=7,
        )
    )

    assert result.errors[0].code == "source_fetch_blocked"
    assert result.source_reports[0].status == "blocked"
    assert result.leads == []


def test_http_surface_exposes_run_scan_and_source_health(tmp_path) -> None:
    client = TestClient(app)
    service = ObituaryIntelligenceService(
        collector=StubCollector(),
        extractor=HeirExtractor(),
        matcher=NameMatcher(NicknameIndex(Path(__file__).resolve().parent.parent / "nicknames.csv")),
        state_store=ObituaryStateStore(path=str(tmp_path / "state.json"), retention_days=30),
    )
    app.dependency_overrides.clear()
    app.dependency_overrides[get_service] = lambda: service

    run_scan_response = client.post(
        "/run-scan",
        json={
            "scan_id": "scan-1",
            "owner_records": [build_owner().model_dump(mode="json")],
            "lookback_days": 7,
            "reference_date": None,
            "source_ids": [],
        },
        headers=auth_headers(role="service", sub="lead-engine"),
    )
    health_response = client.get("/sources/health", headers=auth_headers())

    assert run_scan_response.status_code == 200
    assert run_scan_response.json()["source"] == "obituary_intelligence_engine"
    assert run_scan_response.json()["source_reports"][0]["status"] == "healthy"
    assert health_response.status_code == 200
    assert health_response.json()["healthy_source_count"] == 1


def test_http_surface_rejects_missing_bearer_token(tmp_path) -> None:
    client = TestClient(app)
    service = ObituaryIntelligenceService(
        collector=StubCollector(),
        extractor=HeirExtractor(),
        matcher=NameMatcher(NicknameIndex(Path(__file__).resolve().parent.parent / "nicknames.csv")),
        state_store=ObituaryStateStore(path=str(tmp_path / "state.json"), retention_days=30),
    )
    app.dependency_overrides.clear()
    app.dependency_overrides[get_service] = lambda: service

    response = client.post(
        "/run-scan",
        json={
            "scan_id": "scan-1",
            "owner_records": [build_owner().model_dump(mode="json")],
            "lookback_days": 7,
            "reference_date": None,
            "source_ids": [],
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token"


def test_http_surface_returns_explicit_state_error_for_corrupt_state(tmp_path) -> None:
    state_path = tmp_path / "state.json"
    state_path.write_text("{broken-json", encoding="utf-8")
    client = TestClient(app)
    service = ObituaryIntelligenceService(
        collector=StubCollector(),
        extractor=HeirExtractor(),
        matcher=NameMatcher(NicknameIndex(Path(__file__).resolve().parent.parent / "nicknames.csv")),
        state_store=ObituaryStateStore(path=str(state_path), retention_days=30),
    )
    app.dependency_overrides.clear()
    app.dependency_overrides[get_service] = lambda: service

    response = client.post(
        "/run-scan",
        json={
            "scan_id": "scan-1",
            "owner_records": [build_owner().model_dump(mode="json")],
            "lookback_days": 7,
            "reference_date": None,
            "source_ids": [],
        },
        headers=auth_headers(role="service", sub="lead-engine"),
    )

    assert response.status_code == 500
    assert response.json()["code"] == "state_corruption"
    assert response.json()["state_path"] == str(state_path)


def test_http_surface_rejects_invalid_bearer_token() -> None:
    client = TestClient(app)

    response = client.get("/sources/health", headers={"Authorization": "Bearer invalid-token"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid bearer token"


def test_http_surface_rejects_spoofed_tenant_header() -> None:
    client = TestClient(app)

    response = client.get(
        "/sources/health",
        headers={
            **auth_headers(),
            "x-tenant-id": "spoofed",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "x-tenant-id does not match authenticated tenant"


def test_health_and_ready_remain_public() -> None:
    client = TestClient(app)

    health_response = client.get("/health")
    ready_response = client.get("/ready")

    assert health_response.status_code == 200
    assert ready_response.status_code == 200


class FakeResponse:
    def __init__(self, text: str, status_code: int = 200) -> None:
        self.text = text
        self.status_code = status_code


class FakeSession:
    def __init__(self, response_map: dict[str, FakeResponse]) -> None:
        self.response_map = response_map
        self.headers: dict[str, str] = {}

    def get(self, url: str, timeout: float):
        return self.response_map[url]


def build_listing_html(*links: tuple[str, str]) -> str:
    anchors = "".join(f'<a href="{href}">{label}</a>' for href, label in links)
    return f"<html><body><main>{anchors}</main></body></html>"


def build_detail_html(*, title: str, city: str, county: str = "Johnson County") -> str:
    return (
        "<html><body><main><article>"
        f"<h1>{title}</h1>"
        f"<p>{title} of {city}, Iowa passed away on March 9, 2026.</p>"
        f"<p>He is survived by family in {county}, Iowa, and funeral services will be held Saturday.</p>"
        "</article></main></body></html>"
    )


def test_scrapling_response_uses_body_payload_before_browser_fallback() -> None:
    collector = ObituaryCollector()

    class ScraplingResponse:
        body = "<html><body><article>Obituary listing</article></body></html>"
        text = None

    assert collector._extract_scrapling_html(ScraplingResponse()) == ScraplingResponse.body


def test_bot_challenge_detection_catches_cloudflare_interstitial() -> None:
    collector = ObituaryCollector()

    assert collector._looks_like_bot_challenge("<html><title>Just a moment...</title></html>") is True
    assert collector._looks_like_bot_challenge("<html><title>Normal obituary page</title></html>") is False


def test_fetch_html_uses_playwright_when_scrapling_returns_challenge(monkeypatch) -> None:
    monkeypatch.setenv("OBITUARY_ENGINE_ENABLE_SCRAPLING", "true")
    collector = ObituaryCollector(session=FakeSession({"https://example.com/": FakeResponse("<html>home</html>")}))
    source = SourceDefinition(
        source_id="test_source",
        label="Test Source",
        strategy="html_listing",
        listing_url="https://example.com/obituaries/",
        homepage_url="https://example.com/",
        region="Test Region",
        requires_session_warmup=True,
    )

    class ChallengeFetcher:
        @staticmethod
        def get(url: str, stealthy_headers: bool = True):
            return "<html><title>Just a moment...</title></html>"

    class BrowserFetcher:
        @staticmethod
        def fetch(url: str, **kwargs):
            return "<html><body><article>Recovered obituary listing</article></body></html>"

    monkeypatch.setattr("src.collector.ScraplingFetcher", ChallengeFetcher)
    monkeypatch.setattr("src.collector.ScraplingPlayWrightFetcher", BrowserFetcher)
    monkeypatch.setattr("src.collector.ScraplingStealthyFetcher", None)

    html = collector._fetch_html(source.listing_url, source, is_listing=True)

    assert "Recovered obituary listing" in html


def test_dahn_woodhouse_is_healthy_with_browser_rendered_listing_only(monkeypatch) -> None:
    source = SourceDefinition(
        source_id="dahn_woodhouse",
        label="Dahn & Woodhouse",
        strategy="html_listing_funeral_home",
        listing_url="https://www.dahnandwoodhouse.com/obituaries",
        homepage_url="https://www.dahnandwoodhouse.com/",
        region="Carroll County",
        always_fetch_full_page=True,
        content_selectors=("main", "article"),
        listing_link_selectors=("a[href*='/obituaries']",),
        browser_render_listing=True,
    )
    detail_url = "https://www.dahnandwoodhouse.com/obituaries/paul-schaben"
    collector = ObituaryCollector(session=FakeSession({detail_url: FakeResponse(build_detail_html(title="Paul Schaben", city="Carroll"))}))
    browser_calls: list[tuple[str, bool]] = []

    def fake_browser_fetch(url: str, *, is_listing: bool) -> str:
        browser_calls.append((url, is_listing))
        assert is_listing is True
        return build_listing_html(("/obituaries/paul-schaben", "Paul Schaben"))

    monkeypatch.setattr(collector, "_fetch_browser_html", fake_browser_fetch)

    records, report = collector._collect_html_source(
        source,
        cutoff_date=None,
        max_links_per_source=5,
        detail_delay_seconds=0.0,
    )

    assert report.status == "healthy"
    assert report.candidate_count == 1
    assert report.obituary_count == 1
    assert records[0].state == "IA"
    assert records[0].city is not None
    assert records[0].city.endswith("Carroll")
    assert browser_calls == [(source.listing_url, True)]


def test_lensing_funeral_home_requires_browser_rendered_detail(monkeypatch) -> None:
    detail_url = "https://www.lensingfuneral.com/obituaries/william-bill-joseph-lancial?obId=47018585"
    listing_url = "https://www.lensingfuneral.com/obituaries/obituary-listings"
    listing_html = build_listing_html(
        (detail_url, 'William "Bill" Joseph Lancial, II Sep 20, 1954 - Jan 18, 2026'),
    )
    source_without_browser_detail = SourceDefinition(
        source_id="lensing_funeral_home",
        label="Lensing Funeral Home",
        strategy="html_listing_funeral_home",
        listing_url=listing_url,
        homepage_url="https://www.lensingfuneral.com/",
        region="Johnson County",
        always_fetch_full_page=True,
        content_selectors=("main", "article"),
        listing_link_selectors=("a[href*='/obituaries']",),
        browser_render_listing=True,
    )
    source_with_browser_detail = SourceDefinition(
        source_id="lensing_funeral_home",
        label="Lensing Funeral Home",
        strategy="html_listing_funeral_home",
        listing_url=listing_url,
        homepage_url="https://www.lensingfuneral.com/",
        region="Johnson County",
        always_fetch_full_page=True,
        content_selectors=("main", "article"),
        listing_link_selectors=("a[href*='/obituaries']",),
        browser_render_listing=True,
        browser_render_detail=True,
    )
    shell_detail_html = (
        "<html><body><main><article>"
        '<p>Official Obituary of William "Bill" Joseph Lancial, II</p>'
        "<p>Loading...</p>"
        "</article></main></body></html>"
    )
    collector_without_browser_detail = ObituaryCollector(
        session=FakeSession({detail_url: FakeResponse(shell_detail_html)})
    )
    collector_with_browser_detail = ObituaryCollector(
        session=FakeSession({detail_url: FakeResponse(shell_detail_html)})
    )

    def fake_listing_browser_fetch(url: str, *, is_listing: bool) -> str:
        assert is_listing is True
        return listing_html

    def fake_full_browser_fetch(url: str, *, is_listing: bool) -> str:
        if is_listing:
            return listing_html
        return build_detail_html(title='William "Bill" Joseph Lancial, II', city="Iowa City")

    monkeypatch.setattr(collector_without_browser_detail, "_fetch_browser_html", fake_listing_browser_fetch)
    monkeypatch.setattr(collector_with_browser_detail, "_fetch_browser_html", fake_full_browser_fetch)

    without_records, without_report = collector_without_browser_detail._collect_html_source(
        source_without_browser_detail,
        cutoff_date=None,
        max_links_per_source=5,
        detail_delay_seconds=0.0,
    )
    with_records, with_report = collector_with_browser_detail._collect_html_source(
        source_with_browser_detail,
        cutoff_date=None,
        max_links_per_source=5,
        detail_delay_seconds=0.0,
    )

    assert without_records == []
    assert without_report.status == "empty"
    assert without_report.candidate_count == 1
    assert with_report.status == "healthy"
    assert with_report.obituary_count == 1
    assert with_records[0].state == "IA"
    assert with_records[0].city is not None
    assert with_records[0].city.endswith("Iowa City")


def test_source_health_counts_supplemental_sources_without_changing_proof_target(monkeypatch) -> None:
    primary_source = SourceDefinition(
        source_id="test_primary",
        label="Test Primary",
        strategy="html_listing_custom",
        listing_url="https://example.com/obituaries/",
        homepage_url="https://example.com/",
        region="Test Region",
        always_fetch_full_page=True,
        content_selectors=("main", "article"),
        listing_link_selectors=("a[href*='/obituaries/']",),
    )
    supplemental_source = SUPPLEMENTAL_IOWA_SOURCES[0]
    detail_html_map = {
        "https://example.com/obituaries/primary-obit": build_detail_html(title="Primary Obit", city="Boone"),
        "https://www.hamiltonsfuneralhome.com/obituaries/hamilton-obit": build_detail_html(
            title="Hamilton Obit",
            city="Des Moines",
            county="Polk County",
        ),
    }
    listing_html_map = {
        primary_source.listing_url: build_listing_html(("/obituaries/primary-obit", "Primary Obit")),
        supplemental_source.listing_url: build_listing_html(("/obituaries/hamilton-obit", "Hamilton Obit")),
    }
    collector = ObituaryCollector(
        html_fetcher=lambda url, source, is_listing: listing_html_map[url] if is_listing else detail_html_map[url]
    )

    monkeypatch.setattr(
        "src.collector.resolve_sources",
        lambda source_ids, include_supplemental=False: [primary_source, supplemental_source],
    )

    result = collector.source_health(source_ids=[], lookback_days=30, include_supplemental=True)

    assert result.proof_target_count == 6
    assert result.healthy_source_count == 2
    assert len(result.source_reports) == 2
    assert any(report.supplemental for report in result.source_reports)


def test_collector_filters_full_feed_entries_by_obituary_keywords() -> None:
    feed = """
    <rss version="2.0">
      <channel>
        <item>
          <title>Community brunch fundraiser this Sunday</title>
          <link>https://www.kwbg.com/community-brunch</link>
          <description>Join us for breakfast and local sports talk.</description>
          <pubDate>Wed, 05 Mar 2026 10:00:00 +0000</pubDate>
        </item>
        <item>
          <title>Robert Henderson obituary</title>
          <link>https://www.kwbg.com/robert-henderson-obituary</link>
          <description>Robert Henderson of Boone, Iowa passed away and is survived by his children.</description>
          <pubDate>Thu, 06 Mar 2026 10:00:00 +0000</pubDate>
        </item>
      </channel>
    </rss>
    """
    source = SourceDefinition(
        source_id="kwbg_boone",
        label="KWBG Radio",
        strategy="rss_feed",
        listing_url="https://www.kwbg.com/feed/",
        feed_url="https://www.kwbg.com/feed/",
        homepage_url="https://www.kwbg.com/",
        region="Central Iowa",
        keyword_filters=("obituary", "passed away", "survived by"),
    )
    collector = ObituaryCollector(
        session=FakeSession({"https://www.kwbg.com/feed/": FakeResponse(feed)}),
        html_fetcher=lambda url, src, is_listing: (
            "Robert Henderson of Boone, Iowa passed away on March 5, 2026. "
            "He is survived by his children and funeral services will be held Saturday."
        ),
    )

    records, report = collector._collect_rss_source(source, cutoff_date=None)

    assert len(records) == 1
    assert report.status == "healthy"
    assert report.candidate_count == 1
