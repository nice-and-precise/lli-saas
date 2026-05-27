# Developer Onboarding

## Start With

Read [docs/system-architecture.md](../docs/system-architecture.md) first.

The key constraints are:

- Monday.com is the current CRM source of truth
- the source owner board is `Clients`
- `lead-engine` is the only orchestration entrypoint
- obituary intelligence runs in its own service

## Prerequisites

1. Install Node.js 20+, Python 3.11+, and Poetry. Docker + kubectl are needed only for the legacy
   `infra/` self-host path; the pilot deploys on Vercel (see
   [vercel-deployment.md](vercel-deployment.md)).
2. Install Poetry if needed:
   - `python3 -m pip install --user poetry`
3. Clone `nice-and-precise/lli-saas`.

## Install Dependencies

1. `cd services/lead-engine && poetry install`
2. `cd ../obituary-intelligence-engine && poetry install`
3. `cd ../crm-adapter && npm install`
4. `cd ../user-portal && npm install`

## Environment Files

Copy each `.env.example` to `.env` if you need local overrides.

State persistence is selected by `STATE_STORE_BACKEND` (`file` default for local dev, `kv` for
Vercel/Upstash). The `SERVICE_SHARED_SECRET` inter-service guard is a no-op when unset, so local dev
needs no secret. Production values are documented in [vercel-deployment.md](vercel-deployment.md).

- `services/lead-engine/.env`
  - `CRM_ADAPTER_BASE_URL`
  - `OBITUARY_ENGINE_BASE_URL`
  - `SERVICE_SHARED_SECRET` (optional locally)
- `services/obituary-intelligence-engine/.env`
  - `STATE_STORE_BACKEND` (`file` | `kv`)
  - `OBITUARY_ENGINE_STATE_PATH` (file backend) / `OBITUARY_ENGINE_KV_KEY` + `KV_REST_API_URL` + `KV_REST_API_TOKEN` (kv backend)
  - `OBITUARY_ENGINE_RETENTION_DAYS`
  - `OBITUARY_HTTP_TIMEOUT_SECONDS`
  - `HEIR_EXTRACTION_PRIMARY_PROVIDER` / `_PRIMARY_MODEL` (pilot default: `gemini` / `gemini-2.5-flash`)
  - `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) — deployed choice; or route Anthropic via AI Gateway with
    `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`. No key → rule-based heuristic fallback.
- `services/crm-adapter/.env`
  - `MONDAY_CLIENT_ID`
  - `MONDAY_CLIENT_SECRET`
  - `MONDAY_REDIRECT_URI`
  - `STATE_STORE_BACKEND` (`file` | `kv`)
  - `CRM_ADAPTER_STATE_PATH` (file backend) / `CRM_ADAPTER_KV_KEY` + `KV_REST_API_URL` + `KV_REST_API_TOKEN` (kv backend)
  - `SERVICE_SHARED_SECRET` (optional locally)
- `services/user-portal/.env`
  - `VITE_CRM_ADAPTER_BASE_URL`
  - `VITE_LEAD_ENGINE_BASE_URL`

## Start Services

1. `cd services/lead-engine && poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8000`
2. `cd services/obituary-intelligence-engine && poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8080`
3. `cd services/crm-adapter && npm run dev`
4. `cd services/user-portal && npm run dev`

## Verify Local Health

- `http://localhost:8000/ready`
- `http://localhost:8080/ready`
- `http://localhost:3000/ready`
- `http://localhost:5173/` (the portal lands on `/dashboard`; there is no separate login page)

## First Functional Pass

1. Click **Connect Monday** on the dashboard (or hit `crm-adapter` `/auth/login`) to complete OAuth.
   The callback redirects back to `/dashboard?connected=1`.
2. Confirm board discovery works with `GET /boards`.
3. Populate owners: use the portal's **Import your owners** CSV panel, or
   `POST /owners/import` with `{ "owners": [{ "owner_name", "county", "state" }] }` — this finds-or-creates
   the Monday `Clients` board. Confirm `GET /owners` then returns them.
4. Select a destination board.
5. Save a board mapping (or **Apply confident fixes**).
6. Press **Run obituary scan** (or `POST lead-engine /run-scan`).
7. Confirm delivery history appears in the portal and the items show up in Monday.

## Local Verification Commands

- `cd services/crm-adapter && npm test`
- `cd services/user-portal && npm test`
- `cd services/lead-engine && python3 -m pytest`
- `cd services/obituary-intelligence-engine && python3 -m pytest`
- `bash scripts/pilot-readiness-check.sh`

## Notes

- `crm-adapter` persists OAuth state, selected board, mapping, and delivery visibility through a file-backed store.
- `obituary-intelligence-engine` persists feed checkpoints and processed-obituary fingerprints.
- The deployed portal reads runtime config from `/runtime-config.js`.
- Phase-planning artifacts live under `.planning/`.
