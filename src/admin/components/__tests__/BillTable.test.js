import { render, screen, waitFor } from "@testing-library/react";

const rows = [
  { billid: 1, bill_number: "FY26-000217", document_type: "bos", customers: null, orderdate: "2026-07-13", totalamount: 1105, gst_total: 0, discount_total: 0, paymentstatus: "finalized", finalized: true, pdf_url: null },
  { billid: 2, bill_number: "FY26-SG0001", document_type: "invoice", customers: null, orderdate: "2026-07-13", totalamount: 1155, gst_total: 55, discount_total: 0, paymentstatus: "finalized", finalized: true, pdf_url: null },
];
jest.mock("../../../lib/supabaseClient", () => ({
  supabase: { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }) },
}));

import BillTable from "../BillTable";

test("renders document type badges", async () => {
  render(<BillTable onEdit={() => {}} />);
  await waitFor(() => expect(screen.getByText("Bill of Supply")).toBeInTheDocument());
  expect(screen.getByText("Tax Invoice")).toBeInTheDocument();
});
