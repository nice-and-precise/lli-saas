from __future__ import annotations

import os

from fastapi import Depends, FastAPI

from src.contracts import ObituaryEngineRunScanRequest, ObituaryEngineScanResult
from src.service import ObituaryIntelligenceService, get_service
from src.state_store import ObituaryStateStore

app = FastAPI(title="obituary-intelligence-engine", version="0.1.0")


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
) -> ObituaryEngineScanResult:
    return service.run_scan(request)
