import ItemRow from "./ItemRow";

export default function ItemTable({ items, setItems, onEdit }) {
  const updateItem = (id, patch) => {
    setItems((prev) =>
      prev.map((it) => (it._id === id ? { ...it, ...patch } : it)),
    );
  };
  const removeItem = (id) => {
    setItems((prev) => prev.filter((it) => it._id !== id));
  };

  return (
    <div className="rounded-2xl border overflow-x-auto">
      <div className="max-h-[360px] overflow-y-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="sticky top-0 bg-muted/50">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Product ID</th>
              <th className="px-2 py-1.5 text-center font-medium">Qty</th>
              <th className="px-2 py-1.5 text-center font-medium">MRP</th>
              <th className="px-2 py-1.5 text-center font-medium">Disc%</th>
              <th className="px-2 py-1.5 text-center font-medium">Alt. Amt</th>
              <th className="px-2 py-1.5 text-center font-medium">GST%</th>
              <th className="px-2 py-1.5 text-center font-medium">Subtotal</th>
              <th className="px-2 py-1.5 text-center font-medium">GST Amt</th>
              <th className="px-2 py-1.5 text-center font-medium">Total</th>
              <th className="px-2 py-1.5 text-center font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <ItemRow
                key={it._id}
                item={it}
                onUpdate={updateItem}
                onRemove={removeItem}
                onEdit={onEdit}
              />
            ))}
            {items.length === 0 && (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={10}>
                  No items yet. Click "Add item".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
