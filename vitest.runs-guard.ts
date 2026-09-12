// Compare run artifacts directly because git status cannot detect changes in ignored output.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const runsRoot = join(import.meta.dirname, "runs");

/**
 * Tracks each relative path by file size and modification time.
 * Recursive `Dirent.parentPath` requires the Node version declared in package.json engines.
 */
export function listTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const stat = statSync(path);
    out.set(relative(root, path), `${stat.size}@${stat.mtimeMs}`);
  }
  return out;
}

/** Describe added, modified, and deleted paths; identical trees produce no entries. */
export function diffTree(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths
    .filter((p) => before.get(p) !== after.get(p))
    .map((p) => `${before.has(p) ? (after.has(p) ? "modified" : "deleted") : "added"} runs/${p}`);
}

export default function setup(): () => void {
  const before = listTree(runsRoot);
  return () => {
    const changed = diffTree(before, listTree(runsRoot));
    if (changed.length === 0) return;
    throw new Error(`Tests modified repository runs/. Write test output to TOKENLOOM_RUNS_DIR:\n${changed.join("\n")}`);
  };
}
