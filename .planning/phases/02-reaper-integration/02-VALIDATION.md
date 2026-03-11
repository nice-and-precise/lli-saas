---
phase: 02
slug: reaper-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest and Vitest |
| **Config file** | `services/lead-engine/pyproject.toml`, `services/crm-adapter/vitest.config.js` |
| **Quick run command** | `cd services/lead-engine && poetry run pytest` or `cd services/crm-adapter && npm test` |
| **Full suite command** | `cd services/lead-engine && poetry run pytest && cd /Users/jordan/Desktop/LLI_v1/services/crm-adapter && npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run the service-local test command for the touched service.
- **After every plan wave:** Run both service test suites.
- **Before `$gsd-verify-work`:** Both suites and touched Docker builds must be green.
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | EXP-02 | unit | `cd services/lead-engine && poetry run pytest` | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | EXP-02 | unit | `cd services/crm-adapter && npm test` | ✅ | ⬜ pending |
| 02-02-01 | 02 | 2 | EXP-02 | unit | `cd services/lead-engine && poetry run pytest` | ✅ | ⬜ pending |
| 02-03-01 | 03 | 2 | EXP-02 | unit | `cd services/crm-adapter && npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Add test coverage for `POST /run-scan` in `services/lead-engine/tests/`
- [ ] Add test coverage for persisted token/board flows in `services/crm-adapter/tests/`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end Monday authorization and board selection against a real Monday workspace | EXP-02 | Requires live OAuth credentials and external account | Complete OAuth, call board discovery route, persist board selection, then create a test lead item |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all missing references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
