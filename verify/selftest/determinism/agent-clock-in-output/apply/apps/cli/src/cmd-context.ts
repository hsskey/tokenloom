import { stableJsonFile } from "@tokenloom/schema";
import {
  agentError,
  type AgentFailure,
  buildDesignContext,
  componentSetBytes,
  discoverComponentSets,
  projectAgentContext,
  selectComponentSet,
  selectVariant,
} from "@tokenloom/parser";
import { EXIT, exitFor, flagBool, flagString, usageError, type Parsed } from "./args";
import { loadSnapshots } from "./load";
import { appendRun } from "./runs";

const LEVELS = new Set(["compact", "full"]);
const VIEWS = new Set(["canonical", "agent"]);
/** Read as "not requested" when written bare, so these read as a silent success instead of a typo. */
const VALUE_FLAGS = ["match", "variant"] as const;

export function cmdContext(parsed: Parsed): number {
  const command = "context";
  // `--view` without a value is a usage error; printing canonical bytes with exit 0 would hide the mistake.
  const view = parsed.flags.view === undefined ? "canonical" : String(parsed.flags.view);
  if (!VIEWS.has(view)) return usageError(`${command}: unknown view ${view}`);
  for (const flag of VALUE_FLAGS) {
    if (parsed.flags[flag] === true) return usageError(`${command}: --${flag} requires a value`);
  }
  const name = parsed.positional[1];
  if (name === undefined) {
    if (view !== "agent") return usageError(`${command}: <componentName> is required`);
    return cmdDiscover(parsed, command);
  }
  // Filtering a named component would answer a different question than the one asked.
  if (parsed.flags.match !== undefined) return usageError(`${command}: --match cannot name a component`);
  const from = flagString(parsed, "from");
  if (from === undefined) return usageError(`${command}: --from <snapshot.json> is required`);
  const level = flagString(parsed, "level") ?? "compact";
  if (!LEVELS.has(level)) return usageError(`${command}: unknown level ${level}`);

  const startedLoad = performance.now();
  const { snapshot } = loadSnapshots(from);
  const loadMs = Math.round(performance.now() - startedLoad);

  const startedContext = performance.now();
  const result = buildDesignContext(snapshot, {
    name,
    nodeId: flagString(parsed, "node"),
    level: level === "full" ? "full" : "compact",
    annotations: flagBool(parsed, "annotations"),
  });
  const contextMs = Math.round(performance.now() - startedContext);

  if (!result.ok) return fatal(view, result.error, fatalMessage(command, result.error));
  let context = result.context;
  const selector = flagString(parsed, "variant");
  if (selector !== undefined) {
    const selected = selectVariant(context, selector);
    if (!selected.ok) {
      const { code, detail } = selected.failure;
      return fatal(view, selected.failure, `${command}: ${code} ${detail}`);
    }
    context = selected.context;
  }

  const set = selectComponentSet(snapshot, name, flagString(parsed, "node"));
  const bytesIn = set.ok ? componentSetBytes(set.set) : 0;
  const agentView = { ...projectAgentContext(context), projectedAt: new Date().toISOString() };
  const out = stableJsonFile(view === "agent" ? agentView : context);
  process.stdout.write(out);
  for (const w of result.warnings) process.stderr.write(`${w.code} ${w.nodeId} ${w.detail}\n`);
  const componentCount = context.component.variants.length + 1;
  process.stderr.write(`${command}: ${name} ${componentCount} components, ${result.warnings.length} warnings\n`);
  appendRun({
    cmd: "context",
    target: name,
    bytesIn,
    bytesOut: Buffer.byteLength(out, "utf8"),
    ms: { load: loadMs, compact: contextMs },
    warnings: result.warnings.length,
  });
  return exitFor(result.warnings.length, flagBool(parsed, "strict"));
}

/** An omitted component name in the Agent view asks which component sets exist (rule A07). */
function cmdDiscover(parsed: Parsed, command: string): number {
  const from = flagString(parsed, "from");
  if (from === undefined) return usageError(`${command}: --from <snapshot.json> is required`);
  const { snapshot } = loadSnapshots(from);
  process.stdout.write(stableJsonFile(discoverComponentSets(snapshot, flagString(parsed, "match"))));
  return EXIT.ok;
}

/** The Agent view answers a failure as JSON on stdout; the canonical view keeps its stderr text (rule A08). */
function fatal(view: string, failure: AgentFailure, message: string): number {
  if (view === "agent") process.stdout.write(stableJsonFile(agentError(failure)));
  else process.stderr.write(`${message}\n`);
  return EXIT.fatal;
}

/** Centralize fatal component-selection messages (docs/reference/spec.md section 4.5 N05, 5.5 M06 and M11). */
function fatalMessage(command: string, error: Extract<ReturnType<typeof buildDesignContext>, { ok: false }>["error"]): string {
  if (error.kind === "collision") {
    return `${command}: NAME_COLLISION "${error.name}" matches ${error.candidates.join(", ")}; use --node <id>`;
  }
  if (error.kind === "empty") return `${command}: "${error.name}" has no components`;
  return `${command}: component set "${error.name}" not found`;
}
