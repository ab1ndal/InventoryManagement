const mockPreview = jest.fn();
const mockChoose = jest.fn();
jest.mock("../lib/ordersApi", () => ({
  ...jest.requireActual("../lib/ordersApi"),
  refundPreview: (...a) => mockPreview(...a),
  refundChoose: (...a) => mockChoose(...a),
}));

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import RefundChoicePage from "../pages/RefundChoicePage";
import { OrdersApiError } from "../lib/ordersApi";

const PREVIEW = {
  orderRef: "WEB-000001",
  status: "awaiting_choice",
  amount: 1500,
  creditPart: 0,
  gatewayPart: 1500,
  items: [{ name: "Silk Saree", size: "FREE", color: "Red", units: 1 }],
  expiresAt: "2026-10-25T10:00:00Z",
  isGuest: true,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/refund-choice/tok123"]}>
      <Routes>
        <Route path="/refund-choice/:token" element={<RefundChoicePage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

it("offers both refund options and shows the voucher code after choosing credit as a guest", async () => {
  mockPreview.mockResolvedValue(PREVIEW);
  mockChoose.mockResolvedValue({
    status: "completed", choice: "store_credit",
    vouchers: [{ code: "ABCDEFGHJKLMNPQR", value: 1500, expiry: "2027-10-23" }], creditAdded: 0,
  });
  renderPage();
  expect(await screen.findByText(/How would you like your ₹1,500 refund\?/)).toBeInTheDocument();
  expect(mockPreview).toHaveBeenCalledWith("tok123");
  expect(screen.getByRole("button", { name: "Refund to original payment method (5–7 working days)" })).toBeInTheDocument();
  userEvent.click(screen.getByRole("button", { name: "Instant store credit" }));
  expect(await screen.findByTestId("voucher-code")).toHaveTextContent("ABCDEFGHJKLMNPQR");
  expect(mockChoose).toHaveBeenCalledWith("tok123", "store_credit");
});

it("confirms store credit added for a registered shopper", async () => {
  mockPreview.mockResolvedValue({ ...PREVIEW, isGuest: false });
  mockChoose.mockResolvedValue({ status: "completed", choice: "store_credit", vouchers: [], creditAdded: 1500 });
  renderPage();
  userEvent.click(await screen.findByRole("button", { name: "Instant store credit" }));
  expect(await screen.findByText(/₹1,500 has been added to your store credit/)).toBeInTheDocument();
});

it("confirms a refund to the original method", async () => {
  mockPreview.mockResolvedValue(PREVIEW);
  mockChoose.mockResolvedValue({ status: "processing", choice: "original", vouchers: [], creditAdded: 0 });
  renderPage();
  userEvent.click(await screen.findByRole("button", { name: /original payment method/ }));
  expect(await screen.findByText(/on its way to your original payment method/)).toBeInTheDocument();
});

it("says already chosen when the choice was made before", async () => {
  mockPreview.mockResolvedValue(PREVIEW);
  mockChoose.mockRejectedValue(new OrdersApiError("already", { code: "already_chosen", status: 409 }));
  renderPage();
  userEvent.click(await screen.findByRole("button", { name: "Instant store credit" }));
  expect(await screen.findByText("You've already chosen your refund")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /whatsapp us/i })).toHaveAttribute("href", "https://wa.me/919810873280");
});

it("says already chosen when the preview is past the choice step", async () => {
  mockPreview.mockResolvedValue({ ...PREVIEW, status: "processing" });
  renderPage();
  expect(await screen.findByText("You've already chosen your refund")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Instant store credit" })).not.toBeInTheDocument();
});

it("explains an expired link with a WhatsApp link", async () => {
  mockPreview.mockRejectedValue(new OrdersApiError("expired", { code: "expired", status: 410 }));
  renderPage();
  expect(await screen.findByText("This refund link has expired")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /whatsapp us/i })).toBeInTheDocument();
});

it("explains an invalid link", async () => {
  mockPreview.mockRejectedValue(new OrdersApiError("nope", { code: "invalid_token", status: 404 }));
  renderPage();
  expect(await screen.findByText("This refund link isn't valid")).toBeInTheDocument();
});
