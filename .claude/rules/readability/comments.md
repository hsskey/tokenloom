---
paths:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.html"
  - "**/*.yaml"
  - "**/*.yml"
---

# Explain constraints rather than narrating code

Write comments in English.
Keep a comment when it explains a non-obvious domain invariant, external limitation, compatibility boundary, failure mode, or source of policy.
Write the reason directly so a public contributor does not need private development history to understand it.
Point to an active contract when a threshold or protocol is owned elsewhere.
Remove comments that repeat the filename, function name, type, or following statement.
Remove development-process history - phases, tasks, handoffs, review rounds - from active code.
Keep specification rule IDs in test descriptions where the rule-traceability gate depends on them.
Do not copy measured values into comments when configuration or committed evidence owns them.

Source: `AGENTS.md` and `docs/architecture.md`.
