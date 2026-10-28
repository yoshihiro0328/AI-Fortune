import { describe, it, expect } from "vitest";
import {
  boxBetween,
  moveSelection,
  resizeSelection,
  pixelSelection,
} from "../src/lib/screenshot/selection";
describe("image selection across scales and edges", () => {
  it("normalizes reverse drags and clamps outside the image", () => {
    expect(boxBetween({ x: 1.2, y: 0.8 }, { x: -0.3, y: 0.1 })).toEqual({
      x: 0,
      y: 0.1,
      width: 1,
      height: 0.7000000000000001,
    });
  });
  it("moves without changing dimensions or crossing edges", () => {
    expect(
      moveSelection({ x: 0.2, y: 0.2, width: 0.4, height: 0.3 }, 1, -1),
    ).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.3 });
  });
  it("resizes all corners without inversion", () => {
    const r = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
    for (const corner of ["nw", "ne", "sw", "se"] as const)
      for (const delta of [-2, 2]) {
        const n = resizeSelection(r, corner, delta, delta);
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.width).toBeGreaterThan(0);
        expect(n.height).toBeGreaterThan(0);
        expect(n.x + n.width).toBeLessThanOrEqual(1.000001);
        expect(n.y + n.height).toBeLessThanOrEqual(1.000001);
      }
  });
  it("maps normalized selection to complete covered pixels at any display scale", () => {
    expect(
      pixelSelection({ x: 0.23, y: 0.1, width: 0.77, height: 0.9 }, 1000, 500),
    ).toEqual({ x: 230, y: 50, width: 770, height: 450 });
    expect(
      pixelSelection({ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, 333, 777),
    ).toEqual({ x: 33, y: 77, width: 34, height: 79 });
    expect(() =>
      pixelSelection({ x: 1, y: 1, width: 0, height: 0 }, 640, 700),
    ).toThrow();
  });
});
