# Phase 3 Research: Monday Delivery Flow

**Date:** 2026-03-11
**Phase:** 03 Monday Delivery Flow
**Requirement IDs:** EXP-01, EXP-03

## Research Goal

Determine how to turn the current `lli-saas` Phase 2 Monday baseline into a real operator-facing delivery workflow with board mapping, duplicate protection, delivery status visibility, and minimal first-scan orchestration.

## Current Baseline

### lead-engine
- `POST /run-scan` exists and returns normalized internal leads.
- The internal lead contract is stable enough for downstream delivery work.
- The service does not currently persist scan history itself.

### crm-adapter
- OAuth token and selected board already persist through the file-backed token store.
- `GET /boards`, `POST /boards/select`, and `POST /leads` exist.
- Lead creation is intentionally minimal:
  - one derived item name
  - no duplicate check
  - no board-column mapping model
  - no delivery history/status records

### user-portal
- The portal is still a static shell.
- No real board mapping, scan orchestration, or delivery status UI exists.

## Tight-Scope Planning Implications

To stay aligned to the current repo state, Phase 3 should extend existing patterns instead of replacing them:
- keep the shared contract from Phase 2
- keep Monday-only delivery
- keep persistence lightweight and explicit
- use the portal as a thin operator surface rather than a full product shell

## Recommended Technical Direction

### 1. Extend persistence into a tenant-aware delivery store

`EXP-01` requires persistent tenant-aware storage for scans, leads, and OAuth credentials. The current file-backed OAuth store is already the closest existing foundation, so the lowest-drift move is to evolve that into a broader state store rather than introduce a brand-new database stack immediately.

Recommended store contents:
- `tenants[]`
  - `tenant_id`
  - `oauth`
  - `selected_board`
  - `board_mapping`
  - `scan_runs[]`
  - `lead_deliveries[]`

Recommended records:
- `scan_runs[]`
  - `scan_id`
  - `started_at`
  - `completed_at`
  - `status`
  - `lead_count`
- `lead_deliveries[]`
  - `delivery_id`
  - `scan_id`
  - `lead_key`
  - `board_id`
  - `monday_item_id`
  - `status`
  - `duplicate_of`
  - `delivered_at`

Why this fits:
- It satisfies the requirement without forcing a new DB layer mid-pilot.
- It lets `crm-adapter` own delivery history and operator status for this phase.
- It keeps a later migration path open because the storage boundary already exists.

### 2. Add explicit board mapping before richer delivery

The current adapter knows which board to use, but not how lead fields map to that board’s columns. Phase 3 should add a compact board mapping model, not a fully generic CRM mapper.

Recommended mapping scope:
- item name strategy
- core summary fields that correspond to Monday columns
- a small number of supported lead fields from the current contract

This should be persisted alongside selected board metadata and exposed via:
- read mapping endpoint
- update mapping endpoint

### 3. Add duplicate-aware delivery around the current `POST /leads`

The current item creation flow should evolve into:
- compute a stable duplicate key from the internal lead contract
- query the selected board for an existing item using that key or equivalent item name strategy
- decide:
  - create new item
  - mark as duplicate and skip
  - optionally update status record only

Phase 3 should stop short of advanced dedupe heuristics. Use a simple, explicit key strategy tied to the current payload fields.

### 4. Record delivery status as first-class operator data

The roadmap explicitly calls for delivery status visibility. That means delivery flow must write persistent status records and expose them through API routes the portal can consume.

Recommended APIs:
- `GET /delivery-status` or `GET /deliveries`
- `GET /scan-runs`
- `POST /run-and-deliver` or a similarly explicit orchestration endpoint

### 5. Keep first-scan orchestration thin and pilot-focused

`EXP-03` calls for automated first-scan orchestration and board mapping UI. Given the current codebase, the simplest path is:
- portal triggers a single pilot flow
- coordinating route calls `lead-engine /run-scan`
- resulting leads are delivered through `crm-adapter`
- status records are persisted and then rendered back in the portal

This does not need a full workflow engine in Phase 3. A synchronous or bounded orchestration path is enough if it is visible and testable.

## Recommended Plan Slicing

### Wave 1

#### Plan 03-01: Tenant-aware delivery state and board mapping foundation
- extend persistence shape for tenants, scans, deliveries, and board mapping
- add board mapping read/write APIs
- keep Monday state and delivery config in one coherent store

### Wave 2

#### Plan 03-02: Duplicate-aware delivery workflow in crm-adapter
- add duplicate key strategy
- add duplicate-aware Monday delivery path
- persist delivery status and scan-linked records

#### Plan 03-03: First-scan orchestration and operator visibility
- add minimal orchestration path between portal and existing backend behavior
- update user-portal from static shell to real status/mapping/first-scan surface
- display delivery and scan status to operators

This split stays close to the existing service boundaries and avoids reopening solved integration layers.

## Risks and Watchouts

- Do not overbuild a generic mapping system in Phase 3. The current pilot only needs a narrow, explicit mapping model.
- Duplicate handling must stay explainable; opaque heuristics will create operator trust issues.
- If portal work starts depending on richer backend data, persistence shape must be settled first.
- Avoid introducing a separate persistence mechanism for each service; Phase 3 should reduce fragmentation, not increase it.

## Validation Architecture

Phase 3 should continue using the current repo’s existing test stack:
- `services/crm-adapter`: `npm test`
- `services/user-portal`: `npm test` and `npm run build`
- `services/lead-engine`: `python3 -m poetry run pytest` only where orchestration changes touch scan invocation contracts

Additional validation needed:
- adapter tests for mapping persistence, duplicate detection, and delivery status records
- portal tests for operator flows and status rendering
- Docker builds for touched services

Recommended feedback loops:
- after every adapter task: `cd services/crm-adapter && npm test`
- after every portal task: `cd services/user-portal && npm test`
- after each wave: run all touched service tests and builds

## Planning Recommendation

Proceed with three plans across two waves:
- `03-01` tenant-aware delivery state and board mapping foundation
- `03-02` duplicate-aware Monday delivery workflow
- `03-03` first-scan orchestration and operator visibility

That sequence is the tightest fit to the current `lli-saas` repo because it extends existing codepaths instead of replacing them.
