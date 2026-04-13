---
phase: 5
slug: support-different-discount-types-in-billing-percentage-disco
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None detected — no test files found in repo |
| **Config file** | none |
| **Quick run command** | Manual QA in browser |
| **Full suite command** | Manual QA in browser |
| **Estimated runtime** | ~5 minutes (manual) |

---

## Sampling Rate

- **After every task commit:** Manual smoke test of changed component
- **After every plan wave:** Full manual QA per test map below
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** N/A (manual)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 5-??-01 | auto-apply fix | 1 | D-02/D-03 | T-5-01 | Only eligible discounts pre-selected | manual | N/A | N/A | ⬜ pending |
| 5-??-02 | once-per-customer | 1 | D-05 | T-5-02 | Used codes hidden for repeat customer | manual | N/A | N/A | ⬜ pending |
| 5-??-03 | DiscountForm label fix | 1 | D-07/D-08 | — | Correct label on conditional type | manual | N/A | N/A | ⬜ pending |
| 5-??-04 | FREE label in invoice | 1 | D-09/D-10 | — | FREE label appears on free items | manual | N/A | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

No automated test infrastructure exists in this project. All validation is manual QA. This is consistent with the established pattern across all prior phases.

*Existing infrastructure covers all phase requirements (manual QA only).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| auto_apply only pre-selects eligible discounts | D-02/D-03 | No test framework | Create discount with min_total > empty bill total; verify not pre-selected |
| Expired discounts hidden | D-04 | No test framework | Create discount with end_date = yesterday; verify absent in DiscountSelector |
| once_per_customer codes hidden after use | D-05 | No test framework | Finalize a bill with once_per_customer code; open new bill for same customer; verify code absent |
| buy_x_get_y end-to-end | D-09 | No test framework | Create B2G1 discount, add 3 qualifying items, verify discount = cheapest item price |
| FREE label in invoice PDF | D-10 | No test framework | Apply buy_x_get_y discount, generate invoice, verify FREE label on cheapest item row |
| DiscountForm conditional label clarity | D-07/D-08 | No test framework | Create conditional discount; verify form shows "Discount Amount (₹ off)" label |

---

## Security Threat Map

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| once_per_customer bypass | Tampering | `discount_usage` FK constraint + query on finalize is enforcement. Client-side filter is UX only. |
| Expired discount applied via code injection | Tampering | Date filter in BillingForm is client-side. Admin-only UI; current risk: low. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency acceptable
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
