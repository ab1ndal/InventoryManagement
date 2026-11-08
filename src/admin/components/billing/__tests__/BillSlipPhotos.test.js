import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BillSlipPhotos from "../BillSlipPhotos";
import { addSlipPhoto, listSlipPhotos, removeSlipPhoto } from "../../../lib/billSlipPhotos";
import { resizePhoto } from "../../onlineOrders/resizePhoto";

jest.mock("../../../../lib/supabaseClient", () => ({ supabase: { tag: "client" } }));
jest.mock("../../../lib/billSlipPhotos", () => ({
  addSlipPhoto: jest.fn(),
  listSlipPhotos: jest.fn(),
  removeSlipPhoto: jest.fn(),
  slipPhotoUrl: jest.fn(),
}));
jest.mock("../../onlineOrders/resizePhoto", () => ({ resizePhoto: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const photo = { id: "a1", billid: 7, path: "7/a1.jpg" };

beforeEach(() => {
  jest.clearAllMocks();
  listSlipPhotos.mockResolvedValue([photo]);
});

test("on a new bill, holds dropped photos and uploads them once the save gives an id", async () => {
  resizePhoto.mockImplementation(async (f) => f);
  addSlipPhoto.mockResolvedValue(photo);
  const { rerender } = render(<BillSlipPhotos billId={null} />);
  const slip = new File(["x"], "slip.jpg", { type: "image/jpeg" });
  fireEvent.drop(screen.getByText("or drop photos here").closest("section"), { dataTransfer: { files: [slip] } });
  expect(await screen.findByText("saves with the bill")).toBeInTheDocument();
  expect(addSlipPhoto).not.toHaveBeenCalled();
  expect(listSlipPhotos).not.toHaveBeenCalled();

  rerender(<BillSlipPhotos billId={7} />);
  await waitFor(() => expect(addSlipPhoto).toHaveBeenCalledTimes(1));
  expect(addSlipPhoto).toHaveBeenCalledWith({ tag: "client" }, 7, { body: slip, contentType: "image/jpeg", size: 1 });
  expect(await screen.findByText("Slip photo 1")).toBeInTheDocument();
  expect(screen.queryByText("saves with the bill")).not.toBeInTheDocument();
});

test("a held photo can be taken back before saving", async () => {
  resizePhoto.mockImplementation(async (f) => f);
  const { rerender } = render(<BillSlipPhotos billId={null} />);
  const slip = new File(["x"], "slip.jpg", { type: "image/jpeg" });
  fireEvent.drop(screen.getByText("or drop photos here").closest("section"), { dataTransfer: { files: [slip] } });
  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  rerender(<BillSlipPhotos billId={7} />);
  await screen.findByText("Slip photo 1");
  expect(addSlipPhoto).not.toHaveBeenCalled();
});

test("lists the bill's slip photos", async () => {
  render(<BillSlipPhotos billId={7} />);
  expect(await screen.findByText("Slip photo 1")).toBeInTheDocument();
  expect(listSlipPhotos).toHaveBeenCalledWith({ tag: "client" }, 7);
});

test("shrinks a picked photo to 2000 px and uploads it to the bill", async () => {
  const shrunk = new File(["small"], "slip.jpg", { type: "image/jpeg" });
  resizePhoto.mockResolvedValue(shrunk);
  addSlipPhoto.mockResolvedValue(photo);
  render(<BillSlipPhotos billId={7} />);
  const picked = new File(["camera"], "IMG_1.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("Add slip photos"), { target: { files: [picked] } });
  await waitFor(() => expect(addSlipPhoto).toHaveBeenCalled());
  expect(resizePhoto).toHaveBeenCalledWith(picked, { maxSidePx: 2000 });
  expect(addSlipPhoto).toHaveBeenCalledWith({ tag: "client" }, 7, { body: shrunk, contentType: "image/jpeg", size: 5 });
});

test("uploads image files dropped on the section and ignores other files", async () => {
  resizePhoto.mockImplementation(async (f) => f);
  addSlipPhoto.mockResolvedValue(photo);
  render(<BillSlipPhotos billId={7} />);
  const slip = new File(["x"], "slip.jpg", { type: "image/jpeg" });
  const pdf = new File(["y"], "bill.pdf", { type: "application/pdf" });
  fireEvent.drop(screen.getByText("or drop photos here").closest("section"), { dataTransfer: { files: [slip, pdf] } });
  await waitFor(() => expect(addSlipPhoto).toHaveBeenCalledTimes(1));
  expect(resizePhoto).toHaveBeenCalledWith(slip, { maxSidePx: 2000 });
});

test("removes a photo and reloads the list", async () => {
  removeSlipPhoto.mockResolvedValue();
  render(<BillSlipPhotos billId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  await waitFor(() => expect(removeSlipPhoto).toHaveBeenCalledWith({ tag: "client" }, photo));
  await waitFor(() => expect(listSlipPhotos).toHaveBeenCalledTimes(2));
});
