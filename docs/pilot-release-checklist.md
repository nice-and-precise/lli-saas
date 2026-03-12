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
- Docker builds for all four services
- Helm lint and rendered-manifest validation
- CronJob and PVC checks
- Kubernetes dry-run validation when `kubectl` is configured

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
11. If running in Kubernetes, confirm both PVCs are mounted and the daily scan CronJob renders correctly.

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
