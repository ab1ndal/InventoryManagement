// src/admin/pages/DashboardPage.js
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";
import {
  buildFyList,
  getFinancialYearStart,
  monthRangeWithinFy,
  priorYearRange,
} from "../../utility/dashboardData";
import DashboardFilters from "../components/dashboard/DashboardFilters";
import KpiCards from "../components/dashboard/KpiCards";
import RevenueChart from "../components/dashboard/RevenueChart";
import CategoryBreakdown from "../components/dashboard/CategoryBreakdown";
import SalespersonTable from "../components/dashboard/SalespersonTable";
import DiscountTable from "../components/dashboard/DiscountTable";
import HistoricalTrends from "../components/dashboard/HistoricalTrends";

const PAGE = 1000;
const EMPTY = { bills: [], items: [] };

// Supabase caps each response at 1000 rows. Loop with .range until a short page.
async function fetchAllRows(makeQuery) {
  let from = 0;
  const out = [];
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

const iso = (d) => d.toISOString();

async function fetchPeriod({ start, end }) {
  const [bills, items] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from("bills")
        .select("billid, net_amount, orderdate, applied_codes")
        .gte("orderdate", iso(start))
        .lt("orderdate", iso(end))
        .eq("finalized", true)
    ),
    // bill_items has no date column -> filter via embedded inner join on bills.
    fetchAllRows(() =>
      supabase
        .from("bill_items")
        .select(
          "billid, category, total, cost_price, quantity, discount_total, salesperson_id, bills!inner(orderdate, finalized)"
        )
        .gte("bills.orderdate", iso(start))
        .lt("bills.orderdate", iso(end))
        .eq("bills.finalized", true)
    ),
  ]);
  return { bills, items };
}

export default function DashboardPage() {
  const [fyList, setFyList] = useState([]);
  const [filter, setFilter] = useState(null); // { startYear, fromIdx, toIdx }
  const [current, setCurrent] = useState(EMPTY);
  const [prior, setPrior] = useState(EMPTY);
  const [salespersonsById, setSalespersonsById] = useState({});
  const [loading, setLoading] = useState(true);

  // Build FY tabs from earliest/latest finalized bill, and load salespersons (once).
  useEffect(() => {
    (async () => {
      try {
        const [minRes, maxRes, spRes] = await Promise.all([
          supabase.from("bills").select("orderdate").eq("finalized", true).order("orderdate", { ascending: true }).limit(1),
          supabase.from("bills").select("orderdate").eq("finalized", true).order("orderdate", { ascending: false }).limit(1),
          supabase.from("salespersons").select("salesperson_id, name"),
        ]);
        if (minRes.error) throw minRes.error;
        if (maxRes.error) throw maxRes.error;
        if (spRes.error) throw spRes.error;
        const map = {};
        (spRes.data || []).forEach((s) => { map[s.salesperson_id] = s.name; });
        setSalespersonsById(map);

        const minDate = minRes.data?.[0] ? new Date(minRes.data[0].orderdate) : new Date();
        const maxDate = maxRes.data?.[0] ? new Date(maxRes.data[0].orderdate) : new Date();
        const list = buildFyList(minDate, maxDate);
        setFyList(list);

        const currentFyStart = getFinancialYearStart(new Date());
        const defaultYear = list.some((f) => f.startYear === currentFyStart)
          ? currentFyStart
          : (list[0]?.startYear ?? currentFyStart);
        setFilter({ startYear: defaultYear, fromIdx: 0, toIdx: 11 });
      } catch (e) {
        console.error(e);
        toast.error("Failed to load dashboard setup");
        setLoading(false);
      }
    })();
  }, []);

  const ranges = useMemo(() => {
    if (!filter) return null;
    const cur = monthRangeWithinFy(filter.startYear, filter.fromIdx, filter.toIdx);
    return { cur, prior: priorYearRange(cur) };
  }, [filter]);

  // Fetch both periods whenever the range changes.
  useEffect(() => {
    if (!ranges) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [cur, pri] = await Promise.all([fetchPeriod(ranges.cur), fetchPeriod(ranges.prior)]);
        if (cancelled) return;
        setCurrent(cur);
        setPrior(pri);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load dashboard data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ranges]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Sales Dashboard</h1>
        {filter && <DashboardFilters fyList={fyList} value={filter} onChange={setFilter} />}
      </div>

      <KpiCards current={current} prior={prior} loading={loading} />

      <div className="grid grid-cols-[2fr_1fr] gap-4">
        <RevenueChart current={current} prior={prior} range={filter ?? { startYear: 0, fromIdx: 0, toIdx: 11 }} loading={loading} />
        <CategoryBreakdown current={current} loading={loading} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SalespersonTable current={current} salespersonsById={salespersonsById} loading={loading} />
        <DiscountTable current={current} loading={loading} />
      </div>

      <HistoricalTrends />
    </div>
  );
}
