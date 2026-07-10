import { useState, useEffect } from "react";
import { supabase } from "lib/supabaseClient";

export function useProduct(productId) {
  const [product, setProduct] = useState(null);
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!productId) return;

    let cancelled = false;

    async function fetch() {
      setLoading(true);
      setError(null);

      const [productRes, variantsRes] = await Promise.all([
        supabase
          .from("products")
          .select("productid, name, description, categoryid, fabric, retailprice, producturl, unit_type, categories(name)")
          .eq("productid", productId)
          .single(),
        supabase
          .from("productsizecolors")
          .select("variantid, size, color, stock")
          .eq("productid", productId)
          .order("size")
          .order("color"),
      ]);

      if (cancelled) return;

      if (productRes.error) {
        setError(productRes.error);
        setLoading(false);
        return;
      }

      setProduct(productRes.data);
      setVariants(variantsRes.data ?? []);
      setLoading(false);
    }

    fetch();
    return () => { cancelled = true; };
  }, [productId]);

  return { product, variants, loading, error };
}
