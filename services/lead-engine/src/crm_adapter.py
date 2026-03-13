from __future__ import annotations

import os

import httpx
from pydantic import ValidationError

from src.contracts import Lead
from src.owner_corpus import OwnerFetchResponse


def _resolve_base_url(base_url: str | None = None) -> str:
    resolved = base_url or os.getenv("CRM_ADAPTER_BASE_URL") or ""
    return resolved.rstrip("/")


class CRMAdapterError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        details: dict[str, object] | None = None,
        status_code: int = 502,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}
        self.status_code = status_code


class CRMAdapterClient:
    def __init__(self, base_url: str | None = None, timeout_seconds: float = 30.0) -> None:
        self.base_url = _resolve_base_url(base_url)
        self.timeout_seconds = timeout_seconds

    def fetch_owner_records(self, *, owner_limit: int, bearer_token: str) -> OwnerFetchResponse:
        if not self.base_url:
            raise CRMAdapterError(
                code="crm_adapter_not_configured",
                message="CRM_ADAPTER_BASE_URL is not configured for lead-engine",
            )

        try:
            response = httpx.get(
                f"{self.base_url}/owners",
                params={"limit": owner_limit},
                headers={"Authorization": f"Bearer {bearer_token}"},
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise CRMAdapterError(
                code="crm_fetch_http_error",
                message="crm-adapter returned a non-success response while fetching owner records",
                details={
                    "status_code": exc.response.status_code,
                    "response_text": exc.response.text,
                },
                status_code=502,
            ) from exc
        except httpx.HTTPError as exc:
            raise CRMAdapterError(
                code="crm_fetch_transport_error",
                message="Failed to reach crm-adapter while fetching owner records",
                details={"error": str(exc)},
            ) from exc

        try:
            return OwnerFetchResponse.model_validate(response.json())
        except ValidationError as exc:
            raise CRMAdapterError(
                code="invalid_owner_records_payload",
                message="crm-adapter returned invalid owner records",
                details={"errors": exc.errors()},
            ) from exc

    def deliver_lead(self, *, lead: Lead, bearer_token: str) -> dict[str, object]:
        if not self.base_url:
            raise CRMAdapterError(
                code="crm_adapter_not_configured",
                message="CRM_ADAPTER_BASE_URL is not configured for lead-engine",
            )

        try:
            response = httpx.post(
                f"{self.base_url}/leads",
                json=lead.model_dump(mode="json"),
                headers={"Authorization": f"Bearer {bearer_token}"},
                timeout=self.timeout_seconds,
            )
            payload = response.json()
        except httpx.HTTPError as exc:
            raise CRMAdapterError(
                code="crm_delivery_transport_error",
                message="Failed to reach crm-adapter while delivering leads",
                details={"error": str(exc)},
            ) from exc
        except ValueError as exc:
            raise CRMAdapterError(
                code="invalid_delivery_response",
                message="crm-adapter returned an invalid lead delivery response",
                details={"error": str(exc)},
            ) from exc

        if not isinstance(payload, dict):
            raise CRMAdapterError(
                code="invalid_delivery_response",
                message="crm-adapter returned an invalid lead delivery response",
                details={"response_body": payload},
            )

        if response.status_code not in {200, 201}:
            raise CRMAdapterError(
                code="crm_delivery_http_error",
                message="crm-adapter reported a lead delivery failure",
                details={
                    "status_code": response.status_code,
                    "response_body": payload,
                },
            )

        return payload
