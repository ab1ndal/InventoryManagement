import React from "react";
import { render, screen } from "@testing-library/react";
import StaticPage from "../components/StaticPage";

describe("StaticPage", () => {
  it("renders title heading, and children", () => {
    render(
      <StaticPage title="Shipping Policy" seoDescription="desc">
        <p>Body content here</p>
      </StaticPage>
    );
    expect(screen.getByRole("heading", { name: "Shipping Policy" })).toBeInTheDocument();
    expect(screen.getByText("Body content here")).toBeInTheDocument();
  });
});
