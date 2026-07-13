import { render, screen } from "@testing-library/react";
import Summary from "../Summary";

const computed = {
  itemsSubtotal: 1105, itemLevelDiscountTotal: 0, overallDiscount: 0,
  balanceDiscount: 0, gstTotal: 0, grandTotal: 1105, voucherPreTax: 0,
};

test("invoice mode shows GST line", () => {
  render(<Summary computed={{ ...computed, gstTotal: 55, grandTotal: 1155 }} />);
  expect(screen.getByText("GST")).toBeInTheDocument();
});

test("bos mode hides GST line", () => {
  render(<Summary computed={computed} docType="bos" />);
  expect(screen.queryByText("GST")).not.toBeInTheDocument();
});
