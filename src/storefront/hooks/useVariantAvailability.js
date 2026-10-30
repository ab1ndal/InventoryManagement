import { useState, useEffect } from "react";
import { fetchVariantAvailability } from "../lib/cartApi";

// Live availability row for one variant (see fetchVariantAvailability), or
// null while loading, on failure, or for a response to an earlier selection —
// callers then fall back to the variant's raw stock.
export function useVariantAvailability(variantId) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!variantId) return;
    let active = true;
    fetchVariantAvailability([variantId])
      .then((rows) => {
        const row = rows.find((r) => r.variant_id === variantId);
        if (active && row) setResult(row);
      })
      .catch((error) => console.warn("variant_availability failed; using raw stock", { variantId, error }));
    return () => {
      active = false;
    };
  }, [variantId]);

  return result?.variant_id === variantId ? result : null;
}
