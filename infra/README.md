# infra

Infrastructure assets for the current `lli-saas` pilot deployment path.

## Contents

- `k8s/` — per-service Kubernetes manifests
- `charts/lli-saas/` — Helm chart values and templates for the pilot stack

## Pilot Notes

- `lead-engine` and `crm-adapter` expose `/ready` for deployment readiness.
- `lead-engine` requires reachable `CRM_ADAPTER_BASE_URL` and `OBITUARY_ENGINE_BASE_URL` values.
- `crm-adapter` requires Monday OAuth configuration.
- The checked-in values are pilot defaults and placeholders; real deployments should override secret values and upstream URLs through deployment-time configuration.
