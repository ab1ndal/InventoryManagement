import React, { useEffect, useMemo, useState } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-basic-dist-min";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../../components/ui/tabs";
import { supabase } from "../../../lib/supabaseClient";
import { toast } from "sonner";
import {
  buildFyTotals,
  buildSeasonalSeries,
  buildVsHistoryComparison,
  fyLabel,
  getFinancialYearStart,
} from "../../../utility/dashboardData";

const Plot = createPlotlyComponent(Plotly);
const toLakhs = (v) => v / 100000;
const PAGE = 1000;
const MONTH_LABELS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
const CURRENT_FY_YEAR = getFinancialYearStart(new Date());

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

const BASE_LAYOUT = {
  height: 260,
  margin: { t: 10, r: 20, b: 30, l: 56 },
  yaxis: {
    title: { text: "₹ Lakhs", standoff: 8 },
    zeroline: true,
    zerolinecolor: "#e5e7eb",
    tickformat: ".2~f",
    ticksuffix: "L",
    autorange: true,
    rangemode: "tozero",
    tickfont: { size: 11 },
  },
  xaxis: { fixedrange: true },
  legend: { orientation: "h", y: 1.18 },
  paper_bgcolor: "white",
  plot_bgcolor: "white",
};

export default function HistoricalTrends() {
  const [tab, setTab] = useState("trend");
  const [histRows, setHistRows] = useState([]);
  const [liveBills, setLiveBills] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fyStart = `${CURRENT_FY_YEAR}-04-01T00:00:00`;
    (async () => {
      try {
        const [histRes, billsData] = await Promise.all([
          supabase.from("monthly_sales_history").select("fy_start_year, month_idx, net_amount"),
          fetchAllRows(() =>
            supabase
              .from("bills")
              .select("net_amount, orderdate")
              .eq("finalized", true)
              .gte("orderdate", fyStart)
          ),
        ]);
        if (histRes.error) throw histRes.error;
        setHistRows(histRes.data || []);
        setLiveBills(billsData);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load historical data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fyTotals = useMemo(
    () => buildFyTotals(histRows, liveBills, CURRENT_FY_YEAR),
    [histRows, liveBills]
  );
  const seasonalSeries = useMemo(
    () => buildSeasonalSeries(histRows, liveBills, CURRENT_FY_YEAR),
    [histRows, liveBills]
  );
  const vsHistory = useMemo(
    () => buildVsHistoryComparison(histRows, liveBills, CURRENT_FY_YEAR),
    [histRows, liveBills]
  );

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">
        Loading historical trends…
      </div>
    );
  }

  const hasHistData = histRows.length > 0;
  const histFys = fyTotals.filter((f) => !f.isLive);
  const liveFy = fyTotals.filter((f) => f.isLive);

  const trendData = [
    {
      type: "bar",
      name: "Historical FYs",
      x: histFys.map((f) => f.label),
      y: histFys.map((f) => (f.total !== null ? toLakhs(f.total) : null)),
      marker: { color: "#93c5fd" },
    },
    {
      type: "bar",
      name: "FY 26-27 (YTD)",
      x: liveFy.map((f) => f.label),
      y: liveFy.map((f) => (f.total !== null ? toLakhs(f.total) : null)),
      marker: { color: "#0066cc", opacity: 0.75 },
    },
  ];

  const seasonalData = seasonalSeries.map((s) => {
    const isCurrentFy = s.label === fyLabel(CURRENT_FY_YEAR);
    return {
      type: "scatter",
      mode: "lines+markers",
      name: s.label,
      x: MONTH_LABELS,
      y: s.values.map((v) => (v !== null ? toLakhs(v) : null)),
      connectgaps: false,
      line: { color: isCurrentFy ? "#0066cc" : "#d1d5db", width: isCurrentFy ? 2.5 : 1 },
      marker: { color: isCurrentFy ? "#0066cc" : "#d1d5db", size: isCurrentFy ? 5 : 3 },
      opacity: isCurrentFy ? 1 : 0.6,
    };
  });

  const vsData = [
    {
      type: "bar",
      name: "FY26 Actual",
      x: MONTH_LABELS,
      y: vsHistory.currentFy.map((v) => (v !== null ? toLakhs(v) : null)),
      marker: { color: "#0066cc" },
    },
    {
      type: "scatter",
      mode: "lines",
      name: "Historical Avg",
      x: MONTH_LABELS,
      y: vsHistory.historicalAvg.map((v) => (v !== null ? toLakhs(v) : null)),
      line: { color: "#f59e0b", dash: "dash", width: 2 },
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Historical Trends</h3>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="trend">FY Trend</TabsTrigger>
          <TabsTrigger value="seasonal">Seasonality</TabsTrigger>
          <TabsTrigger value="vs-history">vs History</TabsTrigger>
        </TabsList>
        <TabsContent value="trend">
          <Plot
            data={trendData}
            layout={{ ...BASE_LAYOUT, barmode: "overlay" }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </TabsContent>
        <TabsContent value="seasonal">
          <Plot
            data={seasonalData}
            layout={BASE_LAYOUT}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </TabsContent>
        <TabsContent value="vs-history">
          {!hasHistData && (
            <p className="text-xs text-gray-400 mb-2">
              No prior-year data in <code>monthly_sales_history</code> — historical average unavailable.
            </p>
          )}
          <Plot
            data={vsData}
            layout={BASE_LAYOUT}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
