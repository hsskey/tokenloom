import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { TOOLS, callTool, nodeCli, toArgv, type CliRun, type RunCli } from "../src/index";

const repoRoot = resolve(import.meta.dirname, "../../..");
const CLI = resolve(repoRoot, "apps/cli/dist/tokenloom.js");

/** Record outgoing arguments without spawning the CLI. */
function fake(result: Partial<CliRun> = {}): { run: RunCli; calls: string[][] } {
  const calls: string[][] = [];
  const run: RunCli = (argv) => {
    calls.push(argv);
    return { status: 0, stdout: "{}", stderr: "", ...result };
  };
  return { run, calls };
}

function snapshotWithOptionLikeName(): string {
  const directory = mkdtempSync(join(tmpdir(), "tl-mcp-name-"));
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }); });
  const snapshot = JSON.parse(readFileSync(resolve(repoRoot, "samples/button/snapshot.json"), "utf8")) as {
    componentSets: { name: string }[];
  };
  const set = snapshot.componentSets[0];
  if (set === undefined) throw new Error("button fixture must contain a component set");
  set.name = "--Button";
  const path = join(directory, "snapshot.json");
  writeFileSync(path, JSON.stringify(snapshot));
  return path;
}

function snapshotWithOptionLikeSelector(): string {
  const directory = mkdtempSync(join(tmpdir(), "tl-mcp-selector-"));
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }); });
  const snapshot = JSON.parse(readFileSync(resolve(repoRoot, "samples/button/snapshot.json"), "utf8")) as {
    componentSets: { props: Record<string, string[]>; components: { props: Record<string, string> }[] }[];
  };
  const set = snapshot.componentSets[0];
  if (set === undefined || set.components.length < 2) throw new Error("button fixture must contain two components");
  set.props = { "--kind": ["base", "x"] };
  set.components.forEach((component, index) => { component.props = { "--kind": index === 0 ? "base" : "x" }; });
  const path = join(directory, "snapshot.json");
  writeFileSync(path, JSON.stringify(snapshot));
  return path;
}

function snapshotsWithDuplicateIdentity(): [string, string] {
  const directory = mkdtempSync(join(tmpdir(), "tl-mcp-duplicate-id-"));
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }); });
  const snapshot = JSON.parse(readFileSync(resolve(repoRoot, "samples/button/snapshot.json"), "utf8")) as {
    componentSets: { components: unknown[] }[];
  };
  const full = snapshot.componentSets[0];
  if (full === undefined || full.components.length < 2) throw new Error("button fixture must contain two components");
  const short = structuredClone(full);
  short.components = short.components.slice(0, 1);
  const paths = [join(directory, "forward.json"), join(directory, "reversed.json")] as const;
  writeFileSync(paths[0], JSON.stringify({ ...snapshot, componentSets: [full, short] }));
  writeFileSync(paths[1], JSON.stringify({ ...snapshot, componentSets: [short, full] }));
  return [...paths];
}

function snapshotWithMixedLookupIdentities(): string {
  const directory = mkdtempSync(join(tmpdir(), "tl-mcp-mixed-id-"));
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }); });
  const snapshot = JSON.parse(readFileSync(resolve(repoRoot, "samples/button/snapshot.json"), "utf8")) as {
    componentSets: { id: string; components: unknown[] }[];
  };
  const buttonX = snapshot.componentSets[0];
  if (buttonX === undefined || buttonX.components.length < 2) {
    throw new Error("button fixture must contain two components");
  }
  const duplicateX = structuredClone(buttonX);
  duplicateX.components = duplicateX.components.slice(0, 1);
  const buttonY = structuredClone(buttonX);
  buttonY.id = "12:99";
  const path = join(directory, "snapshot.json");
  writeFileSync(path, JSON.stringify({ ...snapshot, componentSets: [buttonX, duplicateX, buttonY] }));
  return path;
}

function snapshotWithSharedIdAcrossNames(): string {
  const directory = mkdtempSync(join(tmpdir(), "tl-mcp-shared-id-"));
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }); });
  const snapshot = JSON.parse(readFileSync(resolve(repoRoot, "samples/button/snapshot.json"), "utf8")) as {
    componentSets: { id: string; name: string; components: unknown[] }[];
  };
  const buttonX = snapshot.componentSets[0];
  if (buttonX === undefined) throw new Error("button fixture must contain a component set");
  const buttonY = structuredClone(buttonX);
  buttonY.id = "12:99";
  const cardX = structuredClone(buttonX);
  cardX.name = "Card";
  const path = join(directory, "snapshot.json");
  writeFileSync(path, JSON.stringify({ ...snapshot, componentSets: [buttonX, buttonY, cardX] }));
  return path;
}

// The two-tool count and the 800-token budget are the A09 contract and live in mcp.rules.test.ts.
describe("MCP tool schemas", () => {
  it("design context requires only from, so an omitted component reaches the CLI", () => {
    expect(TOOLS.map((t) => t.inputSchema.required)).toEqual([["from"], ["from", "out"]]);
  });

  it("design context offers the selective disclosure arguments", () => {
    expect(Object.keys(TOOLS[0]?.inputSchema.properties ?? {}).sort())
      .toEqual(["annotations", "component", "from", "level", "match", "node", "variant", "view"]);
  });
});

describe("MCP arguments to CLI argv (docs/reference/spec.md section 4.9)", () => {
  it("design_context maps to the canonical context command", () => {
    expect(toArgv("design_context", {
      component: "Button", from: "f.json", annotations: true, level: "full", node: "12:34", view: "agent",
    })).toEqual({
      argv: [
        "context", "Button", "--from=f.json", "--node=12:34", "--level=full", "--view=agent", "--annotations", "--json",
      ],
    });
  });

  // P6 A04/A05: the view argument is forwarded verbatim; the CLI owns the projection and its validation.
  it.each([
    { view: "agent", expected: "--view=agent" },
    { view: "canonical", expected: "--view=canonical" },
    { view: "typo", expected: "--view=typo" },
  ])("design_context forwards view $view to the CLI unchanged", ({ view, expected }) => {
    expect(toArgv("design_context", { component: "Button", from: "f.json", view })).toEqual({
      argv: ["context", "Button", "--from=f.json", expected, "--json"],
    });
  });

  it("an omitted view sends no --view, so the CLI keeps its canonical default", () => {
    expect(toArgv("design_context", { component: "Button", from: "f.json", level: "full" }))
      .toEqual({ argv: ["context", "Button", "--from=f.json", "--level=full", "--json"] });
  });

  it("an option-like component follows the separator after every option", () => {
    expect(toArgv("design_context", {
      component: "--Button", from: "f.json", view: "agent", variant: "size=md", annotations: true,
    })).toEqual({
      argv: ["context", "--from=f.json", "--view=agent", "--variant=size=md", "--annotations", "--json", "--", "--Button"],
    });
  });

  // T705: the component becomes optional and variant/match are forwarded; the CLI owns discovery and selection.
  it("an omitted component sends no positional argument at all", () => {
    expect(toArgv("design_context", { from: "f.json", view: "agent" }))
      .toEqual({ argv: ["context", "--from=f.json", "--view=agent", "--json"] });
  });

  it("an omitted component with a match filter forwards only the filter", () => {
    expect(toArgv("design_context", { from: "f.json", view: "agent", match: "but" }))
      .toEqual({ argv: ["context", "--from=f.json", "--view=agent", "--match=but", "--json"] });
  });

  // The CLI decides that a name plus --match is a usage error, so the adapter must not filter or drop either one.
  it("a component and a match are both forwarded rather than resolved here", () => {
    expect(toArgv("design_context", { component: "Button", from: "f.json", match: "but" }))
      .toEqual({ argv: ["context", "Button", "--from=f.json", "--match=but", "--json"] });
  });

  it.each([
    { variant: "size=md,state=hover", label: "an ordinary selector" },
    { variant: "{}", label: "the empty-property selector" },
    { variant: "tone%2C%3D=%20a%25%20", label: "escaped delimiters and spaces" },
    { variant: "high=%uD800", label: "an isolated surrogate" },
    { variant: "--kind=x", label: "a leading option-like key" },
    { variant: "size", label: "a malformed selector" },
  ])("design_context attaches $label without changing its bytes", ({ variant }) => {
    expect(toArgv("design_context", { component: "Button", from: "f.json", variant }))
      .toEqual({ argv: ["context", "Button", "--from=f.json", `--variant=${variant}`, "--json"] });
  });

  it("the full argument set keeps one fixed argv order", () => {
    expect(toArgv("design_context", {
      component: "Button", from: "f.json", node: "12:34", level: "full",
      view: "agent", variant: "size=md", match: "but", annotations: true,
    })).toEqual({
      argv: ["context", "Button", "--from=f.json", "--node=12:34", "--level=full",
        "--view=agent", "--variant=size=md", "--match=but", "--annotations", "--json"],
    });
  });

  it("variant and match belong to design_context only", () => {
    expect(toArgv("tokens", { from: "f.json", out: "/tmp/o", variant: "size=md" }))
      .toEqual({ error: "unknown argument variant" });
    expect(toArgv("tokens", { from: "f.json", out: "/tmp/o", match: "but" }))
      .toEqual({ error: "unknown argument match" });
  });

  it("view belongs to design_context only and stays optional", () => {
    expect(toArgv("tokens", { from: "f.json", out: "/tmp/o", view: "agent" }))
      .toEqual({ error: "unknown argument view" });
    expect(TOOLS[0]?.inputSchema.required).toEqual(["from"]);
  });

  it("false boolean flags are omitted", () => {
    expect(toArgv("design_context", { component: "B", from: "f.json", annotations: false }))
      .toEqual({ argv: ["context", "B", "--from=f.json", "--json"] });
  });

  it("tokens maps to tokens build", () => {
    expect(toArgv("tokens", { from: "f.json", out: "/tmp/o", platform: "css,swift" }))
      .toEqual({ argv: ["tokens", "build", "--from=f.json", "--out=/tmp/o", "--platform=css,swift", "--json"] });
  });

  it("missing and unknown arguments return errors", () => {
    expect(toArgv("design_context", { component: "Button" })).toEqual({ error: "missing argument from" });
    expect(toArgv("tokens", { from: "f.json" })).toEqual({ error: "missing argument out" });
    expect(toArgv("tokens", { from: "f.json", out: "/tmp/o", strict: true })).toEqual({ error: "unknown argument strict" });
    expect(toArgv("doctor", {})).toEqual({ error: "unknown tool doctor" });
  });
});

describe("MCP tool calls", () => {
  it("successful commands return stdout unchanged", () => {
    const { run, calls } = fake({ stdout: '{"version":1}' });
    expect(callTool(run, "design_context", { component: "Button", from: "f.json" }))
      .toEqual({ content: [{ type: "text", text: '{"version":1}' }] });
    expect(calls).toEqual([["context", "Button", "--from=f.json", "--json"]]);
  });

  it("failed commands return stderr with isError", () => {
    const { run } = fake({ status: 1, stdout: "", stderr: "tokenloom: no components\n" });
    expect(callTool(run, "design_context", { component: "Nope", from: "f.json" }))
      .toEqual({ content: [{ type: "text", text: "tokenloom: no components" }], isError: true });
  });

  it("a failing tokens call preserves stderr when the CLI also emits JSON", () => {
    const { run } = fake({ status: 1, stdout: '{"warnings":[]}', stderr: "tokens build: ALIAS_CYCLE\n" });

    expect(callTool(run, "tokens", { from: "f.json", out: "/tmp/o" }))
      .toEqual({ content: [{ type: "text", text: "tokens build: ALIAS_CYCLE" }], isError: true });
  });

  it("invalid arguments never invoke the CLI", () => {
    const { run, calls } = fake();
    expect(callTool(run, "design_context", { component: "Button" }).isError).toBe(true);
    expect(calls).toEqual([]);
  });

  // T704 writes the structured Agent error to stdout and exits 1, so returning stderr would drop the payload.
  it("a failing Agent JSON command returns its stdout error payload", () => {
    const payload = JSON.stringify({
      error: { code: "VARIANT_NOT_FOUND", detail: 'no variant matches "size=nope"', available: ["size=md"] },
      next: ["context --variant=<selector> --from <snapshot> --view agent --json -- <name>"],
    });
    const { run } = fake({ status: 1, stdout: payload, stderr: "unexpected diagnostic\n" });

    expect(callTool(run, "design_context", { component: "Button", from: "f.json", variant: "size=nope", view: "agent" }))
      .toEqual({ content: [{ type: "text", text: payload }], isError: true });
  });

  it("a normal Agent context on failed stdout does not replace the stderr diagnostic", () => {
    const context = JSON.stringify({ component: { name: "Button" }, warnings: [] });
    const { run } = fake({ status: 1, stdout: context, stderr: "tokenloom: ledger is unwritable\n" });

    expect(callTool(run, "design_context", { component: "Button", from: "f.json", view: "agent" }))
      .toEqual({ content: [{ type: "text", text: "tokenloom: ledger is unwritable" }], isError: true });
  });

  it("a canonical failure with an empty stdout still reports its stderr diagnostic", () => {
    const { run } = fake({ status: 1, stdout: "", stderr: "tokenloom: context: unknown variant\n" });

    expect(callTool(run, "design_context", { component: "Button", from: "f.json", variant: "size=nope" }))
      .toEqual({ content: [{ type: "text", text: "tokenloom: context: unknown variant" }], isError: true });
  });

  it("an explicit canonical view produces byte-identical output to omitting it", () => {
    const run = nodeCli(CLI, repoRoot);
    const args = { component: "Button", from: "samples/button/snapshot.json" };
    const omitted = callTool(run, "design_context", args);
    const explicit = callTool(run, "design_context", { ...args, view: "canonical" });
    expect(explicit.isError).toBe(undefined);
    expect(explicit.content[0]?.text).toBe(omitted.content[0]?.text);
  });

  it("the built CLI returns button design context through the canonical tool", () => {
    const run = nodeCli(CLI, repoRoot);
    const res = callTool(run, "design_context", { component: "Button", from: "samples/button/snapshot.json" });
    expect(res.isError).toBe(undefined);
    const context = JSON.parse(res.content[0]?.text ?? "{}") as { version: number; tokensUsed: string[] };
    expect(context.version).toBe(1);
    expect(context.tokensUsed).toHaveLength(11);
  });

  it("a failed run-ledger write returns its diagnostic instead of completed Agent context", () => {
    const directory = mkdtempSync(join(tmpdir(), "tl-mcp-ledger-"));
    onTestFinished(() => { rmSync(directory, { recursive: true, force: true }); });
    const blocked = join(directory, "blocked");
    writeFileSync(blocked, "not a directory");
    const run: RunCli = (argv) => {
      const result = spawnSync(process.execPath, [CLI, ...argv], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, TOKENLOOM_RUNS_DIR: join(blocked, "runs") },
      });
      return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    };
    const args = {
      component: "Button", from: "samples/button/snapshot.json", view: "agent",
    };
    const mapped = toArgv("design_context", args);
    if ("error" in mapped) throw new Error(mapped.error);
    const direct = run(mapped.argv);
    const context = JSON.parse(direct.stdout) as { component: { name: string } };

    expect({
      direct: { status: direct.status, name: context.component.name, ledgerFailure: direct.stderr.includes("ENOTDIR") },
      response: callTool(run, "design_context", args),
    }).toEqual({
      direct: { status: 1, name: "Button", ledgerFailure: true },
      response: { content: [{ type: "text", text: direct.stderr.trim() }], isError: true },
    });
  });
});

describe("MCP Agent view against the built CLI", () => {
  const button = { component: "Button", from: "samples/button/snapshot.json", annotations: true };

  it("A02/A03: the agent view drops only top-level version and source", () => {
    const run = nodeCli(CLI, repoRoot);
    const canonicalCall = callTool(run, "design_context", button);
    const agentCall = callTool(run, "design_context", { ...button, view: "agent" });
    expect(agentCall.isError).toBe(undefined);
    const canonical = JSON.parse(canonicalCall.content[0]?.text ?? "{}") as Record<string, unknown>;
    const agent = JSON.parse(agentCall.content[0]?.text ?? "{}") as Record<string, unknown>;
    expect(Object.keys(canonical)).toEqual(["annotations", "component", "source", "tokensUsed", "version", "warnings"]);
    expect(Object.keys(agent)).toEqual(["annotations", "component", "tokensUsed", "warnings"]);
    for (const key of ["annotations", "component", "tokensUsed", "warnings"]) {
      expect(agent[key]).toEqual(canonical[key]);
    }
  });

  it("the agent view is byte-identical to the reviewed button reference", () => {
    const run = nodeCli(CLI, repoRoot);
    const res = callTool(run, "design_context", { ...button, view: "agent" });
    expect(res.content[0]?.text)
      .toBe(readFileSync(resolve(repoRoot, "samples/button/reference/context.agent.json"), "utf8"));
  });

  it("an unrecognized view is a CLI usage error, never silently ignored output", () => {
    const run = nodeCli(CLI, repoRoot);
    expect(callTool(run, "design_context", { ...button, view: "compact" }))
      .toEqual({ content: [{ type: "text", text: "tokenloom: context: unknown view compact" }], isError: true });
  });
});

/**
 * T705 acceptance against the built CLI: the public tool must reach real discovery, real Variant
 * selection and the real Agent error payload without the adapter interpreting any of them.
 */
describe("MCP tokens failures against the built CLI", () => {
  it("returns the M09 fatal diagnostic instead of its JSON warning payload", () => {
    const run = nodeCli(CLI, repoRoot);
    const args = {
      from: "samples/mutations/M09.json",
      out: mkdtempSync(join(tmpdir(), "tl-mcp-m09-")),
    };
    const mapped = toArgv("tokens", args);
    if ("error" in mapped) throw new Error(mapped.error);
    const direct = run(mapped.argv);

    const response = callTool(run, "tokens", args);

    expect(response).toEqual({
      content: [{ type: "text", text: direct.stderr.trim() }],
      isError: true,
    });
    expect({
      status: direct.status,
      warnings: (JSON.parse(direct.stdout) as { warnings: { code: string }[] }).warnings.map((warning) => warning.code),
      diagnostic: direct.stderr.includes("tokens build: ALIAS_CYCLE"),
    }).toEqual({ status: 1, warnings: ["ALIAS_CYCLE", "ALIAS_CYCLE"], diagnostic: true });
  });
});

describe("MCP selective disclosure against the built CLI", () => {
  const button = { from: "samples/button/snapshot.json", view: "agent" };
  const chips = { component: "Chip", from: "samples/twenty-variants/snapshot.json", view: "agent" };

  it("an omitted component returns the bounded discovery payload", () => {
    const res = callTool(nodeCli(CLI, repoRoot), "design_context", button);

    expect(res.isError).toBe(undefined);
    const discovery = JSON.parse(res.content[0]?.text ?? "{}") as {
      components: { name: string }[]; count: number; returned: number; truncated: boolean; next: string[];
    };
    expect(discovery.components.map((item) => item.name)).toEqual(["Button"]);
    expect([discovery.count, discovery.returned, discovery.truncated]).toEqual([1, 1, false]);
    expect(discovery.next).toEqual(["context --from <snapshot> --view agent --json -- <name>"]);
  });

  it("an option-like discovered name round-trips through the real CLI tool boundary", () => {
    const from = snapshotWithOptionLikeName();
    const run = nodeCli(CLI, repoRoot);
    const discoveryResponse = callTool(run, "design_context", { from, view: "agent" });
    const discovery = JSON.parse(discoveryResponse.content[0]?.text ?? "{}") as {
      components: { name: string }[];
    };
    const component = discovery.components[0]?.name;
    if (component === undefined) throw new Error("discovery did not return the component name");

    const response = callTool(run, "design_context", { component, from, view: "agent" });

    expect({
      discovered: component,
      response: {
        isError: response.isError,
        name: (JSON.parse(response.content[0]?.text ?? "{}") as { component: { name: string } }).component.name,
      },
    }).toEqual({ discovered: "--Button", response: { isError: undefined, name: "--Button" } });
  });

  it("name and node resolve uniquely when another name shares the node id", () => {
    const from = snapshotWithSharedIdAcrossNames();
    const run = nodeCli(CLI, repoRoot);
    const discoveryResponse = callTool(run, "design_context", { from, view: "agent" });
    const discovery = JSON.parse(discoveryResponse.content[0]?.text ?? "{}") as {
      components: { id?: string; name: string; variants: number }[];
    };
    const unresolved = callTool(run, "design_context", { component: "Button", from, view: "agent" });
    const collision = JSON.parse(unresolved.content[0]?.text ?? "{}") as {
      error: { candidates: string[]; code: string; detail: string }; next: string[];
    };
    const selected = ["12:34", "12:99"].map((node) => {
      const response = callTool(run, "design_context", { component: "Button", from, node, view: "agent" });
      const context = JSON.parse(response.content[0]?.text ?? "{}") as { component: { name: string } };
      return { node, isError: response.isError, name: context.component.name };
    });
    const direct = run(["context", "Button", `--from=${from}`, "--node=12:34", "--json"]);

    expect({
      discovery: discovery.components,
      unresolved: { isError: unresolved.isError, collision },
      selected,
      direct: { status: direct.status, name: (JSON.parse(direct.stdout) as { component: { name: string } }).component.name },
    }).toEqual({
      discovery: [
        { id: "12:34", name: "Button", variants: 1 },
        { id: "12:99", name: "Button", variants: 1 },
        { name: "Card", variants: 1 },
      ],
      unresolved: {
        isError: true,
        collision: {
          error: {
            candidates: ["12:34", "12:99"],
            code: "NAME_COLLISION",
            detail: '"Button" matches 2 component sets',
          },
          next: ["context --node=<id> --from <snapshot> --view agent --json -- <name>"],
        },
      },
      selected: [
        { node: "12:34", isError: undefined, name: "Button" },
        { node: "12:99", isError: undefined, name: "Button" },
      ],
      direct: { status: 0, name: "Button" },
    });
  });

  it("mixed lookup identities advertise the uniquely resolvable node through built CLI and MCP", () => {
    const from = snapshotWithMixedLookupIdentities();
    const run = nodeCli(CLI, repoRoot);
    const discoveryResponse = callTool(run, "design_context", { from, view: "agent" });
    const discovery = JSON.parse(discoveryResponse.content[0]?.text ?? "{}") as {
      components: { id: string; name: string; variants: number }[];
    };
    const unresolved = callTool(run, "design_context", { component: "Button", from, view: "agent" });
    const selected = callTool(run, "design_context", {
      component: "Button", from, node: "12:99", view: "agent",
    });
    const duplicate = callTool(run, "design_context", {
      component: "Button", from, node: "12:34", view: "agent",
    });
    const direct = run(["context", "Button", `--from=${from}`, "--json"]);

    expect({
      discovery: discovery.components,
      unresolved: { isError: unresolved.isError, body: JSON.parse(unresolved.content[0]?.text ?? "{}") },
      selected: {
        isError: selected.isError,
        name: (JSON.parse(selected.content[0]?.text ?? "{}") as { component: { name: string } }).component.name,
      },
      duplicate: { isError: duplicate.isError, body: JSON.parse(duplicate.content[0]?.text ?? "{}") },
      direct: { status: direct.status, stdout: direct.stdout, stderr: direct.stderr },
    }).toEqual({
      discovery: [
        { id: "12:34", name: "Button", variants: 0 },
        { id: "12:34", name: "Button", variants: 1 },
        { id: "12:99", name: "Button", variants: 1 },
      ],
      unresolved: {
        isError: true,
        body: {
          error: {
            candidates: ["12:34", "12:34", "12:99"],
            code: "NAME_COLLISION",
            detail: '"Button" matches 3 component sets',
          },
          next: ["context --node=<id> --from <snapshot> --view agent --json -- <name>"],
        },
      },
      selected: { isError: undefined, name: "Button" },
      duplicate: {
        isError: true,
        body: {
          error: {
            candidates: ["12:34", "12:34"],
            code: "NAME_COLLISION",
            detail: '"Button" matches 2 component sets with duplicate node id "12:34"; use a corrected snapshot',
          },
          next: ["context --from <snapshot> --view agent --json"],
        },
      },
      direct: {
        status: 1,
        stdout: "",
        stderr: 'context: NAME_COLLISION "Button" matches 12:34, 12:34, 12:99; use --node <id>\n',
      },
    });
  });

  it("duplicate lookup identities fail consistently through built CLI and MCP in both orders", () => {
    const run = nodeCli(CLI, repoRoot);
    const outcomes = snapshotsWithDuplicateIdentity().map((from) => {
      const discoveryResponse = callTool(run, "design_context", { from, view: "agent" });
      const discovery = JSON.parse(discoveryResponse.content[0]?.text ?? "{}") as {
        components: { id: string; name: string; variants: number }[];
      };
      const agentResponse = callTool(run, "design_context", {
        component: "Button", from, node: "12:34", view: "agent",
      });
      const agent = JSON.parse(agentResponse.content[0]?.text ?? "{}") as Record<string, unknown>;
      const direct = run(["context", "Button", `--from=${from}`, "--node=12:34", "--json"]);
      return {
        discovery: discovery.components,
        agent: { isError: agentResponse.isError, body: agent },
        direct: { status: direct.status, stdout: direct.stdout, stderr: direct.stderr },
      };
    });
    const failure = {
      error: {
        candidates: ["12:34", "12:34"],
        code: "NAME_COLLISION",
        detail: '"Button" matches 2 component sets with duplicate node id "12:34"; use a corrected snapshot',
      },
      next: ["context --from <snapshot> --view agent --json"],
    };
    const expected = {
      discovery: [
        { id: "12:34", name: "Button", variants: 0 },
        { id: "12:34", name: "Button", variants: 1 },
      ],
      agent: { isError: true, body: failure },
      direct: {
        status: 1,
        stdout: "",
        stderr: "context: NAME_COLLISION \"Button\" matches 2 component sets "
          + "with duplicate node id \"12:34\"; use a corrected snapshot\n",
      },
    };

    expect(outcomes).toEqual([expected, expected]);
  });

  it("a match with no result is an ordinary success carrying count zero", () => {
    const res = callTool(nodeCli(CLI, repoRoot), "design_context", { ...button, match: "definitely-no-match" });

    expect(res.isError).toBe(undefined);
    const discovery = JSON.parse(res.content[0]?.text ?? "{}") as { count: number; returned: number; components: unknown[] };
    expect([discovery.count, discovery.returned, discovery.components]).toEqual([0, 0, []]);
  });

  it("a selected Variant returns base plus that Variant only", () => {
    const res = callTool(nodeCli(CLI, repoRoot), "design_context", { ...chips, variant: "size=xs,state=hover" });

    expect(res.isError).toBe(undefined);
    const context = JSON.parse(res.content[0]?.text ?? "{}") as {
      component: { variants: { props: Record<string, string> }[] };
    };
    expect(context.component.variants.map((variant) => variant.props)).toEqual([{ size: "xs", state: "hover" }]);
  });

  it("an option-like selector is advertised with the attached retry syntax", () => {
    const res = callTool(nodeCli(CLI, repoRoot), "design_context", {
      component: "Button", from: snapshotWithOptionLikeSelector(), view: "agent", variant: "--kind=missing",
    });
    const failure = JSON.parse(res.content[0]?.text ?? "{}") as {
      error: { available: string[]; code: string; detail: string }; next: string[];
    };

    expect({ isError: res.isError, failure }).toEqual({
      isError: true,
      failure: {
        error: {
          available: ["--kind=base", "--kind=x"],
          code: "VARIANT_NOT_FOUND",
          detail: 'no variant matches "--kind=missing"',
        },
        next: ["context --variant=<selector> --from <snapshot> --view agent --json -- <name>"],
      },
    });
  });

  it("the MCP carries an advertised option-like selector through the built CLI", () => {
    const from = snapshotWithOptionLikeSelector();
    const run = nodeCli(CLI, repoRoot);
    const failed = callTool(run, "design_context", {
      component: "Button", from, view: "agent", variant: "--kind=missing",
    });
    const failure = JSON.parse(failed.content[0]?.text ?? "{}") as { error: { available: string[] } };
    const available = failure.error.available;
    const selector = available[1] as string;
    const separated = run(["context", "Button", `--from=${from}`, "--view=agent", "--variant", selector, "--json"]);
    const mapped = toArgv("design_context", { component: "Button", from, view: "agent", variant: selector });
    const response = callTool(run, "design_context", { component: "Button", from, view: "agent", variant: selector });
    const context = JSON.parse(response.content[0]?.text ?? "{}") as {
      component: { variants: { props: Record<string, string> }[] };
    };

    expect({
      separated: { status: separated.status, stdout: separated.stdout, stderr: separated.stderr },
      mapped: "error" in mapped ? mapped : mapped.argv.slice(-3),
      response: { isError: response.isError, variants: context.component.variants.map((variant) => variant.props) },
    }).toEqual({
      separated: { status: 1, stdout: "", stderr: "tokenloom: unknown option --kind\n" },
      mapped: ["--view=agent", "--variant=--kind=x", "--json"],
      response: { isError: undefined, variants: [{ "--kind": "x" }] },
    });
  });

  it("a selected Variant is smaller than the same context without a selector", () => {
    const run = nodeCli(CLI, repoRoot);
    const full = callTool(run, "design_context", chips).content[0]?.text ?? "";
    const selected = callTool(run, "design_context", { ...chips, variant: "size=xs,state=hover" }).content[0]?.text ?? "";

    expect(selected.length).toBeLessThan(full.length);
  });

  // The M13 payload only survives because a failing agent command writes JSON to stdout, not stderr.
  it("an unmatched Variant returns the structured error payload with isError", () => {
    const res = callTool(nodeCli(CLI, repoRoot), "design_context", {
      component: "Button", ...button, variant: "size=does-not-exist",
    });

    expect(res.isError).toBe(true);
    const failure = JSON.parse(res.content[0]?.text ?? "{}") as { error: { code: string; available: string[] } };
    expect(failure.error.code).toBe("VARIANT_NOT_FOUND");
    expect(failure.error.available).toEqual(["size=md,variant=primary", "size=md,variant=secondary"]);
  });

  // A04 through the public tool: the selective arguments exist, and the default answer is still the reference.
  it("omitting the selector leaves the canonical Button reference bytes unchanged", () => {
    const run = nodeCli(CLI, repoRoot);
    const canonical = callTool(run, "design_context", { component: "Button", from: button.from, annotations: true });

    expect(canonical.isError).toBe(undefined);
    expect(canonical.content[0]?.text)
      .toBe(readFileSync(resolve(repoRoot, "samples/button/reference/context.compact.json"), "utf8"));
  });
});
