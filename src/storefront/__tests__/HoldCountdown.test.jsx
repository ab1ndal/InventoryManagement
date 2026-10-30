import React from "react";
import { render, screen, act } from "@testing-library/react";
import HoldCountdown from "../components/cart/HoldCountdown";

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-30T10:00:00Z"));
});

afterEach(() => {
  jest.useRealTimers();
});

it("shows the time left as mm:ss and ticks every second", () => {
  render(<HoldCountdown expiresAt="2026-10-30T10:14:59Z" />);
  expect(screen.getByText("Held for you for", { exact: false })).toHaveTextContent("Held for you for 14:59");
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByText(/held for you/i)).toHaveTextContent("14:58");
  act(() => {
    jest.advanceTimersByTime(60000);
  });
  expect(screen.getByText(/held for you/i)).toHaveTextContent("13:58");
});

it("disappears when the hold lapses", () => {
  render(<HoldCountdown expiresAt="2026-10-30T10:00:02Z" />);
  expect(screen.getByText(/held for you/i)).toHaveTextContent("00:02");
  act(() => {
    jest.advanceTimersByTime(2000);
  });
  expect(screen.queryByText(/held for you/i)).not.toBeInTheDocument();
});

it("renders nothing without a hold or for one already expired", () => {
  const { rerender } = render(<HoldCountdown expiresAt={null} />);
  expect(screen.queryByText(/held for you/i)).not.toBeInTheDocument();
  rerender(<HoldCountdown expiresAt="2026-10-30T09:59:00Z" />);
  expect(screen.queryByText(/held for you/i)).not.toBeInTheDocument();
});

it("calls onExpire once when the hold lapses, so the page can check again", () => {
  const onExpire = jest.fn();
  render(<HoldCountdown expiresAt="2026-10-30T10:00:02Z" onExpire={onExpire} />);
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(onExpire).not.toHaveBeenCalled();
  act(() => {
    jest.advanceTimersByTime(5000);
  });
  expect(onExpire).toHaveBeenCalledTimes(1);
});

it("does not call onExpire for a hold that had already lapsed on arrival", () => {
  const onExpire = jest.fn();
  render(<HoldCountdown expiresAt="2026-10-30T09:59:00Z" onExpire={onExpire} />);
  act(() => {
    jest.advanceTimersByTime(5000);
  });
  expect(onExpire).not.toHaveBeenCalled();
});
