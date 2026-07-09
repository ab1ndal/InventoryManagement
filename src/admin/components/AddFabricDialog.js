import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import CustomDropdown from "../../components/CustomDropdown";
import { supabase } from "../../lib/supabaseClient";
import { useToast } from "../../components/hooks/use-toast";

// Filter families ("Group Name") — the closed vocabulary the storefront filters
// on. A new fabric is a trade name (code) filed under one of these.
const FABRIC_FAMILIES = [
  "Cotton",
  "Silk",
  "Georgette",
  "Chiffon",
  "Net",
  "Crepe",
  "Velvet",
  "Wool/Suiting",
  "Chanderi",
  "Satin",
  "Synthetic",
  "Denim",
  "Shimmer/Party",
  "Others",
].map((f) => ({ value: f, label: f }));

// Deliberate two-step add-new flow for fabric codes (mirrors AddSizeDialog):
// reached only via the explicit "+ Add …" action in the fabric combobox, and
// requires choosing a family before the code becomes data.
export default function AddFabricDialog({
  open,
  initialCode,
  existingFabrics = [],
  onClose,
  onAdded,
}) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [family, setFamily] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(initialCode || "");
      setFamily("");
    }
  }, [open, initialCode]);

  const handleAdd = async () => {
    const trimmed = code.trim();
    if (!trimmed || !family) return;

    const existing = existingFabrics.find(
      (f) => f.code.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      onAdded(existing.code);
      onClose();
      return;
    }

    // Place the new code at the end of its family block in sort order
    const sortOrder =
      Math.max(
        0,
        ...existingFabrics
          .filter((f) => f.family === family)
          .map((f) => f.sort_order)
      ) + 1;

    setSaving(true);
    const { error } = await supabase.from("fabrics").insert({
      code: trimmed,
      family,
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

    toast({
      title: "Fabric added",
      description: `“${trimmed}” is now available.`,
    });
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
            <Label>Family (filter group)</Label>
            <CustomDropdown
              value={family}
              onChange={setFamily}
              options={FABRIC_FAMILIES}
              placeholder="Select family"
              className="mt-1"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={saving || !code.trim() || !family}
            >
              {saving ? "Adding…" : "Add Fabric"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
