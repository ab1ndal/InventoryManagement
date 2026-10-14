jest.mock("lib/supabaseClient", () => ({
  supabase: { from: jest.fn() },
}));
jest.mock("../hooks/useProduct", () => ({ useProduct: jest.fn() }));
jest.mock("../lib/productImage", () => ({
  getProductImagePaths: jest.fn(),
  imageUrl: (path) => path,
}));
jest.mock("../context/CartContext", () => ({
  useCart: () => ({ addItem: jest.fn(), openCart: jest.fn() }),
}));
jest.mock("../components/ProductCard", () => (props) => (
  <div data-testid="product-card">{props.product.name}</div>
));

import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import { useProduct } from "../hooks/useProduct";
import { getProductImagePaths } from "../lib/productImage";
import ProductDetailPage from "../pages/ProductDetailPage";
import { MEASURE_INTRO } from "../pages/sizeGuideContent";

const PRODUCT = {
  productid: "BC252742",
  name: "Silk-Lehenga",
  description: "A shimmering **pistachio green** lehenga with **zari** work.",
  categoryid: "LE",
  fabric: "Silk",
  retailprice: 12500,
  categories: { name: "Lehenga" },
};

const VARIANTS = [
  { variantid: "v1", size: "UNSTITCHED", color: "Green", stock: 1 },
  { variantid: "v2", size: "UNSTITCHED", color: "Peach", stock: 1 },
];

const RELATED = [
  { productid: "BC250001", name: "Rose Lehenga" },
  { productid: "BC250002", name: "Gold Lehenga" },
];

function mockRelated(data = RELATED) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    neq: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => Promise.resolve({ data, error: null })),
  };
  supabase.from.mockReturnValue(chain);
  return chain;
}

function renderPage(product = PRODUCT) {
  useProduct.mockReturnValue({ product, variants: VARIANTS, loading: false, error: null });
  return render(
    <MemoryRouter initialEntries={[`/product/${product.productid}`]}>
      <Routes>
        <Route path="/product/:productid" element={<ProductDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  global.IntersectionObserver = jest.fn(() => ({ observe: jest.fn(), disconnect: jest.fn() }));
  window.scrollTo = jest.fn(); // jsdom does not implement scrolling
  // CRA resets mock implementations before each test, so set them here.
  getProductImagePaths.mockResolvedValue(["one.png", "two.png"]);
  mockRelated();
});

afterEach(() => {
  delete global.IntersectionObserver;
});

describe("ProductDetailPage", () => {
  it("opens the size guide in a modal without leaving the page", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /size guide/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /size guide/i })).toBeInTheDocument();
    expect(within(dialog).getByText(MEASURE_INTRO[0])).toBeInTheDocument();
    expect(within(dialog).getByRole("columnheader", { name: "M" })).toBeInTheDocument();
    // Still on the product page underneath.
    expect(
      screen.getByRole("heading", { level: 1, name: "Silk-Lehenga", hidden: true })
    ).toBeInTheDocument();
  });

  it("renders the description without markdown asterisks", async () => {
    const { container } = renderPage();
    expect(
      await screen.findByText("A shimmering pistachio green lehenga with zari work.")
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("**");
  });

  it("hides the description block when the description is empty", () => {
    renderPage({ ...PRODUCT, description: " ** " });
    expect(screen.queryByRole("heading", { name: /^description$/i })).not.toBeInTheDocument();
  });

  it("links Ask on WhatsApp with a message naming the product id", () => {
    renderPage();
    const link = screen.getByRole("link", { name: /ask on whatsapp/i });
    const href = link.getAttribute("href");
    expect(href).toMatch(/^https:\/\/wa\.me\/919810873280\?text=/);
    expect(decodeURIComponent(href)).toContain("BC252742");
    expect(decodeURIComponent(href)).toContain("Silk-Lehenga");
  });

  it("shows a details table with category, fabric, colours and sizes", () => {
    renderPage();
    const details = screen.getByRole("region", { name: /details/i });
    expect(within(details).getByText("Lehenga")).toBeInTheDocument();
    expect(within(details).getByText("Silk")).toBeInTheDocument();
    expect(within(details).getByText("Green, Peach")).toBeInTheDocument();
    expect(within(details).getByText("Unstitched")).toBeInTheDocument();
  });

  it("shows the tax and shipping line and the trust row", () => {
    renderPage();
    expect(
      screen.getByText("Inclusive of all taxes · Free shipping above ₹5,000")
    ).toBeInTheDocument();
    expect(screen.getByText(/handpicked with love/i)).toBeInTheDocument();
    expect(screen.getByText(/exchange in store within 7 days/i)).toBeInTheDocument();
  });

  it("opens a lightbox from the main image and steps to the next photo", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /enlarge image/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("1 / 2")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /next image/i }));
    expect(within(dialog).getByText("2 / 2")).toBeInTheDocument();
  });

  it("shows a More like this rail from the same category, excluding this product", async () => {
    const chain = mockRelated();
    renderPage();
    expect(await screen.findByText("Rose Lehenga")).toBeInTheDocument();
    expect(screen.getAllByTestId("product-card")).toHaveLength(2);
    expect(chain.eq).toHaveBeenCalledWith("categoryid", "LE");
    expect(chain.neq).toHaveBeenCalledWith("productid", "BC252742");
    expect(chain.limit).toHaveBeenCalledWith(8);
  });

  it("renders one add-to-cart button until the sticky bar is needed", () => {
    renderPage();
    expect(screen.getAllByRole("button", { name: /select size/i })).toHaveLength(1);
  });
});
