import { describe, expect, it } from "vitest";
import {
  Delta,
  DesignContext,
  DesignNode,
  StyleValue,
  TokenRef,
  WarningCode,
} from "../src/design-context";

const leaf = {
  id: "1:2",
  role: "text" as const,
  name: "label",
  layout: { dir: "none" as const, sizing: { w: "hug" as const, h: "hug" as const } },
  style: { fg: "color.button.primary.fg" },
  children: [],
};

describe("design context schema", () => {
  it("accepts only lowercase dotted paths as TokenRef values", () => {
    expect(TokenRef.safeParse("color.button.primary.bg").success).toBe(true);
    expect(TokenRef.safeParse("typo.label.md").success).toBe(true);
    expect(TokenRef.safeParse("Color.Button").success).toBe(false);
    expect(TokenRef.safeParse("color").success).toBe(false);
  });

  it("accepts either a TokenRef or a raw: prefix as a StyleValue", () => {
    expect(StyleValue.safeParse("raw:#1a73e8").success).toBe(true);
    expect(StyleValue.safeParse("space.sm").success).toBe(true);
    expect(StyleValue.safeParse("#1a73e8").success).toBe(false);
  });

  it("recursively validates DesignNode children", () => {
    const parsed = DesignNode.parse({ ...leaf, role: "container", children: [leaf] });
    expect(parsed.children[0]?.id).toBe("1:2");
  });

  it("requires DesignNode.layout.pad to contain four values", () => {
    expect(DesignNode.safeParse({ ...leaf, layout: { ...leaf.layout, pad: [1, 2, 3] } }).success).toBe(false);
    expect(DesignNode.safeParse({ ...leaf, layout: { ...leaf.layout, pad: [1, 2, 3, 4] } }).success).toBe(true);
  });

  it("accepts only the ten documented WarningCode values", () => {
    expect(WarningCode.options).toHaveLength(10);
    expect(WarningCode.safeParse("UNBOUND_COLOR").success).toBe(true);
    expect(WarningCode.safeParse("MODE_COLLAPSED").success).toBe(true);
    expect(WarningCode.safeParse("SOMETHING_ELSE").success).toBe(false);
  });

  it("requires Delta values to contain a path and value", () => {
    expect(Delta.parse({ path: "/style/bg", value: "color.x.y" }).path).toBe("/style/bg");
  });

  it("accepts the smallest complete design context", () => {
    const context = DesignContext.parse({
      version: 1,
      source: { fileKey: "F", nodeId: "12:34", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z", contentHash: "sha256:PENDING" },
      component: {
        name: "Button",
        block: "button",
        props: { variant: ["primary"] },
        base: { props: { variant: "primary" }, root: { ...leaf, role: "container", children: [] } },
        variants: [],
      },
      tokensUsed: ["color.button.primary.fg"],
      annotations: [],
      warnings: [],
    });
    expect(context.component.block).toBe("button");
  });

  it("requires DesignContext.version to be the literal value 1", () => {
    const result = DesignContext.safeParse({ version: 2 });
    expect(result.success).toBe(false);
  });

});
