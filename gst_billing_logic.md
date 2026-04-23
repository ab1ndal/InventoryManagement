# GST Billing Logic for Fashion Retail (India 2025–2026)

## 1. Overview

This document defines the correct GST calculation and billing approach for:

- Stitched garments
- Unstitched fabrics
- Discount handling
- “GST-OFF” equivalent pricing (compliant method)

Goal:

- Stay fully GST compliant
- Provide customers a “GST-free feel”
- Maintain clean and correct invoices

---

## 2. Latest GST Rates (2025–2026)

### 2.1 Stitched Apparel (Garments)

| Condition                 | GST Rate |
| ------------------------- | -------- |
| Price ≤ ₹2500 per piece | 5%       |
| Price > ₹2500 per piece  | 18%      |

---

### 2.2 Unstitched Fabrics

| Item              | GST Rate |
| ----------------- | -------- |
| All major fabrics | 5%       |

---

### 2.3 Fibres & Yarn

| Item              | GST Rate |
| ----------------- | -------- |
| All fibres & yarn | 5%       |

---

## 3. Core GST Calculation Rule

Taxable Value = Price - Discount
GST = Taxable Value × GST Rate
Final Amount = Taxable Value + GST

---

## 4. Critical Compliance Rules

- Discount BEFORE GST
- No GST waiver
- No 12% slab
- Per item GST logic

---

## 5. GST-OFF Strategy

Customer perception: GST removed
Reality: Discount absorbs GST

---

## 6. Reverse Calculation

For 5% GST:
taxable = P / 1.05
gst = P - taxable

For 18% GST:
taxable = P / 1.18
gst = P - taxable

---

## 7. Discount Calculation

discount = MRP - taxable

---

## 8. Implementation Logic

if item type == "fabric" or "Unstitched":
    gst_rate = 0.05
elif item type == "Stitched":
    if price_per_piece <= 2500:
        gst_rate = 0.05
    else:
        gst_rate = 0.18

taxable_value = price - discount
gst_amount = taxable_value * gst_rate
final_amount = taxable_value + gst_amount

---

## 9. Final Takeaway

GST is always applied
Discount absorbs GST
Invoice must remain compliant
