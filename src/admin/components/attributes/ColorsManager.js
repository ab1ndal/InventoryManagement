import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/hooks/use-toast";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../../../components/ui/table";
import FamilyChips from "./FamilyChips";
import { toggleInArray } from "../../../utility/attributeFamilies";

// Assign filter families to color codes + curate the color_families vocabulary.
// New colors (added via AddColorDialog) arrive with empty families[] and are
// invisible to the storefront filter until bucketed here.
export default function ColorsManager() {
  const { toast } = useToast();
  const [colors, setColors] = useState([]);      // {code, families}
  const [families, setFamilies] = useState([]);   // {family, hex, sort_order}
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [newFamily, setNewFamily] = useState("");
  const [newHex, setNewHex] = useState("#888888");

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const [c, f] = await Promise.all([
      supabase.from("colors").select("code, families").order("code"),
      supabase.from("color_families").select("family, hex, sort_order").order("sort_order"),
    ]);
    if (c.error || f.error) {
      toast({ variant: "destructive", title: "Load failed", description: (c.error || f.error).message });
    } else {
      setColors(c.data); setFamilies(f.data);
    }
    setLoading(false);
  }

  const familyNames = useMemo(() => families.map((f) => f.family), [families]);
  const hexMap = useMemo(
    () => Object.fromEntries(families.map((f) => [f.family, f.hex])),
    [families]
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return colors.filter((c) => {
      if (unassignedOnly && (c.families?.length ?? 0) > 0) return false;
      if (q && !c.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [colors, search, unassignedOnly]);

  const unassignedCount = useMemo(
    () => colors.filter((c) => (c.families?.length ?? 0) === 0).length,
    [colors]
  );

  async function toggleFamily(code, fam) {
    const row = colors.find((c) => c.code === code);
    const prevFamilies = row.families || [];
    const next = toggleInArray(prevFamilies, fam);
    setColors((prev) => prev.map((c) => (c.code === code ? { ...c, families: next } : c)));
    const { error } = await supabase.from("colors").update({ families: next }).eq("code", code);
    if (error) {
      setColors((prev) => prev.map((c) => (c.code === code ? { ...c, families: prevFamilies } : c)));
      toast({ variant: "destructive", title: "Update failed", description: error.message });
    }
  }

  async function updateHex(family, hex) {
    setFamilies((prev) => prev.map((f) => (f.family === family ? { ...f, hex } : f)));
    const { error } = await supabase.from("color_families").update({ hex }).eq("family", family);
    if (error) toast({ variant: "destructive", title: "Hex update failed", description: error.message });
  }

  async function addFamily() {
    const name = newFamily.trim();
    if (!name) return;
    const sort = Math.max(0, ...families.map((f) => f.sort_order || 0)) + 10;
    const { error } = await supabase
      .from("color_families")
      .insert({ family: name, hex: newHex, sort_order: sort });
    if (error) {
      toast({ variant: "destructive", title: "Could not add family", description: error.message });
      return;
    }
    setNewFamily("");
    toast({ title: "Family added", description: `“${name}” is now a filter group.` });
    load();
  }

  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-4 border-blue-600 border-opacity-50" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Families vocabulary */}
      <div className="rounded-md border p-4">
        <h3 className="text-sm font-semibold mb-3">Color families (swatch hex + order)</h3>
        <div className="flex flex-wrap gap-3">
          {families.map((f) => (
            <div key={f.family} className="flex items-center gap-2 text-sm">
              <input
                type="color"
                value={f.hex || "#000000"}
                onChange={(e) => updateHex(f.family, e.target.value)}
                className="h-6 w-6 rounded border p-0"
                title={`Edit ${f.family} hex`}
              />
              <span>{f.family}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input
            type="color"
            value={newHex}
            onChange={(e) => setNewHex(e.target.value)}
            className="h-8 w-8 rounded border p-0"
          />
          <Input
            value={newFamily}
            onChange={(e) => setNewFamily(e.target.value)}
            placeholder="New family name…"
            className="max-w-xs"
          />
          <Button type="button" variant="outline" onClick={addFamily}>Add family</Button>
        </div>
      </div>

      {/* Codes */}
      <div className="flex items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search colors…"
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(e) => setUnassignedOnly(e.target.checked)}
          />
          Show unassigned only
          <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
            {unassignedCount}
          </span>
        </label>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Color</TableHead>
              <TableHead>Families</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((c) => (
              <TableRow key={c.code}>
                <TableCell className="font-medium">{c.code}</TableCell>
                <TableCell>
                  <FamilyChips
                    families={familyNames}
                    selected={c.families || []}
                    onToggle={(fam) => toggleFamily(c.code, fam)}
                    hexMap={hexMap}
                  />
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-gray-400 py-8">
                  No colors match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
