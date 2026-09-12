# Project instructions

The canonical repository instructions are in the root `AGENTS.md`.
The root `CLAUDE.md` imports that file, so Claude Code and Codex share one contract.

Path-scoped rules live under `.claude/rules/` and are grouped by engineering concern.
Each rule declares its scope with `paths:` in YAML frontmatter.
Read `.claude/rules/INDEX.md` for the complete map.

Repository-specific rules derive from `docs/goals.md`, `docs/reference/spec.md`, and `docs/reference/verification.md`.
The readability, predictability, cohesion, coupling, and general testing rules derive from the external guides cited in the index.
When a derived rule conflicts with a source contract or gate, the source contract and gate win.
Change a derived rule only in the same change that updates its source contract.
