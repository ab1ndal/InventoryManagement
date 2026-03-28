# Phase 1: Draft & Stock Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 1 — Draft & Stock Management

---

## Area 1: Out-of-Stock Behavior

**Question:** What should happen when staff try to save a draft with an item that has insufficient stock?

**Options presented:**
- Block the save — show error listing affected items, staff must fix before saving
- Warn but allow — show warning toast, save anyway (negative stock possible)
- Allow silently — negative stock is fine (backorders / custom orders)

**Decision:** Block the save *(selected: recommended)*

---

## Area 2: Discount Codes on Draft Reload

**Question:** When staff reopen an existing draft to edit it, should the discount codes they applied originally be pre-populated?

**Options presented:**
- Yes — store applied codes on the bill (add `applied_codes text[]` column to bills)
- Partial — auto-apply only (no schema change, manual codes not restored)
- No — codes not needed on draft edit

**Decision:** Yes — store codes on the bill *(selected: recommended)*

---

## Area 3: BillTable Status Column

**Question:** With real draft bills now in the DB, should the BillTable show a status column?

**Options presented:**
- Yes — show `paymentstatus` badge (Draft / Finalized / Cancelled)
- No — keep existing columns, just add Edit button

**Decision:** Yes — show paymentstatus badge *(selected: recommended)*

---

## Out-of-Scope Note (captured for Phase 4)

User mentioned: "When a customer asks to cancel a bill, have 2 options — one to issue a voucher (default) and other to reverse payment in the original mode of payment."

→ Deferred to Phase 4 (Cancel & Voucher) context.
