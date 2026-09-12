import { describe, expect, it } from "vitest";
import { countLiterals, extractBlocks, scoreS1, scoreS2 } from "../src/score";

/** tokens.css double containing the only names S1 considers available. */
const TOKENS_CSS = `:root {
  --color-button-primary-bg: #1a73e8;
  --color-button-primary-fg: #ffffff;
  --space-md: 16px;
  --radius-md: 8px;
}
`;

function modelOutput(css: string, html = '<div class="button"></div>'): string {
  return "```css\n" + css + "\n```\n\n```html\n" + html + "\n```\n";
}

const COMPLIANT = `.button {
  background: var(--color-button-primary-bg);
  color: var(--color-button-primary-fg);
  padding: var(--space-md);
  border-radius: var(--radius-md);
}`;

describe("adversarial scorer cases (SPEC 9.5)", () => {
  it("A01 counts a var() fallback as a literal", () => {
    const css = ".button { background: var(--color-button-primary-bg, #ff0000); }";
    expect(countLiterals(css)).toEqual({ refs: 1, literals: 1 });
    expect(scoreS2(modelOutput(css))).toBeCloseTo(0.5, 5);
  });

  it("A02 ignores hex colors inside comments", () => {
    const css = "/* was #ff0000 */\n.button { background: var(--color-button-primary-bg); }";
    expect(countLiterals(css)).toEqual({ refs: 1, literals: 0 });
    expect(scoreS2(modelOutput(css))).toBe(1);
  });

  it("A03 excludes 0px from literals", () => {
    const css = ".button { margin: 0px; padding: var(--space-md); }";
    expect(countLiterals(css)).toEqual({ refs: 1, literals: 0 });
    expect(scoreS2(modelOutput(css))).toBe(1);
  });

  it("A04 scores S1 zero when var(--x) is absent from tokens.css", () => {
    const css = ".button { background: var(--color-does-not-exist); }";
    expect(scoreS1(modelOutput(css), TOKENS_CSS)).toBe(0);
    expect(scoreS1(modelOutput(COMPLIANT), TOKENS_CSS)).toBe(1);
  });

  it("A05 counts uppercase #FFF as a literal", () => {
    const css = ".button { color: #FFF; background: var(--color-button-primary-bg); }";
    expect(countLiterals(css)).toEqual({ refs: 1, literals: 1 });
    expect(scoreS2(modelOutput(css))).toBeCloseTo(0.5, 5);
  });

  it("A06 counts rgb() once instead of counting its numbers separately", () => {
    const css = ".button { color: rgb(26, 115, 232); background: var(--color-button-primary-bg); }";
    expect(countLiterals(css)).toEqual({ refs: 1, literals: 1 });
  });

  it("A07 scores empty CSS as zero for S1 and S2", () => {
    expect(scoreS1(modelOutput(""), TOKENS_CSS)).toBe(0);
    expect(scoreS2(modelOutput(""))).toBe(0);
  });

  it("A08 scores HTML-only output as S1 zero", () => {
    const text = "```html\n<div></div>\n```\n";
    expect(extractBlocks(text).css).toBe(null);
    expect(scoreS1(text, TOKENS_CSS)).toBe(0);
  });

  it("A09 scores a third fenced block as an S1 format failure", () => {
    const text = modelOutput(COMPLIANT) + "\n```js\nconsole.log(1)\n```\n";
    expect(extractBlocks(text).extra).toBe(1);
    expect(scoreS1(text, TOKENS_CSS)).toBe(0);
  });

  it("A10 counts var(--a, var(--b)) as two references and no literals", () => {
    const css = ".button { color: var(--color-button-primary-fg, var(--color-button-primary-bg)); }";
    expect(countLiterals(css)).toEqual({ refs: 2, literals: 0 });
    expect(scoreS2(modelOutput(css))).toBe(1);
  });

  it("A11 counts 1px solid #000 as two literals", () => {
    const css = ".button { border: 1px solid #000; background: var(--color-button-primary-bg); }";
    expect(countLiterals(css)).toEqual({ refs: 1, literals: 2 });
    expect(scoreS2(modelOutput(css))).toBeCloseTo(1 / 3, 5);
  });

  it("A12 scores fully compliant output as S1 one and S2 one", () => {
    expect(scoreS1(modelOutput(COMPLIANT), TOKENS_CSS)).toBe(1);
    expect(scoreS2(modelOutput(COMPLIANT))).toBe(1);
  });

  it("A13 returns null S1 without tokens.css even for compliant output", () => {
    expect(scoreS1(modelOutput(COMPLIANT), null)).toBe(null);
  });

  it("A14 returns null before parsing malformed output when tokens.css is absent", () => {
    expect(scoreS1("```html\n<div></div>\n```\n", null)).toBe(null);
  });

  it("A15 treats empty tokens.css as a measured set with zero names", () => {
    expect(scoreS1(modelOutput(COMPLIANT), "")).toBe(0);
  });
});
