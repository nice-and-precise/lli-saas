# Phase 4: Pilot Operations - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning
**Source:** Phase 4 roadmap scope plus completed Phase 3 implementation state

<domain>
## Phase Boundary

Phase 4 should harden the existing `lli-saas` pilot workflow instead of expanding the product surface. The repo already supports Monday OAuth, board selection and mapping, duplicate-aware delivery, first-scan orchestration, and a portal operator cockpit. This phase should focus on making that flow supportable for a real pilot: clearer onboarding, better operational visibility, and safer deployment/runtime behavior.

The target outcome is not a new CRM, auth system, or billing layer. The target outcome is that an operator can set up the current pilot user, run the system with fewer undocumented steps, and diagnose failures from existing deployment artifacts and service boundaries.
</domain>

<decisions>
## Implementation Decisions

### Locked Decisions

- Keep the project identity strictly `lli-saas`; do not revive older repo names or inspiration-project naming.
- Stay aligned to the current service boundaries: `lead-engine`, `crm-adapter`, `user-portal`, and existing `infra` assets.
- Treat `docs/source/` as reference-only and do not let it redefine scope or naming.
- Build on the current pilot flow rather than introducing broader SaaS platform work.
- Keep the portal thin; operational coordination should continue to live primarily in backend service boundaries.
- Prefer operational hardening of the existing file-backed/pilot-grade architecture over introducing a larger persistence or auth redesign in this phase.

### Claude's Discretion

- How to split onboarding, observability, and deployment hardening into executable plans.
- Which runtime visibility improvements belong in services versus docs versus infra.
- How much pilot safety to add through tests, health/readiness, config validation, or operator UX without turning Phase 4 into a platform rewrite.
</decisions>

<specifics>
## Specific Ideas

- Tighten the setup path for the current Monday-connected pilot so a target broker can be onboarded without tribal knowledge.
- Surface runtime failures and delivery issues through clearer status, logging, and deployment-facing artifacts.
- Reconcile the current README/runbook/infra docs with the now-real Phase 3 operator flow.
- Prioritize verifiable pilot readiness over speculative future architecture.
</specifics>

<deferred>
## Deferred Ideas

- Additional CRM adapters beyond Monday.com.
- Broad multi-tenant SaaS persistence beyond the current pilot-grade state model.
- Production-grade auth and billing flows.
- Large architectural changes that are not required to run the immediate pilot.
</deferred>

---

*Phase: 04-pilot-operations*
*Context gathered: 2026-03-11 via Phase 4 planning*
