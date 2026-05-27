# Vercel Deployment (pilot)

This is the live-deployment path for the Whitaker pilot: the whole stack runs on
Vercel — a static portal plus three backend services as Vercel functions, with
state in Upstash Redis (Vercel KV), Anthropic via Vercel AI Gateway, and the
daily scan on Vercel Cron. No separate server is required.

> The Kubernetes/Helm manifests under [`infra/`](../infra/) are the **legacy /
> alternative self-host path** and are superseded by this document for the pilot.

## Obituary collection (sources + anti-bot)

The obituary engine collects from a curated list of Iowa obituary RSS feeds in
`services/obituary-intelligence-engine/src/feed_sources.py`. Two notes:

- **TLS impersonation**: several sources (the Lee Enterprises metro dailies —
  Waterloo Courier, Quad-City Times, Sioux City Journal, Globe Gazette, Muscatine
  Journal) return **429** to a default HTTP client; their anti-bot checks the TLS/JA3
  fingerprint, not just the user-agent. The collector therefore fetches with
  **`curl_cffi` Chrome impersonation** (`collector.py`). Scrapling wraps the same
  engine but bundles ~270MB of Playwright/patchright, which exceeds Vercel's 250MB
  function limit, so we depend on `curl_cffi` directly.
- **Budget caps** (env-tunable): `OBITUARY_MAX_ENTRIES_PER_SOURCE` (6),
  `OBITUARY_MAX_TOTAL_OBITUARIES` (36), `OBITUARY_INTER_SOURCE_DELAY_SECONDS` (0.15)
  keep a scan well under the 60s Hobby cap (~17s observed) while spreading coverage.
- **Feed list is an operational item** — feeds rot (404/format changes); re-probe
  periodically with curl_cffi Chrome impersonation. The collector is resilient: any
  source that fails (404/429/timeout/parse) is skipped, never crashing the scan.
- **Statewide aggregation (Legacy.com)** is browser-only anti-bot and out of reach
  for the serverless function. The future path is a free GitHub-Actions cron running
  a browser fetcher (Scrapling `StealthyFetcher`) that writes obituaries to KV for the
  engine to read — deliberately **not** built for the pilot.

## Projects (one monorepo → four Vercel projects)

| Vercel project | Root directory | Type | Domain |
|---|---|---|---|
| `lli-portal` | `services/user-portal` | Vite static | `lli.jordandamhof.com` (+ apex `jordandamhof.com`) |
| `lli-crm-adapter` | `services/crm-adapter` | Node (Express) | `crm.jordandamhof.com` |
| `lli-lead-engine` | `services/lead-engine` | Python (FastAPI) | `lead.jordandamhof.com` |
| `lli-obituary-engine` | `services/obituary-intelligence-engine` | Python (FastAPI) | `obit.jordandamhof.com` |

Each project sets **Root Directory** to its service folder. Python services
deploy from `requirements.txt` + the `[tool.vercel] entrypoint` in
`pyproject.toml`; the portal is auto-detected as Vite.

## Prerequisites (one-time)

1. **Plan tier**: Hobby caps function `maxDuration` at **60s** (what `vercel.json` currently sets) and
   is **non-commercial only**. For real daily scans + client use, upgrade to **Pro** and raise
   `maxDuration` to `800` in the two Python `vercel.json` files. On Hobby, constrain scans (short
   lookback / small `owner_limit`) so they finish within 60s.
2. **Vercel KV (Upstash Redis)**: create one KV store via the Vercel dashboard
   marketplace and connect it to `lli-crm-adapter` and `lli-obituary-engine`.
   This injects `KV_REST_API_URL` / `KV_REST_API_TOKEN` into both.
3. **AI Gateway key**: Vercel dashboard → AI Gateway → create a key.
4. **Monday OAuth app**: at `developer.monday.com`, create an app with OAuth,
   redirect URI `https://crm.jordandamhof.com/auth/callback`, scopes
   `boards:read`, `boards:write`, `me:read`. Capture Client ID + Secret.
5. **Shared secret**: generate one random value, e.g. `openssl rand -hex 32`.

## Environment variables per project

`lli-crm-adapter`
```
STATE_STORE_BACKEND=kv
MONDAY_CLIENT_ID=...
MONDAY_CLIENT_SECRET=...
MONDAY_REDIRECT_URI=https://crm.jordandamhof.com/auth/callback
MONDAY_API_BASE_URL=https://api.monday.com/v2
SERVICE_SHARED_SECRET=<random>
# KV_REST_API_URL / KV_REST_API_TOKEN injected by the KV integration
```

`lli-lead-engine`
```
CRM_ADAPTER_BASE_URL=https://crm.jordandamhof.com
OBITUARY_ENGINE_BASE_URL=https://obit.jordandamhof.com
SERVICE_SHARED_SECRET=<same random>
CRON_SECRET=<same random>   # lets the daily Vercel Cron authenticate to /run-scan
```

`lli-obituary-engine`
```
STATE_STORE_BACKEND=kv
HEIR_EXTRACTION_PRIMARY_PROVIDER=anthropic
HEIR_EXTRACTION_PRIMARY_MODEL=anthropic/claude-sonnet-4.5
ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh
ANTHROPIC_API_KEY=<AI Gateway key>
OBITUARY_ENGINE_RETENTION_DAYS=30
# KV_REST_API_URL / KV_REST_API_TOKEN injected by the KV integration
```

`lli-portal` (build-time)
```
VITE_CRM_ADAPTER_BASE_URL=https://crm.jordandamhof.com
VITE_LEAD_ENGINE_BASE_URL=https://lead.jordandamhof.com
```

## Access control

- **Portal → backend** calls cannot carry a server secret (a static SPA exposes
  anything baked into it). Gate operator access with **Vercel Deployment
  Protection → Password** on `lli-crm-adapter` and `lli-lead-engine`. Use
  **Protection Bypass for Automation / public path** so Monday can still reach
  `/auth/callback` (which must stay public).
- **Server → server** calls (`lead-engine → crm-adapter` `/owners` + `/leads`,
  and `Cron → lead-engine /run-scan`) are authenticated by `SERVICE_SHARED_SECRET`
  / `CRON_SECRET`. The guards are no-ops when those vars are unset (local dev).

## Gotcha: crm-adapter framework preset must be "Other" (null)

If Vercel sets the `lli-crm-adapter` project's **Framework Preset** to **Express**, it builds a second
rogue root function (`index`) from `src/app.js` alongside `api/index`, and the bare `/` route returns
`FUNCTION_INVOCATION_FAILED` ("Invalid export found in module src/app.js"). Real routes still work, so
it's easy to miss. Fix: set the project framework to **Other / none** (API: `PATCH /v9/projects/
lli-crm-adapter {"framework": null}`) and redeploy. The app is served solely by `api/index.js` + the
catch-all rewrite. `src/server.js` is `.vercelignore`d for the same reason (its `listen()` triggers
server auto-detection).

## DNS (Porkbun)

Add CNAMEs for `lli`, `crm`, `lead`, `obit` (and apex/`www` for the portal)
pointing at the target Vercel returns when each custom domain is added — read it
from the Vercel domains API rather than hardcoding an IP.

## Daily scan

`services/lead-engine/vercel.json` declares a Vercel Cron hitting `/run-scan` at
`0 17 * * *` (UTC). That is ~12:00 America/Chicago and drifts ±1h across DST —
acceptable for the pilot.

## Verify

- Each domain serves over HTTPS; backends' `/ready` return ready.
- End-to-end: portal → Monday OAuth → board select → mapping → run scan → a real
  item lands on the Monday destination board (see
  [pilot-runbook-david-whitaker.md](pilot-runbook-david-whitaker.md)).
- Anthropic traffic appears in the Vercel AI Gateway overview.
