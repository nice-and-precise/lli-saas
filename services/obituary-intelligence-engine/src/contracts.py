from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


def _resolve_contract_path(filename: str) -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "shared" / "contracts" / filename
        if candidate.is_file():
            return candidate

    return current.parent.parent / "shared" / "contracts" / filename


LEAD_CONTRACT_PATH = _resolve_contract_path("lead.schema.json")
OWNER_RECORD_CONTRACT_PATH = _resolve_contract_path("owner-record.schema.json")


class OwnerRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner_id: str = Field(min_length=1)
    owner_name: str = Field(min_length=1)
    county: str | None = None
    state: str | None = None
    acres: float | None = None
    parcel_ids: list[str] = Field(default_factory=list)
    mailing_state: str | None = None
    mailing_city: str | None = None
    mailing_postal_code: str | None = None
    property_address_line_1: str | None = None
    property_city: str | None = None
    property_postal_code: str | None = None
    operator_name: str | None = None
    crm_source: str = Field(min_length=1)
    raw_source_ref: str | None = None


class LeadProperty(BaseModel):
    model_config = ConfigDict(extra="forbid")

    county: str | None = None
    state: str | None = None
    acres: float | None = None
    parcel_ids: list[str] = Field(default_factory=list)
    address_line_1: str | None = None
    city: str | None = None
    postal_code: str | None = None
    operator_name: str | None = None


class HeirRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    relationship: str = Field(min_length=1)
    location_city: str | None = None
    location_state: str | None = None
    out_of_state: bool = False
    phone: str | None = None
    email: str | None = None
    mailing_address: str | None = None
    executor: bool = False


class ObituaryMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: HttpUrl
    source_id: str = Field(min_length=1)
    published_at: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}T")
    death_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    deceased_city: str | None = None
    deceased_state: str | None = None


class MatchMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score: float
    last_name_score: float
    first_name_score: float
    location_bonus_applied: bool = False
    status: Literal["auto_confirmed", "pending_review"]
    matched_fields: list[str] = Field(default_factory=list)
    explanation: list[str] = Field(default_factory=list)


class Lead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scan_id: str = Field(min_length=1)
    source: str = Field(min_length=1)
    run_started_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T")
    run_completed_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T")
    owner_id: str = Field(min_length=1)
    owner_name: str = Field(min_length=1)
    deceased_name: str = Field(min_length=1)
    property: LeadProperty
    heirs: list[HeirRecord] = Field(default_factory=list)
    obituary: ObituaryMetadata
    match: MatchMetadata
    tier: Literal["hot", "warm", "pending_review", "low_signal"]
    out_of_state_heir_likely: bool = False
    out_of_state_states: list[str] = Field(default_factory=list)
    executor_mentioned: bool = False
    unexpected_death: bool = False
    notes: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    raw_artifacts: list[str] = Field(default_factory=list)
    owner_profile_url: str | None = None
    obituary_raw_url: str | None = None


class ObituaryEngineRunScanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scan_id: str = Field(min_length=1)
    owner_records: list[OwnerRecord] = Field(default_factory=list)
    lookback_days: int = Field(default=7, ge=1, le=30)
    reference_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    source_ids: list[str] = Field(default_factory=list)


class ObituaryEngineScanResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(default="obituary_intelligence_engine", min_length=1)
    run_started_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T")
    run_completed_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T")
    leads: list[Lead] = Field(default_factory=list)


def load_lead_schema() -> dict[str, Any]:
    return json.loads(LEAD_CONTRACT_PATH.read_text(encoding="utf-8"))


def load_owner_record_schema() -> dict[str, Any]:
    return json.loads(OWNER_RECORD_CONTRACT_PATH.read_text(encoding="utf-8"))
