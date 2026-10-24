import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import OrderList from "../components/onlineOrders/OrderList";
import OrderDetail from "../components/onlineOrders/OrderDetail";
import { action, getCheckoutLive, getMyRole } from "../components/onlineOrders/onlineOrdersApi";

// Superadmin-only switch for storefront_settings.checkout_live.
function CheckoutLiveSwitch() {
  const [live, setLive] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    getCheckoutLive()
      .then(setLive)
      .catch((err) => toast.error("Could not load checkout setting", { description: err.message }));
  }, []);

  if (live === null) return null;

  const next = !live;
  const save = async () => {
    setPending(true);
    try {
      await action({ action: "set_live", live: next });
      setLive(next);
      setConfirming(false);
      toast.success(next ? "Online checkout is live" : "Online checkout switched off");
    } catch (err) {
      toast.error("Could not change online checkout", { description: err.message });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <span>Online checkout</span>
        <button
          type="button"
          role="switch"
          aria-checked={live}
          aria-label="Online checkout"
          onClick={() => setConfirming(true)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
            live ? "bg-green-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${
              live ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </label>
      <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>{next ? "Turn on online checkout?" : "Turn off online checkout?"}</DialogTitle>
            <DialogDescription>
              {next
                ? "Customers will be able to pay online"
                : "Customers will no longer be able to pay online; checkout goes back to WhatsApp."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              Back
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : next ? "Turn on" : "Turn off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function OnlineOrdersPage() {
  const [selectedId, setSelectedId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [role, setRole] = useState(null);

  useEffect(() => {
    getMyRole()
      .then(setRole)
      .catch((err) => toast.error("Could not load your role", { description: err.message }));
  }, []);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Online Orders</h2>
        {role === "superadmin" && <CheckoutLiveSwitch />}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <OrderList
          selectedId={selectedId}
          onSelect={setSelectedId}
          refreshKey={refreshKey}
        />
        {selectedId ? (
          <OrderDetail
            key={selectedId}
            orderId={selectedId}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />
        ) : (
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            Select an order to see its details.
          </div>
        )}
      </div>
    </div>
  );
}
