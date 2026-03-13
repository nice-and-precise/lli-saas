# Documentation Standards

Use these rules to keep repo documentation coherent as the product changes.

## Source Of Truth

- [docs/system-architecture.md](/Users/jordan/Desktop/LLI_v1/docs/system-architecture.md) is the architecture source of truth.
- [README.md](/Users/jordan/Desktop/LLI_v1/README.md) is the repo overview and first-entry document.
- [docs/engineering-standards.md](/Users/jordan/Desktop/LLI_v1/docs/engineering-standards.md) is the source of truth for repo conventions, CI rules, and baseline engineering standards.
- service `README.md` files describe service-specific runtime behavior, commands, and environment.
- [shared/contracts](/Users/jordan/Desktop/LLI_v1/shared/contracts) is the contract source of truth for canonical payload shapes.
- [docs/adr](/Users/jordan/Desktop/LLI_v1/docs/adr/README.md) holds durable engineering decisions.

## Update Rules

- If service boundaries or runtime flow change, update:
  - [docs/system-architecture.md](/Users/jordan/Desktop/LLI_v1/docs/system-architecture.md)
  - [README.md](/Users/jordan/Desktop/LLI_v1/README.md)
- If a canonical payload changes, update:
  - [shared/contracts](/Users/jordan/Desktop/LLI_v1/shared/contracts)
  - every service README that documents the affected fields or routes
- If deployment topology changes, update:
  - [infra/README.md](/Users/jordan/Desktop/LLI_v1/infra/README.md)
  - Helm examples and values that operators actually use
- If repo conventions, CI requirements, or task-runner commands change, update:
  - [docs/engineering-standards.md](/Users/jordan/Desktop/LLI_v1/docs/engineering-standards.md)
  - [README.md](/Users/jordan/Desktop/LLI_v1/README.md) or [docs/developer-onboarding.md](/Users/jordan/Desktop/LLI_v1/docs/developer-onboarding.md) if local workflow changed
- If a durable architecture or process decision changes, update:
  - the relevant ADR under [docs/adr](/Users/jordan/Desktop/LLI_v1/docs/adr/README.md)
- If pilot workflow changes, update:
  - [docs/pilot-release-checklist.md](/Users/jordan/Desktop/LLI_v1/docs/pilot-release-checklist.md)
  - [docs/pilot-runbook-david-whitaker.md](/Users/jordan/Desktop/LLI_v1/docs/pilot-runbook-david-whitaker.md)

## Diagram Rules

- Keep the repo-level Mermaid diagrams in:
  - [README.md](/Users/jordan/Desktop/LLI_v1/README.md)
  - [docs/system-architecture.md](/Users/jordan/Desktop/LLI_v1/docs/system-architecture.md)
- Prefer a small number of maintained diagrams over many drifting diagrams.
- Use exact deployed service names: `lead-engine`, `obituary-intelligence-engine`, `crm-adapter`, `user-portal`.

## Archiving Rules

- Superseded planning or legacy product docs belong under [docs/archive/legacy](/Users/jordan/Desktop/LLI_v1/docs/archive/legacy).
- Do not leave stale design docs in active navigation.
- Archived docs are reference-only and must not conflict with active architecture docs.
- `README.md` is the only active root-level markdown file unless another root file is explicitly linked from [docs/README.md](/Users/jordan/Desktop/LLI_v1/docs/README.md).

## Change Checklist

Before merging architecture or workflow changes:

1. Update the relevant source-of-truth doc first.
2. Update the root README summary and diagrams if the top-level story changed.
3. Update the affected service README files.
4. Move obsolete active docs to the legacy archive instead of leaving conflicting copies.
5. Run [scripts/pilot-readiness-check.sh](/Users/jordan/Desktop/LLI_v1/scripts/pilot-readiness-check.sh) when the change affects runtime wiring, contracts, or pilot operations.
