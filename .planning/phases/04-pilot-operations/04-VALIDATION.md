# Phase 4: Pilot Operations - Validation

**Goal:** Phase 4 is complete when the current `lli-saas` pilot flow is easier to configure, easier to deploy, and easier to troubleshoot without undocumented steps.

## Required Truths

- A pilot operator can follow current docs to configure Monday, connect services, and run the first scan flow.
- Runtime and deployment issues are visible through service behavior, logs/status, or documented troubleshooting paths.
- Infra defaults and environment guidance reflect the real current portal/adapter/lead-engine workflow.
- A repeatable verification flow exists for pilot readiness.

## Expected Verification

- `cd services/crm-adapter && npm test`
- `cd services/user-portal && npm test && npm run build`
- `cd services/lead-engine && python3 -m poetry run pytest`
- `docker build` for any service changed by the phase
- Helm/Kubernetes validation for infra changes
- manual or scripted pilot-readiness checklist aligned to the real current runbook

## Review Standard

- Prefer pilot hardening over new scope.
- Prefer explicit setup and troubleshooting artifacts over implicit tribal knowledge.
- Prefer changes that make current runtime behavior diagnosable in the existing architecture.
