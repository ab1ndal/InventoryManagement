---
phase: 6
slug: exchange-and-returns-bill-lookup-partial-item-credit-store-c
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (React CRA — no test suite in project) |
| **Config file** | none |
| **Quick run command** | `npm run build 2>&1 | tail -5` |
| **Full suite command** | `npm run build` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build 2>&1 | tail -5`
- **After every plan wave:** Run `npm run build`
- **Before `/gsd-verify-work`:** Full build must pass (0 errors)
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | schema | — | migration file present | file-check | `test -f schema/migration_14_manual_items_stock.sql` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | D-01 | — | ExchangePage renders without crash | build | `npm run build 2>&1 \| grep -c error` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | D-02 | — | only finalized bills returned | build | `npm run build` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 2 | D-07 | — | exchanges table insert correct | build | `npm run build` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 3 | D-11 | — | ReturnReceiptView accepts mode prop | build | `npm run build` | ❌ W0 | ⬜ pending |
| 06-04-01 | 04 | 4 | D-16 | — | exchangeCredit state in BillingForm | build | `npm run build` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- No test framework to install — project uses no automated tests
- Build check substitutes: `npm run build` must pass after each plan wave

*Existing infrastructure: CRA build is the gating check for all tasks.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Bill search returns only finalized bills | D-02 | UI interaction required | Search a bill with paymentstatus = 'draft' — should not appear |
| Partial qty return UI shows correct max | D-04 | UI interaction + DB state | Load a bill with 3 qty item, ensure input max = 3 |
| Store credit added to customer account | D-09 | DB state change | Check customers.store_credit after confirming exchange |
| Exchange receipt PDF opens in new tab | D-13 | Browser behavior | Confirm exchange, verify PDF tab opens |
| BillingForm pre-fills exchange credit | D-14 | UI state | After exchange, verify "Return Credit — Bill #X" appears as deduction |
| Exchange credit floor at 0 | D-15 | Edge case | Create exchange credit > cart total, verify no cashback |

*All phase behaviors require manual verification — no automated test suite in project.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: build check after every wave
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
