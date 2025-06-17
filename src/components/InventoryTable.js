// src/components/InventoryTable.js

export default function InventoryTable({
  variants,
  filter,
  setFilter,
  onUpdateStock,
}) {
  const filtered = variants.filter(
    (v) =>
      v.ProductID.toLowerCase().includes(filter.productID.toLowerCase()) &&
      v.Size.toLowerCase().includes(filter.size.toLowerCase()) &&
      v.Color.toLowerCase().includes(filter.color.toLowerCase()) &&
      (v.Products?.Name || "").toLowerCase().includes(filter.name.toLowerCase())
  );

  return (
    <table className="w-full border text-sm">
      <thead>
        <tr className="bg-gray-200">
          <th className="border px-2 py-1">
            Product ID
            <br />
            <input
              className="w-full border px-1 py-0.5"
              value={filter.productID}
              onChange={(e) =>
                setFilter({ ...filter, productID: e.target.value })
              }
            />
          </th>
          <th className="border px-2 py-1">
            Name
            <br />
            <input
              className="w-full border px-1 py-0.5"
              value={filter.name}
              onChange={(e) => setFilter({ ...filter, name: e.target.value })}
            />
          </th>
          <th className="border px-2 py-1">
            Size
            <br />
            <input
              className="w-full border px-1 py-0.5"
              value={filter.size}
              onChange={(e) => setFilter({ ...filter, size: e.target.value })}
            />
          </th>
          <th className="border px-2 py-1">
            Color
            <br />
            <input
              className="w-full border px-1 py-0.5"
              value={filter.color}
              onChange={(e) => setFilter({ ...filter, color: e.target.value })}
            />
          </th>
          <th className="border px-2 py-1">Stock</th>
          <th className="border px-2 py-1">Action</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((v, idx) => (
          <tr key={idx}>
            <td className="border px-2 py-1">{v.ProductID}</td>
            <td className="border px-2 py-1">{v.Products?.Name || ""}</td>
            <td className="border px-2 py-1">{v.Size}</td>
            <td className="border px-2 py-1">{v.Color}</td>
            <td className="border px-2 py-1">{v.Stock}</td>
            <td className="border px-2 py-1">
              <button
                className="text-blue-600 hover:underline"
                onClick={() => {
                  const input = prompt("Enter new stock quantity", v.Stock);
                  if (input)
                    onUpdateStock(
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
  );
}
