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
import { supabase } from "../../lib/supabaseClient";
import { useToast } from "../../components/hooks/use-toast";

// Deliberate add-new flow for color codes (mirrors AddSizeDialog / AddFabricDialog).
// Product edit only captures the color NAME; family (filter group) assignment is
// handled separately in the color-family manager, so a new color starts with no
// families and gets bucketed there.
export default function AddColorDialog({
  open,
  initialCode,
  existingColors = [],
  onClose,
  onAdded, // (newCode) => void
}) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setCode(initialCode || "");
  }, [open, initialCode]);

  const handleAdd = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;

    const existing = existingColors.find(
      (c) => c.code.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      onAdded(existing.code);
      onClose();
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("colors").insert({ code: trimmed });
    setSaving(false);

    // 23505 = another admin added the same code concurrently — select theirs
    if (error && error.code !== "23505") {
      toast({
        variant: "destructive",
        title: "Could not add color",
        description: error.message,
      });
      return;
    }

    toast({ title: "Color added", description: `“${trimmed}” is now available.` });
    onAdded(trimmed);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add New Color</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Color name</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. Firozi"
              className="mt-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Assign a filter family later in the color-family manager.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={saving || !code.trim()}
            >
              {saving ? "Adding…" : "Add Color"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
