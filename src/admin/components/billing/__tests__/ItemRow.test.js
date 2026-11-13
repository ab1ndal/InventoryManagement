import { render, screen, fireEvent } from "@testing-library/react";
import ItemRow from "../ItemRow";

const item = { _id: "a", productid: "BC25001", mrp: 1000, quantity: 3, stock: 5, alteration_charge: 0 };

const renderRow = (props = {}, overrides = {}) => {
  const updates = [];
  render(
    <table>
      <tbody>
        <ItemRow
          item={{ ...item, ...overrides }}
          onUpdate={(_, patch) => updates.push(patch)}
          onRemove={() => {}}
          onEdit={() => {}}
          {...props}
        />
      </tbody>
    </table>
  );
  return updates;
};

const qtyInput = () => screen.getByDisplayValue("3");

test("clearing qty leaves the field empty, so typing 2 gives 2 and not 12", () => {
  const updates = renderRow();
  const input = qtyInput();
  fireEvent.change(input, { target: { value: "" } });
  expect(input).toHaveValue(null);
  expect(updates).toEqual([]);
  fireEvent.change(input, { target: { value: "2" } });
  expect(input).toHaveValue(2);
  expect(updates).toEqual([{ quantity: 2 }]);
});

test("leaving qty empty restores the last valid value", () => {
  renderRow();
  const input = qtyInput();
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  expect(input).toHaveValue(3);
});

test("zero is not accepted as a quantity", () => {
  const updates = renderRow();
  fireEvent.change(qtyInput(), { target: { value: "0" } });
  expect(updates).toEqual([]);
});

test("warns when qty exceeds known stock", () => {
  renderRow({}, { quantity: 6 });
  expect(screen.getByText("Only 5 left")).toBeInTheDocument();
});

test("no warning within stock, on backdated bills, or when stock is unknown", () => {
  renderRow();
  expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
  renderRow({ isBackdated: true }, { quantity: 6 });
  expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
  renderRow({}, { quantity: 6, stock: null });
  expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
});

describe("an exchanged line", () => {
  test("shows the exchanged badge and refuses removal and editing", () => {
    const removed = [];
    const edited = [];
    renderRow({ exchangedQty: 1, onRemove: (id) => removed.push(id), onEdit: (id) => edited.push(id) });
    expect(screen.getByText("Exchanged 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Remove/ }));
    expect(screen.getByRole("status")).toHaveTextContent("stays on the bill");
    fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
    expect(screen.getByRole("status")).toHaveTextContent("cannot be swapped or repriced");
    expect(removed).toEqual([]);
    expect(edited).toEqual([]);
  });

  test("quantity cannot go below what was exchanged, but can stay at or above it", () => {
    const updates = renderRow({ exchangedQty: 2 });
    fireEvent.change(qtyInput(), { target: { value: "1" } });
    expect(updates).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("cannot go below 2");
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "2" } });
    expect(updates).toEqual([{ quantity: 2 }]);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
