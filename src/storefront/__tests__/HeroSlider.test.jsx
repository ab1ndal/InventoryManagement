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

// Slide images are decorative (alt="") and <picture>/<source> have no role, so
// these select them directly.
/* eslint-disable testing-library/no-node-access */
function loadedImages() {
  return [...document.querySelectorAll("img")].map((img) => img.getAttribute("src"));
}

// The clock and the next slide both wait for the first image to finish.
async function finishFirstImage() {
  await act(async () => {});
  fireEvent.load(document.querySelector('img[src="https://img.test/BC1.webp"]'));
}
/* eslint-enable testing-library/no-node-access */

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

  /* eslint-disable testing-library/no-container, testing-library/no-node-access */
  it("renders every slide from the config with its CTA link", async () => {
    const { container } = renderSlider();
    SLIDES.forEach((s) => {
      expect(screen.getByRole("heading", { name: s.headline, hidden: true })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Shop A" })).toHaveAttribute("href", "/a");
    expect(activeHeadline()).toBe("Slide A");
    // Product photos resolve asynchronously.
    // Images are decorative (alt=""): the headline and CTA carry the meaning.
    await waitFor(() =>
      expect(container.querySelector('img[src="https://img.test/BC1.webp"]')).not.toBeNull()
    );
  });

  it("serves a slide's mobileUrl below md and its url above", () => {
    const { container } = renderSlider();
    fireEvent.click(screen.getByRole("button", { name: /go to slide 3/i }));
    fireEvent.click(screen.getByRole("button", { name: /go to slide 4/i }));
    const source = container.querySelector('picture source[srcset="/hero/d-mobile.webp"]');
    expect(source).not.toBeNull();
    expect(source).toHaveAttribute("media", "(max-width: 767px)");
    expect(source.parentElement.querySelector("img")).toHaveAttribute("src", "/hero/d-desktop.webp");
    // Slides without a mobileUrl render a bare <img>.
    expect(container.querySelector('img[src="/hero/c.jpg"]').closest("picture")).toBeNull();
  });

  it("asks for only the first slide's image, at high priority, until that image is done", async () => {
    const { container } = renderSlider();
    await act(async () => {});
    expect(loadedImages()).toEqual(["https://img.test/BC1.webp"]);
    expect(container.querySelector("img")).toHaveAttribute("fetchpriority", "high");
  });

  it("then fetches the next slide only, at normal priority", async () => {
    const { container } = renderSlider();
    await finishFirstImage();
    expect(loadedImages()).toContain("https://img.test/BC2.webp");
    expect(loadedImages()).not.toContain("/hero/c.jpg");
    expect(container.querySelector('img[src="https://img.test/BC2.webp"]')).not.toHaveAttribute("fetchpriority");
  });

  it("moves on if the first image fails", async () => {
    const { container } = renderSlider();
    await act(async () => {});
    fireEvent.error(container.querySelector('img[src="https://img.test/BC1.webp"]'));
    expect(loadedImages()).toContain("https://img.test/BC2.webp");
  });

  it("shows a slide's image at once when the visitor jumps to it, and keeps the ones already fetched", async () => {
    renderSlider();
    await finishFirstImage();
    fireEvent.click(screen.getByRole("button", { name: /go to slide 3/i }));
    expect(loadedImages()).toEqual(
      expect.arrayContaining(["https://img.test/BC1.webp", "https://img.test/BC2.webp", "/hero/c.jpg", "/hero/d-desktop.webp"])
    );
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

  it("autoplays every 5 seconds once the first image is done", async () => {
    jest.useFakeTimers();
    renderSlider();
    act(() => jest.advanceTimersByTime(5000));
    expect(activeHeadline()).toBe("Slide A");
    await finishFirstImage();
    act(() => jest.advanceTimersByTime(5000));
    expect(activeHeadline()).toBe("Slide B");
  });

  it("still autoplays if the first image never reports back", () => {
    jest.useFakeTimers();
    renderSlider();
    act(() => jest.advanceTimersByTime(8000));
    act(() => jest.advanceTimersByTime(5000));
    expect(activeHeadline()).toBe("Slide B");
  });

  it("pauses autoplay on hover", async () => {
    jest.useFakeTimers();
    renderSlider();
    await finishFirstImage();
    fireEvent.mouseEnter(screen.getByRole("region", { name: "Featured collections" }));
    act(() => jest.advanceTimersByTime(15000));
    expect(activeHeadline()).toBe("Slide A");
  });

  it("does not autoplay when the visitor prefers reduced motion", async () => {
    mockReducedMotion(true);
    jest.useFakeTimers();
    renderSlider();
    await finishFirstImage();
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
