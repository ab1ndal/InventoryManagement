import { render, screen, fireEvent } from "@testing-library/react";
import InventoryPicker from "../InventoryPicker";

// 11 matches, returned in the shuffled order Postgres gave the admin role. The exact
// code came back last, so a 10-row cap dropped it.
const mockRows = ["3", "4", "5", "9", "6", "7", "0", "1", "2", "8", ""].map((d) => ({
  productid: `BC25127${d}`,
  name: `Item ${d}`,
}));
const mockQuery = { calls: [] };

const mockChain = () => {
  const chain = {
    select: () => chain,
    ilike: () => chain,
    order: (col) => {
      mockQuery.calls.push(["order", col]);
      return chain;
    },
    limit: (n) => {
      mockQuery.calls.push(["limit", n]);
      return chain;
    },
    then: (res, rej) => {
      const ordered = mockQuery.calls.some(([op]) => op === "order");
      const cap = mockQuery.calls.find(([op]) => op === "limit")?.[1];
      const rows = ordered
        ? [...mockRows].sort((a, b) => a.productid.localeCompare(b.productid))
        : mockRows;
      return Promise.resolve({ data: rows.slice(0, cap ?? rows.length), error: null }).then(res, rej);
    },
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: { from: () => mockChain() },
}));

beforeEach(() => {
  mockQuery.calls = [];
});

test("search lists every match sorted by code, exact code first, in a scrollable list", async () => {
  render(<InventoryPicker onPicked={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("Enter Product ID..."), {
    target: { value: "BC25127" },
  });

  const options = await screen.findAllByText(/^BC25127\d? \|/);
  expect(options).toHaveLength(11);
  expect(options.map((el) => el.textContent.split(" | ")[0])).toEqual([
    "BC25127",
    ...["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => `BC25127${d}`),
  ]);
  // eslint-disable-next-line testing-library/no-node-access -- scroll container has no role
  expect(options[0].parentElement).toHaveClass("max-h-60", "overflow-y-auto");
});
