from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from src.app import app
from src.contracts import (
    LEAD_CONTRACT_PATH,
    OWNER_RECORD_CONTRACT_PATH,
    SCAN_RESULT_CONTRACT_PATH,
    Lead,
    RunScanRequest,
    load_lead_schema,
)
from src.crm_adapter import CRMAdapterError
from src.obituary_engine import ObituaryEngineError, ObituaryEngineScanRequest, ObituaryEngineScanResult
from src.owner_corpus import OwnerFetchResponse, OwnerRecord
from src.scan_service import ScanService, get_scan_service


client = TestClient(app)


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
            "matched_fields": ["last_name", "first_name", "location"],
            "explanation": ["Last name similarity scored 100.0 against owner record."],
        },
        "tier": "hot",
        "out_of_state_heir_likely": True,
        "out_of_state_states": ["AZ"],
        "executor_mentioned": False,
        "unexpected_death": False,
        "notes": ["pilot-ready"],
        "tags": ["tier:hot"],
        "raw_artifacts": ["artifact-1.json"],
        "owner_profile_url": "lli://owner-profile/board:clients:item:owner-1",
        "obituary_raw_url": "https://example.com/obit",
    }
    payload.update(overrides)
    return Lead.model_validate(payload)


def test_healthcheck(monkeypatch) -> None:
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
    monkeypatch.setenv("CRM_ADAPTER_BASE_URL", "http://crm-adapter:3000")
    monkeypatch.setenv("OBITUARY_ENGINE_BASE_URL", "http://obituary-engine:8080")

    def raise_connect_error(*args, **kwargs):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr("src.app.httpx.get", raise_connect_error)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json()["dependency_failures"][0]["reason"] == "unreachable"


def test_contract_endpoint_exposes_canonical_schema_paths() -> None:
    response = client.get("/contract")

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


class StubCRMAdapterClient:
    def __init__(self, *, fail_fetch: bool = False, fail_delivery_for: set[str] | None = None) -> None:
        self.fail_fetch = fail_fetch
        self.fail_delivery_for = fail_delivery_for or set()
        self.delivered_leads: list[Lead] = []

    def fetch_owner_records(self, *, tenant_id: str, owner_limit: int) -> OwnerFetchResponse:
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

    def deliver_lead(self, *, tenant_id: str, lead: Lead) -> dict:
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
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.last_request: ObituaryEngineScanRequest | None = None

    def run_scan(self, request: ObituaryEngineScanRequest) -> ObituaryEngineScanResult:
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
            leads=[
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
                        "matched_fields": ["last_name", "first_name"],
                        "explanation": ["First name similarity scored 80.0 after nickname expansion."],
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
        )


def install_service(stub_service: ScanService) -> None:
    app.dependency_overrides[get_scan_service] = lambda: stub_service


def test_run_scan_returns_completed_result() -> None:
    crm_adapter = StubCRMAdapterClient()
    obituary_engine = StubObituaryEngine()
    install_service(ScanService(crm_adapter_client=crm_adapter, obituary_engine=obituary_engine))

    response = client.post(
        "/run-scan",
        json={
            "owner_limit": 2,
            "lookback_days": 7,
            "reference_date": "2026-03-11",
            "source_ids": ["kwbg_boone"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["owner_count"] == 2
    assert payload["lead_count"] == 2
    assert payload["delivery_summary"]["created"] == 2
    assert payload["leads"][0]["owner_id"] == "owner-1"
    assert payload["leads"][0]["heirs"][0]["out_of_state"] is True
    assert obituary_engine.last_request is not None
    assert obituary_engine.last_request.lookback_days == 7
    assert obituary_engine.last_request.reference_date == "2026-03-11"
    assert obituary_engine.last_request.source_ids == ["kwbg_boone"]


def test_run_scan_rejects_invalid_owner_limit() -> None:
    response = client.post("/run-scan", json={"owner_limit": 10001})
    assert response.status_code == 422


def test_run_scan_returns_partial_on_delivery_failure() -> None:
    crm_adapter = StubCRMAdapterClient(fail_delivery_for={"Taylor Example"})
    obituary_engine = StubObituaryEngine()
    install_service(ScanService(crm_adapter_client=crm_adapter, obituary_engine=obituary_engine))

    response = client.post("/run-scan", json={"owner_limit": 2})

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

    response = client.post("/run-scan", json={"owner_limit": 2})

    assert response.status_code == 502
    payload = response.json()
    assert payload["status"] == "failed"
    assert payload["errors"][0]["stage"] == "crm_fetch"


def test_run_scan_returns_upstream_failure_when_obituary_engine_fails() -> None:
    install_service(
        ScanService(
            crm_adapter_client=StubCRMAdapterClient(),
            obituary_engine=StubObituaryEngine(fail=True),
        )
    )

    response = client.post("/run-scan", json={"owner_limit": 2})

    assert response.status_code == 502
    payload = response.json()
    assert payload["status"] == "failed"
    assert payload["errors"][0]["stage"] == "obituary_engine"
