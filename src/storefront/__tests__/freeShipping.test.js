import {
  FREE_SHIPPING_THRESHOLD,
  SUGGEST_GAP_LIMIT,
  freeShippingProgress,
} from "../lib/freeShipping";
import { shippingFee } from "../lib/checkout";

describe("freeShippingProgress", () => {
  it("reports the gap and a floored percent below the threshold", () => {
    expect(freeShippingProgress(3760)).toEqual({ qualified: false, gap: 1240, percent: 75 });
  });

  it("qualifies at exactly the threshold", () => {
    expect(freeShippingProgress(5000)).toEqual({ qualified: true, gap: 0, percent: 100 });
  });

  it("starts from the full threshold at zero", () => {
    expect(freeShippingProgress(0)).toMatchObject({ gap: 5000, percent: 0 });
  });

  it("clamps gap and percent above the threshold", () => {
    expect(freeShippingProgress(9000)).toEqual({ qualified: true, gap: 0, percent: 100 });
  });
});

describe("constants", () => {
  it("exposes the threshold and suggestion limit", () => {
    expect(FREE_SHIPPING_THRESHOLD).toBe(5000);
    expect(SUGGEST_GAP_LIMIT).toBe(2000);
  });

  it("shippingFee uses the same threshold", () => {
    expect(shippingFee(FREE_SHIPPING_THRESHOLD - 1)).toBe(99);
    expect(shippingFee(FREE_SHIPPING_THRESHOLD)).toBe(0);
  });
});
