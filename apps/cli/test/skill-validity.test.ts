import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const CLI = resolve(repoRoot, "apps/cli/dist/tokenloom.js");
const SKILL = resolve(repoRoot, "apps/cli/skill/SKILL.md");
const skillText = readFileSync(SKILL, "utf8");

/** `tokenloom init` replaces this line with the executable it resolved; the template carries the placeholder. */
const COMMAND_PLACEHOLDER = "{{TOKENLOOM_COMMAND}}";

const tempDir = (): string => mkdtempSync(join(tmpdir(), "tl-skill-"));

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOKENLOOM_NO_SPAWN: "1", TOKENLOOM_RUNS_DIR: tempDir() },
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function frontmatter(text: string): Record<string, string> {
  const end = text.indexOf("\n---\n", 4);
  const body = text.slice(4, end);
  const fields: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0 && !line.startsWith(" ")) fields[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }
  return fields;
}

/** Lines inside fenced blocks are the commands the agent is shown; prose about tokenloom is not a command. */
function fencedLines(text: string): string[] {
  const lines: string[] = [];
  let inside = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) { inside = !inside; continue; }
    if (inside && line.trim().length > 0) lines.push(line.trim());
  }
  return lines;
}

/** Every command the Skill shows in a fenced block, so a documented invocation cannot drift from the CLI. */
function advertisedCommands(text: string): string[] {
  return fencedLines(text)
    .filter((line) => line !== COMMAND_PLACEHOLDER)
    .map((line) => line.slice(COMMAND_PLACEHOLDER.length).trim());
}

/** A plugin export is the input the Skill tells the agent to hand to `snapshot import`. */
function writeExport(path: string): void {
  const snapshot = JSON.parse(readFileSync(join(repoRoot, "samples/button/snapshot.json"), "utf8")) as {
    source: Record<string, unknown>;
  };
  snapshot.source = { ...snapshot.source, kind: "plugin" };
  writeFileSync(path, JSON.stringify(snapshot));
}

function bindings(): Record<string, string> {
  const exportPath = join(tempDir(), "export.json");
  writeExport(exportPath);
  return {
    "<absolute-input>": join(repoRoot, "samples/button/snapshot.json"),
    "<ComponentName>": "Button",
    "<text>": "But",
    "<directory>": join(tempDir(), "tokens"),
    "<export.json>": exportPath,
    "<sample-directory>": join(tempDir(), "imported"),
  };
}

function argvFor(command: string, values: Record<string, string>): string[] {
  return command.split(/\s+/).map((token) => {
    const bare = token.replace(/^"|"$/g, "");
    return values[bare] ?? bare;
  });
}

describe("the installed tokenloom Skill resource", () => {
  it("declares the agent discovery metadata as exactly a name and a description", () => {
    const fields = frontmatter(skillText);

    expect({ keys: Object.keys(fields).sort(), name: fields.name }).toEqual({
      keys: ["description", "name"],
      name: "tokenloom",
    });
  });

  it("routes every shown invocation through the placeholder rather than a global or fetched command", () => {
    const shown = fencedLines(skillText);

    expect({
      shown: shown.length > 0,
      unplaceheld: shown.filter((line) => !line.startsWith(COMMAND_PLACEHOLDER)),
    }).toEqual({ shown: true, unplaceheld: [] });
  });
});

describe("commands the tokenloom Skill advertises", () => {
  const values = bindings();
  const commands = advertisedCommands(skillText);

  it.each(commands.map((command) => ({ command })))("`$command` succeeds against the built CLI", ({ command }) => {
    const argv = argvFor(command, values);

    const result = runCli(argv);

    expect({ unbound: argv.filter((a) => a.includes("<")), status: result.status }).toEqual({ unbound: [], status: 0 });
  });
});

describe("recovery instructions in the tokenloom Skill", () => {
  const buttons = join(repoRoot, "samples/button/snapshot.json");
  const chips = join(repoRoot, "samples/twenty-variants/snapshot.json");
  const collision = join(repoRoot, "samples/mutations/M06.json");

  function emptySet(): string {
    const snapshot = JSON.parse(readFileSync(buttons, "utf8")) as { componentSets: { components: unknown[] }[] };
    (snapshot.componentSets[0] as { components: unknown[] }).components = [];
    const path = join(tempDir(), "empty.json");
    writeFileSync(path, JSON.stringify(snapshot));
    return path;
  }

  it.each([
    { code: "COMPONENT_NOT_FOUND", args: ["context", "--from", buttons, "--view", "agent", "--json", "--", "Missing"] },
    { code: "NAME_COLLISION", args: ["context", "Button", "--from", collision, "--view", "agent", "--json"] },
    { code: "COMPONENT_SET_EMPTY", args: ["context", "Button", "--from", emptySet(), "--view", "agent", "--json"] },
    { code: "VARIANT_SELECTOR_INVALID", args: ["context", "Button", "--from", buttons, "--view", "agent", "--variant=bogus", "--json"] },
    { code: "VARIANT_NOT_FOUND", args: ["context", "Button", "--from", buttons, "--view", "agent", "--variant=size=xl", "--json"] },
    { code: "VARIANT_AMBIGUOUS", args: ["context", "Chip", "--from", chips, "--view", "agent", "--variant=size=md", "--json"] },
  ])("$code is a documented code that the CLI still emits as Agent JSON", ({ code, args }) => {
    const result = runCli(args);
    const body = JSON.parse(result.stdout) as { error: { code: string } };

    expect({ code: body.error.code, status: result.status, documented: skillText.includes(`\`${code}\``) })
      .toEqual({ code, status: 1, documented: true });
  });

  it("a missing input file fails on stderr without the Agent JSON the recovery table describes", () => {
    const result = runCli(["context", "Button", "--from", join(tempDir(), "absent.json"), "--view", "agent", "--json"]);

    expect({ stdout: result.stdout, prefixed: result.stderr.startsWith("tokenloom: "), status: result.status })
      .toEqual({ stdout: "", prefixed: true, status: 1 });
  });

  it("truncated discovery offers the --match narrowing the Skill instructs, and no pagination option", () => {
    const snapshot = JSON.parse(readFileSync(buttons, "utf8")) as { componentSets: Record<string, unknown>[] };
    const one = snapshot.componentSets[0] as Record<string, unknown>;
    snapshot.componentSets = Array.from({ length: 25 }, (_, i) => ({ ...one, id: `9:${i}`, name: `Widget${i}` }));
    const path = join(tempDir(), "many.json");
    writeFileSync(path, JSON.stringify(snapshot));

    const result = runCli(["context", "--from", path, "--view", "agent", "--json"]);
    const body = JSON.parse(result.stdout) as { count: number; next: string[]; returned: number; truncated: boolean };

    expect({
      truncated: body.truncated,
      count: body.count,
      narrowable: body.next.some((n) => n.includes("--match")),
      instructed: skillText.includes("--match"),
    }).toEqual({ truncated: true, count: 25, narrowable: true, instructed: true });
  });
});
