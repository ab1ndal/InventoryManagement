// src/admin/pages/MockupOverlayPercentBars.js
import React, { useEffect, useState } from "react";
import Plot from "react-plotly.js";
import { supabase } from "../../lib/supabaseClient";

export default function MockupOverlayPercentBars() {
  const [statsByCat, setStatsByCat] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      setLoading(true);

      // Use new aggregate function (fast, single query)
      const { data, error } = await supabase.rpc("mockups_stats_all");
      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }

      // Keep only categories that actually have entries
      const filtered = (data || []).filter((d) => d.total_count > 0);

      setStatsByCat(filtered);
      setLoading(false);
    };

    loadStats();
  }, []);

  if (loading) return <div className="p-6">Loading…</div>;
  if (!statsByCat.length) return <div className="p-6">No stats found</div>;

  console.log(statsByCat);

  const categories = statsByCat.map((d) => String(d.category ?? "").trim());
  const totals = statsByCat.map((d) => d.total_count);
  const plotHeight = Math.max(700, categories.length * 24);

  const basePct = statsByCat.map((d) =>
    d.total_count ? (d.base_mockup_true / d.total_count) * 100 : 0
  );
  const filePct = statsByCat.map((d) =>
    d.total_count ? (d.file_mockup_true / d.total_count) * 100 : 0
  );
  const mockPct = statsByCat.map((d) =>
    d.total_count ? (d.mockup_true / d.total_count) * 100 : 0
  );

  const base = statsByCat.map((d) => d.base_mockup_true);
  const file = statsByCat.map((d) => d.file_mockup_true);
  const mock = statsByCat.map((d) => d.mockup_true);

  // Far-right totals
  const totalAnnotations = categories.map((cat, i) => ({
    x: 100,
    y: cat,
    text: `Total: ${totals[i]}`,
    showarrow: false,
    xanchor: "left",
    xshift: 8,
    font: { size: 12, color: "black" },
  }));

  // Chart 1 annotations (Base + File)
  const annotationsBaseFile = [
    ...totalAnnotations,
    ...statsByCat.flatMap((d, i) => {
      const arr = [];
      if (d.base_mockup_true > 0) {
        arr.push({
          x: basePct[i],
          y: categories[i],
          text: d.base_mockup_true.toString(),
          showarrow: false,
          font: { size: 11, color: "white" },
          xanchor: "right",
          xshift: -2,
        });
      }
      if (d.file_mockup_true > 0) {
        arr.push({
          x: filePct[i],
          y: categories[i],
          text: d.file_mockup_true.toString(),
          showarrow: false,
          font: { size: 11, color: "white" },
          xanchor: "right",
          xshift: -2,
        });
      }
      return arr;
    }),
  ];

  // Chart 2 annotations (Base + Mockup)
  const annotationsBaseMock = [
    ...totalAnnotations,
    ...statsByCat.flatMap((d, i) => {
      const arr = [];
      if (d.base_mockup_true > 0) {
        arr.push({
          x: basePct[i],
          y: categories[i],
          text: d.base_mockup_true.toString(),
          showarrow: false,
          font: { size: 11, color: "white" },
          xanchor: "right",
          xshift: -2,
        });
      }
      if (d.mockup_true > 0) {
        arr.push({
          x: mockPct[i],
          y: categories[i],
          text: d.mockup_true.toString(),
          showarrow: false,
          font: { size: 11, color: "white" },
          xanchor: "right",
          xshift: -2,
        });
      }
      return arr;
    }),
  ];

  const layoutCommon = {
    barmode: "overlay",
    xaxis: { title: "% of Total", range: [0, 100] },
    yaxis: {
      title: "Category",
      type: "category",
      categoryorder: "array",
      categoryarray: categories,
    },
    margin: { l: 180, b: 60, r: 140 },
    legend: {
      orientation: "h",
      yanchor: "top",
      y: -0.05,
      xanchor: "center",
      x: 0.5,
    },
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-6">Category Completion</h1>

      {/* Chart 1: Base vs Mockup */}
      <Plot
        key={`base-mockup-${categories.join("|")}`}
        data={[
          {
            type: "bar",
            orientation: "h",
            x: new Array(categories.length).fill(100),
            y: categories,
            name: "Total",
            marker: { color: "lightgray" },
            hoverinfo: "skip",
          },
          {
            type: "bar",
            orientation: "h",
            x: basePct,
            y: categories,
            name: "Base Mockup %",
            marker: { color: "orange" },
            hovertemplate:
              "Base Mockup: %{x:.1f}%<br>%{customdata} of %{text} total<extra></extra>",
            text: totals,
            customdata: base,
            textposition: "none",
          },
          {
            type: "bar",
            orientation: "h",
            x: mockPct,
            y: categories,
            name: "Mockup %",
            marker: { color: "green" },
            hovertemplate:
              "Mockup: %{x:.1f}%<br>%{customdata} of %{text} total<extra></extra>",
            text: totals,
            customdata: mock,
            textposition: "none",
          },
        ]}
        layout={{
          ...layoutCommon,
          annotations: annotationsBaseMock,
          title: "Base vs Mockup Completion",
        }}
        style={{ width: "100%", height: plotHeight }}
      />

      {/* Chart 2: Base vs File */}
      <Plot
        key={`base-file-${categories.join("|")}`}
        data={[
          {
            type: "bar",
            orientation: "h",
            x: new Array(categories.length).fill(100),
            y: categories,
            name: "Total",
            marker: { color: "lightgray" },
            hoverinfo: "skip",
          },
          {
            type: "bar",
            orientation: "h",
            x: basePct,
            y: categories,
            name: "Base Mockup %",
            marker: { color: "orange" },
            hovertemplate:
              "Base Mockup: %{x:.1f}%<br>%{customdata} of %{text} total<extra></extra>",
            text: totals, // denominator
            customdata: base, // numerator
            textposition: "none",
          },
          {
            type: "bar",
            orientation: "h",
            x: filePct,
            y: categories,
            name: "File Mockup %",
            marker: { color: "blue" },
            hovertemplate:
              "File Mockup: %{x:.1f}%<br>%{customdata} of %{text} total<extra></extra>",
            text: totals,
            customdata: file,
            textposition: "none",
          },
        ]}
        layout={{
          ...layoutCommon,
          annotations: annotationsBaseFile,
          title: "Base vs File Mockup Completion",
        }}
        style={{ width: "100%", height: plotHeight }}
      />
    </div>
  );
}
