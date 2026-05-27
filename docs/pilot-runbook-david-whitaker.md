# Pilot Runbook: David Whitaker

## Goal

Connect Monday.com, configure the destination lead board, run an obituary scan, and verify that tiered inherited-land leads appear in David Whitaker's Monday board with the expected obituary and heir metadata.

## Services And URLs

**Live pilot (Vercel)** — the production deployment. Provisioning details are in
[vercel-deployment.md](vercel-deployment.md):

- `user-portal` (operator UI) at `https://lli.jordandamhof.com`
- `crm-adapter` at `https://crm.jordandamhof.com` (Monday OAuth callback `/auth/callback`)
- `lead-engine` at `https://lead.jordandamhof.com`
- `obituary-intelligence-engine` at `https://obit.jordandamhof.com`

**Local development** uses the same flow on localhost:

- `lead-engine` on `http://localhost:8000`
- `obituary-intelligence-engine` on `http://localhost:8080`
- `crm-adapter` on `http://localhost:3000`
- `user-portal` on `http://localhost:5173`

The portal reads board/status data from `crm-adapter` and launches scans through `lead-engine`. Each scan fetches fresh owner records from the Monday `Clients` board.

## Operator quick-start (3 steps — no setup, no URLs to type)

This is the self-serve path on the live pilot. Open **https://lli.jordandamhof.com** and:

1. **Connect Monday.** Click **Connect Monday** (Step 1 on the dashboard) and authorize the
   "LLI Lead Engine" app. You're returned to the dashboard with a "✅ Monday.com connected" banner.
   *(You only do this once.)*
2. **Import your owners.** In **Import your owners**, upload a CSV of your landowners (a header row
   with a `name` column, plus optional `county` and `state`). The portal creates and fills your Monday
   **Clients** board automatically — no manual data entry. (Or pick an existing destination board.)
3. **Run a scan.** Pick a destination board, then press **Run obituary scan** (defaults work; advanced
   options are collapsed). Matched, tiered leads are delivered as items on your Monday board.

After the first connect, the **daily Vercel Cron** runs a scan automatically (≈12:00 America/Chicago),
so new leads keep arriving without any action.

## Required Environment

1. Copy each service `.env.example` to a local `.env`.
2. Set:
   - `services/lead-engine/.env`: `CRM_ADAPTER_BASE_URL`, `OBITUARY_ENGINE_BASE_URL`
   - `services/obituary-intelligence-engine/.env`: state path, retention, timeout, and AI provider keys if available
   - `services/crm-adapter/.env`: `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, `MONDAY_REDIRECT_URI`, `CRM_ADAPTER_STATE_PATH`
   - `services/user-portal/.env`: `VITE_CRM_ADAPTER_BASE_URL`, `VITE_LEAD_ENGINE_BASE_URL`
3. Make sure the Monday OAuth redirect URI matches the actual adapter callback URL.

## Runbook

1. Start all four services (live: already deployed on Vercel).
2. Confirm `/ready` succeeds for `lead-engine`, `obituary-intelligence-engine`, and `crm-adapter`.
3. Open the portal — it lands directly on `/dashboard` (there is no separate login page).
4. Click **Connect Monday** (or hit `crm-adapter` `/auth/login`) to complete Monday OAuth.
5. The callback **redirects back to** `/dashboard?connected=1` (a "Monday connected" banner shows).
6. Confirm `GET /boards` returns the intended destination lead board.
7. Confirm `GET /owners` returns owner records from the Monday `Clients` board (use the **Import your
   owners** CSV panel, or `POST /owners/import`, to create + populate that board if it doesn't exist).
8. Select the destination board.
9. Review and update the board mapping (use **Apply confident fixes** for the suggested mapping).
10. Press **Run obituary scan** from the dashboard.
11. Confirm the dashboard updates with:
    - delivery history
    - lead tier
    - match score
    - heir count
    - scan-run status
12. Verify the created Monday item includes the expected obituary URL, tier, and heir-related fields.

## Troubleshooting

- If OAuth fails, verify `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, and `MONDAY_REDIRECT_URI`.
- If the portal cannot load boards or status, verify the CRM adapter base URL and `/ready`.
- If the scan cannot launch, verify `lead-engine` can reach `obituary-intelligence-engine`.
- If no heir data appears, verify the obituary text passed the actionability gate and that provider keys are present if LLM extraction is expected.
- If Monday items duplicate, inspect delivery history and confirm obituary URL identity handling.
- On Vercel, state lives in Upstash KV (`STATE_STORE_BACKEND=kv`); if state seems missing, verify the
  KV integration env vars (`KV_REST_API_URL` / `KV_REST_API_TOKEN`) are present on the projects. (The
  PVC/Kubernetes path applies only to the legacy `infra/` self-host option.)
