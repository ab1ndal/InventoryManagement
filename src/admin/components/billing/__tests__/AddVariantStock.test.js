import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AddVariantStock from "../AddVariantStock";
import { addVariantStock } from "../../../lib/variants";

const mockTables = {
  sizes: [{ code: "M", label: "M" }, { code: "XL", label: "XL" }],
  colors: [{ code: "Red" }, { code: "Blue" }],
};
jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => {
      const chain = {
        select: () => chain,
        order: () => Promise.resolve({ data: mockTables[table], error: null }),
      };
      return chain;
    },
  },
}));
jest.mock("../../../lib/variants", () => ({ addVariantStock: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// A plain select stands in for the searchable dropdown.
jest.mock("../../../../components/CustomDropdown", () => (props) => (
  <select aria-label={props.placeholder} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
    <option value="" />
    {props.options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
));

const product = { productid: "BC25001", name: "Kurta", unit_type: "piece" };
const variants = [{ variantid: "v-1", size: "M", color: "Red", stock: 0 }];

beforeEach(() => jest.clearAllMocks());

async function openForm(onAdded = jest.fn()) {
  render(<AddVariantStock product={product} variants={variants} onAdded={onAdded} />);
  fireEvent.click(screen.getByRole("button", { name: /Add stock/ }));
  await screen.findByRole("option", { name: "XL" });
  return onAdded;
}

test("tops up a size and colour the product already has", async () => {
  addVariantStock.mockResolvedValue({ variantid: "v-1", created: false, stock: 2 });
  const onAdded = await openForm();
  fireEvent.change(screen.getByLabelText("Size"), { target: { value: "M" } });
  fireEvent.change(screen.getByLabelText("Colour"), { target: { value: "Red" } });
  fireEvent.change(screen.getByLabelText("Stock to add (pcs)"), { target: { value: "2" } });
  expect(screen.getByText("Adds 2 pcs to Red / M (stock now 0)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add stock" }));
  await waitFor(() => expect(onAdded).toHaveBeenCalledWith("v-1"));
  expect(addVariantStock).toHaveBeenCalledWith(expect.anything(), { product, size: "M", color: "Red", quantity: "2" });
});

test("says when the size and colour will be a new variant", async () => {
  addVariantStock.mockResolvedValue({ variantid: "v-new", created: true, stock: 1 });
  const onAdded = await openForm();
  fireEvent.change(screen.getByLabelText("Size"), { target: { value: "XL" } });
  fireEvent.change(screen.getByLabelText("Colour"), { target: { value: "Blue" } });
  expect(screen.getByText("New variant Blue / XL with 1 pcs")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add stock" }));
  await waitFor(() => expect(onAdded).toHaveBeenCalledWith("v-new"));
});

test("keeps the form open when the save fails", async () => {
  addVariantStock.mockRejectedValue(new Error("permission denied"));
  const onAdded = await openForm();
  fireEvent.change(screen.getByLabelText("Size"), { target: { value: "M" } });
  fireEvent.change(screen.getByLabelText("Colour"), { target: { value: "Red" } });
  fireEvent.click(screen.getByRole("button", { name: "Add stock" }));
  await waitFor(() => expect(addVariantStock).toHaveBeenCalled());
  expect(onAdded).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Size")).toBeInTheDocument();
});
