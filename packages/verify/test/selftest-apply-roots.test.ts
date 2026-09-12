// A self-test sample overlays `apply/**` onto a copy of the repository. When a repository directory is
// renamed and a sample keeps the old path, the overlay silently creates an unused directory instead of
// mutating the target, the gate passes, and the sample stops proving anything until the self-test runs.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Top-level entry of every path an overlay would write, paired with its sample, read from the tracked
 * sample tree rather than the working tree. The self-test empties `verify/selftest` inside every copy it
 * validates, so a working-tree listing is empty exactly where this check has to run.
 */
function overlayRoots(): { sample: string; root: string }[] {
  const listed = execFileSync("git", ["ls-files", "-z", "verify/selftest/*/*/apply/*"], {
    cwd: repoRoot, encoding: "utf8",
  });
  const seen = new Map<string, { sample: string; root: string }>();
  for (const path of listed.split("\0")) {
    // verify/selftest/<gate>/<sample>/apply/<root>/...
    const [, , gate, name, , root] = path.split("/");
    if (root === undefined) continue;
    seen.set(`${gate}/${name}/${root}`, { sample: `${gate}/${name}`, root });
  }
  return [...seen.values()];
}

describe("self-test overlay paths", () => {
  it("finds an overlay in the sample tree", () => {
    expect(overlayRoots().length).toBeGreaterThan(0);
  });

  it("writes every overlay into a directory that still exists in the repository", () => {
    const stale = overlayRoots().filter(({ root }) => !existsSync(join(repoRoot, root)));
    expect(stale).toEqual([]);
  });
});
