import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import { useProduct } from "../hooks/useProduct";
import VariantPicker from "../components/product/VariantPicker";

function ProductImage({ product }) {
  const [failed, setFailed] = useState(false);
  const url =
    product.image_url ||
    (product.producturl ? `${product.producturl}/display/image.jpg` : null);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={product.name}
        onError={() => setFailed(true)}
        className="w-full h-full object-cover"
      />
    );
  }

  const initials = product.name
    ? product.name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : "BC";

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-storefront-charcoal to-storefront-warm gap-3">
      <span className="font-cormorant text-5xl font-semibold text-storefront-gold opacity-60">
        {initials}
      </span>
      <span className="text-[10px] text-storefront-cream/40 tracking-widest uppercase font-montserrat">
        Image coming soon
      </span>
    </div>
  );
}

export default function ProductDetailPage() {
  const { productid } = useParams();
  const { product, variants, loading, error } = useProduct(productid);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [quantity, setQuantity] = useState(1);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 flex justify-center">
        <div className="w-7 h-7 border-2 border-storefront-charcoal border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <p className="font-montserrat text-storefront-muted text-sm mb-4">
          Product not found.
        </p>
        <Link
          to="/shop"
          className="text-xs font-montserrat tracking-widest uppercase text-storefront-gold hover:underline"
        >
          ← Back to Shop
        </Link>
      </div>
    );
  }

  const categoryName = product.categories?.name;
  const maxQty = selectedVariant?.stock ?? 0;
  const canAddToCart = selectedVariant !== null && maxQty > 0;
  const stockLabel =
    selectedVariant && selectedVariant.stock <= 3
      ? `Only ${selectedVariant.stock} left`
      : selectedVariant
      ? "In stock"
      : null;

  function handleVariantSelect(variant) {
    setSelectedVariant(variant);
    setQuantity(1);
  }

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 md:pb-8">
        {/* Breadcrumb */}
        <Link
          to="/shop"
          className="inline-flex items-center gap-1.5 text-[10px] font-montserrat tracking-[0.15em] uppercase text-storefront-muted hover:text-storefront-charcoal transition-colors mb-8"
        >
          <ArrowLeft size={11} />
          Shop
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16">
          {/* Image */}
          <div className="aspect-[3/4] overflow-hidden bg-storefront-cream">
            <ProductImage product={product} />
          </div>

          {/* Details */}
          <div className="flex flex-col">
            {categoryName && (
              <span className="text-[10px] tracking-[0.2em] uppercase text-storefront-muted font-montserrat mb-2">
                {categoryName}
              </span>
            )}

            <h1 className="font-cormorant text-3xl lg:text-4xl font-semibold text-storefront-charcoal leading-tight mb-3">
              {product.name}
            </h1>

            <p className="font-montserrat text-2xl font-semibold text-storefront-charcoal tabular-nums mb-1">
              ₹{Number(product.retailprice).toLocaleString("en-IN")}
            </p>

            {product.fabric && (
              <p className="text-xs text-storefront-muted font-montserrat tracking-wide mb-3">
                {product.fabric}
              </p>
            )}

            {product.description && (
              <p className="text-sm text-storefront-charcoal font-montserrat leading-relaxed mb-6">
                {product.description}
              </p>
            )}

            <div className="border-t border-storefront-border pt-6 mb-6">
              {variants.length > 0 ? (
                <VariantPicker
                  variants={variants}
                  onVariantSelect={handleVariantSelect}
                />
              ) : (
                <p className="text-xs text-storefront-muted font-montserrat">
                  No variants available.
                </p>
              )}
            </div>

            {/* Quantity selector */}
            {canAddToCart && (
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[10px] font-medium tracking-[0.15em] uppercase text-storefront-charcoal font-montserrat">
                  Qty
                </span>
                <div className="flex items-center border border-storefront-border">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={quantity <= 1}
                    className="w-8 h-8 flex items-center justify-center text-storefront-charcoal hover:bg-storefront-cream disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    −
                  </button>
                  <span className="w-10 text-center text-sm font-montserrat tabular-nums">
                    {quantity}
                  </span>
                  <button
                    onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
                    disabled={quantity >= maxQty}
                    className="w-8 h-8 flex items-center justify-center text-storefront-charcoal hover:bg-storefront-cream disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* Desktop Add to Cart */}
            <div className="hidden md:block">
              <button
                disabled={!canAddToCart}
                onClick={() => {}} /* wired in Phase 1 */
                className="w-full flex items-center justify-center gap-2 bg-storefront-charcoal text-storefront-cream font-montserrat text-xs tracking-widest uppercase py-4 hover:bg-storefront-warm transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ShoppingBag size={15} />
                {canAddToCart ? "Add to Cart" : "Select Size & Colour"}
              </button>
              {stockLabel && (
                <p className="text-xs text-center text-storefront-muted font-montserrat mt-2.5">
                  {stockLabel}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 md:hidden bg-white border-t border-storefront-border px-4 py-3 z-40">
        <button
          disabled={!canAddToCart}
          onClick={() => {}} /* wired in Phase 1 */
          className="w-full flex items-center justify-center gap-2 bg-storefront-charcoal text-storefront-cream font-montserrat text-xs tracking-widest uppercase py-3.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ShoppingBag size={15} />
          {canAddToCart ? "Add to Cart" : "Select Size & Colour"}
        </button>
      </div>
    </>
  );
}
