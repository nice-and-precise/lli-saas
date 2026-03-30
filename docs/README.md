# Documentation Index

Use this file as the navigation entrypoint for the repo documentation.

## Start Here

- [System Architecture](../docs/system-architecture.md)
  - source of truth for boundaries, contracts, and runtime flow
- [Developer Onboarding](../docs/developer-onboarding.md)
  - local setup, env vars, service startup, and verification
- [Documentation Standards](../docs/documentation-standards.md)
  - source-of-truth rules, update matrix, and diagram maintenance rules
- [Data Intake API](../docs/data-intake-api.md)
  - self-service integration contract, auth flow, required fields, OpenAPI assets, and submission examples

## Operator / Pilot Docs

- [Pilot Release Checklist](../docs/pilot-release-checklist.md)
  - pre-pilot gate, rehearsal steps, and stop conditions
- [Pilot Runbook: David Whitaker](../docs/pilot-runbook-david-whitaker.md)
  - Monday connection, board setup, mapping, scan, and validation flow

## Service Docs

- [lead-engine](../services/lead-engine/README.md)
- [obituary-intelligence-engine](../services/obituary-intelligence-engine/README.md)
- [crm-adapter](../services/crm-adapter/README.md)
- [user-portal](../services/user-portal/README.md)
- [infra](../infra/README.md)

## API Assets

- [LLI Data Intake API guide](../docs/data-intake-api.md)
- [OpenAPI spec](../services/crm-adapter/openapi.json)
- [Interactive developer portal](../services/crm-adapter/developer-portal.html)

## Archive

- [Legacy Archive](../docs/archive/legacy/README.md)

## Reading Order

1. Read the architecture doc.
2. Read the documentation standards doc before changing product or runtime docs.
3. Follow onboarding to get the stack running locally.
4. Use the service READMEs for service-specific commands and env.
5. Use the pilot checklist and runbook before touching a live pilot workflow.
