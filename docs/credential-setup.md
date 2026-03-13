# Credential Setup

Use this when preparing local development, a demo machine, or a fresh deploy target.

Run the audit first:

```bash
bash scripts/check-credentials.sh
```

The script reports:

- missing `.env` files
- missing required local config
- missing external secrets
- stale local config drift such as removed legacy runtime variables

## What You Actually Need

For normal local development, the only external secrets currently required are:

- `MONDAY_CLIENT_ID`
- `MONDAY_CLIENT_SECRET`
- `AUTH_JWT_SECRET`
- `OPERATOR_EMAIL`
- `OPERATOR_PASSWORD`
- one obituary extraction provider key:
  - `GEMINI_API_KEY` or `GOOGLE_API_KEY`
  - optional fallback: `ANTHROPIC_API_KEY`

Everything else is a local URL, port, or file path.

## File Checklist

`services/lead-engine/.env`

```dotenv
PORT=8000
CRM_ADAPTER_BASE_URL=http://localhost:3000
OBITUARY_ENGINE_BASE_URL=http://localhost:8080
AUTH_JWT_SECRET=
AUTH_JWT_ISSUER=lli-saas-pilot
AUTH_JWT_AUDIENCE=lli-saas
AUTH_ALLOWED_ORIGINS=http://localhost:5173
```

`services/obituary-intelligence-engine/.env`

```dotenv
PORT=8080
OBITUARY_ENGINE_STATE_PATH=./data/state.json
OBITUARY_ENGINE_RETENTION_DAYS=30
OBITUARY_HTTP_TIMEOUT_SECONDS=10
HEIR_EXTRACTION_PRIMARY_PROVIDER=gemini
HEIR_EXTRACTION_PRIMARY_MODEL=gemini-2.5-flash
HEIR_EXTRACTION_FALLBACK_PROVIDER=gemini
HEIR_EXTRACTION_FALLBACK_MODEL=gemini-1.5-flash
HEIR_EXTRACTION_FINAL_PROVIDER=anthropic
HEIR_EXTRACTION_FINAL_MODEL=claude-3-7-sonnet-latest
GEMINI_API_KEY=
GOOGLE_API_KEY=
ANTHROPIC_API_KEY=
AUTH_JWT_SECRET=
AUTH_JWT_ISSUER=lli-saas-pilot
AUTH_JWT_AUDIENCE=lli-saas
AUTH_ALLOWED_ORIGINS=http://localhost:5173
```

`services/crm-adapter/.env`

```dotenv
PORT=3000
MONDAY_CLIENT_ID=
MONDAY_CLIENT_SECRET=
MONDAY_REDIRECT_URI=http://localhost:3000/auth/callback
MONDAY_API_BASE_URL=https://api.monday.com/v2
CRM_ADAPTER_STATE_PATH=./data/monday-state.json
AUTH_JWT_SECRET=
AUTH_JWT_ISSUER=lli-saas-pilot
AUTH_JWT_AUDIENCE=lli-saas
AUTH_ALLOWED_ORIGINS=http://localhost:5173
OPERATOR_EMAIL=
OPERATOR_PASSWORD=
OPERATOR_TENANT_ID=pilot
OPERATOR_PORTAL_BASE_URL=http://localhost:5173
```

`services/user-portal/.env`

```dotenv
VITE_CRM_ADAPTER_BASE_URL=http://localhost:3000
VITE_LEAD_ENGINE_BASE_URL=http://localhost:8000
```

## Fastest Path

1. Copy each `.env.example` to `.env`.
2. Fill in Monday OAuth values in `services/crm-adapter/.env`.
3. Fill in at least one LLM provider key in `services/obituary-intelligence-engine/.env`.
4. Run `bash scripts/check-credentials.sh`.
5. Start services and verify:
   - `http://localhost:3000/ready`
   - `http://localhost:8000/ready`
   - `http://localhost:8080/ready`
   - `http://localhost:5173/login`

## Notes

- `GEMINI_API_KEY` and `GOOGLE_API_KEY` are treated interchangeably by the obituary engine.
- If all LLM keys are missing, the obituary engine still runs with heuristic extraction, but that is not the preferred setup.
- `MONDAY_REDIRECT_URI` must exactly match the callback URL configured in your Monday app.
- For the current live pilot, `MONDAY_REDIRECT_URI` is `http://crm.34.42.223.140.sslip.io/auth/callback` and `OPERATOR_PORTAL_BASE_URL` is `http://portal.35.225.151.173.sslip.io`.
