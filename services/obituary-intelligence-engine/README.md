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
- merge a pre-collected statewide obituary corpus from KV (built by the GitHub Actions prefetch job)

## Sources & collection

- Iowa obituary RSS feeds live in `src/feed_sources.py` and are an **operational item** (feeds rot —
  re-probe periodically). Two formerly-listed feeds, `the_gazette` and `nw_iowa_now`, were removed when
  their URLs began returning 404.
- The collector fetches with **`curl_cffi` Chrome TLS impersonation** (not plain `requests`) — several
  sources (the Lee Enterprises papers) 429 a default client but return 200 under impersonation. It is
  resilient: any source that fails (404/429/timeout/parse) is skipped, never aborting the scan.
- Per-scan work is bounded by `OBITUARY_MAX_ENTRIES_PER_SOURCE`, `OBITUARY_MAX_TOTAL_OBITUARIES`, and
  `OBITUARY_INTER_SOURCE_DELAY_SECONDS` so a scan stays well under Vercel's function limit.
- **Statewide corpus:** a daily GitHub Actions job (`prefetch_obituaries.py` →
  `src/legacy_collector.py` → `src/prefetch_store.py`) sweeps the full feed set + Legacy.com Iowa
  regional pages and writes a deduped corpus to KV; `collect()` merges it at scan time (gated by
  `OBITUARY_USE_PREFETCH`, default on). See [docs/vercel-deployment.md](../../docs/vercel-deployment.md).

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
- `GET /metrics`
  - daily pipeline metrics: obituaries scanned per day (with per-source breakdown) and leads, plus
    totals — the measure-progress surface. Recorded by the daily prefetch job; backfilled from
    published dates on first run. Stored in KV (`OBITUARY_METRICS_KEY`).

## Lead Contract Validation

- Canonical lead objects are defined in `src/contracts.py` and mirrored by `shared/contracts/lead.schema.json`.
- `Lead`, `ObituaryMetadata`, and related nested models enforce required fields, strict object shapes, ISO-like date/date-time strings, and obituary URL validation.
- `run_scan()` builds `Lead` instances directly, so malformed lead output fails fast inside `obituary-intelligence-engine` instead of leaking into `crm-adapter`.
- Validation errors surface as FastAPI 422 responses on request parsing or as service exceptions during lead construction, which should be logged with the offending scan ID and obituary source.

## State

Backend selected by `STATE_STORE_BACKEND` (`file` default for local dev; `kv` = Upstash on Vercel).

- file backend: JSON at `OBITUARY_ENGINE_STATE_PATH` (default `/var/lib/lli-saas/obituary-intelligence-engine/state.json`)
- kv backend: Upstash via `KV_REST_API_URL` / `KV_REST_API_TOKEN` (key `OBITUARY_ENGINE_KV_KEY`)
- persisted state: feed checkpoints + processed-obituary fingerprints (retention via `OBITUARY_ENGINE_RETENTION_DAYS`)
- the prefetched corpus is read from KV key `OBITUARY_PREFETCH_KEY` (`obituary-engine:prefetched`)

## Environment

- State: `STATE_STORE_BACKEND`, `OBITUARY_ENGINE_STATE_PATH`, `OBITUARY_ENGINE_KV_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `OBITUARY_ENGINE_RETENTION_DAYS`, `OBITUARY_METRICS_KEY`
- Collection: `OBITUARY_HTTP_TIMEOUT_SECONDS`, `OBITUARY_MAX_ENTRIES_PER_SOURCE`, `OBITUARY_MAX_TOTAL_OBITUARIES`, `OBITUARY_INTER_SOURCE_DELAY_SECONDS`, `OBITUARY_USE_PREFETCH`, `OBITUARY_PREFETCH_KEY`
- Heir extraction: `HEIR_EXTRACTION_{PRIMARY,FALLBACK,FINAL}_{PROVIDER,MODEL}`, `ANTHROPIC_BASE_URL` (Vercel AI Gateway), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`

## Notes

- Heir extraction routes Anthropic through the Vercel AI Gateway (`ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh`). Without provider keys, the service falls back to its heuristic extractor.
- The service emits canonical `Lead[]` directly; `lead-engine` does not translate a legacy payload anymore.
