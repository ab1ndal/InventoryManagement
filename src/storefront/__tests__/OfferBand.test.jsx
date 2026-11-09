import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OfferBand from "../components/home/OfferBand";
import { HOME_OFFER } from "../lib/siteConfig";

function renderOffer(now) {
  return render(
    <MemoryRouter>
      <OfferBand now={now} />
    </MemoryRouter>
  );
}

describe("OfferBand", () => {
  it("shows the offer details and shop link before the end date", () => {
    renderOffer(new Date("2026-11-30T18:29:59.000Z"));

    // index.css colours every h2 gray-900, which beats the band's inherited cream on the dark background.
    expect(screen.getByRole("heading", { name: HOME_OFFER.headline })).toHaveClass("text-storefront-cream");
    expect(screen.getByText(HOME_OFFER.code)).toBeInTheDocument();
    expect(screen.getByText(HOME_OFFER.terms)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /shop now/i })).toHaveAttribute("href", "/shop");
  });

  it("renders nothing after 30 November in India", () => {
    const { container } = renderOffer(new Date("2026-11-30T18:30:00.000Z"));

    expect(container).toBeEmptyDOMElement();
  });

  it("copies GET500 and confirms it briefly", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderOffer(new Date("2026-11-15T06:30:00.000Z"));

    fireEvent.click(screen.getByRole("button", { name: /copy offer code GET500/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("GET500"));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
});
