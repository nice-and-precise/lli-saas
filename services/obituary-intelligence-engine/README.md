# obituary-intelligence-engine

Iowa obituary-intelligence service for `lli-saas`.

## Responsibilities

- collect obituary candidates from Iowa RSS sources
- fetch/normalize obituary text
- apply the actionability gate and dedupe rules
- extract heirs through configured provider fallbacks or heuristic parsing
- run nickname-aware fuzzy owner matching
- assign canonical match metadata and lead tiers
- persist feed checkpoints and processed-obituary fingerprints

## Commands

- Install: `poetry install`
- Run: `poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8080`
- Test: `python3 -m pytest`

## Runtime

- `POST /run-scan`
  - accepts `scan_id`, canonical `owner_records`, `lookback_days`, optional `reference_date`, and optional `source_ids`
  - request and response payloads are validated with Pydantic models at the HTTP boundary
  - invalid timestamps, malformed obituary URLs, extra fields, and enum mismatches are rejected before downstream processing
- `GET /health`
  - basic process health
- `GET /ready`
  - state-path readiness

## Lead Contract Validation

- Canonical lead objects are defined in `src/contracts.py` and mirrored by `shared/contracts/lead.schema.json`.
- `Lead`, `ObituaryMetadata`, and related nested models enforce required fields, strict object shapes, ISO-like date/date-time strings, and obituary URL validation.
- `run_scan()` builds `Lead` instances directly, so malformed lead output fails fast inside `obituary-intelligence-engine` instead of leaking into `crm-adapter`.
- Validation errors surface as FastAPI 422 responses on request parsing or as service exceptions during lead construction, which should be logged with the offending scan ID and obituary source.

## State

- default state path: `/var/lib/lli-saas/obituary-intelligence-engine/state.json`
- persisted state:
  - feed checkpoints
  - processed obituary fingerprints
- retention pruning is controlled by `OBITUARY_ENGINE_RETENTION_DAYS`

## Environment

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

- Without provider keys, the service falls back to its heuristic extractor.
- The service emits canonical `Lead[]` directly; `lead-engine` does not translate a legacy payload anymore.
