# lead-engine

FastAPI orchestration service for the canonical `run_scan()` flow.

## Commands

- Install: `poetry install`
- Run: `poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8000`
- Test: `poetry run pytest`

## Runtime

- `POST /run-scan` accepts an optional `owner_limit` and orchestrates:
  1. owner fetch from the CRM adapter
  2. canonical owner validation
  3. obituary intelligence execution
  4. canonical lead delivery back through the CRM adapter
- `GET /contract` exposes the canonical contract artifact paths for `Lead`, `OwnerRecord`, and `ScanResult`.
- Set `CRM_ADAPTER_BASE_URL` to the running `crm-adapter` base URL.
- Set `OBITUARY_ENGINE_BASE_URL` to the upstream obituary engine base URL.
  - `REAPER_BASE_URL` remains a legacy fallback for the wrapped Reaper runtime.

## Notes

- `lead-engine` does not own the customer owner corpus.
- Owner data is fetched fresh from CRM for every scan.
- The wrapper around the legacy Reaper concept is exposed internally as `obituary_intelligence_engine`.
