from __future__ import annotations

import logging
from collections.abc import Sequence
from functools import lru_cache
from typing import Literal, Protocol
from uuid import uuid4

from src.auth import AuthContext
from src.contracts import (
    DeliverySummary,
    ObituarySourceReport,
    RunScanRequest,
    ScanError,
    ScanResult,
)
from src.crm_adapter import CRMAdapterClient, CRMAdapterError
from src.logging import get_logger, log_event
from src.obituary_engine import (
    HttpObituaryEngine,
    ObituaryEngine,
    ObituaryEngineError,
    ObituaryEngineScanRequest,
)

ScanStatus = Literal["completed", "partial", "failed"]
ScanStage = Literal["crm_fetch", "owner_normalization", "obituary_engine", "lead_delivery"]


class SupportsStatus(Protocol):
    status: str


class ScanExecutionError(Exception):
    def __init__(self, status_code: int, response: ScanResult) -> None:
        super().__init__(response.errors[0].message if response.errors else "scan execution failed")
        self.status_code = status_code
        self.response = response


class ScanService:
    def __init__(
        self,
        *,
        crm_adapter_client: CRMAdapterClient,
        obituary_engine: ObituaryEngine,
        logger: logging.Logger | None = None,
    ) -> None:
        self.crm_adapter_client = crm_adapter_client
        self.obituary_engine = obituary_engine
        self.logger = logger or get_logger("lead-engine")

    def run_scan(self, request: RunScanRequest, auth: AuthContext) -> ScanResult:
        scan_id = str(uuid4())
        tenant_id = auth.tenant_id
        log_event(
            self.logger,
            logging.INFO,
            "lead-engine",
            "lead_scan_started",
            scan_id=scan_id,
            tenant_id=tenant_id,
            owner_limit=request.owner_limit,
            lookback_days=request.lookback_days,
            reference_date=request.reference_date,
            source_ids=request.source_ids,
        )

        try:
            owner_fetch_response = self.crm_adapter_client.fetch_owner_records(
                owner_limit=request.owner_limit,
                bearer_token=auth.token,
            )
        except CRMAdapterError as exc:
            log_event(
                self.logger,
                logging.ERROR,
                "lead-engine",
                "lead_scan_owner_fetch_failed",
                scan_id=scan_id,
                tenant_id=tenant_id,
                code=exc.code,
                details=exc.details,
            )
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
        log_event(
            self.logger,
            logging.INFO,
            "lead-engine",
            "lead_scan_owner_fetch_completed",
            scan_id=scan_id,
            tenant_id=tenant_id,
            owner_count=len(owner_records),
        )

        try:
            obituary_scan_result = self.obituary_engine.run_scan(
                ObituaryEngineScanRequest(
                    scan_id=scan_id,
                    owner_records=owner_records,
                    lookback_days=request.lookback_days,
                    reference_date=request.reference_date,
                    source_ids=request.source_ids,
                ),
                bearer_token=auth.token,
            )
        except ObituaryEngineError as exc:
            log_event(
                self.logger,
                logging.ERROR,
                "lead-engine",
                "lead_scan_obituary_failed",
                scan_id=scan_id,
                tenant_id=tenant_id,
                owner_count=len(owner_records),
                code=exc.code,
                details=exc.details,
            )
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

        log_event(
            self.logger,
            logging.INFO,
            "lead-engine",
            "lead_scan_obituary_summary",
            scan_id=scan_id,
            tenant_id=tenant_id,
            owner_count=len(owner_records),
            lead_count=len(obituary_scan_result.leads),
            source_report_count=len(obituary_scan_result.source_reports),
            error_count=len(obituary_scan_result.errors),
        )

        delivery_summary = DeliverySummary()
        errors: list[ScanError] = [
            ScanError(
                stage="obituary_engine",
                code=issue.code,
                message=issue.message,
                details={
                    **issue.details,
                    "source_id": issue.source_id,
                },
            )
            for issue in obituary_scan_result.errors
        ]

        for lead in obituary_scan_result.leads:
            log_event(
                self.logger,
                logging.INFO,
                "lead-engine",
                "lead_delivery_attempted",
                scan_id=scan_id,
                tenant_id=tenant_id,
                owner_id=lead.owner_id,
                deceased_name=lead.deceased_name,
            )
            try:
                delivery_response = self.crm_adapter_client.deliver_lead(
                    lead=lead,
                    bearer_token=auth.token,
                )
            except CRMAdapterError as exc:
                delivery_summary.failed += 1
                log_event(
                    self.logger,
                    logging.ERROR,
                    "lead-engine",
                    "lead_delivery_failed",
                    scan_id=scan_id,
                    tenant_id=tenant_id,
                    owner_id=lead.owner_id,
                    deceased_name=lead.deceased_name,
                    code=exc.code,
                    details=exc.details,
                )
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
                log_event(
                    self.logger,
                    logging.INFO,
                    "lead-engine",
                    "lead_delivery_succeeded",
                    scan_id=scan_id,
                    tenant_id=tenant_id,
                    owner_id=lead.owner_id,
                    deceased_name=lead.deceased_name,
                    item_id=delivery_response.get("item_id"),
                    delivery_id=delivery_response.get("delivery_id"),
                )
            elif delivery_status == "skipped_duplicate":
                delivery_summary.skipped_duplicate += 1
                log_event(
                    self.logger,
                    logging.INFO,
                    "lead-engine",
                    "lead_delivery_duplicate_skipped",
                    scan_id=scan_id,
                    tenant_id=tenant_id,
                    owner_id=lead.owner_id,
                    deceased_name=lead.deceased_name,
                    delivery_id=delivery_response.get("delivery_id"),
                    duplicate_of=delivery_response.get("duplicate_of"),
                )
            else:
                delivery_summary.failed += 1
                log_event(
                    self.logger,
                    logging.ERROR,
                    "lead-engine",
                    "lead_delivery_failed",
                    scan_id=scan_id,
                    tenant_id=tenant_id,
                    owner_id=lead.owner_id,
                    deceased_name=lead.deceased_name,
                    code="unexpected_delivery_status",
                    details={"response_body": delivery_response},
                )
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

        status = self._resolve_status(
            delivery_summary,
            errors,
            len(obituary_scan_result.leads),
            obituary_scan_result.source_reports,
        )

        log_event(
            self.logger,
            logging.INFO,
            "lead-engine",
            "lead_scan_completed",
            scan_id=scan_id,
            tenant_id=tenant_id,
            status=status,
            owner_count=len(owner_records),
            lead_count=len(obituary_scan_result.leads),
            created=delivery_summary.created,
            skipped_duplicate=delivery_summary.skipped_duplicate,
            failed=delivery_summary.failed,
            error_count=len(errors),
        )

        return ScanResult(
            scan_id=scan_id,
            status=status,
            owner_count=len(owner_records),
            lead_count=len(obituary_scan_result.leads),
            delivery_summary=delivery_summary,
            leads=obituary_scan_result.leads,
            source_reports=[
                ObituarySourceReport.model_validate(report.model_dump(mode="json"))
                for report in obituary_scan_result.source_reports
            ],
            errors=errors,
        )

    def _failure_response(
        self,
        *,
        scan_id: str,
        owner_count: int,
        lead_count: int,
        stage: ScanStage,
        code: str,
        message: str,
        details: dict[str, object],
    ) -> ScanResult:
        return ScanResult(
            scan_id=scan_id,
            status="failed",
            owner_count=owner_count,
            lead_count=lead_count,
            delivery_summary=DeliverySummary(),
            leads=[],
            source_reports=[],
            errors=[ScanError(stage=stage, code=code, message=message, details=details)],
        )

    def _resolve_status(
        self,
        delivery_summary: DeliverySummary,
        errors: list[ScanError],
        lead_count: int,
        source_reports: Sequence[SupportsStatus],
    ) -> ScanStatus:
        if not errors:
            return "completed"

        successful_deliveries = delivery_summary.created + delivery_summary.skipped_duplicate
        if successful_deliveries > 0:
            return "partial"

        if lead_count == 0:
            if source_reports and not any(
                report.status in {"healthy", "empty", "stale"} for report in source_reports
            ):
                return "failed"
            return "completed"

        return "failed"


@lru_cache(maxsize=1)
def get_scan_service() -> ScanService:
    return ScanService(
        crm_adapter_client=CRMAdapterClient(),
        obituary_engine=HttpObituaryEngine(),
    )
