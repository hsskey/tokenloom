// A11 delta-path experiment: the canonical RFC 6901 artifact against the same artifact carrying
// experimental short paths. docs/reference/verification.md section 12.10 owns the adoption bar; this
// module only measures. The basis is artifact-derived UTF-8 bytes and estimateTokens rather than
// provider usage, because the two artifacts differ only in encoding and no model call is needed to
// compare their size.
// The encoding lives here rather than in packages/parser because the experiment did not reach the
// bar, so no production module may depend on it.
// Package sources are imported by path rather than by `@tokenloom/*` specifier for the reason
// bench/variant.bench.ts records: this module is consumed by a test outside the workspace packages.
import { estimateTokens, stableJsonFile, type DesignContextT } from "../packages/schema/src/index";
import { projectAgentContext } from "../packages/parser/src/index";
import { fullContext } from "./variant.bench";
import type { BenchRecord } from "./util";

/** The Variant-heavy sample the 10 percent bar is stated against; variant.bench.ts builds it. */
const SAMPLE = "twenty-variants";

/**
 * Separates the leading child-index descent from the field path, replacing the `children/<index>`
 * segment pair that RFC 6901 repeats at every depth. A field name containing this character escapes
 * to `~2`, extending the `~0` and `~1` alphabet rather than overloading either.
 */
const CHILD = ">";

/** The canonical spelling of an array position, so a decoded path reproduces the original bytes. */
const INDEX = /^(?:0|[1-9][0-9]*)$/;

function decodeCanonical(token: string): string {
  return token.replace(/~[01]/g, (escaped) => (escaped === "~1" ? "/" : "~"));
}

function encodeCanonical(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function decodeShort(token: string): string {
  return token.replace(/~[012]/g, (escaped) => (escaped === "~1" ? "/" : escaped === "~2" ? CHILD : "~"));
}

export function toShortPath(path: string): string {
  const tokens = path.split("/").slice(1).map(decodeCanonical);
  const indices: string[] = [];
  let cursor = 0;
  while (tokens[cursor] === "children" && INDEX.test(tokens[cursor + 1] ?? "")) {
    indices.push(tokens[cursor + 1] as string);
    cursor += 2;
  }
  const fields = tokens.slice(cursor).map((token) => encodeCanonical(token).replaceAll(CHILD, "~2")).join("/");
  return indices.length === 0 ? fields : indices.join(CHILD) + CHILD + fields;
}

/** Present so the measured short form is a lossless re-encoding rather than a discarded path. */
export function toCanonicalPath(short: string): string {
  const tokens = short.split(CHILD);
  const fields = tokens.pop() ?? "";
  const descent = tokens.map((index) => `/children/${index}`).join("");
  if (fields === "") return descent;
  return descent + "/" + fields.split("/").map((token) => encodeCanonical(decodeShort(token))).join("/");
}

/** Rewrites only `DeltaT.path`, so the two artifacts differ in path encoding and nothing else. */
export function shortPathContext(full: DesignContextT): DesignContextT {
  const variants = full.component.variants.map((variant) =>
    variant.delta === undefined ? variant : { ...variant, delta: variant.delta.map((d) => ({ ...d, path: toShortPath(d.path) })) },
  );
  return { ...full, component: { ...full.component, variants } };
}

export function deltaPathsOf(context: DesignContextT): string[] {
  return context.component.variants.flatMap((variant) => (variant.delta ?? []).map((d) => d.path));
}

export function utf8Bytes(values: string[]): number {
  return values.reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0);
}

/** Positive when the short encoding is smaller; a zero baseline reports no reduction rather than dividing. */
export function reductionPct(before: number, after: number): number {
  return before === 0 ? 0 : ((before - after) / before) * 100;
}

export function run(): BenchRecord {
  const canonical = fullContext();
  const short = shortPathContext(canonical);
  const canonicalPaths = deltaPathsOf(canonical);
  // An empty population would report a perfect zero reduction, so a sample that lost its deltas fails instead.
  if (canonicalPaths.length === 0) throw new Error("delta-path bench: no delta path was measured");
  const artifact = {
    canonical: Buffer.byteLength(stableJsonFile(projectAgentContext(canonical)), "utf8"),
    short: Buffer.byteLength(stableJsonFile(projectAgentContext(short)), "utf8"),
  };
  const path = { canonical: utf8Bytes(canonicalPaths), short: utf8Bytes(deltaPathsOf(short)) };
  return {
    name: "context.deltaPath",
    basis: "artifact-derived",
    sample: SAMPLE,
    paths: canonicalPaths.length,
    artifactBytesCanonical: artifact.canonical,
    artifactBytesShort: artifact.short,
    artifactBytesReductionPct: reductionPct(artifact.canonical, artifact.short),
    artifactTokensCanonical: estimateTokens(artifact.canonical),
    artifactTokensShort: estimateTokens(artifact.short),
    artifactTokensReductionPct: reductionPct(estimateTokens(artifact.canonical), estimateTokens(artifact.short)),
    pathBytesCanonical: path.canonical,
    pathBytesShort: path.short,
    pathBytesReductionPct: reductionPct(path.canonical, path.short),
    pathTokensReductionPct: reductionPct(estimateTokens(path.canonical), estimateTokens(path.short)),
  };
}
