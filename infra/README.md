# infra

Infrastructure assets for the current `lli-saas` pilot deployment path.

## Contents

- `k8s/` — per-service Kubernetes manifests
- `charts/lli-saas/` — Helm values and templates for the pilot stack

## Stack Covered Here

- `lead-engine`
- `obituary-intelligence-engine`
- `crm-adapter`
- `user-portal`
- daily lead-scan CronJob

## Pilot Notes

- `lead-engine`, `obituary-intelligence-engine`, and `crm-adapter` expose `/ready`.
- `lead-engine` requires reachable `CRM_ADAPTER_BASE_URL` and `OBITUARY_ENGINE_BASE_URL`.
- `crm-adapter` requires Monday OAuth configuration and writable mounted storage for file-backed pilot state.
- `obituary-intelligence-engine` requires writable mounted storage for feed checkpoints and processed-obituary fingerprints.
- `user-portal` expects runtime backend URLs through container env, written to `/runtime-config.js` at startup.
- the checked-in values remain pilot defaults and placeholders; real deployments must override secrets and public URLs at deploy time.
