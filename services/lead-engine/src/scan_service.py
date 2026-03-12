from __future__ import annotations

from functools import lru_cache
from uuid import uuid4

from src.contracts import DeliverySummary, RunScanRequest, ScanError, ScanResult
from src.crm_adapter import CRMAdapterClient, CRMAdapterError
from src.obituary_engine import (
    HttpObituaryEngine,
    ObituaryEngine,
    ObituaryEngineError,
    ObituaryEngineScanRequest,
)


class ScanExecutionError(Exception):
    def __init__(self, status_code: int, response: ScanResult) -> None:
        super().__init__(response.errors[0].message if response.errors else "scan execution failed")
        self.status_code = status_code
        self.response = response


class ScanService:
    def __init__(self, *, crm_adapter_client: CRMAdapterClient, obituary_engine: ObituaryEngine) -> None:
        self.crm_adapter_client = crm_adapter_client
        self.obituary_engine = obituary_engine

    def run_scan(self, request: RunScanRequest, tenant_id: str) -> ScanResult:
        scan_id = str(uuid4())

        try:
            owner_fetch_response = self.crm_adapter_client.fetch_owner_records(
                tenant_id=tenant_id,
                owner_limit=request.owner_limit,
            )
        except CRMAdapterError as exc:
            raise ScanExecutionError(
                status_code=502,
                response=self._failure_response(
                    scan_id=scan_id,
                    owner_count=0,
                    lead_count=0,
                    stage="crm_fetch",
                    code=exc.code,
                    message=exc.message,
                    details=exc.details,
                ),
            ) from exc

        owner_records = owner_fetch_response.owners

        try:
            obituary_scan_result = self.obituary_engine.run_scan(
                ObituaryEngineScanRequest(
                    scan_id=scan_id,
                    owner_records=owner_records,
                    lookback_days=request.lookback_days,
                    reference_date=request.reference_date,
                    source_ids=request.source_ids,
                )
            )
        except ObituaryEngineError as exc:
            raise ScanExecutionError(
                status_code=502,
                response=self._failure_response(
                    scan_id=scan_id,
                    owner_count=len(owner_records),
                    lead_count=0,
                    stage="obituary_engine",
                    code=exc.code,
                    message=exc.message,
                    details=exc.details,
                ),
            ) from exc

        delivery_summary = DeliverySummary()
        errors: list[ScanError] = []

        for lead in obituary_scan_result.leads:
            try:
                delivery_response = self.crm_adapter_client.deliver_lead(
                    tenant_id=tenant_id,
                    lead=lead,
                )
            except CRMAdapterError as exc:
                delivery_summary.failed += 1
                errors.append(
                    ScanError(
                        stage="lead_delivery",
                        code=exc.code,
                        message=exc.message,
                        details={
                            **exc.details,
                            "deceased_name": lead.deceased_name,
                            "owner_name": lead.owner_name,
                        },
                    )
                )
                continue

            delivery_status = delivery_response.get("status")
            if delivery_status == "created":
                delivery_summary.created += 1
            elif delivery_status == "skipped_duplicate":
                delivery_summary.skipped_duplicate += 1
            else:
                delivery_summary.failed += 1
                errors.append(
                    ScanError(
                        stage="lead_delivery",
                        code="unexpected_delivery_status",
                        message="crm-adapter returned an unexpected delivery status",
                        details={
                            "delivery_status": delivery_status,
                            "response_body": delivery_response,
                        },
                    )
                )

        status = self._resolve_status(delivery_summary, errors, len(obituary_scan_result.leads))

        return ScanResult(
            scan_id=scan_id,
            status=status,
            owner_count=len(owner_records),
            lead_count=len(obituary_scan_result.leads),
            delivery_summary=delivery_summary,
            leads=obituary_scan_result.leads,
            errors=errors,
        )

    def _failure_response(
        self,
        *,
        scan_id: str,
        owner_count: int,
        lead_count: int,
        stage: str,
        code: str,
        message: str,
        details: dict,
    ) -> ScanResult:
        return ScanResult(
            scan_id=scan_id,
            status="failed",
            owner_count=owner_count,
            lead_count=lead_count,
            delivery_summary=DeliverySummary(),
            leads=[],
            errors=[ScanError(stage=stage, code=code, message=message, details=details)],
        )

    def _resolve_status(
        self,
        delivery_summary: DeliverySummary,
        errors: list[ScanError],
        lead_count: int,
    ) -> str:
        if not errors:
            return "completed"

        successful_deliveries = delivery_summary.created + delivery_summary.skipped_duplicate
        if successful_deliveries > 0:
            return "partial"

        if lead_count == 0:
            return "completed"

        return "failed"


@lru_cache(maxsize=1)
def get_scan_service() -> ScanService:
    return ScanService(
        crm_adapter_client=CRMAdapterClient(),
        obituary_engine=HttpObituaryEngine(),
    )
