import { resolve } from "node:path";
import type * as Parser from "@tokenloom/parser";
import { describe, expect, it, vi } from "vitest";
import { parseArgs } from "../src/args";

const { projectorReached } = vi.hoisted(() => ({ projectorReached: new Error("projector reached") }));

vi.mock("@tokenloom/parser", async (importOriginal) => {
  const actual = await importOriginal<typeof Parser>();
  return {
    ...actual,
    projectAgentContext: () => { throw projectorReached; },
  };
});

const { cmdContext } = await import("../src/cmd-context");

/** Resolved from this file so the test passes under both the workspace-filtered and root Vitest runs. */
const snapshot = resolve(import.meta.dirname, "../../../samples/button/snapshot.json");

describe("Agent projector delegation", () => {
  it("executes the parser projector for the CLI Agent view", () => {
    const parsed = parseArgs([
      "context", "Button", "--from", snapshot, "--annotations", "--view", "agent", "--json",
    ]);

    expect(() => cmdContext(parsed)).toThrow(projectorReached);
  });
});
