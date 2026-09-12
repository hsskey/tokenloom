# Product goals and invariants

This document states what tokenloom promises, what it deliberately does not do, and the measurable envelope its design has to stay inside.
Read it before proposing a feature, a dependency, or a threshold change.
`docs/reference/spec.md` holds the technical contract, and `docs/reference/verification.md` says how each promise is checked.

## Goal

tokenloom is a CLI that deterministically turns Figma designs into design tokens for CSS, Swift, and Kotlin, and into compact design context for LLM-assisted code generation.
A regression harness in this repository records generated-code quality for each input source and evaluation input variant.

tokenloom stays reproducible without a Figma account.
Its own commands need no network access; only dependency installation, the Playwright browser download, and explicit evaluation calls to a language model do.

## Invariants

- Token extraction never calls a language model.
- Parsers and token builders read only the `Snapshot` schema.
- Figma access follows the `plan` selected in `tokenloom.config.ts`.
  No Figma call may fall outside the plan matrix in `docs/reference/spec.md` section 0.
- Identical input produces byte-identical output.
- Dependencies stay within the allowlist in `docs/reference/verification.md` section 9.
- `samples/button/` and `samples/mutations/expected.json` are reviewed reference answers that the implementation must match.
- The canonical `DesignContext` schema does not change to suit an Agent-view optimization; the Agent view is a projection of it.

## Non-goals

- Page-level code generation.
- Design linting.
- A component library.
- Live Figma synchronization.
- A custom MCP client.
- Plugin UI beyond one export action and a download link.
- A separate search index or server-side store for a hundredfold-larger design file.

## Target measurements

These targets define the design envelope, and the benchmark gate judges them against the values in `packages/verify/config.json`.
Versioned readers accept historical evidence keys such as `ir_bytes`; current measurements use `context_*` names.

| Measurement | Target |
|---|---|
| Compact design-context p99 size | no more than 8KB |
| Median compact compression ratio | at least 15x |
| Compact context warm p99 | no more than 100ms |
| `tokens build` p99 | no more than 1 second |
| Synthetic-tree time ratio from 1k to 10k nodes | no more than 15x |
| Agent-view byte reduction against canonical compact context | median at least 4%, and no sample grows |
| Agent-view projection warm p99 | no more than 5ms |
| Selected-variant output against full context, on `twenty-variants` | at least 45% smaller |
| Component discovery output | at most 20 items and 4KB of JSON |
| MCP surface | exactly 2 tools, with a combined schema estimate of at most 800 tokens |
| Whole-task input tokens, Agent view against the canonical CLI condition | median at least 15% lower, with no drop in task success or increase in median turns |
| Generated-code quality when a representation changes | no S1 regression, and at most a 0.02 drop in median S2 |
| Figma REST Tier 1 budget on the Professional plan | 10 calls per minute with 2 reserved |
| Figma MCP budget on the Professional plan | 200 calls per day and 10 per minute, with 20 and 1 reserved |
| One nine-cell evaluation matrix set against a real model | no more than $2.50 per set |

## Growth boundaries

The design keeps its current shape up to roughly a tenfold or twentyfold increase in size.

- Ten times the component sets keeps discovery output fixed at 20 items.
- A larger file keeps known-component lookup proportional to that component's context size, not to the whole design.
- Agent output never relaxes the parser's p99 or scale targets.
- Beyond that, split plugin exports by page and merge them with `--from a.json,b.json`.
  At a hundredfold size, incremental synchronization by file-version diff would need a new design.

## Signals that would widen the design

Widen the design only when a measurement, not an expectation, shows one of these.

- Two or more independent products or protocols reuse `AgentContext` → consider a separate package.
- More than 20% of tasks need a third lookup because of discovery → consider a dedicated discovery tool or an index.
- Re-reading already-loaded context costs more than 20% of tokens in design-revision work → consider a `context diff` between snapshots.
- An alternate output format saves less than 15% against Agent JSON → drop the alternate format.
- A semantic delta fails to save 10% even on variant-heavy samples → keep RFC 6901 pointers.
- Trajectory evidence shows more MCP tools are the only way to reduce turns meaningfully → redesign inside the 800-token schema budget.
