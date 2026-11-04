import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import CustomerSelector from "../CustomerSelector";

const mockCustomers = [
  { customerid: 7, first_name: "Asha", last_name: null, phone: "9000000001" },
];

jest.mock("../../CustomerForm", () => () => {
  const React = require("react");
  return React.createElement("button", { type: "button" }, "Add Customer");
});
jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        or: () => ({
          limit: async () => ({ data: mockCustomers, error: null }),
        }),
      }),
    }),
  },
}));

let latestId;
function Harness({ initialId = null }) {
  const [id, setId] = useState(initialId);
  latestId = id;
  return <CustomerSelector selectedCustomerId={id} setSelectedCustomerId={setId} />;
}

const searchBox = () => screen.getByPlaceholderText("Search by name or phone");

test("retyping clears the selected customer", () => {
  render(<Harness initialId={7} />);
  fireEvent.change(searchBox(), { target: { value: "Someone Else" } });
  expect(latestId).toBeNull();
});

test("a customer with no last name never shows as null", async () => {
  render(<Harness />);
  fireEvent.change(searchBox(), { target: { value: "Asha" } });
  fireEvent.click(await screen.findByText("Asha | 9000000001"));
  expect(latestId).toBe(7);
  expect(searchBox()).toHaveValue("Asha | 9000000001");
});

test("arrow keys and Enter pick a customer", async () => {
  render(<Harness />);
  fireEvent.change(searchBox(), { target: { value: "Asha" } });
  await screen.findByText("Asha | 9000000001");
  fireEvent.keyDown(searchBox(), { key: "ArrowDown" });
  fireEvent.keyDown(searchBox(), { key: "Enter" });
  expect(latestId).toBe(7);
});

test("no match offers to add the customer, using the existing button", async () => {
  mockCustomers.length = 0;
  try {
    render(<Harness />);
    const addButton = screen.getByRole("button", { name: /add customer/i });
    const opened = jest.fn();
    addButton.addEventListener("click", opened);
    fireEvent.change(searchBox(), { target: { value: "Nobody" } });
    fireEvent.click(await screen.findByText("No match. Add this customer"));
    expect(opened).toHaveBeenCalledTimes(1);
  } finally {
    mockCustomers.push({ customerid: 7, first_name: "Asha", last_name: null, phone: "9000000001" });
  }
});
