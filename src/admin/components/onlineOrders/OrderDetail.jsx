import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Check } from "lucide-react";
import { toast } from "sonner";
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
import { action, getMyRole, getOrder, newOpKey } from "./onlineOrdersApi";
import { ReturnBadge, StatusBadge } from "./OrderList";
import ReturnsSection from "./ReturnsSection";
import {
  formatDateTime,
  formatRupees,
  localInputToIso,
  processRefundPreview,
  toLocalInputValue,
} from "./orderHelpers";

const BUSY_MESSAGE = "Another staff member is working on this order";
const RELEASE_MESSAGE =
  "Releases this order without cancelling the courier booking. Use only if the booking was not cancelled.";

function ConfirmDialog({ open, title, description, confirmLabel, confirmDisabled, pending, onConfirm, onClose, children }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Back
          </Button>
          <Button onClick={onConfirm} disabled={pending || confirmDisabled}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoneyRow({ label, value, negative, strong }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd>
        {negative && Number(value) > 0 ? "−" : ""}
        {formatRupees(value)}
      </dd>
    </div>
  );
}

function addressText(a) {
  if (!a) return "";
  return [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", ");
}

function variantText(it) {
  return [it.size, it.color].filter(Boolean).join(" / ");
}

export default function OrderDetail({ orderId, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [avail, setAvail] = useState({});
  const [checked, setChecked] = useState(() => new Set());
  const [savingLine, setSavingLine] = useState(null);
  const [dialog, setDialog] = useState(null); // 'process' | 'cancel' | 'rto' | 'sendback' | 'rebook' | 'release' | 'delivered'
  const [pending, setPending] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [courierError, setCourierError] = useState(null);
  const [role, setRole] = useState(null);
  const [parcelLost, setParcelLost] = useState(false);
  const [rebookNote, setRebookNote] = useState("");
  const [deliveredAt, setDeliveredAt] = useState("");
  const [deliveredReason, setDeliveredReason] = useState("");
  // Courier cancel failure inside a send-back/rebook dialog; the dialog stays open so the
  // same op key can be resumed (retry, or superadmin manual-cancel confirmation).
  const [dialogProblem, setDialogProblem] = useState(null);
  const [deliveredError, setDeliveredError] = useState(null);
  // release_op target {key, label}: key is the open send-back/rebook dialog's key, or a new one.
  const [release, setRelease] = useState(null);
  // One op key per Process/Cancel click; reused if that click's request is retried.
  const opRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await getOrder(orderId);
      setDetail(d);
      const a = {};
      const c = new Set();
      for (const it of d.items) {
        a[it.id] = it.available_qty ?? it.stock_taken;
        if (it.available_qty !== null && it.available_qty !== undefined) c.add(it.id);
        if (it.stock_taken === 0) c.add(it.id); // nothing on the shelf to check
      }
      setAvail(a);
      setChecked(c);
    } catch (err) {
      toast.error("Could not load order", { description: err.message });
    }
  }, [orderId]);

  useEffect(() => {
    setDetail(null);
    setCourierError(null);
    opRef.current = null;
    load();
  }, [load]);

  useEffect(() => {
    getMyRole()
      .then(setRole)
      .catch(() => setRole(null)); // role only gates the superadmin button; the server enforces it
  }, []);

  const opKeyFor = (kind) => {
    if (opRef.current?.kind !== kind) opRef.current = { kind, key: newOpKey() };
    return opRef.current.key;
  };

  const closeDialog = () => {
    setDialog(null);
    setCancelReason("");
    setParcelLost(false);
    setRebookNote("");
    setDeliveredReason("");
    setDialogProblem(null);
    setDeliveredError(null);
    opRef.current = null;
  };

  // send_back / rebook: opKey is created when the dialog opens and kept until it closes.
  const openBackDialog = (kind) => {
    opRef.current = { kind, key: newOpKey() };
    setDialog(kind);
  };

  // Captures the key before closeDialog clears opRef, so a dialog's own claim can be released.
  const openRelease = (key, label) => {
    closeDialog();
    setRelease({ key, label });
    setDialog("release");
  };

  const runBack = async (payload, successMessage) => {
    setPending(true);
    try {
      await action(payload);
      toast.success(successMessage);
      closeDialog();
      await load();
      onChanged?.();
    } catch (err) {
      if (err.code === "busy") {
        toast.error(BUSY_MESSAGE);
      } else if (err.code === "courier_error") {
        setDialogProblem(err.message);
        toast.error("Courier error", { description: err.message });
      } else if (err.code === "bad_state") {
        toast.error("This order has changed", { description: err.message });
        closeDialog();
        await load();
        onChanged?.();
      } else {
        toast.error("Action failed", { description: err.message });
      }
    } finally {
      setPending(false);
    }
  };

  // Runs one admin-order-action call. Returns true on success.
  const run = async (payload, successMessage) => {
    setPending(true);
    setDeliveredError(null);
    try {
      await action(payload);
      toast.success(successMessage);
      setCourierError(null);
      closeDialog();
      await load();
      onChanged?.();
      return true;
    } catch (err) {
      if (err.code === "busy") {
        toast.error(BUSY_MESSAGE);
      } else if (err.code === "courier_error") {
        setCourierError(err.message);
        toast.error("Courier error", { description: err.message });
        closeDialog();
        await load();
        onChanged?.();
      } else if (err.code === "bad_state" && payload.action === "mark_delivered") {
        // Refusals of the date/reason come back as bad_state too; keep the typed values.
        setDeliveredError(err.message);
        await load();
        onChanged?.();
      } else if (err.code === "bad_state") {
        toast.error("This order has changed", { description: err.message });
        closeDialog();
        await load();
        onChanged?.();
      } else {
        toast.error("Action failed", { description: err.message });
      }
      return false;
    } finally {
      setPending(false);
    }
  };

  const setLine = async (item, qty) => {
    if (qty < 0 || qty > item.stock_taken) return;
    setSavingLine(item.id);
    try {
      await action({
        action: "set_availability",
        orderId,
        itemId: item.id,
        availableQty: qty,
      });
      setAvail((a) => ({ ...a, [item.id]: qty }));
      setChecked((c) => new Set(c).add(item.id));
    } catch (err) {
      toast.error(err.code === "busy" ? BUSY_MESSAGE : "Could not save availability", {
        description: err.code === "busy" ? undefined : err.message,
      });
    } finally {
      setSavingLine(null);
    }
  };

  if (!detail) {
    return <div className="p-6 text-sm text-muted-foreground">Loading order…</div>;
  }

  const { order, items, events, refunds, legs, jobs } = detail;
  const isPaid = order.status === "paid";
  const allChecked = items.every((it) => checked.has(it.id));
  const failedJobs = jobs.filter((j) => j.status === "failed");
  const showRetry = Boolean(order.process_error || failedJobs.length || courierError);
  const preview = processRefundPreview(items, avail, order.shipping);
  const leaseExpired = order.op_lease_until && new Date(order.op_lease_until) < new Date();
  // A send back / rebook left claimed (e.g. courier cancel failed) is resumable once its lease expires.
  const canSendBack =
    order.status === "processing" && ["process", "send_back"].includes(order.op_action) && leaseExpired;
  const canRebook =
    ["packed", "shipped", "out_for_delivery"].includes(order.status) &&
    (!order.op_action || (order.op_action === "rebook" && leaseExpired));
  // Superadmin-only manual fallback when the courier never reported delivery; the server enforces both.
  const canMarkDelivered =
    role === "superadmin" && ["shipped", "out_for_delivery"].includes(order.status) && !order.delivered_at;
  const deliveredIso = localInputToIso(deliveredAt);
  // The server allows at most 30 days back and nothing before payment.
  const deliveredMin = toLocalInputValue(
    new Date(Math.max(Date.now() - 30 * 24 * 3600 * 1000, order.paid_at ? new Date(order.paid_at) : 0))
  );
  const canRelease = ["send_back", "rebook"].includes(order.op_action) && leaseExpired;
  const backPayload = (extra) =>
    dialog === "sendback"
      ? { action: "send_back", orderId, opKey: opRef.current.key, ...extra }
      : {
          action: "rebook",
          orderId,
          opKey: opRef.current.key,
          parcelLost,
          note: rebookNote.trim(),
          ...extra,
        };
  const shipUnits = items.reduce((s, it) => s + (avail[it.id] ?? 0), 0);

  return (
    <div className="space-y-5 rounded-md border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{order.order_ref}</h3>
          <div className="text-sm text-muted-foreground">
            {formatDateTime(order.created_at)} · {order.contact_name} · {order.contact_phone}
            {order.contact_email ? ` · ${order.contact_email}` : ""}
          </div>
          <div className="text-sm text-muted-foreground">{addressText(order.address)}</div>
        </div>
        <div>
          <StatusBadge status={order.status} />
          <ReturnBadge order={{ ...order, order_items: items }} />
        </div>
      </div>

      {(order.problem || order.process_error || courierError || failedJobs.length > 0) && (
        <div className="space-y-1 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {order.problem && <p>Problem: {order.problem}</p>}
          {(order.process_error || courierError) && (
            <p>Process error: {order.process_error || courierError}</p>
          )}
          {failedJobs.map((j) => (
            <p key={j.id}>
              Failed job {j.kind}
              {j.ref_id ? ` (${j.ref_id})` : ""}: {j.last_error || "unknown error"}
            </p>
          ))}
        </div>
      )}

      {/* Lines + shelf check */}
      <section>
        <h4 className="mb-2 font-medium">Items</h4>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1">Item</th>
              <th className="py-1 text-right">Qty</th>
              <th className="py-1 text-right">Paid</th>
              <th className="py-1 text-center">Available</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const raced = it.qty - it.stock_taken;
              const value = avail[it.id] ?? it.stock_taken;
              const isSet = checked.has(it.id);
              const saving = savingLine === it.id;
              return (
                <tr key={it.id} className="border-t" data-testid={`line-${it.id}`}>
                  <td className="py-2">
                    <div className="font-medium">{it.product_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {it.productid} {variantText(it) && `· ${variantText(it)}`}
                      {raced > 0 && ` · ${raced} sold out at payment (refunded)`}
                    </div>
                  </td>
                  <td className="py-2 text-right">{it.qty}</td>
                  <td className="py-2 text-right">{formatRupees(it.paid_value)}</td>
                  <td className="py-2">
                    {isPaid && it.stock_taken > 0 ? (
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          aria-label={`Fewer available for ${it.product_name}`}
                          disabled={saving || value <= 0}
                          onClick={() => setLine(it, value - 1)}
                        >
                          <Minus />
                        </Button>
                        <span className="w-14 text-center" aria-label={`Available for ${it.product_name}`}>
                          {value} / {it.stock_taken}
                        </span>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          aria-label={`More available for ${it.product_name}`}
                          disabled={saving || value >= it.stock_taken}
                          onClick={() => setLine(it, value + 1)}
                        >
                          <Plus />
                        </Button>
                        {isSet ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700">
                            <Check className="h-3 w-3" /> Checked
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={saving}
                            onClick={() => setLine(it, value)}
                          >
                            Confirm {value}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="text-center">
                        {it.available_qty ?? "—"}
                        {it.status ? <span className="ml-1 text-xs text-muted-foreground">({it.status})</span> : null}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Money */}
      <section>
        <h4 className="mb-2 font-medium">Money</h4>
        <dl className="max-w-sm space-y-1 text-sm">
          <MoneyRow label="Subtotal" value={order.subtotal} />
          <MoneyRow
            label={`Promo${order.promo_code ? ` (${order.promo_code})` : ""}`}
            value={order.promo_discount}
            negative
          />
          <MoneyRow label="Shipping" value={order.shipping} />
          <MoneyRow
            label={`Voucher${order.voucher_code ? ` (${order.voucher_code})` : ""}`}
            value={order.voucher_applied}
            negative
          />
          <MoneyRow label="Store credit" value={order.credit_applied} negative />
          <MoneyRow label="Paid online" value={order.gateway_amount} strong />
        </dl>
      </section>

      {/* Shipment */}
      {(order.awb || order.label_url || order.manifest_url || order.bill_id) && (
        <section className="text-sm">
          <h4 className="mb-2 font-medium">Shipment</h4>
          <ul className="space-y-1">
            {order.courier_name && <li>Courier: {order.courier_name}</li>}
            {order.awb && (
              <li>
                AWB:{" "}
                <a
                  className="text-blue-600 underline"
                  href={`https://shiprocket.co/tracking/${encodeURIComponent(order.awb)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {order.awb}
                </a>
              </li>
            )}
            {order.label_url && (
              <li>
                <a className="text-blue-600 underline" href={order.label_url} target="_blank" rel="noreferrer">
                  Shipping label
                </a>
              </li>
            )}
            {order.manifest_url && (
              <li>
                <a className="text-blue-600 underline" href={order.manifest_url} target="_blank" rel="noreferrer">
                  Manifest
                </a>
              </li>
            )}
            {order.bill_id && (
              <li>
                <a className="text-blue-600 underline" href="/admin/bills">
                  Bill of Supply #{order.bill_id}
                </a>
              </li>
            )}
            {order.tracking_label && (
              <li>
                Courier status: {order.tracking_label} ({formatDateTime(order.tracking_updated_at)})
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {isPaid && (
          <Button disabled={!allChecked || pending} onClick={() => setDialog("process")}>
            Process
          </Button>
        )}
        {isPaid && (
          <Button variant="destructive" disabled={pending} onClick={() => setDialog("cancel")}>
            Cancel order
          </Button>
        )}
        {showRetry && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run({ action: "retry", orderId }, "Retry started")}
          >
            Retry
          </Button>
        )}
        {canSendBack && (
          <Button variant="outline" disabled={pending} onClick={() => openBackDialog("sendback")}>
            {order.op_action === "send_back" ? "Resume send back" : "Send back to To-check"}
          </Button>
        )}
        {canRebook && (
          <Button variant="outline" disabled={pending} onClick={() => openBackDialog("rebook")}>
            {order.op_action === "rebook" ? "Resume rebook…" : "Rebook…"}
          </Button>
        )}
        {canRelease && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => openRelease(newOpKey(), order.op_action === "send_back" ? "send back" : "rebook")}
          >
            Abandon
          </Button>
        )}
        {canMarkDelivered && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setDeliveredAt(toLocalInputValue(new Date()));
              setDialog("delivered");
            }}
          >
            Mark delivered…
          </Button>
        )}
        {order.status === "rto" && (
          <Button variant="outline" disabled={pending} onClick={() => setDialog("rto")}>
            Parcel received back
          </Button>
        )}
      </div>
      {isPaid && !allChecked && (
        <p className="text-xs text-muted-foreground">
          Check every item on the shelf before processing.
        </p>
      )}

      <ReturnsSection
        order={order}
        items={items}
        role={role}
        onChanged={async () => {
          await load();
          onChanged?.();
        }}
      />

      {/* Refunds */}
      {refunds.length > 0 && (
        <section className="text-sm">
          <h4 className="mb-2 font-medium">Refunds</h4>
          <ul className="space-y-2">
            {refunds.map((r) => (
              <li key={r.id} className="rounded border p-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    {r.reason} · {r.units} unit{r.units === 1 ? "" : "s"} ·{" "}
                    {formatRupees(r.total_amount)}
                    {r.choice ? ` · ${r.choice === "store_credit" ? "store credit" : "original method"}` : ""}
                  </span>
                  <span className="font-medium">{r.status}</span>
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {legs
                    .filter((l) => l.refund_id === r.id)
                    .map((l) => (
                      <li key={l.id}>
                        {l.source} {formatRupees(l.amount)}
                        {l.destination ? ` → ${l.destination}` : ""} · {l.status}
                        {l.note ? ` · ${l.note}` : ""}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Timeline */}
      <section className="text-sm">
        <h4 className="mb-2 font-medium">Timeline</h4>
        <ol className="space-y-1">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="w-32 shrink-0 text-muted-foreground">{formatDateTime(e.created_at)}</span>
              <span>
                {e.kind}
                {e.from_status || e.to_status ? ` (${e.from_status || "—"} → ${e.to_status || "—"})` : ""}
              </span>
            </li>
          ))}
          {events.length === 0 && <li className="text-muted-foreground">No events yet.</li>}
        </ol>
      </section>

      <ConfirmDialog
        open={dialog === "process"}
        title={`Process ${order.order_ref}?`}
        description={
          preview.allUnavailable
            ? "Nothing is available to ship: the order will be cancelled and fully refunded, including shipping."
            : `${shipUnits} unit${shipUnits === 1 ? "" : "s"} will be booked with the courier and a Bill of Supply created.`
        }
        confirmLabel={preview.allUnavailable ? "Cancel and refund" : "Process"}
        pending={pending}
        onClose={closeDialog}
        onConfirm={() =>
          run(
            { action: "process", orderId, opKey: opKeyFor("process") },
            preview.allUnavailable ? "Order cancelled and refunded" : "Order processed"
          )
        }
      >
        {preview.lines.length > 0 ? (
          <div className="text-sm">
            <p className="mb-1 font-medium">To be refunded</p>
            <ul className="mb-2 space-y-0.5">
              {preview.lines.map((l) => (
                <li key={l.id}>
                  {l.units} × {l.name}
                  {variantText(l) ? ` (${variantText(l)})` : ""} — {formatRupees(l.amount)}
                </li>
              ))}
            </ul>
            <p data-testid="refund-total">
              Refund total: <strong>{formatRupees(preview.amount)}</strong>
              {preview.allUnavailable ? " (incl. shipping)" : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm">No refunds: every item is available.</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "cancel"}
        title={`Cancel ${order.order_ref}?`}
        description="Every item and the shipping charge will be refunded. The customer chooses store credit or the original payment method."
        confirmLabel="Cancel order"
        confirmDisabled={!cancelReason.trim()}
        pending={pending}
        onClose={closeDialog}
        onConfirm={() =>
          run(
            { action: "cancel", orderId, opKey: opKeyFor("cancel"), reason: cancelReason.trim() },
            "Order cancelled"
          )
        }
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Reason (required)</span>
          <Textarea
            aria-label="Cancel reason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="e.g. Customer asked to cancel on WhatsApp"
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "sendback" || dialog === "rebook"}
        title={dialog === "sendback" ? `Send back ${order.order_ref}?` : `Rebook ${order.order_ref}?`}
        description={
          dialog === "sendback"
            ? `Cancels the courier booking (AWB ${order.awb ?? "—"}) and returns this order to To-check. Refunds already made stay.`
            : `Cancels AWB ${order.awb ?? "—"}. Parcel still at shop: re-send the same pieces. Parcel lost: take new pieces from stock; anything we can't replace is refunded.`
        }
        confirmLabel={dialog === "sendback" ? "Send back" : "Rebook"}
        confirmDisabled={dialog === "rebook" && !rebookNote.trim()}
        pending={pending}
        onClose={closeDialog}
        onConfirm={() =>
          runBack(backPayload(), dialog === "sendback" ? "Order sent back to To-check" : "Order rebooked")
        }
      >
        {dialog === "rebook" && (
          <div className="space-y-3 text-sm">
            <div role="radiogroup" aria-label="Parcel" className="space-y-1">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="parcel"
                  checked={!parcelLost}
                  onChange={() => setParcelLost(false)}
                />
                Parcel at shop
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="parcel"
                  checked={parcelLost}
                  onChange={() => setParcelLost(true)}
                />
                Parcel lost
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block font-medium">Note (required)</span>
              <Textarea
                aria-label="Rebook note"
                value={rebookNote}
                onChange={(e) => setRebookNote(e.target.value)}
                placeholder="e.g. Courier returned the parcel to the shop"
              />
            </label>
          </div>
        )}
        {dialogProblem && (
          <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p>{dialogProblem}</p>
            {role === "superadmin" && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  runBack(
                    backPayload({ manualCancelConfirmed: true }),
                    dialog === "sendback" ? "Order sent back to To-check" : "Order rebooked"
                  )
                }
              >
                I cancelled it in Shiprocket
              </Button>
            )}
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => openRelease(opRef.current.key, dialog === "sendback" ? "send back" : "rebook")}
            >
              Abandon
            </Button>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "release"}
        title={`Abandon ${release?.label ?? "action"} of ${order.order_ref}?`}
        description={RELEASE_MESSAGE}
        confirmLabel="Abandon"
        pending={pending}
        onClose={closeDialog}
        onConfirm={() => run({ action: "release_op", orderId, opKey: release?.key }, "Order released")}
      />

      <ConfirmDialog
        open={dialog === "delivered"}
        title={`Mark ${order.order_ref} delivered?`}
        description="Use only when the courier never reported delivery. The delivery date starts the return window and cannot be changed afterwards."
        confirmLabel="Mark delivered"
        confirmDisabled={!deliveredIso || !deliveredReason.trim()}
        pending={pending}
        onClose={closeDialog}
        onConfirm={() =>
          run(
            { action: "mark_delivered", orderId, deliveredAt: deliveredIso, reason: deliveredReason.trim() },
            "Order marked delivered"
          )
        }
      >
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium">Delivered at</span>
            <input
              type="datetime-local"
              className="h-9 w-full rounded-md border border-input bg-white px-2"
              value={deliveredAt}
              min={deliveredMin}
              max={toLocalInputValue(new Date())}
              onChange={(e) => setDeliveredAt(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Reason (required)</span>
            <Textarea
              aria-label="Delivery reason"
              value={deliveredReason}
              onChange={(e) => setDeliveredReason(e.target.value)}
              placeholder="e.g. Customer confirmed receipt on WhatsApp"
            />
          </label>
          {deliveredError && (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800">{deliveredError}</p>
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "rto"}
        title="Parcel received back?"
        description="Stock is returned for the shipped units and their value is refunded. Shipping is not refunded."
        confirmLabel="Parcel received back"
        pending={pending}
        onClose={closeDialog}
        onConfirm={() => run({ action: "rto_received", orderId }, "Return recorded and refund started")}
      />
    </div>
  );
}
