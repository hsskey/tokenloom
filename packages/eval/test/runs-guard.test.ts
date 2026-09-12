import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { base } from "../../../vitest.base";
import { diffTree, listTree } from "../../../vitest.runs-guard";

const repoRoot = resolve(import.meta.dirname, "../../..");

/** Diff logic and wiring for the global setup that rejects repository `runs/` changes. */
describe("runs guard", () => {
  it("lists added, modified, and deleted files while equal consecutive trees produce no diff", () => {
    const root = mkdtempSync(join(tmpdir(), "tl-guard-"));
    const kept = join(root, "2026-09-03.jsonl");
    const removed = join(root, "2026-09-05.jsonl");
    writeFileSync(kept, "{}\n", "utf8");
    writeFileSync(removed, "{}\n", "utf8");
    const before = listTree(root);

    writeFileSync(join(root, "leaked.r0.md"), "x", "utf8");
    writeFileSync(kept, "{}\n{}\n", "utf8");
    rmSync(removed);

    expect(diffTree(before, listTree(root))).toEqual([
      "modified runs/2026-09-03.jsonl",
      "deleted runs/2026-09-05.jsonl",
      "added runs/leaked.r0.md",
    ]);
    const settled = listTree(root);
    expect(diffTree(settled, listTree(root))).toEqual([]);
  });

  // Assert the configuration object Vitest receives so typecheck catches renamed keys.
  it("registers the guard as Vitest globalSetup", () => {
    expect(base.test?.globalSetup).toEqual([join(repoRoot, "vitest.runs-guard.ts")]);
  });
});
