import { render, screen, act } from "@testing-library/react";
import InventoryPicker from "../InventoryPicker";

const mockCalls = [];
let mockReleaseProduct;

const mockChain = (table) => {
  const call = { table, op: null };
  mockCalls.push(call);
  const chain = {
    select: () => chain,
    eq: () => {
      call.op = call.op || "eq";
      return chain;
    },
    ilike: () => {
      call.op = "search";
      return chain;
    },
    order: () => chain,
    single: () =>
      new Promise((resolve) => {
        mockReleaseProduct = () =>
          resolve({
            data: { productid: "BC251151", name: "Georgette Kurti", retailprice: 2895 },
            error: null,
          });
      }),
    then: (res, rej) =>
      Promise.resolve({
        data:
          call.op === "search"
            ? [{ productid: "BC251151", name: "Georgette Kurti" }]
            : [{ variantid: "v1", productid: "BC251151", size: "M", color: "Red", stock: 2 }],
        error: null,
      }).then(res, rej),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: { from: (table) => mockChain(table) },
}));

const editing = { productid: "BC251151", variantid: "v1", quantity: 1 };

beforeEach(() => {
  mockCalls.length = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test("editing never opens the product search list, even when the product loads slowly", async () => {
  render(<InventoryPicker onPicked={() => {}} initialVal={editing} />);

  // The product is still loading when the old search debounce would have fired.
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  await act(async () => {
    mockReleaseProduct();
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });

  expect(mockCalls.some((c) => c.op === "search")).toBe(false);
  expect(screen.queryByText(/BC251151 \|/)).not.toBeInTheDocument();
});

test("the Update button needs a variant that belongs to the selected product", async () => {
  render(<InventoryPicker onPicked={() => {}} initialVal={{ ...editing, variantid: "from-another-product" }} />);
  await act(async () => {
    mockReleaseProduct();
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
});

test("editing loads the product and its variants together, with one variant request", async () => {
  render(<InventoryPicker onPicked={() => {}} initialVal={editing} />);
  expect(mockCalls.map((c) => c.table).sort()).toEqual(["products_admin", "productsizecolors"]);

  await act(async () => {
    mockReleaseProduct();
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });

  expect(mockCalls.filter((c) => c.table === "productsizecolors")).toHaveLength(1);
  expect(screen.getByText(/Georgette Kurti/)).toBeInTheDocument();
});
