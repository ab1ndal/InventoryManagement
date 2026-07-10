import React from "react";
import { render, screen } from "@testing-library/react";
import FaqPage from "../pages/FaqPage";

describe("FaqPage", () => {
  it("renders the exchange policy and delivery answers", () => {
    render(<FaqPage />);
    expect(screen.getByText(/exchanges are accepted within 7 days/i)).toBeInTheDocument();
    expect(screen.getByText(/dispatch within 2 working days/i)).toBeInTheDocument();
    // No COD claim anywhere on the page.
    expect(screen.queryByText(/cash on delivery|COD/i)).toBeNull();
  });
});
