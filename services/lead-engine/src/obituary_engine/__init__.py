from __future__ import annotations

import os
from typing import Protocol

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from src.contracts import Lead
from src.owner_corpus import OwnerRecord


def _resolve_base_url(base_url: str | None = None) -> str:
    resolved = base_url or os.getenv("OBITUARY_ENGINE_BASE_URL") or ""
    return resolved.rstrip("/")


class ObituaryEngineError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class ObituaryEngineScanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scan_id: str = Field(min_length=1)
    owner_records: list[OwnerRecord] = Field(default_factory=list)
    lookback_days: int = Field(default=7, ge=1, le=30)
    reference_date: str | None = None
    source_ids: list[str] = Field(default_factory=list)


class ObituaryEngineScanResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(default="obituary_intelligence_engine", min_length=1)
    run_started_at: str
    run_completed_at: str
    leads: list[Lead] = Field(default_factory=list)


class ObituaryEngine(Protocol):
    def run_scan(self, request: ObituaryEngineScanRequest) -> ObituaryEngineScanResult:
        ...


class HttpObituaryEngine:
    def __init__(self, base_url: str | None = None, timeout_seconds: float = 30.0) -> None:
        self.base_url = _resolve_base_url(base_url)
        self.timeout_seconds = timeout_seconds

    def run_scan(self, request: ObituaryEngineScanRequest) -> ObituaryEngineScanResult:
        if not self.base_url:
            raise ObituaryEngineError(
                code="obituary_engine_not_configured",
                message="OBITUARY_ENGINE_BASE_URL is not configured for lead-engine",
            )

        payload = request.model_dump(mode="json")

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
            return ObituaryEngineScanResult.model_validate(response.json())
        except ValidationError as exc:
            raise ObituaryEngineError(
                code="invalid_obituary_engine_payload",
                message="obituary_intelligence_engine returned an invalid payload",
                details={"errors": exc.errors()},
            ) from exc
