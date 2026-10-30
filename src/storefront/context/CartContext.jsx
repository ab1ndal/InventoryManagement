import React, {
  createContext, useContext, useState, useEffect, useCallback, useRef,
} from "react";
import { toast } from "sonner";
import { supabase } from "lib/supabaseClient";
import {
  mergeCarts, revalidateItems, addToItems, maxQuantity, applyHoldResults,
} from "../lib/cartLogic";
import {
  fetchServerCart, upsertItem, removeServerItem, clearServerCart, fetchLiveVariantData,
} from "../lib/cartApi";
import { cartHold } from "../lib/ordersApi";
import { guestHolderKey } from "../lib/holder";
import { trackEvent } from "../lib/analytics";

const STORAGE_KEY = "bc_cart";
// cart-hold request limits: per-line quantity and lines per call.
const MAX_HOLD_QTY = 20;
const MAX_HOLD_ITEMS = 30;

export const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [isOpen, setIsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [holdExpiresAt, setHoldExpiresAt] = useState(null);
  const userIdRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const persist = useCallback((variant_id, next) => {
    if (!userIdRef.current) return;
    if (next) {
      upsertItem({ variant_id, product_id: next.product_id, quantity: next.quantity }).catch(() => {});
    } else {
      removeServerItem(variant_id).catch(() => {});
    }
  }, []);

  // Stock holds are best effort: the cart works exactly as before when the
  // call fails, and the shopper is never kept waiting on it. Built inside the
  // promise so even a failure to make the guest key lands in the catch.
  const syncHolds = useCallback(
    (lines, replace = false) => {
      const holdItems = lines.map((l) => ({ variantId: l.variant_id, qty: Math.min(l.quantity, MAX_HOLD_QTY) }));
      Promise.resolve()
        .then(() => cartHold({ holderKey: guestHolderKey(), items: holdItems, ...(replace && { replace: true }) }))
        .then((res) => {
          if (!res || res.rateLimited) return;
          setHoldExpiresAt(res.expiresAt ?? null);
          // Compare against the cart as it is now, not as it was when sent.
          const { items: next, capped } = applyHoldResults(itemsRef.current, res);
          if (!capped.length) return;
          itemsRef.current = next;
          setItems(next);
          capped.forEach((c) => {
            persist(c.variant_id, c.quantity > 0 ? { product_id: c.product_id, quantity: c.quantity } : null);
            toast.warning(
              c.quantity > 0
                ? `Someone else has this in their cart — only ${c.quantity} left for you`
                : "Someone else has the last one in their cart",
              { description: c.name }
            );
          });
        })
        .catch((error) =>
          console.warn("cart-hold failed; cart kept as is", {
            items: holdItems, replace, code: error.code, status: error.status, message: error.message,
          })
        );
    },
    [persist]
  );

  // Renew every line's hold and release holds on anything no longer in the
  // cart. Past the per-call line limit, renew the first lines without
  // releasing: the rest simply expire.
  const renewHolds = useCallback(() => {
    const current = itemsRef.current;
    if (!current.length) return;
    syncHolds(current.slice(0, MAX_HOLD_ITEMS), current.length <= MAX_HOLD_ITEMS);
  }, [syncHolds]);

  // Auth-driven sync. Subscribe directly to supabase.auth for event granularity
  // (merge only on a genuine SIGNED_IN, load-only on session restore).
  useEffect(() => {
    const syncWithServer = async (event) => {
      setSyncing(true);
      try {
        const server = await fetchServerCart();
        if (event === "SIGNED_IN") {
          // Genuine login: union guest + server (max), then persist the merge.
          const merged = mergeCarts(itemsRef.current, server);
          itemsRef.current = merged;
          setItems(merged);
          // Runs in the deferred sync, never inside the auth callback.
          renewHolds();
          await Promise.all(
            merged.map((i) =>
              upsertItem({ variant_id: i.variant_id, product_id: i.product_id, quantity: i.quantity })
            )
          ).catch(() => {});
        } else {
          // INITIAL_SESSION / TOKEN_REFRESHED: server is the source of truth.
          setItems(server);
        }
      } finally {
        setSyncing(false);
      }
    };

    // Must stay synchronous: supabase-js awaits this callback while holding its
    // auth lock (e.g. SIGNED_IN from initialize() for a stored session), and
    // every Supabase query first awaits getSession() on that same lock.
    // Awaiting a query here deadlocks the whole client — the storefront hangs
    // on skeletons for any returning signed-in visitor. Defer the work instead.
    // Pending syncs are cancelled on unmount, as in WishlistContext: a sync
    // that outlives its provider would still write to the server.
    const timers = new Set();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null;
      userIdRef.current = uid;

      if (!uid) {
        if (event === "SIGNED_OUT") setItems([]);
        return;
      }
      const t = setTimeout(() => {
        timers.delete(t);
        syncWithServer(event);
      }, 0);
      timers.add(t);
    });
    return () => {
      timers.forEach(clearTimeout);
      sub.subscription.unsubscribe();
    };
  }, [renewHolds]);

  // Returns how many units were added: fewer than asked (or 0) when the cart
  // would otherwise hold more than the known stock.
  const addItem = useCallback(
    (payload) => {
      const { variant_id, product_id, quantity } = payload;
      if (!quantity || quantity <= 0) return 0;
      const { items: next, added } = addToItems(itemsRef.current, payload);
      if (added === 0) return 0;
      itemsRef.current = next;
      setItems(next);
      const row = next.find((i) => i.variant_id === variant_id);
      persist(variant_id, { product_id, quantity: row.quantity });
      syncHolds([row]);
      trackEvent("add_to_cart", { product_id, variant_id, quantity: added });
      return added;
    },
    [persist, syncHolds]
  );

  const removeItem = useCallback(
    (variant_id) => {
      setItems((prev) => prev.filter((i) => i.variant_id !== variant_id));
      persist(variant_id, null);
      syncHolds([{ variant_id, quantity: 0 }]);
    },
    [persist, syncHolds]
  );

  const updateQty = useCallback(
    (variant_id, quantity) => {
      if (quantity <= 0) {
        setItems((prev) => prev.filter((i) => i.variant_id !== variant_id));
        persist(variant_id, null);
        syncHolds([{ variant_id, quantity: 0 }]);
        return;
      }
      const row = itemsRef.current.find((i) => i.variant_id === variant_id);
      const capped = Math.min(quantity, maxQuantity(row));
      setItems((prev) => prev.map((i) => (i.variant_id === variant_id ? { ...i, quantity: capped } : i)));
      if (row) {
        persist(variant_id, { product_id: row.product_id, quantity: capped });
        syncHolds([{ variant_id, quantity: capped }]);
      }
    },
    [persist, syncHolds]
  );

  const clearCart = useCallback(() => {
    setItems([]);
    if (userIdRef.current) clearServerCart().catch(() => {});
    syncHolds([], true);
  }, [syncHolds]);

  // Reconcile the current cart against live stock/price. Returns the changes so
  // the caller can surface toasts. Persists caps/removals when signed in.
  const revalidateCart = useCallback(async () => {
    const current = itemsRef.current;
    if (!current.length) return [];
    const live = await fetchLiveVariantData(current);
    const { items: next, changes } = revalidateItems(current, live);
    if (changes.length) {
      setItems(next);
      if (userIdRef.current) {
        changes.forEach((c) => {
          if (c.type === "removed") removeServerItem(c.variant_id).catch(() => {});
        });
        next.forEach((i) =>
          upsertItem({ variant_id: i.variant_id, product_id: i.product_id, quantity: i.quantity }).catch(() => {})
        );
      }
    }
    return changes;
  }, []);

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items, itemCount, isOpen, syncing, holdExpiresAt,
        openCart, closeCart, addItem, removeItem, updateQty, clearCart, revalidateCart, renewHolds,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
