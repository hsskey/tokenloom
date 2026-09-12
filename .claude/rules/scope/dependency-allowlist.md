---
paths:
  - "**/package.json"
  - "pnpm-workspace.yaml"
---

# Keep dependencies within the allowlist

Before adding a package, check docs/reference/verification.md section 9 and reuse the standard library or an existing dependency when practical.
Do not add a dependency that is absent from the allowlist.
Stop and raise it with a maintainer when a new package is necessary.
Keep development-only packages out of runtime dependencies.

Source: docs/reference/verification.md scope gate and section 9.
