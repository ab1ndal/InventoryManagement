import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import FamilyChips from "./attributes/FamilyChips";
import { supabase } from "../../lib/supabaseClient";
import { useToast } from "../../components/hooks/use-toast";
import { buildFamilyIndex, toggleInArray } from "../../utility/attributeFamilies";

// Deliberate add-new flow for fabric codes (mirrors AddSizeDialog). A fabric is
// a trade name (code) filed under one or more filter families ("Group Name").
// The family vocabulary is derived from existing fabrics; a brand-new family can
// be introduced by typing it below.
export default function AddFabricDialog({
  open,
  initialCode,
  existingFabrics = [],
  onClose,
  onAdded,
}) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [families, setFamilies] = useState([]);
  const [newFamily, setNewFamily] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(initialCode || "");
      setFamilies([]);
      setNewFamily("");
    }
  }, [open, initialCode]);

  const familyOptions = useMemo(() => {
    const { orderedFamilies } = buildFamilyIndex(existingFabrics);
    // Include any just-typed family so its chip shows as selected.
    return [...new Set([...orderedFamilies, ...families])];
  }, [existingFabrics, families]);

  const addTypedFamily = () => {
    const f = newFamily.trim();
    if (!f) return;
    setFamilies((prev) => (prev.includes(f) ? prev : [...prev, f]));
    setNewFamily("");
  };

  const handleAdd = async () => {
    const trimmed = code.trim();
    if (!trimmed || families.length === 0) return;

    const existing = existingFabrics.find(
      (f) => f.code.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      onAdded(existing.code);
      onClose();
      return;
    }

    // Place the new code after the current max sort_order (order is secondary
    // now that families drive the storefront grouping).
    const sortOrder =
      Math.max(0, ...existingFabrics.map((f) => f.sort_order || 0)) + 1;

    setSaving(true);
    const { error } = await supabase.from("fabrics").insert({
      code: trimmed,
      families,
      sort_order: sortOrder,
    });
    setSaving(false);

    // 23505 = another admin added the same code concurrently — select theirs
    if (error && error.code !== "23505") {
      toast({
        variant: "destructive",
        title: "Could not add fabric",
        description: error.message,
      });
      return;
    }

    toast({ title: "Fabric added", description: `“${trimmed}” is now available.` });
    onAdded(trimmed);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add New Fabric</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Fabric name</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. Organza Silk"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Families (filter groups)</Label>
            <div className="mt-1.5">
              <FamilyChips
                families={familyOptions}
                selected={families}
                onToggle={(f) => setFamilies((prev) => toggleInArray(prev, f))}
              />
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                value={newFamily}
                onChange={(e) => setNewFamily(e.target.value)}
                placeholder="New family…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTypedFamily();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addTypedFamily}>
                Add
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={saving || !code.trim() || families.length === 0}
            >
              {saving ? "Adding…" : "Add Fabric"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
