import ItemRow from "./ItemRow";
import { ScrollArea } from "../../../components/ui/scroll-area";

export default function ItemTable({ items, setItems }) {
  const updateItem = (id, patch) => {
    setItems((prev) =>
      prev.map((it) => (it._id === id ? { ...it, ...patch } : it))
    );
  };
  const removeItem = (id) => {
    setItems((prev) => prev.filter((it) => it._id !== id));
  };

  return (
    <div className="rounded-2xl border">
      <ScrollArea className="max-h-[360px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/50">
            <tr>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-right">MRP</th>
              <th className="p-2 text-right">Disc%</th>
              <th className="p-2 text-right">Stitch</th>
              <th className="p-2 text-right">GST%</th>
              <th className="p-2 text-right">Subtotal</th>
              <th className="p-2 text-right">GST Amt</th>
              <th className="p-2 text-right">Total</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <ItemRow
                key={it._id}
                item={it}
                onUpdate={updateItem}
                onRemove={removeItem}
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
      </ScrollArea>
    </div>
  );
}
