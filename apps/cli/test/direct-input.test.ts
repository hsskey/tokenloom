// A plugin export read directly must produce what the same file produces after `snapshot import`, and
// an absolute input path must work from any working directory. These drive apps/cli/dist/tokenloom.js
// as a child process so they observe the public boundary rather than importing parser internals.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const cli = resolve(root, "apps/cli/dist/tokenloom.js");
const sampleSnapshot = resolve(root, "samples/button/snapshot.json");

function run(args: string[], cwd = root): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A plugin export is the sample Snapshot with embedded render data in place of the render path. */
function exportFrom(snapshotPath: string): unknown {
  const snap = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
    componentSets: { components: { renderPng?: string; renderPngBase64?: string }[] }[];
  };
  for (const set of snap.componentSets) {
    for (const component of set.components) {
      delete component.renderPng;
      component.renderPngBase64 = Buffer.from(`png-for-${set.components.indexOf(component)}`).toString("base64");
    }
  }
  return snap;
}

function writeExport(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(exportFrom(sampleSnapshot)));
  return path;
}

const temp = (): string => mkdtempSync(join(tmpdir(), "tokenloom-a01-"));

describe("A01: a plugin export produces the same payload as importing it first", () => {
  const dir = temp();
  const exportPath = writeExport(dir, "checkout.json");
  // The import path is the documented alternative: materialize a Snapshot, then query that.
  const imported = join(dir, "sample");
  const importResult = run(["snapshot", "import", exportPath, "--into", imported]);
  const snapshotPath = join(imported, "snapshot.json");

  it("import of the generated export succeeds, so both sides of the comparison are real", () => {
    expect(importResult.status).toBe(0);
  });

  it.each([
    { name: "agent context with annotations", args: ["context", "Button", "--annotations", "--json", "--view", "agent"] },
    { name: "agent discovery", args: ["context", "--view", "agent", "--json"] },
    { name: "filtered discovery", args: ["context", "--view", "agent", "--json", "--match", "But"] },
    // A name no set carries, so discovery returns an empty result rather than no result at all.
    { name: "empty discovery", args: ["context", "--view", "agent", "--json", "--match", "no-such-set"] },
    { name: "exact variant selection", args: ["context", "Button", "--json", "--view", "agent", "--variant=variant=primary,size=md"] },
    { name: "doctor", args: ["doctor", "--json"] },
  ])("$name is byte-identical on stdout, stderr and exit status for direct and imported input", ({ args }) => {
    const direct = run([...args, "--from", exportPath]);
    const viaImport = run([...args, "--from", snapshotPath]);

    expect({ status: direct.status, stdout: direct.stdout, stderr: direct.stderr })
      .toEqual({ status: viaImport.status, stdout: viaImport.stdout, stderr: viaImport.stderr });
  });

  it("the compared empty discovery really is empty, so the equality above is not vacuous", () => {
    const out = run(["context", "--view", "agent", "--json", "--match", "no-such-set", "--from", exportPath]);

    expect(JSON.parse(out.stdout) as { count: number; components: unknown[] })
      .toMatchObject({ count: 0, components: [] });
  });

  it("the compared variant selection really returns that one variant, so the equality above is not vacuous", () => {
    const out = run(["context", "Button", "--json", "--view", "agent", "--variant=variant=primary,size=md", "--from", exportPath]);
    const body = JSON.parse(out.stdout) as { component: { base: { props: unknown }; variants: unknown[] } };

    expect({ status: out.status, props: body.component.base.props, variants: body.component.variants })
      .toEqual({ status: 0, props: { size: "md", variant: "primary" }, variants: [] });
  });

  // Both components in the sample carry size=md, so that selector alone selects nothing. Comparing it
  // across the two routes would compare one failure against another.
  it("a selector this sample cannot resolve is rejected on both routes rather than compared as a payload", () => {
    const direct = run(["context", "Button", "--json", "--variant=size=md", "--from", exportPath]);
    const viaImport = run(["context", "Button", "--json", "--variant=size=md", "--from", snapshotPath]);

    expect([direct, viaImport].map((r) => ({ status: r.status, stdout: r.stdout, ambiguous: r.stderr.includes("VARIANT_AMBIGUOUS") })))
      .toEqual([{ status: 1, stdout: "", ambiguous: true }, { status: 1, stdout: "", ambiguous: true }]);
  });

  /** Every emitted file, keyed by its path relative to the output directory. */
  function tokenTree(from: string, tag: string): Record<string, string> {
    const out = join(dir, `tokens-${tag}`);
    // css, swift and kotlin are the platforms; the DTCG document is emitted alongside them.
    expect(run(["tokens", "build", "--from", from, "--out", out, "--platform", "css,swift,kotlin"]).status).toBe(0);
    const walk = (base: string, prefix: string): [string, string][] =>
      readdirSync(join(out, base), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) =>
        e.isDirectory()
          ? walk(join(base, e.name), `${prefix}${e.name}/`)
          : [[`${prefix}${e.name}`, readFileSync(join(out, base, e.name), "utf8")] as [string, string]],
      );
    return Object.fromEntries(walk(".", ""));
  }

  it("token output is identical in file list and content for direct and imported input", () => {
    const direct = tokenTree(exportPath, "direct");
    const viaImport = tokenTree(snapshotPath, "import");

    expect(direct).toEqual(viaImport);
  });

  it("the emitted token tree covers all three platforms and the DTCG document", () => {
    const names = Object.keys(tokenTree(exportPath, "coverage")).join(" ");

    expect({
      css: names.includes("css/"), swift: names.includes("swift/"),
      kotlin: names.includes("kotlin/"), dtcg: names.includes("tokens/"),
    }).toEqual({ css: true, swift: true, kotlin: true, dtcg: true });
  });

  // contentHash covers the whole component set, and snapshot import records a renderPng path that
  // direct input deliberately never emits. The canonical payload is therefore identical apart from
  // that one field, and the two tests below pin both halves of that statement.
  it("canonical context matches for direct and imported input apart from contentHash", () => {
    const strip = (s: string): string => s.replace(/"contentHash": "sha256:[0-9a-f]+"/g, '"contentHash": "<hash>"');
    const direct = run(["context", "Button", "--json", "--from", exportPath]);
    const viaImport = run(["context", "Button", "--json", "--from", snapshotPath]);

    expect({ status: direct.status, stdout: strip(direct.stdout) })
      .toEqual({ status: viaImport.status, stdout: strip(viaImport.stdout) });
  });

  it("contentHash differs only because of render data, and matches when the export carries none", () => {
    const plain = temp();
    const snap = JSON.parse(readFileSync(sampleSnapshot, "utf8")) as {
      componentSets: { components: { renderPng?: string }[] }[];
    };
    for (const set of snap.componentSets) for (const c of set.components) delete c.renderPng;
    const noRender = join(plain, "norender.json");
    writeFileSync(noRender, JSON.stringify(snap));
    const into = join(plain, "sample");
    expect(run(["snapshot", "import", noRender, "--into", into]).status).toBe(0);

    const hash = (from: string): string =>
      /"contentHash": "(sha256:[0-9a-f]+)"/.exec(run(["context", "Button", "--json", "--from", from]).stdout)?.[1] ?? "";

    expect(hash(noRender)).toBe(hash(join(into, "snapshot.json")));
  });

  it("a directly loaded export leaves no render file beside it", () => {
    const only = temp();
    const path = writeExport(only, "one.json");

    run(["context", "Button", "--from", path, "--json"]);

    expect(readdirSync(only)).toEqual(["one.json"]);
  });
});

describe("A05: paths are resolved against the invocation directory, never guessed", () => {
  it("an absolute input works from an unrelated working directory", () => {
    const dir = temp();
    const path = writeExport(dir, "checkout.json");

    const result = run(["context", "Button", "--from", path, "--json"], tmpdir());

    expect(result.status).toBe(0);
  });

  it("a relative input resolves against the invocation directory, not the repository", () => {
    const dir = temp();
    writeExport(dir, "checkout.json");

    const result = run(["context", "Button", "--from", "checkout.json", "--json"], dir);

    expect(result.status).toBe(0);
  });

  it.each([
    { name: "spaces", dirName: "a dir with spaces" },
    { name: "unicode", dirName: "디자인-폴더" },
    { name: "shell metacharacters", dirName: "weird $(echo no);&" },
  ])("$name in the path are passed as one argument and load correctly", ({ dirName }) => {
    const dir = join(temp(), dirName);
    const path = writeExport(dir, "checkout.json");

    const result = run(["context", "Button", "--from", path, "--json"]);

    expect(result.status).toBe(0);
  });

  it("a missing input fails without scanning a sibling JSON file that does exist", () => {
    const dir = temp();
    writeExport(dir, "decoy.json");

    const result = run(["context", "Button", "--from", join(dir, "absent.json"), "--json"], dir);

    expect({ status: result.status, stdout: result.stdout, mentionsDecoy: result.stderr.includes("decoy") })
      .toEqual({ status: 1, stdout: "", mentionsDecoy: false });
  });

  it("no machine-specific absolute path leaks into the design payload", () => {
    const dir = temp();
    const path = writeExport(dir, "checkout.json");

    const stdout = run(["context", "Button", "--from", path, "--json", "--view", "agent"]).stdout;

    expect(stdout.includes(dir)).toBe(false);
  });
});
