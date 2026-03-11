from __future__ import annotations

import os
from typing import Protocol

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from src.contracts import ScanRequest


class RawReaperContact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1)
    relationship: str = Field(min_length=1)
    phone: str = ""
    email: str = ""
    mailing_address: str = ""


class RawReaperLead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner_name: str = Field(min_length=1)
    deceased_name: str = Field(min_length=1)
    property_address: str = Field(min_length=1)
    property_city: str = Field(min_length=1)
    property_state: str = Field(min_length=1)
    property_postal_code: str = Field(min_length=1)
    property_county: str = Field(min_length=1)
    contacts: list[RawReaperContact] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    artifacts: list[str] = Field(default_factory=list)


class RawReaperScanResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(default="reaper", min_length=1)
    run_started_at: str
    run_completed_at: str
    leads: list[RawReaperLead] = Field(default_factory=list)


class ReaperGatewayError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class ReaperGateway(Protocol):
    def run_scan(self, request: ScanRequest, scan_id: str) -> RawReaperScanResult:
        ...


class HttpReaperGateway:
    def __init__(self, base_url: str | None = None, timeout_seconds: float = 30.0) -> None:
        self.base_url = (base_url or os.getenv("REAPER_BASE_URL", "")).rstrip("/")
        self.timeout_seconds = timeout_seconds

    def run_scan(self, request: ScanRequest, scan_id: str) -> RawReaperScanResult:
        if not self.base_url:
            raise ReaperGatewayError(
                code="reaper_not_configured",
                message="REAPER_BASE_URL is not configured for lead-engine",
            )

        payload = request.model_dump(mode="json")
        payload["scan_id"] = scan_id

        try:
            response = httpx.post(
                f"{self.base_url}/run-scan",
                json=payload,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ReaperGatewayError(
                code="reaper_http_error",
                message="Reaper returned a non-success response",
                details={
                    "status_code": exc.response.status_code,
                    "response_text": exc.response.text,
                },
            ) from exc
        except httpx.HTTPError as exc:
            raise ReaperGatewayError(
                code="reaper_transport_error",
                message="Failed to reach the Reaper service",
                details={"error": str(exc)},
            ) from exc

        try:
            return RawReaperScanResult.model_validate(response.json())
        except ValidationError as exc:
            raise ReaperGatewayError(
                code="invalid_reaper_payload",
                message="Reaper returned an invalid payload",
                details={"errors": exc.errors()},
            ) from exc
