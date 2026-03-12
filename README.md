# lli-saas

`lli-saas` is an obituary intelligence and CRM lead delivery monorepo for land brokers. Customer CRM data is the owner-data source of truth. The platform fetches owner records from CRM at scan time, passes canonical owner records into the obituary intelligence layer, generates canonical leads, and delivers those leads back into CRM.

The architectural source of truth for this repo is [docs/system-architecture.md](/Users/jordan/Desktop/LLI_v1/docs/system-architecture.md).

## Layout

- `services/lead-engine` — FastAPI orchestration entrypoint that runs `run_scan()` and coordinates owner fetch, obituary intelligence, and lead delivery
- `services/crm-adapter` — Express Monday OAuth, source-owner fetch, destination-board mapping, and lead delivery adapter
- `services/user-portal` — Vite React operator portal for Monday setup, status, and scan launch
- `infra` — Kubernetes manifests and Helm chart for the pilot stack
- `docs` — architecture, onboarding, and pilot runbooks
- `.planning` — GSD-compatible planning state

## Local startup

1. Install Python 3.11+, Node 20+, Docker, and kubectl.
2. Follow [docs/developer-onboarding.md](/Users/jordan/Desktop/LLI_v1/docs/developer-onboarding.md).
3. Start each service from its own directory.

## Pilot Gate

- Run `bash scripts/pilot-readiness-check.sh` before a live pilot rehearsal or release.
- Follow [docs/pilot-release-checklist.md](/Users/jordan/Desktop/LLI_v1/docs/pilot-release-checklist.md) for the final manual operator check.

## Planning

Phase planning artifacts live in `.planning/`.
