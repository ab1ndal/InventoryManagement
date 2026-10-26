import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CustomizePage from "../pages/CustomizePage";
import { NAV_LINKS } from "../lib/siteConfig";

function renderPage() {
  render(
    <MemoryRouter>
      <CustomizePage />
    </MemoryRouter>
  );
}

describe("CustomizePage", () => {
  it("sends design requests to the shop's WhatsApp with a request template", () => {
    renderPage();
    const [whatsapp] = screen.getAllByRole("link", { name: /send your photo on whatsapp/i });
    const url = new URL(whatsapp.getAttribute("href"));
    expect(url.origin + url.pathname).toBe("https://wa.me/919810873280");
    const text = url.searchParams.get("text");
    ["Garment:", "Budget:", "Quantity:", "Size:"].forEach((field) => expect(text).toContain(field));
  });

  it("offers email as the alternative", () => {
    renderPage();
    const [email] = screen.getAllByRole("link", { name: /or email us/i });
    expect(email.getAttribute("href")).toMatch(/^mailto:bindalscreations@gmail\.com\?subject=/);
  });

  it("states the owner's terms: 50% advance, ₹3,000 minimum, rush, 1-day refund ask, in-store alterations", () => {
    renderPage();
    const text = document.body.textContent;
    expect(text).toMatch(/as closely as we can/i);
    expect(text).toMatch(/pay 50% to start/i);
    expect(text).toMatch(/₹3,000/);
    expect(text).toMatch(/under 2 weeks/i);
    expect(text).toMatch(/within 1 day/i);
    expect(text).toMatch(/can't take back delivered pieces for alterations/i);
    expect(text).not.toMatch(/—/);
  });

  it("keeps the full rules in a fold so the page stays short", () => {
    renderPage();
    const fold = screen.getByText(/before you order/i).closest("details");
    expect(fold).not.toHaveAttribute("open");
    expect(fold).toHaveTextContent(/within 1 day/i);
  });

  it("is linked from the header nav", () => {
    expect(NAV_LINKS).toContainEqual({ label: "Custom Tailoring", to: "/customize" });
  });
});
