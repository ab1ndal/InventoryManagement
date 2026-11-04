import { render, screen, fireEvent } from "@testing-library/react";
import BillingForm from "../BillingForm";

// Minimal supabase stand-in: every query returns empty data.
const mockChain = () => {
  const chain = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    not: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: () => mockChain(),
    rpc: () => Promise.resolve({ data: 0, error: null }),
    storage: { from: () => ({}) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
jest.mock("../../../../lib/activityLog", () => ({ logActivity: () => {} }));
jest.mock("../generateInvoicePdf", () => ({
  generateInvoicePdf: () => Promise.resolve(new Blob(["pdf"])),
}));

// One click adds 2 units @ 1000, no GST, no item discount: bill total is 2000.
jest.mock("../AddItemDialog", () => (props) =>
  props.editItem ? null : (
    <button
      type="button"
      onClick={() =>
        props.onAdd({
          _id: "row1",
          source: "inventory",
          variantid: "v1",
          productid: "BC25001",
          product_name: "Kurti",
          quantity: 2,
          unit_type: "piece",
          mrp: 1000,
          alteration_charge: 0,
          quickDiscountPct: 0,
          gstRate: 0,
          stitchType: "unstitched",
          size: "M",
          color: "Red",
        })
      }
    >
      Stub add item
    </button>
  ),
);

const WARNING = /Final Amount gives a discount above 30%/;

async function renderWithBill() {
  render(<BillingForm open onOpenChange={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Stub add item" }));
  await screen.findAllByText("Kurti");
  return screen.getByPlaceholderText("Leave blank for full bill total");
}

test("a Final Amount that discounts more than 30% shows the warning", async () => {
  const input = await renderWithBill();
  fireEvent.change(input, { target: { value: "1300" } });
  expect(screen.getByText(WARNING)).toBeInTheDocument();
});

test("a Final Amount at or under 30% off shows no warning", async () => {
  const input = await renderWithBill();
  fireEvent.change(input, { target: { value: "1400" } });
  expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: "" } });
  expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
});

test("the warning never changes the typed amount", async () => {
  const input = await renderWithBill();
  fireEvent.change(input, { target: { value: "500" } });
  expect(screen.getByText(WARNING)).toBeInTheDocument();
  expect(input.value).toBe("500");
});
