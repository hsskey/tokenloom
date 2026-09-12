// This test imports the benchmark encoder solely to prove the committed bench record is reproducible; no production module imports it.
import { describe, expect, it } from "vitest";
import { deltaPathsOf, reductionPct, run, toCanonicalPath, toShortPath } from "../../../bench/delta-path.bench";
import { fullContext } from "../../../bench/variant.bench";

describe("short delta path encoding", () => {
  it.each([
    ["/style/bg", "style/bg"],
    ["/layout/pad/0", "layout/pad/0"],
    ["/children/0/style/fg", "0>style/fg"],
    ["/children/0/children/12/layout/sizing/w", "0>12>layout/sizing/w"],
    ["/children/0", "0>"],
    ["", ""],
  ])("encodes %s as %s", (canonical, short) => {
    expect(toShortPath(canonical)).toBe(short);
  });

  it.each([
    ["a key holding a slash", "/style/a~1b", "style/a~1b"],
    ["a key holding a tilde", "/style/a~0b", "style/a~0b"],
    ["a key holding the descent character", "/style/a>b", "style/a~2b"],
    ["a field named children below a field path", "/style/children/0", "style/children/0"],
    ["a children segment whose successor is not an index", "/children/x/style/bg", "children/x/style/bg"],
  ])("keeps %s distinguishable", (_case, canonical, short) => {
    expect(toShortPath(canonical)).toBe(short);
  });

  it.each([
    "/style/bg",
    "/children/0/children/12/layout/sizing/w",
    "/style/a>b",
    "/style/a~1b",
    "/children/x/style/bg",
    "",
  ])("restores %s from its short form", (canonical) => {
    expect(toCanonicalPath(toShortPath(canonical))).toBe(canonical);
  });

  it("restores every delta path the Variant-heavy sample produces", () => {
    const canonical = deltaPathsOf(fullContext());
    expect(canonical.map((path) => toCanonicalPath(toShortPath(path)))).toEqual(canonical);
  });

  it("A11: reproduces the committed Agent JSON delta-path record", () => {
    expect(run()).toEqual({
      name: "context.deltaPath",
      basis: "artifact-derived",
      sample: "twenty-variants",
      paths: 22,
      artifactBytesCanonical: 7353,
      artifactBytesShort: 7331,
      artifactBytesReductionPct: 0.2991976064191486,
      artifactTokensCanonical: 2626,
      artifactTokensShort: 2618,
      artifactTokensReductionPct: 0.30464584920030463,
      pathBytesCanonical: 218,
      pathBytesShort: 196,
      pathBytesReductionPct: 10.091743119266056,
      pathTokensReductionPct: 10.256410256410255,
    });
  });
});

describe("reductionPct", () => {
  it("reports no reduction for an empty baseline instead of dividing by zero", () => {
    expect(reductionPct(0, 0)).toBe(0);
  });

  it("reports a negative percentage when the short form is larger", () => {
    expect(reductionPct(100, 110)).toBe(-10);
  });
});
