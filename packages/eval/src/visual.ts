// SPEC 9.5 S3 visual difference: align each 2x sample PNG and 2x rendered screenshot to the same
// box, then measure the pixelmatch mismatch ratio. Samples without PNGs produce null.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { z } from "zod";
import { extractBlocks } from "./score";
import { variantMarkers } from "./html-markers";
import { resolveVariantMarker, variantReferences, type ExpectedVariants, type VariantReference } from "./variant-reference";

export const PIXELMATCH_THRESHOLD = 0.1;
export const RENDER_SCALE = 2;
const RATIO_DIGITS = 4;

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

export type RenderPort = (request: RenderRequest) => Promise<VariantShot[]>;

export const S3Status = z.enum(["measured", "not-applicable", "error"]);
export type S3StatusT = z.infer<typeof S3Status>;

export const S3ErrorCode = z.enum([
  "NO_SNAPSHOT_COMPONENT", "AMBIGUOUS_SNAPSHOT_COMPONENT", "REFERENCE_FILE_MISSING", "FILENAME_RULE_MISMATCH",
  "PNG_DECODE_FAILED", "RENDER_FAILED", "NO_COMPARABLE_VARIANT", "DOM_DISAGREEMENT",
]);
export type S3Error = z.infer<typeof S3ErrorCode>;

export const S3Detail = z.object({
  withReference: z.number(),
  compared: z.number(),
  max: z.number().nullable(),
  mean: z.number().nullable(),
  worst: z.object({ selector: z.string(), ratio: z.number() }).nullable(),
  notRendered: z.array(z.string()),
  errors: z.array(z.object({ selector: z.string().nullable(), code: S3ErrorCode })),
});
export type S3DetailT = z.infer<typeof S3Detail>;

export interface S3Result {
  s3Status: S3StatusT;
  s3: number | null;
  s3Detail: S3DetailT;
}

function round(value: number): number {
  return Number(value.toFixed(RATIO_DIGITS));
}

function sameMarkers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

export function scoreS3(
  references: VariantReference[],
  shots: VariantShot[],
  readPng: (path: string) => Buffer,
  domMarkers: string[],
  parsedMarkers: string[],
): S3Result {
  const withReference = references.filter((r) => r.failure === undefined && r.renderPng !== null);
  const detail: S3DetailT = {
    withReference: withReference.length, compared: 0, max: null, mean: null, worst: null, notRendered: [], errors: [],
  };

  if (!sameMarkers(domMarkers, parsedMarkers)) {
    detail.errors.push({ selector: null, code: "DOM_DISAGREEMENT" });
    return { s3Status: "error", s3: null, s3Detail: detail };
  }

  for (const reference of references) {
    if (reference.failure !== undefined) detail.errors.push({ selector: reference.selector, code: reference.failure });
  }

  if (withReference.length === 0) {
    return detail.errors.length === 0
      ? { s3Status: "not-applicable", s3: null, s3Detail: detail }
      : { s3Status: "error", s3: null, s3Detail: detail };
  }

  const shotBySelector = new Map<string, Buffer>();
  for (const shot of shots) if (!shotBySelector.has(shot.variant)) shotBySelector.set(shot.variant, shot.png);

  const ratios: { selector: string; ratio: number }[] = [];
  for (const reference of withReference) {
    const png = shotBySelector.get(reference.selector);
    if (png === undefined) { detail.notRendered.push(reference.selector); continue; }
    try {
      ratios.push({ selector: reference.selector, ratio: round(comparePngs(readPng(reference.renderPng as string), png)) });
    } catch {
      detail.errors.push({ selector: reference.selector, code: "PNG_DECODE_FAILED" });
    }
  }

  detail.compared = ratios.length;
  if (ratios.length > 0) {
    detail.worst = ratios.reduce((worst, candidate) => (candidate.ratio > worst.ratio ? candidate : worst));
    detail.max = detail.worst.ratio;
    detail.mean = round(ratios.reduce((sum, candidate) => sum + candidate.ratio, 0) / ratios.length);
  }
  detail.notRendered.sort();

  if (detail.errors.length > 0) return { s3Status: "error", s3: null, s3Detail: detail };
  if (ratios.length === 0) {
    detail.errors.push({ selector: null, code: "NO_COMPARABLE_VARIANT" });
    return { s3Status: "error", s3: null, s3Detail: detail };
  }
  return { s3Status: "measured", s3: detail.max, s3Detail: detail };
}

export interface MeasureS3Options {
  repoRoot: string;
  target: { sampleName: string; node?: string };
  expected: ExpectedVariants;
  text: string;
  render: RenderPort;
  readPng: (path: string) => Buffer;
}

export async function measureS3(options: MeasureS3Options): Promise<S3Result> {
  const references = variantReferences(options.repoRoot, options.target, options.expected.selectors);
  const html = extractBlocks(options.text).html;
  const parsedMarkers = html === null ? [] : variantMarkers(html);
  const hasReference = references.some((r) => r.failure === undefined && r.renderPng !== null);
  if (!hasReference) return scoreS3(references, [], options.readPng, parsedMarkers, parsedMarkers);

  let shots: VariantShot[];
  try {
    shots = await options.render({ repoRoot: options.repoRoot, sampleName: options.target.sampleName, text: options.text });
  } catch {
    return {
      s3Status: "error", s3: null,
      s3Detail: {
        withReference: references.filter((r) => r.failure === undefined && r.renderPng !== null).length,
        compared: 0, max: null, mean: null, worst: null, notRendered: [], errors: [{ selector: null, code: "RENDER_FAILED" }],
      },
    };
  }

  const domMarkers = shots.map((shot) => shot.variant);
  const resolvedShots = shots.map((shot) => {
    const resolved = resolveVariantMarker(options.expected.context, shot.variant);
    return { variant: typeof resolved === "string" ? resolved : shot.variant, png: shot.png };
  });
  return scoreS3(references, resolvedShots, options.readPng, domMarkers, parsedMarkers);
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
