import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/hooks/use-toast";
import { Input } from "../../../components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../../../components/ui/table";
import FamilyChips from "./FamilyChips";
import { buildFamilyIndex, toggleInArray } from "../../../utility/attributeFamilies";

// Assign filter families to fabric codes. Vocabulary is derived from the
// families already in use; a new family is introduced by typing it below.
export default function FabricsManager() {
  const { toast } = useToast();
  const [fabrics, setFabrics] = useState([]);   // {code, families}
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [newFamily, setNewFamily] = useState("");

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("fabrics")
      .select("code, families")
      .order("code");
    if (error) {
      toast({ variant: "destructive", title: "Load failed", description: error.message });
    } else {
      setFabrics(data);
    }
    setLoading(false);
  }

  const familyNames = useMemo(() => {
    const { orderedFamilies } = buildFamilyIndex(fabrics);
    return [...new Set([...orderedFamilies, ...(newFamily.trim() ? [newFamily.trim()] : [])])];
  }, [fabrics, newFamily]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fabrics.filter((f) => !q || f.code.toLowerCase().includes(q));
  }, [fabrics, search]);

  async function toggleFamily(code, fam) {
    const row = fabrics.find((f) => f.code === code);
    const prevFamilies = row.families || [];
    const next = toggleInArray(prevFamilies, fam);
    setFabrics((prev) => prev.map((f) => (f.code === code ? { ...f, families: next } : f)));
    const { error } = await supabase.from("fabrics").update({ families: next }).eq("code", code);
    if (error) {
      setFabrics((prev) => prev.map((f) => (f.code === code ? { ...f, families: prevFamilies } : f)));
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
      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fabrics…"
          className="max-w-xs"
        />
        <Input
          value={newFamily}
          onChange={(e) => setNewFamily(e.target.value)}
          placeholder="New family (then toggle it onto a fabric)…"
          className="max-w-xs"
        />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Fabric</TableHead>
              <TableHead>Families</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((f) => (
              <TableRow key={f.code}>
                <TableCell className="font-medium">{f.code}</TableCell>
                <TableCell>
                  <FamilyChips
                    families={familyNames}
                    selected={f.families || []}
                    onToggle={(fam) => toggleFamily(f.code, fam)}
                  />
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-gray-400 py-8">
                  No fabrics match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
