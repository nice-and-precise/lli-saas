import os

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse

from src.contracts import CONTRACT_PATH, RunScanResponse, ScanRequest
from src.scan_service import ScanExecutionError, ScanService, get_scan_service

app = FastAPI(title="lead-engine", version="0.1.0")


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "lead-engine",
        "reaper_base_url_configured": str(bool(os.getenv("REAPER_BASE_URL"))).lower(),
    }


@app.get("/ready", response_model=None)
def readiness() -> JSONResponse | dict[str, object]:
    missing = []

    if not os.getenv("REAPER_BASE_URL"):
        missing.append("REAPER_BASE_URL")

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
    return {"contract_path": str(CONTRACT_PATH)}


@app.post(
    "/run-scan",
    response_model=RunScanResponse,
    responses={502: {"model": RunScanResponse}},
)
def run_scan(
    request: ScanRequest,
    service: ScanService = Depends(get_scan_service),
) -> RunScanResponse | JSONResponse:
    try:
        return service.run_scan(request)
    except ScanExecutionError as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.response.model_dump(mode="json"))
