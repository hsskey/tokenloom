import { flatten } from "./css";
import type { DtcgResult, TokenLeaf } from "./dtcg";
import { categoryKey, qualified } from "./identifier";

/** Both emitters traverse this one array, so their name sets match by construction. */
export interface Member {
  path: string;
  /** Type-group key. A single-segment path uses an empty category and becomes `RootToken`. */
  category: string;
  /** DTCG `$type`, which determines the type annotation and value format. */
  type: string;
  value: TokenLeaf;
  /** Dark value present only for color tokens that can branch. */
  dark?: TokenLeaf;
}

/**
 * Flatten the `:root` set, base plus each collection's default mode, in canonical-path order.
 * Branch values come only from files selected during mode planning.
 */
export function members(dtcg: DtcgResult): Member[] {
  const byPath = new Map<string, Member>();
  for (const file of [...dtcg.files.keys()].sort()) {
    if (!dtcg.rootFiles.has(file)) continue;
    const tree = dtcg.files.get(file);
    if (tree === undefined) continue;
    for (const [path, leaf] of flatten(tree)) {
      byPath.set(path, { path, category: categoryKey(path), type: leaf.$type, value: leaf });
    }
  }
  // Flatten each dark file once to avoid multiplying tree traversal by the number of dark paths.
  const darkLeaves = new Map<string, Map<string, TokenLeaf>>();
  for (const file of new Set(dtcg.modes.darkFileOf.values())) {
    const tree = dtcg.files.get(file);
    if (tree !== undefined) darkLeaves.set(file, new Map(flatten(tree)));
  }
  for (const [path, darkFile] of dtcg.modes.darkFileOf) {
    const member = byPath.get(path);
    const leaf = darkLeaves.get(darkFile)?.get(path);
    if (member !== undefined && leaf !== undefined) member.dark = leaf;
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Group by ascending category name. The empty category places `RootToken` first. */
export function byCategory(list: Member[]): [string, Member[]][] {
  const groups = new Map<string, Member[]>();
  for (const m of list) {
    const group = groups.get(m.category);
    if (group === undefined) groups.set(m.category, [m]); else group.push(m);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function aliasTarget(leaf: TokenLeaf): string | null {
  const raw = leaf.$value;
  if (typeof raw !== "string" || !raw.startsWith("{") || !raw.endsWith("}")) return null;
  return raw.slice(1, -1);
}

/** Remove `px`; format integers directly and decimals with the shortest round-trippable string. */
export function numberText(leaf: TokenLeaf): string {
  const raw = leaf.$value;
  if (typeof raw === "number") return String(raw);
  return String(Number(String(raw).replace(/px$/, "")));
}

/** Convert CSS hex to the lowercase ARGB form used by native platforms. */
export function colorHex(leaf: TokenLeaf): string {
  const hex = String(leaf.$value).replace("#", "").toLowerCase();
  const rgb = hex.slice(0, 6);
  const alpha = hex.length === 8 ? hex.slice(6, 8) : "ff";
  return `0x${alpha}${rgb}`;
}

/** Swift escapes backslashes and quotes; Kotlin also escapes `$`. */
export function quote(leaf: TokenLeaf, escapeDollar: boolean): string {
  let text = String(leaf.$value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (escapeDollar) text = text.replace(/\$/g, "\\$");
  return `"${text}"`;
}

/** Preserve aliases as references to another static member instead of resolving their values. */
export function valueText(leaf: TokenLeaf, format: (leaf: TokenLeaf) => string): string {
  const alias = aliasTarget(leaf);
  return alias === null ? format(leaf) : qualified(alias);
}
