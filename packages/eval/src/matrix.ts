// packages/eval/src/matrix.ts
// SPEC 9.1 matrix. Values come only from YAML; the code defines no default matrix.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { capturePath } from "./capture";

export const InputSource = z.enum(["snapshot", "mcp"]);
export type InputSourceT = z.infer<typeof InputSource>;

/**
 * `agent` is the P6 Agent view of the annotated design context, so it differs from
 * `compact+annotations` only by the removed top-level `version` and `source`. Rows recorded before
 * P6 carry one of the first three values and keep decoding unchanged.
 */
export const InputVariant = z.enum(["raw", "compact", "compact+annotations", "agent"]);
export type InputVariantT = z.infer<typeof InputVariant>;

/**
 * Target for one MCP row. Captures exist only for real Figma nodes, so synthetic test data is invalid.
 * Replaces the sample-only `mcpSubset`; pairing `sampleName` with `node` verifies the captured sample-design
 * component set while loading the matrix.
 */
export const McpSet = z.object({ sampleName: z.string(), node: z.string() });
export type McpSetT = z.infer<typeof McpSet>;

export const Matrix = z.object({
  samples: z.array(z.string()).min(1),
  inputs: z.array(InputSource).min(1),
  inputVariants: z.array(InputVariant).min(1),
  platforms: z.array(z.literal("css")).min(1),
  repeats: z.number().int().positive(),
  maxInputTokens: z.number().int().positive(),
  /** Required beyond SPEC 9.1 so runs with different model IDs are not compared (SPEC 9.6). */
  model: z.string(),
  mcpSets: z.array(McpSet).default([]),
});
export type MatrixT = z.infer<typeof Matrix>;

const LegacyMcpSet = z.object({ fixture: z.string(), node: z.string() })
  .transform(({ fixture, node }) => ({ sampleName: fixture, node }));
const MatrixFile = z.union([
  Matrix,
  Matrix.omit({ samples: true, inputVariants: true, mcpSets: true }).extend({
    fixtures: z.array(z.string()).min(1),
    ir: z.array(InputVariant).min(1),
    mcpSets: z.array(z.union([McpSet, LegacyMcpSet])).default([]),
  }).transform(({ fixtures, ir, ...rest }): MatrixT => ({
    ...rest,
    samples: fixtures,
    inputVariants: ir,
  })),
]);

/** MCP rows have no evaluation input variant; use the recorded absence marker. */
export const NO_INPUT_VARIANT = "-";

interface ComboBase {
  sampleName: string;
  platform: "css";
  repeat: number;
}

export type Combination =
  /** Samples outside `mcpSets` measure only their first set and therefore have no `node`. */
  | (ComboBase & { input: "snapshot"; inputVariant: InputVariantT; node: string | undefined })
  /** MCP rows exist only for listed sets and therefore always have a `node`. */
  | (ComboBase & { input: "mcp"; inputVariant: typeof NO_INPUT_VARIANT; node: string });

const CAPTURES_DIR = "samples/captures/mcp";

/** All capture files for a node, one per server-version or date directory written by `eval capture`. */
export function captureFilesFor(repoRoot: string, node: string): string[] {
  const root = resolve(repoRoot, CAPTURES_DIR);
  if (!existsSync(root)) return [];
  return readdirSync(root).sort()
    // The second capturePath argument is a fallback used only when serverVersion is null.
    .map((version) => capturePath(version, version, node))
    .filter((rel) => existsSync(resolve(repoRoot, rel)));
}

/**
 * MCP rows require captured real-file component sets (SPEC 9.1). Invalid entries fail with their
 * names during loading so the report cannot claim an MCP measurement that never occurred.
 */
function checkMcpSets(matrix: MatrixT, repoRoot: string): void {
  if (matrix.inputs.includes("mcp") && matrix.mcpSets.length === 0) {
    throw new Error("matrix: inputs has mcp but mcpSets is empty");
  }
  for (const [index, entry] of matrix.mcpSets.entries()) {
    const at = `mcpSets[${index}] ${entry.sampleName} ${entry.node}`;
    const path = resolve(repoRoot, "samples", entry.sampleName, "snapshot.json");
    if (!existsSync(path)) throw new Error(`${at}: samples/${entry.sampleName}/snapshot.json not found`);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { componentSets?: { id?: string }[] };
    const ids = (parsed.componentSets ?? []).map((set) => set.id ?? "");
    if (!ids.includes(entry.node)) throw new Error(`${at}: not a componentSets[].id, have [${ids.join(", ")}]`);
    const files = captureFilesFor(repoRoot, entry.node);
    if (files.length !== 1) throw new Error(`${at}: expected 1 capture, found ${files.length} [${files.join(", ")}]`);
  }
}

export function loadMatrix(path: string, repoRoot: string): MatrixT {
  const matrix = MatrixFile.parse(parse(readFileSync(path, "utf8")));
  checkMcpSets(matrix, repoRoot);
  return matrix;
}

/** Expands combinations deterministically by sample, input source, set, input variant, and repeat. */
export function combinations(matrix: MatrixT): Combination[] {
  const out: Combination[] = [];
  for (const sampleName of matrix.samples) {
    const nodes = matrix.mcpSets.filter((set) => set.sampleName === sampleName).map((set) => set.node);
    for (const input of matrix.inputs) {
      if (input === "mcp") {
        // Unlisted samples have no MCP row because no capture can be added to the prompt.
        for (const node of nodes) {
          for (let repeat = 0; repeat < matrix.repeats; repeat += 1) {
            out.push({ sampleName, input, inputVariant: NO_INPUT_VARIANT, platform: "css", repeat, node });
          }
        }
        continue;
      }
      // Listed samples get one snapshot row per set to pair with each MCP row.
      for (const node of nodes.length === 0 ? [undefined] : nodes) {
        for (const inputVariant of matrix.inputVariants) {
          for (let repeat = 0; repeat < matrix.repeats; repeat += 1) {
            out.push({ sampleName, input, inputVariant, platform: "css", repeat, node });
          }
        }
      }
    }
  }
  return out;
}

/** Run-line `target`; unlisted samples use `<sampleName>/<inputVariant>` (SPEC 9.6). */
export function targetOf(combo: Combination): string {
  const tail = combo.input === "mcp" ? "mcp" : combo.inputVariant;
  return combo.node === undefined ? `${combo.sampleName}/${tail}` : `${combo.sampleName}/${combo.node}/${tail}`;
}
