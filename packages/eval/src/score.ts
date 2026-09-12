// SPEC 9.5 scoring: S1 parsing and S2 token compliance. visual.ts owns S3; S4 is recorded, not scored.
import postcss from "postcss";

export interface Blocks {
  css: string | null;
  html: string | null;
  /** Fences beyond the two blocks required by the prompt (SPEC 9.4). */
  extra: number;
}

const FENCE = /```(\w*)\n([\s\S]*?)```/g;

export function extractBlocks(text: string): Blocks {
  const found: { lang: string; body: string }[] = [];
  for (const match of text.matchAll(FENCE)) {
    found.push({ lang: (match[1] ?? "").toLowerCase(), body: match[2] ?? "" });
  }
  const css = found.find((b) => b.lang === "css")?.body ?? null;
  const html = found.find((b) => b.lang === "html")?.body ?? null;
  return { css, html, extra: Math.max(0, found.length - 2) };
}

/** Counts only content outside comments (SPEC 9.5). */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

export function tokenNamesOf(tokensCss: string): Set<string> {
  const names = new Set<string>();
  for (const match of tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)) names.add(match[1] as string);
  return names;
}

export function referencedVars(css: string): string[] {
  return [...stripComments(css).matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1] as string);
}

/** S1 is 1 when CSS parses and every var(--x) exists in tokens.css, or null without that file. */
export function scoreS1(text: string, tokensCss: string | null): number | null {
  // Without tokens.css, a zero would describe the missing reference rather than the output.
  if (tokensCss === null) return null;
  const blocks = extractBlocks(text);
  if (blocks.css === null || blocks.html === null) return 0;
  if (blocks.extra > 0) return 0;
  if (blocks.css.trim() === "") return 0;
  try {
    postcss.parse(blocks.css);
  } catch {
    return 0;
  }
  const known = tokenNamesOf(tokensCss);
  const used = referencedVars(blocks.css);
  if (used.length === 0) return 0;
  return used.every((name) => known.has(name)) ? 1 : 0;
}

export interface LiteralCount {
  refs: number;
  literals: number;
}

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const FUNCS = /\b(?:rgba?|hsla?)\(/g;
const LENGTH = /(\d*\.?\d+)px\b/g;

/** Counts literals in the S2 denominator, excluding `0px` and comment content (SPEC 9.5). */
export function countLiterals(css: string): LiteralCount {
  const body = stripComments(css);
  const refs = [...body.matchAll(/var\(\s*--/g)].length;
  let literals = [...body.matchAll(HEX)].length + [...body.matchAll(FUNCS)].length;
  for (const match of body.matchAll(LENGTH)) {
    if (Number.parseFloat(match[1] ?? "0") !== 0) literals += 1;
  }
  return { refs, literals };
}

/** S2 is refs / (refs + literals), or zero when there is nothing to count. */
export function scoreS2(text: string): number {
  const blocks = extractBlocks(text);
  if (blocks.css === null) return 0;
  const { refs, literals } = countLiterals(blocks.css);
  const total = refs + literals;
  return total === 0 ? 0 : refs / total;
}
