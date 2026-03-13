import os

import httpx
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.auth import AuthContext, get_auth_context, parse_allowed_origins
from src.contracts import (
    LEAD_CONTRACT_PATH,
    OWNER_RECORD_CONTRACT_PATH,
    SCAN_RESULT_CONTRACT_PATH,
    RunScanRequest,
    ScanResult,
)
from src.scan_service import ScanExecutionError, ScanService, get_scan_service

app = FastAPI(title="lead-engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def _obituary_engine_base_url() -> str:
    return os.getenv("OBITUARY_ENGINE_BASE_URL", "").rstrip("/")


def _obituary_engine_configured() -> bool:
    return bool(_obituary_engine_base_url())


def _obituary_engine_ready() -> tuple[bool, str | None]:
    base_url = _obituary_engine_base_url()
    if not base_url:
        return False, "missing_configuration"

    try:
        _timeout = float(os.getenv("READINESS_PROBE_TIMEOUT", "5.0"))
        response = httpx.get(f"{base_url}/health", timeout=_timeout)
    except httpx.HTTPError:
        return False, "unreachable"

    if response.status_code != 200:
        return False, f"http_{response.status_code}"

    try:
        payload = response.json()
    except ValueError:
        return False, "invalid_health_payload"

    if payload.get("status") != "ok":
        return False, "unhealthy"

    return True, None


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

    obituary_engine_ready, obituary_engine_reason = _obituary_engine_ready()
    if not obituary_engine_ready:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": "lead-engine",
                "dependency_failures": [
                    {
                        "dependency": "obituary_intelligence_engine",
                        "reason": obituary_engine_reason,
                    }
                ],
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
    auth: AuthContext = Depends(get_auth_context),
) -> ScanResult | JSONResponse:
    try:
        return service.run_scan(request, auth)
    except ScanExecutionError as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.response.model_dump(mode="json"))
