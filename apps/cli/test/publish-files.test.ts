// Lock the published package contents: an npm install must carry the CLI, its Skill template, and
// nothing from the development harness.
// Widening the files manifest must not include operational artifacts in published packages.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { skillResource } from "../src/cmd-init";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dirname(dirname(pkgDir));

interface PackResult { files: { path: string }[] }

/** Read the first package from either npm's keyed-object format or its earlier array format. */
function packedPaths(): string[] {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: pkgDir, encoding: "utf8" });
  const parsed = JSON.parse(raw) as PackResult[] | Record<string, PackResult>;
  const first = (Array.isArray(parsed) ? parsed : Object.values(parsed))[0] as PackResult;
  return first.files.map((f) => f.path);
}

const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
  bin: Record<string, string>;
  private?: boolean;
  publishConfig: { access: string };
};

/** Inspect the packaged manifest because npm normalizes fields such as bin while packing. */
function packedManifest(): { engines?: { node?: string } } {
  const out = mkdtempSync(join(tmpdir(), "tokenloom-pack-"));
  try {
    execFileSync("npm", ["pack", "--pack-destination", out], { cwd: pkgDir, stdio: "ignore" });
    const tgz = join(out, readdirSync(out)[0] as string);
    return JSON.parse(execFileSync("tar", ["-xzOf", tgz, "package/package.json"], { encoding: "utf8" }));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Reasons and path patterns for artifacts excluded from the published package. */
const FORBIDDEN: [string, RegExp][] = [
  ["budget ledgers and caches", /\.tokenloom/],
  ["PAT values", /figd_/],
  ["MCP captures", /samples\/captures/],
  ["raw evaluation outputs", /runs\/out/],
  ["verification results", /^verify\/.*\.json$/],
  ["CI workflows", /\.github/],
];

describe("npm package contents", () => {
  const paths = packedPaths();

  it.each(FORBIDDEN)("%s are excluded from the package", (_reason, pattern) => {
    expect(paths.filter((p) => pattern.test(p))).toEqual([]);
  });

  it.each(["dist/tokenloom.js", "skill/SKILL.md", "package.json", "LICENSE", "README.md"])(
    "%s is included in the package",
    (path) => {
      expect(paths).toContain(path);
    },
  );

  // init reads the template by one relative step from its own bundle, so the packaged layout must place
  // the template exactly where that step lands.
  it("packages the Skill template where init's own relative step resolves it", () => {
    const { bundle, source } = skillResource();

    const resolved = join(dirname("dist/tokenloom.js"), relative(dirname(bundle), source));

    expect(paths).toContain(resolved);
  });

  it("the package includes the bundle without source or tests", () => {
    expect(paths.filter((p) => p.startsWith("src/") || p.startsWith("test/"))).toEqual([]);
  });

  it("bin omits the leading ./ that npm normalizes with a warning", () => {
    expect(manifest.bin.tokenloom).toBe("dist/tokenloom.js");
  });

  // The maintainer has released the package, so private is removed and public access stays configured.
  it("carries no private flag with public access configured for the release", () => {
    expect([manifest.private, manifest.publishConfig.access]).toEqual([undefined, "public"]);
  });

  it("the packaged Node engine matches the root manifest and node22 bundle target", () => {
    const rootEngines = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { engines: { node: string } }).engines.node;
    expect(packedManifest().engines?.node).toBe(rootEngines);
  });

  it("the package license matches the repository license byte for byte", () => {
    expect(readFileSync(join(pkgDir, "LICENSE"), "utf8")).toBe(readFileSync(join(root, "LICENSE"), "utf8"));
  });
});
