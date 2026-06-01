import React from "react";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../components/ui/select";
import { FY_MONTHS } from "../../../utility/dashboardData";

export default function DashboardFilters({ fyList, value, onChange }) {
  const { startYear, fromIdx, toIdx } = value;

  const setFy = (sy) => {
    const y = Number(sy);
    onChange({ startYear: y, fromIdx: 0, toIdx: 11 }); // reset to full FY on year switch
  };
  const setFrom = (i) => {
    const f = Number(i);
    onChange({ ...value, fromIdx: f, toIdx: Math.max(f, toIdx) });
  };
  const setTo = (i) => {
    const t = Number(i);
    onChange({ ...value, toIdx: t, fromIdx: Math.min(fromIdx, t) });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tabs value={String(startYear)} onValueChange={setFy}>
        <TabsList>
          {fyList.map((fy) => (
            <TabsTrigger key={fy.startYear} value={String(fy.startYear)}>
              {fy.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-2">
        <Select value={String(fromIdx)} onValueChange={setFrom}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="From month" /></SelectTrigger>
          <SelectContent>
            {FY_MONTHS.map((m, i) => (
              <SelectItem key={m.label} value={String(i)}>From: {m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-gray-400">→</span>
        <Select value={String(toIdx)} onValueChange={setTo}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="To month" /></SelectTrigger>
          <SelectContent>
            {FY_MONTHS.map((m, i) => (
              <SelectItem key={m.label} value={String(i)}>To: {m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
