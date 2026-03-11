# Phase 1: Foundation Scaffold - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the fresh-start `lli-saas` repository structure, planning state, runnable service stubs, deployable container and Kubernetes assets, and the docs required for local setup and the initial Monday.com pilot.

</domain>

<decisions>
## Implementation Decisions

### Repo identity
- Use `lli-saas` only.
- Existing source markdown files are references, not naming authority.
- No reuse of old remote names or adjacent legacy naming.

### Topology
- Use a monorepo with `services/lead-engine`, `services/crm-adapter`, `services/user-portal`, and `infra`.
- Keep service boundaries clean so they can be split later if needed.

### Tooling
- Use GSD-compatible `.planning` files for project state and phase planning.
- Use FastAPI for the lead-engine stub, Express for the CRM adapter, and Vite React for the portal.
- Use GHCR as the image registry target.

### Monday scope
- Implement OAuth start and callback routes with env-driven credentials.
- Implement retry-on-429 behavior for Monday GraphQL requests.
- Keep token persistence as an in-memory or placeholder store for Phase 1.

### Claude's Discretion
- File organization inside each service as long as the interfaces remain stable.
- Docker base image minor versions and test runner choices within the selected stack.

</decisions>

<specifics>
## Specific Ideas

- The portal should show a clear login path and a simple dashboard with Monday connection status, first-scan CTA, and recent lead placeholders.
- The pilot docs should specifically describe how David Whitaker connects Monday and verifies the first lead on his board.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docs/source/*.md`: Source material for project architecture, roadmap, and pilot expectations.

### Established Patterns
- No existing application code; Phase 1 is a greenfield scaffold.

### Integration Points
- Future Reaper integration will enter through `services/lead-engine`.
- Monday integration enters through `services/crm-adapter`.

</code_context>

<deferred>
## Deferred Ideas

- Real scan execution and persistent lead storage.
- Full tenant-aware auth and billing.
- Additional CRM adapters.

</deferred>

---

*Phase: 01-foundation-scaffold*
*Context gathered: 2026-03-11*

