import { render, screen, fireEvent } from "@testing-library/react";
import BillingForm from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";

jest.mock("../../../../lib/supabaseClient", () => {
  const chain = () => {
    const c = {
      select: () => c,
      eq: () => c,
      in: () => c,
      is: () => c,
      order: () => c,
      limit: () => c,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
    };
    return c;
  };
  return {
    supabase: {
      from: () => chain(),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});

const stockTick = () => screen.getByRole("checkbox", { name: /Don't reduce stock/ });

beforeEach(() => {
  clearBillingLookups();
});

test("the Don't reduce stock tick does not carry over to the next new bill", () => {
  const { rerender } = render(<BillingForm open onOpenChange={() => {}} />);
  fireEvent.click(stockTick());
  expect(stockTick()).toBeChecked();

  rerender(<BillingForm open={false} onOpenChange={() => {}} />);
  rerender(<BillingForm open onOpenChange={() => {}} />);

  expect(stockTick()).not.toBeChecked();
});

test("the tick does not describe itself as being for old bills", () => {
  render(<BillingForm open onOpenChange={() => {}} />);
  expect(stockTick().labels[0].textContent).not.toMatch(/old bill/i);
});
