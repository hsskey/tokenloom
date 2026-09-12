// Ensures .claude/rules/** points to authoritative thresholds, baselines, and budgets instead of
// copying numbers. Code fences receive no exemption; only a reasoned trailing literal-ok marker does.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Numeric literals with units or adjacent `$`, supporting both currency orders. */
const LITERAL = /[0-9][0-9,.]*\s*(?:MB|ms|회)|\$\s*[0-9][0-9,.]*|[0-9][0-9,.]*\s*\$/g;
/** A marker with an empty reason is invalid. */
const MARKER = /<!-- literal-ok: (\S.*?) -->/;

export function findNumericLiterals(text: string): Array<{ line: number; match: string }> {
  return text.split("\n").flatMap((line, i) =>
    MARKER.test(line) ? [] : [...line.matchAll(LITERAL)].map((m) => ({ line: i + 1, match: m[0] })),
  );
}

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found");
    dir = parent;
  }
  return dir;
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return markdownFiles(full);
    return e.name.endsWith(".md") ? [full] : [];
  });
}

describe("findNumericLiterals", () => {
  it.each([
    ["200MB", "200MB"],
    ["힙 200 MB 이내", "200 MB"],
    ["parse 500ms", "500ms"],
    ["각 200회", "200회"],
    ["세트당 $12", "$12"],
    ["세트당 12$", "12$"],
    ["```\n힙 200MB 이내\n```", "200MB"],
    ["힙 200MB 이내 <!-- literal-ok:  -->", "200MB"],
  ])("detects a copied numeric literal in %s", (text, expected) => {
    expect(findNumericLiterals(text).map((h) => h.match)).toEqual([expected]);
  });

  it("allows a same-line literal-ok marker with a reason", () => {
    expect(findNumericLiterals("힙 200MB 이내 <!-- literal-ok: 예시값 -->")).toEqual([]);
  });

  it.each(["v2", "2026-09-04", "18_800", "depth=2"])("allows unitless value %s", (text) => {
    expect(findNumericLiterals(text)).toEqual([]);
  });

  it("returns line numbers with matched text across multiple lines", () => {
    expect(findNumericLiterals("첫 줄\n힙 200MB 이내\n\nparse 500ms")).toEqual([
      { line: 2, match: "200MB" },
      { line: 4, match: "500ms" },
    ]);
  });
});

describe(".claude/rules tree", () => {
  it("contains no copied numeric values in rule files", () => {
    const root = repoRoot();
    const hits = markdownFiles(join(root, ".claude", "rules")).flatMap((file) =>
      findNumericLiterals(readFileSync(file, "utf8")).map(
        (h) => `${relative(root, file).split(sep).join("/")}:${h.line}: ${h.match}`,
      ),
    );
    expect(hits, `Point to the authoritative source or add a reasoned literal-ok marker:\n${hits.join("\n")}`).toEqual([]);
  });
});
