import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const CLI = resolve(repoRoot, "apps/cli/dist/tokenloom.js");
const BUTTON = resolve(repoRoot, "samples/button/snapshot.json");

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    cwd: repoRoot,
    env: { ...process.env, TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-runs-")) },
  });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

function build(extra: string[] = []): { out: string; status: number; stdout: string; stderr: string } {
  const out = mkdtempSync(join(tmpdir(), "tl-out-"));
  const res = runCli(["tokens", "build", "--from", BUTTON, "--platform", "css", "--out", out, ...extra]);
  return { out, ...res };
}

describe("tokens build reference outputs (black box)", () => {
  it("css/tokens.css matches the reference bytes", () => {
    const { out, status } = build();
    expect(status).toBe(0);
    expect(readFileSync(join(out, "css/tokens.css"), "utf8")).toBe(
      readFileSync(resolve(repoRoot, "samples/button/reference/css/tokens.css"), "utf8"),
    );
  });

  it("all three tokens/*.json files match the reference bytes", () => {
    const { out } = build();
    for (const name of ["base.json", "mode.light.json", "mode.dark.json"]) {
      expect(readFileSync(join(out, "tokens", name), "utf8")).toBe(
        readFileSync(resolve(repoRoot, "samples/button/reference/tokens", name), "utf8"),
      );
    }
  });

  it("--json emits exactly one JSON document on stdout", () => {
    const { stdout, stderr } = build(["--json"]);
    const parsed = JSON.parse(stdout) as { files: string[]; tokens: number; warnings: unknown[] };
    expect(parsed.tokens).toBe(19);
    expect(parsed.files).toHaveLength(4);
    expect(stderr).toContain("tokens build: 4 files");
  });

  it("repeated runs with identical input and output paths produce identical stdout bytes", () => {
    const out = mkdtempSync(join(tmpdir(), "tl-out-"));
    const args = ["tokens", "build", "--from", BUTTON, "--platform", "css", "--out", out, "--json"];
    expect(runCli(args).stdout).toBe(runCli(args).stdout);
  });

  it("unknown commands exit with code 1 and one stderr line", () => {
    const res = runCli(["nope"]);
    expect(res.status).toBe(1);
    expect(res.stdout).toBe("");
    expect(res.stderr).toBe('tokenloom: unknown command "nope"\n');
  });

  it("tokens build without --from exits with code 1", () => {
    const res = runCli(["tokens", "build"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--from");
  });

  it("unknown platforms exit with code 1", () => {
    const res = runCli(["tokens", "build", "--from", BUTTON, "--platform", "flutter"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("unknown platform flutter");
  });

  it("doctor --json emits the warning table", () => {
    const res = runCli(["doctor", "--from", BUTTON, "--json"]);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ byCode: {}, warnings: [], total: 0 });
  });

  it("writes no run ledger into the working directory when it runs outside a checkout", () => {
    const outside = mkdtempSync(join(tmpdir(), "tl-outside-"));
    onTestFinished(() => { rmSync(outside, { recursive: true, force: true }); });
    const env = { ...process.env };
    delete env.TOKENLOOM_RUNS_DIR;

    const res = spawnSync(process.execPath, [CLI, "doctor", "--from", BUTTON], {
      cwd: outside, encoding: "utf8", env,
    });

    expect({ status: res.status, entries: readdirSync(outside) }).toEqual({ status: 0, entries: [] });
  });

  it("doctor reports the warning total on stderr so a clean snapshot is not silent", () => {
    const res = runCli(["doctor", "--from", BUTTON]);

    expect(res.stderr).toBe("doctor: 0 warnings\n");
  });

  it("doctor totals the per-code table for a snapshot that has warnings", () => {
    const res = runCli(["doctor", "--from", "samples/mutations/M01.json"]);

    expect(res.stderr).toBe("UNBOUND_COLOR\t2\ndoctor: 2 warnings\n");
  });
});
