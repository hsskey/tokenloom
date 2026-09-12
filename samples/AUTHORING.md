# Regression sample authoring

This document contains the script that generated `snapshot.json` for the synthetic sample designs under `samples/`.
The snapshot data is locked for provenance; the built CLI, rather than this script, produces reference output.

Running the script does not reproduce the locked bytes.
The committed snapshots still record the pre-migration provenance values `kind: "fixture"`, `fileKey: "FIXTURE"`, `fileVersion: "fixture-1"`, and annotation `source: "fixture"`, which `packages/schema/src/snapshot.ts` decodes to their current `sample` names when it parses them.
Those four fields are the only difference; the node trees, variables, and styles are byte-identical.
Rewriting them in the committed data would change every downstream reference output, so it is a deliberate producer change rather than cleanup.

Each sample keeps its tree small, because design-context bytes grow with node count, and changes only a few token references between variants so the deltas stay representative.
Icons are component instances and every sample includes a hidden layer, so instance expansion and visibility handling run through structures that real files also produce.

## What each sample exercises

The script below emits these seven directories.

| Sample | Component set | Exercises |
|---|---|---|
| `icon-button` | `IconButton` | An icon instance next to a label |
| `absolute-card` | `AbsoluteCard` | No auto layout, several children, and the only visible stroke |
| `nested-instance` | `ListRow` | An instance whose children stay unexpanded in design context |
| `four-modes` | `Banner` | A collection with four modes |
| `korean-names` | `확인 버튼` | Korean layer names with ASCII token paths |
| `single-mode` | `Field` | One mode per collection, matching a free-plan real file |
| `twenty-variants` | `Chip` | Twenty size and state combinations that exercise delta compression |

Two further samples are real Figma exports rather than generated data, and each has its own README:
`real-design-system` and `real-annotated-theme`.

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd(); // Run from the repository root.

type Rgba = { r: number; g: number; b: number; a: number };
interface Node {
  id: string; name: string; type: string; visible: boolean;
  bbox: { x: number; y: number; w: number; h: number };
  layout?: Record<string, unknown>;
  fills?: { type: string; color?: Rgba }[];
  strokes?: { color: Rgba; weight: number }[];
  radius?: number;
  opacity?: number;
  text?: { characters: string; fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number };
  bound: Record<string, unknown>;
  mainComponentId?: string;
  children: Node[];
  extra?: Record<string, unknown>;
}

const rgb = (r: number, g: number, b: number): Rgba => ({ r, g, b, a: 1 });

/**
 * Fields present on Figma REST or plugin nodes but not modeled directly by Snapshot.
 * The `extra` contract preserves them for drift detection.
 * Without this data, the samples would never exercise compact-context removal of extra fields.
 * The payload size follows the node-density model rather than a desired compression ratio.
 */
const EXTRA = {
  blendMode: "PASS_THROUGH",
  clipsContent: false,
  strokeAlign: "INSIDE",
  strokeWeight: 1,
  constraints: { vertical: "TOP", horizontal: "LEFT" },
  effects: [],
  exportSettings: [],
  layoutAlign: "INHERIT",
  layoutGrow: 0,
  preserveRatio: false,
};

const PRIMITIVES = {
  id: "c1", name: "Primitives",
  modes: [{ id: "m0", name: "Value" }], defaultModeId: "m0",
};
const SEMANTIC_2 = {
  id: "c2", name: "Semantic",
  modes: [{ id: "ml", name: "Light" }, { id: "md", name: "Dark" }], defaultModeId: "ml",
};

const PRIM_VARS = [
  { id: "p1", name: "color/brand/500", type: "COLOR", value: rgb(0.102, 0.451, 0.91) },
  { id: "p2", name: "color/brand/700", type: "COLOR", value: rgb(0.062, 0.322, 0.667) },
  { id: "p3", name: "color/neutral/0", type: "COLOR", value: rgb(1, 1, 1) },
  { id: "p4", name: "color/neutral/100", type: "COLOR", value: rgb(0.945, 0.953, 0.957) },
  { id: "p5", name: "color/neutral/300", type: "COLOR", value: rgb(0.855, 0.867, 0.878) },
  { id: "p6", name: "color/neutral/600", type: "COLOR", value: rgb(0.376, 0.392, 0.404) },
  { id: "p7", name: "color/neutral/900", type: "COLOR", value: rgb(0.122, 0.122, 0.122) },
  { id: "p8", name: "color/danger/500", type: "COLOR", value: rgb(0.839, 0.204, 0.204) },
  { id: "p9", name: "space/xs", type: "FLOAT", value: 4 },
  { id: "p10", name: "space/sm", type: "FLOAT", value: 8 },
  { id: "p11", name: "space/md", type: "FLOAT", value: 16 },
  { id: "p12", name: "space/lg", type: "FLOAT", value: 24 },
  { id: "p13", name: "radius/sm", type: "FLOAT", value: 4 },
  { id: "p14", name: "radius/md", type: "FLOAT", value: 8 },
  { id: "p15", name: "size/icon", type: "FLOAT", value: 24 },
  { id: "p16", name: "border/thin", type: "FLOAT", value: 1 },
];

function primitives(): unknown[] {
  return PRIM_VARS.map((v) => ({
    id: v.id, name: v.name, collectionId: "c1", type: v.type, valuesByMode: { m0: v.value },
  }));
}

function semantic(names: string[], modes: string[], aliasFor: (name: string, mode: string) => string): unknown[] {
  return names.map((name, i) => ({
    id: `s${i + 1}`,
    name,
    collectionId: "c2",
    type: name.startsWith("color/") ? "COLOR" : "FLOAT",
    valuesByMode: Object.fromEntries(modes.map((m) => [m, { alias: aliasFor(name, m) }])),
  }));
}

const TEXT_STYLES = [
  { id: "t1", name: "label/md", fontFamily: "Inter", fontSize: 14, fontWeight: 600, lineHeight: 20 },
  { id: "t2", name: "label/sm", fontFamily: "Inter", fontSize: 12, fontWeight: 600, lineHeight: 16 },
  { id: "t3", name: "body/md", fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 20 },
  { id: "t4", name: "title/lg", fontFamily: "Inter", fontSize: 20, fontWeight: 700, lineHeight: 28 },
];

let counter = 0;
function nid(): string {
  counter += 1;
  return `${100 + Math.floor(counter / 100)}:${counter % 100}`;
}

interface Spec {
  name: string;
  type: string;
  visible?: boolean;
  layout?: Record<string, unknown>;
  fill?: { bound?: string; color?: Rgba; image?: boolean };
  stroke?: { bound?: string; weightBound?: string; color: Rgba; weight: number };
  radius?: { bound?: string; value: number };
  opacity?: number;
  text?: { characters: string; style?: string };
  size?: { w: number; h: number };
  instanceOf?: string;
  children?: Spec[];
}

function build(spec: Spec): Node {
  const size = spec.size ?? { w: 120, h: 40 };
  const node: Node = {
    id: nid(),
    name: spec.name,
    type: spec.type,
    visible: spec.visible ?? true,
    bbox: { x: 0, y: 0, w: size.w, h: size.h },
    bound: {},
    children: (spec.children ?? []).map(build),
    extra: EXTRA,
  };
  if (spec.layout !== undefined) node.layout = spec.layout;
  if (spec.fill?.image === true) node.fills = [{ type: "IMAGE" }];
  else if (spec.fill !== undefined) {
    node.fills = [{ type: "SOLID", color: spec.fill.color ?? rgb(0, 0, 0) }];
    if (spec.fill.bound !== undefined) node.bound.fill = spec.fill.bound;
  }
  if (spec.stroke !== undefined) {
    node.strokes = [{ color: spec.stroke.color, weight: spec.stroke.weight }];
    if (spec.stroke.bound !== undefined) node.bound.stroke = spec.stroke.bound;
    if (spec.stroke.weightBound !== undefined) node.bound.strokeWeight = spec.stroke.weightBound;
  }
  if (spec.radius !== undefined) {
    node.radius = spec.radius.value;
    if (spec.radius.bound !== undefined) node.bound.radius = spec.radius.bound;
  }
  if (spec.opacity !== undefined) node.opacity = spec.opacity;
  if (spec.text !== undefined) {
    const style = TEXT_STYLES.find((s) => s.id === (spec.text?.style ?? "t1")) ?? TEXT_STYLES[0]!;
    node.text = {
      characters: spec.text.characters, fontFamily: style.fontFamily, fontSize: style.fontSize,
      fontWeight: style.fontWeight, lineHeight: style.lineHeight,
    };
    if (spec.text.style !== undefined) node.bound.textStyle = spec.text.style;
  }
  if (spec.instanceOf !== undefined) node.mainComponentId = spec.instanceOf;
  if (node.layout !== undefined) {
    const l = node.layout as { gap?: number; padding?: number[] };
    if (l.gap !== undefined && l.gap > 0) node.bound.gap = gapVar(l.gap);
    // Bind padding only when every side is positive because JSON cannot represent undefined tuple entries.
    if (l.padding !== undefined && l.padding.every((p) => p > 0)) {
      node.bound.padding = l.padding.map((p) => gapVar(p));
    }
  }
  return node;
}

function gapVar(value: number): string {
  const hit = PRIM_VARS.find((v) => v.type === "FLOAT" && v.value === value && v.name.startsWith("space/"));
  return hit?.id ?? "p10";
}

interface FixtureSpec {
  dir: string;
  setName: string;
  props: Record<string, string[]>;
  collections: unknown[];
  variables: unknown[];
  tree: (props: Record<string, string>) => Spec;
  annotations?: { nodeId: string; text: string; source: string }[];
}

function cartesian(props: Record<string, string[]>): Record<string, string>[] {
  let out: Record<string, string>[] = [{}];
  for (const [key, values] of Object.entries(props)) {
    out = out.flatMap((base) => values.map((v) => ({ ...base, [key]: v })));
  }
  return out;
}

function emit(spec: FixtureSpec): void {
  counter = 0;
  const combos = cartesian(spec.props);
  const components = combos.map((props) => {
    const root = build(spec.tree(props));
    return { id: root.id, props, root };
  });
  const setId = "90:1";
  const snapshot = {
    version: 1,
    source: { kind: "sample", plan: "unknown", fileKey: "SAMPLE", fileVersion: "sample-1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: spec.collections,
    variables: spec.variables,
    textStyles: TEXT_STYLES,
    componentSets: [{ id: setId, name: spec.setName, props: spec.props, components }],
    annotations: spec.annotations ?? [],
  };
  const dir = join(ROOT, "samples", spec.dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");
  process.stdout.write(`${spec.dir}: ${components.length} variants\n`);
}

/**
 * Real files represent icons as component instances rather than one vector.
 * Compact context gains much of its reduction by leaving the instance subtree unexpanded.
 * A standalone vector would not exercise that path.
 */
function iconInstance(name: string, mainId: string, fillVar: string, size: number): Spec {
  return {
    name, type: "INSTANCE", instanceOf: mainId, size: { w: size, h: size },
    children: [
      {
        name: `${name} Canvas`, type: "FRAME", size: { w: size, h: size },
        layout: { mode: "NONE", sizingH: "FIXED", sizingV: "FIXED" },
        children: [
          { name: `${name} Path A`, type: "VECTOR", size: { w: size, h: size }, fill: { bound: fillVar, color: rgb(1, 1, 1) } },
          { name: `${name} Path B`, type: "VECTOR", size: { w: size - 4, h: size - 4 }, fill: { bound: fillVar, color: rgb(1, 1, 1) } },
        ],
      },
    ],
  };
}

/** Real files commonly contain hidden layers, which are removed with their subtrees. */
function hiddenFocusRing(): Spec {
  return {
    name: "Focus Ring", type: "FRAME", visible: false, size: { w: 120, h: 44 },
    layout: { mode: "NONE", sizingH: "FIXED", sizingV: "FIXED" },
    stroke: { bound: ACTION_BORDER, color: rgb(0.062, 0.322, 0.667), weight: 2 },
    radius: { bound: "p14", value: 8 },
    children: [
      { name: "Ring Outline", type: "RECTANGLE", size: { w: 120, h: 44 }, fill: { bound: ACTION_BORDER, color: rgb(0.062, 0.322, 0.667) } },
    ],
  };
}

const SEM_NAMES = [
  "color/action/bg", "color/action/fg", "color/action/border",
  "color/surface/bg", "color/surface/fg", "color/surface/muted",
];
const SEM_ALIAS: Record<string, string> = {
  "color/action/bg": "p1", "color/action/fg": "p3", "color/action/border": "p2",
  "color/surface/bg": "p3", "color/surface/fg": "p7", "color/surface/muted": "p6",
};
const SEM_ALIAS_DARK: Record<string, string> = {
  "color/action/bg": "p2", "color/action/fg": "p3", "color/action/border": "p1",
  "color/surface/bg": "p7", "color/surface/fg": "p3", "color/surface/muted": "p5",
};
const sem2 = semantic(SEM_NAMES, ["ml", "md"], (name, mode) =>
  (mode === "ml" ? SEM_ALIAS : SEM_ALIAS_DARK)[name] ?? "p1");

const ACTION_BG = "s1";
const ACTION_FG = "s2";
const ACTION_BORDER = "s3";
const SURFACE_BG = "s4";
const SURFACE_FG = "s5";
const SURFACE_MUTED = "s6";

/**
 * Border-width variable local to absolute-card, the only synthetic sample with a visible stroke.
 */
const BORDER_WIDTH_SM = {
  id: "p17", name: "border/width/sm", collectionId: "c1", type: "FLOAT", valuesByMode: { m0: 1 },
};

const PAD = [8, 16, 8, 16];
/** The size axis changes only the gap token. */
const GAP_OF: Record<string, number> = { xs: 4, sm: 4, md: 8, lg: 16, xl: 24 };
/** The state axis changes only the background token. */
const BG_OF: Record<string, string> = {
  default: ACTION_BG, hover: ACTION_BORDER, pressed: "p2", focus: "p1",
  selected: ACTION_BG, disabled: SURFACE_MUTED, active: SURFACE_MUTED, loading: SURFACE_MUTED,
};

emit({
  dir: "icon-button",
  setName: "IconButton",
  props: { size: ["sm", "md", "lg"], state: ["default", "hover", "disabled"] },
  collections: [PRIMITIVES, SEMANTIC_2],
  variables: [...primitives(), ...sem2],
  tree: (p) => ({
    name: "Icon Button", type: "COMPONENT",
    layout: { mode: "HORIZONTAL", gap: GAP_OF[p.size!]!, padding: PAD, primaryAlign: "CENTER", counterAlign: "CENTER", sizingH: "HUG", sizingV: "HUG" },
    fill: { bound: BG_OF[p.state!]!, color: rgb(0.102, 0.451, 0.91) },
    radius: { bound: "p14", value: 8 },
    children: [
      iconInstance("Icon", "80:1", ACTION_FG, 24),
      { name: "Label", type: "TEXT", size: { w: 60, h: 20 }, text: { characters: "Save", style: "t1" }, fill: { bound: ACTION_FG, color: rgb(1, 1, 1) } },
      iconInstance("Chevron", "80:2", ACTION_FG, 16),
      hiddenFocusRing(),
    ],
  }),
  annotations: [{ nodeId: "90:1", text: "[behavior] 아이콘만 있을 때도 접근 가능한 이름을 유지한다.", source: "sample" }],
});

emit({
  dir: "absolute-card",
  setName: "AbsoluteCard",
  props: { elevation: ["flat", "raised"], tone: ["neutral", "brand", "danger"] },
  collections: [PRIMITIVES, SEMANTIC_2],
  variables: [...primitives(), ...sem2, BORDER_WIDTH_SM],
  tree: (p) => ({
    name: "Absolute Card", type: "COMPONENT", size: { w: 320, h: 220 },
    layout: { mode: "NONE", sizingH: "FIXED", sizingV: "FIXED" },
    fill: { bound: SURFACE_BG, color: rgb(1, 1, 1) },
    radius: { bound: "p14", value: 8 },
    stroke: p.elevation === "raised" ? { bound: ACTION_BORDER, weightBound: BORDER_WIDTH_SM.id, color: rgb(0.062, 0.322, 0.667), weight: 1 } : undefined,
    children: [
      { name: "Media", type: "RECTANGLE", size: { w: 320, h: 120 }, fill: { image: true } },
      iconInstance("Badge Icon", "80:3", ACTION_BG, 20),
      hiddenFocusRing(),
      { name: "Title", type: "TEXT", size: { w: 200, h: 28 }, text: { characters: "Card title", style: "t4" }, fill: { bound: p.tone === "brand" ? ACTION_BG : p.tone === "danger" ? "p8" : SURFACE_FG, color: rgb(0.122, 0.122, 0.122) } },
      { name: "Description", type: "TEXT", size: { w: 288, h: 20 }, text: { characters: "Supporting text for the card.", style: "t3" }, fill: { bound: SURFACE_MUTED, color: rgb(0.376, 0.392, 0.404) } },
    ],
  }),
});

emit({
  dir: "nested-instance",
  setName: "ListRow",
  props: { size: ["sm", "md"], state: ["default", "active", "disabled", "loading"] },
  collections: [PRIMITIVES, SEMANTIC_2],
  variables: [...primitives(), ...sem2],
  tree: (p) => ({
    name: "List Row", type: "COMPONENT",
    layout: { mode: "HORIZONTAL", gap: GAP_OF[p.size!]!, padding: PAD, primaryAlign: "MIN", counterAlign: "CENTER", sizingH: "FILL", sizingV: "HUG" },
    fill: { bound: BG_OF[p.state!]!, color: rgb(1, 1, 1) },
    children: [
      {
        name: "Avatar", type: "INSTANCE", instanceOf: "80:1", size: { w: 32, h: 32 },
        children: [
          { name: "Ring", type: "ELLIPSE", size: { w: 32, h: 32 }, fill: { bound: ACTION_BG, color: rgb(0.102, 0.451, 0.91) } },
          { name: "Initials", type: "TEXT", size: { w: 20, h: 16 }, text: { characters: "AB", style: "t2" }, fill: { bound: ACTION_FG, color: rgb(1, 1, 1) } },
        ],
      },
      { name: "Name", type: "TEXT", size: { w: 160, h: 20 }, text: { characters: "Ada Lovelace", style: "t1" }, fill: { bound: SURFACE_FG, color: rgb(0.122, 0.122, 0.122) } },
      {
        name: "Action", type: "INSTANCE", instanceOf: "81:1", size: { w: 64, h: 24 },
        children: [
          { name: "Action Label", type: "TEXT", size: { w: 64, h: 20 }, text: { characters: "Follow", style: "t2" }, fill: { bound: ACTION_BG, color: rgb(0.102, 0.451, 0.91) } },
          { name: "Action Icon", type: "VECTOR", size: { w: 16, h: 16 }, fill: { bound: ACTION_BG, color: rgb(0.102, 0.451, 0.91) } },
        ],
      },
    ],
  }),
});

const SEMANTIC_4 = {
  id: "c2", name: "Semantic",
  modes: [{ id: "ma", name: "Brand" }, { id: "mb", name: "Light" }, { id: "mc", name: "Dark" }, { id: "mdd", name: "Contrast" }],
  defaultModeId: "ma",
};
const sem4 = semantic(SEM_NAMES, ["ma", "mb", "mc", "mdd"], (name, mode) => {
  const table: Record<string, Record<string, string>> = {
    ma: SEM_ALIAS, mb: SEM_ALIAS, mc: SEM_ALIAS_DARK,
    mdd: { ...SEM_ALIAS_DARK, "color/action/bg": "p8" },
  };
  return table[mode]?.[name] ?? "p1";
});
emit({
  dir: "four-modes",
  setName: "Banner",
  props: { tone: ["info", "success", "warning", "danger"], density: ["compact", "cozy"] },
  collections: [PRIMITIVES, SEMANTIC_4],
  variables: [...primitives(), ...sem4],
  tree: (p) => ({
    name: "Banner", type: "COMPONENT",
    layout: { mode: "HORIZONTAL", gap: p.density === "compact" ? 8 : 16, padding: PAD, primaryAlign: "MIN", counterAlign: "MIN", sizingH: "FILL", sizingV: "HUG" },
    fill: { bound: SURFACE_BG, color: rgb(1, 1, 1) },
    radius: { bound: "p13", value: 4 },
    children: [
      iconInstance("Status Icon", "80:4", p.tone === "danger" ? "p8" : p.tone === "warning" ? "p2" : ACTION_BG, 20),
      hiddenFocusRing(),
      { name: "Headline", type: "TEXT", size: { w: 200, h: 20 }, text: { characters: "Heads up", style: "t1" }, fill: { bound: SURFACE_FG, color: rgb(0.122, 0.122, 0.122) } },
      { name: "Detail", type: "TEXT", size: { w: 240, h: 20 }, text: { characters: "Something changed in your project.", style: "t3" }, fill: { bound: SURFACE_MUTED, color: rgb(0.376, 0.392, 0.404) } },
    ],
  }),
});

emit({
  dir: "korean-names",
  setName: "확인 버튼",
  props: { size: ["sm", "md", "lg", "xl"], state: ["default", "disabled"] },
  collections: [PRIMITIVES, SEMANTIC_2],
  variables: [...primitives(), ...sem2],
  tree: (p) => ({
    name: "확인 버튼", type: "COMPONENT",
    layout: { mode: "HORIZONTAL", gap: GAP_OF[p.size!]!, padding: PAD, primaryAlign: "CENTER", counterAlign: "CENTER", sizingH: "HUG", sizingV: "HUG" },
    fill: { bound: BG_OF[p.state!]!, color: rgb(0.102, 0.451, 0.91) },
    radius: { bound: "p14", value: 8 },
    children: [
      iconInstance("앞 아이콘", "80:5", ACTION_FG, 20),
      hiddenFocusRing(),
      { name: "라벨", type: "TEXT", size: { w: 80, h: 20 }, text: { characters: "확인", style: "t1" }, fill: { bound: ACTION_FG, color: rgb(1, 1, 1) } },
      { name: "보조 라벨", type: "TEXT", size: { w: 60, h: 16 }, text: { characters: "선택 사항", style: "t2" }, fill: { bound: SURFACE_MUTED, color: rgb(0.376, 0.392, 0.404) } },
    ],
  }),
  annotations: [{ nodeId: "90:1", text: "[a11y] 레이어 이름이 한글이어도 토큰 경로는 ASCII를 유지한다.", source: "sample" }],
});

const SEMANTIC_1 = { id: "c2", name: "Semantic", modes: [{ id: "m1", name: "Value" }], defaultModeId: "m1" };
const sem1 = semantic(SEM_NAMES, ["m1"], (name) => SEM_ALIAS[name] ?? "p1");
emit({
  dir: "single-mode",
  setName: "Field",
  props: { variant: ["primary", "secondary", "ghost"], size: ["sm", "md", "lg"] },
  collections: [PRIMITIVES, SEMANTIC_1],
  variables: [...primitives(), ...sem1],
  tree: (p) => ({
    name: "Field", type: "COMPONENT",
    layout: { mode: "HORIZONTAL", gap: GAP_OF[p.size!]!, padding: PAD, primaryAlign: "MIN", counterAlign: "CENTER", sizingH: "FILL", sizingV: "HUG" },
    fill: { bound: p.variant === "ghost" ? SURFACE_BG : p.variant === "secondary" ? SURFACE_MUTED : ACTION_BG, color: rgb(1, 1, 1) },
    radius: { bound: "p13", value: 4 },
    children: [
      iconInstance("Icon", "80:6", SURFACE_MUTED, 20),
      hiddenFocusRing(),
      { name: "Label", type: "TEXT", size: { w: 120, h: 20 }, text: { characters: "Email", style: "t1" }, fill: { bound: SURFACE_FG, color: rgb(0.122, 0.122, 0.122) } },
      { name: "Helper", type: "TEXT", size: { w: 200, h: 16 }, text: { characters: "We never share it.", style: "t2" }, fill: { bound: SURFACE_MUTED, color: rgb(0.376, 0.392, 0.404) } },
      { name: "Action", type: "TEXT", size: { w: 40, h: 20 }, text: { characters: "Edit", style: "t2" }, fill: { bound: ACTION_BG, color: rgb(0.102, 0.451, 0.91) } },
    ],
  }),
});

emit({
  dir: "twenty-variants",
  setName: "Chip",
  props: { size: ["xs", "sm", "md", "lg"], state: ["default", "hover", "pressed", "selected", "disabled"] },
  collections: [PRIMITIVES, SEMANTIC_2],
  variables: [...primitives(), ...sem2],
  tree: (p) => ({
    name: "Chip", type: "COMPONENT",
    layout: { mode: "HORIZONTAL", gap: GAP_OF[p.size!]!, padding: PAD, primaryAlign: "CENTER", counterAlign: "CENTER", sizingH: "HUG", sizingV: "HUG" },
    fill: { bound: BG_OF[p.state!]!, color: rgb(1, 1, 1) },
    radius: { bound: "p14", value: 8 },
    children: [
      iconInstance("Icon", "80:7", SURFACE_FG, 16),
      { name: "Label", type: "TEXT", size: { w: 72, h: 20 }, text: { characters: "Filter", style: "t1" }, fill: { bound: SURFACE_FG, color: rgb(0.122, 0.122, 0.122) } },
      hiddenFocusRing(),
      { name: "Count", type: "TEXT", size: { w: 24, h: 16 }, text: { characters: "12", style: "t2" }, fill: { bound: SURFACE_MUTED, color: rgb(0.376, 0.392, 0.404) } },
    ],
  }),
});
```
