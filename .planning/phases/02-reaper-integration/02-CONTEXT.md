# Phase 2: Reaper Integration - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning
**Source:** Resume-work context and explicit user direction

<domain>
## Phase Boundary

Phase 2 should replace the `lead-engine` stub with a real scan execution path tied to the existing Reaper runtime. This phase must define the internal lead payload contract that downstream delivery uses, expose a real `/run-scan` path in `lead-engine`, and extend `crm-adapter` far enough to perform real Monday board discovery and item creation against that contract.

Minimal persistence is required in this phase for Monday OAuth token storage and selected board configuration so the integration can survive process restarts. This is still pilot-grade work, not full tenant architecture or broad SaaS expansion.

</domain>

<decisions>
## Implementation Decisions

### Locked Decisions
- Keep the repository identity strictly `lli-saas`.
- Do not rename code or docs toward `land-legacy-intelligence` or `whitaker-land-intelligence`.
- Treat `docs/source/` markdown as reference material only, not source-of-truth requirements.
- Plan around the fact that `MultimodalText.md` is not present in the workspace.
- Define the internal lead contract before deepening the Monday delivery implementation.
- Add a real `/run-scan` execution path in `services/lead-engine`.
- Wire real Monday board discovery and item creation in `services/crm-adapter`.
- Add minimal persistence for the Monday OAuth token and selected board.

### Claude's Discretion
- Exact schema representation for the internal lead contract.
- Storage mechanism for pilot-grade persistence, as long as it is minimal and durable enough for the stated scope.
- How to split Phase 2 into executable plans and waves.

</decisions>

<specifics>
## Specific Ideas

- The contract should be explicit enough that Phase 3 can focus on delivery behaviors instead of revisiting payload shape.
- Persistence only needs to cover OAuth token state and board selection, not full multi-tenant data modeling.
- Phase 2 should preserve the service boundaries already established in Phase 1.

</specifics>

<deferred>
## Deferred Ideas

- Full tenant-aware persistence for scans, leads, and credentials beyond the minimal pilot state.
- Duplicate handling, operator visibility, and fuller Monday workflow UX reserved for later phases.
- Any repo identity or naming reuse from the older inspiration material.

</deferred>

---

*Phase: 02-reaper-integration*
*Context gathered: 2026-03-11 via resume-work instructions*
