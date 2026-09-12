---
paths:
  - "**/*.reference.test.ts"
  - "samples/**"
  - "scripts/reference-lock.ts"
---

# Verify reference output through the built CLI

A reference-output test invokes apps/cli/dist/tokenloom.js through child_process.
Do not import parser or token internals into a reference-output test.
Byte-compare generated output with the committed reference output.
Update regression references only through scripts/reference-lock.ts --reason.
Treat reviewed reference output as an answer rather than a snapshot to refresh.

Source: docs/reference/verification.md reference gate and section 4.
