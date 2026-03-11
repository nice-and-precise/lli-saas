from __future__ import annotations

from functools import lru_cache
from uuid import uuid4

from pydantic import ValidationError

from src.contracts import InternalLead, LeadContact, PropertyAddress, RunScanResponse, ScanError, ScanRequest
from src.reaper import HttpReaperGateway, RawReaperLead, ReaperGateway, ReaperGatewayError


class ScanExecutionError(Exception):
    def __init__(self, status_code: int, response: RunScanResponse) -> None:
        super().__init__(response.errors[0].message if response.errors else "scan execution failed")
        self.status_code = status_code
        self.response = response


class ScanService:
    def __init__(self, gateway: ReaperGateway) -> None:
        self.gateway = gateway

    def run_scan(self, request: ScanRequest) -> RunScanResponse:
        scan_id = str(uuid4())

        try:
            raw_result = self.gateway.run_scan(request, scan_id)
        except ReaperGatewayError as exc:
            raise ScanExecutionError(
                status_code=502,
                response=self._failure_response(
                    scan_id=scan_id,
                    code=exc.code,
                    message=exc.message,
                    details=exc.details,
                ),
            ) from exc
        except Exception as exc:
            raise ScanExecutionError(
                status_code=502,
                response=self._failure_response(
                    scan_id=scan_id,
                    code="unexpected_reaper_error",
                    message="Unexpected failure while executing the Reaper scan",
                    details={"error": str(exc)},
                ),
            ) from exc

        try:
            leads = [
                self._normalize_lead(
                    scan_id=scan_id,
                    source=raw_result.source,
                    run_started_at=raw_result.run_started_at,
                    run_completed_at=raw_result.run_completed_at,
                    raw_lead=raw_lead,
                )
                for raw_lead in raw_result.leads
            ]
        except ValidationError as exc:
            raise ScanExecutionError(
                status_code=502,
                response=self._failure_response(
                    scan_id=scan_id,
                    code="invalid_internal_lead",
                    message="Reaper output could not be normalized to the internal lead contract",
                    details={"errors": exc.errors()},
                ),
            ) from exc

        return RunScanResponse(
            scan_id=scan_id,
            status="completed",
            lead_count=len(leads),
            leads=leads,
            errors=[],
        )

    def _normalize_lead(
        self,
        *,
        scan_id: str,
        source: str,
        run_started_at: str,
        run_completed_at: str,
        raw_lead: RawReaperLead,
    ) -> InternalLead:
        return InternalLead.model_validate(
            {
                "scan_id": scan_id,
                "source": source,
                "run_started_at": run_started_at,
                "run_completed_at": run_completed_at,
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

    def _failure_response(
        self,
        *,
        scan_id: str,
        code: str,
        message: str,
        details: dict,
    ) -> RunScanResponse:
        return RunScanResponse(
            scan_id=scan_id,
            status="failed",
            lead_count=0,
            leads=[],
            errors=[ScanError(code=code, message=message, details=details)],
        )


@lru_cache(maxsize=1)
def get_scan_service() -> ScanService:
    return ScanService(gateway=HttpReaperGateway())
