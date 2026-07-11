import React, {
  createContext, useContext, useState, useEffect, useCallback,
} from "react";

const STORAGE_KEY = "bc_wishlist";

export const WishlistContext = createContext(null);

export function WishlistProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const has = useCallback(
    (productid) => items.some((i) => i.productid === productid),
    [items]
  );

  const toggle = useCallback(({ productid, name, retailprice }) => {
    setItems((prev) =>
      prev.some((i) => i.productid === productid)
        ? prev.filter((i) => i.productid !== productid)
        : [...prev, { productid, name, retailprice }]
    );
  }, []);

  const remove = useCallback((productid) => {
    setItems((prev) => prev.filter((i) => i.productid !== productid));
  }, []);

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
