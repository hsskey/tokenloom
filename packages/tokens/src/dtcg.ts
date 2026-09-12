import type { CollectionT, SnapshotT, VariableT, WarningT } from "@tokenloom/schema";
import { categoryOf, resolveTokenNames, slug, toHex, toTokenPath } from "@tokenloom/schema";
import { platformNames } from "./identifier";

/** DTCG leaf whose `$value` is hex, `<n>px`, a number, a string, or a `{path}` reference. */
export interface TokenLeaf {
  $type: string;
  $value: string | number | boolean;
}
export type TokenTree = { [key: string]: TokenTree | TokenLeaf };

/**
 * Mode decision shared by the Swift and Kotlin emitters.
 * CSS emits a block per mode. Collection data is available only here, so this layer decides.
 */
export interface ModePlan {
  /** Canonical path to the file containing its dark branch, only for tokens that branch. */
  darkFileOf: Map<string, string>;
  /** Canonical path to discarded mode slugs joined in lexical order, only for collapsed tokens. */
  collapsedOf: Map<string, string>;
}

export interface DtcgResult {
  /** Filename (`base.json` or `mode.<slug>.json`) to token tree. */
  files: Map<string, TokenTree>;
  /** Files containing default modes, merged into `:root`. */
  rootFiles: Set<string>;
  tokenCount: number;
  modes: ModePlan;
  warnings: WarningT[];
  fatal?: "ALIAS_CYCLE";
}

const DIMENSION_CATEGORIES = new Set(["space", "radius", "size", "border"]);
/** This category conflicts with the `RootToken` type used by single-segment paths. */
const ROOT_CATEGORY = "root";
const BASE_FILE = "base.json";
const MODE_PAIR = ["dark", "light"];

/** Last mode-slug segment, used to identify light and dark modes (`SDS Dark` to `dark`). */
function modeTag(name: string): string {
  const parts = slug(name).split("-");
  return parts[parts.length - 1] ?? "";
}

/**
 * Branch only when a collection has exactly two modes whose final slug segments are `light` and `dark`.
 * Returns the dark mode when branching is valid and null otherwise.
 */
export function darkModeOf(collection: CollectionT): { id: string; name: string } | null {
  if (collection.modes.length !== 2) return null;
  const tags = collection.modes.map((m) => modeTag(m.name)).sort();
  if (tags[0] !== MODE_PAIR[0] || tags[1] !== MODE_PAIR[1]) return null;
  return collection.modes.find((m) => modeTag(m.name) === "dark") ?? null;
}

function findAliasCycle(vars: VariableT[]): string[] {
  const edges = new Map<string, string[]>();
  for (const v of vars) {
    const to: string[] = [];
    for (const value of Object.values(v.valuesByMode)) {
      const alias = aliasOf(value);
      if (alias !== null) to.push(alias);
    }
    edges.set(v.id, to);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const cycle: string[] = [];
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const next of edges.get(id) ?? []) {
      if (visit(next)) {
        cycle.push(id);
        return true;
      }
    }
    state.set(id, 2);
    return false;
  };
  for (const v of vars) if (state.get(v.id) !== 2 && visit(v.id)) return cycle.sort();
  return [];
}

function aliasOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("alias" in value)) return null;
  const alias = (value as { alias: unknown }).alias;
  return typeof alias === "string" ? alias : null;
}

function put(tree: TokenTree, path: string, leaf: TokenLeaf): void {
  const parts = path.split(".");
  let node = tree;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (next === undefined || "$type" in next) node[part] = {} as TokenTree;
    node = node[part] as TokenTree;
  }
  node[parts[parts.length - 1] as string] = leaf as unknown as TokenTree;
}

function leafOf(v: VariableT, value: unknown, pathOf: Map<string, string>): TokenLeaf | null {
  const alias = aliasOf(value);
  if (alias !== null) {
    const target = pathOf.get(alias);
    if (target === undefined) return null;
    return { $type: dtcgType(v), $value: `{${target}}` };
  }
  if (v.type === "COLOR" && typeof value === "object" && value !== null) {
    return { $type: "color", $value: toHex(value as { r: number; g: number; b: number; a: number }) };
  }
  if (v.type === "FLOAT" && typeof value === "number") {
    const path = pathOf.get(v.id) ?? "";
    return DIMENSION_CATEGORIES.has(categoryOf(path))
      ? { $type: "dimension", $value: `${value}px` }
      : { $type: "number", $value: value };
  }
  if (v.type === "STRING" && typeof value === "string") return { $type: "string", $value: value };
  if (v.type === "BOOLEAN" && typeof value === "boolean") return { $type: "boolean", $value: value };
  return null;
}

function dtcgType(v: VariableT): string {
  if (v.type === "COLOR") return "color";
  if (v.type === "STRING") return "string";
  if (v.type === "BOOLEAN") return "boolean";
  return "number";
}

function putTextStyles(
  tree: TokenTree, snapshot: SnapshotT, pathOf: Map<string, string>, count: { n: number },
): void {
  for (const style of [...snapshot.textStyles].sort((a, b) => a.name.localeCompare(b.name))) {
    const base = pathOf.get(style.id);
    if (base === undefined) continue;
    put(tree, `${base}.fontFamily`, { $type: "fontFamily", $value: style.fontFamily });
    put(tree, `${base}.fontSize`, { $type: "dimension", $value: `${style.fontSize}px` });
    put(tree, `${base}.fontWeight`, { $type: "number", $value: style.fontWeight });
    put(tree, `${base}.lineHeight`, { $type: "dimension", $value: `${style.lineHeight}px` });
    if (style.letterSpacing !== undefined) {
      put(tree, `${base}.letterSpacing`, { $type: "dimension", $value: `${style.letterSpacing}px` });
    }
    count.n += style.letterSpacing === undefined ? 4 : 5;
  }
}

/**
 * Map each canonical path to colliding platform-relative paths joined in lexical order.
 * Paths without collisions are absent, and input order does not affect the result.
 * Include the `root` category without a relative path because its type name conflicts with `RootToken`.
 */
function nameCollisions(paths: readonly string[]): Map<string, string> {
  const byName = new Map<string, Set<string>>();
  for (const path of paths) {
    for (const name of platformNames(path)) byName.set(name, (byName.get(name) ?? new Set()).add(path));
  }
  const others = new Map<string, Set<string>>();
  for (const group of byName.values()) {
    if (group.size < 2) continue;
    for (const path of group) {
      const set = others.get(path) ?? new Set<string>();
      for (const other of group) if (other !== path) set.add(other);
      others.set(path, set);
    }
  }
  for (const path of paths) {
    if (categoryOf(path) === ROOT_CATEGORY) others.set(path, others.get(path) ?? new Set<string>());
  }
  return new Map([...others].map(([path, s]) => [path, s.size === 0 ? "RootToken" : [...s].sort().join(",")]));
}

export function buildDtcg(snapshot: SnapshotT): DtcgResult {
  const warnings: WarningT[] = [];
  const cycle = findAliasCycle(snapshot.variables);
  if (cycle.length > 0) {
    for (const id of cycle) warnings.push({ code: "ALIAS_CYCLE", nodeId: id, detail: cycle.join(" -> ") });
    return {
      files: new Map(), rootFiles: new Set(), tokenCount: 0,
      modes: { darkFileOf: new Map(), collapsedOf: new Map() }, warnings, fatal: "ALIAS_CYCLE",
    };
  }

  // Variables and text styles share one namespace because they produce one token tree.
  const named: { id: string; name: string; prefix?: string }[] = [
    ...snapshot.variables.map((v) => ({ id: v.id, name: v.name })),
    ...snapshot.textStyles.map((s) => ({ id: s.id, name: s.name, prefix: "typo" })),
  ];
  const { pathOf, excluded } = resolveTokenNames(named);
  // Exclude both canonical paths when they map to the same platform name.
  const collided = nameCollisions([...pathOf.values()]);
  const counterparts = new Map<string, string>();
  for (const [id, path] of [...pathOf]) {
    const others = collided.get(path);
    if (others === undefined) continue;
    pathOf.delete(id);
    excluded.set(id, "NAME_COLLISION");
    counterparts.set(id, others);
  }
  for (const item of [...named].sort((a, b) => a.id.localeCompare(b.id))) {
    const code = excluded.get(item.id);
    if (code === undefined) continue;
    // Collision details use the platform-relative path; normalization errors use the canonical path.
    const detail = counterparts.get(item.id) ?? toTokenPath(item.name, item.prefix);
    warnings.push({ code, nodeId: item.id, detail });
  }

  const files = new Map<string, TokenTree>();
  const rootFiles = new Set<string>([BASE_FILE]);
  const count = { n: 0 };
  const byCollection = new Map(snapshot.collections.map((c) => [c.id, c]));
  const modes: ModePlan = { darkFileOf: new Map(), collapsedOf: new Map() };

  for (const v of [...snapshot.variables].sort((a, b) => (pathOf.get(a.id) ?? "").localeCompare(pathOf.get(b.id) ?? ""))) {
    const path = pathOf.get(v.id);
    const collection = byCollection.get(v.collectionId);
    if (path === undefined || collection === undefined) continue;
    if (collection.modes.length > 1) planModes(modes, collection, path, v);
    for (const mode of collection.modes) {
      // A single mode writes base.json; multiple modes retain their mode slug in the filename.
      const file = collection.modes.length === 1 ? BASE_FILE : `mode.${slug(mode.name)}.json`;
      const value = v.valuesByMode[mode.id];
      if (value === undefined) continue;
      const leaf = leafOf(v, value, pathOf);
      if (leaf === null) continue;
      let tree = files.get(file);
      if (tree === undefined) { tree = {}; files.set(file, tree); }
      put(tree, path, leaf);
      count.n += 1;
      if (mode.id === collection.defaultModeId) rootFiles.add(file);
    }
  }

  let base = files.get(BASE_FILE);
  if (base === undefined) { base = {}; files.set(BASE_FILE, base); }
  putTextStyles(base, snapshot, pathOf, count);
  return { files, rootFiles, tokenCount: count.n, modes, warnings };
}

/**
 * `MODE_COLLAPSED` is produced only by platform emitters.
 * CSS emits every mode as a block, so it discards no modes and produces no warning.
 */
export function modeWarnings(plan: ModePlan): WarningT[] {
  return [...plan.collapsedOf]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, dropped]) => ({ code: "MODE_COLLAPSED" as const, nodeId: path, detail: dropped }));
}

/**
 * Only color tokens in eligible multi-mode collections branch; other tokens use the default value and warn once.
 */
function planModes(plan: ModePlan, collection: CollectionT, path: string, v: VariableT): void {
  const dark = v.type === "COLOR" ? darkModeOf(collection) : null;
  if (dark !== null) {
    plan.darkFileOf.set(path, `mode.${slug(dark.name)}.json`);
    return;
  }
  const dropped = collection.modes
    .filter((m) => m.id !== collection.defaultModeId)
    .map((m) => slug(m.name))
    .sort();
  plan.collapsedOf.set(path, dropped.join(","));
}
