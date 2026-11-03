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
import { CourierBadge, OutsideUpBadge, PickupBadge, ReturnBadge, StatusBadge } from "./OrderList";
import PackedPhotosSection from "./PackedPhotosSection";
import ReturnsSection from "./ReturnsSection";
import { useBillPdf } from "../billing/useBillPdf";
import { openBillPdf } from "../billing/billPdf";
import {
  formatDateTime,
  formatRupees,
  isManualCourier,
  istInputToIso,
  manualNextSteps,
  processRefundPreview,
  ceilToMinute,
  timelineRows,
  toISTInputValue,
} from "./orderHelpers";

const BUSY_MESSAGE = "Another staff member is working on this order";
const RELEASE_MESSAGE =
  "Releases this order without cancelling the courier booking. Use only if the booking was not cancelled.";
const PICKED_UP_MESSAGE =
  "Picked up creates the Bill of Supply, emails the customer and means the order can no longer be cancelled.";

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

// Closed unless a problem in it needs seeing. Native <details>: staff can still toggle a forced-open
// section, and React leaves that toggle alone until the prop itself changes.
function CollapsibleSection({ title, summary, open = false, children }) {
  return (
    <details open={open} className="border-t pt-3 text-sm">
      <summary className="cursor-pointer">
        <h4 className="inline font-medium">{title}</h4>
        {summary && <span className="ml-2 text-muted-foreground">{summary}</span>}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function addressText(a, fulfilment) {
  if (!a) return "";
  // A pickup order's address holds only the contact the customer gave at checkout.
  if (fulfilment === "pickup") return [a.name, a.phone, a.email].filter(Boolean).join(", ");
  return [a.line1, a.line2, a.landmark && `Landmark: ${a.landmark}`, a.city, a.state, a.pincode].filter(Boolean).join(", ");
}

function variantText(it) {
  return [it.size, it.color].filter(Boolean).join(" / ");
}

export default function OrderDetail({ orderId, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [avail, setAvail] = useState({});
  const [checked, setChecked] = useState(() => new Set());
  const [savingLine, setSavingLine] = useState(null);
  const [dialog, setDialog] = useState(null); // 'process' | 'ready' | 'collected' | 'cancel' | 'rto' | 'sendback' | 'rebook' | 'release' | 'delivered' | 'advance'
  const [pending, setPending] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [courierError, setCourierError] = useState(null);
  const [role, setRole] = useState(null);
  const [parcelLost, setParcelLost] = useState(false);
  const [rebookNote, setRebookNote] = useState("");
  const [deliveredAt, setDeliveredAt] = useState("");
  const [deliveredReason, setDeliveredReason] = useState("");
  // Process dialog of a ship order: Shiprocket (booked here), Porter or self delivery (arranged by staff).
  const [courier, setCourier] = useState("shiprocket");
  // Manual step waiting on its confirmation (dialog 'advance').
  const [advanceStep, setAdvanceStep] = useState(null);
  // Courier cancel failure inside a send-back/rebook dialog; the dialog stays open so the
  // same op key can be resumed (retry, or superadmin manual-cancel confirmation).
  const [dialogProblem, setDialogProblem] = useState(null);
  const [deliveredError, setDeliveredError] = useState(null);
  // release_op target {key, label}: key is the open send-back/rebook dialog's key, or a new one.
  const [release, setRelease] = useState(null);
  // One op key per Process/Cancel click; reused if that click's request is retried.
  const opRef = useRef(null);
  const { generate: generateBillPdf, offscreen: billPdfOffscreen } = useBillPdf();
  const [billPdf, setBillPdf] = useState({ state: "idle" }); // idle | generating | failed (+ message)
  // Once per bill per view: a failure waits for Try again instead of looping.
  const billPdfAttempted = useRef(null);

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
      setLoadFailed(true);
      toast.error("Could not load order", { description: err.message });
    }
  }, [orderId]);

  useEffect(() => {
    setDetail(null);
    setLoadFailed(false);
    setCourierError(null);
    opRef.current = null;
    setBillPdf({ state: "idle" });
    load();
  }, [load]);

  const makeBillPdf = useCallback(
    async (billId) => {
      billPdfAttempted.current = billId;
      setBillPdf({ state: "generating" });
      try {
        const path = await generateBillPdf(billId);
        setDetail((d) => (d?.bill?.billid === billId ? { ...d, bill: { ...d.bill, pdf_url: path } } : d));
        setBillPdf({ state: "idle" });
      } catch (err) {
        setBillPdf({ state: "failed", message: err.message });
      }
    },
    [generateBillPdf],
  );

  // A bill is created when staff act on the order, so this covers every path that makes
  // one (Process, Picked up, ready for pickup) and repairs older bills when they are opened.
  const billToDraw = detail?.bill;
  useEffect(() => {
    if (!billToDraw || billToDraw.pdf_url || !billToDraw.finalized) return;
    if (billToDraw.paymentstatus === "cancelled") return;
    if (billPdfAttempted.current === billToDraw.billid) return;
    makeBillPdf(billToDraw.billid);
  }, [billToDraw, makeBillPdf]);

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
    setCourier("shiprocket");
    setAdvanceStep(null);
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
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {loadFailed ? "Could not load this order." : "Loading order…"}
      </div>
    );
  }

  const { order, bill, items, events, refunds, legs, jobs } = detail;
  const billLabel = `Bill of Supply ${bill?.bill_number ?? `#${order.bill_id}`}`;
  const isPaid = order.status === "paid";
  const isPickup = order.fulfilment === "pickup";
  const isReadyForPickup = order.status === "ready_for_pickup";
  const isManual = isManualCourier(order.courier);
  const manualChosen = dialog === "process" && isManualCourier(courier);
  const manualSteps = isManual ? manualNextSteps(order.status) : [];
  const allChecked = items.every((it) => checked.has(it.id));
  const failedJobs = jobs.filter((j) => j.status === "failed");
  const showRetry = Boolean(order.process_error || failedJobs.length || courierError);
  const preview = processRefundPreview(items, avail, order.shipping);
  const leaseExpired = order.op_lease_until && new Date(order.op_lease_until) < new Date();
  // A send back / rebook left claimed (e.g. courier cancel failed) is resumable once its lease expires.
  const canSendBack =
    order.status === "processing" && ["process", "send_back"].includes(order.op_action) && leaseExpired;
  // Rebook re-sends a Shiprocket shipment; a manual delivery has none.
  const canRebook =
    !isManual &&
    ["packed", "shipped", "out_for_delivery"].includes(order.status) &&
    (!order.op_action || (order.op_action === "rebook" && leaseExpired));
  // Superadmin-only fallback when the courier never reported delivery. A manual order closes through
  // its Delivered step instead. The server enforces both.
  const canMarkDelivered =
    role === "superadmin" &&
    !isManual &&
    ["shipped", "out_for_delivery"].includes(order.status) &&
    !order.delivered_at;
  const deliveredIso = istInputToIso(deliveredAt);
  // The server allows at most 30 days back and nothing before payment; a minute of slack covers the
  // time between rendering and submitting.
  const deliveredMin = toISTInputValue(
    ceilToMinute(
      new Date(Math.max(Date.now() - 30 * 24 * 3600 * 1000, order.paid_at ? new Date(order.paid_at) : 0) + 60000)
    )
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

  const openDelivered = () => {
    setDeliveredAt(toISTInputValue(new Date()));
    setDialog("delivered");
  };
  const advance = (step) =>
    run(
      { action: "manual_advance", orderId, target: step.key },
      `Order marked ${step.label.toLowerCase()}`
    );
  const onManualStep = (step) => {
    if (step.key === "delivered") {
      openDelivered();
    } else if (step.key === "shipped" || (step.key === "out_for_delivery" && order.status !== "shipped")) {
      setAdvanceStep(step);
      setDialog("advance");
    } else {
      advance(step);
    }
  };

  return (
    <div className="space-y-5 rounded-md border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{order.order_ref}</h3>
          <div className="text-sm text-muted-foreground">
            {formatDateTime(order.created_at)} · {order.contact_name} · {order.contact_phone}
            {order.contact_email ? ` · ${order.contact_email}` : ""}
          </div>
          <div className="text-sm text-muted-foreground">{addressText(order.address, order.fulfilment)}</div>
        </div>
        <div>
          <StatusBadge status={order.status} fulfilment={order.fulfilment} />
          <ReturnBadge order={{ ...order, order_items: items }} />
          <OutsideUpBadge address={order.address} fulfilment={order.fulfilment} />
          <PickupBadge fulfilment={order.fulfilment} />
          <CourierBadge courier={order.courier} />
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

      {/* Actions */}
      <div className="sticky top-[61px] z-10 -mx-4 flex flex-wrap gap-2 bg-white px-4 py-2 empty:hidden">
        {isPaid && !isPickup && (
          <Button disabled={!allChecked || pending} onClick={() => setDialog("process")}>
            Process
          </Button>
        )}
        {isPaid && isPickup && (
          <Button disabled={!allChecked || pending} onClick={() => setDialog("ready")}>
            Ready for pickup
          </Button>
        )}
        {isReadyForPickup && (
          <Button disabled={pending} onClick={() => setDialog("collected")}>
            Collected
          </Button>
        )}
        {manualSteps.map((step, index) => (
          <Button
            key={step.key}
            variant={index === 0 ? "default" : "outline"}
            disabled={pending}
            onClick={() => onManualStep(step)}
          >
            {step.label}
          </Button>
        ))}
        {(isPaid || isReadyForPickup || (isManual && ["processed", "packed"].includes(order.status))) && (
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
            onClick={openDelivered}
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
          Check every item on the shelf before {isPickup ? "marking it ready for pickup" : "processing"}.
        </p>
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

      <PackedPhotosSection
        order={order}
        onChanged={async () => {
          await load();
          onChanged?.();
        }}
      />

      <ReturnsSection
        order={order}
        items={items}
        role={role}
        onChanged={async () => {
          await load();
          onChanged?.();
        }}
      />

      {/* Money */}
      <CollapsibleSection title="Money" summary={`Paid online ${formatRupees(order.gateway_amount)}`}>
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
      </CollapsibleSection>

      {/* Shipment */}
      {(order.awb || order.label_url || order.manifest_url || order.bill_id || isManual) && (
        <CollapsibleSection
          title="Shipment"
          summary={isManual ? null : order.courier_name}
          open={Boolean(order.process_error || courierError)}
        >
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
                {bill?.pdf_url ? (
                  <button
                    type="button"
                    className="text-blue-600 underline"
                    onClick={() =>
                      openBillPdf(bill.pdf_url).catch((err) =>
                        toast.error("Could not open bill PDF", { description: err.message }),
                      )
                    }
                  >
                    {billLabel}
                  </button>
                ) : (
                  <span>{billLabel}</span>
                )}
                {billPdf.state === "generating" && <span> (creating PDF…)</span>}
                {billPdf.state === "failed" && (
                  <span className="text-red-700">
                    {" "}
                    PDF not created: {billPdf.message}.{" "}
                    <button type="button" className="underline" onClick={() => makeBillPdf(bill.billid)}>
                      Try again
                    </button>
                  </span>
                )}
              </li>
            )}
            {order.tracking_label && (
              <li>
                Courier status: {order.tracking_label} ({formatDateTime(order.tracking_updated_at)})
              </li>
            )}
          </ul>
        </CollapsibleSection>
      )}

      {/* Refunds */}
      {refunds.length > 0 && (
        <CollapsibleSection
          title="Refunds"
          summary={`${refunds.length} refund${refunds.length === 1 ? "" : "s"}`}
          open={refunds.some((r) => r.status !== "completed")}
        >
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
        </CollapsibleSection>
      )}

      {/* Timeline */}
      <CollapsibleSection
        title="Timeline"
        summary={`${events.length} event${events.length === 1 ? "" : "s"}`}
        open={failedJobs.length > 0}
      >
        <ol className="space-y-1">
          {timelineRows(events).map((r) => (
            <li key={r.id} className="flex gap-3">
              <span className="w-32 shrink-0 text-muted-foreground">{formatDateTime(r.at)}</span>
              <span>
                <span className="font-medium">{r.label}</span>
                {r.count > 1 && (
                  <span className="text-muted-foreground">
                    {" "}
                    ×{r.count}, last {formatDateTime(r.lastAt)}
                  </span>
                )}
                {r.status && <span className="text-muted-foreground"> · now {r.status}</span>}
                {r.detail && <span className="block text-xs text-muted-foreground">{r.detail}</span>}
              </span>
            </li>
          ))}
          {events.length === 0 && <li className="text-muted-foreground">No events yet.</li>}
        </ol>
      </CollapsibleSection>

      <ConfirmDialog
        open={dialog === "process" || dialog === "ready"}
        title={dialog === "ready" ? `Ready ${order.order_ref} for pickup?` : `Process ${order.order_ref}?`}
        description={
          dialog === "ready"
            ? preview.allUnavailable
              ? "Nothing is available: the order will be cancelled and fully refunded."
              : `${shipUnits} unit${shipUnits === 1 ? "" : "s"} will be kept for the customer, a Bill of Supply created and the customer emailed to collect.`
            : preview.allUnavailable
              ? "Nothing is available to ship: the order will be cancelled and fully refunded, including shipping."
              : manualChosen
                ? `${shipUnits} unit${shipUnits === 1 ? "" : "s"} will be marked processed. Book or arrange the delivery yourself; the customer follows the status on our website.`
                : `${shipUnits} unit${shipUnits === 1 ? "" : "s"} will be booked with the courier and a Bill of Supply created.`
        }
        confirmLabel={
          preview.allUnavailable
            ? "Cancel and refund"
            : dialog === "ready"
              ? "Ready for pickup"
              : "Process"
        }
        pending={pending}
        onClose={closeDialog}
        onConfirm={() =>
          dialog === "ready"
            ? run(
                { action: "mark_ready", orderId },
                preview.allUnavailable ? "Order cancelled and refunded" : "Order ready for pickup"
              )
            : manualChosen
              ? run(
                  { action: "manual_process", orderId, courier },
                  preview.allUnavailable ? "Order cancelled and refunded" : "Order processed"
                )
              : run(
                  { action: "process", orderId, opKey: opKeyFor("process") },
                  preview.allUnavailable ? "Order cancelled and refunded" : "Order processed"
                )
        }
      >
        {dialog === "process" && (
          <div className="space-y-2 text-sm">
            <div role="radiogroup" aria-label="Courier" className="space-y-1">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="courier"
                  checked={courier === "shiprocket"}
                  onChange={() => setCourier("shiprocket")}
                />
                Shiprocket
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="courier"
                  checked={courier === "porter"}
                  onChange={() => setCourier("porter")}
                />
                Porter (manual)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="courier"
                  checked={courier === "self"}
                  onChange={() => setCourier("self")}
                />
                Self delivery
              </label>
            </div>
          </div>
        )}
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
              {preview.allUnavailable && !isPickup ? " (incl. shipping)" : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm">No refunds: every item is available.</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "advance"}
        title={`Mark ${order.order_ref} ${advanceStep?.label.toLowerCase()}?`}
        description={
          advanceStep?.key === "shipped" ? PICKED_UP_MESSAGE : `This also marks the order picked up. ${PICKED_UP_MESSAGE}`
        }
        confirmLabel={advanceStep?.label}
        pending={pending}
        onClose={closeDialog}
        onConfirm={() => advance(advanceStep)}
      />

      <ConfirmDialog
        open={dialog === "collected"}
        title={`Has the customer collected ${order.order_ref}?`}
        description="Marks the order delivered. The collection time starts the return window and cannot be changed afterwards."
        confirmLabel="Collected"
        pending={pending}
        onClose={closeDialog}
        onConfirm={() => run({ action: "mark_collected", orderId }, "Order marked collected")}
      />

      <ConfirmDialog
        open={dialog === "cancel"}
        title={`Cancel ${order.order_ref}?`}
        description={`Every item${isPickup ? "" : " and the shipping charge"} will be refunded. The customer chooses store credit or the original payment method.`}
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
        description={
          isManual
            ? "Use when the parcel has reached the customer. The delivery date starts the return window and cannot be changed afterwards."
            : "Use only when the courier never reported delivery. The delivery date starts the return window and cannot be changed afterwards."
        }
        confirmLabel="Mark delivered"
        confirmDisabled={!deliveredIso || (!isManual && !deliveredReason.trim())}
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
              max={toISTInputValue(new Date())}
              onChange={(e) => setDeliveredAt(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Reason ({isManual ? "optional" : "required"})</span>
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
      {billPdfOffscreen}
    </div>
  );
}
