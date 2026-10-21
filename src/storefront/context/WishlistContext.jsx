import React, {
  createContext, useContext, useState, useEffect, useCallback, useRef,
} from "react";
import { supabase } from "lib/supabaseClient";
import {
  fetchServerWishlist, addServerItems, removeServerItem, isMissingTableError,
} from "../lib/wishlistApi";

const STORAGE_KEY = "bc_wishlist";
// User id whose server wishlist the local list mirrors. Absent = the local list
// is a guest list (or predates server sync) and must be merged on sign-in;
// present = it is a cached copy and the server wins (so removals made on
// another device are not resurrected).
const OWNER_KEY = "bc_wishlist_owner";

export const WishlistContext = createContext(null);

const toSnapshot = ({ productid, name, retailprice }) => ({ productid, name, retailprice });

export function WishlistProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const userIdRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Set once wishlist_items turns out not to exist (migration not applied):
  // from then on this session behaves exactly like the guest wishlist.
  const serverDisabledRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  // Returns true when the error was the missing table (already handled).
  const handleMissingTable = useCallback((error) => {
    if (!isMissingTableError(error)) return false;
    if (!serverDisabledRef.current) {
      serverDisabledRef.current = true;
      console.warn("wishlist_items table not found; wishlist stays local-only", error);
    }
    return true;
  }, []);

  useEffect(() => {
    // Unmount (incl. StrictMode's dev remount) must stop pending syncs, or a
    // stale provider writes OWNER_KEY to the shared localStorage.
    let active = true;
    const timers = new Set();

    const syncWithServer = async (uid) => {
      if (serverDisabledRef.current) return;
      let server;
      try {
        server = await fetchServerWishlist();
      } catch (error) {
        if (!handleMissingTable(error)) console.error("Wishlist load failed", { uid, error });
        return;
      }
      if (!active || userIdRef.current !== uid) return; // unmounted or signed out while loading

      if (localStorage.getItem(OWNER_KEY)) {
        setItems(server);
        localStorage.setItem(OWNER_KEY, uid);
        return;
      }
      const serverIds = new Set(server.map((i) => i.productid));
      const guestOnly = itemsRef.current.filter((i) => !serverIds.has(i.productid));
      setItems([...server, ...guestOnly]);
      try {
        await addServerItems(uid, guestOnly.map((i) => i.productid));
        if (active) localStorage.setItem(OWNER_KEY, uid);
      } catch (error) {
        // Owner stays unset, so the next sign-in retries the merge.
        if (!handleMissingTable(error)) console.error("Wishlist merge failed", { uid, error });
      }
    };

    // Must stay synchronous: supabase-js awaits this callback while holding its
    // auth lock, and every query first awaits getSession() on that same lock.
    // Awaiting a query here deadlocks the client (see CartContext). Defer.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null;
      userIdRef.current = uid;

      if (!uid) {
        if (event === "SIGNED_OUT" && !serverDisabledRef.current) {
          // The list lives on the account; don't leave it on a shared device.
          setItems([]);
          localStorage.removeItem(OWNER_KEY);
        }
        return;
      }
      const t = setTimeout(() => {
        timers.delete(t);
        syncWithServer(uid);
      }, 0);
      timers.add(t);
    });
    return () => {
      active = false;
      timers.forEach(clearTimeout);
      sub.subscription.unsubscribe();
    };
  }, [handleMissingTable]);

  // Optimistic server write; on failure undo just this change.
  const writeThrough = useCallback(
    (op, snapshot) => {
      const uid = userIdRef.current;
      if (!uid || serverDisabledRef.current) return;
      const { productid } = snapshot;
      const request = op === "add" ? addServerItems(uid, [productid]) : removeServerItem(uid, productid);
      request.catch((error) => {
        if (handleMissingTable(error)) return;
        console.error(`Wishlist ${op} failed; reverting`, { uid, productid, error });
        setItems((prev) => {
          const present = prev.some((i) => i.productid === productid);
          if (op === "add") return present ? prev.filter((i) => i.productid !== productid) : prev;
          return present ? prev : [...prev, snapshot];
        });
      });
    },
    [handleMissingTable]
  );

  const has = useCallback(
    (productid) => items.some((i) => i.productid === productid),
    [items]
  );

  const toggle = useCallback(
    (product) => {
      const snapshot = toSnapshot(product);
      const present = itemsRef.current.some((i) => i.productid === snapshot.productid);
      setItems((prev) =>
        prev.some((i) => i.productid === snapshot.productid)
          ? prev.filter((i) => i.productid !== snapshot.productid)
          : [...prev, snapshot]
      );
      writeThrough(present ? "remove" : "add", snapshot);
    },
    [writeThrough]
  );

  const remove = useCallback(
    (productid) => {
      const existing = itemsRef.current.find((i) => i.productid === productid);
      setItems((prev) => prev.filter((i) => i.productid !== productid));
      if (existing) writeThrough("remove", existing);
    },
    [writeThrough]
  );

  return (
    <WishlistContext.Provider value={{ items, has, toggle, remove, count: items.length }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used inside WishlistProvider");
  return ctx;
}
