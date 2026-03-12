# Roadmap: lli-saas

## Overview

The roadmap starts with a monorepo foundation that gets the lead engine, Monday adapter, portal, and deployment path into a verifiable pilot-ready state. Later phases can add real lead ingestion, persistent storage, and broader SaaS capabilities once the Monday pilot is working.

## Phases

- [x] **Phase 1: Foundation Scaffold** - Create the monorepo, service stubs, CI/CD, and pilot docs.
- [x] **Phase 2: Reaper Integration** - Replace lead-engine stubs with real scan orchestration and data flow.
- [x] **Phase 3: Monday Delivery Flow** - Add board mapping, duplicate handling, and lead push workflows.
- [ ] **Phase 4: Pilot Operations** - Harden onboarding, logging, and pilot execution for real customer use.

## Phase Details

### Phase 1: Foundation Scaffold
**Goal**: Stand up a fresh `lli-saas` monorepo with GSD planning state, runnable service stubs, deployable infrastructure definitions, and pilot documentation.
**Depends on**: Nothing (first phase)
**Requirements**: PLAT-01, PLAT-02, PLAT-03, LEAD-01, LEAD-02, CRM-01, CRM-02, CRM-03, CRM-04, PORT-01, PORT-02, OPS-01, OPS-02, OPS-03, OPS-04
**Success Criteria** (what must be TRUE):
  1. Developers can open one repo and find all Phase 1 services, docs, and infra assets.
  2. Lead engine, CRM adapter, and user portal each build and pass baseline tests.
  3. CI/CD, Kubernetes, Helm, onboarding, and pilot runbook artifacts exist for the scaffold.
**Plans**: 3 plans

Plans:
- [x] 01-01: Bootstrap git, GSD planning state, and root documentation.
- [x] 01-02: Scaffold the lead engine, CRM adapter, and user portal services.
- [x] 01-03: Add infra manifests, GitHub Actions workflows, and operator docs.

### Phase 2: Reaper Integration
**Goal**: Connect the lead engine scaffold to the real Reaper runtime and expose scan execution paths.
**Depends on**: Phase 1
**Requirements**: EXP-02
**Success Criteria** (what must be TRUE):
  1. A scan endpoint can invoke the Reaper integration path.
  2. Scan results have a defined internal contract for downstream delivery.
**Plans**: 3 plans

Plans:
- [x] 02-01: Define the internal lead contract and minimal durable Monday state.
- [x] 02-02: Implement the real `/run-scan` path in lead-engine.
- [x] 02-03: Wire Monday board discovery, board selection, and lead item creation in crm-adapter.

### Phase 3: Monday Delivery Flow
**Goal**: Turn the CRM adapter into a working lead delivery pipeline with board mapping and duplicate handling.
**Depends on**: Phase 2
**Requirements**: EXP-01, EXP-03
**Success Criteria** (what must be TRUE):
  1. A connected Monday account can receive a lead from a configured board mapping.
  2. Duplicate protection and delivery status are visible to operators.
**Plans**: 3 plans

Plans:
- [x] 03-01: Establish tenant-aware delivery state and board mapping foundations.
- [x] 03-02: Implement duplicate-aware Monday delivery and persisted delivery status.
- [x] 03-03: Add first-scan orchestration and operator visibility to the portal.

### Phase 4: Pilot Operations
**Goal**: Prepare the platform for a live pilot with operational visibility and cleaner end-user flows.
**Depends on**: Phase 3
**Requirements**: EXP-01, EXP-03
**Success Criteria** (what must be TRUE):
  1. Pilot operators can onboard the target user without undocumented steps.
  2. Runtime issues are visible in logs, docs, and deployment artifacts.
**Plans**: 3 plans

Plans:
- [x] 04-01: Harden pilot onboarding, runbook flow, and configuration guidance.
- [x] 04-02: Improve runtime visibility and reconcile infra defaults with the live pilot flow.
- [x] 04-03: Add a repeatable pilot release gate and final rehearsal checklist.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation Scaffold | 3/3 | Complete | 2026-03-11 |
| 2. Reaper Integration | 3/3 | Complete | 2026-03-11 |
| 3. Monday Delivery Flow | 3/3 | Complete | 2026-03-11 |
| 4. Pilot Operations | 3/3 | Complete | 2026-03-11 |
