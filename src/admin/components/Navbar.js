import { Link } from "react-router-dom";

export default function Navbar() {
  return (
    <nav className="w-64 min-h-screen bg-gray-800 text-white p-4">
      <h2 className="text-xl font-bold mb-6">Inventory</h2>
      <ul className="space-y-4">
        <li>
          <Link to="/" className="hover:underline">
            Dashboard
          </Link>
        </li>
        <li>
          <Link to="/products" className="hover:underline">
            Products
          </Link>
        </li>
        <li>
          <Link to="/inventory" className="hover:underline">
            Inventory
          </Link>
        </li>
        <li>
          <Link to="/orders" className="hover:underline">
            Orders
          </Link>
        </li>
        <li>
          <Link to="/returns" className="hover:underline">
            Returns
          </Link>
        </li>
      </ul>
    </nav>
  );
}
