import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createClaudeSessionAdapter, createCliToolPort, createMcpToolPort, createSessionPort, loadTrajectoryMatrix,
  promptHash, realRun, TOOL_PREFIX, type ChildOutput, type ChildRunWithStdin, type TrajectoryTurn,
} from "../src/index";

const repoRoot = resolve(import.meta.dirname, "../../..");
const matrix = loadTrajectoryMatrix(resolve(repoRoot, "eval/trajectory.yaml"));
const BUTTON = "from=samples/button/snapshot.json";

/**
 * The suite sets TOKENLOOM_NO_SPAWN so no test can reach `claude`. These cases spawn the repository's own
 * CLI and MCP server, which is the only way to prove the stdio transport, so they lift the guard around
 * one call and restore it immediately.
 */
async function withSpawn<T>(body: () => Promise<T>): Promise<T> {
  const saved = process.env.TOKENLOOM_NO_SPAWN;
  delete process.env.TOKENLOOM_NO_SPAWN;
  try {
    return await body();
  } finally {
    process.env.TOKENLOOM_NO_SPAWN = saved;
  }
}

function recorder(stdout: string): { run: ChildRunWithStdin; calls: string[][] } {
  const calls: string[][] = [];
  const run: ChildRunWithStdin = (cmd, args) => {
    calls.push([cmd, ...args]);
    return Promise.resolve<ChildOutput>({ code: 0, stdout, stderr: "" });
  };
  return { run, calls };
}

const rpcRun = (stdout: string, code = 0): ChildRunWithStdin =>
  () => Promise.resolve({ code, stdout, stderr: "" });

const turn = (prompt: string, text: string): TrajectoryTurn => ({
  index: 0, toolCall: null,
  prompt,
  result: { text, model: "fake", ms: 0, invocation: "fake", inputTokens: 0, cacheCreation: 0, cacheRead: 0, outputTokens: 0, costUsd: 0 },
});

describe("child boundary", () => {
  it("passes stdin to the child and returns complete stdout and stderr", async () => {
    const script = "process.stdin.on('data', (c) => { process.stdout.write(c); process.stderr.write('diag'); });";

    const res = await withSpawn(() => realRun(process.execPath, ["-e", script], repoRoot, "hello"));

    expect(res).toEqual({ code: 0, stdout: "hello", stderr: "diag" });
  });

  it("decodes a multibyte character split across stdout chunks", async () => {
    const script = "const b=Buffer.from('한');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.end(b.subarray(1)),20);";

    const res = await withSpawn(() => realRun(process.execPath, ["-e", script], repoRoot));

    expect(res).toEqual({ code: 0, stdout: "한", stderr: "" });
  });

  it("still refuses to spawn while TOKENLOOM_NO_SPAWN is set", async () => {
    await expect(realRun("claude", ["--version"], repoRoot)).rejects.toThrow("spawn refused");
  });
});

describe("session port turn composition", () => {
  it("reads the last TOOL line and names the CLI command for a CLI condition", () => {
    const port = createSessionPort("cli-agent", matrix.tasks, matrix.prompt);

    expect(port.parseToolRequest(`prose\n${TOOL_PREFIX}component=Chip variant=size=md\n`))
      .toEqual({ tool: "context", args: ["component=Chip", "variant=size=md"] });
  });

  it("names the MCP tool for the mcp-agent condition", () => {
    const port = createSessionPort("mcp-agent", matrix.tasks, matrix.prompt);

    expect(port.parseToolRequest(`${TOOL_PREFIX}component=Button`)?.tool).toBe("design_context");
  });

  it.each(["TOOL", "TOOL   "])("treats an empty %j request as component-set discovery", (request) => {
    const port = createSessionPort("cli-canonical", matrix.tasks, matrix.prompt);

    expect(port.parseToolRequest(request)).toEqual({ tool: "context", args: [] });
  });

  it("returns null when the model emitted no query line", () => {
    const port = createSessionPort("cli-canonical", matrix.tasks, matrix.prompt);

    expect(port.parseToolRequest("```css\n.a{}\n```")).toBeNull();
  });

  it("carries the whole transcript and the tool output into the next prompt", () => {
    const port = createSessionPort("cli-agent", matrix.tasks, matrix.prompt);
    const opening = port.openingPrompt("known-component");

    const next = port.followUpPrompt([turn(opening, `${TOOL_PREFIX}component=Button`)], "{\"component\":{}}");

    expect(next.startsWith(opening)).toBe(true);
    expect(next).toContain(`${TOOL_PREFIX}component=Button`);
    expect(next).toContain("<tool-output>\n{\"component\":{}}\n</tool-output>");
  });

  it("completes only when both fenced blocks are present", () => {
    const port = createSessionPort("cli-agent", matrix.tasks, matrix.prompt);

    expect(port.isComplete([turn("p", "```css\n.a{}\n```")])).toBe(false);
    expect(port.isComplete([turn("p", "```css\n.a{}\n```\n```html\n<b></b>\n```")])).toBe(true);
  });

  it("does not complete when prose merely names both fence markers", () => {
    const port = createSessionPort("cli-agent", matrix.tasks, matrix.prompt);

    expect(port.isComplete([turn("p", "Expected output: ```css and ```html")])).toBe(false);
  });

  it("does not complete when a third fenced block is present", () => {
    const port = createSessionPort("cli-agent", matrix.tasks, matrix.prompt);
    const text = "```css\n.a{}\n```\n```html\n<b></b>\n```\n```text\nextra\n```";

    expect(port.isComplete([turn("p", text)])).toBe(false);
  });

  it.each([
    "prose\n```css\n.a{}\n```\n```html\n<b></b>\n```",
    "```html\n<b></b>\n```\n```css\n.a{}\n```",
  ])("does not complete when the fenced output violates the exact response contract", (text) => {
    const port = createSessionPort("cli-agent", matrix.tasks, matrix.prompt);

    expect(port.isComplete([turn("p", text)])).toBe(false);
  });

  it("uses one shared prompt hash across all conditions", () => {
    const hashes = matrix.conditions.map((condition) =>
      promptHash(createSessionPort(condition, matrix.tasks, matrix.prompt).template));

    expect(hashes).toEqual([hashes[0], hashes[0], hashes[0]]);
  });

  it("changes the shared prompt hash when any condition view changes", () => {
    const original = createSessionPort("cli-agent", matrix.tasks, matrix.prompt);
    const changed = createSessionPort("cli-agent", matrix.tasks, {
      ...matrix.prompt, views: { ...matrix.prompt.views, "mcp-agent": "changed MCP view" },
    });

    expect(promptHash(changed.template)).not.toBe(promptHash(original.template));
  });
});

describe("claude session adapter", () => {
  it("puts the harness dollar ceiling on every provider call as --max-budget-usd", async () => {
    const { run, calls } = recorder(JSON.stringify({ result: "ok", total_cost_usd: 0.5, usage: {} }));

    await createClaudeSessionAdapter(0.25, run).run("prompt", { sampleName: "button", model: "opus", repoRoot });

    expect(calls[0]?.slice(-2)).toEqual(["--max-budget-usd", "0.2500"]);
    expect(calls[0]).toContain("--restricted");
  });

  it("rounds the provider ceiling down to the supported precision", async () => {
    const { run, calls } = recorder(JSON.stringify({ result: "ok", total_cost_usd: 0.05, usage: {} }));

    await createClaudeSessionAdapter(0.07496, run).run("prompt", { sampleName: "button", model: "opus", repoRoot });

    expect(calls[0]?.slice(-2)).toEqual(["--max-budget-usd", "0.0749"]);
  });

  it("records the command shape that includes the per-call budget", async () => {
    const { run } = recorder(JSON.stringify({ result: "ok", total_cost_usd: 0.5, usage: {} }));

    const res = await createClaudeSessionAdapter(0.25, run).run("p", { sampleName: "button", model: "opus", repoRoot });

    expect(res.invocation).toBe("claude -p --output-format json --restricted --model <id> --max-budget-usd <bound>");
    expect(res.costUsd).toBe(0.5);
  });

  it("marks an authoritative response with an omitted usage category incomparable", async () => {
    const { run } = recorder(JSON.stringify({
      result: "ok", total_cost_usd: 0.5,
      usage: { input_tokens: 1, cache_creation_input_tokens: 2, output_tokens: 3 },
    }));

    const res = await createClaudeSessionAdapter(0.25, run).run("p", { sampleName: "button", model: "opus", repoRoot });

    expect(res).toMatchObject({ inputTokens: 1, cacheCreation: 2, cacheRead: 0, outputTokens: 3,
      costUsd: 0.5, error: "MISSING_AUTHORITATIVE_USAGE" });
  });

  it.each([
    {
      name: "negative token usage", body: { total_cost_usd: 0.5,
        usage: { input_tokens: -100, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 } },
      expected: { inputTokens: 0, cacheCreation: 2, cacheRead: 3, outputTokens: 4,
        costUsd: 0.5, error: "MISSING_AUTHORITATIVE_USAGE" },
    },
    {
      name: "negative cost", body: { total_cost_usd: -1,
        usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 } },
      expected: { inputTokens: 1, cacheCreation: 2, cacheRead: 3, outputTokens: 4, costUsd: null },
    },
  ])("treats $name as absent provider data", async ({ body, expected }) => {
    const { run } = recorder(JSON.stringify({ result: "ok", ...body }));

    const res = await createClaudeSessionAdapter(0.25, run).run("p", { sampleName: "button", model: "opus", repoRoot });

    expect(res).toMatchObject(expected);
  });
});

describe("tool ports", () => {
  it("runs the built CLI with the component as a positional argument", async () => {
    const { run, calls } = recorder("{}");

    await createCliToolPort(repoRoot, run).call({ tool: "context", args: ["component=Button", BUTTON, "view=agent"], stdin: null });

    expect(calls[0]?.slice(-4))
      .toEqual(["Button", "--from=samples/button/snapshot.json", "--view=agent", "--json"]);
  });

  it("returns the agent design context from the built CLI", async () => {
    const port = createCliToolPort(repoRoot);

    const res = await withSpawn(() => port.call({ tool: "context", args: ["component=Button", BUTTON, "view=agent"], stdin: null }));

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.content)).toHaveProperty("component.block", "button");
  });

  it("reaches design_context over stdio JSON-RPC against the real MCP server", async () => {
    const port = createMcpToolPort(repoRoot);

    const res = await withSpawn(() => port.call({ tool: "design_context", args: ["component=Button", BUTTON, "view=agent"], stdin: null }));

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.content)).toHaveProperty("component.block", "button");
  });

  it("reports a structured Agent error from the MCP server as a failed call", async () => {
    const port = createMcpToolPort(repoRoot);
    const args = ["component=Buttons", BUTTON, "view=agent"];

    const res = await withSpawn(() => port.call({ tool: "design_context", args, stdin: null }));

    expect(res.exitCode).not.toBe(0);
    expect(JSON.parse(res.content)).toHaveProperty("error.code", "COMPONENT_NOT_FOUND");
  });

  it.each([
    {
      name: "fails a JSON-RPC error reply",
      stdout: JSON.stringify({ jsonrpc: "2.0", id: 2, error: { code: -32603, message: "failed" } }), code: 0,
      expected: { content: JSON.stringify({ code: -32603, message: "failed" }), stderr: "", exitCode: 1 },
    },
    {
      name: "fails an error reply that also carries a result",
      stdout: JSON.stringify({
        jsonrpc: "2.0", id: 2, result: { content: [{ text: "ok" }] }, error: { code: -32603 },
      }), code: 0,
      expected: { content: JSON.stringify({ code: -32603 }), stderr: "", exitCode: 1 },
    },
    {
      name: "fails a result without a content array",
      stdout: JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} }), code: 0,
      expected: { content: "", stderr: "", exitCode: 1 },
    },
    {
      name: "fails when the call reply is missing",
      stdout: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), code: 0,
      expected: { content: "", stderr: "", exitCode: 1 },
    },
    {
      name: "preserves a nonzero child status with a parsed result",
      stdout: JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ text: "ok" }] } }), code: 7,
      expected: { content: "ok", stderr: "", exitCode: 7 },
    },
  ])("$name", async ({ stdout, code, expected }) => {
    const port = createMcpToolPort(repoRoot, rpcRun(stdout, code));

    const res = await port.call({ tool: "design_context", args: [], stdin: null });

    expect(res).toEqual(expected);
  });
});
