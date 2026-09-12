import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot, isAsciiTokenPath, type SnapshotT } from "@tokenloom/schema";
import { buildTokens, buildDtcg, emitCss, cssVarName, flatten } from "../src/index";

const repoRoot = resolve(import.meta.dirname, "../../..");
const button = (): SnapshotT =>
  Snapshot.parse(JSON.parse(readFileSync(resolve(repoRoot, "samples/button/snapshot.json"), "utf8")));

function minimal(over: Partial<SnapshotT>): SnapshotT {
  return Snapshot.parse({
    version: 1,
    source: { kind: "sample", plan: "unknown", fileKey: "F", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: [], variables: [], textStyles: [], componentSets: [], annotations: [],
    ...over,
  });
}

const oneMode = { id: "c1", name: "P", modes: [{ id: "m0", name: "Value" }], defaultModeId: "m0" };
const twoModes = { id: "c2", name: "S", modes: [{ id: "ml", name: "Light" }, { id: "md", name: "Dark" }], defaultModeId: "ml" };

describe("token extraction rules (docs/reference/spec.md section 4.6)", () => {
  it("T01: writes a single-mode collection to tokens/base.json", () => {
    const out = buildTokens(minimal({
      collections: [oneMode],
      variables: [{ id: "v1", name: "space/sm", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 8 } }],
    }), ["css"]);
    expect(Object.keys(out.files)).toContain("tokens/base.json");
    expect(JSON.parse(out.files["tokens/base.json"] ?? "{}")).toEqual({
      space: { sm: { $type: "dimension", $value: "8px" } },
    });
  });

  it("T02: writes each mode of a multi-mode collection to tokens/mode.<slug>.json", () => {
    const out = buildTokens(minimal({
      collections: [twoModes],
      variables: [{ id: "v1", name: "color/bg", collectionId: "c2", type: "COLOR", valuesByMode: { ml: { r: 1, g: 1, b: 1, a: 1 }, md: { r: 0, g: 0, b: 0, a: 1 } } }],
    }), ["css"]);
    expect(Object.keys(out.files).sort()).toEqual(["css/tokens.css", "tokens/base.json", "tokens/mode.dark.json", "tokens/mode.light.json"]);
    expect(out.files["tokens/mode.dark.json"]).toContain('"$value": "#000000"');
  });

  it("T03: converts an alias into a \"{path}\" reference string", () => {
    const dtcg = buildDtcg(button());
    const light = dtcg.files.get("mode.light.json");
    expect(flatten(light ?? {}).find(([p]) => p === "color.button.primary.bg")?.[1].$value).toBe("{color.brand.500}");
  });

  it("T04: reports alias cycles as ALIAS_CYCLE and fatal", () => {
    const out = buildTokens(minimal({
      collections: [twoModes],
      variables: [
        { id: "v8", name: "color/a", collectionId: "c2", type: "COLOR", valuesByMode: { ml: { alias: "v9" }, md: { r: 0, g: 0, b: 0, a: 1 } } },
        { id: "v9", name: "color/b", collectionId: "c2", type: "COLOR", valuesByMode: { ml: { alias: "v8" }, md: { r: 0, g: 0, b: 0, a: 1 } } },
      ],
    }), ["css"]);
    expect(out.fatal).toBe("ALIAS_CYCLE");
    expect(out.warnings.map((w) => w.code)).toEqual(["ALIAS_CYCLE", "ALIAS_CYCLE"]);
    expect(out.files).toEqual({});
  });

  it("T05: emits COLOR as $type color using R15 notation", () => {
    const dtcg = buildDtcg(button());
    const base = flatten(dtcg.files.get("base.json") ?? {});
    expect(base.find(([p]) => p === "color.brand.500")?.[1]).toEqual({ $type: "color", $value: "#1a73e8" });
    expect(base.find(([p]) => p === "color.neutral.100")?.[1].$value).toBe("#f1f3f4");
  });

  it("T06: emits FLOAT in space, radius, size, or border as dimension \"<n>px\"", () => {
    const out = buildTokens(minimal({
      collections: [oneMode],
      variables: [
        { id: "a", name: "space/md", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 16 } },
        { id: "b", name: "radius/md", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 8 } },
        { id: "c", name: "size/icon", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 24 } },
        { id: "d", name: "border/thin", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 1 } },
      ],
    }), ["css"]);
    const tree = JSON.parse(out.files["tokens/base.json"] ?? "{}") as Record<string, Record<string, { $type: string; $value: string }>>;
    expect(tree.space?.md).toEqual({ $type: "dimension", $value: "16px" });
    expect(tree.border?.thin).toEqual({ $type: "dimension", $value: "1px" });
    expect(tree.size?.icon?.$value).toBe("24px");
  });

  it("T07: emits other FLOAT values as $type number", () => {
    const out = buildTokens(minimal({
      collections: [oneMode],
      variables: [{ id: "a", name: "opacity/muted", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 0.5 } }],
    }), ["css"]);
    expect(JSON.parse(out.files["tokens/base.json"] ?? "{}")).toEqual({
      opacity: { muted: { $type: "number", $value: 0.5 } },
    });
  });

  it("T08: emits STRING as string and BOOLEAN as boolean", () => {
    const out = buildTokens(minimal({
      collections: [oneMode],
      variables: [
        { id: "a", name: "z/label", collectionId: "c1", type: "STRING", valuesByMode: { m0: "hi" } },
        { id: "b", name: "z/on", collectionId: "c1", type: "BOOLEAN", valuesByMode: { m0: true } },
      ],
    }), ["css"]);
    expect(JSON.parse(out.files["tokens/base.json"] ?? "{}")).toEqual({
      z: { label: { $type: "string", $value: "hi" }, on: { $type: "boolean", $value: true } },
    });
  });

  it("T09: emits text-style leaves under typo.<name>", () => {
    const out = buildTokens(button(), ["css"]);
    const tree = JSON.parse(out.files["tokens/base.json"] ?? "{}") as { typo: { label: { md: Record<string, unknown> } } };
    expect(tree.typo.label.md).toEqual({
      fontFamily: { $type: "fontFamily", $value: "Inter" },
      fontSize: { $type: "dimension", $value: "14px" },
      fontWeight: { $type: "number", $value: 600 },
      lineHeight: { $type: "dimension", $value: "20px" },
    });
    expect(Object.keys(tree.typo.label.md)).not.toContain("letterSpacing");
  });

  it("T09: emits letterSpacing only when present", () => {
    const out = buildTokens(minimal({
      textStyles: [{ id: "t1", name: "body/sm", fontFamily: "Inter", fontSize: 12, fontWeight: 400, lineHeight: 16, letterSpacing: 0.5 }],
    }), ["css"]);
    expect(out.files["tokens/base.json"]).toContain('"letterSpacing"');
    expect(out.files["tokens/base.json"]).toContain('"0.5px"');
  });

  it("T10: sorts file keys lexicographically by path", () => {
    const out = buildTokens(button(), ["css"]);
    const text = out.files["tokens/base.json"] ?? "";
    expect(text.indexOf('"color"')).toBeLessThan(text.indexOf('"radius"'));
    expect(text.indexOf('"radius"')).toBeLessThan(text.indexOf('"space"'));
    expect(text.indexOf('"space"')).toBeLessThan(text.indexOf('"typo"'));
    expect(text.indexOf('"0"')).toBeLessThan(text.indexOf('"100"'));
  });
});

describe("platform output rules (docs/reference/spec.md section 4.7)", () => {
  it("O01: puts base and default modes in :root and other modes in data-theme blocks", () => {
    const css = emitCss(buildDtcg(button()));
    expect(css.startsWith(":root {\n")).toBe(true);
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).not.toContain('[data-theme="light"]');
    expect(css.indexOf("--color-brand-500")).toBeLessThan(css.indexOf("--color-button-primary-bg"));
    expect(css.endsWith("}\n")).toBe(true);
    expect(css).not.toContain("/*");
  });

  it("O01: sorts mode blocks lexicographically by mode name", () => {
    const css = emitCss(buildDtcg(minimal({
      collections: [{ id: "c", name: "S", modes: [{ id: "a", name: "A" }, { id: "z", name: "Z" }, { id: "m", name: "M" }], defaultModeId: "a" }],
      variables: [{ id: "v", name: "color/x", collectionId: "c", type: "COLOR", valuesByMode: { a: { r: 0, g: 0, b: 0, a: 1 }, m: { r: 1, g: 0, b: 0, a: 1 }, z: { r: 0, g: 1, b: 0, a: 1 } } }],
    })));
    expect(css.indexOf('[data-theme="m"]')).toBeLessThan(css.indexOf('[data-theme="z"]'));
    expect(css.split("\n\n")).toHaveLength(3);
  });

  it("O02: preserves aliases as var(--...) and emits literals as lowercase hex", () => {
    const css = emitCss(buildDtcg(button()));
    expect(css).toContain("--color-button-primary-bg: var(--color-brand-500);");
    expect(css).toContain("--color-button-primary-bg: #8ab4f8;");
    expect(css).not.toMatch(/#[0-9a-fA-F]*[A-F]/);
  });

  it("O02: converts camelCase typography paths to kebab case", () => {
    expect(cssVarName("typo.label.md.fontSize")).toBe("--typo-label-md-font-size");
    expect(cssVarName("space.md")).toBe("--space-md");
    expect(cssVarName("color.button.primary.bg")).toBe("--color-button-primary-bg");
  });

  it("O06: key-order changes in the same Snapshot do not change output bytes", () => {
    const first = buildTokens(button(), ["css"]);
    const shuffled = button();
    shuffled.variables.reverse();
    shuffled.textStyles.reverse();
    const second = buildTokens(shuffled, ["css"]);
    expect(second.files).toEqual(first.files);
  });
});

describe("name rules (docs/reference/spec.md section 4.5)", () => {
  it("N01: replaces slashes in variable names and prefixes text styles with typo", () => {
    const out = buildTokens(button(), ["css"]);
    expect(out.files["tokens/mode.light.json"]).toContain('"button"');
    expect(out.files["tokens/base.json"]).toContain('"typo"');
    expect(emitCss(buildDtcg(button()))).toContain("--typo-label-md-font-family: Inter;");
  });

  it("N02: category membership selects dimension rule T06 or number rule T07", () => {
    const out = buildTokens(minimal({
      collections: [oneMode],
      variables: [
        { id: "a", name: "space/x", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 4 } },
        { id: "b", name: "z/x", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 4 } },
      ],
    }), ["css"]);
    const tree = JSON.parse(out.files["tokens/base.json"] ?? "{}") as Record<string, Record<string, { $type: string }>>;
    expect(tree.space?.x?.$type).toBe("dimension");
    expect(tree.z?.x?.$type).toBe("number");
  });

  it("N03: excludes non-ASCII token names and reports NON_ASCII_TOKEN_NAME", () => {
    const out = buildTokens(minimal({
      collections: [oneMode],
      variables: [
        { id: "v5", name: "space/작게", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 8 } },
        { id: "v6", name: "space/md", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 16 } },
      ],
    }), ["css"]);
    expect(out.warnings).toEqual([{ code: "NON_ASCII_TOKEN_NAME", nodeId: "v5", detail: "space.작게" }]);
    expect(JSON.parse(out.files["tokens/base.json"] ?? "{}")).toEqual({ space: { md: { $type: "dimension", $value: "16px" } } });
  });

  it("N02: accepts single segments and hyphenated categories but rejects malformed hyphens", () => {
    expect(["scale", "scale-01", "title-page.font-family"].map(isAsciiTokenPath)).toEqual([true, true, true]);
    expect(["scale-", "a--b", "-x"].map(isAsciiTokenPath)).toEqual([false, false, false]);
  });

  it("N06: excludes both paths that share a platform name and reports the relative path", () => {
    const out = buildTokens(minimal({
      collections: [oneMode],
      variables: [
        { id: "v1", name: "title-page/font-family", collectionId: "c1", type: "STRING", valuesByMode: { m0: "Inter" } },
        { id: "v2", name: "title/page/font/family", collectionId: "c1", type: "STRING", valuesByMode: { m0: "Inter" } },
        { id: "v3", name: "space/md", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 16 } },
      ],
    }), ["css"]);
    expect(out.warnings).toEqual([
      { code: "NAME_COLLISION", nodeId: "v1", detail: "title.page.font.family" },
      { code: "NAME_COLLISION", nodeId: "v2", detail: "title-page.font-family" },
    ]);
    expect(JSON.parse(out.files["tokens/base.json"] ?? "{}")).toEqual({ space: { md: { $type: "dimension", $value: "16px" } } });
  });
});

describe("platform output rules (docs/reference/spec.md section 4.7)", () => {
  const rootTokens = (): SnapshotT => minimal({
    collections: [oneMode],
    variables: [
      { id: "v1", name: "scale-01", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 4 } },
      { id: "v2", name: "space/md", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 16 } },
    ],
  });

  it("O08: puts single-segment paths in RootToken and emits RootToken first", () => {
    const out = buildTokens(rootTokens(), ["swift", "kotlin"]);
    expect(out.files["swift/Tokens.swift"]).toBe(`import UIKit

enum RootToken {
    static let scale01: CGFloat = 4
}

enum SpaceToken {
    static let md: CGFloat = 16
}
`);
    expect(out.files["kotlin/Tokens.kt"]).toBe(`import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

object RootToken {
    val scale01: Float = 4f
}

object SpaceToken {
    val md: Dp = 16.dp
}
`);
  });

  it("O08: emits --<segment> for the CSS variable of a single-segment path", () => {
    expect(emitCss(buildDtcg(rootTokens()))).toBe(":root {\n  --scale-01: 4;\n  --space-md: 16px;\n}\n");
  });

  it("O08: excludes a literal root category through an N06 collision", () => {
    const out = buildTokens(minimal({
      collections: [oneMode],
      variables: [
        { id: "v1", name: "scale", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 4 } },
        { id: "v2", name: "root/gap", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 8 } },
      ],
    }), ["swift"]);
    expect(out.warnings).toEqual([{ code: "NAME_COLLISION", nodeId: "v2", detail: "RootToken" }]);
    expect((out.files["swift/Tokens.swift"] ?? "").match(/^enum RootToken \{$/gm)).toEqual(["enum RootToken {"]);
  });
});

const fourModes = {
  id: "c2", name: "S", defaultModeId: "ma",
  modes: [{ id: "ma", name: "Brand" }, { id: "mb", name: "Light" }, { id: "mc", name: "Dark" }, { id: "mdd", name: "Contrast" }],
};
const sdsModes = {
  id: "c2", name: "Color", defaultModeId: "ml",
  modes: [{ id: "ml", name: "SDS Light" }, { id: "md", name: "SDS Dark" }],
};
const white = { r: 1, g: 1, b: 1, a: 1 };
const black = { r: 0, g: 0, b: 0, a: 1 };
const fourModes4 = (): SnapshotT =>
  Snapshot.parse(JSON.parse(readFileSync(resolve(repoRoot, "samples/four-modes/snapshot.json"), "utf8")));
const annotatedTheme = (): SnapshotT =>
  Snapshot.parse(JSON.parse(readFileSync(resolve(repoRoot, "samples/real-annotated-theme/snapshot.json"), "utf8")));

describe("platform output rules (docs/reference/spec.md sections 4.7 O03 through O07 and 4.7.1)", () => {
  it("O03: Swift emits one enum per category and branches only color tokens by trait", () => {
    const swift = buildTokens(button(), ["swift"]).files["swift/Tokens.swift"] ?? "";
    expect(swift.startsWith("import UIKit\n\nprivate extension UIColor {")).toBe(true);
    expect(swift).toContain("enum ColorToken {\n    static let brand500: UIColor = UIColor(hex: 0xff1a73e8)\n");
    expect(swift).toContain(
      "    static let buttonPrimaryBg: UIColor = UIColor { trait in\n"
      + "        trait.userInterfaceStyle == .dark ? UIColor(hex: 0xff8ab4f8) : ColorToken.brand500\n    }\n",
    );
    expect(swift).toContain("enum SpaceToken {\n    static let md: CGFloat = 16\n    static let sm: CGFloat = 8\n}");
    expect(swift).toContain("    static let labelMdFontFamily: String = \"Inter\"");
    expect(swift.endsWith("}\n")).toBe(true);
  });

  it("O04: Kotlin emits one object per category and uses @Composable getters only for branching colors", () => {
    const kt = buildTokens(button(), ["kotlin"]).files["kotlin/Tokens.kt"] ?? "";
    expect(kt).toContain("object ColorToken {\n    val brand500: Color = Color(0xff1a73e8)\n");
    expect(kt).toContain(
      "    val buttonPrimaryBg: Color\n"
      + "        @Composable get() = if (isSystemInDarkTheme()) Color(0xff8ab4f8) else ColorToken.brand500\n",
    );
    expect(kt).toContain("object SpaceToken {\n    val md: Dp = 16.dp\n    val sm: Dp = 8.dp\n}");
    expect(kt).toContain("    val labelMdFontSize: TextUnit = 14.sp");
    expect(kt).toContain("    val labelMdFontWeight: Float = 600f");
  });

  it("O04: Kotlin emits only used imports in code-unit order without a package declaration", () => {
    const kt = buildTokens(button(), ["kotlin"]).files["kotlin/Tokens.kt"] ?? "";
    expect(kt.split("\n\n")[0]).toBe([
      "import androidx.compose.foundation.isSystemInDarkTheme",
      "import androidx.compose.runtime.Composable",
      "import androidx.compose.ui.graphics.Color",
      "import androidx.compose.ui.unit.Dp",
      "import androidx.compose.ui.unit.TextUnit",
      "import androidx.compose.ui.unit.dp",
      "import androidx.compose.ui.unit.sp",
    ].join("\n"));
    expect(kt).not.toContain("package ");
    const spaceOnly = buildTokens(minimal({
      collections: [oneMode],
      variables: [{ id: "v1", name: "space/sm", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 8 } }],
    }), ["kotlin"]).files["kotlin/Tokens.kt"] ?? "";
    expect(spaceOnly.split("\n\n")[0]).toBe("import androidx.compose.ui.unit.Dp\nimport androidx.compose.ui.unit.dp");
  });

  it("O05: CSS, Swift, and Kotlin names form equal-sized bijections with canonical paths", () => {
    const out = buildTokens(button(), ["css", "swift", "kotlin"]);
    const canonical = [...new Set(
      ["tokens/base.json", "tokens/mode.light.json", "tokens/mode.dark.json"]
        .flatMap((f) => flatten(JSON.parse(out.files[f] ?? "{}")).map(([p]) => p)),
    )].sort();
    const css = (out.files["css/tokens.css"] ?? "").match(/^\s*(--[a-z0-9-]+)\s*:/gm) ?? [];
    const swift = (out.files["swift/Tokens.swift"] ?? "").match(/^\s*static let [A-Za-z0-9_]+\s*:/gm) ?? [];
    const kotlin = (out.files["kotlin/Tokens.kt"] ?? "").match(/^\s*val [A-Za-z0-9_]+\s*:/gm) ?? [];
    expect(canonical).toHaveLength(15);
    expect([new Set(css).size, swift.length, kotlin.length]).toEqual([15, 15, 15]);
    expect(new Set(css.map((d) => d.trim().replace(/\s*:$/, "")))).toEqual(new Set(canonical.map(cssVarName)));
  });

  it("O07: branches when two mode slugs end in light and dark", () => {
    const snapshot = minimal({
      collections: [sdsModes],
      variables: [{ id: "v1", name: "color/bg", collectionId: "c2", type: "COLOR", valuesByMode: { ml: white, md: black } }],
    });
    const out = buildTokens(snapshot, ["swift", "kotlin"]);
    expect(out.warnings).toEqual([]);
    expect(out.files["swift/Tokens.swift"]).toContain(
      "trait.userInterfaceStyle == .dark ? UIColor(hex: 0xff000000) : UIColor(hex: 0xffffffff)",
    );
    expect(out.files["kotlin/Tokens.kt"]).toContain(
      "@Composable get() = if (isSystemInDarkTheme()) Color(0xff000000) else Color(0xffffffff)",
    );
  });

  it("O07: emits only default values and one MODE_COLLAPSED per token for three or more modes", () => {
    const out = buildTokens(fourModes4(), ["swift", "kotlin"]);
    const collapsed = out.warnings.filter((w) => w.code === "MODE_COLLAPSED");
    expect(collapsed).toHaveLength(6);
    // Detail joins discarded mode slugs in lexical order and excludes the default Brand mode.
    expect(collapsed[0]).toEqual({ code: "MODE_COLLAPSED", nodeId: "color.action.bg", detail: "contrast,dark,light" });
    expect(collapsed.map((w) => w.nodeId)).toEqual([
      "color.action.bg", "color.action.border", "color.action.fg",
      "color.surface.bg", "color.surface.fg", "color.surface.muted",
    ]);
    expect(out.files["swift/Tokens.swift"]).not.toContain("trait in");
    expect(out.files["kotlin/Tokens.kt"]).not.toContain("@Composable");
  });

  it("O07: collapses non-color tokens in multi-mode collections with MODE_COLLAPSED", () => {
    const out = buildTokens(minimal({
      collections: [fourModes, { ...twoModes, id: "c3" }],
      variables: [
        { id: "v1", name: "space/sm", collectionId: "c3", type: "FLOAT", valuesByMode: { ml: 8, md: 16 } },
        { id: "v2", name: "color/bg", collectionId: "c3", type: "COLOR", valuesByMode: { ml: white, md: black } },
      ],
    }), ["swift"]);
    expect(out.warnings).toEqual([{ code: "MODE_COLLAPSED", nodeId: "space.sm", detail: "dark" }]);
    expect(out.files["swift/Tokens.swift"]).toContain("static let sm: CGFloat = 8");
  });

  it("O07: reports MODE_COLLAPSED only from native emitters and not from CSS-only builds", () => {
    const css = buildTokens(fourModes4(), ["css"]);
    expect(css.warnings.filter((w) => w.code === "MODE_COLLAPSED")).toEqual([]);
    expect(buildTokens(fourModes4(), ["swift"]).warnings.filter((w) => w.code === "MODE_COLLAPSED")).toHaveLength(6);
  });

  // These cases use the real samples/real-annotated-theme Snapshot rather than synthetic input.
  // It contains a Light/Dark theme collection and a single-mode space collection; see samples/real-annotated-theme/README.md.
  it("O07: real-annotated-theme branches four colors through Swift traits and Kotlin @Composable getters", () => {
    const out = buildTokens(annotatedTheme(), ["swift", "kotlin"]);
    const swift = out.files["swift/Tokens.swift"] ?? "";
    const kotlin = out.files["kotlin/Tokens.kt"] ?? "";
    expect(out.warnings.filter((w) => w.code === "MODE_COLLAPSED")).toEqual([]);
    expect(swift.match(/UIColor \{ trait in$/gm)).toHaveLength(4);
    expect(kotlin.match(/^ {8}@Composable get\(\) = if \(isSystemInDarkTheme\(\)\)/gm)).toHaveLength(4);
    expect(swift).toContain(
      "    static let buttonPrimaryBg: UIColor = UIColor { trait in\n"
      + "        trait.userInterfaceStyle == .dark ? UIColor(hex: 0xff60a5fa) : UIColor(hex: 0xff2563eb)\n    }\n",
    );
    expect(kotlin).toContain(
      "    val buttonPrimaryBg: Color\n"
      + "        @Composable get() = if (isSystemInDarkTheme()) Color(0xff60a5fa) else Color(0xff2563eb)\n",
    );
    expect(kotlin).toContain("object SpaceToken {\n    val md: Dp = 16.dp\n    val sm: Dp = 8.dp\n}");
  });

  it("O01: real-annotated-theme CSS emits four dark colors in one data-theme dark block", () => {
    const css = buildTokens(annotatedTheme(), ["css"]).files["css/tokens.css"] ?? "";
    const darkBlock = /\[data-theme="dark"\] \{\n([^}]*)\}\n/.exec(css);
    expect(css.match(/^\[data-theme="[a-z0-9-]+"\] \{$/gm)).toEqual(["[data-theme=\"dark\"] {"]);
    expect(darkBlock?.[1]).toBe([
      "  --color-button-primary-bg: #60a5fa;",
      "  --color-button-primary-fg: #0f172a;",
      "  --color-button-secondary-bg: #334155;",
      "  --color-button-secondary-fg: #f8fafc;",
      "",
    ].join("\n"));
  });

  it("O05: real-annotated-theme CSS, Swift, and Kotlin names are bijective with eleven canonical paths", () => {
    const out = buildTokens(annotatedTheme(), ["css", "swift", "kotlin"]);
    const canonical = [...new Set(
      ["tokens/base.json", "tokens/mode.light.json", "tokens/mode.dark.json"]
        .flatMap((f) => flatten(JSON.parse(out.files[f] ?? "{}")).map(([p]) => p)),
    )].sort();
    const members = (text: string, pattern: RegExp): string[] =>
      (text.match(pattern) ?? []).map((d) => d.trim().replace(/\s*:$/, "").replace(/^(static let|val) /, "")).sort();
    expect(canonical).toEqual([
      "color.button.primary.bg", "color.button.primary.fg",
      "color.button.secondary.bg", "color.button.secondary.fg",
      "space.md", "space.sm",
      "typo.label.md.fontFamily", "typo.label.md.fontSize", "typo.label.md.fontWeight",
      "typo.label.md.letterSpacing", "typo.label.md.lineHeight",
    ]);
    expect(members(out.files["swift/Tokens.swift"] ?? "", /^\s*static let [A-Za-z0-9_]+\s*:/gm)).toEqual(
      members(out.files["kotlin/Tokens.kt"] ?? "", /^\s*val [A-Za-z0-9_]+\s*:/gm),
    );
    expect(new Set(members(out.files["css/tokens.css"] ?? "", /^\s*--[a-z0-9-]+\s*:/gm)))
      .toEqual(new Set(canonical.map(cssVarName)));
  });
});

describe("identifier derivation (docs/reference/spec.md section 4.7.1 item 9)", () => {
  it("O05: wraps reserved member names in backticks in both outputs while preserving canonical paths", () => {
    // `default` is reserved by Swift and `object` by Kotlin; both outputs quote either word.
    const out = buildTokens(minimal({
      collections: [oneMode],
      variables: [
        { id: "v1", name: "space/default", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 8 } },
        { id: "v2", name: "size/object", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 4 } },
      ],
    }), ["swift", "kotlin"]);
    expect(out.files["swift/Tokens.swift"]).toContain("static let `default`: CGFloat = 8");
    expect(out.files["swift/Tokens.swift"]).toContain("static let `object`: CGFloat = 4");
    expect(out.files["kotlin/Tokens.kt"]).toContain("val `default`: Dp = 8.dp");
    expect(out.files["kotlin/Tokens.kt"]).toContain("val `object`: Dp = 4.dp");
    expect(JSON.parse(out.files["tokens/base.json"] ?? "{}")).toEqual({
      size: { object: { $type: "dimension", $value: "4px" } },
      space: { default: { $type: "dimension", $value: "8px" } },
    });
  });

  it("O05: prefixes numeric member names with _ and joins segments as camelCase", () => {
    const out = buildTokens(minimal({
      collections: [oneMode],
      variables: [
        { id: "v1", name: "color/500/brand", collectionId: "c1", type: "COLOR", valuesByMode: { m0: black } },
        { id: "v2", name: "space/x-large", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 32 } },
      ],
    }), ["swift", "kotlin"]);
    expect(out.files["swift/Tokens.swift"]).toContain("static let _500Brand: UIColor");
    expect(out.files["swift/Tokens.swift"]).toContain("static let xLarge: CGFloat = 32");
    expect(out.files["kotlin/Tokens.kt"]).toContain("val _500Brand: Color");
    expect(out.files["kotlin/Tokens.kt"]).toContain("val xLarge: Dp = 32.dp");
  });

  it("O02: preserves aliases as qualified static member references instead of resolving values", () => {
    const out = buildTokens(minimal({
      collections: [oneMode],
      variables: [
        { id: "v1", name: "space/md", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 16 } },
        { id: "v2", name: "radius/md", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: { alias: "v1" } } },
      ],
    }), ["swift", "kotlin"]);
    expect(out.files["swift/Tokens.swift"]).toContain("enum RadiusToken {\n    static let md: CGFloat = SpaceToken.md\n}");
    // The alias leaf keeps its DTCG number type, so Kotlin uses Float rather than Dp.
    expect(out.files["kotlin/Tokens.kt"]).toContain("object RadiusToken {\n    val md: Float = SpaceToken.md\n}");
  });

  it("O03: Swift omits the UIColor helper when no color tokens exist", () => {
    const swift = buildTokens(minimal({
      collections: [oneMode],
      variables: [{ id: "v1", name: "space/sm", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 8 } }],
    }), ["swift"]).files["swift/Tokens.swift"] ?? "";
    expect(swift).toBe("import UIKit\n\nenum SpaceToken {\n    static let sm: CGFloat = 8\n}\n");
  });
});

describe("emitter ordering and O07 boundaries (docs/reference/spec.md sections 4.7.1 item 1 and 4.7 O07)", () => {
  it("O03: sorts members by canonical path across multiple root files", () => {
    // base.json and mode.light.json both feed :root, so insertion order differs from path order.
    // color.button.* arrives later but must sort after brand500 and before neutral0.
    const swift = buildTokens(button(), ["swift"]).files["swift/Tokens.swift"] ?? "";
    const names = [...swift.matchAll(/^ {4}static let ([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
    expect(names.slice(0, 8)).toEqual([
      "brand500", "buttonPrimaryBg", "buttonPrimaryFg", "buttonSecondaryBg", "buttonSecondaryFg",
      "neutral0", "neutral100", "neutral900",
    ]);
    // Paths are sorted within each type; type blocks themselves use category order.
    expect(names.slice(8)).toEqual(["md", "md", "sm", "labelMdFontFamily", "labelMdFontSize", "labelMdFontWeight", "labelMdLineHeight"]);
  });

  it("O07: does not branch three modes even when two slugs end in light and dark", () => {
    const threeModes = {
      id: "c2", name: "S", defaultModeId: "ml",
      // The final segments sort as dark, light, light; the exact-count condition prevents branching.
      modes: [{ id: "ml", name: "Light" }, { id: "md", name: "Dark" }, { id: "m2", name: "Extra Light" }],
    };
    const out = buildTokens(minimal({
      collections: [threeModes],
      variables: [{ id: "v1", name: "color/bg", collectionId: "c2", type: "COLOR", valuesByMode: { ml: white, md: black, m2: white } }],
    }), ["swift", "kotlin"]);
    expect(out.warnings).toEqual([{ code: "MODE_COLLAPSED", nodeId: "color.bg", detail: "dark,extra-light" }]);
    expect(out.files["swift/Tokens.swift"]).not.toContain("trait in");
    expect(out.files["kotlin/Tokens.kt"]).not.toContain("@Composable");
  });

  it("O07: does not branch two modes unless their final segments are light and dark", () => {
    const brands = {
      id: "c2", name: "S", defaultModeId: "ma",
      modes: [{ id: "ma", name: "Brand A" }, { id: "mb", name: "Brand B" }],
    };
    const out = buildTokens(minimal({
      collections: [brands],
      variables: [{ id: "v1", name: "color/bg", collectionId: "c2", type: "COLOR", valuesByMode: { ma: white, mb: black } }],
    }), ["swift"]);
    expect(out.warnings).toEqual([{ code: "MODE_COLLAPSED", nodeId: "color.bg", detail: "brand-b" }]);
    expect(out.files["swift/Tokens.swift"]).toContain("static let bg: UIColor = UIColor(hex: 0xffffffff)");
  });
});
