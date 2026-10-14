import React, { useRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import StickyAddToCart from "../components/product/StickyAddToCart";

let observerCallback;
let observed;
const disconnect = jest.fn();

beforeEach(() => {
  observerCallback = null;
  observed = null;
  disconnect.mockClear();
  global.IntersectionObserver = jest.fn((cb) => {
    observerCallback = cb;
    return {
      observe: (el) => {
        observed = el;
      },
      disconnect,
    };
  });
});

afterEach(() => {
  delete global.IntersectionObserver;
});

function Harness({ onClick = jest.fn() }) {
  const ref = useRef(null);
  return (
    <>
      <button ref={ref}>Main add to cart</button>
      <StickyAddToCart
        targetRef={ref}
        image="thumb.png"
        name="Silk Lehenga"
        price={12500}
        label="Add to Cart"
        onClick={onClick}
      />
    </>
  );
}

function setIntersecting(isIntersecting) {
  act(() => observerCallback([{ isIntersecting }]));
}

describe("StickyAddToCart", () => {
  it("observes the main add-to-cart button and starts hidden", () => {
    render(<Harness />);
    expect(observed).toBe(screen.getByText("Main add to cart"));
    expect(screen.queryByTestId("sticky-add-to-cart")).not.toBeInTheDocument();
  });

  it("appears when the main button leaves the viewport and hides when it returns", () => {
    render(<Harness />);
    setIntersecting(false);
    const bar = screen.getByTestId("sticky-add-to-cart");
    expect(bar).toHaveTextContent("Silk Lehenga");
    expect(bar).toHaveTextContent("₹12,500");
    setIntersecting(true);
    expect(screen.queryByTestId("sticky-add-to-cart")).not.toBeInTheDocument();
  });

  it("flags the body while visible so the floating WhatsApp button can move up", () => {
    render(<Harness />);
    expect(document.body).not.toHaveAttribute("data-sticky-cart");
    setIntersecting(false);
    expect(document.body).toHaveAttribute("data-sticky-cart");
    setIntersecting(true);
    expect(document.body).not.toHaveAttribute("data-sticky-cart");
  });

  it("runs the action from the bar button", () => {
    const onClick = jest.fn();
    render(<Harness onClick={onClick} />);
    setIntersecting(false);
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = render(<Harness />);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
