# obituary-intelligence-engine

Iowa obituary-intelligence service for `lli-saas`.

## Responsibilities

- collect obituary candidates from a mixed Iowa source set
  - WordPress RSS feeds
  - publisher obituary listing pages
  - supplemental funeral-home listings when enabled
- fetch/normalize obituary text
- apply the actionability gate and dedupe rules
- extract heirs through configured provider fallbacks or heuristic parsing
- run nickname-aware fuzzy owner matching
- assign canonical match metadata and lead tiers
- persist feed checkpoints and processed-obituary fingerprints

## Commands

- Install: `poetry install`
- Run: `poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8080`
- Lint: `poetry run ruff check src tests`
- Typecheck: `poetry run mypy src`
- Test: `poetry run pytest`
- Validate live obituary sources: `cd ../.. && python3 scripts/validate-obituary-sources.py --json-output /tmp/obituary-sources.json`

## Runtime

- `POST /run-scan`
  - accepts `scan_id`, canonical `owner_records`, `lookback_days`, optional `reference_date`, and optional `source_ids`
  - returns canonical leads plus `source_reports` and recoverable collection `errors`
- `GET /health`
  - basic process health
- `GET /ready`
  - state-path readiness
- `GET /sources/health`
  - validates live obituary source health and proof status

## State

- default state path: `/var/lib/lli-saas/obituary-intelligence-engine/state.json`
- persisted state:
  - feed checkpoints
  - processed obituary fingerprints
- retention pruning is controlled by `OBITUARY_ENGINE_RETENTION_DAYS`
- state writes use a temp file plus `fsync` and `os.replace` behind a lock file
- malformed state is treated as explicit corruption, copied to `state.json.corrupt-<timestamp>`, and returned as a `state_corruption` error until the operator repairs the primary file

## Environment

- `AUTH_JWT_SECRET`
- `AUTH_JWT_ISSUER`
- `AUTH_JWT_AUDIENCE`
- `AUTH_ALLOWED_ORIGINS`
- `OBITUARY_ENGINE_STATE_PATH`
- `OBITUARY_ENGINE_RETENTION_DAYS`
- `OBITUARY_HTTP_TIMEOUT_SECONDS`
- `HEIR_EXTRACTION_PRIMARY_PROVIDER`
- `HEIR_EXTRACTION_PRIMARY_MODEL`
- `HEIR_EXTRACTION_FALLBACK_PROVIDER`
- `HEIR_EXTRACTION_FALLBACK_MODEL`
- `HEIR_EXTRACTION_FINAL_PROVIDER`
- `HEIR_EXTRACTION_FINAL_MODEL`
- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
- `ANTHROPIC_API_KEY`

## Notes

- `GET /health` and `GET /ready` remain public; every other route requires a valid JWT bearer token.
- The service does not trust `x-tenant-id`; tenant context must come from verified token claims.
- Without provider keys, the service falls back to its heuristic extractor.
- The service emits canonical `Lead[]` directly; `lead-engine` does not translate a legacy payload anymore.
- HTML collection prefers Scrapling for blocked publisher pages and falls back to `requests` when Scrapling is unavailable.
- The service emits JSON logs for scan start, collection summaries, completion, and state load/write/corruption events. `scan_id` and `tenant_id` are logged when available.

## Operator Recovery

If `/run-scan` returns `state_corruption`:

1. Inspect the copied `state.json.corrupt-*` file alongside the configured state path.
2. Restore the main state file from backup or replace it with valid JSON matching the documented shape.
3. Retry the scan after the repaired state file is in place.
