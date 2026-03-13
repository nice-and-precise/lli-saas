# infra

Infrastructure assets for the current `lli-saas` pilot deployment path.

The deployment source of truth is the Helm chart under `charts/lli-saas`. Raw manifests under `k8s/` are reference assets and must not drift materially from the chart.

## Contents

- `charts/lli-saas/` — Helm values and templates for the pilot stack
- `charts/lli-saas/values.pilot.example.yaml` — release-candidate override template using immutable image refs
- `k8s/` — reference per-service Kubernetes manifests for debugging and inspection

## Stack Covered Here

- `lead-engine`
- `obituary-intelligence-engine`
- `crm-adapter`
- `user-portal`
- daily lead-scan CronJob

## Pilot Notes

- `lead-engine`, `obituary-intelligence-engine`, and `crm-adapter` expose `/ready`.
- `lead-engine` requires reachable `CRM_ADAPTER_BASE_URL` and `OBITUARY_ENGINE_BASE_URL`.
- `crm-adapter` requires Monday OAuth configuration, operator session credentials, a shared JWT secret, and writable mounted storage for file-backed pilot state.
- `obituary-intelligence-engine` requires writable mounted storage for feed checkpoints and processed-obituary fingerprints plus at least one obituary extraction provider key.
- `user-portal` expects runtime backend URLs through container env, written to `/runtime-config.js` at startup.
- Browser-facing services use `AUTH_ALLOWED_ORIGINS` instead of wildcard CORS.
- The daily lead-scan CronJob must send a pre-signed service JWT through `Authorization: Bearer ...` with `sub`, `role=service`, `tenant_id`, `aud`, `iss`, and `exp`.
- Real deployments must inject secrets through Kubernetes Secrets, not inline values.
- Real pilot deployments should start from `values.pilot.example.yaml`, replace the image refs with immutable digests, and deploy with `bash scripts/deploy-pilot.sh`.
- Rollbacks should use `bash scripts/rollback-pilot.sh` so the Helm revision history remains the source of truth.
