import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { comparePngs, expectedPngPath, PIXELMATCH_THRESHOLD, RENDER_SCALE } from "../src/visual";

const repoRoot = resolve(import.meta.dirname, "../../..");

/** Synthetic PNG used to verify mismatch ratios without launching a browser (TESTS 10). */
function solid(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    const at = i << 2;
    png.data[at] = rgb[0];
    png.data[at + 1] = rgb[1];
    png.data[at + 2] = rgb[2];
    png.data[at + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** Image whose left half differs, producing an expected mismatch ratio of 0.5. */
function halfDifferent(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (width * y + x) << 2;
      const dark = x < width / 2;
      png.data[at] = dark ? 0 : 255;
      png.data[at + 1] = dark ? 0 : 255;
      png.data[at + 2] = dark ? 0 : 255;
      png.data[at + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe("S3 visual difference (SPEC 9.5)", () => {
  it("returns zero for identical images", () => {
    const a = solid(40, 20, [255, 255, 255]);
    expect(comparePngs(a, solid(40, 20, [255, 255, 255]))).toBe(0);
  });

  it("returns one for completely different images", () => {
    expect(comparePngs(solid(40, 20, [255, 255, 255]), solid(40, 20, [0, 0, 0]))).toBe(1);
  });

  it("returns 0.5 when half the image differs", () => {
    const ratio = comparePngs(solid(40, 20, [255, 255, 255]), halfDifferent(40, 20));
    expect(ratio).toBeCloseTo(0.5, 2);
  });

  it("compares only the overlapping box when image sizes differ", () => {
    const small = solid(20, 20, [0, 0, 0]);
    const large = solid(40, 20, [0, 0, 0]);
    expect(comparePngs(small, large)).toBe(0);
  });

  it("uses the SPEC 9.5 threshold and scale", () => {
    expect(PIXELMATCH_THRESHOLD).toBe(0.1);
    expect(RENDER_SCALE).toBe(2);
  });

  it("returns a null path when the sample has no rendered PNG", () => {
    expect(expectedPngPath(repoRoot, "button", "12:35")).toBe(null);
  });
});
