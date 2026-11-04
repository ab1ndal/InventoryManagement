import React, { Suspense } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import RouteErrorBoundary from "../RouteErrorBoundary";
import { lazyWithReload } from "../../lib/lazyWithReload";

const reload = jest.fn();
const realLocation = window.location;

beforeAll(() => {
  delete window.location;
  window.location = { ...realLocation, reload, pathname: "/shop" };
});

afterAll(() => {
  window.location = realLocation;
});

let logged;

beforeEach(() => {
  sessionStorage.clear();
  logged = jest.spyOn(console, "error").mockImplementation(() => {});
});

function Broken() {
  throw new Error("boom");
}

function renderPage(page) {
  return render(
    <MemoryRouter initialEntries={["/shop"]}>
      <RouteErrorBoundary>
        <Suspense fallback={<p>Loading</p>}>{page}</Suspense>
      </RouteErrorBoundary>
    </MemoryRouter>
  );
}

const flush = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("a page that throws shows a plain message and a reload button", () => {
  renderPage(<Broken />);
  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
  expect(reload).toHaveBeenCalledTimes(1);
});

test("the error is logged with the page and the stack", () => {
  renderPage(<Broken />);
  const call = logged.mock.calls.find(([message]) => String(message).startsWith("RouteErrorBoundary"));
  expect(call[1]).toEqual(
    expect.objectContaining({
      path: "/shop",
      error: expect.objectContaining({ message: "boom" }),
      componentStack: expect.stringContaining("Broken"),
    })
  );
});

test("a working page renders as normal", () => {
  renderPage(<p>Fine</p>);
  expect(screen.getByText("Fine")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("going to another page clears the message", () => {
  function Switcher() {
    const { pathname } = useLocation();
    return pathname === "/shop" ? <Broken /> : <p>Other page</p>;
  }
  render(
    <MemoryRouter initialEntries={["/shop"]}>
      <Link to="/other">Go</Link>
      <RouteErrorBoundary>
        <Switcher />
      </RouteErrorBoundary>
    </MemoryRouter>
  );
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Go" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("Other page")).toBeInTheDocument();
});

describe("a missing lazy page file", () => {
  const Missing = () => lazyWithReload(() => Promise.reject(new Error("chunk gone")));

  test("first failure reloads by itself, and the message does not get in the way", async () => {
    const Page = Missing();
    renderPage(<Page />);
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  test("a failure after that reload shows the message instead of looping", async () => {
    sessionStorage.setItem("chunk_reload_attempted", "1");
    const Page = Missing();
    renderPage(<Page />);
    await flush();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });
});
