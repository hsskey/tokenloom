import { describe, expect, it } from "vitest";
import { estimateTokens } from "@tokenloom/schema";
import { TOOLS, schemaBytes } from "../src/index";

describe("MCP surface rules from docs/reference/spec.md section 4.11", () => {
  it("A09: the public surface is exactly design_context and tokens", () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual(["design_context", "tokens"]);
  });

  it("A09: the combined schema estimate stays within the 800-token budget", () => {
    const tokens = estimateTokens(schemaBytes());

    expect(tokens).toBeLessThanOrEqual(800);
    // Descriptions must remain substantial enough to explain the arguments.
    expect(tokens).toBeGreaterThan(100);
  });

  it.each(TOOLS)("A09: $name describes its arguments and declares required properties", (tool) => {
    expect(tool.description.length).toBeGreaterThan(20);
    const required = tool.inputSchema.required ?? [];

    expect(required.length).toBeGreaterThan(0);
    expect(required.filter((key) => tool.inputSchema.properties[key] === undefined)).toEqual([]);
  });

  it("A11: tool schemas expose only path-neutral names and enum values", () => {
    const vocabulary = TOOLS.flatMap((tool) => [
      tool.name,
      ...Object.entries(tool.inputSchema.properties).flatMap(([name, property]) => [name, ...(property.enum ?? [])]),
    ]);

    expect(vocabulary).toEqual([
      "design_context",
      "component", "from", "node", "level", "compact", "full", "view", "canonical", "agent",
      "variant", "match", "annotations",
      "tokens",
      "from", "out", "platform",
    ]);
  });
});
