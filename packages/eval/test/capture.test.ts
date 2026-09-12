import { describe, expect, it } from "vitest";
import {
  CAPTURE_MAX_TURNS, CAPTURE_MCP_CONFIG, CAPTURE_MODEL, CAPTURE_PROMPT, captureArgs, capturePath, capturePrompt,
  captureCost, parseCaptureStream, preflightCapture, runCaptureStream,
} from "../src/capture";
import type { ChildRun } from "../src/child";

/** Test data shaped like real stream-json without spending the limited monthly MCP budget. */
const STREAM = [
  JSON.stringify({
    type: "system", subtype: "init",
    tools: ["mcp__figma__get_design_context", "mcp__figma__get_metadata", "mcp__figma__get_variable_defs"],
    mcp_servers: [{ name: "figma", version: "2026.8.1" }],
  }),
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "tu_1", name: "mcp__figma__get_design_context", input: { nodeId: "1:2" } }] },
  }),
  JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "{\"frame\":1}" }] }] },
  }),
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "tu_2", name: "mcp__figma__get_metadata" }] },
  }),
  JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "tu_2", content: "raw metadata" }] },
  }),
].join("\n");

describe("MCP capture stream (SPEC 9.3)", () => {
  it("preserves tool_result content verbatim", () => {
    const result = parseCaptureStream(STREAM);
    expect(result.toolResults).toHaveLength(2);
    expect(result.toolResults[0]?.name).toBe("mcp__figma__get_design_context");
    expect(result.toolResults[0]?.content).toEqual([{ type: "text", text: "{\"frame\":1}" }]);
    expect(result.toolResults[1]?.content).toBe("raw metadata");
  });

  it("stores tools/list with the server version", () => {
    const result = parseCaptureStream(STREAM);
    expect(result.toolsList).toHaveLength(3);
    expect(result.serverVersion).toBe("2026.8.1");
  });

  it("counts observed tool_use blocks", () => {
    expect(parseCaptureStream(STREAM).toolUseCount).toBe(2);
  });

  it("keeps the capture when one stream line is malformed", () => {
    const broken = `${STREAM}\n{not json\n`;
    expect(parseCaptureStream(broken).toolResults).toHaveLength(2);
  });

  it("charges the greater of the expected and observed tool calls", () => {
    expect(captureCost(parseCaptureStream(STREAM))).toBe(3);
    expect(captureCost({
      toolResults: [], toolsList: [], toolUseCount: 5, figmaToolUseCount: 5, serverVersion: null,
    })).toBe(5);
  });

  it("keeps completed tool calls and results after error_max_turns", () => {
    const capped = [
      STREAM,
      JSON.stringify({ type: "result", subtype: "error_max_turns", num_turns: CAPTURE_MAX_TURNS }),
    ].join("\n");
    const result = parseCaptureStream(capped);
    expect(result.toolResults).toHaveLength(2);
    expect(result.toolUseCount).toBe(2);
    // Completed calls remain charged to the ledger (SPEC 9.3).
    expect(captureCost(result)).toBe(3);
  });

  it("adds strict MCP config, ToolSearch, turn, and budget limits to the capture command", () => {
    expect(captureArgs("p", 0.5, "/repo/eval/mcp-figma.json")).toEqual([
      "-p", "p", "--output-format", "stream-json", "--verbose",
      // Exposes only the Figma server; the full local surface cost $0.82 for one setup turn.
      "--strict-mcp-config", "--mcp-config", "/repo/eval/mcp-figma.json",
      // Capture preserves tool results, so it uses the cheapest model independently of the experiment.
      "--model", "sonnet",
      // ToolSearch lets the child load deferred Figma schemas instead of stopping after the first turn.
      "--allowedTools", "mcp__figma__*", "ToolSearch", "--max-turns", "6", "--max-budget-usd", "0.5",
    ]);
    expect(CAPTURE_MCP_CONFIG).toBe("eval/mcp-figma.json");
    expect(CAPTURE_MODEL).toBe("sonnet");
  });

  it("uses the server version or capture date in the storage path", () => {
    expect(capturePath("2026.8.1", "2026-09-03", "12:34")).toBe("samples/captures/mcp/2026.8.1/12-34.json");
    expect(capturePath(null, "2026-09-03", "12:34")).toBe("samples/captures/mcp/2026-09-03/12-34.json");
  });

  it("asks the capture model to call all three tools once without transformation", () => {
    expect(CAPTURE_PROMPT).toContain("get_design_context");
    expect(CAPTURE_PROMPT).toContain("get_metadata");
    expect(CAPTURE_PROMPT).toContain("get_variable_defs");
    expect(CAPTURE_PROMPT).toContain("가공하지 말 것");
  });

  it("places fileKey and nodeId on separate prompt lines", () => {
    // All three tools require fileKey; a node ID alone cannot locate the node.
    const prompt = capturePrompt("FIXTUREKEY0000000000AB", "4185:3778");
    expect(prompt).toContain("\nfileKey: FIXTUREKEY0000000000AB");
    expect(prompt).toContain("\nnodeId: 4185:3778");
    // Include the URL form because tool descriptions explain how to extract both values from it.
    expect(prompt).toContain("https://figma.com/design/FIXTUREKEY0000000000AB?node-id=4185-3778");
    // Skill prerequisites are outside allowedTools and would only consume turns.
    expect(prompt).toContain("스킬이나 리소스를 먼저 읽지 말고");
    expect(prompt).toContain("get_design_context");
  });

  it("reports no results or Figma calls for a ToolSearch-only stream", () => {
    // Shape observed during the first capture after the ledger had reserved three calls.
    const toolSearchOnly = [
      JSON.stringify({ type: "system", subtype: "init", tools: ["ToolSearch"], mcp_servers: [] }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "tu_1", name: "ToolSearch", input: { query: "select:mcp__figma__get_metadata" } }] },
      }),
    ].join("\n");
    const result = parseCaptureStream(toolSearchOnly);
    expect(result.toolResults).toHaveLength(0);
    expect(result.toolUseCount).toBe(1);
    expect(result.figmaToolUseCount).toBe(0);
    expect(result.serverVersion).toBeNull();
  });

  it("charges only Figma calls because ToolSearch does not consume the monthly allowance", () => {
    // One ToolSearch plus three Figma calls yields four tool uses but only three billable calls.
    const mixed = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t0", name: "ToolSearch" }] },
      }),
      STREAM,
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "tu_3", name: "mcp__figma__get_variable_defs" }] },
      }),
    ].join("\n");
    const result = parseCaptureStream(mixed);
    expect(result.toolUseCount).toBe(4);
    expect(result.figmaToolUseCount).toBe(3);
    // Charging four would reduce twelve remaining calls from four captures to three.
    expect(captureCost(result)).toBe(3);
  });
});

describe("seven capture preflight conditions (SPEC 9.3)", () => {
  const REPO = "/repo";
  // The suite sets TOKENLOOM_NO_SPAWN, so testing conditions other than (g) injects a clean environment.
  const PASSING_PREFLIGHT = {
    args: captureArgs("p", 0.5, "/repo/eval/mcp-figma.json"),
    cwd: "/tmp/tl-capture-x",
    repoRoot: REPO,
    mcpConfig: { mcpServers: { figma: { type: "http", url: "https://mcp.figma.com/mcp" } } },
    env: {} as NodeJS.ProcessEnv,
  };

  it("passes when all seven conditions hold", () => {
    expect(preflightCapture(PASSING_PREFLIGHT)).toBeNull();
  });

  it("(a) rejects a working directory inside the repository", () => {
    // Repository instructions would otherwise enter the child system prompt.
    expect(preflightCapture({ ...PASSING_PREFLIGHT, cwd: REPO })).toBe("(a) neutral cwd outside the repo");
    expect(preflightCapture({ ...PASSING_PREFLIGHT, cwd: "/repo/packages/eval" })).toBe("(a) neutral cwd outside the repo");
  });

  it("(b) rejects missing strict MCP config or additional servers", () => {
    expect(preflightCapture({ ...PASSING_PREFLIGHT, args: PASSING_PREFLIGHT.args.filter((a) => a !== "--strict-mcp-config") }))
      .toBe("(b) --strict-mcp-config");
    expect(preflightCapture({ ...PASSING_PREFLIGHT, mcpConfig: { mcpServers: { figma: {}, tolaria: {} } } }))
      .toBe("(b) figma-only mcp config, got [figma, tolaria]");
  });

  it("(c) rejects tools other than Figma and tool search", () => {
    const widened = PASSING_PREFLIGHT.args.map((a) => (a === "ToolSearch" ? "Bash" : a));
    expect(preflightCapture({ ...PASSING_PREFLIGHT, args: widened })).toBe("(c) allowed tools, got [mcp__figma__*, Bash]");
  });

  it("(d) rejects a model other than the cheapest capture model", () => {
    const opus = PASSING_PREFLIGHT.args.map((a) => (a === CAPTURE_MODEL ? "opus" : a));
    expect(preflightCapture({ ...PASSING_PREFLIGHT, args: opus })).toBe(`(d) cheapest model ${CAPTURE_MODEL}`);
  });

  it("(e) rejects a different --max-turns value", () => {
    const loose = PASSING_PREFLIGHT.args.map((a) => (a === "6" ? "20" : a));
    expect(preflightCapture({ ...PASSING_PREFLIGHT, args: loose })).toBe(`(e) --max-turns ${CAPTURE_MAX_TURNS}`);
  });

  it("(f) rejects a missing or non-positive --max-budget-usd", () => {
    expect(preflightCapture({ ...PASSING_PREFLIGHT, args: captureArgs("p", 0, "/repo/eval/mcp-figma.json") }))
      .toBe("(f) --max-budget-usd");
  });

  it("(g) rejects TOKENLOOM_NO_SPAWN even when the other conditions hold", () => {
    expect(preflightCapture({ ...PASSING_PREFLIGHT, env: { TOKENLOOM_NO_SPAWN: "1" } }))
      .toBe("(g) TOKENLOOM_NO_SPAWN is set, no child will be spawned");
  });
});

describe("capture child-run injection (SPEC 9.3)", () => {
  /** Records child-run calls without creating a real claude process. */
  function recordingRun(stdout: string): { fn: ChildRun; calls: [string, string[], string][] } {
    const calls: [string, string[], string][] = [];
    return {
      calls,
      fn: (cmd, args, cwd) => {
        calls.push([cmd, args, cwd]);
        return Promise.resolve({ code: 0, stdout, stderr: "" });
      },
    };
  }

  // The guard lives in the real implementation, so an injected double still runs in this suite.
  it("returns the stream from the injected child runner unchanged", async () => {
    const run = recordingRun(STREAM);

    const result = await runCaptureStream(["-p", "x"], "/tmp/neutral", run.fn);

    expect(result).toEqual({ code: 0, stdout: STREAM, stderr: "" });
  });

  it("calls claude once with the exact capture command", async () => {
    const args = captureArgs(capturePrompt("FILEKEY", "1:2"), 0.5, "/repo/eval/mcp-figma.json");
    const run = recordingRun(STREAM);

    await runCaptureStream(args, "/tmp/neutral", run.fn);

    expect(run.calls).toEqual([["claude", args, "/tmp/neutral"]]);
  });
});
