---
status: diagnosed
trigger: "After removing auto-applied store credit in BillingForm, user cannot re-apply it"
created: 2026-04-11T00:00:00.000Z
updated: 2026-04-11T00:00:00.000Z
---

## Current Focus

hypothesis: onRemoveStoreCredit zeros appliedStoreCredit with no corresponding UI to restore it from customerStoreCreditBalance
test: trace remove handler and Summary rendering conditions
expecting: confirmed — Summary only renders the green credit row when storeCreditApplied > 0; once zeroed, the row and its button vanish and no re-apply affordance exists
next_action: DONE — root cause confirmed, fix direction documented

## Symptoms

expected: After clicking ✕ on the green store credit row, a mechanism exists to re-apply the balance (e.g. an "Apply store credit (₹X)" button)
actual: Clicking ✕ zeroes appliedStoreCredit; the green row disappears; customerStoreCreditBalance still holds the original balance but no UI references it again; user must re-select the customer to auto-apply
errors: none
reproduction: Open new bill → select customer with store credit → credit auto-applies → click ✕ on green row in Summary → credit row gone, no re-apply button
started: Discovered in UAT Test 8, phase 04-cancel-voucher-pdf

## Eliminated

- hypothesis: customerStoreCreditBalance is also zeroed on remove
  evidence: BillingForm.js line 922 — onRemoveStoreCredit is () => setAppliedStoreCredit(0); only appliedStoreCredit is zeroed, customerStoreCreditBalance is untouched
  timestamp: 2026-04-11

- hypothesis: Summary has a separate "re-apply" path hidden by a flag
  evidence: Summary.js lines 59-76 — the green block is rendered only when storeCreditApplied > 0; no alternative UI branch exists for customerStoreCreditBalance > 0 && appliedStoreCredit === 0
  timestamp: 2026-04-11

## Evidence

- timestamp: 2026-04-11
  checked: BillingForm.js lines 61-62
  found: Two separate state variables — appliedStoreCredit (starts 0) and customerStoreCreditBalance (starts 0)
  implication: The balance is preserved in state after removal; only the applied amount is zeroed

- timestamp: 2026-04-11
  checked: BillingForm.js lines 226-248 (useEffect on selectedCustomerId)
  found: On customer select, fetches store_credit, sets customerStoreCreditBalance = balance AND setAppliedStoreCredit(balance). Auto-apply happens here.
  implication: The only trigger that sets appliedStoreCredit > 0 is customer selection. There is no second trigger.

- timestamp: 2026-04-11
  checked: BillingForm.js line 922
  found: onRemoveStoreCredit={() => setAppliedStoreCredit(0)} — passed to Summary as prop
  implication: Remove handler only zeros appliedStoreCredit. customerStoreCreditBalance is left intact and > 0 after removal.

- timestamp: 2026-04-11
  checked: Summary.js lines 59-76
  found: Green store credit row is wrapped in {storeCreditApplied > 0 && ...}. storeCreditApplied = Math.min(Number(appliedStoreCredit || 0), postVoucherTotal). When appliedStoreCredit = 0, storeCreditApplied = 0 and the entire row (including the ✕ button) is hidden.
  implication: Once removed, there is zero UI for store credit — no row, no button, no affordance.

- timestamp: 2026-04-11
  checked: Summary.js — full file
  found: Summary does not receive customerStoreCreditBalance as a prop at all. It cannot render a re-apply button even if the JSX were added, because it has no access to the balance value.
  implication: A re-apply button requires either (a) passing customerStoreCreditBalance as a new prop to Summary, or (b) rendering the button in BillingForm itself outside Summary.

- timestamp: 2026-04-11
  checked: BillingForm.js line 918-924 (Summary usage)
  found: Summary is called with: computed, appliedStoreCredit, appliedVoucher, onRemoveStoreCredit, onRemoveVoucher. customerStoreCreditBalance is NOT passed.
  implication: The gap is both in BillingForm (no onApplyStoreCredit handler or conditional button) and in Summary's prop interface.

## Resolution

root_cause: When onRemoveStoreCredit fires (BillingForm.js:922), it sets appliedStoreCredit to 0 via setAppliedStoreCredit(0). This hides the green Summary row entirely (Summary.js:59 — rendered only when storeCreditApplied > 0). The available balance remains in customerStoreCreditBalance state (BillingForm.js:62) but that variable is never passed to Summary and no other UI element in BillingForm reads it to offer a re-apply affordance. The auto-apply effect (lines 226-248) only fires on customer selection change, not on manual removal. Result: once removed, the credit is effectively unreachable for the rest of the bill session without re-selecting the customer.

fix: Not applied (goal: find_root_cause_only)
verification: N/A
files_changed: []
