import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args";
import { cmdInit, skillResource, type SkillResource } from "../src/cmd-init";

const repoRoot = resolve(import.meta.dirname, "../../..");
const TSX = join(repoRoot, "node_modules/.bin/tsx");

/**
 * Stand-in bytes for apps/cli/skill/SKILL.md, which the Skill lane authors and this lane does not.
 * Two command tokens, because the installer must replace every occurrence and leave none behind.
 */
const FIXTURE = "---\nname: tokenloom\n---\n\nRun {{TOKENLOOM_COMMAND}} then {{TOKENLOOM_COMMAND}} again.\n";
const NEXT_FIXTURE = `${FIXTURE}\nA later packaged build.\n`;

const SKILL = join(".claude", "skills", "tokenloom", "SKILL.md");
const RECORD = join(".claude", "skills", "tokenloom", ".tokenloom-install.json");

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** An application project holding files init must never touch. */
function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "tl-init-app-"));
  writeFileSync(join(dir, "package.json"), '{"name":"app","version":"1.0.0"}\n');
  writeFileSync(join(dir, "CLAUDE.md"), "application notes\n");
  mkdirSync(join(dir, ".claude"));
  writeFileSync(join(dir, ".claude", "settings.json"), '{"model":"opus"}\n');
  return dir;
}

/** A stand-in installed package: a Skill template beside the executable it belongs to. */
function makeResource(body: string = FIXTURE, dir: string = mkdtempSync(join(tmpdir(), "tl-init-pkg-"))): SkillResource {
  mkdirSync(dir, { recursive: true });
  const resource = { source: join(dir, "SKILL.md"), bundle: join(dir, "tokenloom.js") };
  writeFileSync(resource.source, body);
  writeFileSync(resource.bundle, "#!/usr/bin/env node\n");
  return resource;
}

/** A later build of the same installation: new Skill text, same executable. */
function shipping(resource: SkillResource, body: string): SkillResource {
  writeFileSync(resource.source, body);
  return resource;
}

function init(project: string, resource: SkillResource, flags: string[] = []): number {
  return cmdInit(parseArgs(["init", ...flags, "--project", project]), resource);
}

function read(project: string, rel: string): string {
  return readFileSync(join(project, rel), "utf8");
}

function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();
}

/** An installation this build owns, ready for the update and conflict cases. */
function installed(): { project: string; resource: SkillResource } {
  const project = makeProject();
  const resource = makeResource();
  expect(init(project, resource)).toBe(0);
  return { project, resource };
}

describe("init installs the Skill", () => {
  it("writes the Skill and an ownership record carrying its content hash", () => {
    const project = makeProject();
    const resource = makeResource();

    const status = init(project, resource);

    expect(status).toBe(0);
    expect(JSON.parse(read(project, RECORD))).toEqual({ sha256: sha256(read(project, SKILL)) });
  });

  it("creates the Skill and its record and nothing else", () => {
    const project = makeProject();
    const before = tree(project);

    init(project, makeResource());

    const added = tree(project).filter((entry) => !before.includes(entry));
    expect(added).toEqual([join(".claude", "skills"), join(".claude", "skills", "tokenloom"), RECORD, SKILL].sort());
  });

  it("leaves unrelated application files byte-identical", () => {
    const project = makeProject();

    init(project, makeResource());

    expect(read(project, "package.json")).toBe('{"name":"app","version":"1.0.0"}\n');
    expect(read(project, "CLAUDE.md")).toBe("application notes\n");
    expect(read(project, join(".claude", "settings.json"))).toBe('{"model":"opus"}\n');
  });

  it("resolves a relative --project against the invocation directory without searching upwards", () => {
    const parent = makeProject();
    mkdirSync(join(parent, "nested"));

    const status = init(join(parent, "nested"), makeResource());

    expect(status).toBe(0);
    expect(readdirSync(parent).sort()).toEqual([".claude", "CLAUDE.md", "nested", "package.json"]);
  });
});

describe("init binds the Skill to the executable that installed it", () => {
  it("replaces every command token with the executable and leaves none behind", () => {
    const project = makeProject();
    const resource = makeResource();

    init(project, resource);

    expect(read(project, SKILL)).toBe(
      `---\nname: tokenloom\n---\n\nRun node '${resource.bundle}' then node '${resource.bundle}' again.\n`);
  });

  it("writes a command line a shell resolves back to the exact executable", () => {
    const project = makeProject();
    const odd = join(mkdtempSync(join(tmpdir(), "tl-init-odd-")), "it's a dir");
    const resource = makeResource("{{TOKENLOOM_COMMAND}}\n", odd);

    init(project, resource);

    const argument = read(project, SKILL).trim().replace(/^node /, "");
    const shell = spawnSync("sh", ["-c", `printf '%s' ${argument}`], { encoding: "utf8" });
    expect(shell.stdout).toBe(resource.bundle);
  });

  it("keeps dollar sequences in the executable path literal instead of expanding them", () => {
    const project = makeProject();
    const odd = join(mkdtempSync(join(tmpdir(), "tl-init-dollar-")), "a$&b$`c$$d");
    const resource = makeResource("{{TOKENLOOM_COMMAND}}\n", odd);

    init(project, resource);

    expect(read(project, SKILL)).toBe(`node '${resource.bundle}'\n`);
  });

  it("rejects a resource whose executable is absent instead of installing a dead command", () => {
    const project = makeProject();
    const before = tree(project);
    const resource = makeResource();
    rmSync(resource.bundle);

    const status = init(project, resource);

    expect(status).toBe(1);
    expect(tree(project)).toEqual(before);
  });
});

describe("init repeats without changing an owned installation", () => {
  it("rewrites nothing when the installed Skill already matches the packaged one", () => {
    const { project, resource } = installed();
    const first = statSync(join(project, SKILL)).mtimeMs;

    const status = init(project, resource);

    expect(status).toBe(0);
    expect(statSync(join(project, SKILL)).mtimeMs).toBe(first);
  });

  it("keeps the older Skill and reports the required flag when the packaged one differs", () => {
    const { project, resource } = installed();
    const before = read(project, SKILL);

    const status = init(project, shipping(resource, NEXT_FIXTURE));

    expect(status).toBe(1);
    expect(read(project, SKILL)).toBe(before);
  });

  it("replaces an untouched older Skill and its record under --update", () => {
    const { project, resource } = installed();

    const status = init(project, shipping(resource, NEXT_FIXTURE), ["--update"]);

    expect(status).toBe(0);
    expect(read(project, SKILL)).toContain("A later packaged build.");
    expect(JSON.parse(read(project, RECORD))).toEqual({ sha256: sha256(read(project, SKILL)) });
  });
});

describe("init refuses to overwrite content it does not own", () => {
  const EDITED = "---\nname: tokenloom\n---\n\nMy own instructions.\n";

  it("preserves an edited Skill even when --update is given", () => {
    const { project, resource } = installed();
    writeFileSync(join(project, SKILL), EDITED);

    const status = init(project, shipping(resource, NEXT_FIXTURE), ["--update"]);

    expect(status).toBe(1);
    expect(read(project, SKILL)).toBe(EDITED);
  });

  it("preserves a Skill that has no ownership record", () => {
    const project = makeProject();
    mkdirSync(join(project, ".claude", "skills", "tokenloom"), { recursive: true });
    writeFileSync(join(project, SKILL), EDITED);

    const status = init(project, makeResource(), ["--update"]);

    expect(status).toBe(1);
    expect(read(project, SKILL)).toBe(EDITED);
  });

  it("preserves the Skill when the ownership record is corrupt", () => {
    const { project, resource } = installed();
    const before = read(project, SKILL);
    writeFileSync(join(project, RECORD), "{ not json");

    const status = init(project, shipping(resource, NEXT_FIXTURE), ["--update"]);

    expect(status).toBe(1);
    expect(read(project, SKILL)).toBe(before);
  });

  it("preserves the Skill when the ownership record names a different hash", () => {
    const { project, resource } = installed();
    const before = read(project, SKILL);
    writeFileSync(join(project, RECORD), `{"sha256":"${sha256("something else")}"}\n`);

    const status = init(project, shipping(resource, NEXT_FIXTURE), ["--update"]);

    expect(status).toBe(1);
    expect(read(project, SKILL)).toBe(before);
  });
});

describe("init rejects invalid arguments before touching the project", () => {
  const INVALID: [string, (project: string) => string[]][] = [
    ["a surplus positional argument", (project) => ["init", "extra", "--project", project]],
    ["--project without a directory", () => ["init", "--project", "--update"]],
    ["--update given a value", (project) => ["init", "--update", "yesterday", "--project", project]],
  ];

  it.each(INVALID)("rejects %s and creates no file", (_name, argv) => {
    const project = makeProject();
    const before = tree(project);

    const status = cmdInit(parseArgs(argv(project)), makeResource());

    expect(status).toBe(1);
    expect(tree(project)).toEqual(before);
  });

  it("rejects a --project directory that does not exist", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "tl-init-gone-")), "absent");

    const status = cmdInit(parseArgs(["init", "--project", missing]), makeResource());

    expect(status).toBe(1);
  });

  it("rejects a missing packaged Skill resource instead of installing an empty one", () => {
    const project = makeProject();
    const before = tree(project);
    const resource = makeResource();
    rmSync(resource.source);

    const status = init(project, resource);

    expect(status).toBe(1);
    expect(tree(project)).toEqual(before);
  });
});

describe("init resolves its packaged resource without consulting the working directory", () => {
  it("points at the Skill and the executable shipped with this checkout", () => {
    expect(skillResource()).toEqual({
      source: join(repoRoot, "apps/cli/skill/SKILL.md"),
      bundle: join(repoRoot, "apps/cli/dist/tokenloom.js"),
    });
  });

  it("returns the same paths when the process runs in an unrelated directory", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "tl-init-cwd-"));

    const printed = await runInProject(elsewhere, ["--print-resource"], makeResource());

    expect(JSON.parse(printed.stdout)).toEqual(skillResource());
  });
});

/** Invoke cmdInit in a child process whose stdin stays open and is never answered. */
const RUNNER = `
const root = process.env.TL_ROOT;
const { cmdInit, skillResource } = await import(root + "/apps/cli/src/cmd-init.ts");
const argv = JSON.parse(process.env.TL_ARGV);
if (argv[0] === "--print-resource") { process.stdout.write(JSON.stringify(skillResource())); process.exitCode = 0; }
else {
  const { parseArgs } = await import(root + "/apps/cli/src/args.ts");
  process.exitCode = cmdInit(parseArgs(argv), JSON.parse(process.env.TL_RESOURCE));
}
`;

interface ChildResult { status: number | null; signal: string | null; stdout: string; stderr: string }

function runInProject(cwd: string, argv: string[], resource: SkillResource): Promise<ChildResult> {
  const child: ChildProcess = spawn(TSX, ["--input-type=module", "-e", RUNNER], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TL_ROOT: repoRoot, TL_ARGV: JSON.stringify(argv), TL_RESOURCE: JSON.stringify(resource) },
  });
  return new Promise<ChildResult>((done) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("exit", (status, signal) => {
      clearTimeout(timer);
      done({ status, signal, stdout, stderr });
    });
  });
}

describe("init runs without asking the operator anything", () => {
  const CASES: [string, () => { project: string; resource: SkillResource }, string[], string, number][] = [
    ["a fresh install", () => ({ project: makeProject(), resource: makeResource() }), [], FIXTURE, 0],
    ["a repeat install", installed, [], FIXTURE, 0],
    ["a refused update", installed, [], NEXT_FIXTURE, 1],
    ["an accepted update", installed, ["--update"], NEXT_FIXTURE, 0],
    ["an invalid argument", () => ({ project: makeProject(), resource: makeResource() }), ["extra"], FIXTURE, 1],
  ];

  it.each(CASES)("exits on %s with stdin open and unanswered", async (_name, setup, flags, body, expected) => {
    const { project, resource } = setup();

    const result = await runInProject(project, ["init", ...flags], shipping(resource, body));

    expect({ status: result.status, signal: result.signal }).toEqual({ status: expected, signal: null });
  });

  it("installs into the invocation directory when --project is absent", async () => {
    const project = makeProject();
    const resource = makeResource();

    const result = await runInProject(project, ["init"], resource);

    expect(result.status).toBe(0);
    expect(read(project, SKILL)).toContain(`node '${resource.bundle}'`);
  });

  it("rejects an empty --project value instead of falling back to the invocation directory", async () => {
    const project = makeProject();
    const before = tree(project);

    const result = await runInProject(project, ["init", "--project="], makeResource());

    expect({ status: result.status, tree: tree(project) }).toEqual({ status: 1, tree: before });
  });

  it("keeps machine stdout empty so a caller can pipe it", async () => {
    const project = makeProject();

    const result = await runInProject(project, ["init"], makeResource());

    expect(result.stdout).toBe("");
  });
});
