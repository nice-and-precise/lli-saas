# Developer Onboarding

## Start With

Read [docs/system-architecture.md](/Users/jordan/Desktop/LLI_v1/docs/system-architecture.md) first.
Then read [docs/engineering-standards.md](/Users/jordan/Desktop/LLI_v1/docs/engineering-standards.md) for the repo command surface and CI expectations.

The key constraints are:

- Monday.com is the current CRM source of truth
- the source owner board is `Clients`
- `lead-engine` is the only orchestration entrypoint
- obituary intelligence runs in its own service

## Prerequisites

1. Install Node.js 20+, Python 3.11+, Docker Desktop, and kubectl.
2. Install Poetry if needed:
   - `python3 -m pip install --user poetry`
3. Clone `nice-and-precise/lli-saas`.
4. Optional but recommended:
   - use `.nvmrc` for Node 20
   - use `.python-version` for Python 3.11

## Install Dependencies

1. `make bootstrap`
2. If you are intentionally updating JS lockfiles, use `npm install` inside the affected service.

## Repo Commands

- `make lint`
  - runs `ruff` in both Python services and `eslint` in both JS services
- `make typecheck`
  - runs `mypy` for `services/lead-engine/src` and `services/obituary-intelligence-engine/src`
- `make format-check`
  - runs `prettier --check` for `crm-adapter` and `user-portal`
- `make test`
  - runs contract validation plus Python and JS test suites

## Environment Files

Copy each `.env.example` to `.env` if you need local overrides.

Before you start services, run `bash scripts/check-credentials.sh` to see any missing env files, empty values, or required external secrets.

- `services/lead-engine/.env`
  - `CRM_ADAPTER_BASE_URL`
  - `OBITUARY_ENGINE_BASE_URL`
  - `AUTH_JWT_SECRET`
  - optional: `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_ALLOWED_ORIGINS`
- `services/obituary-intelligence-engine/.env`
  - `AUTH_JWT_SECRET`
  - optional: `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_ALLOWED_ORIGINS`
  - `OBITUARY_ENGINE_STATE_PATH`
  - `OBITUARY_ENGINE_RETENTION_DAYS`
  - `OBITUARY_HTTP_TIMEOUT_SECONDS`
  - `GEMINI_API_KEY` or `GOOGLE_API_KEY`
  - `ANTHROPIC_API_KEY`
- `services/crm-adapter/.env`
  - `MONDAY_CLIENT_ID`
  - `MONDAY_CLIENT_SECRET`
  - `MONDAY_REDIRECT_URI`
  - `CRM_ADAPTER_STATE_PATH`
  - `AUTH_JWT_SECRET`
  - `AUTH_ALLOWED_ORIGINS`
  - `OPERATOR_EMAIL`
  - `OPERATOR_PASSWORD`
  - optional: `OPERATOR_TENANT_ID`, `OPERATOR_PORTAL_BASE_URL`
- `services/user-portal/.env`
  - `VITE_CRM_ADAPTER_BASE_URL`
  - `VITE_LEAD_ENGINE_BASE_URL`

See [docs/credential-setup.md](/Users/jordan/Desktop/LLI_v1/docs/credential-setup.md) for the shortest path to creating the required keys and filling the env files.

## Start Services

1. `cd services/lead-engine && poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8000`
2. `cd services/obituary-intelligence-engine && poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8080`
3. `cd services/crm-adapter && npm run dev`
4. `cd services/user-portal && npm run dev`

## Verify Local Health

- `http://localhost:8000/ready`
- `http://localhost:8080/ready`
- `http://localhost:3000/ready`
- `http://localhost:5173/login`

## First Functional Pass

1. Sign in at `/login` with the env-configured operator credentials.
2. Complete Monday OAuth through the portal's `Connect Monday` action.
3. Confirm board discovery works with authenticated `GET /boards`.
4. Confirm owner fetch works from the Monday `Clients` board with authenticated `GET /owners`.
5. Select a destination board.
6. Save a board mapping.
7. Launch a scan from the dashboard or authenticated `lead-engine /run-scan`.
8. Confirm delivery history appears in the portal and the item shows up in Monday.

## Local Verification Commands

- `make lint`
- `make typecheck`
- `make format-check`
- `cd services/crm-adapter && npm test`
- `cd services/user-portal && npm test`
- `cd services/lead-engine && poetry run pytest`
- `cd services/obituary-intelligence-engine && poetry run pytest`
- `python3 scripts/check-contracts.py`
- `make test`
- `bash scripts/pilot-readiness-check.sh`

## Notes

- The pilot boundary now uses a shared HS256 JWT secret across `crm-adapter`, `lead-engine`, and `obituary-intelligence-engine`.
- Only `/health` and `/ready` remain unauthenticated service routes.
- `x-tenant-id` is no longer a trust boundary; use the verified `tenant_id` claim instead.
- `crm-adapter` persists OAuth state, selected board, mapping, and delivery visibility through a file-backed store.
- `obituary-intelligence-engine` persists feed checkpoints and processed-obituary fingerprints.
- The deployed portal reads runtime config from `/runtime-config.js`.
- Phase-planning artifacts live under `.planning/`.
