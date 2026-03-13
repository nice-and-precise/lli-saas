# crm-adapter

Express Monday adapter for OAuth, source-owner fetch, destination-board mapping, tenant-aware delivery state, and lead delivery for `lli-saas`.

## Commands

- Install: `npm install`
- Run: `npm run dev`
- Lint: `npm run lint`
- Format check: `npm run format:check`
- Test: `npm test`
- Docker build: `docker build -f services/crm-adapter/Dockerfile -t lli-saas/crm-adapter:pilot .`

## Environment

- `MONDAY_CLIENT_ID`
- `MONDAY_CLIENT_SECRET`
- `MONDAY_REDIRECT_URI`
- `MONDAY_API_BASE_URL` (optional, defaults to `https://api.monday.com/v2`)
- `CRM_ADAPTER_STATE_PATH` (optional, defaults to `/var/lib/lli-saas/crm-adapter/monday-state.json`)
- `AUTH_JWT_SECRET`
- `AUTH_JWT_ISSUER` (optional, defaults to `lli-saas-pilot`)
- `AUTH_JWT_AUDIENCE` (optional, defaults to `lli-saas`)
- `AUTH_JWT_TTL_SECONDS` (optional, defaults to `3600`)
- `AUTH_ALLOWED_ORIGINS` (comma-separated portal origin allowlist)
- `OPERATOR_EMAIL`
- `OPERATOR_PASSWORD`
- `OPERATOR_TENANT_ID` (optional, defaults to `pilot`)
- `OPERATOR_PORTAL_BASE_URL` (optional; if set, Monday callback redirects the operator back to `/dashboard`)
- `PORT` (optional, defaults to `3000`)

The adapter persists tenant-aware Monday OAuth, selected destination board, board mapping, scan runs, delivery history, and an idempotency index in the file at `CRM_ADAPTER_STATE_PATH`. It does not persist the source owner corpus. In Kubernetes, pilot durability requires the mounted storage path from `infra/`.

State writes now use a same-directory temp file, `fsync`, and `rename` sequence behind a lock file. If the state file is malformed, the adapter returns an explicit `state_corruption` error and copies the bad document to `*.corrupt-<timestamp>` for operator recovery instead of silently normalizing it.

## Monday assumptions

- Source owner board name: `Clients`
- Destination lead board: the currently selected board in adapter state
- Default item-name strategy: `deceased_name_county`
- Duplicate identity: durable `idempotency_key` derived from canonical lead identity
- Secondary duplicate checks: persisted delivery history/index, mapped `idempotency_key` column when configured, obituary URL, then item name fallback
- Recommended board mapping: add a text column for `idempotency_key` so duplicate protection survives adapter restarts and local state loss better than item-name checks alone

## Routes

- `POST /session/login` exchanges the env-configured operator credentials for a signed JWT bearer token.
- `GET /session/me` returns the verified JWT claims for the current operator or service caller.
- `GET /auth/login` redirects to Monday OAuth.
- `GET /auth/login-url` returns the Monday authorization URL for an authenticated operator session.
- `GET /auth/callback?code=...&state=...` is the only non-health public callback route; it validates the signed OAuth state minted by `/auth/login` or `/auth/login-url`, then persists token state for the verified tenant.
- `GET /boards` discovers boards using the persisted OAuth token.
- `GET /owners?limit=...` fetches owner records from the Monday `Clients` board and normalizes them into canonical `OwnerRecord[]`.
- `POST /boards/select` with `{ "board_id": "..." }` persists the selected destination board metadata.
- `GET /mapping` returns the persisted board mapping for the selected destination board.
- `PUT /mapping` persists a focused board mapping model for the selected destination board.
- `GET /deliveries` returns persisted delivery attempts and scan-run status for the active tenant.
- `GET /status` returns the current board, mapping, delivery, and scan snapshot for the active tenant.
- `POST /leads` validates the canonical lead contract, checks for duplicates on the selected board, and records created, skipped, or failed delivery outcomes.

## Logging

- The service emits one JSON log line per event.
- Delivery and scan-related events include `tenant_id` and `scan_id` whenever those values are available.
- Important events include owner fetch start/completion/failure, OAuth callback failures, duplicate skips, delivery attempts, Monday retry/failure events, and state load/write/corruption events.

## Operator Recovery

If the adapter reports `state_corruption`:

1. Inspect the copied `*.corrupt-*` file next to `CRM_ADAPTER_STATE_PATH`.
2. Restore the main state file from backup or replace it with a valid JSON document.
3. If a board-level `idempotency_key` column is mapped, replayed deliveries will still be skipped from Monday even after local state loss.
4. Without a mapped `idempotency_key` column, duplicate protection still falls back to persisted history, obituary URL, and item-name checks, but PVC loss remains a residual limitation.

## Mapping Scope

The adapter can map the richer obituary lead fields into Monday column IDs, including:

- owner and deceased identity
- county, acres, and operator
- death date and obituary source/link
- match score and match status
- tier
- heir count and formatted heir list
- out-of-state, executor, and unexpected-death signals
- tags and scan metadata

Security notes:

- All non-health routes require a valid JWT bearer token.
- `tenant_id` is derived from verified JWT claims, never from request headers.
- Spoofed `x-tenant-id` values are rejected.
- CORS is restricted to the configured `AUTH_ALLOWED_ORIGINS` allowlist.

Example lead payload:

```json
{
  "scan_id": "scan-1",
  "source": "obituary_intelligence_engine",
  "run_started_at": "2026-03-11T10:00:00Z",
  "run_completed_at": "2026-03-11T10:01:00Z",
  "owner_id": "owner-1",
  "owner_name": "Jordan Example",
  "deceased_name": "Pat Example",
  "property": {
    "county": "Boone",
    "state": "IA",
    "acres": 120.5,
    "parcel_ids": ["parcel-1"],
    "address_line_1": "123 County Road",
    "city": "Boone",
    "postal_code": "50036",
    "operator_name": "Johnson Farms LLC"
  },
  "heirs": [
    {
      "name": "Casey Example",
      "relationship": "son",
      "location_city": "Phoenix",
      "location_state": "AZ",
      "out_of_state": true,
      "phone": null,
      "email": null,
      "mailing_address": null,
      "executor": false
    }
  ],
  "obituary": {
    "url": "https://example.com/obit",
    "source_id": "kwbg_boone",
    "published_at": "2026-03-11T10:00:00Z",
    "death_date": "2026-03-10",
    "deceased_city": "Boone",
    "deceased_state": "IA"
  },
  "match": {
    "score": 96.2,
    "last_name_score": 100,
    "first_name_score": 90.5,
    "location_bonus_applied": true,
    "status": "auto_confirmed"
  },
  "tier": "hot",
  "out_of_state_heir_likely": true,
  "out_of_state_states": ["AZ"],
  "executor_mentioned": false,
  "unexpected_death": false,
  "notes": ["pilot-ready"],
  "tags": ["tier:hot", "signal:out_of_state_heir"],
  "raw_artifacts": ["artifact-1.json"]
}
```
