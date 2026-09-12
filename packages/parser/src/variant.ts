import { variantSelectorOf } from "@tokenloom/schema";
import type { DesignContextT } from "@tokenloom/schema";

export { variantSelectorOf };

type Variants = DesignContextT["component"]["variants"];

export type VariantFailure =
  | { code: "VARIANT_SELECTOR_INVALID"; detail: string; keys: string[] }
  | { code: "VARIANT_NOT_FOUND"; detail: string; available: string[] }
  | { code: "VARIANT_AMBIGUOUS"; detail: string; available: string[] };

export type VariantSelection =
  | { ok: true; context: DesignContextT }
  | { ok: false; failure: VariantFailure };

function decodeSegment(segment: string): string | null {
  let decoded = "";
  let start = 0;
  const codeUnit = /%u([0-9A-Fa-f]{4})/g;
  try {
    for (const match of segment.matchAll(codeUnit)) {
      const unit = Number.parseInt(match[1] as string, 16);
      if (unit < 0xD800 || unit > 0xDFFF) return null;
      decoded += decodeURIComponent(segment.slice(start, match.index));
      decoded += String.fromCharCode(unit);
      start = (match.index ?? 0) + match[0].length;
    }
    return decoded + decodeURIComponent(segment.slice(start));
  } catch {
    return null;
  }
}

/** `null` marks a selector that is not a comma separated list of distinct `key=value` pairs. */
function parseSelector(selector: string): Map<string, string> | null {
  const pairs = new Map<string, string>();
  if (selector === "{}") return pairs;
  for (const token of selector.split(",")) {
    const separator = token.indexOf("=");
    if (separator < 0) return null;
    const key = decodeSegment(token.slice(0, separator).trim());
    const value = decodeSegment(token.slice(separator + 1).trim());
    if (key === null || value === null || pairs.has(key)) return null;
    pairs.set(key, value);
  }
  return pairs;
}

/** A component the selector can name: the base, which keeps no variants, or exactly one variant. */
interface Candidate {
  props: Record<string, string>;
  variants: Variants;
}

function candidatesOf(component: DesignContextT["component"]): Candidate[] {
  return [
    { props: component.base.props, variants: [] },
    ...component.variants.map((variant) => ({ props: variant.props, variants: [variant] })),
  ];
}

function invalid(detail: string, keys: string[]): VariantSelection {
  return { ok: false, failure: { code: "VARIANT_SELECTOR_INVALID", detail, keys } };
}

/**
 * Narrow a canonical design context to the base or one variant (docs/reference/spec.md rule A06).
 * Pure: the input is never mutated, values are compared exactly, and no process, file, or network
 * access happens here. Selection runs after canonical construction so `tokensUsed`, `warnings`, and
 * the base component keep the values the full context would have produced.
 */
export function selectVariant(context: DesignContextT, selector: string): VariantSelection {
  const component = context.component;
  const candidates = candidatesOf(component);
  const knownKeys = new Set([
    ...Object.keys(component.props),
    ...candidates.flatMap((candidate) => Object.keys(candidate.props)),
  ]);
  const keys = [...knownKeys].sort();
  const pairs = parseSelector(selector);
  if (pairs === null) return invalid(`selector "${selector}" is not a list of key=value pairs`, keys);
  const unknown = [...pairs.keys()].filter((key) => !knownKeys.has(key)).sort();
  if (unknown.length > 0) return invalid(`unknown variant key ${unknown.join(",")}`, keys);

  const matched = candidates.filter((candidate) => pairs.size === 0
    ? Object.keys(candidate.props).length === 0
    : [...pairs].every(([key, value]) => candidate.props[key] === value));
  const only = matched[0];
  if (only === undefined) {
    const available = candidates.map((c) => variantSelectorOf(c.props));
    return { ok: false, failure: { code: "VARIANT_NOT_FOUND", detail: `no variant matches "${selector}"`, available } };
  }
  if (matched.length > 1) {
    const available = matched.map((c) => variantSelectorOf(c.props));
    return {
      ok: false,
      failure: { code: "VARIANT_AMBIGUOUS", detail: `"${selector}" matches ${matched.length} components`, available },
    };
  }
  return { ok: true, context: { ...context, component: { ...component, variants: only.variants } } };
}
