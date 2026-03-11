---
phase: 02-reaper-integration
plan: 01
subsystem: api
tags: [contract, schema, fastapi, express, persistence, monday]
requires:
  - phase: 01-foundation-scaffold
    provides: baseline lead-engine and crm-adapter scaffolds
provides:
  - Shared internal lead schema artifact for lli-saas services
  - Lead-engine contract-aware models and schema visibility
  - CRM adapter file-backed persistence for Monday OAuth and board state
affects: [phase-2-wave-2, monday-delivery, scan-contract]
tech-stack:
  added: [JSON Schema]
  patterns: [shared contract artifact with service-local validation, file-backed integration state]
key-files:
  created:
    - shared/contracts/internal-lead.schema.json
    - services/lead-engine/src/contracts.py
    - services/crm-adapter/src/internalLead.js
    - services/crm-adapter/tests/internalLead.test.js
    - services/crm-adapter/tests/tokenStore.test.js
  modified:
    - services/lead-engine/src/app.py
    - services/lead-engine/tests/test_app.py
    - services/crm-adapter/src/app.js
    - services/crm-adapter/src/tokenStore.js
    - services/crm-adapter/tests/auth.test.js
key-decisions:
  - "Use a repo-level JSON schema artifact and keep validation adapters local to each runtime."
  - "Persist Monday OAuth and board state in a file-backed store before introducing a heavier database."
patterns-established:
  - "Cross-service payload contracts live in shared/contracts with service-specific helpers."
  - "Pilot-grade persistence should sit behind an interface so later phases can swap storage without route rewrites."
requirements-completed:
  - EXP-02
duration: unknown
completed: 2026-03-11
---

# Phase 2 Plan 01: Define the internal lead contract and minimal persistence primitives Summary

**Shared internal lead schema plus durable Monday integration state now give lli-saas a cross-service contract foundation for Phase 2**

## Performance

- **Duration:** unknown
- **Started:** 2026-03-11T23:12:28Z
- **Completed:** 2026-03-11T23:12:28Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Added a shared `internal-lead.schema.json` artifact and matching lead-engine contract models.
- Added CRM adapter contract helpers so the adapter can validate against the same payload shape as lead-engine.
- Replaced the purely in-memory Monday state path with a file-backed store that persists OAuth and board data.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define the internal lead contract** - `6b791e0` (feat)
2. **Task 2: Add minimal durable Monday integration state** - `6b791e0` (feat)

**Plan metadata:** `pending` (docs: complete plan)

## Files Created/Modified
- `shared/contracts/internal-lead.schema.json` - Canonical internal lead contract artifact for the repo.
- `services/lead-engine/src/contracts.py` - Lead-engine models and schema loader.
- `services/lead-engine/src/app.py` - Contract visibility endpoint alongside health.
- `services/lead-engine/tests/test_app.py` - Contract-aware tests for the lead service.
- `services/crm-adapter/src/internalLead.js` - Adapter-side validation and schema path helper.
- `services/crm-adapter/src/tokenStore.js` - File-backed persistence for Monday integration state.
- `services/crm-adapter/src/app.js` - Contract visibility plus persisted OAuth state handling.
- `services/crm-adapter/tests/auth.test.js` - Coverage for contract visibility and persisted callback state.
- `services/crm-adapter/tests/internalLead.test.js` - Contract helper validation coverage.
- `services/crm-adapter/tests/tokenStore.test.js` - File store persistence coverage.

## Decisions Made
- Shared JSON schema was chosen over a cross-runtime shared library to avoid binding Python and Node to one implementation package this early.
- File-backed persistence is enough for pilot durability and keeps the storage boundary swappable for later phases.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `poetry` was not available directly on `PATH` in the shell, so verification used `python3 -m poetry run pytest`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `02-02` can build `/run-scan` against an agreed internal lead contract.
- `02-03` can wire Monday board discovery and item creation against persisted integration state.

---
*Phase: 02-reaper-integration*
*Completed: 2026-03-11*
