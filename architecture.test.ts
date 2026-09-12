import { resolve } from "node:path";
import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";

const CONFIG = resolve(import.meta.dirname, "tsconfig.base.json");
const files = () => projectFiles(CONFIG);
const internalOutside = (allowed: string[]): RegExp =>
  new RegExp(`^(?!(?:${allowed.join("|")})/)(?:packages|apps)/`);

const sourceName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.d)?\.ts$/;
const testName = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\.test\.ts$/;
const productionSource = /^(?:packages|apps)\/.*\/src\/.*\.ts$/;
const portOrCore = new RegExp([
  "^packages/(?:schema|parser|tokens)/src/.*$",
  "^packages/eval/src/(?:model-port|agent-session-port)\\.ts$",
  "^packages/adapters/rest/src/(?:http-port|budget-policy)\\.ts$",
  "^packages/mcp/src/cli-port\\.ts$",
].join("|"));
const portFiles = new RegExp([
  "^packages/eval/src/(?:model-port|agent-session-port)\\.ts$",
  "^packages/adapters/rest/src/(?:http-port|budget-policy)\\.ts$",
  "^packages/mcp/src/cli-port\\.ts$",
].join("|"));
const concreteFiles = new RegExp([
  "^packages/eval/src/(?:adapter|child|claude-session-adapter)\\.ts$",
  "^packages/adapters/rest/src/(?:runtime-http-adapter|budget)\\.ts$",
  "^packages/mcp/src/node-cli-adapter\\.ts$",
].join("|"));
const forbiddenIo = /(?:["']node:(?!crypto["'])[^"']+["']|\bfetch\s*\(|\bprocess(?:\.|\[))/;

describe("package dependency boundaries", () => {
  it("keeps schema independent from every other workspace unit", async () => {
    const rule = files()
      .inPath("packages/schema/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath(internalOutside(["packages/schema"]));
    await expect(rule).toPassAsync();
  });

  it("allows parser to depend only on schema and itself", async () => {
    const rule = files()
      .inPath("packages/parser/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath(internalOutside(["packages/parser", "packages/schema"]));
    await expect(rule).toPassAsync();
  });

  it("detects the parser dependency when its schema edge is forbidden", async () => {
    const inverted = files()
      .inPath("packages/parser/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath("packages/schema/src/**");

    expect(await inverted.check()).not.toEqual([]);
  });

  it("allows tokens to depend only on schema and itself", async () => {
    const rule = files()
      .inPath("packages/tokens/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath(internalOutside(["packages/tokens", "packages/schema"]));
    await expect(rule).toPassAsync();
  });

  it("allows cache to depend only on schema and itself", async () => {
    const rule = files()
      .inPath("packages/cache/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath(internalOutside(["packages/cache", "packages/schema"]));
    await expect(rule).toPassAsync();
  });

  it("allows eval to depend only on parser, schema, and itself", async () => {
    const rule = files()
      .inPath("packages/eval/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath(internalOutside(["packages/eval", "packages/parser", "packages/schema"]));
    await expect(rule).toPassAsync();
  });

  it("keeps the REST adapter within its schema-facing boundary", async () => {
    const rule = files()
      .inPath("packages/adapters/rest/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath(internalOutside(["packages/adapters/rest", "packages/schema"]));
    await expect(rule).toPassAsync();
  });

  it("keeps the plugin adapter within its schema-facing boundary", async () => {
    const rule = files()
      .inPath("packages/adapters/plugin/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath(internalOutside(["packages/adapters/plugin", "packages/schema"]));
    await expect(rule).toPassAsync();
  });

  it("allows MCP to depend only on schema and itself", async () => {
    const rule = files()
      .inPath("packages/mcp/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath(internalOutside(["packages/mcp", "packages/schema"]));
    await expect(rule).toPassAsync();
  });

  it("allows verify to depend only on schema and itself", async () => {
    const rule = files()
      .inPath("packages/verify/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath(internalOutside(["packages/verify", "packages/schema"]));
    await expect(rule).toPassAsync();
  });

  it("keeps CLI composition independent from plugin, MCP, and verify", async () => {
    const rule = files()
      .inPath("apps/cli/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath(/^packages\/(?:adapters\/plugin|mcp|verify)\//);
    await expect(rule).toPassAsync();
  });
});

describe("ports and concrete adapters", () => {
  it("keeps core and port files free of Node I/O, processes, and network calls", async () => {
    const rule = files()
      .inPath(portOrCore)
      .should()
      .adhereTo(({ content }) => !forbiddenIo.test(content), "core and ports must not perform I/O");
    await expect(rule).toPassAsync();
  });

  it("keeps MCP on its existing CLI port instead of depending on parser", async () => {
    const rule = files()
      .inPath("packages/mcp/src/**")
      .shouldNot()
      .dependOnFiles()
      .inPath("packages/parser/src/**");
    await expect(rule).toPassAsync();
  });

  it("keeps port and policy files independent from concrete adapters", async () => {
    const rule = files()
      .inPath(portFiles)
      .shouldNot()
      .dependOnFiles()
      .inPath(concreteFiles);
    await expect(rule).toPassAsync();
  });

  it("selects concrete adapters only in approved composition roots", async () => {
    const approved = [
      "apps/cli/src/cmd-eval.ts",
      "apps/cli/src/cmd-capture.ts",
      "apps/cli/src/cmd-sync.ts",
      "apps/cli/src/main.ts",
      "packages/mcp/src/index.ts",
      "packages/eval/src/adapter.ts",
      "packages/eval/src/child.ts",
      "packages/eval/src/claude-session-adapter.ts",
      "packages/adapters/rest/src/runtime-http-adapter.ts",
      "packages/adapters/rest/src/budget.ts",
      "packages/mcp/src/node-cli-adapter.ts",
    ];
    const rule = files()
      .inPath(productionSource, { except: { inPath: approved } })
      .shouldNot()
      .dependOnFiles()
      .inPath(concreteFiles);
    await expect(rule).toPassAsync();
  });
});

describe("cycles and filenames", () => {
  it("has no cycles across production packages and apps", async () => {
    const rule = files().inPath(productionSource).should().haveNoCycles();
    await expect(rule).toPassAsync();
  });

  it("uses kebab-case production source filenames and permits declaration files", async () => {
    const rule = files().inPath(productionSource).should().haveName(sourceName);
    await expect(rule).toPassAsync();
  });

  it("uses descriptive test filenames including category suffixes", async () => {
    const rule = files()
      .inPath(/^(?:(?:packages|apps)\/.*\/test\/.*|scripts\/.*|architecture)\.test\.ts$/)
      .should()
      .haveName(testName);
    await expect(rule).toPassAsync();
  });

  it("uses benchmark suffixes with an explicit support-file set", async () => {
    const rule = files()
      .inPath(/^bench\/.*\.ts$/)
      .should()
      .haveName(/^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.bench|run|util|scale\.child)\.ts$/);
    await expect(rule).toPassAsync();
  });

  it("uses kebab-case script filenames outside tests", async () => {
    const rule = files()
      .inPath(/^scripts\/(?!.*\.test\.ts$).*\.ts$/)
      .should()
      .haveName(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.ts$/);
    await expect(rule).toPassAsync();
  });

  it("keeps root TypeScript files within the conventional config and test set", async () => {
    const rule = files()
      .inPath(/^[^/]+\.ts$/)
      .should()
      .haveName(/^(?:architecture\.test|tokenloom\.config|vitest\.(?:base|config|runs-guard))\.ts$/);
    await expect(rule).toPassAsync();
  });
});
