---
status: diagnosed
trigger: "step 2 resolution dialog is shorter than the content it contains"
created: 2026-04-11T00:00:00.000Z
updated: 2026-04-11T00:00:00.000Z
---

## Current Focus

hypothesis: DialogContent uses `grid` layout with no explicit height/overflow, so content taller than the viewport-center snap point overflows the container without it growing
test: N/A — confirmed by static analysis
expecting: N/A
next_action: fix DialogContent className in Dialog 2 (BillTable.js line 571)

## Symptoms

expected: Step 2 resolution dialog is tall enough to display all its content (header, description, two tall buttons, Go Back button) without clipping
actual: Dialog is shorter than its content — content overflows or is cut off
errors: None
reproduction: Cancel a finalized bill with a customer → proceed past step 1 → observe step 2 dialog
started: Discovered during UAT of phase 04-cancel-voucher-pdf

## Eliminated

- hypothesis: Fixed height set explicitly on DialogContent
  evidence: Neither Dialog 1 nor Dialog 2 pass a height/max-height class. The shared shadcn DialogContent base class (dialog.tsx line 39) also has no height/max-height utility.
  timestamp: 2026-04-11

## Evidence

- timestamp: 2026-04-11
  checked: src/components/ui/dialog.tsx — DialogContent base classes
  found: The base class string is `"fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg ..."`. No `max-h-*`, `h-*`, or `overflow-*` is set.
  implication: The container is a CSS grid positioned at top-50% / translate-y-[-50%]. With no max-height constraint and no overflow setting, Radix Dialog inherits browser defaults — the content block can grow taller than the visible viewport on small screens, or the Radix animation wrapper clips it.

- timestamp: 2026-04-11
  checked: BillTable.js line 571 — Dialog 2 DialogContent props
  found: `<DialogContent className="bg-white max-w-md">`. No overflow or max-height override is provided. The caller's className only overrides `bg-white` and `max-w-md`.
  implication: Same gap — no overflow-y:auto and no max-h to ensure the dialog scrolls or sizes itself to fit.

- timestamp: 2026-04-11
  checked: BillTable.js Dialog 2 content (lines 573–613) — actual children rendered
  found: DialogHeader (title + multi-line description with bill amount), two full-width `h-auto py-3` buttons each containing a two-line text block, plus a footer row with a Go Back button. With `gap-4` from the base grid and `pt-2`/`pt-4` paddings, the natural content height is substantially taller than Dialog 1 (which only has 4 lines of bill metadata + two short buttons).
  implication: Dialog 2 has materially more vertical content than Dialog 1 yet uses identical DialogContent markup with no overflow accommodation.

- timestamp: 2026-04-11
  checked: Comparison of Dialog 1 (line 526) vs Dialog 2 (line 570) DialogContent className
  found: Both use exactly `className="bg-white max-w-md"`. Dialog 1 content is shorter (4 info rows + two compact buttons). Dialog 2 content is taller (longer description, two h-auto multi-line buttons, plus footer).
  implication: The same container style fits Dialog 1's content but not Dialog 2's taller content — confirming the problem is the absence of overflow handling when content exceeds the implicit height the grid block naturally claims.

## Resolution

root_cause: The shadcn DialogContent base layout uses `grid` with `translate-y-[-50%]` centering (anchored at top-50% of viewport). When children exceed the available space above/below the vertical midpoint, the dialog box does not scroll and has no max-height — on typical laptop screens the two tall `h-auto` multi-line buttons plus the header/description in Dialog 2 push total content height past what the viewport mid-point can accommodate, causing the bottom portion (including the Go Back button and part of the second option button) to render outside the visible area. Adding `max-h-[90vh] overflow-y-auto` to DialogContent constrains the box to the viewport and enables scrolling.

fix: On Dialog 2's `<DialogContent>` at BillTable.js line 571, change className from `"bg-white max-w-md"` to `"bg-white max-w-md max-h-[90vh] overflow-y-auto"`.

verification: ""
files_changed: []
