import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/hooks/use-toast";
import { Input } from "../../../components/ui/input";
import CustomDropdown from "../../../components/CustomDropdown";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../../../components/ui/table";
import { SIZE_TYPES } from "../AddSizeDialog";

// Curate the size vocabulary: edit label, type, inches, sort order per code.
// Code is the FK-protected PK — read-only here; add new via AddSizeDialog.
export default function SizesManager() {
  const { toast } = useToast();
  const [sizes, setSizes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("sizes")
      .select("code, label, size_type, numeric_in, sort_order")
      .order("sort_order");
    if (error) {
      toast({ variant: "destructive", title: "Load failed", description: error.message });
    } else {
      setSizes(data);
    }
    setLoading(false);
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sizes.filter((s) => !q || s.code.toLowerCase().includes(q));
  }, [sizes, search]);

  // Optimistic patch of one field; revert both state and DB on error.
  async function patch(code, field, value) {
    const row = sizes.find((s) => s.code === code);
    const prevValue = row[field];
    setSizes((prev) => prev.map((s) => (s.code === code ? { ...s, [field]: value } : s)));
    const { error } = await supabase.from("sizes").update({ [field]: value }).eq("code", code);
    if (error) {
      setSizes((prev) => prev.map((s) => (s.code === code ? { ...s, [field]: prevValue } : s)));
      toast({ variant: "destructive", title: "Update failed", description: error.message });
    }
  }

  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-4 border-blue-600 border-opacity-50" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search sizes…"
        className="max-w-xs"
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Code</TableHead>
              <TableHead>Label</TableHead>
              <TableHead className="w-56">Type</TableHead>
              <TableHead className="w-24">Inches</TableHead>
              <TableHead className="w-24">Order</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((s) => (
              <TableRow key={s.code}>
                <TableCell className="font-medium">{s.code}</TableCell>
                <TableCell>
                  <Input
                    defaultValue={s.label}
                    onBlur={(e) => e.target.value !== s.label && patch(s.code, "label", e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <CustomDropdown
                    value={s.size_type}
                    onChange={(v) => v !== s.size_type && patch(s.code, "size_type", v)}
                    options={SIZE_TYPES}
                    placeholder="Type"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    defaultValue={s.numeric_in ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== s.numeric_in) patch(s.code, "numeric_in", v);
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    defaultValue={s.sort_order}
                    onBlur={(e) => {
                      // Ignore a cleared field so a blur can't silently set order to 0
                      if (e.target.value === "") {
                        e.target.value = s.sort_order;
                        return;
                      }
                      const v = Number(e.target.value);
                      if (v !== s.sort_order) patch(s.code, "sort_order", v);
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
