import { resizePhoto } from "../resizePhoto";

const original = new File(["camera bytes"], "box.png", { type: "image/png" });
let drawn;

function mockCanvas(blob = new Blob(["small"], { type: "image/jpeg" })) {
  drawn = [];
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: () => {},
    drawImage: (...args) => drawn.push(args.slice(1)),
  });
  jest.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(blob));
  jest.spyOn(console, "warn").mockImplementation(() => {});
}

afterEach(() => {
  jest.restoreAllMocks();
  delete global.createImageBitmap;
});

const bitmapOf = (width, height) => () => Promise.resolve({ width, height, close: () => {} });

test("shrinks the longest side to 1600 and returns a JPEG with the same name", async () => {
  mockCanvas();
  global.createImageBitmap = bitmapOf(3000, 4000);
  const out = await resizePhoto(original);
  expect(drawn).toEqual([[0, 0, 1200, 1600]]);
  expect([out.type, out.name]).toEqual(["image/jpeg", "box.png"]);
});

test("never enlarges a small photo", async () => {
  mockCanvas();
  global.createImageBitmap = bitmapOf(800, 600);
  await resizePhoto(original);
  expect(drawn).toEqual([[0, 0, 800, 600]]);
});

test("uploads the original when the browser cannot decode or encode it", async () => {
  mockCanvas(null);
  global.createImageBitmap = bitmapOf(800, 600);
  expect(await resizePhoto(original)).toBe(original);
  global.createImageBitmap = () => Promise.reject(new Error("cannot decode"));
  expect(await resizePhoto(original)).toBe(original);
});
