import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProductEditDialog from "../ProductEditDialog";

const chain = () => {
  const c = {
    select: () => c,
    order: () => c,
    eq: () => c,
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return c;
};
jest.mock("../../../lib/supabaseClient", () => ({
  supabase: { from: () => chain() },
}));

const product = {
  productid: "BC25001",
  name: "Silk Saree",
  categoryid: "SA",
  fabric: "SILK",
  purchaseprice: 1000,
  retailprice: 2000,
  description: "Original",
  producturl: "https://example.com/saree",
  unit_type: "piece",
};
const categories = [{ categoryid: "SA", name: "Saree" }];

// Mirrors ProductRow: new product/variants objects on every render.
function Harness({ onSave, onClose, overrides = {} }) {
  const [, rerender] = useState(0);
  return (
    <>
      <button onClick={() => rerender((n) => n + 1)}>rerender parent</button>
      <ProductEditDialog
        open
        onClose={onClose}
        product={{ ...product, ...overrides }}
        variants={[]}
        categories={categories}
        onSave={onSave}
      />
    </>
  );
}

const descriptionBox = () => screen.getByDisplayValue("Original");

test("a failed save keeps the dialog open with the edits and shows the error", async () => {
  let closed = 0;
  render(
    <Harness
      onClose={() => { closed += 1; }}
      onSave={async () => { throw new Error("network down"); }}
    />
  );
  const box = descriptionBox();
  fireEvent.change(box, { target: { value: "Edited text" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

  expect(await screen.findByRole("alert")).toHaveTextContent("Not saved: network down");
  expect(closed).toBe(0);
  expect(box).toHaveValue("Edited text");
});

test("a successful save closes the dialog after the save finishes", async () => {
  const order = [];
  render(
    <Harness
      onClose={() => order.push("close")}
      onSave={async () => { order.push("save"); }}
    />
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
  await waitFor(() => expect(order).toEqual(["save", "close"]));
});

test("a parent re-render does not wipe edits in progress", () => {
  render(<Harness onClose={() => {}} onSave={async () => {}} />);
  const box = descriptionBox();
  fireEvent.change(box, { target: { value: "Edited text" } });
  fireEvent.click(screen.getByText("rerender parent"));
  expect(box).toHaveValue("Edited text");
});

test("a product with empty optional fields can be saved", async () => {
  const saves = [];
  render(
    <Harness
      overrides={{ producturl: null, description: null, fabric: null }}
      onClose={() => {}}
      onSave={async (p) => saves.push(p)}
    />
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
  await waitFor(() => expect(saves).toHaveLength(1));
});

test("Save never fails silently: an invalid field is named", async () => {
  render(
    <Harness
      overrides={{ producturl: "not a url" }}
      onClose={() => {}}
      onSave={async () => {}}
    />
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
  expect(await screen.findByRole("alert")).toHaveTextContent("Not saved: check producturl");
});

test("closing with no changes closes straight away", () => {
  let closed = 0;
  render(<Harness onClose={() => { closed += 1; }} onSave={async () => {}} />);
  fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
  expect(closed).toBe(1);
  expect(screen.queryByText("Discard Unsaved Changes?")).not.toBeInTheDocument();
});

test("closing after a change asks first; Keep Editing keeps the text, Discard closes", async () => {
  let closed = 0;
  render(<Harness onClose={() => { closed += 1; }} onSave={async () => {}} />);
  const box = descriptionBox();
  fireEvent.change(box, { target: { value: "Edited text" } });
  await waitFor(() => {
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    expect(screen.getByText("Discard Unsaved Changes?")).toBeInTheDocument();
  });
  expect(closed).toBe(0);

  fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
  await waitFor(() => expect(screen.queryByText("Discard Unsaved Changes?")).not.toBeInTheDocument());
  expect(closed).toBe(0);
  expect(box).toHaveValue("Edited text");

  fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
  fireEvent.click(await screen.findByRole("button", { name: "Discard Changes" }));
  expect(closed).toBe(1);
});
