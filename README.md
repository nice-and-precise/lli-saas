# lli-saas

`lli-saas` is a fresh-start monorepo for the inherited-land lead delivery pilot. It contains a lead engine API, a Monday.com CRM adapter, a React operator portal, and deployment infrastructure.

## Layout

- `services/lead-engine` — FastAPI scan execution boundary for the Reaper wrapper
- `services/crm-adapter` — Express Monday OAuth, delivery, and first-scan orchestration adapter
- `services/user-portal` — Vite React operator portal for mapping, status, and first scan
- `infra` — Kubernetes manifests and Helm chart for the pilot stack
- `docs` — onboarding, pilot runbook, and planning source documents
- `.planning` — GSD-compatible project planning state

## Local startup

1. Install Python 3.11+, Node 20+, Docker, and kubectl.
2. Follow [docs/developer-onboarding.md](/Users/jordan/Desktop/LLI_v1/docs/developer-onboarding.md).
3. Start each service from its own directory.

## Pilot Gate

- Run `bash scripts/pilot-readiness-check.sh` before a live pilot rehearsal or release.
- Follow [docs/pilot-release-checklist.md](/Users/jordan/Desktop/LLI_v1/docs/pilot-release-checklist.md) for the final manual operator check.

## Planning

Phase planning artifacts live in `.planning/` and the current Phase 1 task list is in [PLANS.md](/Users/jordan/Desktop/LLI_v1/PLANS.md).
