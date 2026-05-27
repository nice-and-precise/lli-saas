from __future__ import annotations

import os

from fastapi import Depends, FastAPI

from src.contracts import ObituaryEngineRunScanRequest, ObituaryEngineScanResult
from src.metrics_store import read_all as read_metrics
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
    store = ObituaryStateStore()
    # `.path` is set only for the file backend; KV reports its label instead.
    state_location = str(store.path.parent) if store.path is not None else store.backend.label
    return {
        "status": "ready",
        "service": "obituary-intelligence-engine",
        "state_backend": store.backend.label,
        "state_directory": state_location,
    }


@app.get("/metrics")
def metrics() -> dict[str, object]:
    """Daily obituary-pipeline metrics (how many obits scanned per day, by source,
    plus leads once flowing) — the measure-progress surface for the pilot."""
    daily = read_metrics()
    series = sorted(daily.values(), key=lambda entry: entry.get("date", ""))
    return {
        "service": "obituary-intelligence-engine",
        "daily": series,
        "totals": {
            "days_tracked": len(series),
            "obituaries": sum(entry.get("obituaries", 0) for entry in series),
            "leads_delivered": sum(entry.get("leads_delivered", 0) for entry in series),
        },
    }


@app.post("/run-scan", response_model=ObituaryEngineScanResult)
def run_scan(
    request: ObituaryEngineRunScanRequest,
    service: ObituaryIntelligenceService = Depends(get_service),
) -> ObituaryEngineScanResult:
    return service.run_scan(request)
