# lli-saas

`lli-saas` is a fresh-start monorepo for the Phase 1 LLI SaaS pilot. It contains a lead engine API, a Monday.com CRM adapter, a React user portal, and deployment infrastructure.

## Layout

- `services/lead-engine` — FastAPI health service scaffold for the Reaper wrapper
- `services/crm-adapter` — Express Monday OAuth and GraphQL adapter scaffold
- `services/user-portal` — Vite React login and dashboard shell
- `infra` — Kubernetes manifests and Helm chart skeleton
- `docs` — onboarding, pilot runbook, and planning source documents
- `.planning` — GSD-compatible project planning state

## Local startup

1. Install Python 3.11+, Node 20+, Docker, and kubectl.
2. Follow [docs/developer-onboarding.md](/Users/jordan/Desktop/LLI_v1/docs/developer-onboarding.md).
3. Start each service from its own directory.

## Planning

Phase planning artifacts live in `.planning/` and the current Phase 1 task list is in [PLANS.md](/Users/jordan/Desktop/LLI_v1/PLANS.md).

