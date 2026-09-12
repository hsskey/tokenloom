// Advertise only the two generator-facing commands so the combined schema stays inside the 800-token budget.

/** Tool input schemas use the supported JSON Schema draft-07 subset. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export const TOOLS: ToolDef[] = [
  {
    name: "design_context",
    description: "Design context for one component set, as JSON. Feed this to a code generator instead of raw Figma.",
    inputSchema: {
      type: "object",
      properties: {
        component: { type: "string", description: "Component set name. Omit with view agent to list the sets" },
        from: { type: "string", description: "Snapshot path, e.g. samples/button/snapshot.json" },
        node: { type: "string", description: "Node id, required only when the name is ambiguous" },
        level: { type: "string", description: "compact drops bbox and defaults", enum: ["compact", "full"] },
        view: { type: "string", description: "agent drops top-level version and source", enum: ["canonical", "agent"] },
        variant: { type: "string", description: "Exact variant selector, e.g. size=md,state=hover" },
        match: { type: "string", description: "Filter the listed sets by name" },
        annotations: { type: "boolean", description: "Include design annotations" },
      },
      required: ["from"],
    },
  },
  {
    name: "tokens",
    description: "Build design tokens from a snapshot. Writes DTCG JSON plus the chosen platform files.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Snapshot path" },
        out: { type: "string", description: "Output directory" },
        platform: { type: "string", description: "Comma separated: css, swift, kotlin" },
      },
      required: ["from", "out"],
    },
  },
];

/**
 * Serialized schema size feeds the token estimate checked against the 800-token budget.
 */
export function schemaBytes(tools: ToolDef[] = TOOLS): number {
  return Buffer.byteLength(JSON.stringify(tools), "utf8");
}

/** Map docs/reference/spec.md section 4.9 arguments to CLI argv, rejecting unknown keys. */
export function toArgv(name: string, args: Record<string, unknown>): { argv: string[] } | { error: string } {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) return { error: `unknown tool ${name}` };
  const unknown = Object.keys(args).filter((k) => tool.inputSchema.properties[k] === undefined);
  if (unknown.length > 0) return { error: `unknown argument ${unknown.sort().join(",")}` };
  const missing = (tool.inputSchema.required ?? []).filter((k) => args[k] === undefined);
  if (missing.length > 0) return { error: `missing argument ${missing.join(",")}` };

  const flag = (key: string): string[] => {
    const value = args[key];
    if (value === undefined || value === false) return [];
    return value === true ? [`--${key}`] : [`--${key}=${String(value)}`];
  };
  if (tool.name === "design_context") {
    const component = args.component === undefined ? undefined : String(args.component);
    const options = [...flag("from"), ...flag("node"), ...flag("level"), ...flag("view"),
      ...flag("variant"), ...flag("match"), ...flag("annotations"), "--json"];
    if (component?.startsWith("--") === true) return { argv: ["context", ...options, "--", component] };
    return { argv: ["context", ...(component === undefined ? [] : [component]), ...options] };
  }
  return { argv: ["tokens", "build", ...flag("from"), ...flag("out"), ...flag("platform"), "--json"] };
}
