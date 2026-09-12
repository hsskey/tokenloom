import type { DtcgResult, TokenLeaf, TokenTree } from "./dtcg";
import { cssVarName } from "./identifier";

function isLeaf(node: TokenTree | TokenLeaf): node is TokenLeaf {
  return "$type" in node && "$value" in node;
}

/** Flatten a tree into path-and-leaf pairs independent of insertion order. */
export function flatten(tree: TokenTree, prefix = ""): [string, TokenLeaf][] {
  const out: [string, TokenLeaf][] = [];
  for (const key of Object.keys(tree).sort()) {
    const node = tree[key];
    if (node === undefined) continue;
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isLeaf(node)) out.push([path, node]);
    else out.push(...flatten(node, path));
  }
  return out;
}

/** Emit aliases as `var(--...)` and literals as lowercase hex or `px`. */
export function cssValue(leaf: TokenLeaf): string {
  const raw = leaf.$value;
  if (typeof raw === "string" && raw.startsWith("{") && raw.endsWith("}")) {
    return `var(${cssVarName(raw.slice(1, -1))})`;
  }
  return String(raw);
}

function block(selector: string, decls: [string, TokenLeaf][]): string {
  const lines = decls
    .map(([path, leaf]) => [cssVarName(path), cssValue(leaf)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}

/**
 * Put base and default modes in `:root`, and other modes in `[data-theme="<mode>"]`.
 * Blocks and variables use lexical order, contain no comments, and end with one newline.
 */
export function emitCss(dtcg: DtcgResult): string {
  const root: [string, TokenLeaf][] = [];
  const themes = new Map<string, [string, TokenLeaf][]>();
  for (const file of [...dtcg.files.keys()].sort()) {
    const tree = dtcg.files.get(file);
    if (tree === undefined) continue;
    const decls = flatten(tree);
    if (dtcg.rootFiles.has(file)) root.push(...decls);
    else themes.set(file.replace(/^mode\.|\.json$/g, ""), decls);
  }
  const blocks = [block(":root", root)];
  for (const mode of [...themes.keys()].sort()) {
    blocks.push(block(`[data-theme="${mode}"]`, themes.get(mode) ?? []));
  }
  return blocks.join("\n\n") + "\n";
}
