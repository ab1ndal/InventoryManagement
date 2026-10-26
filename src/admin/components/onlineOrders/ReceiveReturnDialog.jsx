import { useEffect, useState } from "react";
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
import { action } from "./onlineOrdersApi";
import { formatRupees } from "./orderHelpers";

const variantText = (it) => [it.size, it.color].filter(Boolean).join(" / ");

const PREVIEW_DEBOUNCE_MS = 250;

export default function ReceiveReturnDialog({ open, ret, items, pending, error, onClose, onSubmit }) {
  const [lines, setLines] = useState(() =>
    Object.fromEntries(ret.items.map((ri) => [ri.item_id, { received: ri.units, restock: ri.units }]))
  );
  const [note, setNote] = useState("");
  // Tagged with the counts it was computed for, so a result for older counts reads as stale.
  const [result, setResult] = useState(null);

  const payloadItems = ret.items.map((ri) => ({
    itemId: ri.item_id,
    receivedUnits: lines[ri.item_id].received,
    restockUnits: lines[ri.item_id].restock,
  }));
  const expected = ret.items.reduce((s, ri) => s + ri.units, 0);
  const received = payloadItems.reduce((s, i) => s + i.receivedUnits, 0);
  const rejecting = received === 0;
  const key = JSON.stringify(payloadItems);

  useEffect(() => {
    if (!open || rejecting) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      action({ action: "return_preview", returnId: ret.id, items: JSON.parse(key) })
        .then((res) => {
          if (!cancelled) setResult({ key, preview: res.preview });
        })
        .catch((err) => {
          if (!cancelled) setResult({ key, error: err.message });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, rejecting, ret.id, key]);

  const set = (id, patch) =>
    setLines((l) => {
      const next = { ...l[id], ...patch };
      next.restock = Math.min(next.restock, next.received);
      return { ...l, [id]: next };
    });
  const toInt = (raw, max) => Math.min(max, Math.max(0, Math.floor(Number(raw) || 0)));

  const needsNote = received < expected;
  const confirmLabel = rejecting ? "Reject return" : "Receive and refund";
  const fresh = result?.key === key ? result : null;
  const preview = fresh?.preview;
  const previewError = fresh?.error;
  const ready = rejecting || preview;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle>Receive return</DialogTitle>
          <DialogDescription>
            Count what actually came back. Restock only pieces fit to resell. Receiving none rejects the
            return.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <ul className="space-y-2">
            {ret.items.map((ri) => {
              const it = items.find((x) => x.id === ri.item_id) || { product_name: "Item" };
              const l = lines[ri.item_id];
              return (
                <li key={ri.item_id} className="rounded border p-2">
                  <div className="font-medium">
                    {it.product_name}
                    {variantText(it) ? ` (${variantText(it)})` : ""} · expected {ri.units}
                  </div>
                  <div className="mt-1 flex gap-4">
                    <label className="flex items-center gap-2">
                      Received
                      <input
                        type="number"
                        min={0}
                        max={ri.units}
                        aria-label={`Received units of ${it.product_name}`}
                        className="h-8 w-16 rounded-md border border-input bg-white px-2 text-right"
                        value={l.received}
                        onChange={(e) => set(ri.item_id, { received: toInt(e.target.value, ri.units) })}
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      Restock
                      <input
                        type="number"
                        min={0}
                        max={l.received}
                        aria-label={`Restock units of ${it.product_name}`}
                        className="h-8 w-16 rounded-md border border-input bg-white px-2 text-right"
                        value={l.restock}
                        onChange={(e) => set(ri.item_id, { restock: toInt(e.target.value, l.received) })}
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>

          {rejecting ? (
            <p className="rounded-md border bg-muted p-2">No refund: nothing was received.</p>
          ) : previewError ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800">{previewError}</p>
          ) : preview ? (
            <dl className="space-y-0.5 rounded-md border bg-muted p-2" data-testid="receive-preview">
              <div className="flex justify-between">
                <dt>Store credit</dt>
                <dd>{formatRupees(preview.credit_part)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Original payment method</dt>
                <dd>{formatRupees(preview.gateway_part)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Shipping</dt>
                <dd>{formatRupees(preview.shipping)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Refund total</dt>
                <dd>{formatRupees(preview.total)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted-foreground">Calculating refund…</p>
          )}

          <label className="block">
            <span className="mb-1 block font-medium">
              Note {needsNote ? "(required: fewer pieces than expected)" : "(optional)"}
            </span>
            <Textarea aria-label="Receive note" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Back
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                action: "return_receive",
                returnId: ret.id,
                items: payloadItems,
                ...(note.trim() ? { note: note.trim() } : {}),
              })
            }
            disabled={pending || !ready || (needsNote && !note.trim())}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
