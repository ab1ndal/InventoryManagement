// Pure cart transforms — no I/O, unit-tested. Item shape:
// { variant_id, product_id, quantity, name, size, color, price, image_url }

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
    const next = { ...it };
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
