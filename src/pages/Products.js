import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function Products() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    fetchProducts();
  }, []);

  async function fetchProducts() {
    const { data } = await supabase.from("Products").select("*");
    setProducts(data);
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Products</h1>
      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-200">
            <th className="border px-2 py-1">Product ID</th>
            <th className="border px-2 py-1">Name</th>
            <th className="border px-2 py-1">Category</th>
            <th className="border px-2 py-1">Fabric</th>
            <th className="border px-2 py-1">Retail Price</th>
            <th className="border px-2 py-1">Notes</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.ProductID}>
              <td className="border px-2 py-1">{p.ProductID}</td>
              <td className="border px-2 py-1">{p.Name}</td>
              <td className="border px-2 py-1">{p.CategoryID}</td>
              <td className="border px-2 py-1">{p.Fabric}</td>
              <td className="border px-2 py-1">₹{p.RetailPrice}</td>
              <td className="border px-2 py-1">{p.Notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
