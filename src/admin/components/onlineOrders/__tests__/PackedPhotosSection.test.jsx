import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PackedPhotosSection from "../PackedPhotosSection";

let mockCalls;
jest.mock("../onlineOrdersApi", () => ({
  action: (body) => {
    mockCalls.push(body);
    return Promise.resolve(body.action === "packed_photo_url" ? { uploadUrl: "https://up.test/x", path: "o1/packed/x.jpg" } : {});
  },
}));
jest.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

beforeEach(() => {
  mockCalls = [];
  global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
});

const order = (over = {}) => ({ id: "o1", status: "packed", packed_photos: [], ...over });

test("hidden before packing, and warns staff about labels once packed", () => {
  const { container, rerender } = render(<PackedPhotosSection order={order({ status: "paid" })} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<PackedPhotosSection order={order()} />);
  expect(screen.getByText(/before the label goes on/)).toBeInTheDocument();
});

test("uploads to the server's URL, then records the path", async () => {
  const onChanged = jest.fn();
  render(<PackedPhotosSection order={order()} onChanged={onChanged} />);
  const file = new File(["x"], "box.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("Add packed photos"), { target: { files: [file] } });
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(global.fetch).toHaveBeenCalledWith("https://up.test/x", expect.objectContaining({ method: "PUT", body: file }));
  expect(mockCalls).toEqual([
    { action: "packed_photo_url", orderId: "o1", contentType: "image/jpeg" },
    { action: "packed_photo_add", orderId: "o1", path: "o1/packed/x.jpg" },
  ]);
});

test("at 4 photos there is no add button, and a photo can be removed", async () => {
  const onChanged = jest.fn();
  const photos = ["a", "b", "c", "d"].map((id) => ({ id, uploaded_at: "2026-11-03T10:00:00Z" }));
  render(<PackedPhotosSection order={order({ packed_photos: photos })} onChanged={onChanged} />);
  expect(screen.queryByRole("button", { name: "Add photos" })).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(mockCalls).toEqual([{ action: "packed_photo_remove", photoId: "a" }]);
});

test("a cancelled order keeps its photos removable but takes no more", () => {
  render(<PackedPhotosSection order={order({ status: "cancelled", packed_photos: [{ id: "a", uploaded_at: "2026-11-03T10:00:00Z" }] })} />);
  expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add photos" })).toBeNull();
});
