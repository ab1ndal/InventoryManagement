import React, { useEffect, useRef, useState } from "react";

function formatRemaining(ms) {
  const total = Math.ceil(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// How long the cart's stock stays reserved (earliest hold expiry). Hidden once
// it lapses: the units are then open to other shoppers again. `onExpire` runs
// once at that moment so the page can check the stock again (the cart keeps
// its items either way).
export default function HoldCountdown({ expiresAt, onExpire, className = "" }) {
  const [, setTick] = useState(0);
  const end = expiresAt ? Date.parse(expiresAt) : NaN;
  const remaining = end - Date.now();
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!Number.isFinite(end) || Date.now() >= end) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      if (Date.now() >= end) {
        clearInterval(id);
        onExpireRef.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [end]);

  if (!(remaining > 0)) return null;

  return (
    <p className={`text-[11px] font-sans text-storefront-muted ${className}`}>
      Held for you for <span className="tabular-nums text-storefront-charcoal">{formatRemaining(remaining)}</span>
    </p>
  );
}
