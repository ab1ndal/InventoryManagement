import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function Dashboard() {
  const [stats, setStats] = useState({ totalProducts: 0, lowStock: 0 });

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    const { data: products } = await supabase.from("Products").select("*");
    const { data: stock } = await supabase
      .from("ProductSizeColors")
      .select("*");

    const lowStock = stock.filter((item) => item.Stock < 5).length;

    setStats({ totalProducts: products.length, lowStock });
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
