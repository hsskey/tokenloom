// SPEC 9.5 S3 visual difference: align each 2x sample PNG and 2x rendered screenshot to the same
// box, then measure the pixelmatch mismatch ratio. Samples without PNGs produce null.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { extractBlocks } from "./score";

export const PIXELMATCH_THRESHOLD = 0.1;
export const RENDER_SCALE = 2;

/** Mismatched-pixel ratio after aligning two PNGs to one box; zero is an exact match. */
export function comparePngs(expected: Buffer, actual: Buffer): number {
  const a = PNG.sync.read(expected);
  const b = PNG.sync.read(actual);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const left = cropTo(a, width, height);
  const right = cropTo(b, width, height);
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(left.data, right.data, diff.data, width, height, {
    threshold: PIXELMATCH_THRESHOLD,
  });
  return width * height === 0 ? 1 : mismatched / (width * height);
}

/** Crops from the top-left so differently sized images compare only their overlap. */
function cropTo(png: PNG, width: number, height: number): PNG {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (png.width * y + x) << 2;
      const to = (width * y + x) << 2;
      png.data.copy(out.data, to, from, from + 4);
    }
  }
  return out;
}

export interface RenderRequest {
  repoRoot: string;
  sampleName: string;
  /** Complete LLM output from which CSS and HTML blocks are extracted. */
  text: string;
}

export interface VariantShot {
  variant: string;
  png: Buffer;
}

/**
 * Loads Playwright dynamically to keep it out of the CLI bundle on machines without browsers.
 * Tests compare two synthetic PNGs and do not launch a browser.
 */
export async function renderVariants(request: RenderRequest): Promise<VariantShot[]> {
  const blocks = extractBlocks(request.text);
  if (blocks.css === null || blocks.html === null) return [];
  const tokensPath = resolve(request.repoRoot, "samples", request.sampleName, "reference/css/tokens.css");
  const tokensCss = existsSync(tokensPath) ? readFileSync(tokensPath, "utf8") : "";
  const pagePath = resolve(request.repoRoot, "packages/eval/render/index.html");

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: RENDER_SCALE });
    await page.goto(`file://${pagePath}`);
    // Keep the callback anonymous because esbuild's injected `__name` helper is absent in-page.
    await page.evaluate(
      ([tokens, css, html]: string[]) => {
        const tokenNode = document.getElementById("tokens");
        if (tokenNode !== null) tokenNode.textContent = tokens ?? "";
        const cssNode = document.getElementById("generated");
        if (cssNode !== null) cssNode.textContent = css ?? "";
        const root = document.getElementById("root");
        if (root !== null) root.innerHTML = html ?? "";
      },
      [tokensCss, blocks.css, blocks.html],
    );
    const shots: VariantShot[] = [];
    for (const handle of await page.locator("[data-variant]").all()) {
      const variant = (await handle.getAttribute("data-variant")) ?? "";
      shots.push({ variant, png: await handle.screenshot() });
    }
    return shots;
  } finally {
    await browser.close();
  }
}

/** Returns null when the sample has no rendered PNG, which is a valid S3 result (SPEC 9.5). */
export function expectedPngPath(repoRoot: string, sampleName: string, nodeId: string): string | null {
  const path = resolve(repoRoot, "samples", sampleName, "render", `${nodeId}.png`);
  return existsSync(path) ? path : null;
}
