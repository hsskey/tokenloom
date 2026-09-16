// Exercise the packed CLI through the same package boundary a consumer installs. The registry is
// deliberately unreachable so this test cannot pass by substituting published or workspace content.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dirname(dirname(pkgDir));

interface CommandResult { status: number | null; stdout: string; stderr: string }

function run(executable: string, args: string[], cwd: string, runs: string): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, TOKENLOOM_NO_SPAWN: "1", TOKENLOOM_RUNS_DIR: runs },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Every generated file, keyed by its path relative to the output directory. */
function outputTree(out: string): Record<string, string> {
  const walk = (dir: string, prefix = ""): [string, string][] =>
    readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name), `${prefix}${entry.name}/`)
        : [[`${prefix}${entry.name}`, readFileSync(join(dir, entry.name), "utf8")] as [string, string]],
    );
  return Object.fromEntries(walk(out));
}

describe("the packed package in an unrelated consumer", () => {
  it("installs offline and runs init, deterministic context, and deterministic token generation", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "tokenloom-installed-"));
    const artifacts = join(sandbox, "artifacts");
    const cache = join(sandbox, "cache");
    const consumer = join(sandbox, "consumer");
    const runs = join(sandbox, "runs");
    mkdirSync(artifacts);
    mkdirSync(consumer);
    mkdirSync(join(consumer, "designs"));
    copyFileSync(resolve(root, "samples/button/snapshot.json"), join(consumer, "designs/button.json"));
    const cleanNpm = {
      ...process.env,
      npm_config_audit: "false",
      npm_config_cache: cache,
      npm_config_fund: "false",
      npm_config_ignore_scripts: "true",
      npm_config_offline: "true",
      npm_config_registry: "http://127.0.0.1:9/",
    };

    try {
      const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", artifacts], {
        cwd: pkgDir,
        encoding: "utf8",
      })) as { filename: string }[];
      const tarball = join(artifacts, packed[0]?.filename ?? "missing.tgz");
      execFileSync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
        cwd: consumer,
        env: cleanNpm,
        stdio: "ignore",
      });
      rmSync(artifacts, { recursive: true });

      const installedRoot = join(consumer, "node_modules/@hsskey/tokenloom");
      const rawManifest = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8")) as {
        name: string;
        version: string;
        engines: { node: string };
        bin: { tokenloom: string };
      };
      const manifest = {
        name: rawManifest.name,
        version: rawManifest.version,
        engines: rawManifest.engines,
        bin: rawManifest.bin,
      };
      const executable = join(consumer, "node_modules/.bin/tokenloom");
      const realConsumer = realpathSync(consumer);
      const realInstalledRoot = join(realConsumer, "node_modules/@hsskey/tokenloom");
      const packagedSkill = readFileSync(join(installedRoot, "skill/SKILL.md"), "utf8");
      const init = run(executable, ["init"], consumer, runs);
      const installedSkill = readFileSync(join(consumer, ".claude/skills/tokenloom/SKILL.md"), "utf8");
      const contextArgs = ["context", "Button", "--from", "designs/button.json", "--view", "agent", "--json"];
      const firstContext = run(executable, contextArgs, consumer, runs);
      const secondContext = run(executable, contextArgs, consumer, runs);
      const firstOut = join(consumer, "tokens-first");
      const secondOut = join(consumer, "tokens-second");
      const tokenArgs = (out: string): string[] => [
        "tokens", "build", "--from", "designs/button.json", "--out", out, "--platform", "css,swift,kotlin",
      ];
      const firstTokens = run(executable, tokenArgs(firstOut), consumer, runs);
      const secondTokens = run(executable, tokenArgs(secondOut), consumer, runs);
      const firstTree = outputTree(firstOut);
      const secondTree = outputTree(secondOut);

      expect({
        manifest,
        packagedSkillName: /^name: tokenloom$/m.test(packagedSkill),
        init,
        installedSkillUsesConsumerBundle: installedSkill.includes(
          `node '${join(realInstalledRoot, "dist/tokenloom.js")}'`,
        ),
        unresolvedSkillCommand: installedSkill.includes("{{TOKENLOOM_COMMAND}}"),
        context: {
          status: firstContext.status,
          repeatedExactly: secondContext,
          componentName: (JSON.parse(firstContext.stdout) as { component: { name: string } }).component.name,
        },
        tokens: {
          statuses: [firstTokens.status, secondTokens.status],
          files: Object.keys(firstTree),
          repeatedExactly: secondTree,
        },
      }).toEqual({
        manifest: {
          name: "@hsskey/tokenloom",
          version: "0.1.0",
          engines: { node: ">=22" },
          bin: { tokenloom: "dist/tokenloom.js" },
        },
        packagedSkillName: true,
        init: {
          status: 0,
          stdout: "",
          stderr: `init: installed ${join(realConsumer, ".claude/skills/tokenloom/SKILL.md")}\n`,
        },
        installedSkillUsesConsumerBundle: true,
        unresolvedSkillCommand: false,
        context: {
          status: 0,
          repeatedExactly: firstContext,
          componentName: "Button",
        },
        tokens: {
          statuses: [0, 0],
          files: [
            "css/tokens.css",
            "kotlin/Tokens.kt",
            "swift/Tokens.swift",
            "tokens/base.json",
            "tokens/mode.dark.json",
            "tokens/mode.light.json",
          ],
          repeatedExactly: firstTree,
        },
      });
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 30_000);
});
