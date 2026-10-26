import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  RETURN_REASON_LABELS,
  localInputToIso,
  outsideReturnWindow,
  returnableUnits,
  toLocalInputValue,
  windowLabel,
} from "./orderHelpers";

const variantText = (it) => [it.size, it.color].filter(Boolean).join(" / ");

export default function OpenReturnDialog({ open, order, items, role, pending, onClose, onSubmit }) {
  const [reason, setReason] = useState("change_of_mind");
  const [contactedAt, setContactedAt] = useState(() => toLocalInputValue(new Date()));
  const [units, setUnits] = useState({});
  const [note, setNote] = useState("");
  const [awb, setAwb] = useState("");
  const [override, setOverride] = useState("");

  const rows = items
    .map((it) => ({ it, max: returnableUnits(it, order.returns) }))
    .filter((r) => r.max > 0);
  const chosen = rows.filter((r) => Number(units[r.it.id]) > 0);
  const contactedIso = localInputToIso(contactedAt);
  const outside = outsideReturnWindow(reason, order.delivered_at, contactedIso);
  const isSuper = role === "superadmin";

  const blocked =
    !contactedIso ||
    chosen.length === 0 ||
    !note.trim() ||
    (outside && (!isSuper || !override.trim()));

  const setUnit = (id, max, raw) => {
    const n = Math.min(max, Math.max(0, Math.floor(Number(raw) || 0)));
    setUnits((u) => ({ ...u, [id]: n }));
  };

  const submit = () => {
    const payload = {
      action: "return_open",
      orderId: order.id,
      reason,
      contactedAt: contactedIso,
      items: chosen.map((r) => ({ itemId: r.it.id, units: Number(units[r.it.id]) })),
      note: note.trim(),
    };
    if (awb.trim()) payload.returnAwb = awb.trim();
    if (outside) payload.overrideReason = override.trim();
    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle>Open return</DialogTitle>
          <DialogDescription>
            Record a customer return request. Damaged / wrong items need at least one photo before the
            return can be received or rejected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium">Reason</span>
            <select
              aria-label="Return reason"
              className="h-9 w-full rounded-md border border-input bg-white px-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {Object.entries(RETURN_REASON_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Contacted at</span>
            <input
              type="datetime-local"
              aria-label="Contacted at"
              className="h-9 w-full rounded-md border border-input bg-white px-2"
              value={contactedAt}
              onChange={(e) => setContactedAt(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              When the customer first got in touch. {windowLabel(reason, order.delivered_at, contactedIso)}
            </span>
          </label>
          {outside && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
              Outside the return window.{" "}
              {isSuper ? "Give a reason to override." : "Only a superadmin can open this return."}
            </p>
          )}
          <div>
            <span className="mb-1 block font-medium">Units to return</span>
            <ul className="space-y-1">
              {rows.map(({ it, max }) => (
                <li key={it.id} className="flex items-center justify-between gap-2">
                  <span>
                    {it.product_name}
                    {variantText(it) ? ` (${variantText(it)})` : ""}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={max}
                    aria-label={`Units of ${it.product_name}`}
                    className="h-8 w-16 rounded-md border border-input bg-white px-2 text-right"
                    value={units[it.id] ?? 0}
                    onChange={(e) => setUnit(it.id, max, e.target.value)}
                  />
                </li>
              ))}
            </ul>
          </div>
          <label className="block">
            <span className="mb-1 block font-medium">Note</span>
            <Textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Return AWB (optional)</span>
            <input
              className="h-9 w-full rounded-md border border-input bg-white px-2"
              value={awb}
              onChange={(e) => setAwb(e.target.value)}
            />
          </label>
          {outside && isSuper && (
            <label className="block">
              <span className="mb-1 block font-medium">Override reason</span>
              <Textarea
                aria-label="Override reason"
                value={override}
                onChange={(e) => setOverride(e.target.value)}
              />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Back
          </Button>
          <Button onClick={submit} disabled={pending || blocked}>
            {pending ? "Working…" : "Open return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
