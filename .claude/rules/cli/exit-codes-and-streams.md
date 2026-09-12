---
paths:
  - "apps/cli/src/**/*.ts"
---

# Preserve CLI streams and exit categories

Use the exit categories defined in docs/reference/spec.md section 4.
In JSON mode, stdout contains only the requested JSON value.
Send progress, warnings, and diagnostics to stderr.
Return through the command boundary instead of calling process.exit in library code.
Keep help text aligned with the `context` command and `design_context` MCP tool.

Source: docs/reference/spec.md section 4 and the forbidden-pattern gate.
