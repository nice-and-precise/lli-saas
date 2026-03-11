# lli-saas

## What This Is

`lli-saas` is a fresh-start monorepo for a farmland lead intelligence SaaS pilot. It packages a Reaper-backed lead engine, a Monday.com delivery adapter, and a broker-facing portal into a deployable foundation that can be extended without carrying forward old repo identity or drift.

## Core Value

Deliver inherited-land leads into a broker's Monday.com workflow with minimal setup friction.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Phase 1 scaffold supports local development for all core services.
- [ ] Monday.com OAuth can be initiated and completed from the CRM adapter.
- [ ] The portal exposes a login and dashboard shell for the pilot.
- [ ] CI/CD and Kubernetes artifacts exist for the initial deployment path.

### Out of Scope

- Legacy repo names or remotes — excluded to prevent naming drift.
- Production billing, Stripe, and multi-tenant persistence — deferred until post-pilot validation.
- Additional CRMs beyond Monday.com — deferred until the Monday pilot works.

## Context

The workspace started from planning documents only. The old `whitaker-land-intelligence` repository and `land-legacy-intelligence` naming were explicitly rejected for this project. The pilot centers on Monday.com connectivity and a fast path to a working demo around the existing Reaper engine.

## Constraints

- **Repo identity**: Use `lli-saas` only — avoid reuse of prior project names.
- **Delivery speed**: Prefer a monorepo for Phase 1 — reduces setup friction and cross-repo overhead.
- **Integration**: Monday.com OAuth and GraphQL must be represented in code now — core pilot dependency.
- **Verification**: Every scaffolded service must have at least a baseline test and build path.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Monorepo structure | Faster Phase 1 shipping and simpler CI/bootstrap | ✓ Good |
| GHCR as registry target | Fits the GitHub org and Actions auth model | ✓ Good |
| Vite React for portal | Fast scaffold with low build overhead | ✓ Good |

---
*Last updated: 2026-03-11 after initial Phase 1 bootstrap*

