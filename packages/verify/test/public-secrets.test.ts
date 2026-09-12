// Ensures the public tree and full history contain no real PATs, API keys, or local absolute paths.
// Length distinguishes placeholders from real values. History scans git log -p text diffs while the
// HEAD scan below covers binary-file contents.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const git = (args: string[]): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const PAT = /figd_[A-Za-z0-9_-]{20,}/;
const API_KEY = /sk-ant-[A-Za-z0-9_-]{20,}/;
/** Detects absolute paths containing a username while allowing `/Users/<user>/` placeholders. */
const LOCAL_PATH = /\/Users\/[A-Za-z0-9._-]+\//;

/** Non-text files whose content does not appear in `git log -p` diffs. */
const BINARY = /\.(png|jpg|jpeg|gif|woff2?|ico|br|zst|pdf)$/i;

/** Maximum unexpectedly-missing ratio owned by this test. */
const MAX_SKIP_RATIO = 0.1;

/**
 * The self-test gate empties `verify/selftest` inside every copy it validates while the copy shares the original
 * index, so those files are absent by design there. Counting them as evidence of a wrong tree made
 * the guard a function of how many self-test specimens exist, and it fired once they passed a tenth
 * of the index. They are scanned normally wherever they are present.
 */
function expectedAbsent(rel: string): boolean {
  return rel.startsWith("verify/selftest/");
}

export interface ScanBudget {
  read: number;
  missing: number;
  considered: number;
  ok: boolean;
}

/**
 * Read count and unexpectedly-missing ratio prevent an unreadable tree from passing vacuously.
 * `considered` excludes files that are absent for a known reason, so the verdict measures the tree
 * rather than the size of the self-test suite.
 */
export function scanBudget(tracked: string[], exists: (rel: string) => boolean): ScanBudget {
  let read = 0;
  let missing = 0;
  let considered = 0;
  for (const rel of tracked) {
    if (BINARY.test(rel)) continue;
    const present = exists(rel);
    if (!present && expectedAbsent(rel)) continue;
    considered += 1;
    if (present) read += 1;
    else missing += 1;
  }
  return { read, missing, considered, ok: read > 0 && missing / Math.max(considered, 1) <= MAX_SKIP_RATIO };
}

/** Collects the first match per tracked file as `<path>:<line> <match>`. History covers removed content. */
function hitsInTree(pattern: RegExp): string[] {
  const hits: string[] = [];
  const tracked = git(["ls-files"]).split("\n").filter((p) => p !== "");
  const present = (rel: string): boolean => existsSync(join(root, rel));
  const budget = scanBudget(tracked, present);
  if (!budget.ok) {
    throw new Error(
      `wrong cwd or missing tree: tracked ${tracked.length}, considered ${budget.considered}, `
      + `read ${budget.read}, unexpectedly missing ${budget.missing}`,
    );
  }
  for (const rel of tracked) {
    if (BINARY.test(rel) || !present(rel)) continue;
    readFileSync(join(root, rel), "utf8").split("\n").forEach((line, i) => {
      const m = pattern.exec(line);
      if (m !== null) hits.push(`${rel}:${i + 1} ${m[0]}`);
    });
  }
  return hits;
}

/** Matches patterns in full-history diffs so any committed occurrence is reported. */
function hitsInHistory(pattern: RegExp): string[] {
  return git(["log", "-p", "--all", "--no-color"])
    .split("\n")
    .filter((line) => pattern.test(line))
    .map((line) => (pattern.exec(line) as RegExpExecArray)[0]);
}

describe("scanBudget", () => {
  const tree = (n: number, prefix: string): string[] =>
    Array.from({ length: n }, (_unused, i) => `${prefix}${i}.ts`);
  const repo = [...tree(100, "packages/verify/src/f"), ...tree(30, "verify/selftest/types/s/apply/f")];

  it("accepts a self-test copy where every self-test file is absent by design", () => {
    const budget = scanBudget(repo, (rel) => !rel.startsWith("verify/selftest/"));

    expect(budget).toEqual({ read: 100, missing: 0, considered: 100, ok: true });
  });

  it("still rejects a tree missing more than a tenth of the files it should have read", () => {
    const absent = new Set(tree(11, "packages/verify/src/f"));

    expect(scanBudget(repo, (rel) => !absent.has(rel) && !rel.startsWith("verify/selftest/")).ok).toBe(false);
  });

  it("rejects a tree it could not read at all", () => {
    expect(scanBudget(repo, () => false)).toEqual({ read: 0, missing: 100, considered: 100, ok: false });
  });

  it("scans a self-test file that is present instead of excluding it from the tree", () => {
    expect(scanBudget(repo, () => true)).toEqual({ read: 130, missing: 0, considered: 130, ok: true });
  });
});

describe("public tree", () => {
  it.each([["real PAT", PAT], ["real Anthropic API key", API_KEY], ["local absolute path", LOCAL_PATH]] as const)(
    "contains no %s in tracked files",
    (_what, pattern) => {
      expect(hitsInTree(pattern)).toEqual([]);
    },
  );
});

describe("full history", () => {
  it.each([["real PAT", PAT], ["real Anthropic API key", API_KEY]] as const)(
    "contains no %s in any commit",
    (_what, pattern) => {
      expect(hitsInHistory(pattern)).toEqual([]);
    },
  );
});
