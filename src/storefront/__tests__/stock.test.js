import { isSoldOut, orderImagesByStock } from "../lib/stock";

describe("isSoldOut", () => {
  it("is true when every variant has no stock", () => {
    expect(isSoldOut([{ stock: 0 }, { stock: 0 }])).toBe(true);
  });

  it("treats negative and missing stock as none", () => {
    expect(isSoldOut([{ stock: -1 }, { stock: null }, {}])).toBe(true);
  });

  it("is false when any variant still has stock", () => {
    expect(isSoldOut([{ stock: 0 }, { stock: 1 }])).toBe(false);
  });

  it("is false without variant data, so unknown stock never hides the price", () => {
    expect(isSoldOut([])).toBe(false);
    expect(isSoldOut(undefined)).toBe(false);
    expect(isSoldOut(null)).toBe(false);
  });
});

describe("orderImagesByStock", () => {
  const img = (productcolor, imageurl = productcolor) => ({ imageurl, productcolor });

  it("moves a sold-out colour's photo behind in-stock colours (BC25884)", () => {
    const images = [img("Black"), img("Peacock Green"), img("Navy Blue")];
    const variants = [
      { color: "Black", stock: 0 },
      { color: "Peacock Green", stock: 1 },
      { color: "Navy Blue", stock: 1 },
    ];
    expect(orderImagesByStock(images, variants).map((i) => i.productcolor)).toEqual([
      "Peacock Green",
      "Navy Blue",
      "Black",
    ]);
  });

  it("keeps the existing order within the in-stock and sold-out groups", () => {
    const images = [img("A", "a1"), img("B", "b1"), img("C", "c1"), img("A", "a2"), img("D", "d1")];
    const variants = [
      { color: "A", stock: 0 },
      { color: "B", stock: 2 },
      { color: "C", stock: 0 },
      { color: "D", stock: 1 },
    ];
    expect(orderImagesByStock(images, variants).map((i) => i.imageurl)).toEqual([
      "b1",
      "d1",
      "a1",
      "c1",
      "a2",
    ]);
  });

  it("counts a colour in stock when any of its sizes has stock", () => {
    const images = [img("Red"), img("Blue")];
    const variants = [
      { color: "Red", stock: 0 },
      { color: "Red", stock: 1 },
      { color: "Blue", stock: 1 },
    ];
    expect(orderImagesByStock(images, variants).map((i) => i.productcolor)).toEqual(["Red", "Blue"]);
  });

  it("matches colours ignoring case and surrounding spaces", () => {
    const images = [img("peacock green "), img("Navy Blue")];
    const variants = [
      { color: "Peacock Green", stock: 0 },
      { color: "navy blue", stock: 1 },
    ];
    expect(orderImagesByStock(images, variants).map((i) => i.productcolor)).toEqual([
      "Navy Blue",
      "peacock green ",
    ]);
  });

  it("leaves untagged photos and colours no variant uses in place", () => {
    const images = [img(null, "plain"), img("Multi Color", "multi"), img("Green", "green")];
    const variants = [{ color: "Green", stock: 1 }, { color: "Multi", stock: 0 }];
    expect(orderImagesByStock(images, variants).map((i) => i.imageurl)).toEqual([
      "plain",
      "multi",
      "green",
    ]);
  });

  it("keeps the order when every colour is sold out", () => {
    const images = [img("A"), img("B")];
    const variants = [{ color: "A", stock: 0 }, { color: "B", stock: 0 }];
    expect(orderImagesByStock(images, variants)).toEqual(images);
  });

  it("returns the images unchanged without variant data", () => {
    const images = [img("A"), img("B")];
    expect(orderImagesByStock(images, undefined)).toBe(images);
    expect(orderImagesByStock(images, null)).toBe(images);
    expect(orderImagesByStock(images, [])).toBe(images);
  });

  it("does not mutate the input array", () => {
    const images = [img("A"), img("B")];
    orderImagesByStock(images, [{ color: "A", stock: 0 }, { color: "B", stock: 1 }]);
    expect(images.map((i) => i.productcolor)).toEqual(["A", "B"]);
  });
});
