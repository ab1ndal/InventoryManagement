import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import { useProduct } from "../hooks/useProduct";
import { getProductImagePaths } from "../lib/productImage";
import ProductDetailPage from "../pages/ProductDetailPage";
import { MEASURE_INTRO } from "../pages/sizeGuideContent";

jest.mock("lib/supabaseClient", () => ({
  supabase: { from: jest.fn() },
}));
jest.mock("../hooks/useProduct", () => ({ useProduct: jest.fn() }));
jest.mock("../lib/productImage", () => ({
  getProductImagePaths: jest.fn(),
  imageUrl: (path) => path,
  imageColor: (path) => ({ "green.png": "Green", "peach.png": "Peach" })[path] ?? null,
}));
jest.mock("../context/CartContext", () => ({
  useCart: () => ({ addItem: jest.fn(), openCart: jest.fn() }),
}));
jest.mock("../components/ProductCard", () => (props) => (
  <div data-testid="product-card">{props.product.name}</div>
));


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
  { productid: "BC250001", name: "Rose Lehenga", categoryid: "LE", retailprice: 12000, productsizecolors: [{ stock: 1, color: "Pink" }] },
  { productid: "BC250002", name: "Gold Lehenga", categoryid: "LE", retailprice: 13000, productsizecolors: [{ stock: 1, color: "Green" }] },
  { productid: "BC250003", name: "Sold Lehenga", categoryid: "LE", retailprice: 12500, productsizecolors: [{ stock: 0, color: "Green" }] },
];

function mockRelated(data = RELATED) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    in: jest.fn(() => chain),
    neq: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => Promise.resolve({ data, error: null })),
  };
  supabase.from.mockReturnValue(chain);
  return chain;
}

function renderPage(product = PRODUCT, variants = VARIANTS) {
  useProduct.mockReturnValue({ product, variants, loading: false, error: null });
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
    expect(within(dialog).getByRole("row", { name: "XL 42" })).toBeInTheDocument();
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

  it("lists only in-stock sizes, in order, as available sizes", () => {
    renderPage(PRODUCT, [
      { variantid: "x1", size: "XL|42", color: "Green", stock: 1 },
      { variantid: "x2", size: "M|38", color: "Green", stock: 0 },
      { variantid: "x3", size: "M|38", color: "Peach", stock: 2 },
      { variantid: "x4", size: "L|40", color: "Green", stock: 0 },
    ]);
    const details = screen.getByRole("region", { name: /details/i });
    expect(within(details).getByText("Available sizes")).toBeInTheDocument();
    expect(within(details).getByText("M (38), XL (42)")).toBeInTheDocument();
  });

  it("has no category eyebrow above the product title", () => {
    renderPage();
    const h1 = screen.getByRole("heading", { level: 1, name: "Silk-Lehenga", hidden: true });
    // Checks DOM order: what sits directly above the title.
    // eslint-disable-next-line testing-library/no-node-access
    const prev = h1.previousElementSibling;
    expect(prev?.textContent ?? "").not.toBe("Lehenga");
  });

  it("shows the price and shipping line and the trust row", () => {
    renderPage();
    expect(
      screen.getByText("Final price · Free shipping above ₹5,000")
    ).toBeInTheDocument();
    expect(screen.getByText(/handpicked with love/i)).toBeInTheDocument();
    expect(screen.getByText(/exchange in store within 7 days/i)).toBeInTheDocument();
    // Composition dealer: no tax claim anywhere on the page.
    expect(document.body.textContent).not.toMatch(/inclusive of all taxes/i);
  });

  it("shows Sold out instead of the price and its note when every variant is sold out", () => {
    renderPage(PRODUCT, VARIANTS.map((v) => ({ ...v, stock: 0 })));
    expect(screen.getByText("Sold out")).toBeInTheDocument();
    expect(screen.queryByText("₹12,500")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Final price · Free shipping above ₹5,000")
    ).not.toBeInTheDocument();
  });

  it("keeps the price when only some variants are sold out", () => {
    renderPage(PRODUCT, [{ ...VARIANTS[0], stock: 0 }, VARIANTS[1]]);
    expect(screen.getByText("₹12,500")).toBeInTheDocument();
    expect(screen.queryByText("Sold out")).not.toBeInTheDocument();
  });

  it("keeps the price for a product with no variants", () => {
    renderPage(PRODUCT, []);
    expect(screen.getByText("₹12,500")).toBeInTheDocument();
    expect(screen.queryByText("Sold out")).not.toBeInTheDocument();
  });

  it("opens a lightbox from the main image and steps to the next photo", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /enlarge image/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("1 / 2")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /next image/i }));
    expect(within(dialog).getByText("2 / 2")).toBeInTheDocument();
  });

  it("shows a ranked More like this rail from the category group, without sold-out pieces", async () => {
    const chain = mockRelated();
    renderPage();
    expect(await screen.findByText("Rose Lehenga")).toBeInTheDocument();
    // Gold shares a colour (Green) with this product, so it ranks first.
    expect(screen.getAllByTestId("product-card").map((c) => c.textContent)).toEqual([
      "Gold Lehenga",
      "Rose Lehenga",
    ]);
    expect(chain.in).toHaveBeenCalledWith("categoryid", ["LE"]);
    expect(chain.neq).toHaveBeenCalledWith("productid", "BC252742");
    expect(screen.getByRole("link", { name: /view all lehengas/i })).toHaveAttribute(
      "href",
      "/collections/lehengas"
    );
  });

  it("renders one add-to-cart button until the sticky bar is needed", () => {
    renderPage();
    expect(screen.getAllByRole("button", { name: /select size/i })).toHaveLength(1);
  });
});

describe("ProductDetailPage — colour photos", () => {
  // The main image is the one inside the "Enlarge image" button.
  // The main image is alt-less inside the button, so select it directly.
  const mainImageSrc = () =>
    // eslint-disable-next-line testing-library/no-node-access
    screen.getByRole("button", { name: /enlarge image/i }).querySelector("img").getAttribute("src");

  it("shows the photo of the colour the shopper picks", async () => {
    getProductImagePaths.mockResolvedValue(["green.png", "peach.png"]);
    renderPage();
    await screen.findByRole("button", { name: /enlarge image/i });
    expect(mainImageSrc()).toContain("green.png");
    fireEvent.click(screen.getByRole("button", { name: "Peach" }));
    expect(mainImageSrc()).toContain("peach.png");
    fireEvent.click(screen.getByRole("button", { name: "Green" }));
    expect(mainImageSrc()).toContain("green.png");
  });

  it("keeps the current photo when the picked colour has none", async () => {
    getProductImagePaths.mockResolvedValue(["green.png", "other.png"]);
    renderPage();
    await screen.findByRole("button", { name: /enlarge image/i });
    fireEvent.click(screen.getByRole("button", { name: "Peach" }));
    expect(mainImageSrc()).toContain("green.png");
  });
});
