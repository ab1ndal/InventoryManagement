import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addItem = useCallback(
    ({ variant_id, product_id, quantity, name, size, color, price, image_url }) => {
      if (!quantity || quantity <= 0) return;
      setItems((prev) => {
        const existing = prev.find((i) => i.variant_id === variant_id);
        if (existing) {
          return prev.map((i) =>
            i.variant_id === variant_id
              ? { ...i, quantity: i.quantity + quantity }
              : i
          );
        }
        return [
          ...prev,
          { variant_id, product_id, quantity, name, size, color, price, image_url },
        ];
      });
    },
    []
  );

  const removeItem = useCallback((variant_id) => {
    setItems((prev) => prev.filter((i) => i.variant_id !== variant_id));
  }, []);

  const updateQty = useCallback((variant_id, quantity) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((i) => i.variant_id !== variant_id));
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.variant_id === variant_id ? { ...i, quantity } : i))
    );
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        itemCount,
        isOpen,
        openCart,
        closeCart,
        addItem,
        removeItem,
        updateQty,
        clearCart,
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
