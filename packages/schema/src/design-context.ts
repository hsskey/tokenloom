import { z } from "zod";

export const TokenRef = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/);
export const StyleValue = z.string().regex(/^([a-z][a-z0-9]*(\.[a-z0-9-]+)+|raw:.+)$/);

export interface DesignNodeT {
  id: string;
  role: "container" | "text" | "icon" | "image" | "instance" | "unknown";
  name: string;
  layout: {
    dir: "row" | "col" | "none";
    gap?: string | number;
    pad?: (string | number)[];
    align?: "start" | "center" | "end" | "between";
    crossAlign?: "start" | "center" | "end";
    sizing: { w: "hug" | "fill" | "fixed"; h: "hug" | "fill" | "fixed" };
    size?: { w?: number; h?: number };
  };
  style: Record<string, string>;
  text?: { content: string; typo?: string };
  icon?: { name: string };
  instanceOf?: string;
  children: DesignNodeT[];
  raw?: Record<string, unknown>;
}

export const DesignNode: z.ZodType<DesignNodeT> = z.lazy(() => z.object({
  id: z.string(),
  role: z.enum(["container", "text", "icon", "image", "instance", "unknown"]),
  name: z.string(),
  layout: z.object({
    dir: z.enum(["row", "col", "none"]),
    gap: z.union([TokenRef, z.number()]).optional(),
    pad: z.array(z.union([TokenRef, z.number()])).length(4).optional(),
    align: z.enum(["start", "center", "end", "between"]).optional(),
    crossAlign: z.enum(["start", "center", "end"]).optional(),
    sizing: z.object({ w: z.enum(["hug", "fill", "fixed"]), h: z.enum(["hug", "fill", "fixed"]) }),
    size: z.object({ w: z.number().optional(), h: z.number().optional() }).optional(),
  }),
  style: z.record(z.string(), StyleValue),
  text: z.object({ content: z.string(), typo: TokenRef.optional() }).optional(),
  icon: z.object({ name: z.string() }).optional(),
  instanceOf: z.string().optional(),
  children: z.array(DesignNode),
  raw: z.record(z.string(), z.unknown()).optional(),
}));

// Paths use RFC 6901 relative to component.base.root. A null value deletes the target.
export const Delta = z.object({ path: z.string(), value: z.unknown() });

export const WarningCode = z.enum([
  "UNBOUND_COLOR", "UNBOUND_DIMENSION", "UNBOUND_TYPO",
  "ABSOLUTE_POSITION", "UNKNOWN_NODE_TYPE", "NAME_COLLISION",
  "NON_ASCII_TOKEN_NAME", "VARIANT_STRUCTURE_DIFF", "ALIAS_CYCLE",
  "MODE_COLLAPSED",
]);

export const DesignContext = z.object({
  version: z.literal(1),
  source: z.object({
    fileKey: z.string(), nodeId: z.string(), fileVersion: z.string(),
    fetchedAt: z.string(),
    // Hash of the component-set subtree after stable JSON serialization.
    contentHash: z.string(),
  }),
  component: z.object({
    name: z.string(),
    block: z.string(),
    props: z.record(z.string(), z.array(z.string())),
    base: z.object({ props: z.record(z.string(), z.string()), root: DesignNode }),
    variants: z.array(z.object({
      props: z.record(z.string(), z.string()),
      delta: z.array(Delta).optional(),
      root: DesignNode.optional(),
    })),
  }),
  tokensUsed: z.array(TokenRef),
  annotations: z.array(z.object({
    nodeId: z.string(),
    kind: z.enum(["intent", "a11y", "behavior", "note"]),
    text: z.string(),
  })),
  warnings: z.array(z.object({ code: WarningCode, nodeId: z.string(), detail: z.string() })),
});

/** A warning shared by the parser and token builder. */
export const Warning = z.object({ code: WarningCode, nodeId: z.string(), detail: z.string() });
export type WarningT = z.infer<typeof Warning>;
export type WarningCodeT = z.infer<typeof WarningCode>;

export type DesignNodeType = z.infer<typeof DesignNode>;
export type DesignContextT = z.infer<typeof DesignContext>;
export type DeltaT = z.infer<typeof Delta>;
