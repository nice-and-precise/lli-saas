---
phase: 03
slug: monday-delivery-flow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest and pytest |
| **Config file** | `services/crm-adapter/vitest.config.js`, `services/user-portal/vite.config.js`, `services/lead-engine/pyproject.toml` |
| **Quick run command** | `cd services/crm-adapter && npm test` or `cd services/user-portal && npm test` |
| **Full suite command** | `cd services/crm-adapter && npm test && cd /Users/jordan/Desktop/LLI_v1/services/user-portal && npm test && npm run build` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run the touched service's quick test command.
- **After every plan wave:** Run all touched service tests and relevant builds.
- **Before `$gsd-verify-work`:** Full suite for touched services must be green.
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | EXP-01 | unit | `cd services/crm-adapter && npm test` | ✅ | ⬜ pending |
| 03-01-02 | 01 | 1 | EXP-03 | unit | `cd services/crm-adapter && npm test` | ✅ | ⬜ pending |
| 03-02-01 | 02 | 2 | EXP-01 | unit | `cd services/crm-adapter && npm test` | ✅ | ⬜ pending |
| 03-02-02 | 02 | 2 | EXP-03 | unit | `cd services/crm-adapter && npm test` | ✅ | ⬜ pending |
| 03-03-01 | 03 | 2 | EXP-03 | unit | `cd services/user-portal && npm test && npm run build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Add adapter coverage for mapping persistence and duplicate/delivery status flows
- [ ] Add portal coverage for first-scan orchestration and delivery status rendering

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Monday board mapping and duplicate-safe delivery against a live workspace | EXP-01, EXP-03 | Requires live OAuth credentials and a real Monday account | Connect OAuth, configure mapping, run first scan, verify created/skipped items and visible delivery statuses |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all missing references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
