import React from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-basic-dist-min";
import { aggregateMonthlySeries, fyLabel } from "../../../utility/dashboardData";

const Plot = createPlotlyComponent(Plotly);
const toLakhs = (v) => v / 100000;

export default function RevenueChart({ current, prior, range, loading, showComparison }) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">
        Loading chart…
      </div>
    );
  }

  if (!current || !range) return null;

  const priorYear = range.startYear - 1;
  const curSeries = aggregateMonthlySeries(current.bills, current.items, range.startYear);
  const priSeries = showComparison ? aggregateMonthlySeries((prior || { bills: [], items: [] }).bills, (prior || { bills: [], items: [] }).items, priorYear) : [];
  const months = curSeries.map((s) => s.label);

  const REV_DTICK = 0.5;
  const MAR_DTICK = 5;
  const allRevenues = [
    ...curSeries.map((s) => toLakhs(s.revenue)),
    ...(showComparison ? priSeries.map((s) => toLakhs(s.revenue)) : []),
  ];
  const revMax = Math.ceil(Math.max(...allRevenues, 0) / REV_DTICK) * REV_DTICK;
  const marMax = Math.ceil(Math.max(...curSeries.map((s) => s.margin), 0) / MAR_DTICK) * MAR_DTICK;

  const data = [
    ...(showComparison ? [{
      type: "bar",
      name: fyLabel(priorYear),
      x: months,
      y: priSeries.map((s) => toLakhs(s.revenue)),
      marker: { color: "#bfdbfe" },
    }] : []),
    {
      type: "bar",
      name: fyLabel(range.startYear),
      x: months,
      y: curSeries.map((s) => toLakhs(s.revenue)),
      marker: { color: "#0066cc" },
    },
    {
      type: "scatter",
      mode: "lines+markers",
      name: "Margin %",
      x: months,
      y: curSeries.map((s) => s.margin),
      yaxis: "y2",
      line: { color: "#f59e0b", width: 2 },
      marker: { color: "#f59e0b", size: 5 },
    },
  ];

  const layout = {
    barmode: "group",
    height: 240,
    margin: { t: 10, r: 44, b: 30, l: 40 },
    yaxis: {
      title: { text: "₹ (lakhs)", standoff: 4 },
      zeroline: true,
      zerolinecolor: "#e5e7eb",
      range: [0, revMax],
      dtick: REV_DTICK,
      tickmode: "linear",
      tickfont: { size: 11 },
    },
    yaxis2: {
      title: "",
      overlaying: "y",
      side: "right",
      showgrid: false,
      zeroline: true,
      zerolinecolor: "#e5e7eb",
      range: [0, marMax],
      dtick: MAR_DTICK,
      tickmode: "linear",
      ticksuffix: "%",
      tickfont: { size: 11 },
      anchor: "x",
    },
    xaxis: { fixedrange: true },
    legend: { orientation: "h", y: 1.15 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Monthly Revenue &amp; Margin</h3>
      <Plot
        data={data}
        layout={layout}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%" }}
      />
    </div>
  );
}
