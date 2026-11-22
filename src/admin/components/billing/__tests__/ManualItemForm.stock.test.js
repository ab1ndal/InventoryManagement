import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ManualItemForm from "../ManualItemForm";

// CRA's jest config sets resetMocks: true, so state lives in a plain object reset in beforeEach.
const mockDb = { inserts: [] };

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => ({
      select: () => ({
        order: () =>
          Promise.resolve({ data: [{ categoryid: "FAB-COT", name: "Cotton fabric" }, { categoryid: "ACC", name: "Accessory" }], error: null }),
      }),
      insert: (row) => {
        mockDb.inserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
    }),
    rpc: () => Promise.resolve({ data: 26004, error: null }),
  },
}));
jest.mock("../../../../components/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));

beforeEach(() => {
  mockDb.inserts = [];
});

async function fillAndAdd({ category, qty }) {
  const onAdd = jest.fn();
  render(<ManualItemForm onAdd={onAdd} />);
  await screen.findByRole("option", { name: "Cotton fabric" });
  fireEvent.change(screen.getByPlaceholderText("Item name"), { target: { value: "Cotton" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: category } });
  fireEvent.change(screen.getByPlaceholderText("e.g. ZABCD"), { target: { value: "ZEZ" } });
  // Qty is the first number field.
  fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: String(qty) } });
  fireEvent.click(screen.getByRole("button", { name: "Add Item" }));
  await waitFor(() => expect(onAdd).toHaveBeenCalled());
  return onAdd.mock.calls[0][0];
}

// schema/migration_manual_item_stock.sql: the item is made for this line, so it starts with the
// line's quantity and the sale brings it to 0.
test("a new fabric item starts with the metres on its line", async () => {
  const line = await fillAndAdd({ category: "FAB-COT", qty: 3.5 });
  expect(mockDb.inserts).toEqual([
    { table: "manual_items", row: expect.objectContaining({ manual_item_id: "BCX26005", stock: 3.5 }) },
  ]);
  expect(line).toMatchObject({ productid: "BCX26005", quantity: 3.5, unit_type: "meter" });
});

test("a new piece item starts with its line's pieces", async () => {
  await fillAndAdd({ category: "ACC", qty: 2 });
  expect(mockDb.inserts[0].row).toMatchObject({ stock: 2 });
});
