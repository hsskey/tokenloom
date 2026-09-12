import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args";

const root = resolve(import.meta.dirname, "../../..");
const cli = resolve(root, "apps/cli/dist/tokenloom.js");

const commandCases = [
  {
    command: "capture",
    argv: ["eval", "capture", "--input=mcp", "--node=12:34", "--json"],
    expected: { positional: ["eval", "capture"], flags: { input: "mcp", node: "12:34", json: true }, unknownOptions: [] },
  },
  {
    command: "context",
    argv: ["context", "Button", "--from=snapshot.json", "--view=agent"],
    expected: { positional: ["context", "Button"], flags: { from: "snapshot.json", view: "agent" }, unknownOptions: [] },
  },
  {
    command: "doctor",
    argv: ["doctor", "--from=snapshot.json", "--strict"],
    expected: { positional: ["doctor"], flags: { from: "snapshot.json", strict: true }, unknownOptions: [] },
  },
  {
    command: "eval",
    argv: ["eval", "run", "--matrix=eval/matrix.yaml", "--dry-run"],
    expected: { positional: ["eval", "run"], flags: { matrix: "eval/matrix.yaml", "dry-run": true }, unknownOptions: [] },
  },
  {
    command: "snapshot",
    argv: ["snapshot", "import", "export.json", "--into=samples/new"],
    expected: { positional: ["snapshot", "import", "export.json"], flags: { into: "samples/new" }, unknownOptions: [] },
  },
  {
    command: "sync",
    argv: ["sync", "--file=abc", "--sets=Button"],
    expected: { positional: ["sync"], flags: { file: "abc", sets: "Button" }, unknownOptions: [] },
  },
  {
    command: "tokens",
    argv: ["tokens", "build", "--from=snapshot.json", "--out=dist"],
    expected: { positional: ["tokens", "build"], flags: { from: "snapshot.json", out: "dist" }, unknownOptions: [] },
  },
];

describe("shared CLI argument parsing", () => {
  it.each(commandCases)("preserves valid $command command arguments", ({ argv, expected }) => {
    expect(parseArgs(argv)).toEqual(expected);
  });

  it("treats every token after the separator as positional data", () => {
    expect(parseArgs(["context", "--from=snapshot.json", "--", "--Button", "--literal"])).toEqual({
      positional: ["context", "--Button", "--literal"],
      flags: { from: "snapshot.json" },
      unknownOptions: [],
    });
  });

  it("reports an unknown option before the separator through the command boundary", () => {
    const result = spawnSync(process.execPath, [cli, "context", "Button", "--unknown=value"], {
      cwd: root, encoding: "utf8",
    });

    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 1,
      stdout: "",
      stderr: "tokenloom: unknown option --unknown\n",
    });
  });

  it("a bare separator does not satisfy context's required component name", () => {
    const result = spawnSync(process.execPath, [cli, "context", "--"], { cwd: root, encoding: "utf8" });

    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 1,
      stdout: "",
      stderr: "tokenloom: context: <componentName> is required\n",
    });
  });

  it("catches omitted-separator and omitted-operand faults", () => {
    const invocations = [
      ["context", "--Button", "--from=samples/button/snapshot.json", "--view=agent", "--json"],
      ["context", "--"],
    ];
    const outcomes = invocations.map((argv) => spawnSync(process.execPath, [cli, ...argv], {
      cwd: root, encoding: "utf8",
    }));
    const caught = outcomes.filter((result) => result.status === 1).length;

    expect({ attempted: outcomes.length, caught, survived: outcomes.length - caught })
      .toEqual({ attempted: 2, caught: 2, survived: 0 });
  });
});
