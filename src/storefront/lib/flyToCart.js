// Add-to-cart flourish (owner 2026-10-29): a shopping bag pops up over the
// clicked button, the dress drops into it, and the bag flies up into the
// header cart icon, which bounces as it lands. Purely decorative: the cart is
// already updated before this runs, so skipping it loses nothing.

const BAG_W = 56;
const BAG_H = 64;
const DRESS_W = 40;
const DRESS_H = 54;
const BAG_LIFT = 70; // how far above the button the bag appears

const POP_MS = 220;
const DROP_MS = 520;
const FLY_MS = 600;

// The handle and the back of the bag sit behind the dress, the front panel in
// front of it, so the dress looks like it slips inside.
const BAG_BACK = `
  <svg viewBox="0 0 56 64" width="${BAG_W}" height="${BAG_H}" aria-hidden="true">
    <path d="M19 20V13a9 9 0 0 1 18 0v7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <rect x="6" y="18" width="44" height="44" rx="4" fill="currentColor" opacity="0.55"/>
  </svg>`;
const BAG_FRONT = `
  <svg viewBox="0 0 56 64" width="${BAG_W}" height="${BAG_H}" aria-hidden="true">
    <path d="M4 26h48l-2 32a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z" fill="currentColor"/>
    <path d="M20 36a8 8 0 0 0 16 0" fill="none" stroke="#FAFAF9" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function canAnimate() {
  return typeof document.body.animate === "function" && !prefersReducedMotion();
}

function centre(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function layer(className, style) {
  const el = document.createElement("div");
  el.className = className;
  Object.assign(el.style, { position: "absolute", ...style });
  return el;
}

// `from` is the element that was clicked; `image` the dress photo URL. The
// header cart button carries `data-cart-target`. Resolves once the animation
// (if any) has finished and its nodes are removed.
export function flyToCart({ from, image }) {
  const target = document.querySelector("[data-cart-target]");
  if (!from || !target || !canAnimate()) return Promise.resolve();
  const targetRect = target.getBoundingClientRect();
  if (!targetRect.width) return Promise.resolve();

  const fromRect = from.getBoundingClientRect();
  const start = centre(fromRect);
  const bagX = start.x;
  const bagY = Math.max(fromRect.top - BAG_LIFT, BAG_H);
  const end = centre(targetRect);

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "70",
  });
  overlay.setAttribute("aria-hidden", "true");

  const bag = layer("text-storefront-gold", {
    left: `${bagX - BAG_W / 2}px`,
    top: `${bagY - BAG_H / 2}px`,
    width: `${BAG_W}px`,
    height: `${BAG_H}px`,
  });
  const back = layer("", { inset: "0" });
  back.innerHTML = BAG_BACK;
  const front = layer("", { inset: "0" });
  front.innerHTML = BAG_FRONT;
  bag.append(back);

  let drop = null;
  if (image) {
    const dress = document.createElement("img");
    dress.src = image;
    dress.alt = "";
    Object.assign(dress.style, {
      position: "absolute",
      left: `${(BAG_W - DRESS_W) / 2}px`,
      top: `${(BAG_H - DRESS_H) / 2}px`,
      width: `${DRESS_W}px`,
      height: `${DRESS_H}px`,
      objectFit: "cover",
      objectPosition: "top",
      borderRadius: "2px",
      boxShadow: "0 4px 12px rgba(28,25,23,0.25)",
    });
    bag.append(dress);
    // Rise out of the button, arc over the bag mouth, sink in behind the front.
    const rise = start.y - bagY;
    drop = dress.animate(
      [
        { transform: `translateY(${rise}px) scale(1)`, opacity: 0 },
        { transform: `translateY(${rise - 20}px) scale(1)`, opacity: 1, offset: 0.15 },
        { transform: "translateY(-46px) scale(0.85)", offset: 0.55 },
        { transform: "translateY(8px) scale(0.6)" },
      ],
      { duration: DROP_MS, easing: "ease-in-out", fill: "forwards" }
    );
  }
  bag.append(front);
  overlay.append(bag);
  document.body.append(overlay);

  bag.animate(
    [
      { transform: "scale(0)", opacity: 0 },
      { transform: "scale(1.1)", opacity: 1, offset: 0.7 },
      { transform: "scale(1)", opacity: 1 },
    ],
    { duration: POP_MS, easing: "ease-out", fill: "forwards" }
  );

  const dx = end.x - bagX;
  const dy = end.y - bagY;
  const fly = bag.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 40}px) scale(0.75)`, opacity: 1, offset: 0.4 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0.2 },
    ],
    { duration: FLY_MS, delay: POP_MS + DROP_MS, easing: "ease-in", fill: "forwards" }
  );

  return fly.finished
    .then(() => {
      target.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.3)" },
          { transform: "scale(0.92)" },
          { transform: "scale(1)" },
        ],
        { duration: 420, easing: "ease-out" }
      );
    })
    .finally(() => {
      drop?.cancel();
      overlay.remove();
    });
}
