from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def _resolve_contract_path(filename: str) -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "shared" / "contracts" / filename
        if candidate.is_file():
            return candidate

    return current.parent.parent / "shared" / "contracts" / filename


LEAD_CONTRACT_PATH = _resolve_contract_path("lead.schema.json")
OWNER_RECORD_CONTRACT_PATH = _resolve_contract_path("owner-record.schema.json")
SCAN_RESULT_CONTRACT_PATH = _resolve_contract_path("scan-result.schema.json")


class PropertyAddress(BaseModel):
    model_config = ConfigDict(extra="forbid")

    address_line_1: str
    city: str
    state: str
    postal_code: str
    county: str


class LeadContact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    relationship: str
    phone: str = ""
    email: str = ""
    mailing_address: str = ""


class Lead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scan_id: str
    source: str
    run_started_at: str
    run_completed_at: str
    owner_name: str
    deceased_name: str
    property: PropertyAddress
    contacts: list[LeadContact]
    notes: list[str]
    tags: list[str]
    raw_artifacts: list[str]


class RunScanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner_limit: int = Field(default=10000, ge=1, le=10000)


class DeliverySummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created: int = Field(default=0, ge=0)
    skipped_duplicate: int = Field(default=0, ge=0)
    failed: int = Field(default=0, ge=0)


class ScanError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: Literal["crm_fetch", "owner_normalization", "obituary_engine", "lead_delivery"]
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ScanResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scan_id: str
    status: Literal["completed", "partial", "failed"]
    owner_count: int = Field(ge=0)
    lead_count: int = Field(ge=0)
    delivery_summary: DeliverySummary = Field(default_factory=DeliverySummary)
    leads: list[Lead] = Field(default_factory=list)
    errors: list[ScanError] = Field(default_factory=list)


def load_lead_schema() -> dict[str, Any]:
    return json.loads(LEAD_CONTRACT_PATH.read_text(encoding="utf-8"))


def load_owner_record_schema() -> dict[str, Any]:
    return json.loads(OWNER_RECORD_CONTRACT_PATH.read_text(encoding="utf-8"))


def load_scan_result_schema() -> dict[str, Any]:
    return json.loads(SCAN_RESULT_CONTRACT_PATH.read_text(encoding="utf-8"))
