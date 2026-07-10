import React from "react";
import { render } from "@testing-library/react";
import Seo from "../components/Seo";

describe("Seo", () => {
  it("composes the document title with the site name", () => {
    render(<Seo title="Shop" description="Browse" />);
    expect(document.title).toBe("Shop — Bindal's Creations");
  });

  it("falls back to the bare site name when no title", () => {
    render(<Seo description="Home" />);
    expect(document.title).toBe("Bindal's Creations");
  });

  it("renders a JSON-LD script when jsonLd provided", () => {
    const { container } = render(
      <Seo title="P" jsonLd={{ "@type": "Product", name: "P" }} />
    );
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(JSON.parse(script.innerHTML).name).toBe("P");
  });
});
