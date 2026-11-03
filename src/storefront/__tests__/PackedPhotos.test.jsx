import { render, screen } from "@testing-library/react";
import PackedPhotos from "../components/PackedPhotos";

test("renders nothing without photos", () => {
  const { container } = render(<PackedPhotos photos={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test("shows each photo with alt text", () => {
  render(<PackedPhotos photos={["https://x.test/a.jpg", "https://x.test/b.jpg"]} />);
  expect(screen.getByAltText("Your packed order, view 2")).toHaveAttribute("src", "https://x.test/b.jpg");
});
