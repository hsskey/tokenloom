/**
 * Union of Swift and Kotlin reserved words.
 * Both outputs use backticks when either language reserves a word so their reference output remains
 * line-aligned and preserves the same canonical paths.
 */
const RESERVED = new Set([
  // Swift
  "associatedtype", "class", "deinit", "enum", "extension", "fileprivate", "func", "import", "init",
  "inout", "internal", "let", "open", "operator", "private", "protocol", "public", "rethrows",
  "static", "struct", "subscript", "typealias", "var", "break", "case", "continue", "default",
  "defer", "do", "else", "fallthrough", "for", "guard", "if", "in", "repeat", "return", "switch",
  "where", "while", "as", "Any", "catch", "false", "is", "nil", "super", "self", "Self", "throw",
  "throws", "true", "try",
  // Kotlin
  "fun", "interface", "null", "object", "package", "this", "typeof", "val", "when",
]);

function capitalize(word: string): string {
  return word.slice(0, 1).toUpperCase() + word.slice(1);
}

/** Split on `-`, keep the first part, and capitalize the rest: `brand-alt` becomes `brandAlt`. */
function camel(segment: string): string {
  const [first = "", ...rest] = segment.split("-");
  return first + rest.map(capitalize).join("");
}

/**
 * Single-segment paths have no category.
 * The empty category sorts first, which places `RootToken` before other types.
 */
export function categoryKey(path: string): string {
  const segments = path.split(".");
  return segments.length === 1 ? "" : (segments[0] ?? "");
}

/** Categories permit hyphens, so `brand-alt` must camel-convert before capitalizing: `BrandAltToken`. */
export function typeName(category: string): string {
  return category === "" ? "RootToken" : `${capitalize(camel(category))}Token`;
}

/**
 * Member name derived from a canonical path.
 * Prefix names that start with a digit with `_`, and wrap reserved words in backticks.
 * Single-segment paths use the same camel conversion, without changing the canonical path.
 */
export function memberName(path: string): string {
  const [first = "", ...rest] = path.split(".");
  const segments = rest.length === 0 ? [first] : rest;
  const raw = segments.map((s, i) => (i === 0 ? camel(s) : capitalize(camel(s)))).join("");
  const prefixed = /^[0-9]/.test(raw) ? `_${raw}` : raw;
  return RESERVED.has(prefixed) ? `\`${prefixed}\`` : prefixed;
}

export function qualified(path: string): string {
  return `${typeName(categoryKey(path))}.${memberName(path)}`;
}

/** `color.button.primary.bg` → `--color-button-primary-bg`, `typo.label.md.fontSize` → `--typo-label-md-font-size`. */
export function cssVarName(path: string): string {
  const kebab = path.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return `--${kebab.split(".").join("-")}`;
}

/**
 * Platform names derived from one canonical path.
 * If distinct paths share any name, exclude both. Swift and Kotlin share one type-and-member name.
 */
export function platformNames(path: string): string[] {
  return [cssVarName(path), qualified(path)];
}
