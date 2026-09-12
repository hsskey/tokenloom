// Synthetic REST responses typed against @figma/rest-api-spec so tsc catches field drift. No network access.
import type {
  Comment, ComponentNode, ComponentSetNode, FrameNode, GetCommentsResponse, GetFileNodesResponse,
  GetFileResponse, SectionNode, TextNode,
} from "@figma/rest-api-spec";
import type { FetchLike, HttpDeps, HttpResponse } from "../src/index";

export const FILE_KEY = "FILEKEY";
export const NOW_MS = Date.parse("2026-09-02T10:00:00Z");

export function headers(map: Record<string, string> = {}): HttpResponse["headers"] {
  return { get: (name) => map[name.toLowerCase()] ?? null, entries: () => Object.entries(map) };
}

/** Header implementation with only `get`, used to exercise non-standard Headers values. */
export function headersWithoutEntries(map: Record<string, string> = {}): HttpResponse["headers"] {
  return { get: (name) => map[name.toLowerCase()] ?? null };
}

export function jsonResponse(status: number, body: unknown, head: Record<string, string> = {}): HttpResponse {
  return { status, headers: headers(head), text: async () => JSON.stringify(body) };
}

/** Fetch stub that returns responses in order and records requested URLs. */
export function scriptedFetch(steps: (HttpResponse | Error)[]): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step instanceof Error) throw step;
    return step as HttpResponse;
  };
  return { fetch, urls };
}

/** Sleep stub that records delays without waiting. */
export function httpDeps(fetch: FetchLike, retryAfterMaxSec = 300): { deps: HttpDeps; slept: number[] } {
  const slept: number[] = [];
  const deps: HttpDeps = {
    fetch, token: "pat", retryAfterMaxSec, nowMs: () => NOW_MS,
    sleep: async (ms) => { slept.push(ms); },
  };
  return { deps, slept };
}

const LAYER = { scrollBehavior: "SCROLLS" } as const;

function textChild(): TextNode {
  return {
    ...LAYER,
    id: "12:36",
    name: "Label",
    type: "TEXT",
    blendMode: "NORMAL",
    absoluteBoundingBox: { x: 116, y: 208, width: 72, height: 20 },
    absoluteRenderBounds: null,
    effects: [],
    fills: [{ type: "SOLID", blendMode: "NORMAL", color: { r: 1, g: 1, b: 1, a: 1 } }],
    styles: { text: "t1" },
    boundVariables: { fills: [{ type: "VARIABLE_ALIAS", id: "v9" }] },
    characters: "Button",
    characterStyleOverrides: [],
    styleOverrideTable: {},
    lineTypes: [],
    lineIndentations: [],
    style: { fontFamily: "Inter", fontSize: 14, fontWeight: 600, lineHeightPx: 20 },
  };
}

function variant(id: string, name: string, bg: { r: number; g: number; b: number }, fillVar: string): ComponentNode {
  return {
    ...LAYER,
    id,
    name,
    type: "COMPONENT",
    blendMode: "NORMAL",
    clipsContent: false,
    absoluteBoundingBox: { x: 100, y: 200, width: 104, height: 36 },
    absoluteRenderBounds: null,
    effects: [],
    fills: [{ type: "SOLID", blendMode: "NORMAL", color: { ...bg, a: 1 } }],
    strokes: [],
    children: [textChild()],
    layoutMode: "HORIZONTAL",
    primaryAxisSizingMode: "AUTO",
    counterAxisSizingMode: "AUTO",
    primaryAxisAlignItems: "CENTER",
    counterAxisAlignItems: "CENTER",
    paddingTop: 8,
    paddingRight: 16,
    paddingBottom: 8,
    paddingLeft: 16,
    itemSpacing: 8,
    cornerRadius: 8,
    boundVariables: {
      fills: [{ type: "VARIABLE_ALIAS", id: fillVar }],
      itemSpacing: { type: "VARIABLE_ALIAS", id: "v5" },
      paddingTop: { type: "VARIABLE_ALIAS", id: "v5" },
      paddingRight: { type: "VARIABLE_ALIAS", id: "v6" },
      paddingBottom: { type: "VARIABLE_ALIAS", id: "v5" },
      paddingLeft: { type: "VARIABLE_ALIAS", id: "v6" },
      topLeftRadius: { type: "VARIABLE_ALIAS", id: "v7" },
    },
  };
}

export function buttonSetNode(): ComponentSetNode {
  return {
    ...LAYER,
    id: "12:34",
    name: "Button",
    type: "COMPONENT_SET",
    blendMode: "NORMAL",
    clipsContent: false,
    absoluteBoundingBox: { x: 90, y: 190, width: 130, height: 120 },
    absoluteRenderBounds: null,
    effects: [],
    fills: [],
    children: [
      variant("12:35", "variant=primary, size=md", { r: 0.102, g: 0.451, b: 0.91 }, "v8"),
      variant("12:37", "variant=secondary, size=md", { r: 0.945, g: 0.953, b: 0.957 }, "v10"),
    ],
    componentPropertyDefinitions: {
      variant: { type: "VARIANT", defaultValue: "primary", variantOptions: ["primary", "secondary"] },
      size: { type: "VARIANT", defaultValue: "md", variantOptions: ["md"] },
    },
  };
}

/** Common sample-design shape: a set nested in a Components frame rather than directly under the page. */
export function wrapperFrame(children: ComponentSetNode[]): FrameNode {
  return {
    ...LAYER,
    id: "0:2",
    name: "Components",
    type: "FRAME",
    blendMode: "NORMAL",
    clipsContent: false,
    absoluteBoundingBox: { x: 0, y: 0, width: 500, height: 500 },
    absoluteRenderBounds: null,
    effects: [],
    fills: [],
    children,
  };
}

/** Section containing component sets, a common sample-design hierarchy. */
export function sectionWrap(children: ComponentSetNode[]): SectionNode {
  return {
    ...LAYER,
    id: "0:3",
    name: "Buttons",
    type: "SECTION",
    absoluteBoundingBox: { x: 0, y: 0, width: 500, height: 500 },
    absoluteRenderBounds: null,
    fills: [],
    strokes: [],
    strokeWeight: 0,
    strokeAlign: "INSIDE",
    sectionContentsHidden: false,
    children,
  };
}

/**
 * `nested` selects the set depth: page child at depth 2, frame child at depth 3, or frame-section child at depth 4.
 */
export function fileResponse(setIds: string[] = ["12:34"], nested: boolean | "section" = false): GetFileResponse {
  return {
    name: "Design System",
    role: "owner",
    lastModified: "2026-09-01T00:00:00Z",
    editorType: "figma",
    version: "1234567890",
    schemaVersion: 0,
    components: {},
    componentSets: {},
    styles: { t1: { key: "t1", name: "label/md", description: "", remote: false, styleType: "TEXT" } },
    document: {
      ...LAYER,
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          ...LAYER,
          id: "0:1",
          name: "Page 1",
          type: "CANVAS",
          backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
          prototypeStartNodeID: null,
          flowStartingPoints: [],
          prototypeDevice: { type: "NONE", rotation: "NONE" },
          children: nestedChildren(setIds, nested),
        },
      ],
    },
  };
}

function nestedChildren(setIds: string[], nested: boolean | "section"): FrameNode["children"] {
  const sets = setIds.map((id) => ({ ...buttonSetNode(), id }));
  if (nested === "section") return [{ ...wrapperFrame([]), children: [sectionWrap(sets)] }];
  return nested ? [wrapperFrame(sets)] : sets;
}

export function nodesResponse(ids: string[]): GetFileNodesResponse {
  const nodes: GetFileNodesResponse["nodes"] = {};
  for (const id of ids) {
    nodes[id] = {
      document: { ...buttonSetNode(), id },
      components: {},
      componentSets: {},
      schemaVersion: 0,
      styles: {},
    };
  }
  return {
    name: "Design System",
    role: "owner",
    lastModified: "2026-09-01T00:00:00Z",
    editorType: "figma",
    thumbnailUrl: "",
    version: "1234567890",
    nodes,
  };
}

export function comment(id: string, message: string, nodeId: string | null, parentId?: string): Comment {
  const meta: Comment["client_meta"] = nodeId === null
    ? { x: 0, y: 0 }
    : { node_id: nodeId, node_offset: { x: 0, y: 0 } };
  return {
    id,
    client_meta: meta,
    file_key: FILE_KEY,
    parent_id: parentId ?? "",
    user: { id: "u1", handle: "designer", img_url: "" },
    created_at: "2026-09-01T00:00:00Z",
    message,
    order_id: id,
    reactions: [],
  };
}

export function commentsResponse(): GetCommentsResponse {
  return {
    comments: [
      comment("c2", "[a11y] 라벨은 시각적으로 숨기지 않는다.", "12:36"),
      comment("c1", "[behavior] Enter/Space로 활성화.", "12:34"),
      comment("c3", "이 코멘트는 캔버스에 붙어 있다", null),
      comment("c4", "답글은 주석이 아니다", "12:34", "c1"),
    ],
  };
}
