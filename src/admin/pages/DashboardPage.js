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

const iso = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function fetchPeriod({ start, end }) {
  const bills = await fetchAllRows(() =>
    supabase
      .from("bills")
      .select("billid, net_amount, payment_amount, orderdate, applied_codes")
      .gte("orderdate", iso(start))
      .lt("orderdate", iso(end))
  );

  if (bills.length === 0) return { bills: [], items: [] };

  const billIds = bills.map((b) => b.billid);

  const rawItems = await fetchAllRows(() =>
    supabase
      .from("bill_items")
      .select("billid, product_code, variantid, quantity, total, discount_total, salesperson_id, category")
      .in("billid", billIds)
  );

  const manualCodes = [...new Set(
    rawItems.filter((i) => i.product_code?.startsWith("BCX")).map((i) => i.product_code)
  )];
  const variantIds = [...new Set(
    rawItems.filter((i) => !i.product_code?.startsWith("BCX") && i.variantid).map((i) => i.variantid)
  )];

  const [manualRes, variantRes] = await Promise.all([
    manualCodes.length > 0
      ? supabase.from("manual_items").select("manual_item_id, purchase_price").in("manual_item_id", manualCodes)
      : { data: [], error: null },
    variantIds.length > 0
      ? supabase.from("productsizecolors").select("variantid, products(purchaseprice)").in("variantid", variantIds)
      : { data: [], error: null },
  ]);
  if (manualRes.error) throw manualRes.error;
  if (variantRes.error) throw variantRes.error;

  const manualPriceMap = Object.fromEntries(
    (manualRes.data || []).map((r) => [r.manual_item_id, r.purchase_price || 0])
  );
  const variantPriceMap = Object.fromEntries(
    (variantRes.data || []).map((r) => [r.variantid, r.products?.purchaseprice || 0])
  );

  const items = rawItems.map((i) => {
    const isManual = i.product_code?.startsWith("BCX");
    const cost_price = isManual
      ? (manualPriceMap[i.product_code] || 0)
      : (variantPriceMap[i.variantid] || 0);
    return { ...i, cost_price };
  });

  const normalizedBills = bills.map((b) => ({
    ...b,
    net_amount: b.net_amount != null ? b.net_amount : (b.payment_amount || 0),
  }));

  return { bills: normalizedBills, items };
}

export default function DashboardPage() {
  const [fyList, setFyList] = useState([]);
  const [filter, setFilter] = useState(null); // { startYear, fromIdx, toIdx }
  const [current, setCurrent] = useState(EMPTY);
  const [prior, setPrior] = useState(EMPTY);
  const [showComparison, setShowComparison] = useState(false);
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
        const [cur, pri] = await Promise.all([
          fetchPeriod(ranges.cur),
          showComparison ? fetchPeriod(ranges.prior) : Promise.resolve(EMPTY),
        ]);
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
  }, [ranges, showComparison]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Sales Dashboard</h1>
        {filter && (
          <DashboardFilters
            fyList={fyList.filter((f) => f.startYear >= filter.startYear)}
            value={filter}
            onChange={setFilter}
            showComparison={showComparison}
            onToggleComparison={() => setShowComparison((v) => !v)}
          />
        )}
      </div>

      <KpiCards current={current} prior={prior} loading={loading} showComparison={showComparison} />

      <div className="grid grid-cols-[2fr_1fr] gap-4">
        <RevenueChart current={current} prior={prior} range={filter ?? { startYear: 0, fromIdx: 0, toIdx: 11 }} loading={loading} showComparison={showComparison} />
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
