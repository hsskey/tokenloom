import { z } from "zod";

/**
 * Structured outcomes the Agent view returns instead of prose on stderr
 * (docs/reference/spec.md section 4.12, rules A07 and A08).
 * The canonical view keeps its existing stderr text and exit codes.
 */
export const AgentErrorCode = z.enum([
  "COMPONENT_NOT_FOUND",
  "COMPONENT_SET_EMPTY",
  "NAME_COLLISION",
  "VARIANT_SELECTOR_INVALID",
  "VARIANT_NOT_FOUND",
  "VARIANT_AMBIGUOUS",
]);

/**
 * `next` holds command templates, never interpolated caller values, so a name carrying spaces or
 * quotes cannot produce a broken command and the bytes stay independent of the input path.
 */
export const AgentError = z.object({
  error: z.object({
    // Selectors that would match, for VARIANT_NOT_FOUND and VARIANT_AMBIGUOUS.
    available: z.array(z.string()).optional(),
    // Node ids of the colliding component sets, for NAME_COLLISION.
    candidates: z.array(z.string()).optional(),
    code: AgentErrorCode,
    detail: z.string(),
    // Known variant property keys, for VARIANT_SELECTOR_INVALID.
    keys: z.array(z.string()).optional(),
  }),
  next: z.array(z.string()),
});

/** `id` appears only when the name is ambiguous, which is the only case where a caller needs it. */
export const AgentDiscoveryItem = z.object({
  id: z.string().optional(),
  name: z.string(),
  variants: z.number().int().nonnegative(),
});

export const AgentDiscovery = z.object({
  components: z.array(AgentDiscoveryItem),
  // Matches before the limit is applied, so a caller can tell a short page from a complete one.
  count: z.number().int().nonnegative(),
  next: z.array(z.string()),
  returned: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export type AgentErrorCodeT = z.infer<typeof AgentErrorCode>;
export type AgentErrorT = z.infer<typeof AgentError>;
export type AgentDiscoveryItemT = z.infer<typeof AgentDiscoveryItem>;
export type AgentDiscoveryT = z.infer<typeof AgentDiscovery>;

function encodeSelectorSegment(segment: string): string {
  let encoded = "";
  for (let index = 0; index < segment.length; index += 1) {
    const unit = segment.charCodeAt(index);
    const next = segment.charCodeAt(index + 1);
    if (unit >= 0xD800 && unit <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
      encoded += encodeURIComponent(segment.slice(index, index + 2));
      index += 1;
    } else if (unit >= 0xD800 && unit <= 0xDFFF) {
      encoded += `%u${unit.toString(16).toUpperCase().padStart(4, "0")}`;
    } else {
      encoded += encodeURIComponent(segment[index] as string);
    }
  }
  return encoded;
}

export function variantSelectorOf(props: Record<string, string>): string {
  const keys = Object.keys(props).sort();
  if (keys.length === 0) return "{}";
  return keys.map((key) => `${encodeSelectorSegment(key)}=${encodeSelectorSegment(props[key] as string)}`).join(",");
}
