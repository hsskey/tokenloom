import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const CLI = resolve(repoRoot, "apps/cli/dist/tokenloom.js");

interface Expectation {
  cmd?: string;
  warnings?: string[];
  exit: number;
  exitStrict?: number;
  stderrIncludes?: string[];
  variantHasRoot?: boolean;
  childrenCount?: number;
  files?: string[];
}

const expected = JSON.parse(
  readFileSync(resolve(repoRoot, "samples/mutations/expected.json"), "utf8"),
) as Record<string, Expectation>;

function run(id: string, spec: Expectation, extra: string[] = []): { status: number; stdout: string; stderr: string } {
  const base = (spec.cmd ?? "context Button").split(" ");
  const args = [...base, "--from", resolve(repoRoot, `samples/mutations/${id}.json`), "--json", ...extra];
  if (base[0] === "context") args.push("--annotations");
  if (base[0] === "tokens") args.push("--out", mkdtempSync(join(tmpdir(), "tl-mut-")));
  const res = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    cwd: repoRoot,
    env: { ...process.env, TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-runs-")) },
  });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

function codes(stdout: string): string[] {
  const parsed = JSON.parse(stdout === "" ? "{}" : stdout) as { warnings?: { code: string }[] };
  return [...new Set((parsed.warnings ?? []).map((w) => w.code))].sort();
}

describe("mutation test data M01-M12 (docs/reference/spec.md section 5.5)", () => {
  const ids = Object.keys(expected).sort();

  it.each(ids)("%s: exit code matches expected.json", (id) => {
    const spec = expected[id] as Expectation;
    expect(run(id, spec).status).toBe(spec.exit);
  });

  it.each(ids.filter((id) => (expected[id] as Expectation).warnings !== undefined))(
    "%s: the warning-code set matches exactly",
    (id) => {
      const spec = expected[id] as Expectation;
      expect(codes(run(id, spec).stdout)).toEqual([...(spec.warnings ?? [])].sort());
    },
  );

  it.each(ids.filter((id) => (expected[id] as Expectation).exitStrict !== undefined))(
    "%s: strict mode exits with code 2",
    (id) => {
      const spec = expected[id] as Expectation;
      expect(run(id, spec, ["--strict"]).status).toBe(spec.exitStrict);
    },
  );

  it("M06: stderr includes NAME_COLLISION and both candidate IDs", () => {
    const { stderr } = run("M06", expected.M06 as Expectation);
    expect(stderr).toContain("NAME_COLLISION");
    expect(stderr).toContain("12:34");
    expect(stderr).toContain("12:99");
  });

  it("M08: a structurally different variant includes its complete root", () => {
    const context = JSON.parse(run("M08", expected.M08 as Expectation).stdout) as {
      component: { variants: { root?: unknown }[] };
    };
    expect(context.component.variants[0]?.root).not.toBe(undefined);
  });

  it("M10: removing the hidden Label leaves empty base children and no warnings", () => {
    const context = JSON.parse(run("M10", expected.M10 as Expectation).stdout) as {
      component: { base: { root: { children: unknown[] } } }; warnings: unknown[];
    };
    expect(context.component.base.root.children).toEqual([]);
    expect(context.warnings).toEqual([]);
  });

  it("M11: stderr includes no components", () => {
    expect(run("M11", expected.M11 as Expectation).stderr).toContain("no components");
  });
});
