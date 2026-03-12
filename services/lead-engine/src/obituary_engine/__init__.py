from __future__ import annotations

import os
from typing import Protocol

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from src.contracts import Lead, LeadContact, PropertyAddress
from src.owner_corpus import OwnerRecord


def _resolve_base_url(base_url: str | None = None) -> str:
    resolved = base_url or os.getenv("OBITUARY_ENGINE_BASE_URL") or os.getenv("REAPER_BASE_URL") or ""
    return resolved.rstrip("/")


class ObituaryEngineError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class ObituaryEngine(Protocol):
    def run_scan(self, owner_records: list[OwnerRecord], scan_id: str) -> "ObituaryEngineScanResult":
        ...


class LegacyReaperContact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1)
    relationship: str = Field(min_length=1)
    phone: str = ""
    email: str = ""
    mailing_address: str = ""


class LegacyReaperLead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner_name: str = Field(min_length=1)
    deceased_name: str = Field(min_length=1)
    property_address: str = Field(min_length=1)
    property_city: str = Field(min_length=1)
    property_state: str = Field(min_length=1)
    property_postal_code: str = Field(min_length=1)
    property_county: str = Field(min_length=1)
    contacts: list[LegacyReaperContact] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    artifacts: list[str] = Field(default_factory=list)


class LegacyReaperScanResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(default="reaper", min_length=1)
    run_started_at: str
    run_completed_at: str
    leads: list[LegacyReaperLead] = Field(default_factory=list)


class ObituaryEngineScanResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(default="obituary_intelligence_engine", min_length=1)
    run_started_at: str
    run_completed_at: str
    leads: list[Lead] = Field(default_factory=list)


class LegacyReaperObituaryEngine:
    def __init__(self, base_url: str | None = None, timeout_seconds: float = 30.0) -> None:
        self.base_url = _resolve_base_url(base_url)
        self.timeout_seconds = timeout_seconds

    def run_scan(self, owner_records: list[OwnerRecord], scan_id: str) -> ObituaryEngineScanResult:
        if not self.base_url:
            raise ObituaryEngineError(
                code="obituary_engine_not_configured",
                message="OBITUARY_ENGINE_BASE_URL is not configured for lead-engine",
            )

        payload = {
            "scan_id": scan_id,
            "owner_records": [owner_record.model_dump(mode="json") for owner_record in owner_records],
        }

        try:
            response = httpx.post(
                f"{self.base_url}/run-scan",
                json=payload,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ObituaryEngineError(
                code="obituary_engine_http_error",
                message="obituary_intelligence_engine returned a non-success response",
                details={
                    "status_code": exc.response.status_code,
                    "response_text": exc.response.text,
                },
            ) from exc
        except httpx.HTTPError as exc:
            raise ObituaryEngineError(
                code="obituary_engine_transport_error",
                message="Failed to reach obituary_intelligence_engine",
                details={"error": str(exc)},
            ) from exc

        try:
            raw_result = LegacyReaperScanResult.model_validate(response.json())
        except ValidationError as exc:
            raise ObituaryEngineError(
                code="invalid_obituary_engine_payload",
                message="obituary_intelligence_engine returned an invalid payload",
                details={"errors": exc.errors()},
            ) from exc

        try:
            leads = [
                Lead.model_validate(
                    {
                        "scan_id": scan_id,
                        "source": "obituary_intelligence_engine",
                        "run_started_at": raw_result.run_started_at,
                        "run_completed_at": raw_result.run_completed_at,
                        "owner_name": raw_lead.owner_name,
                        "deceased_name": raw_lead.deceased_name,
                        "property": PropertyAddress(
                            address_line_1=raw_lead.property_address,
                            city=raw_lead.property_city,
                            state=raw_lead.property_state,
                            postal_code=raw_lead.property_postal_code,
                            county=raw_lead.property_county,
                        ),
                        "contacts": [
                            LeadContact(
                                name=contact.full_name,
                                relationship=contact.relationship,
                                phone=contact.phone,
                                email=contact.email,
                                mailing_address=contact.mailing_address,
                            )
                            for contact in raw_lead.contacts
                        ],
                        "notes": raw_lead.notes,
                        "tags": raw_lead.tags,
                        "raw_artifacts": raw_lead.artifacts,
                    }
                )
                for raw_lead in raw_result.leads
            ]
        except ValidationError as exc:
            raise ObituaryEngineError(
                code="invalid_lead_payload",
                message="obituary_intelligence_engine output could not be normalized to the canonical lead contract",
                details={"errors": exc.errors()},
            ) from exc

        return ObituaryEngineScanResult(
            source="obituary_intelligence_engine",
            run_started_at=raw_result.run_started_at,
            run_completed_at=raw_result.run_completed_at,
            leads=leads,
        )
