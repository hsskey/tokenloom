// The MCP route reading the same snapshot as the CLI, including from an unrelated working directory
// given an absolute input path. These drive the real MCP entry point, callTool over the node CLI
// adapter, because that is the boundary an agent host actually calls.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { callTool, nodeCli } from "../src/index";

const root = resolve(import.meta.dirname, "../../..");
const cli = resolve(root, "apps/cli/dist/tokenloom.js");
const sampleSnapshot = resolve(root, "samples/button/snapshot.json");

const temp = (): string => mkdtempSync(join(tmpdir(), "tokenloom-mcp-a01-"));

/** A plugin export is the sample Snapshot with embedded render data in place of the render path. */
function writeExport(dir: string): string {
  const snap = JSON.parse(readFileSync(sampleSnapshot, "utf8")) as {
    componentSets: { components: { renderPng?: string; renderPngBase64?: string }[] }[];
  };
  for (const set of snap.componentSets) {
    for (const component of set.components) {
      delete component.renderPng;
      component.renderPngBase64 = Buffer.from(`png-for-${set.components.indexOf(component)}`).toString("base64");
    }
  }
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "checkout.json");
  writeFileSync(path, JSON.stringify(snap));
  return path;
}

/** The MCP surface as a host reaches it: one tool call answered by the built CLI in the given directory. */
const mcp = (cwd: string) => (name: string, args: Record<string, unknown>) =>
  callTool(nodeCli(cli, cwd), name, args);

/**
 * contentHash covers the whole component set and `snapshot import` records a renderPng path that direct
 * input never emits, so it is the one documented exclusion carried over from the CLI route.
 */
const strip = (s: string): string => s.replace(/"contentHash": "sha256:[0-9a-f]+"/g, '"contentHash": "<hash>"');

describe("A01: the MCP route answers a plugin export the same as the imported Snapshot", () => {
  const dir = temp();
  const exportPath = writeExport(dir);
  const imported = join(dir, "sample");
  const importResult = spawnSync(process.execPath, [cli, "snapshot", "import", exportPath, "--into", imported], {
    cwd: root, encoding: "utf8",
  });
  const snapshotPath = join(imported, "snapshot.json");
  const call = mcp(root);

  it("import of the generated export succeeds, so both sides of the comparison are real", () => {
    expect(importResult.status).toBe(0);
  });

  it.each([
    { name: "canonical context", args: { component: "Button" } },
    { name: "agent context with annotations", args: { component: "Button", view: "agent", annotations: true } },
    { name: "discovery", args: { view: "agent" } },
    { name: "filtered discovery", args: { view: "agent", match: "But" } },
    { name: "empty discovery", args: { view: "agent", match: "no-such-set" } },
    { name: "exact variant selection", args: { component: "Button", variant: "variant=primary,size=md" } },
  ])("design_context $name matches apart from contentHash", ({ args }) => {
    const direct = call("design_context", { ...args, from: exportPath });
    const viaImport = call("design_context", { ...args, from: snapshotPath });

    expect({ isError: direct.isError, text: strip(direct.content[0]?.text ?? "") })
      .toEqual({ isError: viaImport.isError, text: strip(viaImport.content[0]?.text ?? "") });
  });

  it("the compared canonical context really is a component payload, not a shared error", () => {
    const res = call("design_context", { component: "Button", from: exportPath });

    const payload = JSON.parse(res.content[0]?.text ?? "") as { component?: { name?: string } };

    expect({ isError: res.isError, name: payload.component?.name })
      .toEqual({ isError: undefined, name: "Button" });
  });

  it("the compared variant selection really returns that one variant, not a rejected selector", () => {
    const res = call("design_context", { component: "Button", variant: "variant=primary,size=md", from: exportPath });
    const payload = JSON.parse(res.content[0]?.text ?? "") as { component: { base: { props: unknown }; variants: unknown[] } };

    expect({ isError: res.isError, props: payload.component.base.props, variants: payload.component.variants })
      .toEqual({ isError: undefined, props: { size: "md", variant: "primary" }, variants: [] });
  });

  it("the compared empty discovery really is empty, so the equality above is not vacuous", () => {
    const res = call("design_context", { view: "agent", match: "no-such-set", from: exportPath });

    expect(JSON.parse(res.content[0]?.text ?? "") as { count: number; components: unknown[] })
      .toMatchObject({ count: 0, components: [] });
  });

  /** Every emitted file, keyed by its path relative to the output directory. */
  function tokenTree(from: string, tag: string): Record<string, string> {
    const out = join(dir, `tokens-${tag}`);
    expect(call("tokens", { from, out, platform: "css,swift,kotlin" }).isError).toBe(undefined);
    const walk = (base: string, prefix: string): [string, string][] =>
      readdirSync(join(out, base), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) =>
        e.isDirectory()
          ? walk(join(base, e.name), `${prefix}${e.name}/`)
          : [[`${prefix}${e.name}`, readFileSync(join(out, base, e.name), "utf8")] as [string, string]],
      );
    return Object.fromEntries(walk(".", ""));
  }

  it("the tokens tool emits an identical file list and contents for direct and imported input", () => {
    const direct = tokenTree(exportPath, "direct");
    const viaImport = tokenTree(snapshotPath, "import");

    expect(direct).toEqual(viaImport);
  });

  it("a directly loaded export leaves no render file beside it", () => {
    const only = temp();
    const path = writeExport(only);

    call("design_context", { component: "Button", from: path });

    expect(readdirSync(only)).toEqual(["checkout.json"]);
  });
});

describe("A05: MCP resolves an absolute input the same from an unrelated working directory", () => {
  const dir = temp();
  const exportPath = writeExport(dir);
  const unrelated = mkdtempSync(join(tmpdir(), "tokenloom-mcp-cwd-"));

  it.each([
    { name: "canonical context", args: { component: "Button" } },
    { name: "agent discovery", args: { view: "agent" } },
  ])("design_context $name is identical from the repository and from an unrelated directory", ({ args }) => {
    const fromRepo = mcp(root)("design_context", { ...args, from: exportPath });
    const fromElsewhere = mcp(unrelated)("design_context", { ...args, from: exportPath });

    expect({ isError: fromRepo.isError, text: fromRepo.content[0]?.text })
      .toEqual({ isError: fromElsewhere.isError, text: fromElsewhere.content[0]?.text });
  });

  it("the payload answered from an unrelated directory names neither directory", () => {
    const text = mcp(unrelated)("design_context", { component: "Button", view: "agent", from: exportPath })
      .content[0]?.text ?? "";

    expect({ names_input_dir: text.includes(dir), names_cwd: text.includes(unrelated) })
      .toEqual({ names_input_dir: false, names_cwd: false });
  });

  it("a relative input follows the calling directory rather than a fixed one", () => {
    const fromOwnDir = mcp(dir)("design_context", { component: "Button", from: "checkout.json" });
    const fromElsewhere = mcp(unrelated)("design_context", { component: "Button", from: "checkout.json" });

    expect({ ownDir: fromOwnDir.isError, elsewhere: fromElsewhere.isError })
      .toEqual({ ownDir: undefined, elsewhere: true });
  });
});
