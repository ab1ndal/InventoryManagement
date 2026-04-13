# Discount Definition Guide

How to create and configure each discount type in the Discounts form.

---

## How to Open the Form

Go to **Admin → Discounts**. Click **New Discount** to create, or click an existing discount row to edit it.

---

## Fields Common to All Types

| Field | Required | Description |
|-------|----------|-------------|
| **Code** | No | The coupon/promo code customers enter (e.g. `SUMMER20`). Leave blank to auto-generate. |
| **Type** | Yes | Determines how the discount is calculated. See type guide below. |
| **Category** | No | Restricts the discount to items in this product category. Leave blank to apply to all items. |
| **Min Spend (₹)** | Yes (default 0) | Bill subtotal must reach this amount before the discount activates. Use `0` for no minimum. |
| **Start Date / End Date** | No | Optional validity window. Outside these dates the discount is hidden from billing. |
| **Max Discount (₹)** | No | Caps the total rupee savings regardless of what the formula produces. |
| **Once Per Customer** | — | Check this to allow each customer to use the code only once. The billing form hides it for customers who've already used it. |
| **Exclusive** | — | Check this if the discount cannot be combined with other discounts on the same bill. |
| **Auto-Apply** | — | The billing form pre-selects this discount automatically when eligibility conditions are met (date, min spend, item qty for Buy X Get Y). |
| **Active** | — | Uncheck to disable without deleting. |

---

## Discount Types

### 1. Flat Amount (₹) — `flat`

Deducts a fixed rupee amount from the bill total.

| Field | What to enter |
|-------|---------------|
| **Value (₹)** | Rupee amount to subtract (e.g. `100` → ₹100 off) |
| **Max Discount** | Usually not needed — the value is already fixed |

**Example:** Code `SAVE100` gives ₹100 off any bill above ₹500.
- Type: `Flat Amount (₹)` · Value: `100` · Min Spend: `500`

---

### 2. Percentage (%) — `percentage`

Deducts a percentage of the bill total.

| Field | What to enter |
|-------|---------------|
| **Value (%)** | Percentage off (e.g. `20` → 20% off) |
| **Max Discount (₹)** | Caps the saving in rupees (e.g. `500` means at most ₹500 off) |

**Example:** Code `SUMMER20` gives 20% off, capped at ₹500.
- Type: `Percentage (%)` · Value: `20` · Max Discount: `500`

---

### 3. Buy X Get Y (Free items) — `buy_x_get_y`

Customer buys X items and gets Y cheapest items free. The free items are identified at billing time (cheapest qualifying units get the FREE badge on the invoice).

| Field | What to enter |
|-------|---------------|
| **Buy Qty** | Number of items customer must purchase (e.g. `2`) |
| **Get Qty** | Number of additional items that are free (e.g. `1`) |
| **Category** | (Optional) Restrict to a specific product category. Leave blank to include all items. |
| **Max Discount (₹)** | (Optional) Cap on total free-item value |

**Example:** Buy 2 items, get 1 free (cheapest item is free).
- Type: `Buy X Get Y` · Buy Qty: `2` · Get Qty: `1` · Category: *(blank for all)*

**How it works at billing:**
1. Staff adds items to the bill.
2. Staff applies the discount code.
3. The cheapest qualifying item unit(s) are marked FREE.
4. The invoice PDF shows a **FREE** badge next to those line items.
5. The discount amount equals the price of the free item(s).

> **Auto-Apply with Buy X Get Y:** When Auto-Apply is checked, the billing form pre-selects this discount only if the bill already has enough qualifying items (buy_qty + get_qty). If you open a new bill with no items, it will NOT pre-select — staff must add items first, then manually check the discount.

---

### 4. Fixed Price — `fixed_price`

Sets a fixed total price for qualifying items (useful for bundle pricing).

| Field | What to enter |
|-------|---------------|
| **Value (₹)** | Fixed total price of the qualifying set |
| **Fixed Total (₹)** | The target fixed price (same concept — enter the bundle price here) |
| **Category** | Restrict to items in this category |
| **Max Discount (₹)** | (Optional) Cap on savings |

**Example:** Any 3 shirts for ₹999 (regardless of individual prices).
- Type: `Fixed Price` · Fixed Total: `999` · Category: `Shirts`

---

### 5. Conditional (min spend) — `conditional`

Applies a flat rupee deduction when the bill reaches a minimum spend threshold. Similar to Flat Amount but the intent is spend-threshold-triggered.

| Field | What to enter |
|-------|---------------|
| **Discount Amount (₹ off)** | Flat rupee deduction when threshold is met |
| **Min Spend (₹)** | Minimum bill total required to activate |
| **Max Discount (₹)** | (Optional) Additional cap |

**Example:** Spend ₹2000, get ₹200 off.
- Type: `Conditional (min spend)` · Discount Amount: `200` · Min Spend: `2000`

> The value field is labeled **"Discount Amount (₹ off)"** for this type to clarify it is a flat rupee deduction (not a percentage, not a threshold amount).

---

## Flags Reference

### Once Per Customer
When checked, the billing form checks `discount_usage` for the selected customer. If the customer has already used this code, the discount is hidden from the selector entirely. The code is recorded in `discount_usage` when the bill is finalized.

### Exclusive
Prevents stacking with other discounts on the same bill. If you apply an exclusive discount, other discounts are deselected.

### Auto-Apply
The billing form automatically pre-selects this discount when:
- Today falls within Start Date / End Date
- The bill total meets Min Spend
- For Buy X Get Y: enough qualifying items are in the bill

Staff can still manually uncheck an auto-applied discount.

### Active
Inactive discounts are never shown in the billing form. Use this to temporarily disable a promotion without deleting its history.

---

## Quick Reference

| Goal | Type | Key fields |
|------|------|------------|
| ₹X off everything | Flat | Value = X |
| X% off, capped at ₹Y | Percentage | Value = X, Max Discount = Y |
| Buy 2 get 1 free | Buy X Get Y | Buy = 2, Get = 1 |
| Bundle pricing | Fixed Price | Fixed Total = bundle price |
| Spend ₹X get ₹Y off | Conditional | Min Spend = X, Discount Amount = Y |
| Single-use coupon | Any | Once Per Customer = ✓ |
| Time-limited offer | Any | Start Date + End Date |
| Auto-select on eligible bills | Any | Auto-Apply = ✓ |
