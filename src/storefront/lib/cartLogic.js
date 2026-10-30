// Pure cart transforms — no I/O, unit-tested. Item shape:
// { variant_id, product_id, quantity, name, size, color, price, image_url, stock? }

// Union two carts by variant_id, keeping the higher quantity. The local cart is
// usually a stale mirror of the server, so max (not sum) avoids double-counting
// on re-login / app reopen. Display fields prefer the server copy.
export function mergeCarts(local, server) {
  const byId = new Map();
  for (const it of local) byId.set(it.variant_id, { ...it });
  for (const it of server) {
    const existing = byId.get(it.variant_id);
    byId.set(it.variant_id, {
      ...it,
      quantity: Math.max(it.quantity, existing ? existing.quantity : 0),
    });
  }
  return [...byId.values()];
}

// Most units the cart may hold: the item's last known stock. Rows loaded from
// the server cart carry no stock until the next revalidate, so they are
// unbounded until then (checkout re-checks stock anyway).
export function maxQuantity(item) {
  return Number.isFinite(item?.stock) ? item.stock : Infinity;
}

// Add `payload.quantity` units, never past the known stock. `added` is how
// many units actually went in (0 when the cart already holds all of them).
export function addToItems(items, payload) {
  const existing = items.find((i) => i.variant_id === payload.variant_id);
  const merged = existing ? { ...existing, ...payload, quantity: existing.quantity } : { ...payload, quantity: 0 };
  const quantity = Math.min(merged.quantity + payload.quantity, maxQuantity(merged));
  const added = Math.max(0, quantity - merged.quantity);
  if (added === 0) return { items, added };
  const next = { ...merged, quantity };
  return {
    items: existing ? items.map((i) => (i.variant_id === payload.variant_id ? next : i)) : [...items, next],
    added,
  };
}

// Reconcile cart items against live stock/price. Drops removed/out-of-stock
// variants, caps over-stock quantities, and updates changed prices.
export function revalidateItems(items, liveByVariant) {
  const out = [];
  const changes = [];
  for (const it of items) {
    const live = liveByVariant[it.variant_id];
    if (!live || live.stock <= 0) {
      changes.push({ variant_id: it.variant_id, name: it.name, type: "removed" });
      continue;
    }
    const next = { ...it, stock: live.stock };
    if (typeof live.price === "number" && live.price !== it.price) {
      next.price = live.price;
      changes.push({ variant_id: it.variant_id, name: it.name, type: "repriced" });
    }
    if (next.quantity > live.stock) {
      next.quantity = live.stock;
      changes.push({ variant_id: it.variant_id, name: it.name, type: "capped" });
    }
    out.push(next);
  }
  return { items: out, changes };
}
