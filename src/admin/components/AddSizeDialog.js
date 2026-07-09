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

const SIZE_TYPES = [
  { value: "letter", label: "Adult — letter|chest (e.g. XL|42)" },
  { value: "waist", label: "Waist — pants (e.g. 38)" },
  { value: "kids", label: "Kids (e.g. 6 or 6|26)" },
  { value: "kids_letter", label: "Infant (e.g. M|0)" },
  { value: "special", label: "Special (e.g. FREE-SIZE)" },
];

// Deliberate two-step add-new flow for size codes (entry-controls plan §2.2.2):
// reached only via the explicit "+ Add …" action in the size combobox, and
// requires choosing a size type before the code becomes data.
export default function AddSizeDialog({
  open,
  initialCode,
  existingSizes = [],
  onClose,
  onAdded,
}) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [sizeType, setSizeType] = useState("");
  const [inches, setInches] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(initialCode || "");
      setSizeType("");
      setInches("");
    }
  }, [open, initialCode]);

  const handleAdd = async () => {
    const trimmed = code.trim();
    if (!trimmed || !sizeType) return;

    const existing = existingSizes.find(
      (s) => s.code.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      onAdded(existing.code);
      onClose();
      return;
    }

    // Place the new code at the end of its size_type block in sort order
    const sortOrder =
      Math.max(
        0,
        ...existingSizes
          .filter((s) => s.size_type === sizeType)
          .map((s) => s.sort_order)
      ) + 2;

    setSaving(true);
    const { error } = await supabase.from("sizes").insert({
      code: trimmed,
      label: sizeType === "waist" ? `${trimmed} (Waist)` : trimmed,
      size_type: sizeType,
      numeric_in: inches === "" ? null : Number(inches),
      sort_order: sortOrder,
    });
    setSaving(false);

    // 23505 = another admin added the same code concurrently — select theirs
    if (error && error.code !== "23505") {
      toast({
        variant: "destructive",
        title: "Could not add size",
        description: error.message,
      });
      return;
    }

    toast({ title: "Size added", description: `“${trimmed}” is now available.` });
    onAdded(trimmed);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add New Size</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Size code</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 8XL|56"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Size type</Label>
            <CustomDropdown
              value={sizeType}
              onChange={setSizeType}
              options={SIZE_TYPES}
              placeholder="Select type"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Inches (optional)</Label>
            <Input
              type="number"
              value={inches}
              onChange={(e) => setInches(e.target.value)}
              placeholder="Chest or waist inches, e.g. 56"
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
              disabled={saving || !code.trim() || !sizeType}
            >
              {saving ? "Adding…" : "Add Size"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
