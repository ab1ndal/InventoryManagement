import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ReturnsSection from "../ReturnsSection";

// Plain functions + mutable state: CRA resetMocks wipes jest.fn implementations.
let mockActions = [];
let mockActionImpl = null;
let mockToasts = [];

jest.mock("../onlineOrdersApi", () => ({
  action: async (payload) => {
    mockActions.push(payload);
    return mockActionImpl ? mockActionImpl(payload) : { ok: true };
  },
}));
jest.mock("sonner", () => ({
  toast: {
    success: (m) => mockToasts.push(["success", m]),
    error: (m, o) => mockToasts.push(["error", m, o?.description]),
  },
}));

const DELIVERED = "2026-10-20T10:00:00Z";

const items = [
  { id: "i1", line_no: 1, product_name: "Kurta", size: "M", color: "Red", qty: 3, shipped_qty: 3, paid_value: 3000 },
  { id: "i2", line_no: 2, product_name: "Dupatta", size: null, color: null, qty: 1, shipped_qty: 1, paid_value: 800 },
];

const openReturn = (over = {}) => ({
  id: "r1",
  order_id: "o1",
  reason: "change_of_mind",
  status: "open",
  contacted_at: "2026-10-21T10:00:00Z",
  note: "Does not fit",
  items: [{ return_id: "r1", item_id: "i1", units: 2, received_units: null, restock_units: null }],
  photos: [],
  ...over,
});

const order = (over = {}) => ({ id: "o1", status: "delivered", delivered_at: DELIVERED, shipping: 99, returns: [], ...over });

const renderSection = (props = {}) => {
  const onChanged = jest.fn();
  render(<ReturnsSection order={order()} items={items} role="admin" onChanged={onChanged} {...props} />);
  return onChanged;
};

beforeEach(() => {
  mockActions = [];
  mockActionImpl = null;
  mockToasts = [];
});

test("Open return caps units at what is still returnable", async () => {
  renderSection({
    order: order({ returns: [openReturn({ items: [{ item_id: "i1", units: 2 }] })] }),
  });
  fireEvent.click(screen.getByRole("button", { name: "Open return…" }));
  const dialog = await screen.findByRole("dialog");
  const kurta = within(dialog).getByLabelText("Units of Kurta");
  expect(kurta).toHaveAttribute("max", "1"); // 3 shipped − 2 in the open return
  expect(within(dialog).getByLabelText("Units of Dupatta")).toHaveAttribute("max", "1");
});

test("Open return sends ISO contactedAt and only the chosen units", async () => {
  const onChanged = renderSection();
  fireEvent.click(screen.getByRole("button", { name: "Open return…" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Units of Kurta"), { target: { value: "2" } });
  fireEvent.change(within(dialog).getByLabelText("Note"), { target: { value: "  Too small " } });
  fireEvent.change(within(dialog).getByLabelText("Contacted at"), { target: { value: "2026-10-21T12:30" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Open return" }));
  await waitFor(() => expect(mockActions).toHaveLength(1));
  expect(mockActions[0]).toEqual({
    action: "return_open",
    orderId: "o1",
    reason: "change_of_mind",
    contactedAt: new Date("2026-10-21T12:30").toISOString(),
    items: [{ itemId: "i1", units: 2 }],
    note: "Too small",
  });
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

test("Open return needs a note and at least one unit", async () => {
  renderSection();
  fireEvent.click(screen.getByRole("button", { name: "Open return…" }));
  const dialog = await screen.findByRole("dialog");
  const submit = within(dialog).getByRole("button", { name: "Open return" });
  expect(submit).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Units of Kurta"), { target: { value: "1" } });
  expect(submit).toBeDisabled(); // no note yet
  fireEvent.change(within(dialog).getByLabelText("Note"), { target: { value: "x" } });
  expect(submit).toBeEnabled();
});

describe("outside the window", () => {
  const fill = async (role) => {
    renderSection({ role });
    fireEvent.click(screen.getByRole("button", { name: "Open return…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Units of Kurta"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Note"), { target: { value: "late" } });
    fireEvent.change(within(dialog).getByLabelText("Contacted at"), { target: { value: "2026-11-05T10:00" } });
    return dialog;
  };

  test("admin cannot submit and sees no override field", async () => {
    const dialog = await fill("admin");
    expect(within(dialog).queryByLabelText("Override reason")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Open return" })).toBeDisabled();
    expect(dialog).toHaveTextContent("Outside the return window");
  });

  test("superadmin must give an override reason, which is sent", async () => {
    const dialog = await fill("superadmin");
    const submit = within(dialog).getByRole("button", { name: "Open return" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Override reason"), { target: { value: "Owner approved" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(mockActions).toHaveLength(1));
    expect(mockActions[0].overrideReason).toBe("Owner approved");
  });
});

test("inside the window the override field is hidden even for a superadmin", async () => {
  renderSection({ role: "superadmin" });
  fireEvent.click(screen.getByRole("button", { name: "Open return…" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByLabelText("Override reason")).not.toBeInTheDocument();
});

test("no Open return button unless the order is delivered", () => {
  renderSection({ order: order({ status: "shipped", delivered_at: null }) });
  expect(screen.queryByRole("button", { name: "Open return…" })).not.toBeInTheDocument();
});

test("Add photos stays available while open; Receive is disabled for damaged until a photo exists", () => {
  const damaged = openReturn({ reason: "damaged_wrong", photos: [] });
  const { unmount } = render(
    <ReturnsSection order={order({ returns: [damaged] })} items={items} role="admin" onChanged={() => {}} />
  );
  expect(screen.getByLabelText("Add photos")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Receive…" })).toBeDisabled();
  expect(screen.getByText(/needs at least one photo/i)).toBeInTheDocument();
  unmount();

  render(
    <ReturnsSection
      order={order({ returns: [{ ...damaged, photos: [{ id: "p1", uploaded_at: "2026-10-21T10:00:00Z" }] }] })}
      items={items}
      role="admin"
      onChanged={() => {}}
    />
  );
  expect(screen.getByLabelText("Add photos")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Receive…" })).toBeEnabled();
});

test("a change-of-mind return can be received without photos; closed returns have no actions", () => {
  render(
    <ReturnsSection
      order={order({ returns: [openReturn(), openReturn({ id: "r2", status: "refunded" })] })}
      items={items}
      role="admin"
      onChanged={() => {}}
    />
  );
  expect(screen.getAllByRole("button", { name: "Receive…" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Receive…" })).toBeEnabled();
  expect(screen.getAllByLabelText("Add photos")).toHaveLength(1);
});

test("photo upload: signed url, PUT, then add", async () => {
  const puts = [];
  global.fetch = async (url, init) => {
    puts.push([url, init.method, init.body]);
    return { ok: true };
  };
  mockActionImpl = (p) =>
    p.action === "return_photo_url" ? { ok: true, uploadUrl: "https://up/x", path: "o1/r1/u.jpg" } : { ok: true };
  const onChanged = jest.fn();
  render(
    <ReturnsSection
      order={order({ returns: [openReturn({ reason: "damaged_wrong" })] })}
      items={items}
      role="admin"
      onChanged={onChanged}
    />
  );
  const file = new File(["x"], "a.heif", { type: "image/heif" });
  fireEvent.change(screen.getByLabelText("Add photos"), { target: { files: [file] } });
  await waitFor(() => expect(mockActions).toHaveLength(2));
  expect(mockActions[0]).toEqual({ action: "return_photo_url", returnId: "r1", contentType: "image/heif" });
  expect(puts).toEqual([["https://up/x", "PUT", file]]);
  expect(mockActions[1]).toEqual({ action: "return_photo_add", returnId: "r1", path: "o1/r1/u.jpg" });
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

describe("Receive dialog", () => {
  const twoItems = openReturn({
    items: [
      { item_id: "i1", units: 2 },
      { item_id: "i2", units: 1 },
    ],
  });
  const openReceive = async (ret = twoItems) => {
    mockActionImpl = (p) =>
      p.action === "return_preview"
        ? { ok: true, preview: { credit_part: 100, gateway_part: 1500.5, shipping: 0, total: 1600.5 } }
        : { ok: true, status: "refunded" };
    const onChanged = renderSection({ order: order({ returns: [ret] }) });
    fireEvent.click(screen.getByRole("button", { name: "Receive…" }));
    const dialog = await screen.findByRole("dialog");
    return { dialog, onChanged };
  };

  test("shows amounts from return_preview, requesting every item with restock units", async () => {
    const { dialog } = await openReceive();
    await waitFor(() => expect(dialog).toHaveTextContent("₹1,600.50"));
    expect(dialog).toHaveTextContent("₹100.00");
    expect(dialog).toHaveTextContent("₹1,500.50");
    const preview = mockActions.filter((a) => a.action === "return_preview").pop();
    expect(preview).toEqual({
      action: "return_preview",
      returnId: "r1",
      items: [
        { itemId: "i1", receivedUnits: 2, restockUnits: 2 },
        { itemId: "i2", receivedUnits: 1, restockUnits: 1 },
      ],
    });
  });

  test("fewer pieces back than expected requires a note; full receipt does not", async () => {
    const { dialog } = await openReceive();
    const confirm = within(dialog).getByRole("button", { name: "Receive and refund" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.change(within(dialog).getByLabelText("Received units of Kurta"), { target: { value: "1" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Receive note"), { target: { value: "One piece missing" } });
    expect(confirm).toBeEnabled();
  });

  test("restock is capped by received; receiving sends the arrays and note", async () => {
    const { dialog, onChanged } = await openReceive();
    fireEvent.change(within(dialog).getByLabelText("Received units of Kurta"), { target: { value: "1" } });
    expect(within(dialog).getByLabelText("Restock units of Kurta")).toHaveValue(1);
    fireEvent.change(within(dialog).getByLabelText("Restock units of Dupatta"), { target: { value: "0" } });
    fireEvent.change(within(dialog).getByLabelText("Receive note"), { target: { value: "short" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Receive and refund" }));
    await waitFor(() => expect(mockActions.some((a) => a.action === "return_receive")).toBe(true));
    expect(mockActions.find((a) => a.action === "return_receive")).toEqual({
      action: "return_receive",
      returnId: "r1",
      items: [
        { itemId: "i1", receivedUnits: 1, restockUnits: 1 },
        { itemId: "i2", receivedUnits: 1, restockUnits: 0 },
      ],
      note: "short",
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  test("receiving nothing is a rejection and says so", async () => {
    const { dialog } = await openReceive(openReturn());
    fireEvent.change(within(dialog).getByLabelText("Received units of Kurta"), { target: { value: "0" } });
    expect(dialog).toHaveTextContent("No refund");
    expect(within(dialog).getByRole("button", { name: "Reject return" })).toBeDisabled(); // note required
  });
});

test("Cancel return sends the note", async () => {
  const onChanged = renderSection({ order: order({ returns: [openReturn()] }) });
  fireEvent.click(screen.getByRole("button", { name: "Cancel return…" }));
  const dialog = await screen.findByRole("dialog");
  const confirm = within(dialog).getByRole("button", { name: "Cancel return" });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Cancel note"), { target: { value: "Customer changed mind again" } });
  fireEvent.click(confirm);
  await waitFor(() => expect(mockActions).toEqual([{ action: "return_cancel", returnId: "r1", note: "Customer changed mind again" }]));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

test("View photo opens the signed url", async () => {
  const opened = [];
  window.open = (u) => opened.push(u);
  mockActionImpl = () => ({ ok: true, url: "https://signed/p1" });
  renderSection({
    order: order({ returns: [openReturn({ photos: [{ id: "p1", uploaded_at: "2026-10-21T10:00:00Z" }] })] }),
  });
  fireEvent.click(screen.getByRole("button", { name: "View photo 1" }));
  await waitFor(() => expect(opened).toEqual(["https://signed/p1"]));
  expect(mockActions[0]).toEqual({ action: "return_photo_view", photoId: "p1" });
});
