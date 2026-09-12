import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserConfig } from "vitest/config";

export const base: UserConfig = {
  test: {
    globals: true,
    // Isolate test run records from reports and forbid real LLM processes even if adapter selection fails.
    env: {
      TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-test-runs-")),
      TOKENLOOM_LLM: "fake",
      TOKENLOOM_NO_SPAWN: "1",
    },
    // Fail teardown if a suite writes records into the repository's runs directory.
    globalSetup: [join(import.meta.dirname, "vitest.runs-guard.ts")],
    update: false,
    passWithNoTests: false,
    include: ["**/*.test.ts"],
    // `.local/` is a developer's untracked scratch area. Excluding it keeps a local file from joining
    // the suite; the repository itself never needs the directory to exist.
    exclude: ["**/node_modules/**", "**/dist/**", "verify/selftest/**", ".local/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
};
