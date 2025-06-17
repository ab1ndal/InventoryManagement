import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function Returns() {
  const [returns, setReturns] = useState([]);

  useEffect(() => {
    fetchReturns();
  }, []);

  async function fetchReturns() {
    const { data } = await supabase.from("Returns").select("*");
    setReturns(data);
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Returns</h1>
      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-200">
            <th className="border px-2 py-1">Return ID</th>
            <th className="border px-2 py-1">Order Item</th>
            <th className="border px-2 py-1">Date</th>
            <th className="border px-2 py-1">Quantity</th>
            <th className="border px-2 py-1">Reason</th>
          </tr>
        </thead>
        <tbody>
          {returns.map((ret) => (
            <tr key={ret.ReturnID}>
              <td className="border px-2 py-1">{ret.ReturnID}</td>
              <td className="border px-2 py-1">{ret.OrderItemID}</td>
              <td className="border px-2 py-1">
                {new Date(ret.ReturnDate).toLocaleDateString()}
              </td>
              <td className="border px-2 py-1">{ret.Quantity}</td>
              <td className="border px-2 py-1">{ret.Reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
