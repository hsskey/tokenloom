---
paths:
  - "packages/**/src/**/*.ts"
  - "apps/**/src/**/*.ts"
  - "scripts/**/*.ts"
---

# Stay within source limits

Read the file, line, and script limits from packages/verify/config.json.
Prefer deletion, reuse, and simpler control flow before adding a new abstraction.
Do not compress several statements onto one line to satisfy LOC.
Run `pnpm verify --gate scope` after changing production source or scripts.

Source: docs/reference/verification.md scope gate.
