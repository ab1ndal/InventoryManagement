import { render, screen } from "@testing-library/react";
import BillTable from "../BillTable";

// totalamount is the amount billed after discount, so Total shows it as is.
const rows = [
  { billid: 1, bill_number: "FY26-000401", document_type: "bos", customers: null, orderdate: "2026-10-29", totalamount: 1234, gst_total: 0, discount_total: 56, paymentstatus: "finalized", finalized: true, pdf_url: null },
  { billid: 2, bill_number: "FY26-000402", document_type: "bos", customers: null, orderdate: "2026-10-29", totalamount: 777, gst_total: 0, discount_total: 0, paymentstatus: "finalized", finalized: true, pdf_url: null },
];
jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) =>
      table === "bill_payments"
        ? { select: () => ({ in: async () => ({ data: [], error: null }) }) }
        : { select: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) },
  },
}));

test("Total shows the amount billed with the discount noted beneath", async () => {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000401");
  expect(screen.getByText(/1,234\.00/)).toBeInTheDocument();
  expect(screen.queryByText(/1,290\.00/)).not.toBeInTheDocument();
  expect(screen.getByText(/₹56 off/)).toBeInTheDocument();
});

test("no discount note when there was no discount", async () => {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000402");
  expect(screen.getAllByText(/ off$/)).toHaveLength(1);
});
