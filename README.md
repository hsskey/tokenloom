# tokenloom

[한국어](./README.ko.md)

Give coding agents only the Figma context they need to implement a component.

tokenloom turns a Figma page export into component-level design context and reusable design tokens.
The transformation runs locally and deterministically and does not call a language model.

```text
Figma
  │
  ▼
tokenloom exporter
  │
  ▼
snapshot
  │
  ├── tokenloom context ──▶ coding agent ──▶ component code
  │
  └── tokenloom tokens  ──▶ DTCG / CSS / Swift / Kotlin
```

Instead of making a coding agent explore the entire Figma node tree, tokenloom finds the relevant
component and variants first and exposes only the context needed for the current task.

## Try it now

You can run tokenloom end to end with no Figma access. This repository ships sample snapshots under
`samples/`, so `npx` can drive the published package against them directly. Node.js 22 or later is
required.

Clone this repository, then from its root retrieve the design context for the `Button` component in
the bundled sample:

```sh
npx @hsskey/tokenloom context Button --from samples/button/snapshot.json --view agent --json
```

This prints the structure, variants, and token references for that component as JSON.

Build design tokens from the same snapshot into CSS, Swift, and Kotlin:

```sh
npx @hsskey/tokenloom tokens build --from samples/button/snapshot.json --out /tmp/tk --platform css,swift,kotlin
```

This writes a DTCG token document, CSS custom properties, and Swift and Kotlin source under
`/tmp/tk`.

More snapshots are available under `samples/`, including `real-design-system`, `four-modes`, and
`twenty-variants`. Point `--from` at any of their `snapshot.json` files.

## Getting started

### 1. Install tokenloom

Node.js 22 or later is required.

```sh
npm install -g @hsskey/tokenloom
```

Install the Claude Code Skill in the project you are working on:

```sh
tokenloom init
```

Claude Code can now use tokenloom to retrieve component context from a Figma export.

### 2. Export a Figma page

Install [**tokenloom exporter**](https://www.figma.com/community/plugin/1680544980365532256/tokenloom-exporter)
from Figma Community.

Run the plugin on the page that contains the component you want to implement, download the snapshot,
and save it somewhere inside your project.

For example:

```text
my-app/
├── designs/
│   └── checkout.json
├── src/
└── ...
```

The location is up to you.

### 3. Ask for the component

Tell Claude Code which snapshot and component to use.

> Use `designs/checkout.json` to implement the Button component.
> Follow this project's existing component and styling conventions, reuse existing tokens where
> appropriate, and run the relevant checks when you are done.

Claude Code uses tokenloom to locate the component and retrieve the design context it needs, then
combines that information with the existing codebase to implement the component.

tokenloom itself does not write your application. Its job is to give the coding agent structured
design information it can work with.

## Use the CLI directly

You can inspect component context without an agent:

```sh
tokenloom context Button \
  --from designs/checkout.json \
  --view agent \
  --json
```

This returns the structure, variants, token references, and other design context relevant to that
component.

## Generate design tokens

The same Figma export can also be used independently of a coding agent.

```sh
tokenloom tokens build \
  --from designs/checkout.json \
  --out src/tokens \
  --platform css,swift,kotlin
```

tokenloom generates:

* a DTCG token document
* CSS custom properties
* Swift source
* Kotlin source

The same input and configuration always produce the same output.

## What tokenloom does

tokenloom moves work that can be handled by deterministic software out of the coding agent's context.

It:

* reads a Figma export into a common snapshot
* discovers components and variants
* builds the design context needed for code generation
* converts design tokens into DTCG and platform-specific formats
* produces deterministic output for identical inputs

The coding agent combines that information with the actual codebase: its components, styling
conventions, and project rules.

## Responsibilities

**Figma plugin**

Exports the currently open Figma page as a snapshot.

**tokenloom**

Reads the snapshot and produces component context and design tokens.

**coding agent**

Uses tokenloom's design information together with the existing project to implement the component.

tokenloom is not a `.fig` file parser or a general-purpose UI code generator, and it does not send
the complete Figma file to an LLM.

## Evaluation harness

The tokenloom CLI above (`snapshot`, `context`, `tokens`) is deterministic local processing and never
calls a language model. This repository also carries a separate development evaluation harness, and
that harness is the only part of the project that makes real model calls. It is a development tool,
not part of the shipped CLI workflow. Its purpose is to measure how a change in the design-context
representation affects both the component a coding agent generates and the model usage that generation
takes.

### What it measures

* **S1 (token reference validity)** — the generated CSS parses and every `var(--x)` it uses exists in
  the reference `tokens.css`.
* **S2 (token compliance)** — the ratio of design-token references to hard-coded literals in the
  generated CSS.
* **Variant coverage** — the required variant set compared against the `data-variant` markers in the
  generated HTML, reported as recall and precision with any duplicate, missing, or unexpected
  variants. Coverage is a separate failure dimension and never folds into S1 or S2.
* **S3 (visual difference)** — for each expected variant that has a reference render, the pixel
  mismatch between the reference and the generated variant. The gated value is the worst variant's
  mismatch; the mean is recorded alongside it as a diagnostic. When no expected variant has a
  reference render, S3 is not applicable. Coverage and S3 are independent failure dimensions.
* **Usage metrics** — input and output tokens, an estimated cost, latency, and the model provenance
  (the requested alias and the provider-resolved model id) of each run.

### How results are recorded

* Each run is stored as a JSONL run record; reports are computed from those records, never written by
  hand.
* Runs are compared only within a set that shares the same prompt hash and model provenance, so a
  change to the prompt or the model starts a new comparison set.
* Threshold failures are shown in the report; the thresholds live in `eval/thresholds.json`.
* Run records are append-only and are not rewritten.

### Reproducing without spending money

Plan a trajectory evaluation without any model call:

```sh
pnpm tokenloom eval trajectory --matrix eval/trajectory.yaml --dry-run --json
```

Plan a one-shot evaluation with the fake adapter, which also makes no model call:

```sh
TOKENLOOM_LLM=fake pnpm tokenloom eval run --matrix eval/matrix.mvp.yaml --dry-run
```

Regenerate a report from the committed run records (reads `runs/*.jsonl`, makes no model call):

```sh
pnpm tokenloom eval report --out reports/<date>.md
```

An example committed report is [`reports/2026-09-17.md`](./reports/2026-09-17.md), computed from real
run records and showing S1, S2, token usage, cost, and latency. Real model calls happen only through
`eval run` or `eval trajectory` without the fake adapter and require an explicit budget; see
[`docs/reference/spec.md`](./docs/reference/spec.md) section 9 for the full contract.

## Documentation

For deeper technical details:

* [`docs/reference/spec.md`](./docs/reference/spec.md) — CLI and data contracts
* [`docs/architecture.md`](./docs/architecture.md) — module boundaries and data flow
* [`docs/adr/`](./docs/adr/) — major design decisions

## License

MIT
