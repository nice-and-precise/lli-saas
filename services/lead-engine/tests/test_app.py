from pathlib import Path

from fastapi.testclient import TestClient

from src.app import app
from src.contracts import CONTRACT_PATH, InternalLead, ScanRequest, load_internal_lead_schema
from src.reaper import RawReaperScanResult, ReaperGatewayError
from src.scan_service import ScanService, get_scan_service


client = TestClient(app)


def test_healthcheck(monkeypatch) -> None:
    monkeypatch.setenv("REAPER_BASE_URL", "http://reaper:8080")
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "lead-engine",
        "reaper_base_url_configured": "true",
    }


def test_readiness_rejects_missing_reaper_configuration(monkeypatch) -> None:
    monkeypatch.delenv("REAPER_BASE_URL", raising=False)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "service": "lead-engine",
        "missing_configuration": ["REAPER_BASE_URL"],
    }


def test_contract_endpoint_exposes_shared_schema_path() -> None:
    response = client.get("/contract")

    assert response.status_code == 200
    assert response.json() == {"contract_path": str(CONTRACT_PATH)}
    assert Path(response.json()["contract_path"]).is_file()


def test_internal_lead_model_matches_shared_schema_expectations() -> None:
    payload = {
        "scan_id": "scan-1",
        "source": "reaper",
        "run_started_at": "2026-03-11T10:00:00Z",
        "run_completed_at": "2026-03-11T10:01:00Z",
        "owner_name": "Jordan Example",
        "deceased_name": "Pat Example",
        "property": {
            "address_line_1": "123 County Road",
            "city": "Austin",
            "state": "TX",
            "postal_code": "78701",
            "county": "Travis"
        },
        "contacts": [
            {
                "name": "Casey Example",
                "relationship": "heir",
                "phone": "555-0100",
                "email": "casey@example.com",
                "mailing_address": "PO Box 1"
            }
        ],
        "notes": ["pilot-ready"],
        "tags": ["inheritance"],
        "raw_artifacts": ["artifact-1.json"]
    }

    lead = InternalLead.model_validate(payload)
    schema = load_internal_lead_schema()

    assert lead.scan_id == "scan-1"
    assert schema["title"] == "InternalLead"
    assert "property" in schema["required"]


class StubGateway:
    def run_scan(self, request: ScanRequest, scan_id: str) -> RawReaperScanResult:
        assert request.county == "Travis"
        assert request.state == "TX"
        assert request.limit == 10
        assert request.include_contacts is True
        assert scan_id

        return RawReaperScanResult.model_validate(
            {
                "source": "reaper",
                "run_started_at": "2026-03-11T10:00:00Z",
                "run_completed_at": "2026-03-11T10:01:00Z",
                "leads": [
                    {
                        "owner_name": "Jordan Example",
                        "deceased_name": "Pat Example",
                        "property_address": "123 County Road",
                        "property_city": "Austin",
                        "property_state": "TX",
                        "property_postal_code": "78701",
                        "property_county": "Travis",
                        "contacts": [
                            {
                                "full_name": "Casey Example",
                                "relationship": "heir",
                                "phone": "555-0100",
                                "email": "casey@example.com",
                                "mailing_address": "PO Box 1",
                            }
                        ],
                        "notes": ["pilot-ready"],
                        "tags": ["inheritance"],
                        "artifacts": ["artifact-1.json"],
                    }
                ],
            }
        )


class FailingGateway:
    def run_scan(self, request: ScanRequest, scan_id: str) -> RawReaperScanResult:
        raise ReaperGatewayError(
            code="reaper_transport_error",
            message="Failed to reach the Reaper service",
            details={"error": "connection refused"},
        )


def test_run_scan_returns_normalized_internal_leads() -> None:
    app.dependency_overrides[get_scan_service] = lambda: ScanService(gateway=StubGateway())

    response = client.post(
        "/run-scan",
        json={"county": "Travis", "state": "TX", "limit": 10, "include_contacts": True},
    )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["lead_count"] == 1
    assert payload["errors"] == []
    assert payload["leads"][0]["scan_id"] == payload["scan_id"]
    assert payload["leads"][0]["source"] == "reaper"
    assert payload["leads"][0]["property"] == {
        "address_line_1": "123 County Road",
        "city": "Austin",
        "state": "TX",
        "postal_code": "78701",
        "county": "Travis",
    }
    assert payload["leads"][0]["contacts"][0]["name"] == "Casey Example"
    assert "property_address" not in payload["leads"][0]


def test_run_scan_rejects_invalid_request_payload() -> None:
    response = client.post("/run-scan", json={"state": "TX"})

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "county"]


def test_run_scan_returns_structured_runtime_failures() -> None:
    app.dependency_overrides[get_scan_service] = lambda: ScanService(gateway=FailingGateway())

    response = client.post("/run-scan", json={"county": "Travis", "state": "TX"})

    app.dependency_overrides.clear()

    assert response.status_code == 502
    payload = response.json()
    assert payload["status"] == "failed"
    assert payload["lead_count"] == 0
    assert payload["leads"] == []
    assert payload["errors"] == [
        {
            "code": "reaper_transport_error",
            "message": "Failed to reach the Reaper service",
            "details": {"error": "connection refused"},
        }
    ]
