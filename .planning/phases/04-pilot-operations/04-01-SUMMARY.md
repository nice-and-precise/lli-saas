---
phase: 04-pilot-operations
plan: 01
type: execute
service: docs
completed: 2026-03-11
verified_at: 2026-03-12T00:00:00Z
requirements:
  - EXP-01
  - EXP-03
---

# Phase 4 Plan 01 Summary

Plan `04-01` is complete across docs and service configuration guidance. The pilot runbook, service READMEs, and env examples now reflect the real Phase 3 operator flow instead of the older scaffold-era instructions.

## What Changed

- Rewrote the David Whitaker pilot runbook around the current portal-first flow using `crm-adapter` for status and first-scan orchestration.
- Added explicit environment guidance for `REAPER_BASE_URL`, `LEAD_ENGINE_BASE_URL`, and `VITE_CRM_ADAPTER_BASE_URL`.
- Updated service README files so the current startup order, service responsibilities, and local pilot setup path are consistent.
- Corrected the user portal env example to match the actual frontend configuration key used by the dashboard.

## Task Commits

1. **Task 1: Refresh the pilot runbook around the real operator flow** - `89f0fcc` (docs)
2. **Task 2: Tighten environment and configuration guidance** - `89f0fcc` (docs)

## Verification

- Pilot runbook now reflects the current Phase 3 operator flow.
- Service env examples and README guidance are aligned to the actual runtime configuration.
- No docs reintroduced legacy repo naming or reference-driven scope drift.

## Files Changed

- `docs/pilot-runbook-david-whitaker.md`
- `services/lead-engine/README.md`
- `services/crm-adapter/README.md`
- `services/user-portal/README.md`
- `services/lead-engine/.env.example`
- `services/crm-adapter/.env.example`
- `services/user-portal/.env.example`
