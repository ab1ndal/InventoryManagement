import React, { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ShoppingBag, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useProduct } from "../hooks/useProduct";
import { getProductImagePaths, imageUrl } from "../lib/productImage";
import BlurFillImage from "../components/BlurFillImage";
import VariantPicker from "../components/product/VariantPicker";
import ProductSpecs from "../components/product/ProductSpecs";
import { useCart } from "../context/CartContext";
import Seo from "../components/Seo";
import { buildProductJsonLd } from "../lib/seo";
import { DELIVERY_ESTIMATE, stockNote } from "../lib/deliveryEstimate";

// Descriptions are stored with lightweight Markdown (**bold**). Render the
// bold spans as <strong> instead of printing literal asterisks.
function renderDescription(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? (
      <strong key={i} className="font-semibold text-storefront-charcoal">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

function GalleryPlaceholder({ name }) {
  const initials = name
    ? name
        .split(/[\s-]+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : "BC";
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-storefront-charcoal to-storefront-warm gap-3">
      <span className="font-display text-5xl font-semibold text-storefront-gold opacity-60">
        {initials}
      </span>
      <span className="text-[10px] text-storefront-cream/40 tracking-widest uppercase font-sans">
        Image coming soon
      </span>
    </div>
  );
}

function ProductGallery({ paths, name, active, onSelect }) {
  const touchX = useRef(null);
  const count = paths.length;
  const hasGallery = count > 1;

  const step = (dir) => onSelect((active + dir + count) % count);

  const onTouchStart = (e) => {
    touchX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e) => {
    if (touchX.current === null || !hasGallery) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
    touchX.current = null;
  };

  return (
    <div className="flex flex-col-reverse sm:flex-row gap-3">
      {/* Thumbnail rail */}
      {hasGallery && (
        <div className="flex sm:flex-col gap-2 overflow-x-auto sm:overflow-visible sm:w-[72px] flex-shrink-0">
          {paths.map((path, i) => (
            <button
              key={path}
              type="button"
              aria-label={`View image ${i + 1}`}
              aria-current={i === active}
              onClick={() => onSelect(i)}
              className={`relative w-16 sm:w-full aspect-[3/4] flex-shrink-0 overflow-hidden border transition-colors duration-200 cursor-pointer ${
                i === active
                  ? "border-storefront-gold"
                  : "border-storefront-border/60 hover:border-storefront-charcoal/50"
              }`}
            >
              <img
                src={imageUrl(path, { width: 150, quality: 55 })}
                alt=""
                loading="lazy"
                draggable={false}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Main image */}
      <div
        className="group relative flex-1 aspect-[3/4] overflow-hidden bg-storefront-cream"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {count > 0 ? (
          <BlurFillImage
            key={paths[active]}
            path={paths[active]}
            alt={name}
            width={1000}
            quality={80}
            eager
          />
        ) : (
          <GalleryPlaceholder name={name} />
        )}

        {hasGallery && (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => step(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-white/85 backdrop-blur-sm text-storefront-charcoal opacity-0 group-hover:opacity-100 hover:bg-white transition-opacity duration-200 cursor-pointer hidden sm:flex"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => step(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white/85 backdrop-blur-sm text-storefront-charcoal opacity-0 group-hover:opacity-100 hover:bg-white transition-opacity duration-200 cursor-pointer hidden sm:flex"
            >
              <ChevronRight size={18} />
            </button>
            <span className="absolute bottom-2.5 right-3 bg-storefront-charcoal/70 text-white text-[10px] font-sans tracking-wide px-2 py-0.5 tabular-nums">
              {active + 1} / {count}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default function ProductDetailPage() {
  const { productid } = useParams();
  const { product, variants, loading, error } = useProduct(productid);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [imagePaths, setImagePaths] = useState([]);
  const [activeImage, setActiveImage] = useState(0);
  const { addItem, openCart } = useCart();

  useEffect(() => {
    let active = true;
    getProductImagePaths(productid).then((paths) => {
      if (active) {
        setImagePaths(paths);
        setActiveImage(0);
      }
    });
    return () => {
      active = false;
    };
  }, [productid]);

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
        <Seo title="Product not found" noindex />
        <p className="font-sans text-storefront-muted text-sm mb-4">
          Product not found.
        </p>
        <Link
          to="/shop"
          className="text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline"
        >
          ← Back to Shop
        </Link>
      </div>
    );
  }

  const categoryName = product.categories?.name;
  const productLd = buildProductJsonLd({ product, variants, imagePaths, productid, categoryName });
  const ogImage = imagePaths.length
    ? imageUrl(imagePaths[0], { width: 1200, quality: 80 })
    : undefined;
  const maxQty = selectedVariant?.stock ?? 0;
  const canAddToCart = selectedVariant !== null && maxQty > 0;
  const stockLabel = selectedVariant ? stockNote(selectedVariant.stock) : null;

  function handleVariantSelect(variant) {
    setSelectedVariant(variant);
    setQuantity(1);
  }

  function handleAddToCart() {
    if (!canAddToCart) return;
    addItem({
      variant_id: selectedVariant.variantid,
      product_id: productid,
      quantity,
      name: product.name,
      size: selectedVariant.size,
      color: selectedVariant.color,
      price: Number(product.retailprice),
      image_url: imageUrl(imagePaths[activeImage] ?? imagePaths[0], {
        width: 400,
        quality: 70,
      }),
    });
    toast.success("Added to cart", {
      action: {
        label: "View cart",
        onClick: openCart,
      },
    });
  }

  return (
    <>
      <Seo
        title={product.name}
        description={
          product.description
            ? product.description.replace(/\*\*/g, "").slice(0, 160)
            : `${product.name}${categoryName ? ` — ${categoryName}` : ""} · ₹${Number(product.retailprice).toLocaleString("en-IN")}`
        }
        type="product"
        image={ogImage}
        jsonLd={productLd}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 md:pb-8">
        {/* Breadcrumb */}
        <Link
          to="/shop"
          className="inline-flex items-center gap-1.5 text-[10px] font-sans tracking-[0.15em] uppercase text-storefront-muted hover:text-storefront-charcoal transition-colors mb-8"
        >
          <ArrowLeft size={11} />
          Shop
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16">
          {/* Gallery */}
          <div>
            <ProductGallery
              paths={imagePaths}
              name={product.name}
              active={activeImage}
              onSelect={setActiveImage}
            />
          </div>

          {/* Details */}
          <div className="flex flex-col">
            {categoryName && (
              <span className="text-[10px] tracking-[0.2em] uppercase text-storefront-muted font-sans mb-2">
                {categoryName}
              </span>
            )}

            <h1 className="font-display text-3xl lg:text-4xl font-semibold text-storefront-charcoal leading-tight mb-3">
              {product.name}
            </h1>

            <p className="font-sans text-2xl font-semibold text-storefront-charcoal tabular-nums mb-1">
              ₹{Number(product.retailprice).toLocaleString("en-IN")}
            </p>

            <p className="text-xs text-storefront-muted font-sans tracking-wide mb-3">
              {DELIVERY_ESTIMATE}
            </p>

            {product.description && (
              <p className="text-sm text-storefront-charcoal font-sans leading-relaxed mb-6 whitespace-pre-line">
                {renderDescription(product.description)}
              </p>
            )}

            <ProductSpecs fabric={product.fabric} category={categoryName} />

            <div className="border-t border-storefront-border pt-6 mb-6">
              {variants.length > 0 ? (
                <VariantPicker
                  variants={variants}
                  onVariantSelect={handleVariantSelect}
                />
              ) : (
                <p className="text-xs text-storefront-muted font-sans">
                  No variants available.
                </p>
              )}
              <Link
                to="/size-guide"
                className="inline-block mt-4 text-xs font-sans tracking-wide text-storefront-muted hover:text-storefront-gold underline underline-offset-2 transition-colors"
              >
                Size guide
              </Link>
            </div>

            {/* Quantity selector */}
            {canAddToCart && (
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[10px] font-medium tracking-[0.15em] uppercase text-storefront-charcoal font-sans">
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
                  <span className="w-10 text-center text-sm font-sans tabular-nums">
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
                onClick={handleAddToCart}
                className="w-full flex items-center justify-center gap-2 bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-4 hover:bg-storefront-warm transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ShoppingBag size={15} />
                {canAddToCart ? "Add to Cart" : "Select Size & Colour"}
              </button>
              {stockLabel && (
                <p className="text-xs text-center text-storefront-muted font-sans mt-2.5">
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
          onClick={handleAddToCart}
          className="w-full flex items-center justify-center gap-2 bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-3.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ShoppingBag size={15} />
          {canAddToCart ? "Add to Cart" : "Select Size & Colour"}
        </button>
      </div>
    </>
  );
}
