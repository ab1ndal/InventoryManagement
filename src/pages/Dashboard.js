import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function Dashboard() {
  const [stats, setStats] = useState({ totalProducts: 0, lowStock: 0 });

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      const { data: products, error: productsError } = await supabase
        .from("Products")
        .select("*");
      const { data: stock, error: stockError } = await supabase
        .from("ProductSizeColors")
        .select("*");

      if (productsError || stockError) {
        console.error("Error fetching data:", productsError || stockError);
        return;
      }

      // If data is null or undefined, initialize with empty arrays
      const safeProducts = products || [];
      const safeStock = stock || [];

      const lowStock = safeStock.filter((item) => item.Stock < 5).length;

      setStats({
        totalProducts: safeProducts.length,
        lowStock,
      });
    } catch (error) {
      console.error("Error in fetchStats:", error);
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <div className="space-y-4">
        <div>Total Products: {stats.totalProducts}</div>
        <div>Items with Low Stock: {stats.lowStock}</div>
      </div>
    </div>
  );
}
