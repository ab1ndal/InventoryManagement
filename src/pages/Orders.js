import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function Orders() {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    fetchOrders();
  }, []);

  async function fetchOrders() {
    const { data } = await supabase.from("Orders").select("*");
    setOrders(data);
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Orders</h1>
      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-200">
            <th className="border px-2 py-1">Order ID</th>
            <th className="border px-2 py-1">Customer</th>
            <th className="border px-2 py-1">Date</th>
            <th className="border px-2 py-1">Total</th>
            <th className="border px-2 py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.OrderID}>
              <td className="border px-2 py-1">{order.OrderID}</td>
              <td className="border px-2 py-1">{order.CustomerID}</td>
              <td className="border px-2 py-1">
                {new Date(order.OrderDate).toLocaleDateString()}
              </td>
              <td className="border px-2 py-1">₹{order.TotalAmount}</td>
              <td className="border px-2 py-1">{order.PaymentStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
