# Phase 3: Monday Delivery Flow - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning
**Source:** Current `lli-saas` repo state after Phase 2 completion

<domain>
## Phase Boundary

Phase 3 should turn the current Monday integration baseline into a real delivery workflow without reopening Phase 2 foundation work. `lead-engine` already exposes `POST /run-scan` and returns normalized internal lead payloads. `crm-adapter` already supports OAuth callback, board discovery, board selection persistence, and simple item creation from one internal lead. `user-portal` is still a static shell and does not yet drive any real configuration or orchestration.

This phase should add:
- board mapping and persisted delivery configuration aligned to the current Monday adapter
- duplicate-aware lead delivery flow on top of the existing item creation path
- persistent operator-visible delivery status for scans and pushed leads
- a minimal first-scan orchestration path and portal/operator surface tied to the real backend behavior

This phase should not replace the existing shared contract, rework the Reaper boundary, or drift into broader platform concerns like billing, auth hardening, or additional CRM vendors.

</domain>

<decisions>
## Implementation Decisions

### Locked Decisions
- Keep repo identity strictly `lli-saas`.
- Do not drift toward older names like `land-legacy-intelligence` or `whitaker-land-intelligence`.
- Treat `docs/source/` markdown as reference material only.
- `MultimodalText.md` is still not present in the workspace.
- Build on the existing shared internal lead contract from Phase 2 rather than redefining payload shape.
- Build on the existing `crm-adapter` file-backed persistence unless there is a clear reason to widen storage scope.
- Keep Monday.com as the only CRM target.
- Keep the scope aligned to the current service boundaries:
  - `lead-engine` owns scan execution
  - `crm-adapter` owns Monday delivery behavior
  - `user-portal` owns operator-facing flow/status for the pilot

### Claude's Discretion
- Exact persistence shape for tenant-aware scan/lead/delivery records, as long as it is compatible with the current repo state.
- How to split the delivery workflow across executable plans and waves.
- Whether first-scan orchestration is initiated from the portal directly or via a thin coordinating backend route.

</decisions>

<specifics>
## Specific Ideas

- Board mapping should likely start with a minimal mapping model around the current lead summary fields instead of a full generic field-mapping builder.
- Duplicate protection should key off stable data already available in the internal lead contract and current Monday adapter flow.
- Delivery status should be visible to operators, which likely means at least one real backend status API plus a portal update away from static shell content.
- Tenant-aware persistence can stay pilot-grade if it is explicit and durable; it does not need to become a full production data platform in this phase.

</specifics>

<deferred>
## Deferred Ideas

- Additional CRM adapters
- Full multi-tenant auth and billing
- Broad operational hardening reserved for Phase 4
- Deep product analytics and non-pilot onboarding polish beyond what Phase 3 needs

</deferred>

---

*Phase: 03-monday-delivery-flow*
*Context gathered: 2026-03-11 from current repo state*
