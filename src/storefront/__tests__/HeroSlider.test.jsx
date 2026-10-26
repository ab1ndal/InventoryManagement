import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HeroSlider from "../components/home/HeroSlider";

// Plain function, not jest.fn: CRA's resetMocks would wipe a mock implementation.
jest.mock("../lib/productImage", () => ({
  getProductImageUrl: (id) => Promise.resolve(`https://img.test/${id}.webp`),
}));


const SLIDES = [
  { id: "a", headline: "Slide A", subline: "Sub A", cta: "Shop A", href: "/a", images: [{ productid: "BC1" }] },
  { id: "b", headline: "Slide B", subline: "Sub B", cta: "Shop B", href: "/b", images: [{ productid: "BC2" }, { productid: "BC3" }] },
  { id: "c", headline: "Slide C", subline: "Sub C", cta: "Shop C", href: "/c", images: [{ url: "/hero/c.jpg" }] },
  {
    id: "d",
    headline: "Slide D",
    subline: "Sub D",
    cta: "Shop D",
    href: "/d",
    images: [{ url: "/hero/d-desktop.webp", mobileUrl: "/hero/d-mobile.webp" }],
  },
];

function mockReducedMotion(reduce) {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
}

function renderSlider() {
  return render(
    <MemoryRouter>
      <HeroSlider slides={SLIDES} />
    </MemoryRouter>
  );
}

// The active slide is the only one not hidden from assistive tech.
function activeHeadline() {
  const slides = screen.getAllByRole("group", { hidden: true });
  const active = slides.filter((s) => s.getAttribute("aria-hidden") !== "true");
  expect(active).toHaveLength(1);
  return active[0].querySelector("h2").textContent;
}

describe("HeroSlider", () => {
  beforeEach(() => mockReducedMotion(false));
  afterEach(() => jest.useRealTimers());

  // Slide images are decorative (alt="") and <picture>/<source> have no role,
  // so the next two tests select them directly.
  /* eslint-disable testing-library/no-container, testing-library/no-node-access */
  it("renders every slide from the config with its CTA link", async () => {
    const { container } = renderSlider();
    SLIDES.forEach((s) => {
      expect(screen.getByRole("heading", { name: s.headline, hidden: true })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Shop A" })).toHaveAttribute("href", "/a");
    expect(activeHeadline()).toBe("Slide A");
    // Static urls render at once; product photos resolve asynchronously.
    // Images are decorative (alt=""): the headline and CTA carry the meaning.
    expect(container.querySelector('img[src="/hero/c.jpg"]')).not.toBeNull();
    await waitFor(() =>
      expect(container.querySelector('img[src="https://img.test/BC1.webp"]')).not.toBeNull()
    );
  });

  it("serves a slide's mobileUrl below md and its url above", () => {
    const { container } = renderSlider();
    const source = container.querySelector('picture source[srcset="/hero/d-mobile.webp"]');
    expect(source).not.toBeNull();
    expect(source).toHaveAttribute("media", "(max-width: 767px)");
    expect(source.parentElement.querySelector("img")).toHaveAttribute("src", "/hero/d-desktop.webp");
    // Slides without a mobileUrl render a bare <img>.
    expect(container.querySelector('img[src="/hero/c.jpg"]').closest("picture")).toBeNull();
  });
  /* eslint-enable testing-library/no-container, testing-library/no-node-access */

  it("moves forward and backward with the arrows, wrapping at the ends", () => {
    renderSlider();
    fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
    expect(activeHeadline()).toBe("Slide B");
    fireEvent.click(screen.getByRole("button", { name: /previous slide/i }));
    fireEvent.click(screen.getByRole("button", { name: /previous slide/i }));
    expect(activeHeadline()).toBe("Slide D");
  });

  it("jumps to a slide from its dot", () => {
    renderSlider();
    fireEvent.click(screen.getByRole("button", { name: /go to slide 3/i }));
    expect(activeHeadline()).toBe("Slide C");
    expect(screen.getByRole("button", { name: /go to slide 3/i })).toHaveAttribute("aria-current", "true");
  });

  it("autoplays every 5 seconds", () => {
    jest.useFakeTimers();
    renderSlider();
    act(() => jest.advanceTimersByTime(5000));
    expect(activeHeadline()).toBe("Slide B");
  });

  it("pauses autoplay on hover", () => {
    jest.useFakeTimers();
    renderSlider();
    fireEvent.mouseEnter(screen.getByRole("region", { name: "Featured collections" }));
    act(() => jest.advanceTimersByTime(15000));
    expect(activeHeadline()).toBe("Slide A");
  });

  it("does not autoplay when the visitor prefers reduced motion", () => {
    mockReducedMotion(true);
    jest.useFakeTimers();
    renderSlider();
    act(() => jest.advanceTimersByTime(15000));
    expect(activeHeadline()).toBe("Slide A");
  });

  it("changes slide on a horizontal swipe", () => {
    renderSlider();
    const section = screen.getByRole("region", { name: "Featured collections" });
    fireEvent.touchStart(section, { touches: [{ clientX: 300, clientY: 10 }] });
    fireEvent.touchEnd(section, { changedTouches: [{ clientX: 100, clientY: 12 }] });
    expect(activeHeadline()).toBe("Slide B");
  });
});
