import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Input } from "../../../components/ui/input";
import { countOrders, DEFAULT_QUEUE, listOrders, ORDER_QUEUES, searchOrders } from "./onlineOrdersApi";
import {
  MAX_SEARCH_LENGTH,
  STATUS_CLASSES,
  deliveryLabel,
  formatRupees,
  hasOpenReturn,
  isManualCourier,
  isOutsideUp,
  itemCount,
  needsAttention,
  nextStepIsStatus,
  nextStepLabel,
  normalizeOrderSearch,
  orderTotal,
  returnBadge,
  statusLabel,
} from "./orderHelpers";

const SEARCH_DEBOUNCE_MS = 300;

function emptyText(term, queue, counts) {
  if (term) return "No orders match this search.";
  if (queue !== DEFAULT_QUEUE) return "No orders here.";
  const inProgress = counts?.in_progress ?? 0;
  if (inProgress === 0) return "Nothing needs you right now.";
  return `Nothing needs you right now. ${inProgress} ${inProgress === 1 ? "order is" : "orders are"} in progress.`;
}

export function StatusBadge({ status, fulfilment }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_CLASSES[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {statusLabel(status, fulfilment)}
    </span>
  );
}

export function ReturnBadge({ order }) {
  const label = returnBadge(order);
  if (!label) return null;
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
      {label}
    </span>
  );
}

export function OutsideUpBadge({ address, fulfilment }) {
  if (!isOutsideUp(address, fulfilment)) return null;
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
      Outside UP
    </span>
  );
}

export function PickupBadge({ fulfilment }) {
  if (fulfilment !== "pickup") return null;
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800">
      Store pickup
    </span>
  );
}

export function CourierBadge({ courier }) {
  if (!isManualCourier(courier)) return null;
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
      {courier === "porter" ? "Porter" : "Self delivery"}
    </span>
  );
}

function NextStep({ order }) {
  if (needsAttention(order)) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-red-700">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {nextStepLabel(order)}
      </span>
    );
  }
  if (nextStepIsStatus(order)) return <StatusBadge status={order.status} fulfilment={order.fulfilment} />;
  return <span className="font-medium text-foreground">{nextStepLabel(order)}</span>;
}

function OrderRow({ order, selected, onSelect }) {
  const count = itemCount(order);
  const delivery = deliveryLabel(order);
  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        onClick={() => onSelect(order.id)}
        aria-current={selected ? "true" : undefined}
        className={`block w-full px-3 py-2 text-left text-sm ${selected ? "bg-blue-50" : "hover:bg-gray-50"}`}
      >
        <span className="flex items-baseline gap-2">
          <span className="shrink-0 font-medium">{order.order_ref}</span>
          {/* relative: the sr-only phone is absolute and would escape this clip, widening the page. */}
          <span className="relative min-w-0 flex-1 truncate">
            {order.contact_name}
            <span className="sr-only sm:not-sr-only sm:ml-2 sm:text-xs sm:text-muted-foreground">
              {order.contact_phone}
            </span>
          </span>
          <span className="shrink-0">{formatRupees(orderTotal(order))}</span>
        </span>
        <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0">
            {count} item{count === 1 ? "" : "s"}
            {delivery && ` · ${delivery}`}
            <OutsideUpBadge address={order.address} fulfilment={order.fulfilment} />
            <ReturnBadge order={order} />
            {hasOpenReturn(order) && (
              <span className="ml-1 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                Return open
              </span>
            )}
          </span>
          <span className="shrink-0">
            <NextStep order={order} />
          </span>
        </span>
      </button>
    </li>
  );
}

export default function OrderList({ selectedId, onSelect, refreshKey }) {
  const [queue, setQueue] = useState(DEFAULT_QUEUE);
  const [searchInput, setSearchInput] = useState("");
  const [term, setTerm] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);

  // Clearing the box returns to the queue at once; only typing waits.
  useEffect(() => {
    const next = normalizeOrderSearch(searchInput);
    if (!next) {
      setTerm("");
      return undefined;
    }
    const timer = setTimeout(() => setTerm(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (term ? searchOrders(term) : listOrders(queue))
      .then((rows) => {
        if (!cancelled) setOrders(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setOrders([]);
          setLoadError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queue, term, refreshKey, retryKey]);

  useEffect(() => {
    let cancelled = false;
    countOrders()
      .then((next) => {
        if (!cancelled) setCounts(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setCounts(null);
          toast.error("Could not count orders", { description: err.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const selectQueue = (key) => {
    setQueue(key);
    setSearchInput("");
  };

  return (
    <div className="space-y-3">
      <Input
        type="search"
        aria-label="Search orders"
        placeholder="Search by order number, phone or name"
        maxLength={MAX_SEARCH_LENGTH}
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="bg-white"
      />

      <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-md bg-muted p-1">
        {Object.entries(ORDER_QUEUES).map(([key, { label, counted }]) => {
          const active = !term && queue === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectQueue(key)}
              className={`rounded-sm px-3 py-1.5 text-sm font-medium transition ${
                active ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              {counted && counts && ` (${counts[key]})`}
            </button>
          );
        })}
      </div>

      <div className="rounded-md border bg-white">
        {orders.length > 0 && (
          <ul aria-label="Orders">
            {orders.map((o) => (
              <OrderRow key={o.id} order={o} selected={selectedId === o.id} onSelect={onSelect} />
            ))}
          </ul>
        )}
        {orders.length === 0 && !loading && loadError && (
          <div role="alert" className="space-y-2 px-3 py-6 text-center text-sm text-red-700">
            <p>Could not load orders: {loadError}</p>
            <button
              type="button"
              onClick={() => setRetryKey((k) => k + 1)}
              className="rounded border border-red-300 px-3 py-1 font-medium hover:bg-red-50"
            >
              Try again
            </button>
          </div>
        )}
        {orders.length === 0 && (loading || !loadError) && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {loading ? "Loading orders…" : emptyText(term, queue, counts)}
          </p>
        )}
      </div>
    </div>
  );
}
