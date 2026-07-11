import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { X, ShoppingBag, Trash2 } from "lucide-react";
import { useCart } from "../../context/CartContext";

function CartItem({ item }) {
  const { removeItem, updateQty } = useCart();

  return (
    <div className="flex gap-4 py-4 border-b border-storefront-border">
      <div className="w-16 h-20 flex-shrink-0 overflow-hidden bg-storefront-cream">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-storefront-charcoal to-storefront-warm">
            <span className="font-display text-lg font-semibold text-storefront-gold opacity-60">
              {item.name?.[0]?.toUpperCase() ?? "B"}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-sans text-xs font-medium text-storefront-charcoal leading-snug line-clamp-2 mb-1">
          {item.name}
        </p>
        <p className="text-[10px] text-storefront-muted font-sans mb-2">
          {item.size} · {item.color}
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center border border-storefront-border">
            <button
              aria-label="Decrease quantity"
              onClick={() => updateQty(item.variant_id, Math.max(1, item.quantity - 1))}
              disabled={item.quantity <= 1}
              className="w-6 h-6 flex items-center justify-center text-storefront-charcoal hover:bg-storefront-cream disabled:opacity-30 disabled:cursor-not-allowed text-xs"
            >
              −
            </button>
            <span className="w-8 text-center text-xs font-sans tabular-nums">
              {item.quantity}
            </span>
            <button
              aria-label="Increase quantity"
              onClick={() => updateQty(item.variant_id, item.quantity + 1)}
              className="w-6 h-6 flex items-center justify-center text-storefront-charcoal hover:bg-storefront-cream text-xs"
            >
              +
            </button>
          </div>
          <p className="font-sans text-xs font-semibold text-storefront-charcoal tabular-nums">
            ₹{(item.price * item.quantity).toLocaleString("en-IN")}
          </p>
        </div>
      </div>

      <button
        aria-label="Remove item"
        onClick={() => removeItem(item.variant_id)}
        className="flex-shrink-0 p-1 text-storefront-muted hover:text-storefront-charcoal transition-colors"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export default function CartDrawer() {
  const { items, itemCount, isOpen, closeCart, revalidateCart } = useCart();
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  useEffect(() => {
    if (isOpen) revalidateCart();
  }, [isOpen, revalidateCart]);

  return (
    <>
      {isOpen && (
        <div
          data-testid="cart-backdrop"
          className="fixed inset-0 bg-storefront-charcoal/40 z-40"
          onClick={closeCart}
          aria-hidden="true"
        />
      )}

      <div
        role="dialog"
        aria-label="Shopping cart"
        aria-modal={isOpen}
        aria-hidden={!isOpen}
        {...(!isOpen && { inert: "" })}
        className={`fixed top-0 right-0 h-full w-full max-w-sm bg-white z-50 flex flex-col shadow-xl transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-storefront-border">
          <h2 className="font-display text-xl font-semibold text-storefront-charcoal">
            Cart{" "}
            {itemCount > 0 && (
              <span className="text-storefront-muted font-sans text-sm font-normal">
                ({itemCount})
              </span>
            )}
          </h2>
          <button
            aria-label="Close cart"
            onClick={closeCart}
            className="p-2 text-storefront-muted hover:text-storefront-charcoal transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 py-16">
              <ShoppingBag size={40} className="text-storefront-border" />
              <p className="font-sans text-sm text-storefront-muted">
                Your cart is empty.
              </p>
              <Link
                to="/shop"
                onClick={closeCart}
                className="text-xs font-sans tracking-widest uppercase text-storefront-charcoal border border-storefront-charcoal px-6 py-2.5 hover:bg-storefront-charcoal hover:text-storefront-cream transition-colors"
              >
                Shop Now
              </Link>
            </div>
          ) : (
            <div>
              {items.map((item) => (
                <CartItem key={item.variant_id} item={item} />
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-storefront-border px-5 py-5">
            <div className="flex justify-between mb-4">
              <span className="font-sans text-sm text-storefront-charcoal">
                Subtotal
              </span>
              <span className="font-sans text-sm font-semibold text-storefront-charcoal tabular-nums">
                ₹{subtotal.toLocaleString("en-IN")}
              </span>
            </div>
            <Link
              to="/cart"
              onClick={closeCart}
              className="block w-full text-center bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-4 hover:bg-storefront-warm transition-colors"
            >
              View cart
            </Link>
            <p className="text-[10px] text-storefront-muted font-sans text-center mt-3">
              Shipping calculated at checkout
            </p>
          </div>
        )}
      </div>
    </>
  );
}
