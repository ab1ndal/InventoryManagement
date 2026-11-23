import { useState, useEffect } from "react";
import { supabase } from "lib/supabaseClient";

export function useProduct(publicId) {
  const [product, setProduct] = useState(null);
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!publicId) return;

    let cancelled = false;

    async function fetch() {
      setLoading(true);
      setError(null);

      // Variants come embedded: the route carries only the public id, and
      // a second query keyed by the internal id would add a round trip.
      const { data, error } = await supabase
        .from("products")
        .select(
          "productid, public_id, name:display_title, description, categoryid, fabric, retailprice, producturl, unit_type, categories(name), productsizecolors(variantid, size, color, stock)"
        )
        .eq("public_id", publicId)
        .order("size", { referencedTable: "productsizecolors" })
        .order("color", { referencedTable: "productsizecolors" })
        .single();

      if (cancelled) return;

      if (error) {
        setError(error);
        setLoading(false);
        return;
      }

      const { productsizecolors, ...row } = data;
      setProduct(row);
      setVariants(productsizecolors ?? []);
      setLoading(false);
    }

    fetch();
    return () => { cancelled = true; };
  }, [publicId]);

  return { product, variants, loading, error };
}
