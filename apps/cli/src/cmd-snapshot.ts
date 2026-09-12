import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentSetT, PluginExportT, SnapshotT } from "@tokenloom/schema";
import { PluginExport, Snapshot, stableJsonFile } from "@tokenloom/schema";
import config from "../../../tokenloom.config";
import { EXIT, flagBool, flagString, usageError, type Parsed } from "./args";
import { parseJson, validate } from "./load";
import { appendRun } from "./runs";

export interface ImportResult {
  snapshot: SnapshotT;
  pngs: { path: string; bytes: Buffer }[];
}

/** Parse PluginExport before Snapshot so validation cannot silently discard embedded PNG data. */
export function splitExport(raw: unknown, renderDir: string): ImportResult {
  const parsed: PluginExportT = PluginExport.parse(raw);
  const pngs: ImportResult["pngs"] = [];
  const componentSets: ComponentSetT[] = parsed.componentSets.map((set) => ({
    id: set.id,
    name: set.name,
    props: set.props,
    components: set.components.map((component) => {
      if (component.renderPngBase64 === undefined) {
        return { id: component.id, props: component.props, root: component.root };
      }
      const name = `${component.id.replace(/[^A-Za-z0-9_-]+/g, "-")}.png`;
      pngs.push({ path: join(renderDir, name), bytes: Buffer.from(component.renderPngBase64, "base64") });
      return {
        id: component.id,
        props: component.props,
        root: component.root,
        renderPng: `render/${name}`,
      };
    }),
  }));
  return {
    snapshot: {
      version: 1,
      source: parsed.source,
      collections: parsed.collections,
      variables: parsed.variables,
      textStyles: parsed.textStyles,
      componentSets,
      annotations: parsed.annotations,
    },
    pngs,
  };
}

/** Bundle SHA suffix for builds with uncommitted changes; see the plugin package build script. */
const DIRTY = "-dirty";

/** docs/reference/spec.md section 4.9: Validate source.exporter.sha; builtAt is informational and missing stamps are rejected. */
export function exporterMismatch(
  exporter: { sha: string } | undefined,
  expect: string | undefined,
): string | null {
  if (expect === undefined) return null;
  if (exporter === undefined) return "no exporter stamp: the plugin bundle was built before exporter stamping existed";
  // A dirty build does not correspond to the recorded commit even when its hexadecimal SHA matches.
  if (exporter.sha.endsWith(DIRTY)) return `exporter built from a dirty tree: ${exporter.sha}`;
  if (exporter.sha === expect) return null;
  return `exporter sha mismatch: expected ${expect}, found ${exporter.sha}`;
}

/** Derive accepted --plan values from the canonical schema (docs/reference/spec.md section 4.1). */
const PLANS = Snapshot.shape.source.shape.plan.options;

export function cmdSnapshotImport(parsed: Parsed): number {
  const from = parsed.positional[2];
  if (from === undefined) return usageError("snapshot import: <export.json> is required");
  const into = flagString(parsed, "into");
  if (into === undefined) return usageError("snapshot import: --into <sample-directory> is required");

  const expect = flagString(parsed, "expect-exporter");
  if (expect === undefined && flagBool(parsed, "expect-exporter")) {
    return usageError("snapshot import: --expect-exporter needs a sha");
  }

  // Plugins cannot identify the plan or draft file key, so import supplies known values.

  const planFlag = flagString(parsed, "plan");
  if (planFlag === undefined && flagBool(parsed, "plan")) {
    return usageError(`snapshot import: --plan needs one of ${PLANS.join(", ")}`);
  }
  const plan = planFlag ?? config.plan;
  if (!(PLANS as readonly string[]).includes(plan)) {
    return usageError(`snapshot import: --plan must be one of ${PLANS.join(", ")}, got ${plan}`);
  }
  const fileKey = flagString(parsed, "file-key");
  if (fileKey === undefined && flagBool(parsed, "file-key")) {
    return usageError("snapshot import: --file-key needs a key");
  }

  const started = performance.now();
  const text = readFileSync(from, "utf8");
  const result = validate(from, () => splitExport(parseJson(from, text), join(into, "render")));

  // Validate before writing so a rejected export cannot leave a partial sample.
  const exporter = result.snapshot.source.exporter;
  const mismatch = exporterMismatch(exporter, expect);
  if (mismatch !== null) return usageError(`snapshot import: ${mismatch}`);

  // Apply source overrides only after stamp validation succeeds.
  result.snapshot.source.plan = plan as SnapshotT["source"]["plan"];
  if (fileKey !== undefined) result.snapshot.source.fileKey = fileKey;

  mkdirSync(into, { recursive: true });
  if (result.pngs.length > 0) mkdirSync(join(into, "render"), { recursive: true });
  for (const png of result.pngs) writeFileSync(png.path, png.bytes);
  const snapshotPath = join(into, "snapshot.json");
  const body = stableJsonFile(result.snapshot);
  writeFileSync(snapshotPath, body);

  const sets = result.snapshot.componentSets.length;
  process.stderr.write(`snapshot import: ${sets} sets, ${result.pngs.length} png -> ${snapshotPath}\n`);
  const source = result.snapshot.source;
  process.stderr.write(`snapshot import: source.plan=${source.plan} source.fileKey=${source.fileKey}\n`);
  // Without validation flags, print the stamp for the importing user to inspect.
  process.stdout.write(exporter === undefined ? "exporter: none\n" : `exporter: ${exporter.sha} ${exporter.builtAt}\n`);
  appendRun({
    cmd: "snapshot import",
    target: from,
    bytesIn: Buffer.byteLength(text, "utf8"),
    bytesOut: Buffer.byteLength(body, "utf8"),
    ms: { import: Math.round(performance.now() - started) },
    warnings: 0,
  });
  return EXIT.ok;
}
