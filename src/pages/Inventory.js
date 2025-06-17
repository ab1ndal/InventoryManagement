import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function Inventory() {
  const [variants, setVariants] = useState([]);

  useEffect(() => {
    fetchVariants();
  }, []);

  async function fetchVariants() {
    const { data } = await supabase.from("ProductSizeColors").select("*");
    setVariants(data);
  }

  async function updateStock(productID, size, color, newStock) {
    await supabase
      .from("ProductSizeColors")
      .update({ Stock: newStock })
      .eq("ProductID", productID)
      .eq("Size", size)
      .eq("Color", color);
    fetchVariants();
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Inventory</h1>
      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-200">
            <th className="border px-2 py-1">Product ID</th>
            <th className="border px-2 py-1">Size</th>
            <th className="border px-2 py-1">Color</th>
            <th className="border px-2 py-1">Stock</th>
            <th className="border px-2 py-1">Action</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v, idx) => (
            <tr key={idx}>
              <td className="border px-2 py-1">{v.ProductID}</td>
              <td className="border px-2 py-1">{v.Size}</td>
              <td className="border px-2 py-1">{v.Color}</td>
              <td className="border px-2 py-1">{v.Stock}</td>
              <td className="border px-2 py-1">
                <button
                  className="text-blue-600 hover:underline"
                  onClick={() => {
                    const input = prompt("Enter new stock quantity", v.Stock);
                    if (input)
                      updateStock(
                        v.ProductID,
                        v.Size,
                        v.Color,
                        parseInt(input)
                      );
                  }}
                >
                  Update
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
