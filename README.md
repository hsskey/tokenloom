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

Install the **tokenloom exporter** plugin from Figma Community.

Run it on the page that contains the component you want to implement, download the snapshot, and save
it somewhere inside your project.

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

## Documentation

For deeper technical details:

* [`docs/reference/spec.md`](./docs/reference/spec.md) — CLI and data contracts
* [`docs/architecture.md`](./docs/architecture.md) — module boundaries and data flow
* [`docs/adr/`](./docs/adr/) — major design decisions

## License

MIT
