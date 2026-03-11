---
phase: 02-reaper-integration
plan: 03
type: execute
service: crm-adapter
completed: 2026-03-11
verified_at: 2026-03-11T23:18:29Z
requirements:
  - EXP-02
---

# Phase 2 Plan 03 Summary

Plan `02-03` is complete within the `crm-adapter` scope. The adapter now uses persisted Monday OAuth state to discover boards, persists a selected board with metadata, validates the shared internal lead contract at the adapter boundary, and creates a Monday item on the selected board.

## What Changed

- Added `GET /boards` to discover Monday boards using the persisted OAuth token and return the currently selected board from durable state.
- Added `POST /boards/select` to validate a requested board against live board discovery and persist `id`, `name`, and `columns` for later delivery.
- Added `POST /leads` to validate the Phase 2 internal lead contract, map it into a Monday item payload, and create one item on the persisted board.
- Switched the default app store to `FileTokenStore` so OAuth and board configuration survive process restarts in normal adapter usage.
- Extended `MondayClient` with focused `listBoards()` and `createItem()` helpers on top of the existing GraphQL execution path, including GraphQL error surfacing.
- Hardened token store state merging so absent board state stays `null` instead of drifting to `{}` during partial writes.
- Updated the contract path resolution to work cleanly against the repo-level contract artifact established in `02-01`.

## Task Commits

1. **Task 1: Add board discovery and selection flow** - `5505321` (feat)
2. **Task 2: Add lead item creation path** - `5505321` (feat)

## Adapter Boundary Decisions

- Contract validation remains explicit in `src/internalLead.js` so malformed payloads fail before any Monday API mutation is attempted.
- Monday item creation is intentionally minimal for Phase 2: the adapter derives an item name from `deceased_name` and `property.address_line_1`, then returns a normalized lead summary in the response. Richer column mapping and duplicate handling remain deferred to later plans.
- Board selection persistence is based on live board discovery rather than trusting client-provided metadata, which keeps stored board data aligned with Monday’s current response.

## Verification

Executed in `services/crm-adapter`:

- `npm test`
  - Result: passed
  - Coverage relevant to this plan: board discovery, board selection persistence, lead item creation, malformed lead rejection, Monday client list/create helpers, existing OAuth flows
- `docker build -t lli-saas/crm-adapter:phase2 .`
  - Result: passed

## Files Changed

- `services/crm-adapter/src/app.js`
- `services/crm-adapter/src/mondayClient.js`
- `services/crm-adapter/src/queries.js`
- `services/crm-adapter/src/tokenStore.js`
- `services/crm-adapter/src/internalLead.js`
- `services/crm-adapter/tests/auth.test.js`
- `services/crm-adapter/tests/mondayClient.test.js`
- `services/crm-adapter/README.md`
- `services/crm-adapter/Dockerfile`

## Notes

One verification issue surfaced during implementation: partial state writes were serializing an unselected board as `{}` instead of `null`. This was corrected in the token store merge logic before the final verification run.
