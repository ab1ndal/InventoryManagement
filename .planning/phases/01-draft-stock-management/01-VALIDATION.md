---
phase: 1
slug: draft-stock-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest + React Testing Library (via Create React App) |
| **Config file** | None — CRA built-in |
| **Quick run command** | `npm test -- --watchAll=false --testPathPattern="billUtils|stockDelta"` |
| **Full suite command** | `npm test -- --watchAll=false` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --watchAll=false --testPathPattern="billUtils|stockDelta"`
- **After every plan wave:** Run `npm test -- --watchAll=false`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | BILL-01 | unit | `npm test -- --watchAll=false --testPathPattern="billUtils"` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 0 | BILL-02, STOCK-01, STOCK-02 | unit | `npm test -- --watchAll=false --testPathPattern="stockDelta"` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | BILL-01 | unit + manual | `npm test -- --watchAll=false --testPathPattern="billUtils"` | ✅ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | STOCK-01, STOCK-02 | unit + manual | `npm test -- --watchAll=false --testPathPattern="stockDelta"` | ✅ W0 | ⬜ pending |
| 1-03-01 | 03 | 2 | BILL-02, BILL-03 | unit + manual | `npm test -- --watchAll=false --testPathPattern="billUtils|stockDelta"` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/admin/components/billing/__tests__/billUtils.test.js` — stubs for BILL-01, BILL-03, STOCK-01 (pure function tests for `computeBillTotals`, `priceItem`, `normalizeItem`, back-calc of `quickDiscountPct`)
- [ ] `src/admin/components/billing/__tests__/stockDelta.test.js` — stubs for BILL-02, STOCK-02 (stock delta map computation logic — extract helper function for testability)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `bills` + `bill_items` inserted in Supabase on Save Draft | BILL-01 | Supabase integration — DB writes | Click Save Draft; check Supabase dashboard for new bills row and corresponding bill_items rows |
| Stock decremented in `productsizecolors` | STOCK-01 | Supabase integration — DB writes | Save draft with inventory item; verify stock column decremented by qty |
| Stock reconciled on draft update | STOCK-02 | Supabase integration — DB writes | Edit existing draft; change qty/remove item; verify stock restores old qty and applies new qty |
| Edit in BillTable pre-populates BillingForm | BILL-03 | React UI interaction | Click Edit on existing draft; verify customer, items, discounts pre-populated correctly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
