# Pilot Release Checklist

## Goal

Run one repeatable gate before any live pilot session so service verification, packaging, deployment validation, and operator rehearsal stay aligned with the current stack.

## Automated Gate

For a local developer sanity check, run:

```bash
bash scripts/pilot-readiness-check.sh
```

For an actual release candidate, copy `infra/charts/lli-saas/values.pilot.example.yaml` to `infra/charts/lli-saas/values.pilot.yaml`, replace the placeholder digests and URLs, then run:

```bash
PILOT_VALUES_FILE=infra/charts/lli-saas/values.pilot.yaml \
PILOT_RELEASE_MODE=1 \
bash scripts/capture-pilot-evidence.sh
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

## Current Verified Pilot Snapshot

- verification date: March 12, 2026 (Audit Redeploy)
- portal: `http://portal.35.225.151.173.sslip.io`
- `crm-adapter`: `http://crm.34.42.223.140.sslip.io`
- `lead-engine`: `http://lead.34.57.110.0.sslip.io:8000`
- Monday callback: `http://crm.34.42.223.140.sslip.io/auth/callback`

## Deployment Pitfalls & Common Fixes

### 1. Service Visibility (LoadBalancer)
By default, the Helm chart defaults services to `ClusterIP`. For pilot access, ensure `values.pilot.yaml` explicitly sets `type: LoadBalancer` and provides the static `loadBalancerIP` for `user-portal`, `crm-adapter`, and `lead-engine`.

### 2. Slow Backend Startup (Probes)
The `lead-engine` may take longer than 5 seconds to pass its initial `/ready` check during startup. If pods enter `CrashLoopBackOff`, verify that `livenessProbe` and `readinessProbe` have sufficient `initialDelaySeconds` (e.g., 10-15s) and `timeoutSeconds` (e.g., 5s).

### 3. CRLF Line Endings (.env)
When deploying from Windows or using WSL, ensure `infra/.env` uses **LF** line endings. CRLF line endings will cause environment variables to contain a trailing `\r`, which can break URL resolution (e.g., `http://portal.35.225.151.173.sslip.io\r`) and CORS validation.

### 4. User Portal Build Context
The `user-portal` Docker image requires `nginx.conf` and `docker-entrypoint.sh`. Always build from the `services/user-portal/` directory to ensure these files are correctly included in the image.

## Pilot Rehearsal

After the automated gate passes:

1. Start `lead-engine`, `obituary-intelligence-engine`, `crm-adapter`, and `user-portal`, or confirm the current live pilot endpoints above are reachable.
2. Confirm `/ready` succeeds for all three backend services.
3. Run `python3 scripts/validate-obituary-sources.py --include-supplemental --json-output /tmp/obituary-sources.json`.
4. Confirm authenticated `GET /sources/health?include_supplemental=true` from `obituary-intelligence-engine` returns source reports, a `proof_target_count` of `6`, and at least `7` healthy sources for pilot.
5. Open the portal dashboard and confirm status loads.
6. Complete Monday OAuth if the session needs a fresh connection.
7. Confirm the destination board is correct.
8. Confirm the mapping is correct for the selected board.
9. Confirm owner fetch succeeds from the Monday `Clients` board.
10. Run the obituary scan from the dashboard.
11. Verify the dashboard shows delivery history, lead tier, match score, and scan-run status.
12. Verify the created Monday item contains the expected mapped obituary and heir values.
13. If running in Kubernetes, confirm both PVCs are mounted and the daily scan CronJob renders correctly.

## Stop Conditions

Do not proceed with a live pilot if any of these occur:

- `scripts/pilot-readiness-check.sh` fails
- `/ready` fails for `lead-engine`, `obituary-intelligence-engine`, or `crm-adapter`
- obituary source validation does not meet the expected pilot threshold of at least `7` healthy sources with supplemental sources enabled
- the portal cannot load board or status data
- Monday OAuth, source-owner access, destination-board selection, or mapping are not confirmed
- obituary scan delivery produces unexpected failures or duplicates
- the live pilot is using a callback URL other than `http://crm.34.42.223.140.sslip.io/auth/callback`

## Evidence To Save

- terminal output from the readiness script
- the directory produced by `scripts/capture-pilot-evidence.sh`
- source validation JSON or terminal summary
- any failed `/ready`, `/status`, `/boards`, `/owners`, or `/mapping` payloads
- the Monday board item URL or screenshot for the first successful delivery
- the scan id and delivery id for the rehearsal run
