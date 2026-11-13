import { render, screen } from "@testing-library/react";
import BillTable from "../BillTable";

// Money an edit gave back is a negative bill_payments row; Amount Received shows what the shop
// still holds, with the refund or store credit noted beneath.
const rows = [
  {
    billid: 1, bill_number: "FY26-000501", document_type: "bos", customers: null, orderdate: "2026-11-12",
    totalamount: 600, net_amount: 600, payment_amount: 600, gst_total: 0, discount_total: 0,
    paymentstatus: "finalized", finalized: true, pdf_url: null,
    bill_payments: [{ amount: 1000, kind: "payment" }, { amount: -400, kind: "refund" }],
  },
  {
    billid: 2, bill_number: "FY26-000502", document_type: "bos", customers: null, orderdate: "2026-11-12",
    totalamount: 300, net_amount: 300, payment_amount: 300, gst_total: 0, discount_total: 0,
    paymentstatus: "finalized", finalized: true, pdf_url: null,
    bill_payments: [{ amount: 500, kind: "payment" }, { amount: -200, kind: "store_credit" }],
  },
];
jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }),
  },
}));

test("a refund and a store credit given back at an edit are shown under what is held", async () => {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000501");
  expect(screen.getByText(/^Refunded: ₹400$/)).toBeInTheDocument();
  expect(screen.getByText(/^To store credit: ₹200$/)).toBeInTheDocument();
  expect(screen.getAllByText(/^Refunded:/)).toHaveLength(1);
});
