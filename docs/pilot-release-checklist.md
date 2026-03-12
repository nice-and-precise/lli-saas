# Pilot Release Checklist

## Goal

Run one repeatable gate before a live `lli-saas` pilot session so service verification, container packaging, and deployment validation are not spread across memory or old notes.

## Automated Gate

Run:

```bash
bash scripts/pilot-readiness-check.sh
```

This gate covers:

- `lead-engine` tests
- `crm-adapter` tests
- `user-portal` tests and production build
- Docker builds for all three services
- Helm lint and template validation
- Kubernetes dry-run validation when `kubectl` is available

The same flow is available in GitHub Actions through `pilot-release-gate`.

## Pilot Rehearsal

After the automated gate passes:

1. Start `lead-engine`, `crm-adapter`, and `user-portal` with the current `.env` values.
2. Confirm `lead-engine` and `crm-adapter` return `ready` from `/ready`.
3. Open the portal dashboard and confirm status loads.
4. Complete Monday OAuth if the current pilot session needs a fresh connection.
5. Confirm the selected board and mapping are correct.
6. Run the first scan from the dashboard.
7. Verify the dashboard shows recent delivery history and scan run status.
8. Verify the created item appears in the expected Monday board with the expected mapped values.

## Stop Conditions

Do not proceed with a live pilot if any of the following occur:

- `scripts/pilot-readiness-check.sh` fails
- `/ready` fails for `lead-engine` or `crm-adapter`
- the portal cannot load status from `crm-adapter`
- Monday OAuth, board selection, or mapping are not confirmed
- first-scan delivery produces unexpected failed outcomes

## Evidence to Save

- terminal output from the readiness script
- any failed `/ready` or `/status` payloads
- the Monday board item URL or screenshot for the first successful delivery
