// Pure helpers for the admin sales dashboard. No React, no Supabase imports.

// FY runs Apr(3) -> Mar(2). `off` is the calendar-year offset from the FY start year.
export const FY_MONTHS = [
  { label: "Apr", m: 3, off: 0 },
  { label: "May", m: 4, off: 0 },
  { label: "Jun", m: 5, off: 0 },
  { label: "Jul", m: 6, off: 0 },
  { label: "Aug", m: 7, off: 0 },
  { label: "Sep", m: 8, off: 0 },
  { label: "Oct", m: 9, off: 0 },
  { label: "Nov", m: 10, off: 0 },
  { label: "Dec", m: 11, off: 0 },
  { label: "Jan", m: 0, off: 1 },
  { label: "Feb", m: 1, off: 1 },
  { label: "Mar", m: 2, off: 1 },
];

export function getFinancialYearStart(date) {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-indexed; April = 3
  return m >= 3 ? y : y - 1;
}

export function fyLabel(startYear) {
  const a = String(startYear % 100).padStart(2, "0");
  const b = String((startYear + 1) % 100).padStart(2, "0");
  return `FY ${a}–${b}`;
}

export function monthRangeWithinFy(startYear, fromIdx, toIdx) {
  const from = FY_MONTHS[fromIdx];
  const to = FY_MONTHS[toIdx];
  const start = new Date(startYear + from.off, from.m, 1);
  // First day of the month AFTER `to` (exclusive upper bound). JS rolls Dec+1 -> Jan.
  const end = new Date(startYear + to.off, to.m + 1, 1);
  return { start, end };
}

export function priorYearRange({ start, end }) {
  return {
    start: new Date(start.getFullYear() - 1, start.getMonth(), start.getDate()),
    end: new Date(end.getFullYear() - 1, end.getMonth(), end.getDate()),
  };
}

export function buildFyList(minDate, maxDate) {
  const minY = getFinancialYearStart(minDate);
  const maxY = getFinancialYearStart(maxDate);
  const list = [];
  for (let y = maxY; y >= minY - 1; y--) {
    list.push({
      startYear: y,
      label: fyLabel(y),
      fyStart: new Date(y, 3, 1),
      fyEnd: new Date(y + 1, 3, 1),
    });
  }
  return list;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function aggregateKpis(bills, items) {
  const revenue = bills.reduce((s, b) => s + num(b.net_amount), 0);
  const billsCount = bills.length;
  const cost = items.reduce((s, i) => s + num(i.cost_price) * num(i.quantity), 0);
  const discountGiven = items.reduce((s, i) => s + num(i.discount_total), 0);
  const profit = revenue - cost;
  const aov = billsCount ? revenue / billsCount : 0;
  const grossMargin = revenue ? ((revenue - cost) / revenue) * 100 : 0;
  const gross = revenue + discountGiven; // gross sales before discount
  const discountPctOfGross = gross ? (discountGiven / gross) * 100 : 0;
  return { revenue, billsCount, cost, profit, aov, grossMargin, discountGiven, discountPctOfGross };
}

export function pctChange(curr, prior) {
  if (!prior) return null; // no baseline -> caller shows neutral
  return ((curr - prior) / prior) * 100;
}

export function badgeFor(change, { inverse = false } = {}) {
  if (change == null || !Number.isFinite(change) || Math.abs(change) < 2) return { symbol: "—", tone: "neutral" };
  const up = change > 0;
  const good = inverse ? !up : up;
  return { symbol: up ? "↑" : "↓", tone: good ? "good" : "bad" };
}

export function aggregateMonthlySeries(bills, items, fyStartYear) {
  // bills must be pre-filtered to fyStartYear's period; fyStartYear documents intent only
  const revenue = FY_MONTHS.map(() => 0);
  const cost = FY_MONTHS.map(() => 0);
  // Map a calendar month (0-11) to its slot in the Apr..Mar sequence.
  const slotOf = (m) => (m >= 3 ? m - 3 : m + 9);
  const billSlot = new Map(); // billid -> slot index
  for (const b of bills) {
    if (!b.orderdate) continue;
    const slot = slotOf(new Date(b.orderdate).getMonth());
    billSlot.set(b.billid, slot);
    revenue[slot] += num(b.net_amount);
  }
  for (const i of items) {
    const slot = billSlot.get(i.billid);
    if (slot == null) continue; // item whose bill isn't in this period
    cost[slot] += num(i.cost_price) * num(i.quantity);
  }
  return FY_MONTHS.map((mo, idx) => ({
    label: mo.label,
    revenue: revenue[idx],
    cost: cost[idx],
    margin: revenue[idx] ? ((revenue[idx] - cost[idx]) / revenue[idx]) * 100 : 0,
  }));
}

export function aggregateCategories(items) {
  const map = new Map();
  for (const i of items) {
    const key = i.category && String(i.category).trim() ? String(i.category).trim() : "Others";
    const row = map.get(key) || { category: key, revenue: 0, cost: 0, count: 0 };
    row.revenue += num(i.total);
    row.cost += num(i.cost_price) * num(i.quantity);
    row.count += num(i.quantity);
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, margin: r.revenue ? ((r.revenue - r.cost) / r.revenue) * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function aggregateSalespersons(items, salespersonsById = {}) {
  const map = new Map();
  for (const i of items) {
    if (i.salesperson_id == null) continue;
    const id = i.salesperson_id;
    const row = map.get(id) || { salespersonId: id, revenue: 0, billIds: new Set() };
    row.revenue += num(i.total);
    row.billIds.add(i.billid);
    map.set(id, row);
  }
  return [...map.values()]
    .map((r) => {
      const bills = r.billIds.size;
      return {
        salespersonId: r.salespersonId,
        name: salespersonsById[r.salespersonId] || `#${r.salespersonId}`,
        bills,
        revenue: r.revenue,
        aov: bills ? r.revenue / bills : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .map((r, idx) => ({ rank: idx + 1, ...r }));
}

export function aggregateDiscounts(bills, items) {
  const hasCode = new Map(); // billid -> bool
  for (const b of bills) {
    hasCode.set(b.billid, Array.isArray(b.applied_codes) && b.applied_codes.length > 0);
  }
  let codeAmount = 0;
  let manualAmount = 0;
  const codeBills = new Set();
  const manualBills = new Set();
  for (const i of items) {
    const amt = num(i.discount_total);
    if (!hasCode.has(i.billid)) continue;
    if (hasCode.get(i.billid)) {
      codeAmount += amt;
      if (amt > 0) codeBills.add(i.billid);
    } else {
      manualAmount += amt;
      if (amt > 0) manualBills.add(i.billid);
    }
  }
  return {
    total: codeAmount + manualAmount,
    code: { bills: codeBills.size, amount: codeAmount },
    manual: { bills: manualBills.size, amount: manualAmount },
  };
}

export function buildSeasonalSeries(histRows, liveBills, currentFyYear) {
  const filteredRows = histRows.filter((r) => r.fy_start_year < currentFyYear);
  const byFy = {};
  for (const { fy_start_year, month_idx, net_amount } of filteredRows) {
    if (!byFy[fy_start_year]) byFy[fy_start_year] = new Array(12).fill(null);
    byFy[fy_start_year][month_idx] = net_amount;
  }

  const result = Object.entries(byFy)
    .map(([fy, values]) => ({ label: fyLabel(Number(fy)), values, _fy: Number(fy) }))
    .sort((a, b) => a._fy - b._fy);

  const liveValues = new Array(12).fill(null);
  for (const { net_amount, orderdate } of liveBills) {
    if (net_amount === null) continue;
    const idx = (new Date(orderdate).getMonth() - 3 + 12) % 12;
    liveValues[idx] = (liveValues[idx] ?? 0) + net_amount;
  }
  result.push({ label: fyLabel(currentFyYear), values: liveValues, _fy: currentFyYear });

  return result.map(({ _fy, ...rest }) => rest);
}

export function buildVsHistoryComparison(histRows, liveBills, currentFyYear) {
  const months = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

  const filteredRows = histRows.filter((r) => r.fy_start_year < currentFyYear);
  const buckets = Array.from({ length: 12 }, () => []);
  for (const { month_idx, net_amount } of filteredRows) {
    if (net_amount !== null) buckets[month_idx].push(net_amount);
  }
  const historicalAvg = buckets.map((vals) =>
    vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  );

  const currentFy = new Array(12).fill(null);
  for (const { net_amount, orderdate } of liveBills) {
    if (net_amount === null) continue;
    const idx = (new Date(orderdate).getMonth() - 3 + 12) % 12;
    currentFy[idx] = (currentFy[idx] ?? 0) + net_amount;
  }

  return { months, currentFy, historicalAvg };
}

export function buildFyTotals(histRows, liveBills, currentFyYear) {
  const filteredRows = histRows.filter((r) => r.fy_start_year < currentFyYear);
  const byFy = {};
  for (const { fy_start_year, net_amount } of filteredRows) {
    if (!byFy[fy_start_year]) byFy[fy_start_year] = [];
    byFy[fy_start_year].push(net_amount);
  }

  const result = Object.entries(byFy).map(([fy, amounts]) => {
    const fyNum = Number(fy);
    const valid = amounts.filter((a) => a !== null);
    return {
      label: fyLabel(fyNum),
      total: valid.length > 0 ? valid.reduce((s, a) => s + a, 0) : null,
      isLive: false,
      _fy: fyNum,
    };
  });

  const validBills = liveBills.filter((b) => b.net_amount !== null);
  const liveTotal = validBills.length === 0 ? null : validBills.reduce((s, b) => s + b.net_amount, 0);
  result.push({ label: fyLabel(currentFyYear), total: liveTotal, isLive: true, _fy: currentFyYear });

  result.sort((a, b) => a._fy - b._fy);
  result.forEach((r) => delete r._fy);
  return result;
}
