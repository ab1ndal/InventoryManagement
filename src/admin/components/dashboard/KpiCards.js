import React from "react";
import { formatINR } from "../../../utility/formatCurrency";
import { aggregateKpis, pctChange, badgeFor } from "../../../utility/dashboardData";

const toneClass = {
  good: "text-green-600 bg-green-50",
  bad: "text-red-600 bg-red-50",
  neutral: "text-gray-500 bg-gray-100",
};

function Badge({ change, inverse }) {
  const b = badgeFor(change, { inverse });
  const pct = change === null ? "" : ` ${Math.abs(change).toFixed(0)}%`;
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${toneClass[b.tone]}`}>
      {b.symbol}{pct}
    </span>
  );
}

function Card({ title, value, subtitle, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500">{title}</span>
        {children}
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
      {subtitle && <div className="mt-1 text-xs text-gray-400">{subtitle}</div>}
    </div>
  );
}

export default function KpiCards({ current, prior, loading }) {
  if (loading) {
    return <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">Loading KPIs…</div>;
  }
  const cur = aggregateKpis(current.bills, current.items);
  const pri = aggregateKpis(prior.bills, prior.items);
  const hasPrior = pri.billsCount > 0;
  const chg = (c, p) => (hasPrior ? pctChange(c, p) : null);

  return (
    <div className="grid grid-cols-6 gap-3">
      <Card title="Revenue" value={formatINR(cur.revenue)} subtitle="vs prior FY">
        <Badge change={chg(cur.revenue, pri.revenue)} />
      </Card>
      <Card title="Gross Margin %" value={`${cur.grossMargin.toFixed(1)}%`} subtitle="target 50–65%" />
      <Card title="Bills" value={cur.billsCount.toLocaleString("en-IN")} subtitle="vs prior FY">
        <Badge change={chg(cur.billsCount, pri.billsCount)} />
      </Card>
      <Card title="Avg Order Value" value={formatINR(cur.aov)} subtitle="revenue / bills" />
      <Card
        title="Discount Given"
        value={formatINR(cur.discountGiven)}
        subtitle={`${cur.discountPctOfGross.toFixed(1)}% of gross`}
      >
        <Badge change={chg(cur.discountGiven, pri.discountGiven)} inverse />
      </Card>
      <Card title="Profit" value={formatINR(cur.profit)} subtitle="vs prior FY">
        <Badge change={chg(cur.profit, pri.profit)} />
      </Card>
    </div>
  );
}
