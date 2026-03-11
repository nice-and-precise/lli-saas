from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict


CONTRACT_PATH = Path(__file__).resolve().parents[3] / "shared" / "contracts" / "internal-lead.schema.json"


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


def load_internal_lead_schema() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
