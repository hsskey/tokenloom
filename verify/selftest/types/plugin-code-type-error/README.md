This sample overwrites `packages/adapters/plugin/src/code.ts` with a one-line stub containing a type error.
Copying the original 90 lines would let the copy drift, so the sample stays minimal.

The root `tsconfig.json` excludes that file.
The plugin needs globals such as `figma` and `__html__`, so it compiles as a separate program with `types: ["@figma/plugin-typings"]`, and `types` is a program-level option that cannot be merged into the root program.

Before the `types` gate gained its second compilation step, this probe passed `pnpm typecheck` (exit 0), the gate, and `pnpm test` unnoticed.
Only the manually invoked `pnpm --filter @tokenloom/plugin build` caught it.
The gate now runs the plugin project after the root `tsc`, so this sample must fail it.

`expect-also.txt` lists `tests` because the same type error legitimately breaks a test as well: `packages/adapters/plugin/test/bundle-stamp.test.ts` runs the package's own `build` script, whose first step is the plugin `tsc`.

`expect-also` exempts a gate from the collateral-damage count; it does not assert that the gate fails.
This file is therefore an exemption record, not evidence.
The evidence that `pnpm test` covers plugin source is the probe run itself: `pnpm typecheck` exits 2, the `types` gate fails, and one test file fails.
