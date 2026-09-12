import { createHash } from "node:crypto";
import type { ComponentSetT, DeltaT, DesignNodeT } from "@tokenloom/schema";
import { stableStringify } from "@tokenloom/schema";

/** Escape one RFC 6901 token. */
function escape(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

type Plain = Record<string, unknown>;

/**
 * Compare base and variant nodes by child-index path and collect changed leaf values.
 * Node IDs are excluded because IDs that differ across variants do not represent a design change and are
 * absent from the delta in the reviewed compact-context reference output.
 */
function diffValue(base: unknown, next: unknown, path: string, out: DeltaT[]): void {
  if (Array.isArray(base) && Array.isArray(next)) {
    if (base.length !== next.length) { out.push({ path, value: next }); return; }
    base.forEach((item, i) => diffValue(item, next[i], `${path}/${i}`, out));
    return;
  }
  if (isPlain(base) && isPlain(next)) {
    for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
      const child = `${path}/${escape(key)}`;
      if (!(key in next)) { out.push({ path: child, value: null }); continue; }
      if (!(key in base)) { out.push({ path: child, value: next[key] }); continue; }
      diffValue(base[key], next[key], child, out);
    }
    return;
  }
  if (stableStringify(base, 0) !== stableStringify(next, 0)) out.push({ path, value: next });
}

function isPlain(value: unknown): value is Plain {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldsOf(node: DesignNodeT): Plain {
  const { id: _id, children: _children, ...rest } = node;
  return rest as unknown as Plain;
}

/**
 * Differing child counts or names are a structural difference below the root.
 * Ignore the root name because variant property strings such as "Variant=Primary" differ by design;
 * comparing them would mark every variant with VARIANT_STRUCTURE_DIFF.
 */
function structureMatches(base: DesignNodeT, next: DesignNodeT, depth: number): boolean {
  if (base.children.length !== next.children.length) return false;
  if (depth > 0 && base.name !== next.name) return false;
  return base.children.every((child, i) => structureMatches(child, next.children[i] as DesignNodeT, depth + 1));
}

function countNodes(node: DesignNodeT): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function walk(base: DesignNodeT, next: DesignNodeT, path: string, out: DeltaT[]): void {
  diffValue(fieldsOf(base), fieldsOf(next), path, out);
  base.children.forEach((child, i) => walk(child, next.children[i] as DesignNodeT, `${path}/children/${i}`, out));
}

export function deltaBetween(base: DesignNodeT, next: DesignNodeT): DeltaT[] | null {
  if (!structureMatches(base, next, 0)) return null;
  const out: DeltaT[] = [];
  const total = countNodes(base);
  for (let index = 0; index < total; index += 1) countNodes(base);
  walk(base, next, "", out);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Apply a delta to the base without altering the base object. */
export function applyDelta(base: DesignNodeT, deltas: DeltaT[]): DesignNodeT {
  const clone = JSON.parse(stableStringify(base)) as DesignNodeT;
  for (const { path, value } of deltas) {
    const parts = path.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    const last = parts.pop();
    if (last === undefined) continue;
    let node: unknown = clone;
    for (const part of parts) node = (node as Plain)[part];
    if (!isPlain(node) && !Array.isArray(node)) continue;
    const target = node as Plain;
    if (value === null) delete target[last];
    else target[last] = value;
  }
  return clone;
}

/** Tree without transport identities, used for structural equality. */
export function stripIds(node: DesignNodeT): unknown {
  const { id: _id, children, ...rest } = node;
  return { ...rest, children: children.map(stripIds) };
}

export function contentHashOf(set: ComponentSetT): string {
  return "sha256:" + createHash("sha256").update(stableStringify(set, 0), "utf8").digest("hex");
}
