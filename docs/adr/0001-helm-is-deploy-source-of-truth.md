# ADR 0001: Helm Is The Deployment Source Of Truth

- Status: Accepted
- Date: 2026-03-12

## Context

`lli-saas` currently contains both Helm templates under `infra/charts/lli-saas` and raw Kubernetes manifests under `infra/k8s-reference`. Keeping both equally authoritative creates drift risk, especially when pilot infrastructure changes quickly.

## Decision

- Treat `infra/charts/lli-saas` as the deployable source of truth for the pilot stack.
- Keep `infra/k8s-reference` as reference manifests only.
- Validate Helm in CI for release-facing changes.
- Keep raw manifests readable and correct enough for debugging, but do not rely on them as the primary deployment contract.

## Consequences

- Deployment changes must be made in Helm first.
- `infra/README.md` and documentation standards must point contributors to Helm as the canonical deployment path.
- Raw manifest fixes are still worthwhile when they prevent confusion, but drift should be resolved by reconciling them to the chart, not by treating them as the primary artifact.
