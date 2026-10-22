import React from "react";
import { render, screen } from "@testing-library/react";
import BlurFillImage from "../components/BlurFillImage";

const PATH = "https://example.supabase.co/storage/v1/object/public/mockups/BC1/a.webp";

describe("BlurFillImage", () => {
  it("defaults to the whole image over a blurred fill", () => {
    const { container } = render(<BlurFillImage path={PATH} alt="Saree" />);
    expect(screen.getByAltText("Saree")).toHaveClass("object-contain");
    expect(container.querySelector('img[aria-hidden="true"]')).not.toBeNull();
  });

  it("serves the sized variant in front and the smallest one as the blur", () => {
    const { container } = render(<BlurFillImage path={PATH} alt="Saree" />);
    expect(screen.getByAltText("Saree")).toHaveAttribute(
      "src",
      "https://example.supabase.co/storage/v1/object/public/mockups/BC1/a_600.webp"
    );
    expect(container.querySelector('img[aria-hidden="true"]')).toHaveAttribute(
      "src",
      "https://example.supabase.co/storage/v1/object/public/mockups/BC1/a_150.webp"
    );
  });

  it("fit=cover fills the frame from the top with no blur layer", () => {
    const { container } = render(<BlurFillImage path={PATH} alt="Saree" fit="cover" />);
    const img = screen.getByAltText("Saree");
    expect(img).toHaveClass("object-cover", "object-top");
    expect(img).not.toHaveClass("object-contain");
    expect(container.querySelector('img[aria-hidden="true"]')).toBeNull();
  });
});
