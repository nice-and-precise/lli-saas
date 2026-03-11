---
phase: 02-reaper-integration
plan: 02
subsystem: lead-engine
tags: [reaper, fastapi, contract, docker]
requires:
  - phase: 02-reaper-integration
    provides: shared internal lead contract artifact from 02-01
provides:
  - Real POST /run-scan path in lead-engine
  - Dedicated Reaper integration boundary and scan orchestration service
  - Normalized internal lead contract responses with structured runtime failures
affects: [phase-2-wave-2, scan-contract, lead-engine]
tech-stack:
  added: [httpx]
  patterns: [thin-route service orchestration, adapter boundary, normalized contract response]
key-files:
  created:
    - services/lead-engine/src/reaper.py
    - services/lead-engine/src/scan_service.py
  modified:
    - services/lead-engine/src/app.py
    - services/lead-engine/src/contracts.py
    - services/lead-engine/tests/test_app.py
    - services/lead-engine/pyproject.toml
    - services/lead-engine/Dockerfile
    - services/lead-engine/README.md
completed: 2026-03-11
---

# Phase 2 Plan 02: Real scan execution in lead-engine Summary

## Outcome

`lead-engine` now exposes a real `POST /run-scan` path that accepts a validated scan request, invokes a dedicated Reaper gateway boundary, normalizes upstream output into the internal lead contract from 02-01, and returns structured failures when scan execution cannot complete.

## What Changed

- Added request and response models in `src/contracts.py` for scan input, structured scan errors, and the run-scan response envelope.
- Added `src/reaper.py` as the dedicated integration boundary with:
  - a typed raw Reaper response model
  - a protocol for testable gateway injection
  - an HTTP-backed gateway driven by `REAPER_BASE_URL`
  - structured gateway error mapping
- Added `src/scan_service.py` to keep route logic thin and centralize:
  - scan ID generation
  - gateway invocation
  - raw-to-internal normalization
  - translation of runtime failures into API-safe error envelopes
- Updated `src/app.py` to expose `POST /run-scan` while keeping FastAPI route logic minimal.
- Expanded `tests/test_app.py` to cover:
  - successful normalized scan output
  - FastAPI validation failure for malformed input
  - structured 502 runtime failure behavior
- Updated dependency and runtime wiring so the service can normalize Reaper results through a dedicated HTTP-backed gateway without thick route logic.

## Task Commits

1. **Task 1: Add Reaper integration boundary and request models** - `16c3d65` (feat)
2. **Task 2: Ship POST /run-scan with normalized output** - `16c3d65` (feat)

## Verification

- `cd services/lead-engine && python3 -m poetry run pytest`
  - Result: passed
  - Detail: `6 passed`
- `cd services/lead-engine && docker build -t lli-saas/lead-engine:phase2 .`
  - Result: passed

## Issues Encountered

None

## Next Phase Readiness

- `02-03` can consume a stable scan response shape from `lead-engine`.
- Downstream delivery work can rely on normalized internal leads instead of raw Reaper payloads.
