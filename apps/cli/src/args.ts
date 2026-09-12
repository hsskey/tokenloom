/** Exit codes are defined by docs/reference/spec.md section 4.9. */
export const EXIT = { ok: 0, fatal: 1, strict: 2, network: 3, reference: 4 } as const;

export interface Parsed {
  positional: string[];
  flags: Record<string, string | true>;
  unknownOptions: string[];
}

const KNOWN_OPTIONS = new Set([
  "against", "annotations", "budget-usd", "dry-run", "expect-exporter", "expect-sets", "file", "file-key",
  "from", "help", "input", "into", "json", "level", "match", "matrix", "node", "only", "out", "parallel",
  "plan", "platform", "project", "prompt-hash", "sets", "since", "strict", "update", "variant", "view",
]);

/** Accept --key value, --key=value, --flag, and the standard -- positional separator. */
export function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const unknownOptions: string[] = [];
  let options = true;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (options && token === "--") {
      options = false;
      continue;
    }
    if (!options || !token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = token.slice(2, eq > 0 ? eq : undefined);
    if (!KNOWN_OPTIONS.has(name)) unknownOptions.push(name);
    if (eq > 0) {
      flags[name] = token.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return { positional, flags, unknownOptions };
}

export function flagString(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function flagBool(parsed: Parsed, name: string): boolean {
  return parsed.flags[name] !== undefined;
}

export function usageError(message: string): number {
  process.stderr.write(`tokenloom: ${message}\n`);
  return EXIT.fatal;
}

/** Warnings affect the exit code only in strict mode. */
export function exitFor(warnings: number, strict: boolean): number {
  return warnings > 0 && strict ? EXIT.strict : EXIT.ok;
}
