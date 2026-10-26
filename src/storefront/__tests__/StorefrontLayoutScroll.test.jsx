import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Link, useNavigate } from "react-router-dom";
import StorefrontLayout from "../components/StorefrontLayout";

jest.mock("../components/StorefrontHeader", () => () => null);
jest.mock("../components/StorefrontFooter", () => () => null);
jest.mock("../components/cart/CartDrawer", () => () => null);
jest.mock("../context/StorefrontAuthContext", () => ({
  StorefrontAuthProvider: ({ children }) => children,
}));
jest.mock("../context/CartContext", () => ({ CartProvider: ({ children }) => children }));
jest.mock("../context/WishlistContext", () => ({ WishlistProvider: ({ children }) => children }));
jest.mock("../lib/analytics", () => ({ initAnalytics: jest.fn(), trackPageView: jest.fn() }));


function Page({ to }) {
  const navigate = useNavigate();
  return (
    <>
      <Link to={to}>go</Link>
      <button type="button" onClick={() => navigate(-1)}>back</button>
    </>
  );
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/collections/sarees"]}>
      <Routes>
        <Route path="/" element={<StorefrontLayout />}>
          <Route path="collections/sarees" element={<Page to="/collections/suits" />} />
          <Route path="collections/suits" element={<Page to="/collections/sarees" />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.scrollTo = jest.fn();
});

test("following a link scrolls the new page to the top", () => {
  renderApp();
  window.scrollTo.mockClear();
  fireEvent.click(screen.getByRole("link", { name: "go" }));
  expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
});

test("going back leaves scroll to the browser", () => {
  renderApp();
  fireEvent.click(screen.getByRole("link", { name: "go" }));
  window.scrollTo.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "back" }));
  expect(window.scrollTo).not.toHaveBeenCalled();
});
