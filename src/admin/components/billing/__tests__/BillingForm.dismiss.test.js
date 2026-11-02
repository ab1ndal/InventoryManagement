import { render, screen, fireEvent } from "@testing-library/react";
import BillingForm from "../BillingForm";

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

test("a click outside or Esc does not close the bill", () => {
  const closes = [];
  render(<BillingForm open onOpenChange={(o) => closes.push(o)} />);
  screen.getByRole("button", { name: "Bill of Supply" });

  fireEvent.pointerDown(document.body);
  fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });

  expect(closes).toEqual([]);
});

test("Cancel still closes the bill", () => {
  const closes = [];
  render(<BillingForm open onOpenChange={(o) => closes.push(o)} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(closes).toEqual([false]);
});
