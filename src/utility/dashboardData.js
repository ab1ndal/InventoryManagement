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
