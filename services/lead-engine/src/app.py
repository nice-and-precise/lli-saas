import os

from fastapi import Depends, FastAPI, Header
from fastapi.responses import JSONResponse

from src.contracts import LEAD_CONTRACT_PATH, OWNER_RECORD_CONTRACT_PATH, RunScanRequest, SCAN_RESULT_CONTRACT_PATH, ScanResult
from src.scan_service import ScanExecutionError, ScanService, get_scan_service

app = FastAPI(title="lead-engine", version="0.1.0")


def _obituary_engine_configured() -> bool:
    return bool(os.getenv("OBITUARY_ENGINE_BASE_URL") or os.getenv("REAPER_BASE_URL"))


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "lead-engine",
        "crm_adapter_base_url_configured": str(bool(os.getenv("CRM_ADAPTER_BASE_URL"))).lower(),
        "obituary_engine_base_url_configured": str(_obituary_engine_configured()).lower(),
    }


@app.get("/ready", response_model=None)
def readiness() -> JSONResponse | dict[str, object]:
    missing = []

    if not os.getenv("CRM_ADAPTER_BASE_URL"):
        missing.append("CRM_ADAPTER_BASE_URL")

    if not _obituary_engine_configured():
        missing.append("OBITUARY_ENGINE_BASE_URL")

    if missing:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": "lead-engine",
                "missing_configuration": missing,
            },
        )

    return {
        "status": "ready",
        "service": "lead-engine",
    }


@app.get("/contract")
def contract() -> dict[str, str]:
    return {
        "lead_contract_path": str(LEAD_CONTRACT_PATH),
        "owner_record_contract_path": str(OWNER_RECORD_CONTRACT_PATH),
        "scan_result_contract_path": str(SCAN_RESULT_CONTRACT_PATH),
    }


@app.post(
    "/run-scan",
    response_model=ScanResult,
    responses={502: {"model": ScanResult}},
)
def run_scan(
    request: RunScanRequest,
    service: ScanService = Depends(get_scan_service),
    tenant_id: str = Header(default="pilot", alias="x-tenant-id"),
) -> ScanResult | JSONResponse:
    try:
        return service.run_scan(request, tenant_id)
    except ScanExecutionError as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.response.model_dump(mode="json"))
