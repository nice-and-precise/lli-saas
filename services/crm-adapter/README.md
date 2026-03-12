# crm-adapter

Express Monday adapter for OAuth, source-owner fetch, destination-board mapping, tenant-aware delivery state, and lead delivery for `lli-saas`.

## Commands

- Install: `npm install`
- Run: `npm run dev`
- Test: `npm test`
- Docker build: `docker build -f services/crm-adapter/Dockerfile -t lli-saas/crm-adapter:pilot .`

## Environment

- `MONDAY_CLIENT_ID`
- `MONDAY_CLIENT_SECRET`
- `MONDAY_REDIRECT_URI`
- `MONDAY_API_BASE_URL` (optional, defaults to `https://api.monday.com/v2`)
- `CRM_ADAPTER_STATE_PATH` (optional, defaults to `/var/lib/lli-saas/crm-adapter/monday-state.json`)
- `PORT` (optional, defaults to `3000`)

The adapter persists tenant-aware Monday OAuth, selected destination board, board mapping, scan runs, and delivery state in the file at `CRM_ADAPTER_STATE_PATH`. It does not persist the source owner corpus. In Kubernetes, pilot durability requires the mounted storage path from `infra/`.

## Monday assumptions

- Source owner board name: `Clients`
- Destination lead board: the currently selected board in adapter state
- Default item-name strategy: `deceased_name_county`
- Duplicate identity: obituary URL first, then `{deceased_name, death_date, owner_id}` fallback

## Routes

- `GET /auth/login` redirects to Monday OAuth.
- `GET /auth/callback?code=...` exchanges the OAuth code and persists token state.
- `GET /boards` discovers boards using the persisted OAuth token.
- `GET /owners?limit=...` fetches owner records from the Monday `Clients` board and normalizes them into canonical `OwnerRecord[]`.
- `POST /boards/select` with `{ "board_id": "..." }` persists the selected destination board metadata.
- `GET /mapping` returns the persisted board mapping for the selected destination board.
- `PUT /mapping` persists a focused board mapping model for the selected destination board.
- `GET /deliveries` returns persisted delivery attempts and scan-run status for the active tenant.
- `GET /status` returns the current board, mapping, delivery, and scan snapshot for the active tenant.
- `POST /leads` validates the canonical lead contract, checks for duplicates on the selected board, and records created, skipped, or failed delivery outcomes.

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

Optional request header:

- `x-tenant-id` selects a tenant-scoped state bucket. Defaults to `pilot`.

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
