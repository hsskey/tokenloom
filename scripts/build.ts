/** Bundles apps/cli into the single executable dist/tokenloom.js (docs/reference/spec.md section 7). */
import { build } from "esbuild";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

await build({
  entryPoints: [resolve(root, "apps/cli/src/main.ts")],
  outfile: resolve(root, "apps/cli/dist/tokenloom.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
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
