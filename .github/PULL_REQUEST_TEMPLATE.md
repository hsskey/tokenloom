<!--
A reviewer should be able to check this change against intent, not against confidence.
Fill the four sections. An empty section is a signal, not a style.
-->

## Why

What a user or contributor can do after this that they could not do before, or what broke.

## What changed

The smallest accurate description. Link the issue if one exists.

## How I checked

The commands actually run, and the receipt that matters: exit code, the failing case that now passes, or the gate this change can break.
"All tests passed" without a command is not a receipt.

```sh
pnpm test path/to/relevant.test.ts
pnpm verify --gate <gates this change can break>
```

## What I left alone

Especially: no weakened gate, no `vitest -u`, no rewritten committed evidence, no extra refactor.

If this spends money (eval / Figma) or changes a public CLI or snapshot contract, say so here.
