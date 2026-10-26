import { render, screen } from "@testing-library/react";
import BillTable from "../BillTable";

const rows = [
  { billid: 1, bill_number: "FY26-000217", document_type: "bos", customers: null, orderdate: "2026-07-13", totalamount: 1105, gst_total: 0, discount_total: 0, paymentstatus: "finalized", finalized: true, pdf_url: null },
  { billid: 2, bill_number: "FY26-SG0001", document_type: "invoice", customers: null, orderdate: "2026-07-13", totalamount: 1155, gst_total: 55, discount_total: 0, paymentstatus: "finalized", finalized: true, pdf_url: null },
];
jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) =>
      table === "bill_payments"
        ? { select: () => ({ in: async () => ({ data: [], error: null }) }) }
        : { select: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) },
  },
}));


test("renders document type badges", async () => {
  render(<BillTable onEdit={() => {}} />);
  expect(await screen.findByText("Bill of Supply")).toBeInTheDocument();
  expect(screen.getByText("Tax Invoice")).toBeInTheDocument();
});
