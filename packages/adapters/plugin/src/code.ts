// Figma plugin main thread. It calls the Figma API while export.ts owns conversion.
// Pages export as separate fragments; `--from a.json,b.json` merges them, so one export never has to
// hold a whole multi-page file.
import {
  annotationSummary, buildExport, collectAnnotations, collectMainIds,
  type AnnotatedNode, type CollectedAnnotations, type ExportSource, type FigmaNode,
} from "./export";

const PNG_SCALE = 2;

/**
 * Bundle stamp embedded as string literals by the package build script through esbuild `--define`.
 * It records `git rev-parse HEAD` and the UTC build time, not the export time.
 */
declare const __TL_EXPORTER_SHA__: string;
declare const __TL_EXPORTER_BUILT_AT__: string;

interface Collected {
  sets: ExportSource["sets"];
  mainIds: ReadonlyMap<string, string>;
  annotations: CollectedAnnotations;
}

async function collectPage(pageName: string): Promise<Collected> {
  const sets: ExportSource["sets"][number][] = [];
  const roots: ComponentNode[] = [];
  // docs/reference/spec.md section 4.8 reads annotations from set roots and every descendant; export.ts maps support and content.
  const annotated: AnnotatedNode[] = [];
  for (const node of figma.currentPage.findAllWithCriteria({ types: ["COMPONENT_SET"] })) {
    annotated.push(node, ...node.findAll());
    const components: ExportSource["sets"][number]["components"][number][] = [];
    for (const child of node.children) {
      if (child.type !== "COMPONENT") continue;
      roots.push(child);
      const bytes = await child.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: PNG_SCALE } });
      components.push({
        id: child.id,
        props: child.variantProperties ?? {},
        root: child as unknown as FigmaNode,
        pngBase64: figma.base64Encode(bytes),
      });
    }
    const props: Record<string, string[]> = {};
    for (const [key, def] of Object.entries(node.componentPropertyDefinitions)) {
      if (def.type === "VARIANT") props[key] = def.variantOptions ?? [];
    }
    sets.push({ id: node.id, name: node.name, props, components });
  }
  figma.notify(`${pageName}: ${sets.length} component sets`);
  // dynamic-page forbids synchronous `mainComponent`, so resolve IDs asynchronously before conversion.
  return { sets, mainIds: await collectMainIds(roots), annotations: collectAnnotations(annotated) };
}

/** Entry point for the export button. The UI receives a download and one-line annotation summary. */
export async function exportCurrentPage(): Promise<{ json: string; annotations: ReturnType<typeof annotationSummary> }> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const textStyles = await figma.getLocalTextStylesAsync();
  const page = figma.currentPage;
  const collected = await collectPage(page.name);
  const source: ExportSource = {
    fileKey: figma.fileKey ?? "UNKNOWN",
    fileVersion: String(Date.now()),
    fetchedAt: new Date().toISOString(),
    page: { id: page.id, name: page.name },
    collections: collections.map((c) => ({
      id: c.id, name: c.name, defaultModeId: c.defaultModeId,
      modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
    })),
    variables: variables.map((v) => ({
      id: v.id, name: v.name, variableCollectionId: v.variableCollectionId,
      resolvedType: v.resolvedType, valuesByMode: v.valuesByMode as Record<string, unknown>,
    })),
    textStyles: textStyles.map((s) => ({
      id: s.id, name: s.name, fontName: s.fontName, fontSize: s.fontSize,
      lineHeight: s.lineHeight as { unit: string; value?: number },
      letterSpacing: s.letterSpacing as { unit: string; value?: number },
    })),
    sets: collected.sets,
    mainIds: collected.mainIds,
    annotations: collected.annotations.annotations,
    annotationsSupport: collected.annotations.support,
    exporter: { sha: __TL_EXPORTER_SHA__, builtAt: __TL_EXPORTER_BUILT_AT__ },
  };
  return { json: JSON.stringify(buildExport(source)), annotations: annotationSummary(collected.annotations) };
}

figma.showUI(__html__, { width: 280, height: 140 });
figma.ui.onmessage = (message: { type?: string }): void => {
  if (message.type !== "export") return;
  void exportCurrentPage().then((result) => {
    figma.ui.postMessage({ type: "result", ...result, page: figma.currentPage.name });
  });
};
