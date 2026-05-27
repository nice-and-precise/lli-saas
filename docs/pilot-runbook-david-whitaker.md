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

## Operator quick-start — basically one step

This is the self-serve path on the live pilot. The dashboard shows a **"Next step"** cue at the top
telling you the one thing to do next. Open **https://lli.jordandamhof.com** and:

1. **Connect Monday.** Click **Connect Monday** and authorize the "LLI Lead Engine" app. *(Once.)*
2. **That's it — the system auto-configures itself.** On that first connected load it automatically:
   - **detects the board** in your workspace that holds your landowners (by its columns — county,
     state, acres, parcel/APN, operator, etc.) and uses it as the owner source — **no CSV needed**;
   - **creates a clean "Land Legacy Leads" board** with correctly-typed columns for every lead field;
   - **maps every field** automatically (no manual mapping screen).
   The dashboard then shows **"You're set up — run a scan,"** the auto-detected owner board (with a
   dropdown to override), and the new leads board.
3. **Run a scan.** Press **Run obituary scan** (defaults work). Matched, tiered leads land as items on
   your **Land Legacy Leads** board.

Fallbacks (rare): if no landowner board is auto-detected, the **Import your owners** CSV panel is the
deterministic next step (creates a `Clients` board). If the wrong board is detected, change it in the
**Owner source board** dropdown.

After the first connect, the **daily Vercel Cron** runs a scan automatically (≈12:00 America/Chicago),
so new leads keep arriving without any action.

## Measuring progress & success

The dashboard's **Pipeline metrics** panel tracks two numbers over time so growth is visible:

- **Obituaries scanned per day** (with a per-source breakdown) — coverage. Recorded by the daily
  prefetch collector; the first run backfills the prior week from published dates.
- **Leads delivered per day** — the success metric. Each scan reports the count of newly delivered
  Monday items, so the trend shows the pilot producing value as owner coverage and obituary matches grow.

Both come from `GET /metrics` (served by the obituary engine, proxied through `lead-engine` for the
portal). The numbers are stored in Upstash KV, so they persist across deploys.

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
6. **Auto-onboarding runs once** on this first connected load (the portal calls
   `POST /onboard/auto-provision`): it auto-detects the owner **source** board, creates the
   **"Land Legacy Leads"** destination board with typed columns, and auto-maps every field. Idempotent +
   best-effort (gated by `onboarding.auto_provisioned_at`; a Monday hiccup degrades gracefully and
   `POST /boards/auto-provision-destination` is the explicit retry).
7. Confirm `GET /owners` returns owner records from the auto-detected source board (override via
   `POST /boards/select-source`, or the **Owner source board** dropdown; if none was detected, the
   **Import your owners** CSV panel / `POST /owners/import` creates a `Clients` board).
8. (Auto) The destination board + mapping are already set; adjust only if you want to.
9. Press **Run obituary scan** from the dashboard.
10. Confirm the dashboard updates with delivery history, lead tier, match score, heir count, scan status.
11. Verify the created Monday item includes the expected obituary URL, tier, and heir-related fields.

## Troubleshooting

- If OAuth fails, verify `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, and `MONDAY_REDIRECT_URI`.
- If the portal cannot load boards or status, verify the CRM adapter base URL and `/ready`.
- If the scan cannot launch, verify `lead-engine` can reach `obituary-intelligence-engine`.
- If no heir data appears, verify the obituary text passed the actionability gate and that provider keys are present if LLM extraction is expected.
- If Monday items duplicate, inspect delivery history and confirm obituary URL identity handling.
- On Vercel, state lives in Upstash KV (`STATE_STORE_BACKEND=kv`); if state seems missing, verify the
  KV integration env vars (`KV_REST_API_URL` / `KV_REST_API_TOKEN`) are present on the projects. (The
  PVC/Kubernetes path applies only to the legacy `infra/` self-host option.)
