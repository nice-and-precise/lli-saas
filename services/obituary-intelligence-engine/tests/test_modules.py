from pathlib import Path

from fastapi.testclient import TestClient

from src.app import app
from src.collector import ObituaryCollector, ObituaryRecord
from src.contracts import ObituaryEngineRunScanRequest, OwnerRecord
from src.extractor import HeirExtractor
from src.matcher import NameMatcher, NicknameIndex
from src.normalization import canonicalize_url, detect_out_of_state_survivor_states, has_survivor_signal
from src.service import ObituaryIntelligenceService
from src.state_store import ObituaryStateStore


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


def test_url_canonicalization_strips_tracking_params() -> None:
    assert canonicalize_url("https://example.com/obit?utm_source=test&fbclid=abc&id=1") == "https://example.com/obit?id=1"


def test_actionability_gate_requires_survivor_signal_and_length() -> None:
    assert has_survivor_signal("Short obit survived by son") is False
    assert has_survivor_signal(("She is survived by her son James of Phoenix, AZ. " * 20)) is True


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
    obituary = ObituaryRecord(
        source_id="kwbg_boone",
        source_label="KWBG Radio",
        full_name="Bob Henderson",
        obituary_url="https://example.com/obit",
        raw_text="Robert obituary",
        death_date="2026-03-05",
        city="Boone",
        state="IA",
        has_survivor_text=True,
        out_of_state_heir_likely=False,
        out_of_state_heir_states=[],
        out_of_state_heir_evidence=None,
        published_at="2026-03-06T00:00:00Z",
    )

    match = matcher.match_obituary(obituary, [build_owner()])

    assert match is not None
    assert match.score >= 95
    assert match.location_bonus_applied is True
    assert match.status == "auto_confirmed"
    assert match.matched_fields == ["last_name", "first_name", "location"]
    assert any("Location bonus applied" in item for item in match.explanation)


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


class StubCollector:
    def collect(self, *, source_ids, lookback_days):
        return [
            ObituaryRecord(
                source_id="kwbg_boone",
                source_label="KWBG Radio",
                full_name="Bob Henderson",
                obituary_url="https://example.com/obit",
                raw_text="Bob Henderson passed away on March 5, 2026. He is survived by son James Henderson of Phoenix, AZ and daughter Carol Metcalfe of Ames, IA." * 3,
                death_date="2026-03-05",
                city="Boone",
                state="IA",
                has_survivor_text=True,
                out_of_state_heir_likely=True,
                out_of_state_heir_states=["AZ"],
                out_of_state_heir_evidence="survived by son James Henderson of Phoenix, AZ",
                published_at="2026-03-06T00:00:00Z",
            )
        ]


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
    lead = result.leads[0]
    assert lead.owner_id == "owner-1"
    assert lead.tier == "hot"
    assert lead.out_of_state_states == ["AZ"]
    assert lead.match.status == "auto_confirmed"
    assert lead.match.matched_fields == ["last_name", "first_name", "location"]
    assert lead.owner_profile_url == "lli://owner-profile/board:clients:item:owner-1"
    assert lead.obituary_raw_url == "https://example.com/obit"


def test_http_surface_exposes_run_scan(monkeypatch, tmp_path) -> None:
    client = TestClient(app)
    nickname_index = NicknameIndex(Path(__file__).resolve().parent.parent / "nicknames.csv")
    service = ObituaryIntelligenceService(
        collector=StubCollector(),
        extractor=HeirExtractor(),
        matcher=NameMatcher(nickname_index),
        state_store=ObituaryStateStore(path=str(tmp_path / "state.json"), retention_days=30),
    )
    app.dependency_overrides.clear()
    from src.service import get_service

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

    assert response.status_code == 200
    assert response.json()["source"] == "obituary_intelligence_engine"
    assert response.json()["leads"][0]["tier"] == "hot"
