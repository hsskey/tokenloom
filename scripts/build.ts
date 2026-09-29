/** Bundles apps/cli into the single executable dist/tokenloom.js (docs/reference/spec.md section 7). */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// The published version that `--version` reports is the CLI package manifest, embedded at build time.
const manifest = JSON.parse(readFileSync(resolve(root, "apps/cli/package.json"), "utf8")) as { version: string };

await build({
  entryPoints: [resolve(root, "apps/cli/src/main.ts")],
  outfile: resolve(root, "apps/cli/dist/tokenloom.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  define: { __TOKENLOOM_VERSION__: JSON.stringify(manifest.version) },
  // Allows CommonJS dependencies such as yaml to call require inside the ESM bundle.
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __tlCreateRequire } from 'node:module';",
      "const require = __tlCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  // Playwright is imported dynamically and only by the visual-difference scorer (S3). Bundling its
  // drivers and native binaries breaks the build, so it resolves from node_modules at runtime.
  external: ["playwright"],
  logLevel: "warning",
});
process.stderr.write("build: apps/cli/dist/tokenloom.js\n");
