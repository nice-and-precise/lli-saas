# Pilot Release Checklist

## Goal

Run one repeatable gate before any live pilot session so service verification, packaging, deployment validation, and operator rehearsal stay aligned with the current stack.

## Automated Gate

Run:

```bash
bash scripts/pilot-readiness-check.sh
```

The gate should cover:

- `lead-engine` tests
- `obituary-intelligence-engine` tests
- `crm-adapter` tests
- `user-portal` tests and production build

**For the live pilot (Vercel — the canonical path, see [vercel-deployment.md](vercel-deployment.md)):**
verify the four Vercel projects deploy, `/ready` is green on the backend domains, the Upstash KV
integration env vars are present, the heir-extraction LLM key is set (`GEMINI_API_KEY`), and the daily Cron is scheduled.
Then run **`bash scripts/live-smoke.sh --write`** against prod — it asserts health + the readiness chain,
the auto-onboarding state (source/destination/marker), no duplicate boards, the metrics surface, the new
endpoints, idempotent re-provision, and a healthy scan. A green run is the fastest "is prod actually working" check.

**Legacy self-host path only (`infra/`):** Docker builds for all four services, Helm lint and
rendered-manifest validation, CronJob/PVC checks, and `kubectl` dry-runs. These are **optional** and
not required for the Vercel pilot.

## Pilot Rehearsal

After the automated gate passes:

1. Start `lead-engine`, `obituary-intelligence-engine`, `crm-adapter`, and `user-portal`.
2. Confirm `/ready` succeeds for all three backend services.
3. Open the portal dashboard and confirm status loads.
4. Complete Monday OAuth if the session needs a fresh connection.
5. Confirm the destination board is correct.
6. Confirm the mapping is correct for the selected board.
7. Confirm owner fetch succeeds from the Monday `Clients` board.
8. Run the obituary scan from the dashboard.
9. Verify the dashboard shows delivery history, lead tier, match score, and scan-run status.
10. Verify the created Monday item contains the expected mapped obituary and heir values.
11. Confirm the GitHub Actions obituary-prefetch run is green and the daily Vercel Cron is scheduled.
    (Legacy self-host only: confirm both PVCs are mounted and the CronJob renders.)

## Stop Conditions

Do not proceed with a live pilot if any of these occur:

- `scripts/pilot-readiness-check.sh` fails
- `/ready` fails for `lead-engine`, `obituary-intelligence-engine`, or `crm-adapter`
- the portal cannot load board or status data
- Monday OAuth, source-owner access, destination-board selection, or mapping are not confirmed
- obituary scan delivery produces unexpected failures or duplicates

## Evidence To Save

- terminal output from the readiness script
- any failed `/ready`, `/status`, `/boards`, `/owners`, or `/mapping` payloads
- the Monday board item URL or screenshot for the first successful delivery
- the scan id and delivery id for the rehearsal run
