# crm-adapter

Express adapter for Monday OAuth, board discovery, board mapping, tenant-aware delivery state, and lead delivery for `lli-saas`.

## Commands

- Install: `npm install`
- Run: `npm run dev`
- Test: `npm test`
- Docker build: `docker build -t lli-saas/crm-adapter:phase3 .`

## Environment

- `LEAD_ENGINE_BASE_URL` (required for `/first-scan`, defaults to `http://localhost:8000`)
- `MONDAY_CLIENT_ID`
- `MONDAY_CLIENT_SECRET`
- `MONDAY_REDIRECT_URI`
- `MONDAY_API_BASE_URL` (optional, defaults to `https://api.monday.com/v2`)
- `PORT` (optional, defaults to `3000`)

The adapter persists tenant-aware Monday OAuth, selected board, board mapping, scan runs, and delivery state in `data/monday-state.json` by default.

## Pilot Setup Order

1. Start `lead-engine` and confirm `/health`.
2. Start `crm-adapter` with valid Monday OAuth credentials and `LEAD_ENGINE_BASE_URL`.
3. Complete Monday OAuth through `/auth/login`.
4. Discover boards with `GET /boards`, persist a board through `POST /boards/select`, and confirm the mapping through `GET /mapping`.
5. Start `user-portal` with `VITE_CRM_ADAPTER_BASE_URL` pointing at the adapter, then use the dashboard to run the first scan flow.

## Routes

- `GET /auth/login` redirects to Monday OAuth.
- `GET /auth/callback?code=...` exchanges the OAuth code and persists token state.
- `GET /boards` discovers boards using the persisted OAuth token.
- `POST /boards/select` with `{ "board_id": "..." }` persists the selected board metadata.
- `GET /mapping` returns the persisted board mapping for the selected board.
- `PUT /mapping` persists a focused board mapping model for the selected board.
- `GET /deliveries` returns persisted delivery attempts and scan run status for the active tenant.
- `GET /status` returns the current board, mapping, delivery, and scan snapshot for the active tenant.
- `POST /first-scan` runs `lead-engine` scan execution and delivers returned leads through the adapter workflow.
- `POST /leads` validates the shared internal lead contract, checks for duplicates on the selected board, and records created, skipped, or failed delivery outcomes.

Optional request header:

- `x-tenant-id` selects a tenant-scoped state bucket. Defaults to `pilot`.

Example lead payload:

```json
{
  "scan_id": "scan-1",
  "source": "reaper",
  "run_started_at": "2026-03-11T10:00:00Z",
  "run_completed_at": "2026-03-11T10:01:00Z",
  "owner_name": "Jordan Example",
  "deceased_name": "Pat Example",
  "property": {
    "address_line_1": "123 County Road",
    "city": "Austin",
    "state": "TX",
    "postal_code": "78701",
    "county": "Travis"
  },
  "contacts": [
    {
      "name": "Casey Example",
      "relationship": "heir",
      "phone": "555-0100",
      "email": "casey@example.com",
      "mailing_address": "PO Box 1"
    }
  ],
  "notes": ["pilot-ready"],
  "tags": ["inheritance"],
  "raw_artifacts": ["artifact-1.json"]
}
```
