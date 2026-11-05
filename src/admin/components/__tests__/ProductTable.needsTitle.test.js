import { render, screen, waitFor } from "@testing-library/react";
import ProductTable from "../ProductTable";

// Plain functions: CRA resetMocks wipes jest.fn implementations between tests.
let mockOrArgs = [];
let mockImages = [];

const mockChain = (table) => {
  let ids = null;
  const chain = {
    select: () => chain,
    order: () => chain,
    range: () => chain,
    in: (_column, values) => {
      ids = values;
      return chain;
    },
    eq: () => chain,
    ilike: () => chain,
    or: (arg) => {
      mockOrArgs.push({ table, arg });
      return chain;
    },
    then: (resolve) => {
      if (table === "products_admin") {
        const all = [{ productid: "BC25001" }, { productid: "BC25002" }];
        return resolve({ data: ids ? all.filter((p) => ids.includes(p.productid)) : all, error: null });
      }
      if (table === "productimages") return resolve({ data: mockImages, error: null });
      return resolve({ data: [], error: null });
    },
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: { from: (t) => mockChain(t), rpc: async () => ({ data: null, error: null }) },
}));
jest.mock("../../../lib/activityLog", () => ({ logActivity: () => {} }));
jest.mock("../../../components/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));
jest.mock("../ProductRow", () => (props) => <tr><td>{props.product.productid}</td></tr>);

const filters = {
  productid: "", category: "", fabric: "", description: "", size: "", color: "",
  purchaseMin: "", purchaseMax: "", retailMin: "", retailMax: "",
  discountPriceMin: "", discountPriceMax: "", stockMin: "", stockMax: "",
};

const renderWith = (extra) => {
  const applied = { ...filters, ...extra };
  return render(
    <table><tbody><tr><td>
      <ProductTable categories={[]} filters={applied} setFilters={() => {}} debouncedFilters={applied} refreshFlag={false} />
    </td></tr></tbody></table>
  );
};

beforeEach(() => {
  mockOrArgs = [];
  mockImages = [];
});

it("needs-title asks for a blank title and keeps only products with a photo", async () => {
  mockImages = [{ productid: "BC25002" }];
  renderWith({ needsTitle: true });
  await waitFor(() => {
    expect(mockOrArgs).toContainEqual({ table: "products_admin", arg: "title_detail.is.null,title_detail.eq." });
  });
  expect(await screen.findByText("BC25002")).toBeInTheDocument();
  expect(screen.queryByText("BC25001")).not.toBeInTheDocument();
});

it("without the filter, no title condition is added", async () => {
  renderWith({});
  expect(await screen.findByText("BC25001")).toBeInTheDocument();
  expect(screen.getByText("BC25002")).toBeInTheDocument();
  expect(mockOrArgs).toEqual([]);
});
