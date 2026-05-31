# Shipping Fields — Design Spec
**Date:** 2026-05-30

## Goal

Add HSN codes and physical dimensions (weight, L×W×H) to products so the storefront can integrate with courier APIs (Shiprocket / Delhivery / etc.). Use category-level defaults so 3000+ existing products are covered immediately with minimal data entry.

---

## Context

- 3000+ products already in DB — per-product data entry not viable for initial rollout
- HSN codes are category-level (all shirts = 620590, all trousers = 620462, etc.)
- Weight is approximately standard per category; outliers can override at product level
- Dimensions (L×W×H) vary by packaging — set at product level, optional
- Storefront courier integration consumes these fields; admin captures them

---

## Database Changes

### `categories` table — add columns

| Column | Type | Notes |
|--------|------|-------|
| `hsn_code` | `VARCHAR(10)` | nullable. E.g. `620590` for shirts |
| `default_weight_grams` | `INT` | nullable. Default weight for all products in category |

### `products` table — add columns

| Column | Type | Notes |
|--------|------|-------|
| `weight_override_grams` | `INT` | nullable. Overrides category default when set |
| `length_cm` | `DECIMAL(8,2)` | nullable. Packed length |
| `width_cm` | `DECIMAL(8,2)` | nullable. Packed width |
| `height_cm` | `DECIMAL(8,2)` | nullable. Packed height |

### Effective weight resolution (computed in app, not DB)

```
effective_weight = product.weight_override_grams
                ?? category.default_weight_grams
                ?? null
```

Null = shipping weight unknown, flag in UI.

---

## UI Changes

### CategoriesPage / CategoryForm

Add two fields to the Add/Edit category form:
- **HSN Code** (text input, max 8 chars, optional) — with helper text "e.g. 620590 for shirts"
- **Default Weight (grams)** (number input, optional)

### CategoryTable

Add two columns: **HSN Code** | **Default Weight**. Show `—` when not set.

### Product Edit Dialog (InventoryPage)

Add a collapsible "Shipping" section with:
- **Weight Override (grams)** — overrides category default. Show inherited value as placeholder (e.g. `placeholder="190 (from category)"`)
- **Length (cm)**, **Width (cm)**, **Height (cm)** — packed dimensions

### InventoryPage table

Add **Weight** column showing effective weight. Cells where weight is null shown in muted red as a flag.

---

## Rollout Strategy

1. Set HSN + default weight on all categories (10–20 rows) — covers all 3000 products instantly
2. Set dimensions per product gradually as needed
3. Override weight per product only for outliers

---

## Migration File

`schema/migration_shipping_fields.sql` — adds all new columns, no destructive changes.

---

## Out of Scope

- Courier API integration (handled on storefront side)
- Automatic HSN lookup / validation service
- Volumetric weight calculation (courier-side concern)
- Bulk CSV import (category defaults make it unnecessary for initial load)
