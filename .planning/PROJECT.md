# Project: Bindal's Creation — Retail Inventory

## What This Is

An internal admin tool for Bindal's Creation, a retail clothing business. Staff use it to manage inventory (products, variants, stock), customers, suppliers, billing, mockups, and exchanges. No public-facing storefront — this is purely an operations tool.

## Core Value

Fast, accurate billing with proper GST tracking so staff can create and print invoices quickly at point of sale.

## Tech Stack

- **Frontend:** React 19 SPA (Create React App)
- **Backend:** Supabase (PostgreSQL + Auth) — direct client access, no server layer
- **UI:** Shadcn/ui + Tailwind CSS (primary: #0066cc), Sonner toasts
- **Forms:** React Hook Form + Zod
- **Charts:** Plotly.js
- **Printing:** Browser PDF print (QZ Tray was attempted but abandoned)
- **Path alias:** `@/*` → `src/*`

## Key Database Tables

| Table | Purpose |
|-------|---------|
| `bills` | Invoice headers (billid, customerid, totals, finalized, pdf_url) |
| `bill_items` | Line items per bill (variantid, qty, mrp, alteration, gst, totals) |
| `discount_usage` | Per-customer discount code tracking per bill |
| `discounts` | Discount codes (flat, %, buy_x_get_y, fixed_price, conditional) |
| `products` | Inventory items |
| `productsizecolors` | Size/color variants with stock |
| `customers` | Customer records with loyalty tier, store credit |
| `profiles` | User roles (admin / superadmin) |
| `exchanges` | Return/exchange records |
| `vouchers` | Store credit vouchers |

## Current Milestone: v1.0 Update Billing

**Goal:** Complete the billing workflow — wire up DB persistence, enable editing existing bills, generate printable PDF invoices, and add bill lifecycle management (delete/void).

**Target features:**
- Save draft and finalize bills to Supabase (bills + bill_items tables)
- Load and edit existing bills in the BillingForm
- Generate PDF invoice and trigger browser print dialog
- Delete draft bills and void finalized bills

## Active Requirements

See `REQUIREMENTS.md` for full list with REQ-IDs.

## Validated Requirements

_(none yet — milestone just started)_

## Out of Scope

- QZ Tray integration (abandoned — using browser PDF print instead)
- Public customer-facing storefront
- Payment gateway integration

## Key Decisions

- **PDF printing over QZ Tray:** User attempted QZ Tray without success; browser `window.print()` with a print-optimized HTML template is the chosen approach
- **No separate API layer:** All Supabase calls made directly from React components
- **Discount tracking via `discount_usage` table:** When finalizing, insert rows for each applied discount code

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
_Last updated: 2026-03-28 — Milestone v1.0 started_
