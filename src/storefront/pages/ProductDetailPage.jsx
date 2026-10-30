import React, { useState, useEffect, useRef, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
  Expand,
  Heart,
  MessageCircle,
  RefreshCw,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { useProduct } from "../hooks/useProduct";
import { useVariantAvailability } from "../hooks/useVariantAvailability";
import { getProductImagePaths, imageUrl, imageColor } from "../lib/productImage";
import BlurFillImage from "../components/BlurFillImage";
import VariantPicker from "../components/product/VariantPicker";
import ProductSpecs from "../components/product/ProductSpecs";
import SizeGuideDialog from "../components/product/SizeGuideDialog";
import { formatSize, compareSizes } from "../lib/sizes";
import ImageLightbox from "../components/product/ImageLightbox";
import StickyAddToCart from "../components/product/StickyAddToCart";
import { flyToCart } from "../lib/flyToCart";
import MoreLikeThis from "../components/product/MoreLikeThis";
import { useCart } from "../context/CartContext";
import Seo from "../components/Seo";
import { buildProductJsonLd } from "../lib/seo";
import { DELIVERY_ESTIMATE, PRICE_NOTE, stockNote, heldNote } from "../lib/deliveryEstimate";
import { stripMarkdown, whatsappProductUrl } from "../lib/productText";
import { isSoldOut } from "../lib/stock";

const TRUST_POINTS = [
  { icon: Heart, label: "Handpicked with love" },
  { icon: RefreshCw, label: "7-day returns & exchange" },
  { icon: MessageCircle, label: "WhatsApp help" },
];

// Distinct values in first-seen order (variants arrive sorted by size, colour).
function unique(values) {
  return [...new Set(values.filter(Boolean))];
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

function ProductGallery({ paths, name, active, onSelect, onEnlarge }) {
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
        <div className="flex sm:flex-col gap-2 overflow-x-auto sm:overflow-visible md:max-h-[calc(100svh-182px)] md:overflow-y-auto sm:w-[72px] flex-shrink-0">
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
                src={imageUrl(path, { width: 150 })}
                alt=""
                loading="lazy"
                draggable={false}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Main image. On md+ the width is capped so the 3:4 frame fits the
          screen below the sticky header (166px) with 16px to spare;
          otherwise landscape screens cut off the top and bottom. self-start
          stops the row stretching it to the thumbnail rail's height. */}
      <div
        className="group relative flex-1 self-start aspect-[3/4] md:max-w-[calc((100svh-182px)*0.75)] overflow-hidden bg-storefront-cream"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {count > 0 ? (
          <button
            type="button"
            aria-label="Enlarge image"
            onClick={onEnlarge}
            className="block w-full h-full cursor-zoom-in"
          >
            <BlurFillImage
              key={paths[active]}
              path={paths[active]}
              alt={name}
              width={1000}
              fit="cover"
              eager
            />
            <span className="pointer-events-none absolute top-3 right-3 p-2 bg-white/85 text-storefront-charcoal opacity-0 group-hover:opacity-100 transition-opacity duration-200 hidden sm:flex">
              <Expand size={15} aria-hidden="true" />
            </span>
          </button>
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

// Keyed by product so following a "More like this" card starts the new
// product fresh (no selected variant, quantity or photo carried over).
// StorefrontLayout scrolls each new page to the top.
export default function ProductDetailPage() {
  const { productid } = useParams();

  return <ProductDetail key={productid} productid={productid} />;
}

function ProductDetail({ productid }) {
  const { product, variants, loading, error } = useProduct(productid);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [imagePaths, setImagePaths] = useState([]);
  const [activeImage, setActiveImage] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const addToCartRef = useRef(null);
  const pickerRef = useRef(null);
  const { addItem, openCart } = useCart();
  const availability = useVariantAvailability(selectedVariant?.variantid);

  const colours = useMemo(() => unique(variants.map((v) => v.color)), [variants]);
  // In-stock sizes for the Details table (stock summed across colours).
  const sizes = useMemo(
    () =>
      unique(variants.filter((v) => v.stock > 0).map((v) => v.size))
        .sort(compareSizes)
        .map(formatSize),
    [variants]
  );

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
  const description = stripMarkdown(product.description);
  const price = Number(product.retailprice);
  const soldOut = isSoldOut(variants);
  const productLd = buildProductJsonLd({
    product: { ...product, description },
    variants,
    imagePaths,
    productid,
    categoryName,
  });
  const ogImage = imagePaths.length
    ? imageUrl(imagePaths[0], { width: 1200 })
    : undefined;
  // What this shopper can buy: stock minus other shoppers' cart holds. Raw
  // stock until that loads (or if it can't be read).
  const maxQty = availability ? Number(availability.available) : selectedVariant?.stock ?? 0;
  const heldByOthers = availability !== null && Number(availability.stock) > 0 && maxQty <= 0;
  const canAddToCart = selectedVariant !== null && maxQty > 0;
  const stockLabel = heldByOthers
    ? heldNote(availability.others_expire_at)
    : selectedVariant
      ? stockNote(maxQty)
      : null;
  const whatsappHref = whatsappProductUrl({
    name: product.name,
    productid,
    pageUrl: `${window.location.origin}/product/${productid}`,
  });

  function handleVariantSelect(variant) {
    setSelectedVariant(variant);
    setQuantity(1);
    showColourPhoto(variant?.color);
  }

  // Jump to a photo of the picked colour (owner 2026-10-25). Stay put when
  // the current photo already shows it or no photo is tagged with it.
  function showColourPhoto(colour) {
    if (!colour) return;
    const isColour = (path) => imageColor(path)?.toLowerCase() === colour.toLowerCase();
    if (isColour(imagePaths[activeImage])) return;
    const index = imagePaths.findIndex(isColour);
    if (index >= 0) setActiveImage(index);
  }

  function handleAddToCart(event) {
    if (!canAddToCart) return;
    const photo = imagePaths[activeImage] ?? imagePaths[0];
    const added = addItem({
      variant_id: selectedVariant.variantid,
      product_id: productid,
      quantity,
      name: product.name,
      size: selectedVariant.size,
      color: selectedVariant.color,
      price,
      image_url: imageUrl(photo, {
        width: 400,
      }),
      stock: maxQty,
    });
    if (added === 0) {
      const inCart =
        maxQty === 1
          ? "The last piece is already in your cart"
          : `All ${maxQty} in stock are already in your cart`;
      toast.info(inCart, {
        action: { label: "View cart", onClick: openCart },
      });
      return;
    }
    flyToCart({
      from: event.currentTarget,
      image: photo ? imageUrl(photo, { width: 150 }) : null,
    });
    const message =
      added < quantity ? `Only ${maxQty} in stock — your cart now has all of them` : "Added to cart";
    toast.success(message, {
      action: {
        label: "View cart",
        onClick: openCart,
      },
    });
  }

  // The sticky bar can't host the size picker, so until a variant is chosen
  // its button takes the shopper back up to the picker instead.
  function handleStickyClick(event) {
    if (canAddToCart) handleAddToCart(event);
    else if (!heldByOthers) pickerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <>
      <Seo
        title={product.name}
        description={
          description
            ? description.slice(0, 160)
            : `${product.name}${categoryName ? ` — ${categoryName}` : ""} · ₹${price.toLocaleString("en-IN")}`
        }
        type="product"
        image={ogImage}
        jsonLd={productLd}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28">
        {/* Breadcrumb */}
        <Link
          to="/shop"
          className="inline-flex items-center gap-1.5 text-[10px] font-sans tracking-[0.15em] uppercase text-storefront-muted hover:text-storefront-charcoal transition-colors mb-8"
        >
          <ArrowLeft size={11} />
          Shop
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-16">
          {/* Gallery — stays in view on desktop while the info column scrolls.
              The sticky header is 150px tall on md+, so stick 16px below it. */}
          <div className="md:sticky md:top-[166px] md:self-start">
            <ProductGallery
              paths={imagePaths}
              name={product.name}
              active={activeImage}
              onSelect={setActiveImage}
              onEnlarge={() => setLightboxOpen(true)}
            />
          </div>

          {/* Info */}
          <div className="flex flex-col">
            <h1 className="font-display text-3xl lg:text-4xl font-semibold text-storefront-charcoal leading-tight mb-3">
              {product.name}
            </h1>

            {soldOut ? (
              <p className="font-sans text-2xl font-semibold text-storefront-muted mb-6">
                Sold out
              </p>
            ) : (
              <>
                <p className="font-sans text-2xl font-semibold text-storefront-charcoal tabular-nums mb-1">
                  ₹{price.toLocaleString("en-IN")}
                </p>

                <p className="text-xs text-storefront-muted font-sans tracking-wide mb-6">
                  {PRICE_NOTE}
                </p>
              </>
            )}

            <div ref={pickerRef} className="border-t border-storefront-border pt-6 mb-6">
              {variants.length > 0 ? (
                <VariantPicker
                  variants={variants}
                  onVariantSelect={handleVariantSelect}
                  sizeAction={<SizeGuideDialog />}
                />
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-storefront-muted font-sans">
                    No variants available.
                  </p>
                  <SizeGuideDialog />
                </div>
              )}
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

            {/* Add to Cart — the sticky bar takes over once this leaves view */}
            <button
              ref={addToCartRef}
              disabled={!canAddToCart}
              onClick={handleAddToCart}
              className="w-full flex items-center justify-center gap-2 bg-storefront-gold text-white font-sans text-xs tracking-widest uppercase py-4 hover:bg-storefront-gold-dark transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShoppingBag size={15} aria-hidden="true" />
              {canAddToCart ? "Add to Cart" : heldByOthers ? "In someone's cart" : "Select Size & Colour"}
            </button>
            {stockLabel && (
              <p className="text-xs text-center text-storefront-muted font-sans mt-2.5">
                {stockLabel}
              </p>
            )}

            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 w-full flex items-center justify-center gap-2 border border-storefront-charcoal text-storefront-charcoal font-sans text-xs tracking-widest uppercase py-3.5 hover:bg-storefront-charcoal hover:text-storefront-cream transition-colors duration-150"
            >
              <MessageCircle size={15} aria-hidden="true" />
              Ask on WhatsApp
            </a>

            <p className="flex items-center gap-2 text-xs text-storefront-charcoal font-sans tracking-wide mt-5">
              <Truck size={15} className="text-storefront-gold flex-shrink-0" aria-hidden="true" />
              {DELIVERY_ESTIMATE}
            </p>
            <p className="text-xs text-storefront-muted font-sans mt-2">
              Want it in another colour or size?{" "}
              <Link to="/customize" className="text-storefront-charcoal underline underline-offset-2 hover:text-storefront-gold">
                Our tailors can make it for you
              </Link>
            </p>

            <ul className="grid grid-cols-3 gap-2 border-y border-storefront-border/70 py-4 mt-5 mb-8">
              {TRUST_POINTS.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex flex-col items-center text-center gap-1.5 text-[11px] leading-snug text-storefront-muted font-sans"
                >
                  <Icon size={16} className="text-storefront-gold" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>

            <ProductSpecs
              productId={productid}
              fabric={product.fabric}
              category={categoryName}
              colours={colours}
              sizes={sizes}
            />

            {description && (
              <section aria-labelledby="product-description">
                <h2
                  id="product-description"
                  className="text-[10px] font-medium tracking-[0.2em] uppercase text-storefront-charcoal font-sans mb-3"
                >
                  Description
                </h2>
                <p className="text-sm text-storefront-charcoal font-sans leading-relaxed whitespace-pre-line">
                  {description}
                </p>
              </section>
            )}
          </div>
        </div>

        <MoreLikeThis product={product} colours={colours} />
      </div>

      <ImageLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        paths={imagePaths}
        index={activeImage}
        onIndexChange={setActiveImage}
        name={product.name}
      />

      <StickyAddToCart
        targetRef={addToCartRef}
        image={imagePaths.length ? imageUrl(imagePaths[0], { width: 150 }) : null}
        name={product.name}
        price={price}
        soldOut={soldOut}
        label={canAddToCart ? "Add to Cart" : heldByOthers ? "In someone's cart" : "Select size"}
        disabled={heldByOthers}
        onClick={handleStickyClick}
      />
    </>
  );
}
