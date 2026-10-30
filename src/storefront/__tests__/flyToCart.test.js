import { flyToCart } from "../lib/flyToCart";

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

function setup({ target = true } = {}) {
  document.body.innerHTML = "";
  const button = document.createElement("button");
  button.getBoundingClientRect = () => rect(100, 600, 200, 48);
  document.body.append(button);
  let cart = null;
  if (target) {
    cart = document.createElement("button");
    cart.setAttribute("data-cart-target", "");
    cart.getBoundingClientRect = () => rect(340, 20, 36, 36);
    document.body.append(cart);
  }
  return { button, cart };
}

describe("flyToCart", () => {
  const originalAnimate = Element.prototype.animate;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    Element.prototype.animate = jest.fn(() => ({
      finished: Promise.resolve(),
      cancel: jest.fn(),
    }));
    window.matchMedia = jest.fn(() => ({ matches: false }));
  });

  afterEach(() => {
    Element.prototype.animate = originalAnimate;
    window.matchMedia = originalMatchMedia;
    document.body.innerHTML = "";
  });

  it("drops the dress into a bag that flies to the cart, bounces the cart, then cleans up", async () => {
    const { button, cart } = setup();
    const done = flyToCart({ from: button, image: "dress.webp" });

    const overlay = document.body.querySelector("div[aria-hidden='true']");
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector("img").getAttribute("src")).toBe("dress.webp");
    expect(overlay.querySelectorAll("svg")).toHaveLength(2);

    await done;
    const animated = Element.prototype.animate.mock.instances;
    expect(animated).toContain(cart);
    expect(document.body.querySelector("div[aria-hidden='true']")).toBeNull();
  });

  it("still flies the bag when there is no photo", async () => {
    const { button } = setup();
    const done = flyToCart({ from: button, image: null });
    expect(document.body.querySelector("img")).toBeNull();
    await done;
    expect(Element.prototype.animate).toHaveBeenCalled();
  });

  it("does nothing for visitors who prefer reduced motion", async () => {
    window.matchMedia = jest.fn(() => ({ matches: true }));
    const { button } = setup();
    await flyToCart({ from: button, image: "dress.webp" });
    expect(Element.prototype.animate).not.toHaveBeenCalled();
    expect(document.body.querySelector("div")).toBeNull();
  });

  it("does nothing when the page has no cart icon", async () => {
    const { button } = setup({ target: false });
    await flyToCart({ from: button, image: "dress.webp" });
    expect(Element.prototype.animate).not.toHaveBeenCalled();
  });

  it("does nothing where the Web Animations API is missing", async () => {
    Element.prototype.animate = undefined;
    const { button } = setup();
    await flyToCart({ from: button, image: "dress.webp" });
    expect(document.body.querySelector("div")).toBeNull();
  });
});
