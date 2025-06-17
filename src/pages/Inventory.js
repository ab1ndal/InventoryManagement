import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import InventoryTable from "../components/InventoryTable";

export default function Inventory() {
  const [variants, setVariants] = useState([]);
  const [filter, setFilter] = useState({
    productID: null,
    size: null,
    color: null,
    name: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchVariants = useCallback(async () => {
    try {
      setLoading(true);
      const { data: variantData, error } = await supabase
        .from("ProductSizeColors")
        .select("*, Products(Name)")
        .eq("ProductID", filter.productID || undefined)
        .eq("Size", filter.size || undefined)
        .eq("Color", filter.color || undefined)
        .ilike("Products.Name", `%${filter.name || ""}%`);

      if (error) throw error;
      setVariants(variantData || []);
    } catch (err) {
      setError(err.message);
      console.error("Error fetching variants:", err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchVariants();
  }, [fetchVariants]);

  const updateStock = useCallback(
    async (productID, size, color, newStock) => {
      try {
        const { error } = await supabase
          .from("ProductSizeColors")
          .update({ Stock: newStock })
          .eq("ProductID", productID)
          .eq("Size", size)
          .eq("Color", color);

        if (error) throw error;
        await fetchVariants(); // Refresh the data after update
      } catch (err) {
        setError(err.message);
        console.error("Error updating stock:", err);
      }
    },
    [fetchVariants]
  );

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Inventory</h1>
      {loading ? (
        <p>Loading inventory...</p>
      ) : error ? (
        <p className="text-red-500">{error}</p>
      ) : (
        <InventoryTable
          variants={variants}
          filter={filter}
          setFilter={setFilter}
          onUpdateStock={updateStock}
        />
      )}
    </div>
  );
}
