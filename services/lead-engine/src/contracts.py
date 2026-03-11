from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def _resolve_contract_path() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "shared" / "contracts" / "internal-lead.schema.json"
        if candidate.is_file():
            return candidate

    return current.parent.parent / "shared" / "contracts" / "internal-lead.schema.json"


CONTRACT_PATH = _resolve_contract_path()


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


class InternalLead(BaseModel):
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


class ScanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    county: str = Field(min_length=1)
    state: str = Field(min_length=2, max_length=2)
    limit: int = Field(default=25, ge=1, le=500)
    include_contacts: bool = True


class ScanError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class RunScanResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scan_id: str
    status: Literal["completed", "failed"]
    lead_count: int = Field(ge=0)
    leads: list[InternalLead] = Field(default_factory=list)
    errors: list[ScanError] = Field(default_factory=list)


def load_internal_lead_schema() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
