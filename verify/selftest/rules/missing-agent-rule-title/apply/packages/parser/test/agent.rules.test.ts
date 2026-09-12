import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot, stableStringify } from "@tokenloom/schema";
import type { DesignContextT } from "@tokenloom/schema";
import { buildDesignContext, projectAgentContext } from "../src/index";

const root = resolve(import.meta.dirname, "../../..");

function contextOf(sample: string): DesignContextT {
  const snapshot = Snapshot.parse(JSON.parse(readFileSync(resolve(root, sample), "utf8")));
  const result = buildDesignContext(snapshot, { name: "Button", annotations: true });
  if (!result.ok) throw new Error(`${sample} did not build a design context`);
  return result.context;
}

const BUTTON = "samples/button/snapshot.json";
const UNBOUND_COLOR = "samples/mutations/M01.json";

describe("Agent context rules from docs/reference/spec.md section 4.11", () => {
  it("the projection projectAgentContext leaves its input design context unchanged", () => {
    const context = contextOf(BUTTON);
    const before = stableStringify(context);

    projectAgentContext(context);

    expect(stableStringify(context)).toBe(before);
  });

  it("the projection the same design context always projects to the same bytes", () => {
    const first = stableStringify(projectAgentContext(contextOf(BUTTON)));

    const second = stableStringify(projectAgentContext(contextOf(BUTTON)));

    expect(second).toBe(first);
  });

  it("A02: the Agent context omits exactly the top-level version and source", () => {
    const context = contextOf(BUTTON);

    const agent = projectAgentContext(context);

    expect(Object.keys(agent).sort()).toEqual(["annotations", "component", "tokensUsed", "warnings"]);
  });

  it("A02: the component tree, node ids, props, base, variants, and deltas survive the projection", () => {
    const context = contextOf(BUTTON);

    const agent = projectAgentContext(context);

    expect(stableStringify(agent.component)).toBe(stableStringify(context.component));
  });

  it("A03: tokensUsed, annotations, and warnings keep their canonical values and order", () => {
    const context = contextOf(UNBOUND_COLOR);

    const agent = projectAgentContext(context);

    expect({ tokensUsed: agent.tokensUsed, annotations: agent.annotations, warnings: agent.warnings })
      .toEqual({ tokensUsed: context.tokensUsed, annotations: context.annotations, warnings: context.warnings });
  });
});
