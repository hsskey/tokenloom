/** Normalize a slash-separated name into canonical dot-separated token segments. */
export function toTokenPath(name: string, prefix?: string): string {
  const body = name.split("/").map(slug).filter((s) => s.length > 0).join(".");
  return prefix === undefined ? body : `${prefix}.${body}`;
}

/**
 * Canonical syntax is `<segment>(.<segment>){0,4}`.
 * The first segment starts with `[a-z]`; later segments may start with a digit.
 * Single-segment paths are valid for RootToken. Trailing or repeated hyphens are rejected.
 * This check does not validate the category set beyond the segment limit.
 */
export function isAsciiTokenPath(path: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*){0,4}$/.test(path);
}

export function categoryOf(path: string): string {
  return path.split(".")[0] ?? "";
}

export type ExclusionCode = "NAME_COLLISION" | "NON_ASCII_TOKEN_NAME";

export interface TokenNames {
  /** Included ID to canonical token path. */
  pathOf: Map<string, string>;
  /** Excluded ID to reason. Bindings that reference it are treated as unbound. */
  excluded: Map<string, ExclusionCode>;
}

/**
 * Invalid normalized paths produce `NON_ASCII_TOKEN_NAME`; normalized collisions exclude both names.
 * Input order does not affect inclusion. The caller sorts warnings.
 */
export function resolveTokenNames(
  inputs: readonly { id: string; name: string; prefix?: string }[],
): TokenNames {
  const pathOf = new Map<string, string>();
  const excluded = new Map<string, ExclusionCode>();
  // Keeping only the first ID avoids repeatedly copying ID arrays for colliding paths.
  const firstIdOf = new Map<string, string>();
  for (const input of inputs) {
    const path = toTokenPath(input.name, input.prefix);
    if (!isAsciiTokenPath(path)) {
      excluded.set(input.id, "NON_ASCII_TOKEN_NAME");
      continue;
    }
    const first = firstIdOf.get(path);
    if (first === undefined) { firstIdOf.set(path, input.id); continue; }
    excluded.set(first, "NAME_COLLISION");
    excluded.set(input.id, "NAME_COLLISION");
  }
  for (const [path, id] of firstIdOf) if (!excluded.has(id)) pathOf.set(id, path);
  return { pathOf, excluded };
}

/** Preserve Unicode letters and numbers, replace other runs with `-`, trim, and lowercase. */
export function slug(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** Emit lowercase `#rrggbb`, appending alpha as `aa` when `a < 1`. */
export function toHex(color: { r: number; g: number; b: number; a: number }): string {
  const byte = (v: number): string => Math.round(v * 255).toString(16).padStart(2, "0");
  const rgb = `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
  return color.a < 1 ? `${rgb}${byte(color.a)}` : rgb;
}
