import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const cli = resolve(root, "apps/cli/dist/tokenloom.js");
const snapshot = "samples/button/snapshot.json";
const run = (command: string, args: string[]) => spawnSync(process.execPath, [cli, command, ...args], {
  cwd: root, encoding: "utf8",
});

describe("design context CLI reference output (black box)", () => {
  it("context emits the existing annotated compact reference bytes", () => {
    const result = run("context", ["Button", "--from", snapshot, "--annotations", "--json"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(readFileSync(resolve(root, "samples/button/reference/context.compact.json"), "utf8"));
  });

  it("context --view agent emits the reviewed Agent reference bytes", () => {
    const result = run("context", ["Button", "--from", snapshot, "--annotations", "--json", "--view", "agent"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(readFileSync(resolve(root, "samples/button/reference/context.agent.json"), "utf8"));
  });

  it.each([
    { name: "compact", args: ["Button", "--from", snapshot], status: 0 },
    { name: "full", args: ["Button", "--from", snapshot, "--level", "full"], status: 0 },
    { name: "annotations", args: ["Button", "--from", snapshot, "--annotations", "--json"], status: 0 },
    { name: "strict warnings", args: ["Button", "--from", "samples/mutations/M01.json", "--strict"], status: 2 },
    { name: "missing component", args: ["Missing", "--from", snapshot], status: 1 },
    { name: "missing component name", args: [], status: 1 },
    { name: "ambiguous component", args: ["Button", "--from", "samples/mutations/M06.json"], status: 1 },
    { name: "selected node", args: ["Button", "--from", "samples/mutations/M06.json", "--node", "12:34"], status: 0 },
    { name: "empty component set", args: ["Button", "--from", "samples/mutations/M11.json"], status: 1 },
    { name: "missing source", args: ["Button"], status: 1 },
    { name: "unknown level", args: ["Button", "--from", snapshot, "--level", "invalid"], status: 1 },
    { name: "unknown view", args: ["Button", "--from", snapshot, "--view", "invalid"], status: 1 },
    { name: "view without a value", args: ["Button", "--from", snapshot, "--view", "--json"], status: 1 },
    { name: "agent discovery", args: ["--from", snapshot, "--view", "agent", "--json"], status: 0 },
    { name: "match with a component name", args: ["Button", "--from", snapshot, "--match", "But", "--view", "agent"], status: 1 },
    { name: "match without a value", args: ["--from", snapshot, "--view", "agent", "--match", "--json"], status: 1 },
    { name: "variant without a value", args: ["Button", "--from", snapshot, "--variant", "--json"], status: 1 },
  ])("$name preserves the documented output and exit status", ({ args, status }) => {
    const result = run("context", args);
    expect(result.status).toBe(status);
  });

  it("help documents the context command", () => {
    const result = run("context", ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("context <componentName>");
  });

  it("--help without a command succeeds and writes the versioned help header to stdout", () => {
    const result = run("--help", []);

    expect({ status: result.status, header: /^tokenloom v\d+\.\d+\.\d+/.test(result.stdout.split("\n")[0] ?? "") })
      .toEqual({ status: 0, header: true });
  });

  it("A11: CLI help advertises only the path-neutral option set", () => {
    const topLevel = run("--help", []);
    const context = run("context", ["--help"]);
    const options = [...new Set(topLevel.stdout.match(/--[a-z][a-z-]*/g) ?? [])].sort();
    const contextShape = [
      "  context <componentName> [--node <id>] --from <a.json[,b.json]> [--level compact|full]",
      "          [--view canonical|agent] [--variant=<key=value,...>] [--annotations] [--json] [--strict]",
      "  context --from <a.json[,b.json]> --view agent [--match <text>]",
    ];

    expect({
      statuses: [topLevel.status, context.status],
      sameUsage: context.stdout === topLevel.stdout,
      documentsContextShape: contextShape.every((line) => topLevel.stdout.includes(line)),
      options,
    }).toEqual({
      statuses: [0, 0],
      sameUsage: true,
      documentsContextShape: true,
      options: [
        "--against", "--annotations", "--budget-usd", "--dry-run", "--expect-exporter", "--file",
        "--file-key", "--from", "--help", "--input", "--into", "--json", "--level", "--match", "--matrix",
        "--node", "--only", "--out", "--parallel", "--plan", "--platform", "--project", "--sets",
        "--since", "--strict", "--update", "--variant", "--version", "--view",
      ],
    });
  });

  it("the -h flag and the help command print the same stdout help as --help", () => {
    const long = run("--help", []);
    const short = run("-h", []);
    const positional = run("help", []);

    expect({
      short: { status: short.status, sameAsLong: short.stdout === long.stdout, stderr: short.stderr },
      positional: { status: positional.status, sameAsLong: positional.stdout === long.stdout, stderr: positional.stderr },
    }).toEqual({
      short: { status: 0, sameAsLong: true, stderr: "" },
      positional: { status: 0, sameAsLong: true, stderr: "" },
    });
  });

  it("--version and -v print the packaged CLI version on stdout", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "apps/cli/package.json"), "utf8")) as { version: string };
    const long = run("--version", []);
    const short = run("-v", []);

    expect({
      long: { status: long.status, stdout: long.stdout, stderr: long.stderr },
      short: { status: short.status, stdout: short.stdout, stderr: short.stderr },
    }).toEqual({
      long: { status: 0, stdout: `${manifest.version}\n`, stderr: "" },
      short: { status: 0, stdout: `${manifest.version}\n`, stderr: "" },
    });
  });

  it("a bare invocation prints the help on stderr and exits 1", () => {
    const bare = spawnSync(process.execPath, [cli], { cwd: root, encoding: "utf8" });
    const help = run("--help", []);

    expect({ status: bare.status, stdout: bare.stdout, stderrIsHelp: bare.stderr === help.stdout })
      .toEqual({ status: 1, stdout: "", stderrIsHelp: true });
  });

  it("A11: Agent output keeps delta paths in RFC 6901 spelling", () => {
    const result = run("context", [
      "Chip", "--from", "samples/twenty-variants/snapshot.json", "--annotations", "--json", "--view", "agent",
    ]);
    const payload = JSON.parse(result.stdout) as {
      component: { variants: { delta?: { path: string }[] }[] };
    };
    const paths = payload.component.variants.flatMap((variant) => variant.delta?.map((delta) => delta.path) ?? []);

    expect({ status: result.status, paths: [...new Set(paths)].sort() })
      .toEqual({ status: 0, paths: ["/layout/gap", "/style/bg"] });
  });
});
