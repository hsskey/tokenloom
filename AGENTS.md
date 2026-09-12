# tokenloom

tokenloom turns Figma snapshots into deterministic design tokens and compact design context for code generation.
It also carries a regression harness that measures generated-code quality across input sources and evaluation input variants.

This is a pnpm workspace. Run `corepack enable` before `pnpm install` so the pinned pnpm version is used.
`CLAUDE.md` imports this file, so Claude Code and Codex read the same instructions. Edit this file, not `CLAUDE.md`.

## Where to look

| Read | When |
|---|---|
| `README.md` | Using the CLI or checking what the project claims |
| `CONTEXT.md` | Naming anything: APIs, tests, issues, documentation |
| `docs/architecture.md` and `docs/adr/` | Changing a module seam, dependency, or public contract |
| `docs/reference/spec.md` | Implementing a feature governed by a rule ID, schema, or CLI contract |
| `docs/reference/verification.md` | Changing tests or verification, or looking up what a gate checks |
| `docs/goals.md` | Deciding scope, non-goals, or compatibility |
| `.claude/rules/INDEX.md` | Before changing any file; the rules are scoped by path |
| `docs/agents/` | Issue tracking, triage vocabulary, glossary and ADR conventions, component generation |
| `samples/` and `verify/` | Changing test data, or reading committed verification results |

## Before you start

Most engineering rules live in `.claude/rules/` and load when you touch a matching path.
The following cannot wait for a path match, because a single command can spend money or destroy evidence.

- Real language-model calls happen only inside `packages/eval`, only with `--budget-usd`. Do not invoke the `claude` executable directly except for `--help` or `--version`.
- Figma calls stay inside the plan matrix in `docs/reference/spec.md` section 0, and REST Tier 1 and MCP calls go through the budget ledger. Exceeding a window means no call at all.
- Committed run records, reports, benchmark results, and verification JSON are measured evidence. Do not rewrite them, and do not rewrite recorded rule IDs or commit references as editorial cleanup.
- Reference output changes only through `scripts/reference-lock.ts --reason`. Never run Vitest with `-u` or `--update`.
- Do not weaken a threshold, forbidden pattern, dependency allowlist, or self-test expectation to make a gate pass. If a gate looks wrong, stop the work that gate covers and raise it with a maintainer, with an exact reproduction.
- Credentials (`FIGMA_TOKEN`, `ANTHROPIC_API_KEY`, a `claude` CLI login) belong to the external tool and never to this repository. Real Figma capture also needs the desktop app and permission to run a development plugin.

A contract document or rule changes only when a maintainer changes the contract.
Update the contract, every rule derived from it, and the tests that enforce it in one change.

## Working on a change

1. Reproduce the behavior through the CLI with sample data before changing implementation.
2. Read the rules under `.claude/rules/` whose `paths:` match the files you will change.
3. Make the smallest change that keeps the public compatibility boundaries.
4. Run focused tests, then `pnpm build`, `pnpm lint`, `pnpm typecheck`, and the gates the change affects.
5. Record a hard-to-reverse architectural choice as an ADR under `docs/adr/`, and only when it reflects a real trade-off.

New work starts from a GitHub Issue or a concrete maintainer request.
Keep remote issue, pull request, release, visibility, and publication actions within what the maintainer explicitly asked for.

## Commands beyond the usual

```sh
pnpm verify                    # every gate
pnpm verify --gate benchmarks  # one gate by name; docs/reference/verification.md section 2 explains each
pnpm verify --selftest         # check the verifier against its own failure samples
pnpm bench --json
pnpm tsx scripts/reference-lock.ts --check
pnpm tokenloom context Button --from samples/button/snapshot.json --annotations --json
pnpm tokenloom doctor --from samples/button/snapshot.json
TOKENLOOM_LLM=fake pnpm tokenloom eval run --matrix eval/matrix.mvp.yaml --dry-run
```

`pnpm install`, `build`, `test`, `lint`, and `typecheck` behave as expected.

## Maintaining this file

Keep this file for knowledge useful to almost every session in this repository.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning an existing entry over appending a new one.
Anything that matters only for one domain belongs in `.claude/rules/`, `docs/`, or a package's own documentation.
