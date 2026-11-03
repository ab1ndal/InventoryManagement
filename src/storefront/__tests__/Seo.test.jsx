import React from "react";
import { render } from "@testing-library/react";
import Seo from "../components/Seo";

const canonical = () => document.head.querySelector('link[rel="canonical"]')?.getAttribute("href");

describe("Seo", () => {
  afterEach(() => window.history.pushState({}, "", "/"));

  it("composes the document title with the site name", () => {
    render(<Seo title="Shop" description="Browse" />);
    expect(document.title).toBe("Shop — Bindal's Creation");
  });

  it("falls back to the bare site name when no title", () => {
    render(<Seo description="Home" />);
    expect(document.title).toBe("Bindal's Creation");
  });

  it("points a filtered page at the page itself, on the real domain", () => {
    window.history.pushState({}, "", "/shop/?color=red");
    render(<Seo title="Shop" />);
    expect(canonical()).toBe("https://www.bindalscreations.com/shop");
  });

  it("gives a noindex page no canonical", () => {
    window.history.pushState({}, "", "/cart");
    render(<Seo title="Your cart" noindex />);
    expect(canonical()).toBeUndefined();
  });
});
