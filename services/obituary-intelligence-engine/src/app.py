from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from src.contracts import ObituaryEngineRunScanRequest, ObituaryEngineScanResult
from src.metrics_store import read_all as read_metrics
from src.metrics_store import record_leads_delivered
from src.service import ObituaryIntelligenceService, get_service
from src.state_store import ObituaryStateStore

app = FastAPI(title="obituary-intelligence-engine", version="0.1.0")


def require_service_secret(authorization: str | None = Header(default=None)) -> None:
    """Guards /run-scan when SERVICE_SHARED_SECRET is set. The obituary engine is
    only ever called server-to-server by lead-engine (which sends the bearer), so
    this protects the direct AI-spend trigger without affecting the portal. No-op
    when unset (local dev/tests)."""
    secret = os.getenv("SERVICE_SHARED_SECRET")
    if not secret:
        return
    if authorization == f"Bearer {secret}":
        return
    raise HTTPException(status_code=401, detail="missing or invalid service credentials")


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "obituary-intelligence-engine",
        # Report the backend name ("file"/"kv"), never the filesystem path.
        "state_backend": ObituaryStateStore().backend.label,
    }


@app.get("/ready")
def ready() -> dict[str, object]:
    return {
        "status": "ready",
        "service": "obituary-intelligence-engine",
        # Backend name only — the filesystem path is internal, not disclosed here.
        "state_backend": ObituaryStateStore().backend.label,
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


class LeadsDeliveredRequest(BaseModel):
    count: int = Field(ge=0)
    date: str | None = None


@app.post("/metrics/leads-delivered")
def metrics_leads_delivered(
    request: LeadsDeliveredRequest,
    _: None = Depends(require_service_secret),
) -> dict[str, object]:
    """Record leads newly delivered to a CRM today, so the success metric trends.
    Server-to-server only (lead-engine calls it best-effort after delivery); guarded
    by the same service secret as /run-scan. No-op without KV."""
    date_str = request.date or datetime.now(timezone.utc).date().isoformat()
    record_leads_delivered(date_str, request.count)
    return {"status": "ok", "date": date_str, "leads_delivered": request.count}


@app.post("/run-scan", response_model=ObituaryEngineScanResult)
def run_scan(
    request: ObituaryEngineRunScanRequest,
    service: ObituaryIntelligenceService = Depends(get_service),
    _: None = Depends(require_service_secret),
) -> ObituaryEngineScanResult:
    return service.run_scan(request)
