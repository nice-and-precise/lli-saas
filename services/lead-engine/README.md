# lead-engine

FastAPI orchestration service for the canonical `run_scan()` flow.

## Commands

- Install: `poetry install`
- Run: `poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8000`
- Test: `poetry run pytest`

## Runtime

- `POST /run-scan` accepts `owner_limit` plus obituary scan options (`lookback_days`, `reference_date`, `source_ids`) and orchestrates:
  1. owner fetch from the CRM adapter
  2. canonical owner validation
  3. obituary intelligence execution
  4. canonical lead delivery back through the CRM adapter
- `GET /contract` exposes the canonical contract artifact paths for `Lead`, `OwnerRecord`, and `ScanResult`.
- Set `CRM_ADAPTER_BASE_URL` to the running `crm-adapter` base URL.
- Set `OBITUARY_ENGINE_BASE_URL` to the upstream obituary engine base URL.
- `GET /ready` verifies both required configuration and upstream obituary-engine reachability through `/health`.

Example request:

```json
{
  "owner_limit": 1000,
  "lookback_days": 7,
  "reference_date": "2026-03-12",
  "source_ids": ["kwbg_boone", "the_gazette"]
}
```

## Notes

- `lead-engine` does not own the customer owner corpus.
- Owner data is fetched fresh from CRM for every scan.
- The obituary engine speaks the canonical lead contract directly; `lead-engine` no longer performs legacy Reaper payload translation.
