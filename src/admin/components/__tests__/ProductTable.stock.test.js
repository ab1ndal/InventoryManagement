import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Plain functions: CRA resetMocks wipes jest.fn implementations between tests.
let mockOps = [];
let mockRpcs = [];
let mockToasts = [];
let mockRpcError = null;
let mockEdit = null;

const mockProduct = {
  productid: "BC25001",
  name: "Silk Saree",
  categoryid: "SA",
  fabric: "SILK",
  purchaseprice: 1000,
  retailprice: 2000,
  description: "",
  producturl: null,
  unit_type: "piece",
};
const mockVariants = [
  { variantid: "v1", productid: "BC25001", size: "FREE", color: "RED", stock: 5 },
  { variantid: "v2", productid: "BC25001", size: "FREE", color: "BLUE", stock: 7 },
];

const mockChain = (table) => {
  const op = { table, method: "select" };
  mockOps.push(op);
  const chain = {
    select: () => chain,
    order: () => chain,
    range: () => chain,
    in: () => chain,
    eq: () => chain,
    ilike: () => chain,
    insert: (p) => { op.method = "insert"; op.payload = p; return chain; },
    update: (p) => { op.method = "update"; op.payload = p; return chain; },
    upsert: (p) => { op.method = "upsert"; op.payload = p; return chain; },
    delete: () => { op.method = "delete"; return chain; },
    then: (resolve) => {
      if (op.method !== "select") return resolve({ data: null, error: null });
      if (table === "products") return resolve({ data: [mockProduct], error: null });
      if (table === "productsizecolors") return resolve({ data: mockVariants, error: null });
      return resolve({ data: [], error: null });
    },
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: (t) => mockChain(t),
    rpc: async (name, args) => {
      mockRpcs.push({ name, args });
      return { data: null, error: mockRpcError };
    },
  },
}));
jest.mock("../../../lib/activityLog", () => ({ logActivity: () => {} }));
jest.mock("../../../components/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t) => mockToasts.push(t) }),
}));
// The edit dialog is not under test; the row hands the edited product straight
// to ProductTable's save handler.
jest.mock("../ProductRow", () => (props) => (
  <tr>
    <td>
      <button onClick={() => props.onEdit(...mockEdit(props))}>
        save {props.product.productid}
      </button>
    </td>
  </tr>
));

import ProductTable from "../ProductTable";

const emptyFilters = {
  productid: "", category: "", fabric: "", description: "", size: "", color: "",
  purchaseMin: "", purchaseMax: "", retailMin: "", retailMax: "",
  discountPriceMin: "", discountPriceMax: "", stockMin: "", stockMax: "",
};

beforeEach(() => {
  mockOps = [];
  mockRpcs = [];
  mockToasts = [];
  mockRpcError = null;
});

const saveWith = async (variantsFor) => {
  mockEdit = ({ product, variants }) => [
    { ...product, variants: variantsFor(variants) },
    [],
  ];
  render(
    <table>
      <tbody>
        <tr><td>
          <ProductTable
            categories={[]}
            filters={emptyFilters}
            setFilters={() => {}}
            debouncedFilters={emptyFilters}
            refreshFlag={false}
          />
        </td></tr>
      </tbody>
    </table>
  );
  fireEvent.click(await screen.findByRole("button", { name: "save BC25001" }));
  await waitFor(() => expect(mockToasts.length).toBe(1));
};

const variantUpserts = () =>
  mockOps
    .filter((o) => o.table === "productsizecolors" && o.method === "upsert")
    .flatMap((o) => o.payload);

test("saving without touching stock writes no stock and calls no stock_adjust", async () => {
  await saveWith((vs) => vs.map((v) => ({ ...v, color: v.color + "X" })));
  expect(mockToasts[0].title).toBe("Product Updated");
  const rows = variantUpserts();
  expect(rows.map((r) => r.variantid)).toEqual(["v1", "v2"]);
  rows.forEach((r) => expect(r).not.toHaveProperty("stock"));
  expect(rows[0].color).toBe("REDX");
  expect(mockRpcs).toEqual([]);
});

test("changing one variant's stock 5 to 3 adjusts only that variant by -2", async () => {
  await saveWith((vs) => vs.map((v) => (v.variantid === "v1" ? { ...v, stock: 3 } : v)));
  expect(mockToasts[0].title).toBe("Product Updated");
  variantUpserts().forEach((r) => expect(r).not.toHaveProperty("stock"));
  expect(mockRpcs).toEqual([
    {
      name: "stock_adjust",
      args: { p_variant: "v1", p_delta: -2, p_reason: "manual_edit", p_ref: "BC25001" },
    },
  ]);
});

test("a new variant is inserted with its initial stock", async () => {
  await saveWith((vs) => [
    ...vs,
    { variantid: "new-uuid", productid: "BC25001", size: "FREE", color: "GREEN", stock: 4 },
  ]);
  const batches = mockOps.filter(
    (o) => o.table === "productsizecolors" && o.method === "upsert"
  );
  expect(batches).toHaveLength(2);
  batches[0].payload.forEach((r) => expect(r).not.toHaveProperty("stock"));
  expect(batches[1].payload).toEqual([
    { variantid: "new-uuid", productid: "BC25001", size: "FREE", color: "GREEN", stock: 4 },
  ]);
  expect(mockRpcs).toEqual([]);
});

test("a stock_adjust failure shows the update-failed toast", async () => {
  mockRpcError = { message: "stock would go negative" };
  await saveWith((vs) => vs.map((v) => (v.variantid === "v2" ? { ...v, stock: 9 } : v)));
  expect(mockToasts[0]).toEqual({
    variant: "destructive",
    title: "Update Failed",
    description: "stock would go negative",
  });
});
