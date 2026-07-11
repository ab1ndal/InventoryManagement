import React, {
  createContext, useContext, useState, useEffect, useCallback, useRef,
} from "react";
import { supabase } from "lib/supabaseClient";
import { mergeCarts, revalidateItems } from "../lib/cartLogic";
import {
  fetchServerCart, upsertItem, removeServerItem, clearServerCart, fetchLiveVariantData,
} from "../lib/cartApi";
import { trackEvent } from "../lib/analytics";

const STORAGE_KEY = "bc_cart";

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
  const userIdRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  // Auth-driven sync. Subscribe directly to supabase.auth for event granularity
  // (merge only on a genuine SIGNED_IN, load-only on session restore).
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      const uid = session?.user?.id ?? null;
      userIdRef.current = uid;

      if (!uid) {
        if (event === "SIGNED_OUT") setItems([]);
        return;
      }
      setSyncing(true);
      try {
        const server = await fetchServerCart();
        if (event === "SIGNED_IN") {
          // Genuine login: union guest + server (max), then persist the merge.
          const merged = mergeCarts(itemsRef.current, server);
          setItems(merged);
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
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const persist = useCallback((variant_id, next) => {
    if (!userIdRef.current) return;
    if (next) {
      upsertItem({ variant_id, product_id: next.product_id, quantity: next.quantity }).catch(() => {});
    } else {
      removeServerItem(variant_id).catch(() => {});
    }
  }, []);

  const addItem = useCallback(
    (payload) => {
      const { variant_id, product_id, quantity } = payload;
      if (!quantity || quantity <= 0) return;
      const existing = itemsRef.current.find((i) => i.variant_id === variant_id);
      const nextQuantity = existing ? existing.quantity + quantity : quantity;
      setItems((prev) => {
        const exists = prev.find((i) => i.variant_id === variant_id);
        return exists
          ? prev.map((i) => (i.variant_id === variant_id ? { ...i, quantity: i.quantity + quantity } : i))
          : [...prev, { ...payload }];
      });
      persist(variant_id, { product_id, quantity: nextQuantity });
      trackEvent("add_to_cart", { product_id, variant_id, quantity });
    },
    [persist]
  );

  const removeItem = useCallback(
    (variant_id) => {
      setItems((prev) => prev.filter((i) => i.variant_id !== variant_id));
      persist(variant_id, null);
    },
    [persist]
  );

  const updateQty = useCallback(
    (variant_id, quantity) => {
      if (quantity <= 0) {
        setItems((prev) => prev.filter((i) => i.variant_id !== variant_id));
        persist(variant_id, null);
        return;
      }
      const row = itemsRef.current.find((i) => i.variant_id === variant_id);
      setItems((prev) => prev.map((i) => (i.variant_id === variant_id ? { ...i, quantity } : i)));
      if (row) persist(variant_id, { product_id: row.product_id, quantity });
    },
    [persist]
  );

  const clearCart = useCallback(() => {
    setItems([]);
    if (userIdRef.current) clearServerCart().catch(() => {});
  }, []);

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
        items, itemCount, isOpen, syncing,
        openCart, closeCart, addItem, removeItem, updateQty, clearCart, revalidateCart,
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
