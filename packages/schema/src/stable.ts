/**
 * Deterministic serialization and the only path that produces output bytes.
 * Object keys are sorted lexicographically and keys with `undefined` values are omitted.
 */
export function stableStringify(value: unknown, indent = 2): string {
  return write(value, indent, 0);
}

function write(value: unknown, indent: number, depth: number): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return writeArray(value, indent, depth);
  if (typeof value === "object") return writeObject(value as Record<string, unknown>, indent, depth);
  if (typeof value === "number") return writeNumber(value);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  return "null";
}

function writeNumber(n: number): string {
  if (!Number.isFinite(n)) return "null";
  return Object.is(n, -0) ? "0" : String(n);
}

function pad(indent: number, depth: number): string {
  return indent > 0 ? "\n" + " ".repeat(indent * depth) : "";
}

function writeArray(value: unknown[], indent: number, depth: number): string {
  if (value.length === 0) return "[]";
  const items = value.map((v) => pad(indent, depth + 1) + write(v === undefined ? null : v, indent, depth + 1));
  return "[" + items.join(",") + pad(indent, depth) + "]";
}

function writeObject(value: Record<string, unknown>, indent: number, depth: number): string {
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  if (keys.length === 0) return "{}";
  const sep = indent > 0 ? ": " : ":";
  const items = keys.map(
    (k) => pad(indent, depth + 1) + JSON.stringify(k) + sep + write(value[k], indent, depth + 1),
  );
  return "{" + items.join(",") + pad(indent, depth) + "}";
}

/** File JSON ends with one newline so output bytes stay platform-independent. */
export function stableJsonFile(value: unknown): string {
  return stableStringify(value) + "\n";
}
