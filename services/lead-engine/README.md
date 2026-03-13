# lead-engine

FastAPI orchestration service for the canonical `run_scan()` flow.

## Commands

- Install: `poetry install`
- Run: `poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8000`
- Lint: `poetry run ruff check src tests`
- Typecheck: `poetry run mypy src`
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
- Set `AUTH_JWT_SECRET` to the shared signing secret used by the pilot boundary.
- Optional auth envs: `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_ALLOWED_ORIGINS`.
- `GET /ready` verifies both required configuration and upstream obituary-engine reachability through `/health`.

## Security Boundary

- `GET /health` and `GET /ready` remain public.
- All other routes require a signed JWT bearer token with `sub`, `role`, `tenant_id`, `aud`, `iss`, and `exp`.
- `lead-engine` ignores caller-supplied tenant headers and preserves the verified bearer token when calling `crm-adapter` and `obituary-intelligence-engine`.
- Background callers such as the daily CronJob must use a pre-signed service token.

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
- The service emits JSON logs for scan start, owner fetch, obituary scan summary, delivery attempts, duplicate skips, failures, and final scan summaries. These logs include `scan_id` and `tenant_id`.
- Malformed upstream owner or obituary payloads are treated as explicit failures rather than being normalized silently.
