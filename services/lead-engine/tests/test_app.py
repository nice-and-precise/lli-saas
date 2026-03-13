import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from src.app import app
from src.auth import DEFAULT_AUDIENCE, DEFAULT_ISSUER
from src.contracts import (
    LEAD_CONTRACT_PATH,
    OWNER_RECORD_CONTRACT_PATH,
    SCAN_RESULT_CONTRACT_PATH,
    Lead,
    load_lead_schema,
    load_scan_result_schema,
)
from src.crm_adapter import CRMAdapterClient, CRMAdapterError
from src.obituary_engine import (
    HttpObituaryEngine,
    ObituaryEngineError,
    ObituaryEngineScanRequest,
    ObituaryEngineScanResult,
)
from src.owner_corpus import OwnerFetchResponse, OwnerRecord
from src.scan_service import ScanService, get_scan_service

client = TestClient(app)
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


def build_owner_record(**overrides) -> OwnerRecord:
    payload = {
        "owner_id": "owner-1",
        "owner_name": "Jordan Example",
        "county": "Boone",
        "state": "IA",
        "acres": 120.5,
        "parcel_ids": ["parcel-1"],
        "mailing_state": "IA",
        "mailing_city": "Boone",
        "mailing_postal_code": "50036",
        "property_address_line_1": "123 County Road",
        "property_city": "Boone",
        "property_postal_code": "50036",
        "operator_name": "Johnson Farms LLC",
        "crm_source": "monday",
        "raw_source_ref": "board:clients:item:owner-1",
    }
    payload.update(overrides)
    return OwnerRecord.model_validate(payload)


def build_lead(**overrides) -> Lead:
    payload = {
        "scan_id": "scan-1",
        "source": "obituary_intelligence_engine",
        "run_started_at": "2026-03-11T10:00:00Z",
        "run_completed_at": "2026-03-11T10:01:00Z",
        "owner_id": "owner-1",
        "owner_name": "Jordan Example",
        "deceased_name": "Pat Example",
        "property": {
            "county": "Boone",
            "state": "IA",
            "acres": 120.5,
            "parcel_ids": ["parcel-1"],
            "address_line_1": "123 County Road",
            "city": "Boone",
            "postal_code": "50036",
            "operator_name": "Johnson Farms LLC",
        },
        "heirs": [
            {
                "name": "Casey Example",
                "relationship": "son",
                "location_city": "Phoenix",
                "location_state": "AZ",
                "out_of_state": True,
                "phone": None,
                "email": None,
                "mailing_address": None,
                "executor": False,
            }
        ],
        "obituary": {
            "url": "https://example.com/obit",
            "source_id": "kwbg_boone",
            "published_at": "2026-03-11T10:00:00Z",
            "death_date": "2026-03-10",
            "deceased_city": "Boone",
            "deceased_state": "IA",
        },
        "match": {
            "score": 97.0,
            "last_name_score": 100.0,
            "first_name_score": 92.0,
            "location_bonus_applied": True,
            "status": "auto_confirmed",
        },
        "tier": "hot",
        "out_of_state_heir_likely": True,
        "out_of_state_states": ["AZ"],
        "executor_mentioned": False,
        "unexpected_death": False,
        "notes": ["pilot-ready"],
        "tags": ["tier:hot"],
        "raw_artifacts": ["artifact-1.json"],
    }
    payload.update(overrides)
    return Lead.model_validate(payload)


def test_healthcheck(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_JWT_SECRET", "test-jwt-secret")
    monkeypatch.setenv("CRM_ADAPTER_BASE_URL", "http://crm-adapter:3000")
    monkeypatch.setenv("OBITUARY_ENGINE_BASE_URL", "http://obituary-engine:8080")

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "lead-engine",
        "crm_adapter_base_url_configured": "true",
        "obituary_engine_base_url_configured": "true",
    }


def test_readiness_rejects_missing_required_configuration(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_JWT_SECRET", "test-jwt-secret")
    monkeypatch.delenv("CRM_ADAPTER_BASE_URL", raising=False)
    monkeypatch.delenv("OBITUARY_ENGINE_BASE_URL", raising=False)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "service": "lead-engine",
        "missing_configuration": ["CRM_ADAPTER_BASE_URL", "OBITUARY_ENGINE_BASE_URL"],
    }


def test_readiness_rejects_unreachable_obituary_engine(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_JWT_SECRET", "test-jwt-secret")
    monkeypatch.setenv("CRM_ADAPTER_BASE_URL", "http://crm-adapter:3000")
    monkeypatch.setenv("OBITUARY_ENGINE_BASE_URL", "http://obituary-engine:8080")

    def raise_connect_error(*args, **kwargs):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr("src.app.httpx.get", raise_connect_error)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json()["dependency_failures"][0]["reason"] == "unreachable"


def test_contract_endpoint_exposes_canonical_schema_paths() -> None:
    response = client.get("/contract", headers=auth_headers())

    assert response.status_code == 200
    assert response.json() == {
        "lead_contract_path": str(LEAD_CONTRACT_PATH),
        "owner_record_contract_path": str(OWNER_RECORD_CONTRACT_PATH),
        "scan_result_contract_path": str(SCAN_RESULT_CONTRACT_PATH),
    }
    assert Path(response.json()["lead_contract_path"]).is_file()
    assert Path(response.json()["owner_record_contract_path"]).is_file()
    assert Path(response.json()["scan_result_contract_path"]).is_file()


def test_lead_model_matches_shared_schema_expectations() -> None:
    lead = build_lead()
    schema = load_lead_schema()

    assert lead.scan_id == "scan-1"
    assert schema["title"] == "Lead"
    assert "heirs" in schema["required"]


def test_scan_result_schema_exposes_source_reports() -> None:
    schema = load_scan_result_schema()

    assert schema["title"] == "ScanResult"
    assert "source_reports" in schema["required"]
    assert schema["properties"]["source_reports"]["type"] == "array"


class StubCRMAdapterClient:
    def __init__(self, *, fail_fetch: bool = False, fail_delivery_for: set[str] | None = None) -> None:
        self.fail_fetch = fail_fetch
        self.fail_delivery_for = fail_delivery_for or set()
        self.delivered_leads: list[Lead] = []

    def fetch_owner_records(self, *, owner_limit: int, bearer_token: str) -> OwnerFetchResponse:
        assert bearer_token
        tenant_id = "pilot"
        assert tenant_id == "pilot"
        assert owner_limit == 2
        if self.fail_fetch:
            raise CRMAdapterError(
                code="crm_fetch_transport_error",
                message="Failed to reach crm-adapter while fetching owner records",
                details={"error": "connection refused"},
            )

        return OwnerFetchResponse.model_validate(
            {
                "tenant_id": tenant_id,
                "source_board": {"id": "clients-board", "name": "Clients"},
                "owner_count": 2,
                "owners": [
                    build_owner_record().model_dump(mode="json"),
                    build_owner_record(
                        owner_id="owner-2",
                        owner_name="Taylor Example",
                        parcel_ids=["parcel-2"],
                    ).model_dump(mode="json"),
                ],
            }
        )

    def deliver_lead(self, *, lead: Lead, bearer_token: str) -> dict:
        assert bearer_token
        tenant_id = "pilot"
        assert tenant_id == "pilot"
        self.delivered_leads.append(lead)
        if lead.deceased_name in self.fail_delivery_for:
            raise CRMAdapterError(
                code="crm_delivery_http_error",
                message="crm-adapter reported a lead delivery failure",
                details={"status_code": 502},
            )

        return {
            "tenant_id": tenant_id,
            "board_id": "board-1",
            "delivery_id": f"delivery-{lead.deceased_name}",
            "status": "created",
            "item_id": f"item-{lead.deceased_name}",
            "item_name": f"{lead.deceased_name} - {lead.property.county} County",
        }


class StubObituaryEngine:
    def __init__(self, *, fail: bool = False, source_reports: list[dict] | None = None, errors: list[dict] | None = None, leads: list[Lead] | None = None) -> None:
        self.fail = fail
        self.last_request: ObituaryEngineScanRequest | None = None
        self.source_reports = source_reports or []
        self.errors = errors or []
        self.leads = leads

    def run_scan(self, request: ObituaryEngineScanRequest, *, bearer_token: str) -> ObituaryEngineScanResult:
        assert bearer_token
        self.last_request = request
        if self.fail:
            raise ObituaryEngineError(
                code="obituary_engine_transport_error",
                message="Failed to reach obituary_intelligence_engine",
                details={"error": "connection refused"},
            )

        return ObituaryEngineScanResult(
            source="obituary_intelligence_engine",
            run_started_at="2026-03-11T10:00:00Z",
            run_completed_at="2026-03-11T10:01:00Z",
            leads=self.leads
            if self.leads is not None
            else [
                build_lead(),
                build_lead(
                    owner_id="owner-2",
                    owner_name="Taylor Example",
                    deceased_name="Taylor Example",
                    tier="pending_review",
                    match={
                        "score": 89.0,
                        "last_name_score": 96.0,
                        "first_name_score": 80.0,
                        "location_bonus_applied": False,
                        "status": "pending_review",
                    },
                    out_of_state_heir_likely=False,
                    out_of_state_states=[],
                    obituary={
                        "url": "https://example.com/obit-2",
                        "source_id": "the_gazette",
                        "published_at": "2026-03-11T11:00:00Z",
                        "death_date": "2026-03-09",
                        "deceased_city": "Ames",
                        "deceased_state": "IA",
                    },
                ),
            ],
            source_reports=self.source_reports,
            errors=self.errors,
        )


def install_service(stub_service: ScanService) -> None:
    app.dependency_overrides[get_scan_service] = lambda: stub_service


def test_run_scan_returns_completed_result() -> None:
    crm_adapter = StubCRMAdapterClient()
    obituary_engine = StubObituaryEngine(
        source_reports=[
            {
                "source_id": "kwbg_boone",
                "label": "KWBG Radio",
                "strategy": "rss_feed",
                "listing_url": "https://www.kwbg.com/feed/",
                "status": "healthy",
                "http_status": 200,
                "candidate_count": 1,
                "obituary_count": 1,
                "latest_published_at": "2026-03-11T10:00:00Z",
                "error_code": None,
                "error_message": None,
                "region": "Central Iowa",
                "supplemental": False,
            }
        ]
    )
    install_service(ScanService(crm_adapter_client=crm_adapter, obituary_engine=obituary_engine))

    response = client.post(
        "/run-scan",
        json={
            "owner_limit": 2,
            "lookback_days": 7,
            "reference_date": "2026-03-11",
            "source_ids": ["kwbg_boone"],
        },
        headers=auth_headers(),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["owner_count"] == 2
    assert payload["lead_count"] == 2
    assert payload["delivery_summary"]["created"] == 2
    assert payload["leads"][0]["owner_id"] == "owner-1"
    assert payload["leads"][0]["heirs"][0]["out_of_state"] is True
    assert payload["source_reports"][0]["source_id"] == "kwbg_boone"
    assert payload["source_reports"][0]["status"] == "healthy"
    assert obituary_engine.last_request is not None
    assert obituary_engine.last_request.lookback_days == 7
    assert obituary_engine.last_request.reference_date == "2026-03-11"
    assert obituary_engine.last_request.source_ids == ["kwbg_boone"]


def test_run_scan_rejects_invalid_owner_limit() -> None:
    response = client.post("/run-scan", json={"owner_limit": 10001}, headers=auth_headers())
    assert response.status_code == 422


def test_run_scan_rejects_missing_bearer_token() -> None:
    response = client.post("/run-scan", json={"owner_limit": 2})

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token"


def test_run_scan_rejects_invalid_bearer_token() -> None:
    response = client.post(
        "/run-scan",
        json={"owner_limit": 2},
        headers={"Authorization": "Bearer invalid-token"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid bearer token"


def test_run_scan_rejects_spoofed_tenant_header() -> None:
    response = client.post(
        "/run-scan",
        json={"owner_limit": 2},
        headers={
            **auth_headers(),
            "x-tenant-id": "spoofed",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "x-tenant-id does not match authenticated tenant"


def test_crm_adapter_client_rejects_malformed_owner_payload(monkeypatch) -> None:
    class FakeResponse:
        status_code = 200
        text = '{"owners":"bad"}'

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"owners": "bad"}

    monkeypatch.setattr("src.crm_adapter.httpx.get", lambda *args, **kwargs: FakeResponse())
    client = CRMAdapterClient(base_url="http://crm-adapter")

    with pytest.raises(CRMAdapterError) as exc_info:
        client.fetch_owner_records(owner_limit=2, bearer_token="token-123")

    assert exc_info.value.code == "invalid_owner_records_payload"


def test_obituary_engine_client_rejects_malformed_scan_payload(monkeypatch) -> None:
    class FakeResponse:
        status_code = 200
        text = '{"leads":"bad"}'

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"source": "obituary_intelligence_engine", "run_started_at": "2026-03-11T10:00:00Z", "run_completed_at": "2026-03-11T10:01:00Z", "leads": "bad", "source_reports": [], "errors": []}

    monkeypatch.setattr("src.obituary_engine.httpx.post", lambda *args, **kwargs: FakeResponse())
    client = HttpObituaryEngine(base_url="http://obituary-engine")

    with pytest.raises(ObituaryEngineError) as exc_info:
        client.run_scan(
            ObituaryEngineScanRequest(
                scan_id="scan-1",
                owner_records=[build_owner_record()],
                lookback_days=7,
            ),
            bearer_token="token-123",
        )

    assert exc_info.value.code == "invalid_obituary_engine_payload"


def test_run_scan_returns_partial_on_delivery_failure() -> None:
    crm_adapter = StubCRMAdapterClient(fail_delivery_for={"Taylor Example"})
    obituary_engine = StubObituaryEngine()
    install_service(ScanService(crm_adapter_client=crm_adapter, obituary_engine=obituary_engine))

    response = client.post("/run-scan", json={"owner_limit": 2}, headers=auth_headers())

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "partial"
    assert payload["delivery_summary"] == {
        "created": 1,
        "skipped_duplicate": 0,
        "failed": 1,
    }
    assert payload["errors"][0]["stage"] == "lead_delivery"


def test_run_scan_returns_upstream_failure_when_owner_fetch_fails() -> None:
    install_service(
        ScanService(
            crm_adapter_client=StubCRMAdapterClient(fail_fetch=True),
            obituary_engine=StubObituaryEngine(),
        )
    )

    response = client.post(
        "/run-scan",
        json={"owner_limit": 2},
        headers=auth_headers(role="service", sub="lead-engine"),
    )

    assert response.status_code == 502
    payload = response.json()
    assert payload["status"] == "failed"
    assert payload["source_reports"] == []
    assert payload["errors"][0]["stage"] == "crm_fetch"


def test_run_scan_returns_upstream_failure_when_obituary_engine_fails() -> None:
    install_service(
        ScanService(
            crm_adapter_client=StubCRMAdapterClient(),
            obituary_engine=StubObituaryEngine(fail=True),
        )
    )

    response = client.post("/run-scan", json={"owner_limit": 2}, headers=auth_headers())

    assert response.status_code == 502
    payload = response.json()
    assert payload["status"] == "failed"
    assert payload["source_reports"] == []
    assert payload["errors"][0]["stage"] == "obituary_engine"


def test_run_scan_surfaces_obituary_source_errors_without_transport_failure() -> None:
    install_service(
        ScanService(
            crm_adapter_client=StubCRMAdapterClient(),
            obituary_engine=StubObituaryEngine(
                leads=[],
                source_reports=[
                    {
                        "source_id": "the_gazette",
                        "label": "The Gazette",
                        "strategy": "html_listing_custom",
                        "listing_url": "https://www.thegazette.com/obituaries/",
                        "status": "blocked",
                        "http_status": 429,
                        "candidate_count": 0,
                        "obituary_count": 0,
                        "latest_published_at": None,
                        "error_code": "source_fetch_blocked",
                        "error_message": "Rate limited",
                        "region": "Eastern Iowa",
                        "supplemental": False,
                    }
                ],
                errors=[
                    {
                        "stage": "collection",
                        "code": "source_fetch_blocked",
                        "message": "Rate limited",
                        "source_id": "the_gazette",
                        "details": {"status_code": 429},
                    }
                ],
            ),
        )
    )

    response = client.post("/run-scan", json={"owner_limit": 2}, headers=auth_headers())

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "failed"
    assert payload["source_reports"][0]["status"] == "blocked"
    assert payload["errors"][0]["stage"] == "obituary_engine"
    assert payload["errors"][0]["details"]["source_id"] == "the_gazette"


def test_proof_script_runs_deterministic_end_to_end_path(tmp_path) -> None:
    output_path = tmp_path / "proof-output.json"
    script_path = Path(__file__).resolve().parents[3] / "scripts" / "prove-local-obituary-scan.py"

    completed = subprocess.run(
        [
            sys.executable,
            str(script_path),
            "--deterministic-only",
            "--json-output",
            str(output_path),
        ],
        cwd=Path(__file__).resolve().parents[3],
        check=True,
        capture_output=True,
        text=True,
    )
    proof_payload = json.loads(output_path.read_text(encoding="utf-8"))

    assert completed.stdout
    assert proof_payload["live_proof"]["status"] == "skipped"
    assert proof_payload["deterministic_proof"]["status"] == "proved"
    assert proof_payload["deterministic_proof"]["selected_source_id"] == "fixture_proof"
    assert proof_payload["final_scan_result"]["source_reports"]
    assert proof_payload["final_scan_result"]["lead_count"] >= 1
    assert proof_payload["final_scan_result"]["leads"][0]["heirs"]
