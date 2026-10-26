import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { action } from "./onlineOrdersApi";
import OpenReturnDialog from "./OpenReturnDialog";
import ReceiveReturnDialog from "./ReceiveReturnDialog";
import { RETURN_REASON_LABELS, formatDateTime, returnableUnits, windowLabel } from "./orderHelpers";

const BUSY_MESSAGE = "Another staff member is working on this order";
const PHOTO_TYPES = "image/jpeg,image/png,image/webp,image/heic,image/heif";
const STATUS_TEXT = { open: "Open", refunded: "Refunded", rejected: "Rejected", cancelled: "Cancelled" };

const HEIC_TYPES = { heic: "image/heic", heif: "image/heif" };
// Some browsers leave file.type empty for HEIC; the server needs a content type.
const photoContentType = (file) =>
  file.type || HEIC_TYPES[file.name.split(".").pop().toLowerCase()] || file.type;

const variantText = (it) => [it.size, it.color].filter(Boolean).join(" / ");

export default function ReturnsSection({ order, items, role, onChanged }) {
  const returns = order.returns || [];
  const [dialog, setDialog] = useState(null); // { kind: 'open' } | { kind: 'receive'|'cancel', ret }
  const [pending, setPending] = useState(false);
  const [cancelNote, setCancelNote] = useState("");
  const [dialogError, setDialogError] = useState(null);
  const fileRef = useRef({});

  const delivered = order.status === "delivered";
  const anyReturnable = items.some((it) => returnableUnits(it, returns) > 0);
  if (!delivered && returns.length === 0) return null;

  const close = () => {
    setDialog(null);
    setCancelNote("");
    setDialogError(null);
  };

  // Runs one admin-order-action call; refreshes the order on success and after a refusal. The server
  // reports every refusal as bad_state, so the dialog stays open with the message and the typed input.
  const run = async (payload, successMessage) => {
    setPending(true);
    setDialogError(null);
    try {
      const res = await action(payload);
      toast.success(successMessage);
      close();
      await onChanged?.();
      return res;
    } catch (err) {
      if (err.code === "busy") {
        toast.error(BUSY_MESSAGE);
      } else if (err.code === "bad_state") {
        setDialogError(err.message);
        await onChanged?.();
      } else {
        toast.error("Action failed", { description: err.message });
      }
      return null;
    } finally {
      setPending(false);
    }
  };

  const addPhotos = async (ret, files) => {
    if (!files.length) return;
    setPending(true);
    try {
      for (const file of files) {
        const { uploadUrl, path } = await action({
          action: "return_photo_url",
          returnId: ret.id,
          contentType: photoContentType(file),
        });
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": photoContentType(file) },
          body: file,
        });
        if (!put.ok) throw new Error(`Upload of ${file.name} failed (${put.status})`);
        await action({ action: "return_photo_add", returnId: ret.id, path });
      }
      toast.success(files.length === 1 ? "Photo added" : "Photos added");
    } catch (err) {
      toast.error(err.code === "busy" ? BUSY_MESSAGE : "Photo upload failed", {
        description: err.code === "busy" ? undefined : err.message,
      });
    } finally {
      setPending(false);
      if (fileRef.current[ret.id]) fileRef.current[ret.id].value = "";
      await onChanged?.();
    }
  };

  const viewPhoto = async (photo) => {
    // Opened before the await so Safari treats it as a click-initiated popup.
    const win = window.open("", "_blank");
    try {
      const { url } = await action({ action: "return_photo_view", photoId: photo.id });
      if (win) {
        win.opener = null;
        win.location = url;
      }
    } catch (err) {
      win?.close();
      toast.error("Could not open photo", { description: err.message });
    }
  };

  return (
    <section className="text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-medium">Returns</h4>
        {delivered && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !anyReturnable}
            onClick={() => setDialog({ kind: "open" })}
          >
            Open return…
          </Button>
        )}
      </div>
      {returns.length === 0 && <p className="text-muted-foreground">No returns.</p>}
      <ul className="space-y-3">
        {returns.map((r) => {
          const isOpen = r.status === "open";
          const needsPhoto = r.reason === "damaged_wrong" && r.photos.length === 0;
          return (
            <li key={r.id} className="space-y-2 rounded border p-3" data-testid={`return-${r.id}`}>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">
                  {RETURN_REASON_LABELS[r.reason] || r.reason} ·{" "}
                  {windowLabel(r.reason, order.delivered_at, r.contacted_at)}
                </span>
                <span className="font-medium">{STATUS_TEXT[r.status] || r.status}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Contacted {formatDateTime(r.contacted_at)}
                {r.return_awb ? ` · AWB ${r.return_awb}` : ""}
                {r.override_reason ? ` · Window override: ${r.override_reason}` : ""}
              </div>
              <p>{r.note}</p>
              <ul className="space-y-0.5">
                {r.items.map((ri) => {
                  const it = items.find((x) => x.id === ri.item_id);
                  return (
                    <li key={ri.item_id}>
                      {ri.units} × {it?.product_name || "Item"}
                      {it && variantText(it) ? ` (${variantText(it)})` : ""}
                      {ri.received_units !== null && ri.received_units !== undefined
                        ? ` — received ${ri.received_units}, restocked ${ri.restock_units ?? 0}`
                        : ""}
                    </li>
                  );
                })}
              </ul>
              {r.receive_note && <p className="text-xs text-muted-foreground">Receive note: {r.receive_note}</p>}
              {r.photos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {r.photos.map((p, i) => (
                    <Button key={p.id} size="sm" variant="secondary" onClick={() => viewPhoto(p)}>
                      View photo {i + 1}
                    </Button>
                  ))}
                </div>
              )}
              {isOpen && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs">
                    <span className="sr-only">Add photos</span>
                    <input
                      type="file"
                      multiple
                      accept={PHOTO_TYPES}
                      aria-label="Add photos"
                      disabled={pending}
                      ref={(el) => {
                        fileRef.current[r.id] = el;
                      }}
                      onChange={(e) => addPhotos(r, Array.from(e.target.files || []))}
                    />
                  </label>
                  <Button
                    size="sm"
                    disabled={pending || needsPhoto}
                    onClick={() => setDialog({ kind: "receive", ret: r })}
                  >
                    Receive…
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setDialog({ kind: "cancel", ret: r })}
                  >
                    Cancel return…
                  </Button>
                  {needsPhoto && (
                    <span className="text-xs text-amber-800">
                      Damaged / wrong needs at least one photo before it can be received or rejected.
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {dialog?.kind === "open" && (
        <OpenReturnDialog
          open
          order={order}
          items={items}
          role={role}
          pending={pending}
          error={dialogError}
          onClose={close}
          onSubmit={(payload) => run(payload, "Return opened")}
        />
      )}
      {dialog?.kind === "receive" && (
        <ReceiveReturnDialog
          open
          ret={dialog.ret}
          items={items}
          pending={pending}
          error={dialogError}
          onClose={close}
          onSubmit={(payload) => run(payload, "Return processed")}
        />
      )}
      <Dialog open={dialog?.kind === "cancel"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-lg bg-white">
          <DialogHeader>
            <DialogTitle>Cancel return?</DialogTitle>
          </DialogHeader>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Note (required)</span>
            <Textarea
              aria-label="Cancel note"
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
            />
          </label>
          {dialogError && (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">{dialogError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={pending}>
              Back
            </Button>
            <Button
              disabled={pending || !cancelNote.trim()}
              onClick={() =>
                run({ action: "return_cancel", returnId: dialog.ret.id, note: cancelNote.trim() }, "Return cancelled")
              }
            >
              Cancel return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
