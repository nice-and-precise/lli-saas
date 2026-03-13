from __future__ import annotations

import logging
import os

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.auth import AuthContext, get_auth_context, parse_allowed_origins
from src.contracts import ObituaryEngineRunScanRequest, ObituaryEngineScanResult, SourceHealthResponse
from src.logging import get_logger, log_event
from src.service import ObituaryIntelligenceService, get_service
from src.state_store import ObituaryStateStore, ObituaryStateStoreError

app = FastAPI(title="obituary-intelligence-engine", version="0.1.0")
logger = get_logger("obituary-intelligence-engine")
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(ObituaryStateStoreError)
def handle_state_store_error(_request: Request, exc: ObituaryStateStoreError) -> JSONResponse:
    log_event(
        logger,
        logging.ERROR,
        "obituary-intelligence-engine",
        "obituary_state_request_failed",
        code=exc.code,
        state_path=exc.state_path,
        quarantine_path=exc.quarantine_path,
        error=str(exc),
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": str(exc),
            "code": exc.code,
            **({"state_path": exc.state_path} if exc.state_path else {}),
            **({"quarantine_path": exc.quarantine_path} if exc.quarantine_path else {}),
        },
    )


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "obituary-intelligence-engine",
        "state_path": os.getenv(
            "OBITUARY_ENGINE_STATE_PATH",
            "/var/lib/lli-saas/obituary-intelligence-engine/state.json",
        ),
    }


@app.get("/ready")
def ready() -> dict[str, object]:
    state_path = ObituaryStateStore().path
    return {
        "status": "ready",
        "service": "obituary-intelligence-engine",
        "state_directory": str(state_path.parent),
    }


@app.post("/run-scan", response_model=ObituaryEngineScanResult)
def run_scan(
    request: ObituaryEngineRunScanRequest,
    service: ObituaryIntelligenceService = Depends(get_service),
    auth: AuthContext = Depends(get_auth_context),
) -> ObituaryEngineScanResult:
    return service.run_scan(request, tenant_id=auth.tenant_id)


@app.get("/sources/health", response_model=SourceHealthResponse)
def source_health(
    lookback_days: int = 30,
    include_supplemental: bool = False,
    service: ObituaryIntelligenceService = Depends(get_service),
    _auth: AuthContext = Depends(get_auth_context),
) -> SourceHealthResponse:
    return service.source_health(
        lookback_days=lookback_days,
        include_supplemental=include_supplemental,
    )
