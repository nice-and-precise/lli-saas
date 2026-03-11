# Phase 4: Pilot Operations - Research

**Date:** 2026-03-11
**Phase:** 04-pilot-operations

## What Changed Since Phase 3

`lli-saas` now has a real end-to-end pilot flow:

- `lead-engine` can execute `/run-scan`
- `crm-adapter` can persist OAuth, board selection, mapping, delivery status, and first-scan orchestration
- `user-portal` can show status and trigger the first scan

That means Phase 4 should not add major new product scope. It should harden the existing flow so a pilot operator can configure it, run it, and diagnose failures without hidden knowledge.

## Planning-Relevant Gaps

### 1. Onboarding and setup are still fragmented

- The pilot runbook still describes a pre-Phase-3 workflow and does not reflect the portal-driven operator flow.
- Service README and env examples exist, but they are still service-local and do not give one current pilot setup path.
- The current portal assumes a backend URL and the adapter assumes a lead-engine URL, but the operator path is not documented end to end.

### 2. Operational visibility is still thin

- Current operator visibility is mostly a persisted status snapshot, not true operational diagnostics.
- The repo does not yet provide a pilot-focused logging and failure-handling standard across services.
- Infra docs are still skeletal, which makes runtime expectations and deployment troubleshooting hard to follow.

### 3. Deployment safety is still scaffold-grade

- Helm and Kubernetes assets exist, but they still reflect scaffold-era defaults more than the current pilot behavior.
- The CRM adapter now relies on persisted file-backed state, which makes deployment/runtime expectations around storage and restart behavior more important.
- The user portal now depends on backend configuration that should be explicit in deployment values and operator docs.

### 4. Pilot verification is not yet an explicit release routine

- Individual service tests/builds pass, but there is no single pilot-readiness checklist that proves the operator workflow is ready for a real run.
- The repo should have a repeatable validation path that checks core setup, delivery, and deployment expectations together.

## Recommended Planning Direction

Phase 4 should be split into three plans:

1. **Pilot onboarding hardening**
   - Update runbooks, environment examples, and operator docs around the real portal + adapter + lead-engine flow.
   - Add configuration guardrails where they reduce pilot setup errors.

2. **Operational visibility and deployment hardening**
   - Improve service/infra visibility around failures, persistence expectations, and deployment/runtime configuration.
   - Reconcile Helm/Kubernetes/default env settings with the current pilot architecture.

3. **Pilot release gate and rehearsal**
   - Create a repeatable pilot-readiness verification path that exercises the current workflow and documents expected outcomes.

## Constraints to Preserve

- Keep repo identity strictly `lli-saas`.
- Do not introduce a broad new persistence or auth redesign in this phase.
- Keep the portal thin and use existing service boundaries.
- Treat `docs/source/` as reference-only.

## Verification Implications

The final Phase 4 plans should expect verification beyond unit tests alone:

- service tests/builds still passing
- docs/readme/runbook consistency checks
- Helm/Kubernetes/template validation where possible
- one pilot-readiness flow that reflects the actual current operator journey
