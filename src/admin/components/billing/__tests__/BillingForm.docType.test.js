import { render, screen, fireEvent } from "@testing-library/react";

// BillingForm's mount-time effects (categories, discounts, saleslocations,
// salesmethods, salespersons) chain .select/.eq/.order/.limit/.single off
// supabase.from(...) and some are awaited directly (thenable), others via
// .then(...). A single chainable "thenable" builder covers every shape
// without hardcoding per-table query chains.
const makeChain = () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: () => makeChain(),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

import BillingForm from "../BillingForm";

test("defaults to Bill of Supply and can switch to Tax Invoice", () => {
  render(<BillingForm open onOpenChange={() => {}} />);
  const bos = screen.getByRole("button", { name: "Bill of Supply" });
  const inv = screen.getByRole("button", { name: "Tax Invoice" });
  // default selected = BoS (primary bg)
  expect(bos.className).toMatch(/bg-primary/);
  fireEvent.click(inv);
  expect(inv.className).toMatch(/bg-primary/);
});
