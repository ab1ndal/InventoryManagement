jest.mock("lib/supabaseClient", () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import TrackOrderPage from "../pages/TrackOrderPage";

describe("TrackOrderPage", () => {
  it("renders heading, order-ref and phone inputs, and a submit button", () => {
    render(
      <MemoryRouter>
        <TrackOrderPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: /track your order/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/order reference/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check status/i })).toBeInTheDocument();
  });

  it("shows placeholder message on submit without calling supabase", () => {
    render(
      <MemoryRouter>
        <TrackOrderPage />
      </MemoryRouter>
    );
    const button = screen.getByRole("button", { name: /check status/i });
    fireEvent.click(button);
    expect(
      screen.getByText(
        /Online order tracking will be available once online orders go live/i
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/message us at \+91 98108 73280/i)).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
