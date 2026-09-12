import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const cli = resolve(root, "apps/cli/dist/tokenloom.js");
const button = "samples/button/snapshot.json";
const chips = "samples/twenty-variants/snapshot.json";

const run = (args: string[]) =>
  spawnSync(process.execPath, [cli, "context", ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-runs-")) },
  });

interface Context {
  component: { base: { props: Record<string, string> }; variants: { props: Record<string, string> }[] };
}

describe("component discovery and variant selection through the built CLI", () => {
  it.each([
    { name: "a component name together with --match", args: ["Button", "--from", button, "--match", "But", "--view", "agent"] },
    { name: "--match without a value", args: ["--from", button, "--view", "agent", "--match", "--json"] },
    { name: "--variant without a value", args: ["Button", "--from", button, "--view", "agent", "--variant", "--json"] },
    { name: "--variant without a component name", args: ["--from", button, "--view", "agent", "--variant", "size=md", "--json"] },
    { name: "--node without a component name", args: ["--from", button, "--view", "agent", "--node", "12:34", "--json"] },
    { name: "discovery without --from", args: ["--view", "agent", "--json"] },
    { name: "an omitted component name in the canonical view", args: ["--from", button, "--json"] },
  ])("$name is a usage error that writes no JSON", ({ args }) => {
    const result = run(args);

    expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 1, stdout: "" });
  });

  it("an omitted component name in the canonical view keeps its existing message", () => {
    const result = run(["--from", button, "--json"]);

    expect(result.stderr).toBe("tokenloom: context: <componentName> is required\n");
  });

  it("discovery does not need the redundant --json flag", () => {
    const withFlag = run(["--from", button, "--view", "agent", "--json"]);
    const withoutFlag = run(["--from", button, "--view", "agent"]);

    expect(withoutFlag.stdout).toBe(withFlag.stdout);
  });

  it("a named component still accepts --node for collision resolution", () => {
    const result = run(["Button", "--from", "samples/mutations/M06.json", "--node", "12:34", "--view", "agent", "--json"]);
    const context = JSON.parse(result.stdout) as { component: { name: string } };

    expect({ status: result.status, name: context.component.name }).toEqual({ status: 0, name: "Button" });
  });

  it("an exact selector keeps the base and the one requested variant", () => {
    const result = run(["Chip", "--from", chips, "--variant", "size=md,state=disabled", "--json"]);
    const context = JSON.parse(result.stdout) as Context;

    expect({ status: result.status, base: context.component.base.props, variants: context.component.variants.map((v) => v.props) })
      .toEqual({
        status: 0,
        base: { size: "xs", state: "default" },
        variants: [{ size: "md", state: "disabled" }],
      });
  });

  it("a selector that names the base returns the base alone", () => {
    const result = run(["Chip", "--from", chips, "--variant", "size=xs,state=default", "--json"]);
    const context = JSON.parse(result.stdout) as Context;

    expect({ base: context.component.base.props, variants: context.component.variants }).toEqual({
      base: { size: "xs", state: "default" },
      variants: [],
    });
  });

  it("a selected variant is smaller than the full canonical context", () => {
    const full = run(["Chip", "--from", chips, "--json"]).stdout.length;
    const selected = run(["Chip", "--from", chips, "--variant", "size=md,state=disabled", "--json"]).stdout.length;

    expect(selected < full).toBe(true);
  });

  it("the stderr summary counts the components actually written", () => {
    const result = run(["Chip", "--from", chips, "--variant", "size=md,state=disabled", "--json"]);

    expect(result.stderr).toBe("context: Chip 2 components, 0 warnings\n");
  });

  it("the canonical view keeps a variant failure on stderr and writes no JSON", () => {
    const result = run(["Chip", "--from", chips, "--variant", "size=does-not-exist", "--json"]);

    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 1,
      stdout: "",
      stderr: 'context: VARIANT_NOT_FOUND no variant matches "size=does-not-exist"\n',
    });
  });

  it("the canonical view keeps its existing collision message rather than JSON", () => {
    const result = run(["Button", "--from", "samples/mutations/M06.json", "--json"]);

    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 1,
      stdout: "",
      stderr: 'context: NAME_COLLISION "Button" matches 12:34, 12:99; use --node <id>\n',
    });
  });

  it("a missing component set in the Agent view answers with a structured code on stdout", () => {
    const result = run(["Missing", "--from", button, "--view", "agent", "--json"]);
    const payload = JSON.parse(result.stdout) as { error: { code: string }; next: string[] };

    expect({ status: result.status, code: payload.error.code, hasNext: payload.next.length > 0 })
      .toEqual({ status: 1, code: "COMPONENT_NOT_FOUND", hasNext: true });
  });

  it("an empty component set in the Agent view answers with a structured code on stdout", () => {
    const result = run(["Button", "--from", "samples/mutations/M11.json", "--view", "agent", "--json"]);
    const payload = JSON.parse(result.stdout) as { error: { code: string } };

    expect({ status: result.status, code: payload.error.code }).toEqual({ status: 1, code: "COMPONENT_SET_EMPTY" });
  });

  it("an unknown selector key answers with the keys the component actually declares", () => {
    const result = run(["Chip", "--from", chips, "--view", "agent", "--json", "--variant", "colour=red"]);
    const payload = JSON.parse(result.stdout) as { error: { code: string; keys: string[] } };

    expect({ status: result.status, code: payload.error.code, keys: payload.error.keys })
      .toEqual({ status: 1, code: "VARIANT_SELECTOR_INVALID", keys: ["size", "state"] });
  });

  it("a selector that matches several variants answers with the matching selectors", () => {
    const result = run(["Chip", "--from", chips, "--view", "agent", "--json", "--variant", "size=md"]);
    const payload = JSON.parse(result.stdout) as { error: { code: string; available: string[] } };

    expect({ status: result.status, code: payload.error.code, available: payload.error.available }).toEqual({
      status: 1,
      code: "VARIANT_AMBIGUOUS",
      available: [
        "size=md,state=default",
        "size=md,state=hover",
        "size=md,state=pressed",
        "size=md,state=selected",
        "size=md,state=disabled",
      ],
    });
  });

  it("a selector that is not key=value is rejected before any context is written", () => {
    const result = run(["Chip", "--from", chips, "--view", "agent", "--json", "--variant", "size"]);
    const payload = JSON.parse(result.stdout) as { error: { code: string } };

    expect({ status: result.status, code: payload.error.code }).toEqual({ status: 1, code: "VARIANT_SELECTOR_INVALID" });
  });
});
