<h1 align="center">tokenloom</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@hsskey/tokenloom"
    ><img alt="npm" src="https://img.shields.io/npm/v/@hsskey/tokenloom?style=flat-square"
  /></a>
  <a href="./LICENSE"
    ><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"
  /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-blue?style=flat-square" />
</p>

<h3 align="center">Give a coding agent only the Figma context it needs to build a component.</h3>

<p align="center"><a href="./README.ko.md">한국어</a></p>

tokenloom turns a Figma page export into component-level design context and reusable design tokens.
The transformation runs locally and deterministically and never calls a language model.

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

## Why tokenloom

- **Only the relevant context.** Instead of making an agent walk the entire Figma node tree, tokenloom finds the target component and its variants and hands over just that.
- **Deterministic and local.** The same input and configuration always produce the same output, with no model call in the CLI path.
- **Tokens for real platforms.** One export becomes a DTCG token document plus CSS custom properties and Swift and Kotlin source.
- **Agent-ready.** A Claude Code Skill lets the agent fetch component context on its own during implementation.

## Quick Start

Node.js 22 or later is required.

You can run tokenloom end to end with no Figma access. This repository ships sample snapshots under
`samples/`, so `npx` can drive the published package against them directly. Clone the repository, then
from its root retrieve the design context for the bundled `Button` component:

```sh
npx @hsskey/tokenloom context Button --from samples/button/snapshot.json --view agent --json
```

This prints the structure, variants, and token references for that component as JSON. Build design
tokens from the same snapshot into CSS, Swift, and Kotlin:

```sh
npx @hsskey/tokenloom tokens build --from samples/button/snapshot.json --out /tmp/tk --platform css,swift,kotlin
```

More snapshots live under `samples/`, including `real-design-system`, `four-modes`, and
`twenty-variants`. Point `--from` at any of their `snapshot.json` files.

## Use it with Claude Code

Install the CLI globally, then install the Claude Code Skill in your project:

```sh
npm install -g @hsskey/tokenloom
tokenloom init
```

Export the page you want to work from. Install the
[**tokenloom exporter**](https://www.figma.com/community/plugin/1680544980365532256/tokenloom-exporter)
from Figma Community, run it on the page that holds your component, and save the downloaded snapshot
inside your project (for example `designs/checkout.json`; the location is up to you).

Then tell Claude Code which snapshot and component to use:

> Use `designs/checkout.json` to implement the Button component.
> Follow this project's existing component and styling conventions, reuse existing tokens where
> appropriate, and run the relevant checks when you are done.

Claude Code uses tokenloom to locate the component and retrieve its design context, then combines that
with your existing codebase to implement the component. tokenloom does not write your application; it
gives the agent structured design information to work from.

## Use the CLI directly

Inspect component context without an agent:

```sh
tokenloom context Button --from designs/checkout.json --view agent --json
```

Generate design tokens independently of any agent:

```sh
tokenloom tokens build --from designs/checkout.json --out src/tokens --platform css,swift,kotlin
```

This writes a DTCG token document, CSS custom properties, and Swift and Kotlin source. The same input
and configuration always produce the same output.

## Responsibilities

- **Figma plugin** - exports the currently open Figma page as a snapshot.
- **tokenloom** - reads the snapshot and produces component context and design tokens.
- **coding agent** - uses that design information with the existing project to implement the component.

tokenloom is not a `.fig` file parser or a general-purpose UI code generator, and it does not send the
complete Figma file to an LLM.

## Evaluation harness

The CLI above is deterministic local processing and never calls a language model. This repository also
carries a separate development evaluation harness that measures how a change in the design-context
representation affects the component an agent generates and the model usage it takes. It is a
development tool, not part of the shipped CLI, and it is the only part of the project that makes real
model calls, which require an explicit budget. See
[`docs/reference/spec.md`](./docs/reference/spec.md) section 9 for the full contract and
[`reports/2026-09-17.md`](./reports/2026-09-17.md) for an example report computed from real run records.

## Documentation

- [`docs/reference/spec.md`](./docs/reference/spec.md) - CLI and data contracts
- [`docs/architecture.md`](./docs/architecture.md) - module boundaries and data flow
- [`docs/adr/`](./docs/adr/) - major design decisions

## License

MIT
