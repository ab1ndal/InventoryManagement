# Admin Sales Dashboard — Design Spec

**Date**: 2026-05-31  
**Status**: Approved  
**Route**: `/admin/dashboard`

---

## Purpose

Strategic review dashboard for the store owner. Answers: which categories are driving revenue, how are margins trending, who is performing, and how much revenue is being discounted away. Reviewed weekly/monthly to inform buying and staffing decisions.

---

## Route & Navigation

- New route: `/admin/dashboard` inside the existing `RequireAdminAuth` + `AdminLayout` wrapper
- Add `{ label: "Dashboard", path: "/admin/dashboard" }` to `navItems` in `AdminLayout.jsx`
- New page file: `src/admin/pages/DashboardPage.js`

---

## Date Filter

Positioned top-right of the page header. Controls all widgets simultaneously.

- **FY tabs**: auto-generated from distinct years in `bills.orderdate`. Format: `FY 25–26`, `FY 24–25`, etc. Default: current FY.
- **Month range picker** (within active FY): two `<Select>` dropdowns — "From month" and "To month", constrained to Apr–Mar of the active FY. Default: full FY (Apr–Mar).
- Filter state: `{ fyStart: Date, fyEnd: Date }` passed as props or via local state to all child components.

Financial year boundary: April 1 of year Y → March 31 of year Y+1. Reuse `getFinancialYear()` logic already in `AdminPage.jsx`.

---

## Section 1 — KPI Cards

Six cards in a single row (`grid-cols-6`). Each shows a headline number, a % change badge vs the same period in the prior FY, and a subtitle.

| Card | Formula | Badge logic |
|------|---------|-------------|
| **Revenue** | `SUM(bills.net_amount)` where finalized | vs prior FY same months |
| **Gross Margin %** | `(revenue − cost) / revenue × 100` | Show benchmark note "target 50–65%" |
| **Bills** | `COUNT(bills)` where finalized | vs prior FY same months |
| **Avg Order Value** | `revenue / bills` | No badge, absolute value only |
| **Discount Given** | `SUM(bill_items.discount_total)` | Show as `₹X (Y% of gross)` |
| **Profit** | `revenue − SUM(bill_items.cost_price × quantity)` | vs prior FY same months |

Badges: green `↑` if positive (except Discount Given where increase = red), grey `—` if <2% change, red `↓` if negative.

**Data query**: Single pass over `bills` (for revenue/count) + `bill_items` (for cost, discount) filtered by date range. Fetch both current period and prior-FY same period in parallel.

---

## Section 2 — Revenue Chart + Category Breakdown

Two-column layout: `grid-cols-[2fr_1fr]`.

### Revenue Bar Chart (left, 2/3 width)

- Library: **Plotly.js** (`react-plotly.js`) — already installed
- Type: grouped bar chart, one bar per month
- Current FY: solid `#0066cc` bars
- Prior FY overlay: faded `#bfdbfe` bars for comparison
- X-axis: month abbreviations (Apr → Mar)
- Y-axis: ₹ in lakhs
- Tooltip: month name, revenue, prior year revenue, % change
- Data: aggregate `bills.net_amount` by calendar month for both periods

### Category Breakdown (right, 1/3 width)

- Horizontal bar list (custom HTML, not Plotly — simpler, faster)
- Rows sorted by revenue descending
- Each row: category name | proportional bar | revenue (₹) | margin %
- Margin % = `(revenue − cost) / revenue` per category
- Data source: `bill_items.category`, `bill_items.total`, `bill_items.cost_price`, `bill_items.quantity`
- Categories come from `bill_items.category` directly (not the `categories` table join — avoids null issues for manual items)

---

## Section 3 — Salesperson Table + Discount Table

Two-column layout: `grid-cols-2`.

### Salesperson Performance (left)

Columns: Rank | Name | Bills | AOV | Revenue  
Sorted: revenue descending  
Source: `bill_items.salesperson_id` → join `salespersons.name`. Sum `bill_items.total` grouped by salesperson. Bills count = distinct `bill_items.billid` per salesperson.  
Note: a bill can have multiple salespersons; each salesperson gets credit for their own line items only.

### Discount Impact (right)

Columns: Code | Type | Times Used | ₹ Given  
Sorted: ₹ given descending  

Two data sources merged:
1. **Code discounts**: `discount_usage` joined to `discounts` for type/code metadata, summed per code
2. **Manual discounts** (no code): `SUM(bill_items.discount_total)` on bill_items where the parent bill has no applied_codes — shown as a single "Manual" row

Type badges: `%` (percentage), `flat` (fixed amount), `item` (item-level manual).

---

## Component Structure

```
DashboardPage.js
├── <DashboardFilters />        — FY tabs + month range selectors
├── <KpiCards dateRange={…} />  — 6 KPI cards, fetches bills + bill_items
├── <RevenueChart dateRange={…} /> — Plotly bar chart, current + prior FY
├── <CategoryBreakdown dateRange={…} /> — horizontal bar list
├── <SalespersonTable dateRange={…} /> — ranked table
└── <DiscountTable dateRange={…} />    — discount impact table
```

All chart/table components accept `{ start: Date, end: Date, priorStart: Date, priorEnd: Date }` and manage their own data fetching + loading states. Pattern matches existing pages.

---

## Data Fetching Notes

- **No new Supabase RPCs needed.** All queries use existing tables via the JS client.
- `bill_items.cost_price` is already stored per line item — no join to `products` required for margin.
- Filter bills by: `orderdate >= start AND orderdate < end AND finalized = true`
- For prior-FY comparison: shift dates back exactly 1 year.
- All fetches run in parallel (`Promise.all`) within each component's `useEffect`.

---

## Styling

- Follows existing pattern: Tailwind + Shadcn/ui components
- KPI card grid: `grid grid-cols-6 gap-3`
- Section cards: `bg-white rounded-xl border border-gray-200 p-5`
- Revenue chart height: 240px
- Color palette: primary `#0066cc`, categories get distinct hues (blue, violet, cyan, amber, slate)
- `formatINR()` from `src/utility/formatCurrency.js` for all currency display

---

## Out of Scope

- Export to CSV/PDF
- Real-time auto-refresh
- Push notifications or alerts
- Customer insights widget (not selected)
- Payment method breakdown (not selected)
- Top products widget (not selected)
