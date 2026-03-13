# Engineering Standards

This document defines the default engineering standards for `lli-saas`. Use it with [docs/documentation-standards.md](/Users/jordan/Desktop/LLI_v1/docs/documentation-standards.md) and [docs/system-architecture.md](/Users/jordan/Desktop/LLI_v1/docs/system-architecture.md).

## Documentation Model

- `README.md` is the only active root-level product overview.
- `docs/system-architecture.md` is the architecture source of truth.
- service `README.md` files are the source of truth for service runtime behavior, routes, commands, and environment.
- `docs/pilot-*` files are the operator and release runbooks for pilot work.
- `docs/adr/` holds durable engineering decisions that should not be buried in PRs or planning notes.
- root-level planning or legacy markdown files are not active docs unless linked from `README.md` or `docs/README.md`.

## Repo Conventions

- Prefer one repo-level command surface through [Makefile](/Users/jordan/Desktop/LLI_v1/Makefile) for bootstrap, lint, typecheck, format checks, contract checks, tests, and the pilot gate.
- Pin default local runtimes with `.nvmrc` and `.python-version`.
- Treat generated artifacts, local caches, screenshots, logs, and tool output as ignored files unless they are deliberate release artifacts.
- Use `shared/contracts` as the canonical payload boundary between services. Contract-only changes must trigger validation and downstream tests.

## Python Standards

- Runtime services target Python 3.11.
- Use Poetry for dependency management in Python services.
- Use `pytest` for tests.
- Default static-quality toolchain going forward: `ruff` for linting and `mypy` for type checking.
- Repo commands:
  - `make lint` runs `ruff check src tests` in both Python services.
  - `make typecheck` runs `mypy src` in both Python services.
- New Python service changes should prefer typed boundaries, structured errors, and explicit timeout/retry behavior for outbound calls.

## JavaScript And React Standards

- Runtime services target Node 20.
- Use `npm ci` in automation and `npm ci` or `npm install` only when intentionally updating lockfiles locally.
- Use `vitest` for JS and React tests.
- Default static-quality toolchain going forward: `eslint` for linting and `prettier` for formatting.
- Repo commands:
  - `make lint` runs `npm run lint` in both JS services.
  - `make format-check` runs `npm run format:check` in both JS services.
- Keep React UI logic in components and isolate environment/runtime configuration behind small helper modules.

## Contract Change Policy

- `shared/contracts/*.json` is the canonical schema source of truth.
- When a contract changes, update:
  - the schema artifact
  - every service boundary that produces or consumes that contract
  - relevant tests
  - relevant service docs
- PRs that change contracts must pass contract validation and downstream service tests.

## CI And Release Minimum Bar

- Every deployable service must have a dedicated CI workflow.
- PRs should require, at minimum:
  - service-specific CI for changed services
  - `contracts-ci` for `shared/contracts` changes
  - `pilot-release-gate` for runtime, infra, and release-surface changes
  - dependency review
  - code scanning
- Service CI must fail on `ruff`/`mypy` violations for Python services and `eslint`/`prettier --check` violations for JS services.
- `contracts-ci` and `pilot-release-gate` must run the same repo-level lint, typecheck, format-check, and test commands contributors use locally.
- CI jobs must install every dependency needed for the commands they run. No hidden reliance on runner-global packages.
- Release candidates must preserve pilot gate evidence and the live rehearsal evidence required by the pilot checklist.

## Infra And Deployment Standards

- Helm under `infra/charts/lli-saas` is the deployment source of truth for the pilot stack.
- Raw manifests under `infra/k8s-reference` are non-authoritative reference snapshots and must not be applied directly.
- Secrets must be injected through deployment-time secret management, not committed literal values.
- Health probes should separate process liveness from dependency readiness.

## Observability Minimum Bar

- Logs should be structured and machine-readable where practical.
- Every externally meaningful operation should include `scan_id` and `tenant_id` in logs and error surfaces when available.
- Readiness endpoints should verify configuration and critical dependencies; liveness should not depend on upstream availability.
- Pilot-only shortcuts must be documented explicitly in docs or ADRs instead of being left implicit in code.
