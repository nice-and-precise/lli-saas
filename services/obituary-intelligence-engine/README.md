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
- `GET /health`
  - basic process health
- `GET /ready`
  - state-path readiness

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
