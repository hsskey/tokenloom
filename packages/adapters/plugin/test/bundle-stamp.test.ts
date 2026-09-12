import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pluginDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(pluginDir, "../../..");
/** Development plugin bundle named by manifest `main` and imported into Figma. */
const distBundle = resolve(pluginDir, "dist/code.js");

/**
 * Run the package build script directly, with package.json as the command source.
 * Avoid `pnpm --filter` because verifier self-test repository copies fail pnpm's dependency-state check.
 * Match pnpm's PATH and redirect output through `TOKENLOOM_PLUGIN_OUTFILE` to a temporary directory.
 */
function buildBundle(outfile: string): string {
  const script = (JSON.parse(readFileSync(resolve(pluginDir, "package.json"), "utf8")) as {
    scripts: { build: string };
  }).scripts.build;
  const bin = [resolve(pluginDir, "node_modules/.bin"), resolve(repoRoot, "node_modules/.bin")].join(":");
  const res = spawnSync("sh", ["-c", script], {
    cwd: pluginDir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}`, TOKENLOOM_PLUGIN_OUTFILE: outfile },
  });
  expect(res.status, res.stderr).toBe(0);
  return readFileSync(outfile, "utf8");
}

/** sha256 of `dist/code.js`, or a missing marker because ignored dist output may be absent. */
function distDigest(): string {
  return existsSync(distBundle) ? createHash("sha256").update(readFileSync(distBundle)).digest("hex") : "(missing)";
}

/** The bundle's `exporter: { ... }` literal, isolated from unrelated time fields. */
function exporterLiteral(bundle: string): string {
  const match = /exporter: \{[^}]*\}/.exec(bundle);
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[0];
}

describe("plugin bundle stamp (docs/reference/spec.md section 4.9)", () => {
  // Build once so all assertions observe the same output and dist state.
  let bundle = "";
  let distBefore = "";
  let outDir = "";
  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "tokenloom-stamp-"));
    distBefore = distDigest();
    bundle = buildBundle(join(outDir, "code.js"));
  });
  afterAll(() => { rmSync(outDir, { recursive: true, force: true }); });

  it("emits a 40-character exporter sha and appends -dirty for a dirty worktree", () => {
    const literal = exporterLiteral(bundle);
    const sha = /sha: "([^"]*)"/.exec(literal)?.[1];
    const porcelain = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
    expect([/^[0-9a-f]{40}(-dirty)?$/.test(sha ?? ""), sha?.endsWith("-dirty")]).toEqual([true, porcelain.trim() !== ""]);
  });

  it("does not compute export time inside the exporter literal", () => {
    const literal = exporterLiteral(bundle);
    expect([literal.includes("Date.now("), literal.includes("new Date(")]).toEqual([false, false]);
  });

  it("leaves dist/code.js unchanged when the test builds the plugin", () => {
    expect(distDigest()).toBe(distBefore);
  });
});
