import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { listOrders, ORDER_FILTERS } from "./onlineOrdersApi";
import {
  STATUS_CLASSES,
  STATUS_LABELS,
  formatDateTime,
  formatRupees,
  hasProblem,
  itemCount,
  orderTotal,
  returnBadge,
} from "./orderHelpers";

export function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_CLASSES[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {STATUS_LABELS[status] || status}
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

export default function OrderList({ selectedId, onSelect, refreshKey }) {
  const [filter, setFilter] = useState("to_check");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listOrders(filter)
      .then((rows) => {
        if (!cancelled) setOrders(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setOrders([]);
          toast.error("Could not load orders", { description: err.message });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, refreshKey]);

  return (
    <div className="space-y-3">
      <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-md bg-muted p-1">
        {Object.entries(ORDER_FILTERS).map(([key, { label }]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={`rounded-sm px-3 py-1.5 text-sm font-medium transition ${
              filter === key
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Ref</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2 text-right">Items</th>
              <th className="px-3 py-2 text-right">Total paid</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">
                <span className="sr-only">Problem</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr
                key={o.id}
                onClick={() => onSelect(o.id)}
                className={`cursor-pointer border-t hover:bg-gray-50 ${
                  selectedId === o.id ? "bg-blue-50" : ""
                }`}
              >
                <td className="px-3 py-2 font-medium">{o.order_ref}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(o.created_at)}</td>
                <td className="px-3 py-2">
                  <div>{o.contact_name}</div>
                  <div className="text-xs text-muted-foreground">{o.contact_phone}</div>
                </td>
                <td className="px-3 py-2 text-right">{itemCount(o)}</td>
                <td className="px-3 py-2 text-right">{formatRupees(orderTotal(o))}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={o.status} />
                  <ReturnBadge order={o} />
                </td>
                <td className="px-3 py-2">
                  {hasProblem(o) && (
                    <AlertTriangle
                      className="h-4 w-4 text-red-600"
                      aria-label="Needs attention"
                    />
                  )}
                </td>
              </tr>
            ))}
            {!loading && orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No orders here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
