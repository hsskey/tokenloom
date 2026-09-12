// Reads and fills the SPEC 9.4 template verbatim. Text changes alter the prompt hash and prevent
// comparison with earlier runs (SPEC 9.6).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Snapshot, stableJsonFile, stableStringify, type SnapshotT } from "@tokenloom/schema";
import { buildDesignContext, projectAgentContext } from "@tokenloom/parser";
import { captureFilesFor, type InputVariantT } from "./matrix";

/** Resolves from the repository root because bundled CLI `import.meta.dirname` points to dist. */
export function templateText(repoRoot: string): string {
  return readFileSync(resolve(repoRoot, "packages/eval/prompts/css.md"), "utf8");
}

export function promptHash(template: string): string {
  return createHash("sha256").update(template, "utf8").digest("hex").slice(0, 12);
}

export interface PromptInput {
  block: string;
  context: string;
  sampleName: string;
  component: string;
}

/** Builds the four design-context variants; `raw` preserves component-set JSON (SPEC 9.1). */
export function buildPromptInput(repoRoot: string, sampleName: string, level: InputVariantT, node?: string): PromptInput {
  const snapshot = readSnapshot(repoRoot, sampleName);
  const set = setOf(snapshot, sampleName, node);
  if (level === "raw") {
    return { block: slugOf(set.name), context: stableStringify(set), sampleName, component: set.name };
  }
  // The agent view carries annotations because rule A03 keeps them identical to canonical, and
  // because the locked canonical reference it is compared against is itself annotated.
  const annotations = level === "compact+annotations" || level === "agent";
  const result = buildDesignContext(snapshot, { name: set.name, annotations });
  if (!result.ok) throw new Error(`${sampleName}: ${result.error.kind}`);
  const view = level === "agent" ? projectAgentContext(result.context) : result.context;
  return { block: result.context.component.block, context: stableJsonFile(view).trimEnd(), sampleName, component: set.name };
}

/**
 * MCP input preserves the captured response verbatim (SPEC 9.1) without converting it into design
 * context. `toolsList` describes server capabilities rather than node content, so it remains only
 * in the capture file for drift detection.
 */
export function buildMcpPromptInput(repoRoot: string, sampleName: string, node: string): PromptInput {
  const set = setOf(readSnapshot(repoRoot, sampleName), sampleName, node);
  const rel = captureFilesFor(repoRoot, node)[0];
  if (rel === undefined) throw new Error(`${sampleName} ${node}: no mcp capture`);
  const capture = JSON.parse(readFileSync(resolve(repoRoot, rel), "utf8")) as { toolResults?: unknown[] };
  return { block: slugOf(set.name), context: stableStringify(capture.toolResults ?? []), sampleName, component: set.name };
}

function readSnapshot(repoRoot: string, sampleName: string): SnapshotT {
  const path = resolve(repoRoot, "samples", sampleName, "snapshot.json");
  return Snapshot.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Selects the requested set, or the first set for samples not listed in the matrix. */
function setOf(snapshot: SnapshotT, sampleName: string, node: string | undefined): SnapshotT["componentSets"][number] {
  const set = node === undefined
    ? snapshot.componentSets[0]
    : snapshot.componentSets.find((candidate) => candidate.id === node);
  if (set === undefined) throw new Error(`${sampleName}: no component set ${node ?? ""}`.trimEnd());
  return set;
}

function slugOf(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export function renderPrompt(template: string, input: PromptInput): string {
  // `{{ir}}` is the placeholder name recorded experiments were rendered with. Renaming it would
  // change the prompt hash and break comparison with those runs (SPEC 9.6).
  return template.replace("{{block}}", input.block).replace("{{ir}}", input.context);
}
