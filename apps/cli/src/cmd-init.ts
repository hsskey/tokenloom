import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableJsonFile } from "@tokenloom/schema";
import { EXIT, flagBool, flagString, usageError, type Parsed } from "./args";

/** `init` writes the Skill and its ownership record, and nothing else, into the user's project. */
const SKILL_DIR = join(".claude", "skills", "tokenloom");

/** The Skill template carries this token; the file installed from it never does. */
const COMMAND_TOKEN = "{{TOKENLOOM_COMMAND}}";

export interface SkillResource {
  source: string;
  bundle: string;
}

/**
 * The package ships skill/ and dist/ as siblings exactly as the repository holds them, so one pair of
 * relative steps answers for the packaged bundle, the checkout bundle, and the unbundled source alike.
 * Resolving from this module's own location binds the Skill to the executable that installed it and
 * keeps the application's working directory out of the decision.
 */
export function skillResource(): SkillResource {
  const here = dirname(fileURLToPath(import.meta.url));
  return { source: join(here, "..", "skill", "SKILL.md"), bundle: join(here, "..", "dist", "tokenloom.js") };
}

/** The agent runs the substituted line in a POSIX shell, so an unusual character in the path must survive it. */
function quoted(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The hash tokenloom recorded for the file it wrote. A missing or unreadable record means unowned. */
function recordedHash(path: string): string | undefined {
  try {
    const record = JSON.parse(readFileSync(path, "utf8")) as { sha256?: unknown };
    return typeof record.sha256 === "string" ? record.sha256 : undefined;
  } catch {
    return undefined;
  }
}

/** Reject arguments and resolve the destination before reading or writing anything (UX-R13). */
export function cmdInit(parsed: Parsed, resource: SkillResource = skillResource()): number {
  const surplus = parsed.positional[1];
  if (surplus !== undefined) return usageError(`init: unexpected argument "${surplus}"`);
  if (typeof parsed.flags.update === "string") return usageError("init: --update takes no value");
  const project = flagString(parsed, "project");
  if (flagBool(parsed, "project") && (project ?? "") === "") return usageError("init: --project needs a directory");
  // Resolve against the invocation directory only: an application root is never searched for upwards.
  const root = resolve(process.cwd(), project ?? ".");
  if (!existsSync(root)) return usageError(`init: no such project directory: ${root}`);
  if (!existsSync(resource.source)) return usageError(`init: no packaged Skill resource at ${resource.source}`);
  if (!existsSync(resource.bundle)) return usageError(`init: no tokenloom executable at ${resource.bundle}`);

  const dir = join(root, SKILL_DIR);
  const target = join(dir, "SKILL.md");
  const record = join(dir, ".tokenloom-install.json");
  // The installed Skill names the executable that wrote it, so the agent cannot reach a different build.
  const wanted = readFileSync(resource.source, "utf8").replaceAll(COMMAND_TOKEN, () => `node ${quoted(resource.bundle)}`);
  const wantedHash = sha256(wanted);
  if (existsSync(target)) {
    const installedHash = sha256(readFileSync(target, "utf8"));
    // Content decides ownership. A version label alone would authorize replacing an edited file.
    if (installedHash !== recordedHash(record)) {
      return usageError(`init: ${target} has local changes or was not installed by tokenloom; remove it to reinstall`);
    }
    if (installedHash === wantedHash) {
      process.stderr.write(`init: ${target} is already up to date\n`);
      return EXIT.ok;
    }
    if (!flagBool(parsed, "update")) {
      return usageError(`init: ${target} differs from this tokenloom build; rerun with --update to replace it`);
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, wanted);
  writeFileSync(record, stableJsonFile({ sha256: wantedHash }));
  process.stderr.write(`init: installed ${target}\n`);
  return EXIT.ok;
}
