from pathlib import Path

from fastapi.testclient import TestClient

from src.app import app
from src.contracts import CONTRACT_PATH, InternalLead, load_internal_lead_schema


client = TestClient(app)


def test_healthcheck() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "lead-engine"}


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
