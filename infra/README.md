# infra

Infrastructure assets for the current `lli-saas` pilot deployment path.

## Contents

- `k8s/` — per-service Kubernetes manifests
- `charts/lli-saas/` — Helm chart values and templates for the pilot stack

## Pilot Notes

- `lead-engine` and `crm-adapter` now expose `/ready` for deployment readiness, so probe paths should track readiness instead of basic health.
- `crm-adapter` requires Monday OAuth configuration plus a reachable `LEAD_ENGINE_BASE_URL`.
- `lead-engine` requires a reachable `REAPER_BASE_URL`.
- The checked-in values are pilot defaults and placeholders; real deployments should override secret values and upstream URLs through deployment-time configuration.
