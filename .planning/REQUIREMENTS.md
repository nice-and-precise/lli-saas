# Requirements: lli-saas

**Defined:** 2026-03-11
**Core Value:** Deliver inherited-land leads into a broker's Monday.com workflow with minimal setup friction.

## v1 Requirements

### Platform Foundation

- [ ] **PLAT-01**: Developers can clone one repo and find all Phase 1 services and infrastructure in a predictable layout.
- [ ] **PLAT-02**: Each runnable service has a README, environment example, tests, and Dockerfile.
- [ ] **PLAT-03**: Phase 1 planning artifacts exist under `.planning` and identify executable work for the scaffold.

### Lead Engine

- [ ] **LEAD-01**: Lead engine exposes a `GET /health` endpoint that returns service health.
- [ ] **LEAD-02**: Lead engine can be run locally and in Docker.

### Monday CRM Adapter

- [ ] **CRM-01**: CRM adapter exposes `GET /auth/login` to start Monday OAuth using environment-driven credentials.
- [ ] **CRM-02**: CRM adapter exposes `GET /auth/callback` to exchange an OAuth code for an access token.
- [ ] **CRM-03**: CRM adapter retries Monday GraphQL calls up to 3 times on HTTP 429 responses.
- [ ] **CRM-04**: CRM adapter stores checked-in example GraphQL queries and mutations for board listing and lead creation.

### User Portal

- [ ] **PORT-01**: Portal exposes `/login` and `/dashboard` routes.
- [ ] **PORT-02**: Portal builds successfully for production and can run locally in development.

### Delivery and Operations

- [ ] **OPS-01**: GitHub Actions workflows build, test, tag, and push service images to GHCR.
- [ ] **OPS-02**: Kubernetes Deployment and Service manifests exist for each runnable service.
- [ ] **OPS-03**: Helm chart values drive image repositories, tags, ports, and resources for each service.
- [ ] **OPS-04**: Developer onboarding and pilot runbook docs exist for Phase 1 users.

## v2 Requirements

### Product Expansion

- **EXP-01**: Add persistent tenant-aware data storage for scans, leads, and OAuth credentials.
- **EXP-02**: Add lead ingestion from the Reaper engine beyond the health-check stub.
- **EXP-03**: Add board mapping UI and automated first-scan orchestration.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Reusing legacy repo names or remotes | Explicitly rejected to avoid project identity drift |
| Additional CRM adapters | Monday.com is the only Phase 1 target |
| Full production auth for the portal | Local session stub is sufficient for Phase 1 |
| Billing and subscription flows | Not needed to validate the pilot scaffold |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLAT-01 | Phase 1 | Pending |
| PLAT-02 | Phase 1 | Pending |
| PLAT-03 | Phase 1 | Pending |
| LEAD-01 | Phase 1 | Pending |
| LEAD-02 | Phase 1 | Pending |
| CRM-01 | Phase 1 | Pending |
| CRM-02 | Phase 1 | Pending |
| CRM-03 | Phase 1 | Pending |
| CRM-04 | Phase 1 | Pending |
| PORT-01 | Phase 1 | Pending |
| PORT-02 | Phase 1 | Pending |
| OPS-01 | Phase 1 | Pending |
| OPS-02 | Phase 1 | Pending |
| OPS-03 | Phase 1 | Pending |
| OPS-04 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-03-11*
*Last updated: 2026-03-11 after initial definition*

