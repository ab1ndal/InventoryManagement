---
phase: 3
slug: finalize-with-payment-pdf-invoice
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-09
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest (Create React App built-in) |
| **Config file** | none — CRA default |
| **Quick run command** | `npm test -- --watchAll=false --testPathPattern=billing` |
| **Full suite command** | `npm test -- --watchAll=false` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --watchAll=false --testPathPattern=billing`
- **After every plan wave:** Run `npm test -- --watchAll=false`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | — | setup | `npm ls jspdf html2canvas` | ✅ | ⬜ pending |
| 03-01-02 | 01 | 1 | BILL-04 | manual | confirm dialog renders in browser | ✅ | ⬜ pending |
| 03-01-03 | 01 | 1 | BILL-04 | manual | Supabase bills row updated | ✅ | ⬜ pending |
| 03-01-04 | 01 | 1 | CUST-01 | manual | customers.total_spend incremented | ✅ | ⬜ pending |
| 03-01-05 | 01 | 1 | BILL-04 | manual | discount_usage rows inserted | ✅ | ⬜ pending |
| 03-02-01 | 02 | 2 | PRINT-01 | manual | InvoiceView renders with store header | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | PRINT-02 | manual | PDF blob generated, uploads to Storage | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 2 | PRINT-03 | manual | bills.pdf_url set, PDF opens in new tab | ✅ | ⬜ pending |
| 03-03-01 | 03 | 3 | PRINT-04 | manual | Print icon visible on finalized rows | ✅ | ⬜ pending |
| 03-03-02 | 03 | 3 | PRINT-04 | manual | Print icon opens pdf_url in new tab | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install jspdf html2canvas` — install PDF generation dependencies (not yet in package.json)
- [ ] Verify `invoices` Supabase Storage bucket exists and is set to Public in Supabase dashboard

*If bucket missing: create via Supabase dashboard → Storage → New bucket → name: `invoices` → Public: ON*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Finalize confirmation dialog shows correct bill data | BILL-04 | UI interaction | Open BillingForm with draft bill, fill payment fields, click Finalize, verify dialog shows bill total/customer/payment |
| Supabase bills row updated on confirm | BILL-04 | DB state | After finalize, check Supabase Table Editor: `finalized=true`, `paymentstatus='finalized'`, `pdf_url` populated |
| Customer total_spend incremented | CUST-01 | DB state | Check customers table: `total_spend` and `last_purchased_at` updated correctly |
| PDF renders with GST breakdown | PRINT-01 | Visual | Open generated PDF: verify GSTIN, CGST+SGST split, per-line taxable values |
| PDF uploads to Supabase Storage | PRINT-02 | Storage | Check Supabase Storage `invoices` bucket: `bill-{id}.pdf` file exists |
| Print icon in BillTable opens PDF | PRINT-04 | UI interaction | Reload BillTable after finalize: confirm print icon appears and opens PDF in new tab |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
