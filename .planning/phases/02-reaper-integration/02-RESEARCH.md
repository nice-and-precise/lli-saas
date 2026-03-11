# Phase 2 Research: Reaper Integration

**Date:** 2026-03-11
**Phase:** 02 Reaper Integration
**Requirement IDs:** EXP-02

## Research Goal

Determine how to turn the Phase 1 service stubs into a real scan execution path for `lli-saas` without expanding prematurely into later-phase delivery and multi-tenant persistence work.

## Current Baseline

### lead-engine
- `services/lead-engine/src/app.py` exposes only `GET /health`.
- The service already has Poetry, pytest, and a working Docker build.
- There is no scan orchestration, contract definition, or persistence.

### crm-adapter
- `services/crm-adapter/src/app.js` exposes `GET /health`, `GET /auth/login`, and `GET /auth/callback`.
- `src/mondayClient.js` already has a reusable GraphQL execution path with 429 retry behavior.
- `src/queries.js` contains example board-listing and item-creation operations, but they are not wired into app routes or persistence.
- `src/tokenStore.js` is in-memory only.

### user-portal
- The Phase 1 portal is a shell and should not be the main focus of Phase 2.
- It may need small follow-up adjustments later, but the blocking Phase 2 work is backend integration.

## Planning Constraints

- Keep repo identity strictly `lli-saas`.
- Do not adopt old repo or product names from historical references.
- Treat `docs/source/` as reference material only.
- `MultimodalText.md` does not exist and cannot be assumed as an implementation dependency.
- Keep persistence minimal and pilot-grade.

## Recommended Implementation Direction

### 1. Define a language-neutral internal lead contract first

The next phases depend on a stable output from `lead-engine`, so Phase 2 should produce one canonical contract before deepening Monday delivery logic.

Recommended shape:
- Store the contract in a repo-level shared artifact such as `contracts/internal-lead.schema.json` or `shared/contracts/internal-lead.schema.json`.
- Mirror that schema in:
  - `lead-engine` Pydantic models for input/output validation
  - `crm-adapter` runtime validation or explicit mapping logic before Monday mutations

Recommended contract fields:
- `scan_id`
- `source`
- `run_started_at`
- `run_completed_at`
- `owner_name`
- `deceased_name`
- `property`
  - `address_line_1`
  - `city`
  - `state`
  - `postal_code`
  - `county`
- `contacts`
  - list of `{ name, relationship, phone, email, mailing_address }`
- `notes`
- `tags`
- `raw_artifacts`
  - references only, not full binary payloads

Why this matters:
- Phase 2 succeeds only if downstream delivery can trust scan results.
- A documented contract prevents Phase 3 from re-litigating payload semantics while wiring duplicate handling and status visibility.

### 2. Keep scan execution inside lead-engine and return normalized output

`lead-engine` should own:
- scan request validation
- invocation of the Reaper runtime or adapter wrapper
- normalization from raw Reaper output into the internal lead contract
- status/error reporting for the caller

Recommended API additions:
- `POST /run-scan`
- Optional `GET /scan-contract` or embed contract details in docs/tests only if a dedicated endpoint is unnecessary

Recommended `POST /run-scan` behavior:
- Accept a bounded request payload such as county, state, and optional run options.
- Generate a `scan_id`.
- Invoke a Reaper integration boundary, ideally a dedicated module rather than route-inline logic.
- Normalize the result to the internal lead contract.
- Return a response with:
  - `scan_id`
  - `status`
  - `lead_count`
  - `leads`
  - `errors`

### 3. Put minimal persistence in crm-adapter, not a full shared database layer

Phase 2 only needs durable storage for:
- Monday OAuth token
- selected board id and board metadata

Recommended approach:
- Replace the in-memory token store with a file-backed store using a small JSON document on disk.
- Keep the store behind an interface so Phase 4 or later can swap to SQLite/Postgres without rewriting route handlers.

Why file-backed JSON is the pragmatic choice here:
- It meets the “minimal persistence” requirement.
- It avoids adding a database stack before the pilot proves the workflow.
- It survives restarts unlike the current `Map`.

Recommended stored shape:
- `oauth.access_token`
- `oauth.account_id`
- `board.id`
- `board.name`
- `board.columns`
- `updated_at`

### 4. Wire Monday board discovery and item creation as real app capabilities

The current Monday client already provides the hard part: authenticated GraphQL execution with retry handling. Phase 2 should elevate that into real routes or service methods.

Recommended additions in `crm-adapter`:
- `GET /boards`
  - loads persisted token
  - calls Monday boards query
  - returns discovered boards
- `POST /boards/select`
  - persists board selection
- `POST /leads`
  - validates incoming internal lead payload
  - loads persisted token and selected board
  - creates one Monday item from a normalized lead

Keep item creation simple in Phase 2:
- create the item name from a stable lead field such as deceased name or property address
- defer advanced column mapping and duplicate handling to Phase 3

### 5. Maintain a strict boundary between Phase 2 and Phase 3

Phase 2 should stop at:
- real scan invocation
- canonical lead payload
- Monday board discovery
- persisted board selection
- single-item creation from one lead

Phase 2 should not take on:
- duplicate detection
- operator dashboards
- tenant-aware data models
- richer portal configuration UX

## Recommended Plan Slicing

### Wave 1

#### Plan 02-01: Contract and persistence foundation
- Define the internal lead contract in a repo-level shared artifact.
- Add lead-engine models or serialization helpers around that contract.
- Replace crm-adapter in-memory token storage with a file-backed persistence module for OAuth token and board selection.

Why Wave 1:
- Both scan execution and Monday delivery depend on these contracts and storage primitives.

### Wave 2

#### Plan 02-02: Real scan execution in lead-engine
- Add Reaper integration boundary code.
- Implement `POST /run-scan`.
- Normalize Reaper output into the internal lead contract.
- Add backend tests around success and failure flows.

#### Plan 02-03: Real Monday board discovery and item creation
- Add real board discovery route/service.
- Persist selected board.
- Add lead creation route/service using the internal lead contract.
- Add tests for persisted OAuth state, board selection, and lead delivery.

Why these can be parallel-ish after Wave 1:
- Both consume the agreed contract and persistence abstraction.
- They touch different service directories.

## Risks and Watchouts

- The biggest risk is letting raw Reaper output leak directly into later phases. Normalize once in `lead-engine`.
- File-backed persistence is appropriate now but must stay behind an interface to avoid migration pain later.
- Monday item creation should not hard-code too much column logic in Phase 2 or it will preempt Phase 3.
- Avoid adding shared runtime packages unless they materially reduce drift; a schema file plus service-local adapters may be enough.

## Validation Architecture

Phase 2 can stay inside the repo's existing test stack:
- `services/lead-engine`: `poetry run pytest`
- `services/crm-adapter`: `npm test`

Additions to require in planning:
- lead-engine tests for `/run-scan` happy path, validation failure, and Reaper adapter failure
- crm-adapter tests for persisted OAuth state, board discovery, board selection, and item creation
- Docker builds for both touched services after implementation

Recommended verification cadence:
- Quick feedback after each lead-engine task: targeted `poetry run pytest`
- Quick feedback after each crm-adapter task: targeted `npm test`
- Full phase verification before UAT:
  - `docker build` for `services/lead-engine`
  - `docker build` for `services/crm-adapter`

## Planning Recommendation

Proceed with three plans across two waves:
- `02-01` contract and persistence foundation
- `02-02` real scan execution in `lead-engine`
- `02-03` real Monday board discovery and item creation in `crm-adapter`

This keeps Phase 2 tightly aligned to `EXP-02` while preparing a clean handoff into the later Monday delivery phase.
